const { Invoice, Transaction } = require('../db');
const { web3, tronWeb } = require('./blockchainService');

const WATCH_INTERVAL = Number(process.env.PAYMENT_WATCH_INTERVAL || 30000);
const LOOKBACK_BLOCKS = Number(process.env.PAYMENT_LOOKBACK_BLOCKS || 20);

function fromWei(value) {
  return Number(web3.utils.fromWei(value, 'ether'));
}

function toBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') {
    return value.startsWith('0x') ? BigInt(value) : BigInt(value);
  }
  if (value && typeof value.toString === 'function') {
    return BigInt(value.toString());
  }
  throw new Error('Unable to convert value to BigInt');
}

async function findBep20Deposit(address, amount) {
  const lowerAddress = address.toLowerCase();
  const latestBlock = await web3.eth.getBlockNumber();
  const neededAmount = toBigInt(web3.utils.toWei(amount.toString(), 'ether'));

  for (let i = Math.max(0, latestBlock - LOOKBACK_BLOCKS); i <= latestBlock; i += 1) {
    const block = await web3.eth.getBlock(i, true);
    if (!block || !block.transactions) continue;

    for (const tx of block.transactions) {
      if (!tx.to) continue;
      if (tx.to.toLowerCase() !== lowerAddress) continue;

      const value = toBigInt(tx.value);
      if (value >= neededAmount) {
        return {
          tx_hash: tx.hash,
          amount: Number(web3.utils.fromWei(value.toString(), 'ether')),
          blockNumber: tx.blockNumber,
          confirmed: toBigInt(latestBlock) - toBigInt(tx.blockNumber) + toBigInt(1),
        };
      }
    }
  }

  return null;
}

async function findTrc20Deposit(address, amount) {
  try {
    const transactions = await tronWeb.trx.getTransactionsRelated(address, 'to', LOOKBACK_BLOCKS);
    const neededAmount = Number(amount);

    for (const tx of transactions) {
      const contract = tx.raw_data.contract && tx.raw_data.contract[0];
      if (!contract) continue;

      const type = contract.type;
      const value = contract.parameter && contract.parameter.value;
      const toAddress = value && value.to_address;
      const amountSun = value && value.amount;
      if (!toAddress || !amountSun) continue;

      const targetAddress = tronWeb.address.fromHex(toAddress);
      if (targetAddress !== address) continue;

      const txAmount = tronWeb.fromSun(amountSun);
      if (txAmount >= neededAmount) {
        return {
          tx_hash: tx.txID,
          amount: txAmount,
          blockNumber: tx.blockNumber || null,
          confirmed: true,
        };
      }
    }
  } catch (error) {
    return null;
  }

  return null;
}

async function confirmInvoicePayment(invoice) {
  if (invoice.status !== 'pending') {
    return;
  }

  let deposit = null;
  if (invoice.payment_network === 'bep20') {
    deposit = await findBep20Deposit(invoice.payment_address, invoice.amount);
  } else if (invoice.payment_network === 'trc20') {
    deposit = await findTrc20Deposit(invoice.payment_address, invoice.amount);
  }

  if (!deposit) {
    return;
  }

  const existingTx = await Transaction.findOne({ where: { tx_hash: deposit.tx_hash } });
  if (existingTx) {
    return;
  }

  const transaction = await Transaction.create({
    invoice_id: invoice.id,
    tx_hash: deposit.tx_hash,
    network: invoice.payment_network,
    amount: deposit.amount,
    status: 'success',
  });

  await invoice.update({
    paid_amount: deposit.amount,
    payment_confirmed_at: new Date(),
    status: 'completed',
  });

  return transaction;
}

async function scanPendingInvoices() {
  const pendingInvoices = await Invoice.findAll({ where: { status: 'pending' } });
  for (const invoice of pendingInvoices) {
    try {
      await confirmInvoicePayment(invoice);
    } catch (error) {
      console.error('Payment watcher error for invoice', invoice.id, error.message);
    }
  }
}

async function startInvoiceWatcher() {
  await scanPendingInvoices();
  setInterval(scanPendingInvoices, WATCH_INTERVAL);
  console.log(`Invoice watcher started, scanning every ${WATCH_INTERVAL}ms`);
}

module.exports = {
  startInvoiceWatcher,
};
