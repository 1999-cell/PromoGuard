const test = require('node:test'), assert = require('node:assert');
const u = require('../src/claims/unclaimed');
test('normalizeCandidate defaults status', () => {
  const c = u.normalizeCandidate({ sourceUrl: 'https://x.com' });
  assert.equal(c.status, 'candidate');
});
test('normalizeCandidate rejects missing sourceUrl', () => {
  assert.throws(() => u.normalizeCandidate({}), /sourceUrl required/);
});
test('isClaimable only verified', () => {
  assert.equal(u.isClaimable({ status: 'verified' }), true);
  assert.equal(u.isClaimable({ status: 'candidate' }), false);
});
