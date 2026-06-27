# Crypto Payment Gateway

A simple Express.js + MySQL crypto payment gateway with invoice creation, transaction tracking, and transaction completion.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure MySQL in `.env`.
3. Create the database and tables:

```sql
CREATE DATABASE IF NOT EXISTS crypto_gateway;
USE crypto_gateway;

CREATE TABLE invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(50) NOT NULL UNIQUE,
  amount DECIMAL(18,8) NOT NULL,
  currency VARCHAR(10) NOT NULL,
  customer_email VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT NOT NULL,
  tx_hash VARCHAR(255) NOT NULL,
  network VARCHAR(50) NOT NULL,
  amount DECIMAL(18,8) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'success',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);
```

4. Start the app:

```bash
npm run dev
```

## Environment

Add these values to `.env` for blockchain support:

```bash
BSC_RPC_URL=https://bsc-dataseed.binance.org/
TRON_FULL_NODE=https://api.trongrid.io
TRON_SOLIDITY_NODE=https://api.trongrid.io
TRON_EVENT_SERVER=https://api.trongrid.io
```

## API

- `POST /api/invoice`
  - Body: `{ amount, currency, customer_email, network }`
  - Supported networks: `bep20`, `trc20`
  - Generates a payment address and private key for the invoice.
- `GET /api/invoice/:id`
- `POST /api/transaction/finish`
  - Body: `{ invoice_id, tx_hash, network, amount, status? }`
- `GET /api/transaction/:id`
- `POST /api/wallet`
  - Body: `{ network }`
  - Supported networks: `bep20`, `trc20`
- `POST /api/wallet/track`
  - Body: `{ network, tx_hash }`

## Payment watcher

The app starts a watcher after startup that scans new BSC/TRON blocks for deposits to pending invoice addresses. When a full deposit is detected, it records the transaction and completes the invoice.

## Notes

- `finishTransaction` marks the invoice as `completed` and records the transaction.
- `POST /api/wallet` creates a fresh wallet address for the selected network.
- `POST /api/wallet/track` fetches blockchain transaction details from BEP20 or TRC20.
