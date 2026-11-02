'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { open } = require('../src/db');
const store = require('../src/store');
const evidence = require('../src/evidence');

const settings = { minReward: 0.01, approvedDomains: ['ton.org'] };
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pg-evidence-')), 'test.db');
const addReviewCampaign = db => {
  const { id } = store.addCampaign(db, { name: 'Example', sourceUrl: 'https://ton.org/campaign' }, settings, 'discovery');
  store.startReview(db, id);
  return id;
};

test('terms snapshots require an active campaign review and safe public HTTPS URL', () => {
  const db = open(tmp());
  const { id } = store.addCampaign(db, { name: 'Example', sourceUrl: 'https://ton.org/campaign' }, settings, 'discovery');
  assert.throws(() => evidence.saveSnapshot(db, { campaignId: id, url: 'https://ton.org/terms', content: 'Terms' }), /start a campaign review/);
  store.startReview(db, id);
  for (const url of ['http://ton.org/terms', 'https://127.0.0.1/terms', 'https://user:pass@ton.org/terms', 'https://ton.org/terms#fragment']) {
    assert.throws(() => evidence.saveSnapshot(db, { campaignId: id, url, content: 'Terms' }), /public HTTPS/);
  }
  assert.throws(() => evidence.saveSnapshot(db, { campaignId: id, url: 'https://ton.org/terms', content: '' }), /paste the official terms/);
  assert.throws(() => evidence.saveSnapshot(db, { campaignId: id, url: 'https://ton.org/terms', content: 'x'.repeat(evidence.MAX_SNAPSHOT_CHARS + 1) }), /characters or fewer/);
  db.close();
});

test('terms snapshots are retained as immutable content revisions with SHA-256 hashes', () => {
  const db = open(tmp());
  const id = addReviewCampaign(db);
  const first = evidence.saveSnapshot(db, { campaignId: id, url: 'https://ton.org/terms', content: 'Free community reward\r\nNo purchase required.' });
  assert.equal(first.contentHash, evidence.contentHash('Free community reward\nNo purchase required.'));
  assert.equal(first.duplicate, false);
  assert.equal(evidence.latestSnapshot(db, id).content, 'Free community reward\nNo purchase required.');
  const duplicate = evidence.saveSnapshot(db, { campaignId: id, url: 'https://ton.org/terms', content: 'Free community reward\nNo purchase required.' });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.id, first.id);
  assert.equal(evidence.getSnapshot(db, id, first.id).content, 'Free community reward\nNo purchase required.');
  const second = evidence.saveSnapshot(db, { campaignId: id, url: 'https://ton.org/terms', content: 'Updated terms. No purchase required.' });
  assert.notEqual(second.contentHash, first.contentHash);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM campaign_evidence WHERE campaign_id=? AND content IS NOT NULL').get(id).count, 2);
  assert.equal(evidence.listSnapshotMetadata(db, id).length, 2);
  assert.equal(evidence.getSnapshot(db, id + 1, first.id), null);
  db.close();
});

test('campaign review stays under review without a matching saved terms snapshot', () => {
  const db = open(tmp());
  const id = addReviewCampaign(db);
  const result = store.submitEvidence(db, id, {
    evidenceUrl: 'https://ton.org/terms', confirmFree: true, confirmOfficialSource: true, rewardAmount: 1, tokenId: 'ton:native'
  }, settings);
  assert.equal(result.status, 'UNDER_REVIEW');
  assert.ok(result.reasons.includes('terms_snapshot_required'));
  evidence.saveSnapshot(db, { campaignId: id, url: 'https://ton.org/other-terms', content: 'Terms text.' });
  const mismatch = store.submitEvidence(db, id, {
    evidenceUrl: 'https://ton.org/terms', confirmFree: true, confirmOfficialSource: true, rewardAmount: 1, tokenId: 'ton:native'
  }, settings);
  assert.equal(mismatch.status, 'UNDER_REVIEW');
  assert.ok(mismatch.reasons.includes('terms_snapshot_required'));
  db.close();
});

test('diffLines: identical content yields only equal ops', () => {
  const ops = evidence.diffLines('line one\nline two\nline three', 'line one\nline two\nline three');
  assert.equal(ops.length, 3);
  assert.ok(ops.every(o => o.type === 'equal'));
});

test('diffLines: added lines are flagged', () => {
  const ops = evidence.diffLines('a\nb', 'a\nc\nb');
  const added = ops.filter(o => o.type === 'added');
  assert.equal(added.length, 1);
  assert.equal(added[0].line, 'c');
});

test('diffLines: removed lines are flagged', () => {
  const ops = evidence.diffLines('a\nb\nc', 'a\nc');
  const removed = ops.filter(o => o.type === 'removed');
  assert.equal(removed.length, 1);
  assert.equal(removed[0].line, 'b');
});

test('compareSnapshots: returns diff with summary', () => {
  const db = open(tmp());
  const id = addReviewCampaign(db);
  const s1 = evidence.saveSnapshot(db, { campaignId: id, url: 'https://ton.org/terms', content: 'Free reward\nNo deposit\nNo gas' });
  const s2 = evidence.saveSnapshot(db, { campaignId: id, url: 'https://ton.org/terms', content: 'Free reward\nNo deposit required\nNo gas\nLimited time' });
  const cmp = evidence.compareSnapshots(db, id, s1.id, s2.id);
  assert.equal(cmp.snapshotA.id, s1.id);
  assert.equal(cmp.snapshotB.id, s2.id);
  assert.ok(cmp.changed);
  assert.equal(cmp.summary.added, 2);
  assert.equal(cmp.summary.removed, 1);
  assert.ok(cmp.diff.some(o => o.type === 'added' && o.line === 'Limited time'));
  assert.ok(cmp.diff.some(o => o.type === 'added' && o.line === 'No deposit required'));
  db.close();
});

test('compareSnapshots: identical snapshots report no change', () => {
  const db = open(tmp());
  const id = addReviewCampaign(db);
  const s1 = evidence.saveSnapshot(db, { campaignId: id, url: 'https://ton.org/terms', content: 'Same terms text' });
  const s2 = evidence.saveSnapshot(db, { campaignId: id, url: 'https://ton.org/terms', content: 'Same terms text' });
  const cmp = evidence.compareSnapshots(db, id, s1.id, s2.id);
  assert.equal(cmp.changed, false);
  assert.equal(cmp.summary.added, 0);
  assert.equal(cmp.summary.removed, 0);
  assert.equal(cmp.summary.unchanged, 1);
  db.close();
});

test('compareSnapshots: invalid ids throw', () => {
  const db = open(tmp());
  const id = addReviewCampaign(db);
  const s1 = evidence.saveSnapshot(db, { campaignId: id, url: 'https://ton.org/terms', content: 'Test terms' });
  assert.throws(() => evidence.compareSnapshots(db, 9999, 1, 2), /snapshot A not found/);
  assert.throws(() => evidence.compareSnapshots(db, id, 9999, s1.id), /snapshot A not found/);
  assert.throws(() => evidence.compareSnapshots(db, id, s1.id, 9999), /snapshot B not found/);
  assert.throws(() => evidence.compareSnapshots(db, id, 0, s1.id), /invalid/);
  assert.throws(() => evidence.compareSnapshots(db, id, -1, s1.id), /invalid/);
  db.close();
});
