const { Invoice, Transaction, sequelize, AdminWallet } = require('../db');
const { Op } = require('sequelize');
const { createWallet, getInvoicePayments, checkAddressBalance, getUsdtBalance, web3, tronWeb, sendBnb, sendToken } = require('../services/blockchainService');
const { shouldProcessInvoice, normalizeNetwork } = require('../services/bnbSweepService');
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

async function sweepBnbFromInvoiceWallets(req, res, next) {
  try {
    const { to_address, amount, min_usdt_balance, network, limit } = req.body;
    const targetAddress = to_address || process.env.BNB_SWEEP_TO_ADDRESS;

    if (!targetAddress) {
      return res.status(400).json({
        error: 'to_address is required or BNB_SWEEP_TO_ADDRESS must be configured',
      });
    }

    const sweepAmount = amount || process.env.BNB_SWEEP_AMOUNT || '0.0001';
    const threshold = min_usdt_balance ?? process.env.BNB_SWEEP_MIN_USDT_BALANCE ?? 0;
    const maxInvoices = Number(limit || process.env.BNB_SWEEP_LIMIT || 50);
    const normalizedNetwork = normalizeNetwork(network);

    const invoices = await Invoice.findAll({
      where: {
        payment_private_key: { [Op.ne]: null },
        ...(normalizedNetwork ? { payment_network: normalizedNetwork } : {}),
      },
      attributes: ['id', 'payment_address', 'payment_private_key', 'payment_network'],
      order: [['id', 'ASC']],
      limit: Number.isFinite(maxInvoices) ? maxInvoices : 50,
    });

    const results = [];

    for (const invoice of invoices) {
      const result = {
        invoice_id: invoice.id,
        payment_address: invoice.payment_address,
        network: invoice.payment_network,
        usdt_balance: null,
        sent: false,
        reason: null,
      };

      try {
        if (invoice.payment_network !== 'bep20' && invoice.payment_network !== 'bsc') {
          result.reason = 'unsupported network for BNB sweep';
          results.push(result);
          continue;
        }

        const usdtBalance = await getUsdtBalance(invoice.payment_address, invoice.payment_network);
        result.usdt_balance = usdtBalance;

        if (!shouldProcessInvoice(usdtBalance, threshold)) {
          result.reason = 'usdt balance is not greater than threshold';
          results.push(result);
          continue;
        }

        const tx = await sendBnb(invoice.payment_private_key, targetAddress, sweepAmount);
        result.sent = true;
        result.tx_hash = tx && tx.tx_hash;
        result.amount = tx && tx.amount;
        result.to_address = tx && tx.to;
        results.push(result);
      } catch (error) {
        result.reason = error.message || 'sweep failed';
        results.push(result);
      }
    }

    return res.status(200).json({
      target_address: targetAddress,
      amount: sweepAmount,
      min_usdt_balance: threshold,
      processed: results.length,
      sent_count: results.filter((entry) => entry.sent).length,
      results,
    });
  } catch (error) {
    next(error);
  }
}

async function sweepUsdtFromInvoiceWallets(req, res, next) {
  try {
    const { to_address, amount, network, limit } = req.body;
    const targetAddress = to_address || process.env.USDT_SWEEP_TO_ADDRESS;

    if (!targetAddress) {
      return res.status(400).json({
        error: 'to_address is required or USDT_SWEEP_TO_ADDRESS must be configured',
      });
    }

    const sweepAmount = amount || process.env.USDT_SWEEP_AMOUNT || '1';
    const normalizedNetwork = normalizeNetwork(network);
    const maxInvoices = Number(limit || process.env.USDT_SWEEP_LIMIT || 50);

    const invoices = await Invoice.findAll({
      where: {
        payment_private_key: { [Op.ne]: null },
        ...(normalizedNetwork ? { payment_network: normalizedNetwork } : {}),
      },
      attributes: ['id', 'payment_address', 'payment_private_key', 'payment_network'],
      order: [['id', 'ASC']],
      limit: Number.isFinite(maxInvoices) ? maxInvoices : 50,
    });

    const results = [];

    for (const invoice of invoices) {
      const result = {
        invoice_id: invoice.id,
        payment_address: invoice.payment_address,
        network: invoice.payment_network,
        sent: false,
        reason: null,
      };

      try {
        const tx = await sendToken(invoice.payment_network, invoice.payment_private_key, targetAddress, sweepAmount);
        result.sent = true;
        result.tx_hash = tx && tx.tx_hash;
        result.amount = tx && tx.amount;
        result.to_address = tx && tx.to;
        results.push(result);
      } catch (error) {
        result.reason = error || 'usdt sweep failed';
        results.push(result);
      }
    }

    return res.status(200).json({
      target_address: targetAddress,
      amount: sweepAmount,
      processed: results.length,
      sent_count: results.filter((entry) => entry.sent).length,
      results,
    });
  } catch (error) {
    next(error);
  }
}

async function fundInvoiceGasWithAdminBnb(req, res, next) {
  try {
    const { invoice_id, amount, network } = req.body;

    if (!invoice_id || !amount) {
      return res.status(400).json({ error: 'invoice_id and amount are required' });
    }

    const invoice = await Invoice.findByPk(invoice_id, {
      attributes: ['id', 'payment_address', 'payment_private_key', 'payment_network'],
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const normalizedNetwork = normalizeNetwork(network || invoice.payment_network);
    const adminWallet = await AdminWallet.findOne({
      where: {
        network: normalizedNetwork,
      },
      order: [['id', 'ASC']],
    });

    if (!adminWallet) {
      return res.status(404).json({ error: 'Admin wallet not found for this network' });
    }

    const tx = await sendBnb(adminWallet.private_key, invoice.payment_address, amount);

    return res.status(200).json({
      invoice_id: invoice.id,
      network: normalizedNetwork,
      amount,
      from_admin_wallet: adminWallet.address,
      to_invoice_address: invoice.payment_address,
      tx_hash: tx && tx.tx_hash,
    });
  } catch (error) {
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
  sweepBnbFromInvoiceWallets,
  sweepUsdtFromInvoiceWallets,
  fundInvoiceGasWithAdminBnb,
  getTransaction,
};
