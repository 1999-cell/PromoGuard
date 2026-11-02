'use strict';
const { evaluateCampaign } = require('./policy');
const { canTransition, fromPolicy, OPEN, endDateState } = require('./status');
const { dedupeKey } = require('./discovery');
const { PAYMENT_FLAGS } = require('./policy');
const { latestSnapshot, normalizeSnapshotUrl } = require('./evidence');
const now = () => new Date().toISOString();
const hist = (db, id, a, b, why) => db.prepare('INSERT INTO status_history(campaign_id,from_status,to_status,reason,ts) VALUES(?,?,?,?,?)').run(id, a, b, why, now());
const httpsUrl = u => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
const FLAG_COLUMNS = Object.fromEntries(PAYMENT_FLAGS.map(f => [f, f.replace(/[A-Z]/g, c => '_' + c.toLowerCase())]));
const flagValue = value => value === true ? 1 : value === false ? 0 : null;

// Eligibility needs: policy pass + evidence URL. Discovery can never produce it on its own.
function decide(c, settings, source) {
  const r = evaluateCampaign(c, settings);
  let status = fromPolicy(r.status); const reasons = [...r.reasons];
  if (status === 'ELIGIBLE_FOR_REVIEW' && (source === 'discovery' || !httpsUrl(c.evidenceUrl))) { status = 'UNVERIFIED'; reasons.push('evidence_url_required'); }
  return { status, reasons };
}
function addCampaign(db, c, settings, source = 'manual') {
  const key = dedupeKey(c.sourceUrl || '');
  if (key) { const ex = db.prepare('SELECT id FROM reward_campaigns WHERE dedupe_key=?').get(key); if (ex) return { duplicate: true, id: ex.id, status: null, reasons: ['duplicate'] }; }
  const d = decide(c, settings, source);
  return db.transaction(() => {
    const flagColumns = PAYMENT_FLAGS.map(f => FLAG_COLUMNS[f]);
    const id = db.prepare(`INSERT INTO reward_campaigns(name,publisher,source_url,network,token_id,reward_amount,end_date,status,reasons,evidence,last_checked,dedupe_key,${flagColumns.join(',')})
      VALUES(${Array(12 + PAYMENT_FLAGS.length).fill('?').join(',')})`).run(c.name, c.publisher || null, c.sourceUrl || null, c.network || null, c.tokenId || null,
      typeof c.rewardAmount === 'number' ? c.rewardAmount : null, c.endDate || null, d.status, JSON.stringify(d.reasons), c.evidenceUrl || null, now(), key,
      ...PAYMENT_FLAGS.map(f => flagValue(c[f]))).lastInsertRowid;
    hist(db, id, null, 'DISCOVERED', source); hist(db, id, 'DISCOVERED', d.status, d.reasons.join(',') || 'policy');
    return { id: Number(id), ...d };
  })();
}
function move(db, id, to, why, extra = {}) {
  const row = db.prepare('SELECT status FROM reward_campaigns WHERE id=?').get(id);
  if (!row) throw new Error('not found');
  if (!canTransition(row.status, to)) throw new Error(`transition ${row.status} -> ${to} not allowed`);
  db.transaction(() => { db.prepare('UPDATE reward_campaigns SET status=?, last_checked=?, review_note=COALESCE(?,review_note) WHERE id=?').run(to, now(), extra.note ?? null, id); hist(db, id, row.status, to, why); })();
}
const startReview = (db, id) => move(db, id, 'UNDER_REVIEW', 'review started');
const rejectCampaign = (db, id, note) => move(db, id, 'REJECTED', 'manual rejection', { note: String(note || '').slice(0, 500) });
// The only path to ELIGIBLE_FOR_REVIEW: re-run the policy with user-supplied evidence.
function submitEvidence(db, id, ev, settings) {
  const row = db.prepare('SELECT * FROM reward_campaigns WHERE id=?').get(id);
  if (!row || row.status !== 'UNDER_REVIEW') throw new Error('campaign must be UNDER_REVIEW');
  const free = ev.confirmFree === true;
  const c = { name: row.name, sourceUrl: row.source_url, network: ev.network || row.network, tokenId: ev.tokenId || row.token_id,
    rewardAmount: typeof ev.rewardAmount === 'number' ? ev.rewardAmount : row.reward_amount, endDate: ev.endDate || row.end_date, evidenceUrl: ev.evidenceUrl };
  for (const k of PAYMENT_FLAGS) {
    const previouslyRequired = row[FLAG_COLUMNS[k]] === 1;
    if (k === 'unverifiedSite') c[k] = previouslyRequired ? true : ev.confirmOfficialSource === true ? false : undefined;
    else c[k] = previouslyRequired ? true : free ? false : undefined;
  }
  const d = decide(c, settings, 'manual');
  if (d.status === 'ELIGIBLE_FOR_REVIEW' && httpsUrl(c.evidenceUrl)) {
    const latest = latestSnapshot(db, id);
    let matches = false;
    try { matches = !!latest && latest.url === normalizeSnapshotUrl(c.evidenceUrl); } catch {}
    if (!matches) {
      d.status = 'UNDER_REVIEW';
      d.reasons.push('terms_snapshot_required');
    }
  }
  const to = d.status === 'ELIGIBLE_FOR_REVIEW' ? 'ELIGIBLE_FOR_REVIEW' : d.status === 'REJECTED' ? 'INELIGIBLE' : null;
  const flagUpdates = PAYMENT_FLAGS.map(f => `${FLAG_COLUMNS[f]}=?`).join(',');
  db.prepare(`UPDATE reward_campaigns SET network=?,token_id=?,reward_amount=?,end_date=?,evidence=?,reasons=?,last_checked=?,${flagUpdates} WHERE id=?`)
    .run(c.network, c.tokenId, c.rewardAmount ?? null, c.endDate ?? null, ev.evidenceUrl || null, JSON.stringify(d.reasons), now(),
      ...PAYMENT_FLAGS.map(f => flagValue(c[f])), id);
  if (to) move(db, id, to, d.reasons.join(',') || 'evidence accepted');
  return { status: to || 'UNDER_REVIEW', reasons: d.reasons };
}
function sweepExpired(db, at = new Date()) {
  const rows = db.prepare(`SELECT id,status,end_date FROM reward_campaigns WHERE end_date IS NOT NULL AND status IN (${OPEN.map(() => '?').join(',')})`).all(...OPEN)
    .filter(r => endDateState(r.end_date, at) === 'expired');
  for (const r of rows) move(db, r.id, 'EXPIRED', 'end date passed');
  return rows.length;
}
const list = (db, includeArchived = false) => db.prepare(`SELECT c.*,
  (SELECT group_concat(to_status,' > ') FROM (SELECT to_status FROM status_history h WHERE h.campaign_id=c.id ORDER BY id)) AS history,
  (SELECT COUNT(*) FROM campaign_evidence e WHERE e.campaign_id=c.id AND e.content IS NOT NULL) AS evidence_count,
  (SELECT e.content_hash FROM campaign_evidence e WHERE e.campaign_id=c.id AND e.content IS NOT NULL ORDER BY e.id DESC LIMIT 1) AS latest_evidence_hash,
  (SELECT e.fetched_at FROM campaign_evidence e WHERE e.campaign_id=c.id AND e.content IS NOT NULL ORDER BY e.id DESC LIMIT 1) AS latest_evidence_at
  FROM reward_campaigns c ${includeArchived ? '' : 'WHERE c.archived IS NULL OR c.archived = 0'} ORDER BY c.id DESC`).all()
  .map(row => {
    for (const flag of PAYMENT_FLAGS) {
      const value = row[FLAG_COLUMNS[flag]];
      row[flag] = value === null ? undefined : value === 1;
    }
    return row;
  });
module.exports = { addCampaign, startReview, rejectCampaign, submitEvidence, sweepExpired, list, decide };
