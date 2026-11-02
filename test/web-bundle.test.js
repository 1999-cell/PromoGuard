const test = require('node:test');
const assert = require('node:assert');
const { validateBundle, MAX_BUNDLE_BYTES } = require('../web/bundle');

const campaign = {
  id: 1,
  name: '<img src=x onerror=alert(1)>',
  publisher: null,
  sourceUrl: null,
  network: null,
  tokenId: null,
  rewardAmount: null,
  endDate: null,
  status: 'UNVERIFIED',
  archived: false,
  reasons: [],
  evidenceUrl: null,
  lastChecked: '2026-11-03T00:00:00.000Z',
  reviewNote: null,
  ...Object.fromEntries([
    'requiresDeposit', 'requiresGas', 'requiresPurchase', 'requiresStaking', 'requiresPaidMint',
    'requiresSendingFunds', 'requiresUnlimitedApproval', 'requestsSeedPhrase', 'unclearSignature', 'unverifiedSite'
  ].map(flag => [flag, null]))
};
const fixture = () => ({
  format: 'promoguard.web-readonly',
  contractVersion: 1,
  exportedAt: '2026-11-03T00:00:00.000Z',
  readOnly: true,
  resources: { campaigns: [campaign], evidence: [], statusHistory: [] }
});

test('web bundle parser accepts valid JSON and contract objects', () => {
  const bundle = fixture();
  assert.deepEqual(validateBundle(JSON.stringify(bundle)), bundle);
  assert.equal(validateBundle(bundle).resources.campaigns[0].name, campaign.name);
});

test('web bundle parser rejects unsupported versions and mutation-shaped data', () => {
  const badVersion = fixture();
  badVersion.contractVersion = 2;
  assert.throws(() => validateBundle(badVersion), /not a supported/);
  const hasWrites = fixture();
  hasWrites.resources.updateCampaign = {};
  assert.throws(() => validateBundle(hasWrites), /not a supported/);
});

test('web bundle parser checks relationships, statuses, and required unknown flags', () => {
  const badEvidence = fixture();
  badEvidence.resources.evidence.push({
    id: 1, campaignId: 99, url: 'https://example.com', fetchedAt: 'now', contentHash: 'a'.repeat(64), content: null
  });
  assert.throws(() => validateBundle(badEvidence), /not a supported/);
  const missingFlag = fixture();
  delete missingFlag.resources.campaigns[0].requiresGas;
  assert.throws(() => validateBundle(missingFlag), /not a supported/);
});

test('web bundle file-size cap is bounded', () => {
  assert.equal(MAX_BUNDLE_BYTES, 10 * 1024 * 1024);
});
