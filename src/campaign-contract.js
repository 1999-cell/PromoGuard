'use strict';

const { PAYMENT_FLAGS } = require('./policy');
const store = require('./store');

const CONTRACT_NAME = 'promoguard.web-readonly';
const CONTRACT_VERSION = 1;
const API_PATHS = Object.freeze({
  campaigns: '/api/v1/campaigns',
  campaign: '/api/v1/campaigns/{campaignId}',
  evidence: '/api/v1/campaigns/{campaignId}/evidence',
  history: '/api/v1/campaigns/{campaignId}/status-history'
});
const FLAG_COLUMNS = Object.fromEntries(PAYMENT_FLAGS.map(flag => [flag, flag.replace(/[A-Z]/g, c => '_' + c.toLowerCase())]));

function parseReasons(value) {
  let reasons;
  try { reasons = JSON.parse(value || '[]'); } catch { throw new Error('stored campaign reasons are invalid'); }
  if (!Array.isArray(reasons) || reasons.some(reason => typeof reason !== 'string')) {
    throw new Error('stored campaign reasons are invalid');
  }
  return reasons;
}

function campaignDto(row) {
  const dto = {
    id: Number(row.id),
    name: row.name,
    publisher: row.publisher || null,
    sourceUrl: row.source_url || null,
    network: row.network || null,
    tokenId: row.token_id || null,
    rewardAmount: row.reward_amount ?? null,
    endDate: row.end_date || null,
    status: row.status,
    reasons: parseReasons(row.reasons),
    evidenceUrl: row.evidence || null,
    lastChecked: row.last_checked,
    archived: row.archived === 1 || row.archived === true,
    reviewNote: row.review_note || null
  };
  for (const flag of PAYMENT_FLAGS) {
    const stored = row[FLAG_COLUMNS[flag]];
    dto[flag] = stored === 1 || stored === true ? true : stored === 0 || stored === false ? false : null;
  }
  return dto;
}

function evidenceDto(row) {
  return {
    id: Number(row.id),
    campaignId: Number(row.campaign_id),
    url: row.url,
    fetchedAt: row.fetched_at,
    contentHash: row.content_hash,
    note: row.note || null,
    content: row.content ?? null
  };
}

function historyDto(row) {
  return {
    id: Number(row.id),
    campaignId: Number(row.campaign_id),
    fromStatus: row.from_status ?? null,
    toStatus: row.to_status,
    reason: row.reason || null,
    occurredAt: row.ts
  };
}

function makeOfflineBundle(db, exportedAt = new Date().toISOString()) {
  const campaigns = store.list(db, true).map(campaignDto);
  const evidence = db.prepare('SELECT id,campaign_id,url,fetched_at,content_hash,note,content FROM campaign_evidence ORDER BY id')
    .all().map(evidenceDto);
  const statusHistory = db.prepare('SELECT id,campaign_id,from_status,to_status,reason,ts FROM status_history ORDER BY id')
    .all().map(historyDto);
  return {
    format: CONTRACT_NAME,
    contractVersion: CONTRACT_VERSION,
    exportedAt,
    readOnly: true,
    resources: { campaigns, evidence, statusHistory }
  };
}

module.exports = {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  API_PATHS,
  campaignDto,
  evidenceDto,
  historyDto,
  makeOfflineBundle
};
