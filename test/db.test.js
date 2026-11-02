const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const Database = require('better-sqlite3');
const { open, migrate, MIGRATIONS } = require('../src/db');
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pg-')), 't.db');
test('fresh db migrates to latest', () => { const db = open(tmp()); assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length); db.close(); });
test('data persists across reopen and reopen does not re-migrate', () => {
  const p = tmp(); let db = open(p);
  db.prepare("INSERT INTO reward_campaigns(name,status,last_checked) VALUES(?,?,?)").run('keep me', 'unverified', 'x'); db.close();
  db = open(p); assert.equal(db.prepare('SELECT name FROM reward_campaigns').get().name, 'keep me'); db.close();
});
test('hostile input is stored as data (parameterized)', () => {
  const db = open(tmp()); const evil = "x'); DROP TABLE reward_campaigns;--";
  db.prepare("INSERT INTO reward_campaigns(name,status,last_checked) VALUES(?,?,?)").run(evil, 'rejected', 'x');
  assert.equal(db.prepare('SELECT name FROM reward_campaigns').get().name, evil); db.close();
});
test('no column can hold secrets by design', () => {
  const db = open(tmp()); const cols = db.prepare("SELECT m.name t, p.name c FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type='table'").all();
  assert.equal(cols.filter(x => /seed|private|mnemonic|password/i.test(x.c) && x.c !== 'requests_seed_phrase').length, 0); db.close();
});
test('v8 migration preserves summaries and permits campaign-independent summaries', () => {
  const db = new Database(tmp());
  db.pragma('foreign_keys = ON');
  migrate(db, MIGRATIONS.slice(0, 7));
  db.prepare("INSERT INTO reward_campaigns(name,status,last_checked) VALUES('saved','UNVERIFIED','x')").run();
  db.prepare("INSERT INTO ai_summaries(campaign_id,model,prompt_version,summary,created) VALUES(1,'test','v1','kept','x')").run();
  migrate(db);
  assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length);
  assert.equal(db.prepare('SELECT summary FROM ai_summaries WHERE campaign_id=1').get().summary, 'kept');
  db.prepare("INSERT INTO ai_summaries(campaign_id,model,prompt_version,summary,created) VALUES(NULL,'test','v1','standalone','x')").run();
  assert.equal(db.prepare('SELECT summary FROM ai_summaries WHERE campaign_id IS NULL').get().summary, 'standalone');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  db.close();
});
test('v10 migration preserves older notifications and stores new message text', () => {
  const db = new Database(tmp());
  migrate(db, MIGRATIONS.slice(0, 9));
  const oldId = db.prepare("INSERT INTO notifications(kind,ref_id,shown_at) VALUES('legacy',1,'before')").run().lastInsertRowid;
  migrate(db);
  assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length);
  assert.equal(db.prepare('SELECT message FROM notifications WHERE id=?').get(oldId).message, null);
  db.prepare("INSERT INTO notifications(kind,message,shown_at) VALUES('test','Readable update','now')").run();
  assert.equal(db.prepare("SELECT message FROM notifications WHERE kind='test'").get().message, 'Readable update');
  db.close();
});
