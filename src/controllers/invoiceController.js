const { Invoice, Transaction, sequelize } = require('../db');
const { createWallet, getInvoicePayments, checkAddressBalance,getUsdtBalance, web3, tronWeb } = require('../services/blockchainService');
const crypto = require('crypto');

const generateReference = () => `INV-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

function toNumber(value) {
  return typeof value === 'string' ? Number(value) : value;
}

function normalizeDecimal(value) {
  return Number(Number(value).toFixed(8));
}

async function createInvoice(req, res, next) {
  try {
    const { amount, currency, customer_email, network } = req.body;

    if (!amount || !currency || !customer_email || !network) {
      return res.status(400).json({ error: 'amount, currency, customer_email, and network are required' });
    }

    const reference = generateReference();
    const wallet = await createWallet(network);

    const invoice = await Invoice.create({
      reference,
      amount,
      currency,
      customer_email,
      payment_network: network.toLowerCase(),
      payment_address: wallet.address,
      payment_private_key: wallet.privateKey,
    });

    return res.status(201).json({ invoice });
  } catch (error) {
    next(error);
  }
}

async function getInvoice(req, res, next) {
  try {
    const invoiceId = Number(req.params.id);
    if (!invoiceId) {
      return res.status(400).json({ error: 'Invalid invoice id' });
    }

    const invoice = await Invoice.findByPk(invoiceId, {
      include: [{ model: Transaction }],
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    return res.json({ invoice });
  } catch (error) {
    next(error);
  }
}

async function trackInvoicePayment(req, res, next) {
  const t = await sequelize.transaction();
  try {
    const { invoice_id } = req.body;

    if (!invoice_id) {
      await t.rollback();
      return res.status(400).json({ error: 'invoice_id is required' });
    }

    const invoice = await Invoice.findByPk(invoice_id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!invoice) {
      await t.rollback();
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (invoice.status === 'completed') {
      await t.rollback();
      return res.status(400).json({ error: 'Invoice already completed' });
    }

    const payments = await getInvoicePayments(invoice);
    const totalPaid = normalizeDecimal(payments.reduce((sum, tx) => sum + Number(tx.amount), 0));
    const invoiceAmount = normalizeDecimal(Number(invoice.amount));

    if (totalPaid < invoiceAmount) {
      await t.rollback();
      return res.status(400).json({
        error: 'Total paid amount is less than invoice amount',
        invoice_amount: invoiceAmount,
        total_paid: totalPaid,
        payments,
      });
    }

    const createdTransactions = [];
    for (const payment of payments) {
      const [existingTx, created] = await Transaction.findOrCreate({
        where: { tx_hash: payment.tx_hash },
        defaults: {
          invoice_id,
          tx_hash: payment.tx_hash,
          network: invoice.payment_network,
          amount: normalizeDecimal(Number(payment.amount)),
          status: 'success',
        },
        transaction: t,
      });
      if (created) {
        createdTransactions.push(existingTx);
      }
    }

    await invoice.update(
      {
        paid_amount: totalPaid,
        payment_confirmed_at: new Date(),
        status: 'completed',
      },
      { transaction: t }
    );

    await t.commit();
    return res.status(200).json({ payments, total_paid: totalPaid, invoice, created_transactions: createdTransactions });
  } catch (error) {
    await t.rollback();
    next(error);
  }
}


async function finishTransaction(req, res, next) {
  const t = await sequelize.transaction();
  try {
    const { invoice_id, tx_hash, network, amount, status } = req.body;

    if (!invoice_id || !tx_hash || !network || !amount) {
      await t.rollback();
      return res.status(400).json({ error: 'invoice_id, tx_hash, network, and amount are required' });
    }

    const invoice = await Invoice.findByPk(invoice_id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!invoice) {
      await t.rollback();
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (invoice.status === 'completed') {
      await t.rollback();
      return res.status(400).json({ error: 'Invoice already completed' });
    }

    const transaction = await Transaction.create(
      {
        invoice_id,
        tx_hash,
        network,
        amount,
        status: status || 'success',
      },
      { transaction: t }
    );

    await invoice.update({ status: 'completed' }, { transaction: t });
    await t.commit();

    return res.status(201).json({ transaction });
  } catch (error) {
    await t.rollback();
    next(error);
  }
}

async function trackInvoiceByAddress(req, res, next) {
  const t = await sequelize.transaction();
  try {
    const { payment_address, network } = req.body;

    if (!payment_address || !network) {
      await t.rollback();
      return res.status(400).json({ error: 'payment_address and network are required' });
    }

    const invoice = await Invoice.findOne({
      where: {
        payment_network: network.toLowerCase(),
        payment_address: payment_address.trim().toLowerCase(),
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!invoice) {
      await t.rollback();
      return res.status(404).json({ error: 'Invoice not found for this address and network' });
    }

    // if (invoice.payment_address.toLowerCase() !== payment_address.trim().toLowerCase()) {
    //   await t.rollback();
    //   return res.status(404).json({ error: 'Invoice not found for this address and network 10' });
    // }

    const payments = await getInvoicePayments(invoice);
    const totalPaid = normalizeDecimal(payments.reduce((sum, tx) => sum + Number(tx.amount), 0));
    const invoiceAmount = normalizeDecimal(Number(invoice.amount));

    const createdTransactions = [];
    for (const payment of payments) {
      const [existingTx, created] = await Transaction.findOrCreate({
        where: { tx_hash: payment.tx_hash },
        defaults: {
          invoice_id: invoice.id,
          tx_hash: payment.tx_hash,
          network: invoice.payment_network,
          amount: normalizeDecimal(Number(payment.amount)),
          status: 'success',
        },
        transaction: t,
      });
      if (created) {
        createdTransactions.push(existingTx);
      }
    }

    const isComplete = totalPaid >= invoiceAmount;
    if (isComplete && invoice.status !== 'completed') {
      await invoice.update(
        {
          paid_amount: totalPaid,
          payment_confirmed_at: new Date(),
          status: 'completed',
        },
        { transaction: t }
      );
    }

    await t.commit();
    return res.status(200).json({
      invoice,
      payments,
      total_paid: totalPaid,
      invoice_amount: invoiceAmount,
      completed: isComplete,
      created_transactions: createdTransactions,
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
}

async function getTransaction(req, res, next) {
  try {
    const txId = Number(req.params.id);
    if (!txId) {
      return res.status(400).json({ error: 'Invalid transaction id' });
    }

    const transaction = await Transaction.findByPk(txId);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    return res.json({ transaction });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createInvoice,
  getInvoice,
  finishTransaction,
  trackInvoicePayment,
  trackInvoiceByAddress,
  getTransaction,
};
