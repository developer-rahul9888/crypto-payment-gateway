const { createWallet, trackTransaction, sendToken, sendBnb } = require('../services/blockchainService');

async function createWalletHandler(req, res, next) {
  try {
    const { network } = req.body;
    if (!network) {
      return res.status(400).json({ error: 'network is required (bep20 or trc20)' });
    }

    const wallet = await createWallet(network);
    return res.status(201).json({ wallet });
  } catch (error) {
    next(error);
  }
}

async function trackTransactionHandler(req, res, next) {
  try {
    const { network, tx_hash } = req.body;
    if (!network || !tx_hash) {
      return res.status(400).json({ error: 'network and tx_hash are required' });
    }

    const result = await trackTransaction(network, tx_hash);
    if (!result) {
      return res.status(404).json({ error: 'Transaction not found or unsupported' });
    }

    return res.json({ transaction: result });
  } catch (error) {
    next(error);
  }
}

async function sendTokenHandler(req, res, next) {
  try {
    const { network, from_private_key, to_address, amount, token_contract } = req.body;
    if (!network || !from_private_key || !to_address || !amount) {
      return res.status(400).json({ error: 'network, from_private_key, to_address, and amount are required' });
    }

    const result = await sendToken(network, from_private_key, to_address, amount, token_contract);
    return res.status(200).json({ result });
  } catch (error) {
    next(error);
  }
}

async function sendBnbHandler(req, res, next) {
  try {
    const { from_private_key, to_address, amount } = req.body;
    if (!from_private_key || !to_address || !amount) {
      return res.status(400).json({ error: 'from_private_key, to_address, and amount are required' });
    }

    const result = await sendBnb(from_private_key, to_address, amount);
    return res.status(200).json({ result });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createWalletHandler,
  trackTransactionHandler,
  sendTokenHandler,
  sendBnbHandler,
};
