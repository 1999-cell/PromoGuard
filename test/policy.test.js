const test = require('node:test'), assert = require('node:assert');
const { evaluateCampaign, checkUrl, tokenKey } = require('../src/policy');
const S = { minReward: 0.01, approvedDomains: ['ton.org'] };
const free = { name:'Learn', sourceUrl:'https://ton.org/x', tokenId:'ton:native', rewardAmount:0.05,
  requiresDeposit:false, requiresGas:false, requiresPurchase:false, requiresStaking:false, requiresPaidMint:false,
  requiresSendingFunds:false, requiresUnlimitedApproval:false, requestsSeedPhrase:false, unclearSignature:false, unverifiedSite:false };
test('verified free campaign is eligible', () => assert.equal(evaluateCampaign(free, S).status, 'eligible'));
test('gas requirement is rejected', () => assert.equal(evaluateCampaign({ ...free, requiresGas:true }, S).status, 'rejected'));
test('unknown payment status is unverified', () => { const c = { ...free }; delete c.requiresGas; assert.equal(evaluateCampaign(c, S).status, 'unverified'); });
test('below minimum rejected', () => assert.equal(evaluateCampaign({ ...free, rewardAmount:0.001 }, S).status, 'rejected'));
test('expired', () => assert.equal(evaluateCampaign({ ...free, endDate:'2020-01-01' }, S).status, 'expired'));
test('date-only campaign remains active through its stated final day', () => {
  assert.equal(evaluateCampaign({ ...free, endDate: '2026-10-26' }, S, new Date('2026-10-26T15:32:00Z')).status, 'eligible');
  assert.equal(evaluateCampaign({ ...free, endDate: '2026-10-25' }, S, new Date('2026-10-26T00:00:00Z')).status, 'expired');
});
test('invalid end dates remain unverified, and zero reward is not eligible', () => {
  assert.equal(evaluateCampaign({ ...free, endDate: 'not-a-date' }, S).status, 'unverified');
  assert.equal(evaluateCampaign({ ...free, rewardAmount: 0 }, { ...S, minReward: 0 }).status, 'rejected');
});
test('seed phrase text rejected', () => assert.equal(evaluateCampaign({ ...free, description:'enter your seed phrase' }, S).status, 'rejected'));
test('bad domains flagged', () => {
  assert.ok(checkUrl('https://ton.org.evil.com', ['ton.org']).flags.includes('domain_not_approved'));
  assert.ok(checkUrl('http://ton.org', ['ton.org']).flags.includes('not_https'));
  assert.ok(checkUrl('https://xn--tn-xyz.org', ['ton.org']).flags.includes('punycode_lookalike'));
  assert.ok(checkUrl('not a url').flags.includes('malformed_url'));
});
test('token identity ignores symbol', () => assert.notEqual(tokenKey('eip155:1','0xA'), tokenKey('eip155:56','0xA')));
