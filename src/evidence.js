'use strict';

const crypto = require('crypto');
const { isSafeFeedUrl } = require('./discovery');

const MAX_SNAPSHOT_CHARS = 100_000;

function normalizeSnapshotUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('terms URL is invalid');
  let url;
  try { url = new URL(value); } catch { throw new Error('terms URL is invalid'); }
  if (!isSafeFeedUrl(url.href) || url.hash) throw new Error('terms URL must be a public HTTPS URL without credentials or a fragment');
  return url.href;
}

function normalizeContent(value) {
  if (typeof value !== 'string') throw new Error('paste the official terms text before saving a snapshot');
  const content = value.replace(/\r\n?/g, '\n').trim();
  if (!content) throw new Error('paste the official terms text before saving a snapshot');
  if (content.length > MAX_SNAPSHOT_CHARS) throw new Error(`terms text must be ${MAX_SNAPSHOT_CHARS} characters or fewer`);
  return content;
}

function contentHash(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function latestSnapshot(db, campaignId) {
  return db.prepare(`SELECT id, campaign_id, url, fetched_at, content_hash, note, content
    FROM campaign_evidence WHERE campaign_id=? AND content IS NOT NULL ORDER BY id DESC LIMIT 1`).get(campaignId) || null;
}

function saveSnapshot(db, { campaignId, url, content }) {
  if (!Number.isSafeInteger(campaignId) || campaignId < 1) throw new Error('invalid campaign id');
  const normalizedUrl = normalizeSnapshotUrl(url);
  const normalizedContent = normalizeContent(content);
  const campaign = db.prepare('SELECT status FROM reward_campaigns WHERE id=?').get(campaignId);
  if (!campaign) throw new Error('campaign not found');
  if (campaign.status !== 'UNDER_REVIEW') throw new Error('start a campaign review before saving terms evidence');

  const hash = contentHash(normalizedContent);
  const latest = latestSnapshot(db, campaignId);
  if (latest && latest.url === normalizedUrl && latest.content_hash === hash) {
    return { id: latest.id, contentHash: hash, capturedAt: latest.fetched_at, duplicate: true };
  }
  const id = db.prepare(`INSERT INTO campaign_evidence(campaign_id,url,fetched_at,content_hash,note,content)
    VALUES(?,?,?,?,?,?)`).run(campaignId, normalizedUrl, new Date().toISOString(), hash,
    'User-pasted terms snapshot; not fetched or independently verified by PromoGuard.', normalizedContent).lastInsertRowid;
  return { id: Number(id), contentHash: hash, capturedAt: db.prepare('SELECT fetched_at FROM campaign_evidence WHERE id=?').get(id).fetched_at, duplicate: false };
}

function listSnapshotMetadata(db, campaignId) {
  if (!Number.isSafeInteger(campaignId) || campaignId < 1) throw new Error('invalid campaign id');
  return db.prepare(`SELECT id, url, fetched_at, content_hash, note
    FROM campaign_evidence WHERE campaign_id=? AND content IS NOT NULL ORDER BY id DESC`).all(campaignId);
}

function getSnapshot(db, campaignId, snapshotId) {
  if (!Number.isSafeInteger(campaignId) || campaignId < 1 || !Number.isSafeInteger(snapshotId) || snapshotId < 1) throw new Error('invalid evidence id');
  return db.prepare(`SELECT id, url, fetched_at, content_hash, content
    FROM campaign_evidence WHERE campaign_id=? AND id=? AND content IS NOT NULL`).get(campaignId, snapshotId) || null;
}

function diffLines(a, b) {
  const linesA = (a || '').split('\n'); const linesB = (b || '').split('\n');
  const m = linesA.length, n = linesB.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = linesA[i - 1] === linesB[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const ops = []; let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) { ops.unshift({ type: 'equal', line: linesA[i - 1], lineA: i - 1, lineB: j - 1 }); i--; j--; }
    else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { ops.unshift({ type: 'added', line: linesB[j - 1], lineB: j - 1 }); j--; }
    else { ops.unshift({ type: 'removed', line: linesA[i - 1], lineA: i - 1 }); i--; }
  }
  return ops;
}

function compareSnapshots(db, campaignId, snapshotIdA, snapshotIdB) {
  if (!Number.isSafeInteger(campaignId) || campaignId < 1) throw new Error('invalid campaign id');
  if (!Number.isSafeInteger(snapshotIdA) || snapshotIdA < 1) throw new Error('invalid snapshot id A');
  if (!Number.isSafeInteger(snapshotIdB) || snapshotIdB < 1) throw new Error('invalid snapshot id B');
  const snapA = getSnapshot(db, campaignId, snapshotIdA);
  const snapB = getSnapshot(db, campaignId, snapshotIdB);
  if (!snapA) throw new Error('snapshot A not found');
  if (!snapB) throw new Error('snapshot B not found');
  const ops = diffLines(snapA.content, snapB.content);
  const added = ops.filter(o => o.type === 'added').length;
  const removed = ops.filter(o => o.type === 'removed').length;
  const unchanged = ops.filter(o => o.type === 'equal').length;
  return {
    campaignId,
    snapshotA: { id: snapA.id, url: snapA.url, fetchedAt: snapA.fetched_at, contentHash: snapA.content_hash },
    snapshotB: { id: snapB.id, url: snapB.url, fetchedAt: snapB.fetched_at, contentHash: snapB.content_hash },
    diff: ops,
    summary: { added, removed, unchanged, total: ops.length },
    changed: added > 0 || removed > 0
  };
}

module.exports = { MAX_SNAPSHOT_CHARS, normalizeSnapshotUrl, normalizeContent, contentHash, latestSnapshot, saveSnapshot, listSnapshotMetadata, getSnapshot, diffLines, compareSnapshots };
