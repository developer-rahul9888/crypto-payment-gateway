const { Web3 } = require('web3');
const TronWeb = require('tronweb');

const bep20RpcUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
const tronConfig = {
  fullNode: process.env.TRON_FULL_NODE || 'https://api.trongrid.io',
  solidityNode: process.env.TRON_SOLIDITY_NODE || 'https://api.trongrid.io',
  eventServer: process.env.TRON_EVENT_SERVER || 'https://api.trongrid.io',
};

const USDT_BSC_CONTRACT = process.env.USDT_BSC_CONTRACT || '0x55d398326f99059fF775485246999027B3197955';
const USDT_TRON_CONTRACT = process.env.USDT_TRON_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

const web3 = new Web3(bep20RpcUrl);
const tronWeb = new TronWeb(tronConfig.fullNode, tronConfig.solidityNode, tronConfig.eventServer);

const ERC20_ABI = [
  {
    constant: true,
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
  },
  {
    constant: true,
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    type: 'function',
  },
  {
    constant: false,
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', type: 'bool' }],
    type: 'function',
  },
];

function normalizePrivateKey(privateKey) {
  if (!privateKey) {
    throw new Error('Private key is required');
  }

  if (typeof privateKey === 'string') {
    const normalized = privateKey.trim();
    if (!normalized) {
      throw new Error('Private key is required');
    }

    if (normalized.startsWith('0x') || normalized.startsWith('0X')) {
      return normalized;
    }

    return `0x${normalized}`;
  }

  if (Buffer.isBuffer(privateKey)) {
    return `0x${privateKey.toString('hex')}`;
  }

  if (privateKey instanceof Uint8Array) {
    return `0x${Buffer.from(privateKey).toString('hex')}`;
  }

  throw new Error('Private key must be a string, Buffer, or Uint8Array');
}

async function createBep20Wallet() {
  return web3.eth.accounts.create();
}

async function createTrc20Wallet() {
  const account = await TronWeb.createAccount();
  return {
    address: account.address.base58,
    privateKey: account.privateKey,
    publicKey: account.publicKey,
  };
}

async function trackBep20Transaction(txHash) {
  try {
    const tx = await web3.eth.getTransaction(txHash);
    const receipt = await web3.eth.getTransactionReceipt(txHash);
    if (!tx && !receipt) {
      return null;
    }

    return {
      network: 'bep20',
      tx,
      receipt,
      confirmed: Boolean(receipt && receipt.blockNumber),
    };
  } catch (error) {
    return null;
  }
}

async function trackTrc20Transaction(txHash) {
  try {
    const tx = await tronWeb.trx.getTransaction(txHash);
    const info = await tronWeb.trx.getTransactionInfo(txHash);
    if (!tx && !info) {
      return null;
    }

    return {
      network: 'trc20',
      tx,
      info,
      confirmed: Boolean(info && info.receipt && info.receipt.result === 'SUCCESS'),
    };
  } catch (error) {
    return null;
  }
}

async function getBep20Balance(address) {
  const balance = await web3.eth.getBalance(address);
  return balance.toString();
}

async function getTrc20Balance(address) {
  const balance = await tronWeb.trx.getBalance(address);
  return balance.toString();
}

async function getBep20TokenBalance(address, tokenAddress) {
  const contract = new web3.eth.Contract(ERC20_ABI, tokenAddress);
  const [balance, decimals] = await Promise.all([
    contract.methods.balanceOf(address).call(),
    contract.methods.decimals().call(),
  ]);
  return {
    balance: balance.toString(),
    decimals: Number(decimals),
  };
}

function parseTokenAmount(amount, decimals) {
  const value = amount.toString();
  const [whole, fraction = ''] = value.split('.');
  const sanitizedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  const wholePart = BigInt(whole || '0') * 10n ** BigInt(decimals);
  const fractionPart = BigInt(sanitizedFraction || '0');
  return wholePart + fractionPart;
}

async function sendBep20Token(fromPrivateKey, toAddress, amount, tokenAddress) {
  const normalizedPrivateKey = normalizePrivateKey(fromPrivateKey);
  const account = web3.eth.accounts.privateKeyToAccount(normalizedPrivateKey);
  const contract = new web3.eth.Contract(ERC20_ABI, tokenAddress);
  const decimals = Number(await contract.methods.decimals().call());
  const value = parseTokenAmount(amount, decimals);

  const txData = contract.methods.transfer(toAddress, value.toString()).encodeABI();
  const nonce = await web3.eth.getTransactionCount(account.address, 'pending');
  const gasPrice = await web3.eth.getGasPrice();
  const estimatedGas = await contract.methods.transfer(toAddress, value.toString()).estimateGas({ from: account.address });
  const chainId = await web3.eth.getChainId();

  const tx = {
    from: account.address,
    to: tokenAddress,
    data: txData,
    gas: web3.utils.toHex(Math.max(Number(estimatedGas), 60000)),
    gasPrice: web3.utils.toHex(gasPrice),
    nonce: web3.utils.toHex(nonce),
    chainId,
  };

  const signed = await account.signTransaction(tx);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
  return {
    network: 'bep20',
    tx_hash: receipt.transactionHash,
    receipt,
    amount: Number(amount),
    to: toAddress,
    token_address: tokenAddress,
  };
}

async function sendBnb(fromPrivateKey, toAddress, amount) {
  const normalizedPrivateKey = normalizePrivateKey(fromPrivateKey);
  const account = web3.eth.accounts.privateKeyToAccount(normalizedPrivateKey);
  const value = web3.utils.toWei(amount.toString(), 'ether');
  const nonce = await web3.eth.getTransactionCount(account.address, 'pending');
  const gasPrice = await web3.eth.getGasPrice();

  console.log('value', value);
  // estimate gas for a simple transfer
  const gasEstimate = await web3.eth.estimateGas({ from: account.address, to: toAddress, value });
  const gas = Math.max(Number(gasEstimate), 21000);

  const chainId = await web3.eth.getChainId();

  const tx = {
    from: account.address,
    to: toAddress,
    value: web3.utils.toHex(value),
    gas: web3.utils.toHex(gas),
    gasPrice: web3.utils.toHex(gasPrice),
    nonce: web3.utils.toHex(nonce),
    chainId,
  };

  const signed = await account.signTransaction(tx);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
  return {
    network: 'bnb',
    tx_hash: receipt.transactionHash,
    receipt,
    amount: Number(amount),
    to: toAddress,
  };
}

async function getTrc20TokenBalance(address, tokenAddress) {
  const contract = await tronWeb.contract().at(tokenAddress);
  const [balance, decimals] = await Promise.all([
    contract.balanceOf(address).call(),
    contract.decimals().call(),
  ]);
  return {
    balance: balance.toString(),
    decimals: Number(decimals),
  };
}

async function sendTrc20Token(fromPrivateKey, toAddress, amount, tokenAddress) {
  const tron = new TronWeb(tronConfig.fullNode, tronConfig.solidityNode, tronConfig.eventServer, fromPrivateKey);
  const contract = await tron.contract().at(tokenAddress);
  const decimals = Number(await contract.decimals().call());
  const value = parseTokenAmount(amount, decimals).toString();

  const result = await contract.transfer(toAddress, value).send({ feeLimit: 1000000 });
  return {
    network: 'trc20',
    tx_hash: result.transaction.txID || result.txID || null,
    result,
    amount: Number(amount),
    to: toAddress,
    token_address: tokenAddress,
  };
}

async function getBep20TokenTransfers(address, tokenAddress) {
  const latestBlock = Number(await web3.eth.getBlockNumber());
  const lookback = Number(process.env.BLOCK_LOOKBACK_BLOCKS || 1000);
  const batchSize = Number(process.env.BLOCK_LOG_BATCH_SIZE || 200);
  const fromBlock = Math.max(0, latestBlock - lookback);
  const transferTopic = web3.utils.sha3('Transfer(address,address,uint256)');
  const normalizedAddress = address.replace(/^0x/i, '').toLowerCase();
  const topicAddress = `0x${normalizedAddress.padStart(64, '0')}`;
  const contract = new web3.eth.Contract(ERC20_ABI, tokenAddress);
  const decimals = Number(await contract.methods.decimals().call());
  const allLogs = [];

  for (let start = fromBlock; start <= latestBlock; start += batchSize) {
    const end = Math.min(latestBlock, start + batchSize - 1);
    const filter = {
      fromBlock: web3.utils.toHex(start),
      toBlock: web3.utils.toHex(end),
      address: tokenAddress,
      topics: [transferTopic, null, topicAddress],
    };

    try {
      const logs = await web3.eth.getPastLogs(filter);
      allLogs.push(...logs);
    } catch (error) {
      if (error.message && error.message.includes('limit exceeded')) {
        continue;
      }
      throw error;
    }
  }

  return allLogs.map((log) => {
    const decoded = web3.eth.abi.decodeLog(
      [
        { type: 'address', name: 'from', indexed: true },
        { type: 'address', name: 'to', indexed: true },
        { type: 'uint256', name: 'value' },
      ],
      log.data,
      [log.topics[1], log.topics[2]]
    );

    return {
      tx_hash: log.transactionHash,
      amount: Number(decoded.value) / 10 ** decimals,
      blockNumber: Number(log.blockNumber),
      network: 'bep20',
    };
  });
}

async function getTrc20TokenTransfers(address, tokenAddress) {
  const contract = await tronWeb.contract().at(tokenAddress);
  const decimals = Number(await contract.decimals().call());
  const transactions = await tronWeb.trx.getTransactionsRelated(address, 'to', Number(process.env.BLOCK_LOOKBACK_BLOCKS || 5000));

  return transactions
    .map((tx) => {
      const contractData = tx.raw_data.contract && tx.raw_data.contract[0];
      if (!contractData || contractData.type !== 'TransferContract') return null;
      const value = contractData.parameter?.value;
      const toAddress = value?.to_address;
      const amountSun = value?.amount;
      if (!toAddress || !amountSun) return null;

      const targetAddress = tronWeb.address.fromHex(toAddress);
      if (targetAddress.toLowerCase() !== address.toLowerCase()) return null;

      return {
        tx_hash: tx.txID,
        amount: Number(amountSun) / 10 ** decimals,
        blockNumber: tx.blockNumber || null,
        network: 'trc20',
      };
    })
    .filter(Boolean);
}

async function checkAddressBalance(invoice) {
  const network = invoice.payment_network;
  if (network === 'bep20') {
    const balance = await getUsdtBalance(invoice.payment_address, network);
    const paidAmount = balance;
    return {
      matched: Number(invoice.amount) === Number(paidAmount),
      paidAmount,
      tx_hash: null,
      balance,
    };
  }

  if (network === 'trc20') {
    const balance = await getUsdtBalance(invoice.payment_address, network);
    const paidAmount = balance;
    return {
      matched: Number(invoice.amount) === Number(paidAmount),
      paidAmount,
      tx_hash: null,
      balance,
    };
  }

  return { matched: false, paidAmount: 0, tx_hash: null, balance: null };
}

async function getUsdtBalance(address, network) {
  const target = network && network.toLowerCase();
  if (target === 'bep20' || target === 'bsc') {
    const { balance, decimals } = await getBep20TokenBalance(address, USDT_BSC_CONTRACT);
    return Number(balance) / 10 ** decimals;
  }

  if (target === 'trc20' || target === 'tron') {
    const { balance, decimals } = await getTrc20TokenBalance(address, USDT_TRON_CONTRACT);
    return Number(balance) / 10 ** decimals;
  }

  throw new Error('Unsupported network for USDT balance; use bep20 or trc20');
}

async function createWallet(network) {
  const target = network && network.toLowerCase();
  if (target === 'bep20' || target === 'bsc') {
    return createBep20Wallet();
  }

  if (target === 'trc20' || target === 'tron') {
    return createTrc20Wallet();
  }

  throw new Error('Unsupported network; use bep20 or trc20');
}

function getDefaultTokenContract(network) {
  const target = network && network.toLowerCase();
  if (target === 'bep20' || target === 'bsc') {
    return USDT_BSC_CONTRACT;
  }
  if (target === 'trc20' || target === 'tron') {
    return USDT_TRON_CONTRACT;
  }
  throw new Error('Unsupported network for token send; use bep20 or trc20');

}


async function sendToken(network, fromPrivateKey, toAddress, amount, tokenAddress) {
  const target = network && network.toLowerCase();
  const contractAddress = tokenAddress || getDefaultTokenContract(target);

  if (target === 'bep20' || target === 'bsc') {
    return sendBep20Token(fromPrivateKey, toAddress, amount, contractAddress);
  }

  if (target === 'trc20' || target === 'tron') {
    return sendTrc20Token(fromPrivateKey, toAddress, amount, contractAddress);
  }

  throw new Error('Unsupported network for token send; use bep20 or trc20');
}

async function findBep20DepositByAddress(address, amount) {
  const lowerAddress = address.toLowerCase();
  const latestBlock = Number(await web3.eth.getBlockNumber());
  const neededAmount = BigInt(web3.utils.toWei(amount.toString(), 'ether'));

  
  for (let i = Math.max(0, latestBlock - 20); i <= latestBlock; i += 1) {
    const block = await web3.eth.getBlock(i, true);
    if (!block || !block.transactions) continue;

    for (const tx of block.transactions) {
      if (!tx.to) continue;
      if (tx.to.toLowerCase() !== lowerAddress) continue;

      const value = BigInt(tx.value);
      if (value >= neededAmount) {
        return {
          tx_hash: tx.hash,
          amount: Number(web3.utils.fromWei(value.toString(), 'ether')),
          blockNumber: tx.blockNumber,
          confirmed: Number(BigInt(latestBlock) - BigInt(tx.blockNumber) + BigInt(1)),
        };
      }
    }
  }

  return null;
}

async function findTrc20DepositByAddress(address, amount) {
  try {
    const transactions = await tronWeb.trx.getTransactionsRelated(address, 'to', 20);
    const neededAmount = Number(amount);

    for (const tx of transactions) {
      const contract = tx.raw_data.contract && tx.raw_data.contract[0];
      if (!contract) continue;

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

async function getInvoicePayments(invoice) {
  const network = invoice.payment_network;
  const currency = invoice.currency && invoice.currency.toUpperCase();
  if (network === 'bep20') {
    if (currency === 'USDT') {
      return getBep20TokenTransfers(invoice.payment_address, USDT_BSC_CONTRACT);
    }
    return findBep20DepositByAddress(invoice.payment_address, invoice.amount)
      .then((tx) => (tx ? [tx] : []));
  }
  if (network === 'trc20') {
    if (currency === 'USDT') {
      return getTrc20TokenTransfers(invoice.payment_address, USDT_TRON_CONTRACT);
    }
    return findTrc20DepositByAddress(invoice.payment_address, invoice.amount)
      .then((tx) => (tx ? [tx] : []));
  }
  return [];
}

async function trackTransaction(network, txHash) {
  const target = network && network.toLowerCase();
  if (target === 'bep20' || target === 'bsc') {
    return trackBep20Transaction(txHash);
  }
  if (target === 'trc20' || target === 'tron') {
    return trackTrc20Transaction(txHash);
  }
  throw new Error('Unsupported network; use bep20 or trc20');
}

module.exports = {
  createWallet,
  trackTransaction,
  checkAddressBalance,
  getUsdtBalance,
  getInvoicePayments,
  web3,
  tronWeb,
  sendToken,
  sendBnb,
  normalizePrivateKey,
}
