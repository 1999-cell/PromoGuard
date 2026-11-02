'use strict';
const Database = require('better-sqlite3');
// Append-only migrations. Never edit an applied one. No secrets are ever stored.
const MIGRATIONS = [
`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
 CREATE TABLE reward_campaigns (id INTEGER PRIMARY KEY, name TEXT NOT NULL, publisher TEXT, source_url TEXT, network TEXT,
   token_id TEXT, reward_amount REAL, eligibility TEXT, end_date TEXT, status TEXT NOT NULL, reasons TEXT, evidence TEXT, last_checked TEXT NOT NULL);
 CREATE TABLE wallet_connections (id INTEGER PRIMARY KEY, provider TEXT NOT NULL, address TEXT NOT NULL, network TEXT NOT NULL, first_connected TEXT NOT NULL, last_used TEXT NOT NULL);
 CREATE TABLE wallet_transactions (id INTEGER PRIMARY KEY, address TEXT, network TEXT, tx_hash TEXT, status TEXT, provider TEXT, ts TEXT);
 CREATE TABLE wallet_audit_events (id INTEGER PRIMARY KEY, event TEXT NOT NULL, provider TEXT, network TEXT, outcome TEXT, ts TEXT NOT NULL, info TEXT);`,
// v2: status workflow, history, dedupe, discovery jobs. Old lowercase statuses are mapped, never dropped.
`ALTER TABLE reward_campaigns ADD COLUMN dedupe_key TEXT;
 ALTER TABLE reward_campaigns ADD COLUMN review_note TEXT;
 CREATE TABLE status_history (id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES reward_campaigns(id) ON DELETE CASCADE,
   from_status TEXT, to_status TEXT NOT NULL, reason TEXT, ts TEXT NOT NULL);
 CREATE TABLE discovery_jobs (id INTEGER PRIMARY KEY, trigger TEXT NOT NULL, started TEXT NOT NULL, finished TEXT, feeds INTEGER, found INTEGER, added INTEGER, errors TEXT);
 CREATE INDEX idx_campaign_dedupe ON reward_campaigns(dedupe_key);
 CREATE INDEX idx_campaign_status ON reward_campaigns(status);
 CREATE INDEX idx_history_campaign ON status_history(campaign_id);
 INSERT INTO status_history(campaign_id,from_status,to_status,reason,ts)
   SELECT id, status, CASE status WHEN 'eligible' THEN 'UNVERIFIED' WHEN 'rejected' THEN 'REJECTED' WHEN 'expired' THEN 'EXPIRED' ELSE 'UNVERIFIED' END,
   CASE status WHEN 'eligible' THEN 'migrated: no evidence on record' ELSE 'migrated' END, datetime('now') FROM reward_campaigns;
 UPDATE reward_campaigns SET status = CASE status WHEN 'eligible' THEN 'UNVERIFIED' WHEN 'rejected' THEN 'REJECTED' WHEN 'expired' THEN 'EXPIRED' ELSE 'UNVERIFIED' END;`,
// v3: TON read-only wallet data, snapshots, consent records.
`ALTER TABLE wallet_transactions ADD COLUMN direction TEXT;
 ALTER TABLE wallet_transactions ADD COLUMN amount_nano TEXT;
 ALTER TABLE wallet_transactions ADD COLUMN counterparty TEXT;
 ALTER TABLE wallet_transactions ADD COLUMN lt TEXT;
 CREATE UNIQUE INDEX idx_wtx_unique ON wallet_transactions(network, tx_hash) WHERE tx_hash IS NOT NULL;
 CREATE TABLE wallet_snapshots (id INTEGER PRIMARY KEY, connection_id INTEGER REFERENCES wallet_connections(id) ON DELETE CASCADE, network TEXT NOT NULL,
   native_balance_nano TEXT, tokens_json TEXT, retrieved TEXT NOT NULL, provider TEXT NOT NULL, freshness TEXT NOT NULL);
 CREATE TABLE wallet_permissions (id INTEGER PRIMARY KEY, provider TEXT NOT NULL, operation TEXT NOT NULL, scope TEXT, approved TEXT NOT NULL, revoked TEXT);
 CREATE INDEX idx_snap_conn ON wallet_snapshots(connection_id);`,
// v4: user-tracked EVM tokens (identified by chain + contract, never by symbol).
`CREATE TABLE evm_tokens (id INTEGER PRIMARY KEY, chain TEXT NOT NULL, contract TEXT NOT NULL, label TEXT, added TEXT NOT NULL, UNIQUE(chain, contract));`,
// v5: Phase 5 claim preparation. claim_attempts records each claim lifecycle step; campaign_evidence stores official terms snapshots.
`CREATE TABLE claim_attempts (id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES reward_campaigns(id) ON DELETE CASCADE, network TEXT NOT NULL, wallet TEXT NOT NULL, state TEXT NOT NULL, fee_check_result TEXT, fee_check_evidence TEXT, approved_at TEXT, tx_hash TEXT, confirmed_at TEXT, failure_reason TEXT, expected_amount_nano TEXT, expected_amount_wei TEXT, previous_balance TEXT);
 CREATE TABLE campaign_evidence (id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES reward_campaigns(id) ON DELETE CASCADE, url TEXT NOT NULL, fetched_at TEXT NOT NULL, content_hash TEXT NOT NULL, note TEXT);
 CREATE INDEX idx_claim_campaign ON claim_attempts(campaign_id);
 CREATE INDEX idx_evidence_campaign ON campaign_evidence(campaign_id);`,
// v6: Phase 6 local AI and MCP read-only tools. ai_summaries records model output (advisory only, never changes status); mcp_grants records tool consent.
`CREATE TABLE ai_summaries (id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES reward_campaigns(id) ON DELETE CASCADE, model TEXT NOT NULL, prompt_version TEXT NOT NULL, summary TEXT NOT NULL, created TEXT NOT NULL, flagged_uncertain INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE mcp_grants (id INTEGER PRIMARY KEY, tool TEXT NOT NULL, granted INTEGER NOT NULL DEFAULT 0, revoked TEXT);
 CREATE UNIQUE INDEX idx_mcp_grants_tool ON mcp_grants(tool);`,
// v7: Dashboard, notifications, health.
`CREATE TABLE notifications (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, ref_id INTEGER, shown_at TEXT NOT NULL, dismissed INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE app_health (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated TEXT NOT NULL);
 CREATE INDEX idx_notif_kind ON notifications(kind); CREATE INDEX idx_notif_dismissed ON notifications(dismissed);`,
// v8: AI summaries may be campaign-independent; persist the payment assertions needed by review/claim checks.
`ALTER TABLE ai_summaries RENAME TO ai_summaries_v6;
 CREATE TABLE ai_summaries (id INTEGER PRIMARY KEY, campaign_id INTEGER REFERENCES reward_campaigns(id) ON DELETE CASCADE, model TEXT NOT NULL, prompt_version TEXT NOT NULL, summary TEXT NOT NULL, created TEXT NOT NULL, flagged_uncertain INTEGER NOT NULL DEFAULT 0);
 INSERT INTO ai_summaries SELECT * FROM ai_summaries_v6;
 DROP TABLE ai_summaries_v6;
 ALTER TABLE reward_campaigns ADD COLUMN requires_deposit INTEGER;
 ALTER TABLE reward_campaigns ADD COLUMN requires_gas INTEGER;
 ALTER TABLE reward_campaigns ADD COLUMN requires_purchase INTEGER;
 ALTER TABLE reward_campaigns ADD COLUMN requires_staking INTEGER;
 ALTER TABLE reward_campaigns ADD COLUMN requires_paid_mint INTEGER;
 ALTER TABLE reward_campaigns ADD COLUMN requires_sending_funds INTEGER;
 ALTER TABLE reward_campaigns ADD COLUMN requires_unlimited_approval INTEGER;
 ALTER TABLE reward_campaigns ADD COLUMN requests_seed_phrase INTEGER;
 ALTER TABLE reward_campaigns ADD COLUMN unclear_signature INTEGER;
 ALTER TABLE reward_campaigns ADD COLUMN unverified_site INTEGER;`,
// v9: A TON receipt is not attributable to a campaign without an exact transaction hash.
`ALTER TABLE claim_attempts ADD COLUMN expected_tx_hash TEXT;`,
// v10: Persist notification text so the Activity view can explain each update.
`ALTER TABLE notifications ADD COLUMN message TEXT;`,
// v11: Keep user-provided official-terms snapshots so reviews can be tied to a content hash.
`ALTER TABLE campaign_evidence ADD COLUMN content TEXT;`,
// v12: Archived flag for campaigns; archived campaigns are hidden from default views but not deleted.
`ALTER TABLE reward_campaigns ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;`];
function migrate(db, list = MIGRATIONS) {
  let v = db.pragma('user_version', { simple: true });
  while (v < list.length) { const n = v; db.transaction(() => { db.exec(list[n]); db.pragma(`user_version = ${n + 1}`); })(); v++; }
}
function open(path) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
  migrate(db); return db;
}
module.exports = { open, migrate, MIGRATIONS };
