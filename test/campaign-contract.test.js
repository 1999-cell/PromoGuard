const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { open } = require('../src/db');
const store = require('../src/store');
const contract = require('../src/campaign-contract');
const { PAYMENT_FLAGS } = require('../src/policy');
const { contentHash } = require('../src/evidence');

test('offline bundle exposes versioned read-only campaign, evidence, and history resources', () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pg-contract-')), 'data.db');
  const db = open(dbPath);
  const flags = Object.fromEntries(PAYMENT_FLAGS.map(flag => [flag, false]));
  const campaign = store.addCampaign(db, {
    name: 'Contract test',
    sourceUrl: 'https://example.com/campaign',
    evidenceUrl: 'https://example.com/terms',
    ...flags
  }, { minReward: 0.01, approvedDomains: ['example.com'] });
  db.prepare('UPDATE reward_campaigns SET archived=1 WHERE id=?').run(campaign.id);
  db.prepare(`INSERT INTO campaign_evidence(campaign_id,url,fetched_at,content_hash,note,content)
    VALUES(?,?,?,?,?,?)`).run(campaign.id, 'https://example.com/terms', '2026-11-01T00:00:00.000Z',
    contentHash('Terms body'), 'User-supplied snapshot', 'Terms body');

  const bundle = contract.makeOfflineBundle(db, '2026-11-02T00:00:00.000Z');
  assert.equal(bundle.format, 'promoguard.web-readonly');
  assert.equal(bundle.contractVersion, 1);
  assert.equal(bundle.readOnly, true);
  assert.deepEqual(Object.keys(bundle.resources).sort(), ['campaigns', 'evidence', 'statusHistory']);
  assert.equal(bundle.resources.campaigns[0].archived, true);
  assert.equal(bundle.resources.campaigns[0].requiresGas, false);
  assert.equal(bundle.resources.campaigns[0].sourceUrl, 'https://example.com/campaign');
  assert.equal(bundle.resources.evidence[0].content, 'Terms body');
  assert.equal(bundle.resources.statusHistory[0].toStatus, 'DISCOVERED');
  assert.equal(JSON.stringify(bundle).includes('approvedDomains'), false);
  assert.equal(JSON.stringify(bundle).includes('wallet'), false);
  assert.deepEqual(contract.API_PATHS, {
    campaigns: '/api/v1/campaigns',
    campaign: '/api/v1/campaigns/{campaignId}',
    evidence: '/api/v1/campaigns/{campaignId}/evidence',
    history: '/api/v1/campaigns/{campaignId}/status-history'
  });
  db.close();
});

test('campaign contract rejects corrupt stored reason JSON instead of emitting a lossy record', () => {
  assert.throws(() => contract.campaignDto({ id: 1, name: 'Broken', reasons: '{' }), /reasons are invalid/);
});
