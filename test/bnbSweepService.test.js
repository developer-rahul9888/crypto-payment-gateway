const assert = require('assert');
const { shouldProcessInvoice, normalizeNetwork } = require('../src/services/bnbSweepService');
const { normalizePrivateKey } = require('../src/services/blockchainService');

(function runTests() {
  assert.strictEqual(shouldProcessInvoice(1), true);
  assert.strictEqual(shouldProcessInvoice(0), false);
  assert.strictEqual(shouldProcessInvoice(-1), false);
  assert.strictEqual(shouldProcessInvoice('0.00000001'), true);
  assert.strictEqual(shouldProcessInvoice(0.00000001, 0.00000001), false);
  assert.strictEqual(normalizeNetwork('BSC'), 'bep20');
  assert.strictEqual(normalizeNetwork('TRON'), 'trc20');
  assert.strictEqual(normalizeNetwork('bep20'), 'bep20');
  assert.strictEqual(normalizePrivateKey('1234'), '0x1234');
  assert.strictEqual(normalizePrivateKey('0x1234'), '0x1234');
  assert.strictEqual(normalizePrivateKey(Buffer.from('1234', 'hex')), '0x1234');
  console.log('bnbSweepService tests passed');
})();
