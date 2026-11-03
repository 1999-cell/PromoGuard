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

test('offline edits return a new unverified bundle and preserve imported evidence unchanged', () => {
  const imported = fixture();
  imported.resources.campaigns[0].status = 'ELIGIBLE_FOR_REVIEW';
  imported.resources.campaigns[0].reasons = ['desktop_review_passed'];
  imported.resources.evidence.push({
    id: 1, campaignId: 1, url: 'https://example.test/terms', fetchedAt: '2026-11-03T00:00:00.000Z',
    contentHash: 'b'.repeat(64), note: 'saved snapshot', content: 'Terms content'
  });
  const original = JSON.parse(JSON.stringify(imported));
  const edited = require('../web/bundle').editedBundle(imported, 1, {
    name: 'Updated local name', publisher: 'Local note', network: 'ton-testnet',
    tokenId: 'ton-testnet:native', rewardAmount: 4, endDate: '2027-01-31', archived: true
  }, '2026-11-03T01:00:00.000Z');

  assert.notStrictEqual(edited, imported);
  assert.deepEqual(imported, original);
  assert.deepEqual(edited.resources.evidence, original.resources.evidence);
  assert.equal(edited.resources.campaigns[0].status, 'UNVERIFIED');
  assert.deepEqual(edited.resources.campaigns[0].reasons, ['desktop_review_passed', 'Offline companion edit; desktop review required.']);
  assert.deepEqual(edited.resources.statusHistory.at(-1), {
    id: 1, campaignId: 1, fromStatus: 'ELIGIBLE_FOR_REVIEW', toStatus: 'UNVERIFIED',
    reason: 'Offline companion edit; desktop review required.', occurredAt: '2026-11-03T01:00:00.000Z'
  });
  assert.equal(edited.resources.campaigns[0].name, 'Updated local name');
  assert.equal(validateBundle(JSON.stringify(edited)).resources.campaigns[0].status, 'UNVERIFIED');
});

test('offline edit API cannot set status, payment assertions, evidence, hashes, or invalid values', () => {
  const { editedBundle } = require('../web/bundle');
  const imported = fixture();
  for (const changes of [
    { status: 'ELIGIBLE_FOR_REVIEW' },
    { status: 'REWARD_RECEIVED' },
    { requiresGas: false },
    { evidenceUrl: 'https://attacker.example/' },
    { contentHash: '0'.repeat(64) },
    { name: '' },
    { rewardAmount: -1 },
    { rewardAmount: Infinity },
    { endDate: '2026-02-31' },
    { archived: 'true' }
  ]) {
    assert.throws(() => editedBundle(imported, 1, changes, '2026-11-03T01:00:00.000Z'));
  }
});
