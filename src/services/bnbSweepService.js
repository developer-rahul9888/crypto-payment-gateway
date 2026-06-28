function shouldProcessInvoice(usdtBalance, minUsdtBalance = 0) {
  const currentBalance = Number(usdtBalance || 0);
  const threshold = Number(minUsdtBalance || 0);
  return currentBalance > threshold;
}

function normalizeNetwork(network) {
  const value = String(network || '').trim().toLowerCase();
  if (value === 'bsc' || value === 'bep20') return 'bep20';
  if (value === 'tron' || value === 'trc20') return 'trc20';
  return value;
}

module.exports = {
  shouldProcessInvoice,
  normalizeNetwork,
};
