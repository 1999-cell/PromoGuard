const test = require('node:test'), assert = require('node:assert');
const s = require('../src/claims/scanner');
test('scanIncoming filters incoming and min amount', () => {
  const txs = [
    { direction: 'in', amount: '5', to: 'A', chain: 'ton' },
    { direction: 'out', amount: '10', to: 'B' },
    { direction: 'in', amount: '0.5', to: 'C' }
  ];
  const out = s.scanIncoming(txs, { minAmount: 1 });
  assert.equal(out.length, 1);
  assert.equal(out[0].amount, '5');
});
test('scanIncoming empty', () => assert.deepEqual(s.scanIncoming([]), []));
