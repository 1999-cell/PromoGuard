'use strict';

const { PAYMENT_FLAGS } = require('./policy');
const { STATUSES } = require('./status');
const { dedupeKey } = require('./discovery');
const { contentHash, normalizeSnapshotUrl } = require('./evidence');
const store = require('./store');

const FLAG_COLUMNS = Object.fromEntries(PAYMENT_FLAGS.map(flag => [flag, flag.replace(/[A-Z]/g, c => '_' + c.toLowerCase())]));
const MAX_CAMPAIGNS = 100_000;
const MAX_HISTORY_ROWS = 1_000_000;
const MAX_EVIDENCE_ROWS = 100_000;
const text = (value, label, max, nullable = true) => {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw new Error(`backup ${label} is invalid`);
  }
  if (typeof value !== 'string' || value.length > max) throw new Error(`backup ${label} is invalid`);
  return value;
};
const validId = value => Number.isSafeInteger(value) && value > 0;
const optionalStatus = value => value === null || value === undefined || STATUSES.includes(value);

function makeBackup(db, settings, version, exportedAt = new Date().toISOString()) {
  const campaigns = store.list(db, true).map(row => {
    const campaign = { ...row };
    delete campaign.history;
    delete campaign.evidence_count;
    delete campaign.latest_evidence_hash;
    delete campaign.latest_evidence_at;
    return campaign;
  });
  return {
    format: 'promoguard-backup',
    schemaVersion: 1,
    exportedAt,
    version,
    settings: { ...settings, scheduleConsent: null },
    campaigns,
    evidence: db.prepare('SELECT * FROM campaign_evidence ORDER BY id').all(),
    statusHistory: db.prepare('SELECT * FROM status_history ORDER BY id').all()
  };
}

function validateBackup(payload, validateSettings = value => value) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.campaigns) ||
      payload.campaigns.length > MAX_CAMPAIGNS) throw new Error('invalid backup structure');
  const campaignsById = new Map();
  const campaigns = payload.campaigns.map(campaign => {
    if (!campaign || typeof campaign !== 'object' || Array.isArray(campaign) || !validId(campaign.id) ||
        campaignsById.has(campaign.id) || typeof campaign.name !== 'string' || !campaign.name.trim() ||
        campaign.name.length > 200 || !STATUSES.includes(campaign.status) || !optionalStatus(campaign.status) ||
        (campaign.reward_amount !== null && campaign.reward_amount !== undefined &&
          (typeof campaign.reward_amount !== 'number' || !Number.isFinite(campaign.reward_amount) || campaign.reward_amount < 0)) ||
        ![undefined, null, false, true, 0, 1].includes(campaign.archived)) {
      throw new Error('invalid backup campaign');
    }
    const normalized = {
      id: campaign.id,
      name: campaign.name.trim(),
      publisher: text(campaign.publisher, 'publisher', 500),
      source_url: text(campaign.source_url, 'campaign source URL', 2048),
      network: text(campaign.network, 'network', 100),
      token_id: text(campaign.token_id, 'token ID', 300),
      reward_amount: campaign.reward_amount ?? null,
      end_date: text(campaign.end_date, 'end date', 64),
      status: campaign.status,
      reasons: text(campaign.reasons, 'reasons', 10_000),
      evidence: text(campaign.evidence, 'evidence URL', 2048),
      last_checked: text(campaign.last_checked, 'last checked timestamp', 64, false),
      dedupe_key: dedupeKey(campaign.source_url || ''),
      review_note: text(campaign.review_note, 'review note', 2000),
      archived: campaign.archived === true || campaign.archived === 1 ? 1 : 0
    };
    for (const flag of PAYMENT_FLAGS) {
      const value = campaign[flag] ?? campaign[FLAG_COLUMNS[flag]];
      if (![undefined, null, false, true, 0, 1].includes(value)) throw new Error(`invalid backup campaign flag: ${flag}`);
      normalized[FLAG_COLUMNS[flag]] = value === true || value === 1 ? 1 : value === false || value === 0 ? 0 : null;
    }
    campaignsById.set(campaign.id, normalized);
    return normalized;
  });

  const evidenceRows = payload.evidence === undefined ? [] : payload.evidence;
  if (!Array.isArray(evidenceRows) || evidenceRows.length > MAX_EVIDENCE_ROWS) throw new Error('invalid backup evidence');
  const evidenceIds = new Set();
  const evidence = evidenceRows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !validId(row.id) || evidenceIds.has(row.id) ||
        !campaignsById.has(row.campaign_id) || typeof row.fetched_at !== 'string' || row.fetched_at.length > 64 ||
        typeof row.content_hash !== 'string' || !/^[a-f0-9]{64}$/i.test(row.content_hash)) {
      throw new Error('invalid backup evidence row');
    }
    evidenceIds.add(row.id);
    const url = normalizeSnapshotUrl(row.url);
    const content = row.content === null || row.content === undefined ? null : text(row.content, 'evidence content', 100_000, false);
    if (content !== null && contentHash(content) !== row.content_hash.toLowerCase()) throw new Error('backup evidence hash does not match its content');
    return {
      id: row.id,
      campaign_id: row.campaign_id,
      url,
      fetched_at: row.fetched_at,
      content_hash: row.content_hash.toLowerCase(),
      note: text(row.note, 'evidence note', 2000),
      content
    };
  });

  const historyRows = payload.statusHistory === undefined ? payload.snapshots : payload.statusHistory;
  const statusHistory = historyRows === undefined ? [] : historyRows;
  if (!Array.isArray(statusHistory) || statusHistory.length > MAX_HISTORY_ROWS) throw new Error('invalid backup status history');
  const historyIds = new Set();
  const history = statusHistory.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !validId(row.id) || historyIds.has(row.id) ||
        !campaignsById.has(row.campaign_id) || !optionalStatus(row.from_status) ||
        !STATUSES.includes(row.to_status) || typeof row.ts !== 'string' || row.ts.length > 64) {
      throw new Error('invalid backup status history row');
    }
    historyIds.add(row.id);
    return {
      id: row.id,
      campaign_id: row.campaign_id,
      from_status: row.from_status ?? null,
      to_status: row.to_status,
      reason: text(row.reason, 'history reason', 5000),
      ts: row.ts
    };
  });

  const settings = Object.hasOwn(payload, 'settings') ? validateSettings(payload.settings) : null;
  return { campaigns, evidence, statusHistory: history, settings };
}

function importBackup(db, payload, validateSettings) {
  const backup = validateBackup(payload, validateSettings);
  const idMap = new Map();
  let importedCount = 0;
  let skippedCount = 0;
  let evidenceImported = 0;
  let historyImported = 0;
  const campaignColumns = ['name', 'publisher', 'source_url', 'network', 'token_id', 'reward_amount', 'end_date', 'status',
    'reasons', 'evidence', 'last_checked', 'dedupe_key', 'review_note', 'archived', ...PAYMENT_FLAGS.map(flag => FLAG_COLUMNS[flag])];

  db.transaction(() => {
    for (const campaign of backup.campaigns) {
      if (!campaign.dedupe_key) {
        skippedCount++;
        continue;
      }
      const existing = db.prepare('SELECT id FROM reward_campaigns WHERE dedupe_key=?').get(campaign.dedupe_key);
      if (existing) {
        idMap.set(campaign.id, Number(existing.id));
        skippedCount++;
        continue;
      }
      const columns = campaignColumns.join(',');
      const placeholders = campaignColumns.map(() => '?').join(',');
      const result = db.prepare(`INSERT INTO reward_campaigns(${columns}) VALUES(${placeholders})`)
        .run(...campaignColumns.map(column => campaign[column]));
      idMap.set(campaign.id, Number(result.lastInsertRowid));
      importedCount++;
    }

    for (const row of backup.evidence) {
      const campaignId = idMap.get(row.campaign_id);
      if (!campaignId) continue;
      const exists = db.prepare('SELECT 1 FROM campaign_evidence WHERE campaign_id=? AND url=? AND content_hash=?').get(campaignId, row.url, row.content_hash);
      if (exists) continue;
      db.prepare(`INSERT INTO campaign_evidence(campaign_id,url,fetched_at,content_hash,note,content)
        VALUES(?,?,?,?,?,?)`).run(campaignId, row.url, row.fetched_at, row.content_hash, row.note, row.content);
      evidenceImported++;
    }

    const historyByCampaign = new Set();
    for (const row of backup.statusHistory) {
      const campaignId = idMap.get(row.campaign_id);
      if (!campaignId) continue;
      historyByCampaign.add(row.campaign_id);
      const exists = db.prepare(`SELECT 1 FROM status_history WHERE campaign_id=? AND from_status IS ?
        AND to_status=? AND reason IS ? AND ts=?`).get(campaignId, row.from_status, row.to_status, row.reason, row.ts);
      if (exists) continue;
      db.prepare(`INSERT INTO status_history(campaign_id,from_status,to_status,reason,ts)
        VALUES(?,?,?,?,?)`).run(campaignId, row.from_status, row.to_status, row.reason, row.ts);
      historyImported++;
    }

    for (const campaign of backup.campaigns) {
      const campaignId = idMap.get(campaign.id);
      if (!campaignId || historyByCampaign.has(campaign.id)) continue;
      const exists = db.prepare('SELECT 1 FROM status_history WHERE campaign_id=? LIMIT 1').get(campaignId);
      if (!exists) {
        db.prepare(`INSERT INTO status_history(campaign_id,from_status,to_status,reason,ts)
          VALUES(?,?,?,?,?)`).run(campaignId, null, campaign.status, 'imported from backup', campaign.last_checked);
        historyImported++;
      }
    }

    if (backup.settings) db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('app',?)")
      .run(JSON.stringify({ ...backup.settings, scheduleConsent: null }));
  })();

  return { importedCount, skippedCount, evidenceImported, historyImported, settingsImported: !!backup.settings };
}

module.exports = { makeBackup, validateBackup, importBackup };
