const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { open } = require('../src/db');
const store = require('../src/store');
const evidence = require('../src/evidence');
const backup = require('../src/backup');

const tempDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pg-backup-')), 'data.db');
const backupSettings = value => ({ ...value, scheduleConsent: null });

test('backup round-trip preserves archived campaigns, evidence, status history, and settings', () => {
  const source = open(tempDb());
  const settings = { minReward: 2, approvedDomains: ['example.com'], feeds: [], intervalMinutes: 60, scheduleConsent: 'old-consent' };
  const campaign = store.addCampaign(source, {
    name: 'Archived test campaign',
    sourceUrl: 'https://example.com/campaign',
    network: 'ton-testnet'
  }, settings);
  source.prepare('UPDATE reward_campaigns SET archived=1 WHERE id=?').run(campaign.id);
  const content = 'No payment is required.';
  source.prepare(`INSERT INTO campaign_evidence(campaign_id,url,fetched_at,content_hash,note,content)
    VALUES(?,?,?,?,?,?)`).run(campaign.id, 'https://example.com/terms', '2026-10-01T00:00:00.000Z',
    evidence.contentHash(content), 'Imported test evidence', content);
  const exported = backup.makeBackup(source, settings, '0.1.0', '2026-10-02T00:00:00.000Z');
  const destination = open(tempDb());
  const result = backup.importBackup(destination, JSON.parse(JSON.stringify(exported)), backupSettings);
  const imported = store.list(destination, true);
  assert.equal(result.importedCount, 1);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].archived, 1);
  assert.equal(destination.prepare('SELECT content FROM campaign_evidence').get().content, content);
  assert.deepEqual(destination.prepare('SELECT to_status,reason,ts FROM status_history ORDER BY id').all(),
    source.prepare('SELECT to_status,reason,ts FROM status_history ORDER BY id').all());
  assert.equal(JSON.parse(destination.prepare("SELECT value FROM settings WHERE key='app'").get().value).minReward, 2);
  assert.equal(JSON.parse(destination.prepare("SELECT value FROM settings WHERE key='app'").get().value).scheduleConsent, null);

  const repeated = backup.importBackup(destination, exported, backupSettings);
  assert.equal(repeated.importedCount, 0);
  assert.equal(repeated.evidenceImported, 0);
  assert.equal(destination.prepare('SELECT COUNT(*) count FROM campaign_evidence').get().count, 1);
  assert.equal(destination.prepare('SELECT COUNT(*) count FROM status_history').get().count,
    source.prepare('SELECT COUNT(*) count FROM status_history').get().count);
  source.close();
  destination.close();
});

test('invalid backup is rejected before campaign writes', () => {
  const db = open(tempDb());
  const invalid = {
    campaigns: [{ id: 1, name: '', status: 'UNVERIFIED', last_checked: 'now' }],
    evidence: [],
    statusHistory: []
  };
  assert.throws(() => backup.importBackup(db, invalid, backupSettings), /invalid backup campaign/);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM reward_campaigns').get().count, 0);
  db.close();
});

test('backup rejects evidence whose content hash does not match', () => {
  const db = open(tempDb());
  const invalid = {
    campaigns: [{ id: 1, name: 'Test', source_url: 'https://example.com/c', status: 'UNVERIFIED', last_checked: 'now' }],
    evidence: [{ id: 1, campaign_id: 1, url: 'https://example.com/terms', fetched_at: 'now', content_hash: '0'.repeat(64), content: 'changed' }],
    statusHistory: []
  };
  assert.throws(() => backup.importBackup(db, invalid, backupSettings), /hash does not match/);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM reward_campaigns').get().count, 0);
  db.close();
});
