const test = require('node:test');
const assert = require('node:assert');
const { validateBundle, MAX_BUNDLE_BYTES, createdDraftBundle } = require('../web/bundle');

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
  resources: { campaigns: [JSON.parse(JSON.stringify(campaign))], evidence: [], statusHistory: [] }
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

test('local draft creation validates fields, allocates collision-free IDs, and keeps policy/evidence conservative', () => {
  const imported = fixture();
  imported.resources.campaigns.push({ ...campaign, id: 2, name: 'Existing second campaign' });
  imported.resources.evidence.push({
    id: 1, campaignId: 1, url: 'https://example.test/terms', fetchedAt: '2026-11-03T00:00:00.000Z',
    contentHash: 'd'.repeat(64), note: 'existing evidence', content: 'unchanged'
  });
  imported.resources.statusHistory.push({
    id: 1, campaignId: 1, fromStatus: null, toStatus: 'UNVERIFIED',
    reason: 'Existing history', occurredAt: '2026-11-03T00:00:00.000Z'
  });
  const before = JSON.parse(JSON.stringify(imported));
  const createdAt = '2026-11-03T02:00:00.000Z';
  const result = createdDraftBundle(imported, {
    name: '  Local draft  ', publisher: 'Publisher', network: 'testnet',
    tokenId: null, rewardAmount: 0, endDate: '2027-01-31'
  }, createdAt);
  const draft = result.resources.campaigns.find(item => item.id === 3);

  assert.deepEqual(imported, before);
  assert.ok(draft);
  assert.equal(draft.name, 'Local draft');
  assert.equal(draft.status, 'UNVERIFIED');
  assert.equal(draft.archived, false);
  assert.equal(draft.sourceUrl, null);
  assert.equal(draft.evidenceUrl, null);
  assert.equal(draft.lastChecked, null);
  assert.ok(Object.keys(draft).filter(key => key.startsWith('requires') || key === 'requestsSeedPhrase' || key === 'unclearSignature' || key === 'unverifiedSite')
    .every(key => draft[key] === null));
  assert.deepEqual(result.resources.evidence, before.resources.evidence);
  assert.deepEqual(result.resources.statusHistory.at(-1), {
    id: 2, campaignId: 3, fromStatus: null, toStatus: 'UNVERIFIED',
    reason: 'Created in offline companion; desktop review required. This draft is not evidence of eligibility or payment.',
    occurredAt: createdAt
  });
  assert.match(draft.reasons[0], /desktop review required/i);
  assert.match(draft.reviewNote, /review in PromoGuard desktop/i);
  assert.deepEqual(validateBundle(JSON.stringify(result)), result);
});

test('local draft creation rejects invalid and trust-asserting inputs without changing the source bundle', () => {
  const { createdDraftBundle } = require('../web/bundle');
  const imported = fixture();
  const original = JSON.parse(JSON.stringify(imported));
  const validDraft = {
    name: 'New campaign', publisher: null, network: null, tokenId: null, rewardAmount: null, endDate: null
  };
  const invalidDrafts = [
    { ...validDraft, name: '   ' },
    { ...validDraft, name: 'x'.repeat(201) },
    { ...validDraft, rewardAmount: -1 },
    { ...validDraft, rewardAmount: Infinity },
    { ...validDraft, rewardAmount: '5' },
    { ...validDraft, endDate: '2026-02-31' },
    { ...validDraft, endDate: 'not-a-date' },
    { ...validDraft, requiresGas: false },
    { ...validDraft, status: 'REWARD_RECEIVED' },
    { ...validDraft, evidence: [{ contentHash: '0'.repeat(64) }] }
  ];
  for (const draft of invalidDrafts) {
    assert.throws(() => createdDraftBundle(imported, draft, '2026-11-03T02:00:00.000Z'));
    assert.deepEqual(imported, original);
  }
  assert.throws(() => createdDraftBundle(imported, validDraft, 'not-a-timestamp'));
  assert.deepEqual(imported, original);
});
