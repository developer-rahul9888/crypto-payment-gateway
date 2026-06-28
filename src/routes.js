const express = require('express');
const {
  createInvoice,
  getInvoice,
  finishTransaction,
  getTransaction,
  trackInvoicePayment,
  trackInvoiceByAddress,
  sweepBnbFromInvoiceWallets,
  sweepUsdtFromInvoiceWallets,
  fundInvoiceGasWithAdminBnb,
} = require('./controllers/invoiceController');
const {
  createWalletHandler,
  trackTransactionHandler,
  sendTokenHandler,
  sendBnbHandler,
} = require('./controllers/walletController');
const { getUsdtBalanceHandler } = require('./controllers/balanceController');

const router = express.Router();

router.post('/invoice', createInvoice);
router.get('/invoice/:id', getInvoice);
router.post('/invoice/track', trackInvoicePayment);
router.post('/invoice/track/address', trackInvoiceByAddress);
router.post('/invoice/sweep-bnb', sweepBnbFromInvoiceWallets);
router.post('/invoice/sweep-usdt', sweepUsdtFromInvoiceWallets);
router.post('/invoice/fund-gas', fundInvoiceGasWithAdminBnb);
router.post('/transaction/finish', finishTransaction);
router.get('/transaction/:id', getTransaction);

router.post('/wallet', createWalletHandler);
router.post('/wallet/track', trackTransactionHandler);
router.post('/token/send', sendTokenHandler);
router.post('/bnb/send', sendBnbHandler);
router.get('/balance/usdt', getUsdtBalanceHandler);

module.exports = router;
