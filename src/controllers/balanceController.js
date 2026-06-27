const { getUsdtBalance } = require('../services/blockchainService');

async function getUsdtBalanceHandler(req, res, next) {
  try {
    const { address, network } = req.query;
    if (!address || !network) {
      return res.status(400).json({ error: 'address and network are required' });
    }

    const balance = await getUsdtBalance(address, network);
    return res.json({ address, network, usdt_balance: balance });
  } catch (error) {
    next(error);
  }
}

module.exports = { getUsdtBalanceHandler };
