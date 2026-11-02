const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const D = require('../src/discovery'), { canTransition } = require('../src/status'), store = require('../src/store');
const evidence = require('../src/evidence');
const { open, migrate, MIGRATIONS } = require('../src/db'); const Database = require('better-sqlite3');
const S = { minReward: 0.01, approvedDomains: ['ton.org'] }, tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pg-')), 't.db');
const publicResolver = async host => ({ host, addresses: ['93.184.216.34'], error: null });
const resp = (body, init) => new Response(body, init);
test('atom parsing', () => assert.equal(D.parseFeed('<feed><entry><title>Airdrop</title><link href="https://a.com/1"/><summary>s</summary></entry></feed>')[0].link, 'https://a.com/1'));
test('malformed feed throws', () => { assert.throws(() => D.parseFeed('<html>nope</html>')); assert.throws(() => D.parseFeed('')); });
test('dedupe key ignores tracking params, slash, case', () => assert.equal(D.dedupeKey('https://A.com/x/?utm_source=a#f'), D.dedupeKey('https://a.com/x')));
test('oversized response rejected', async () => { await assert.rejects(D.fetchFeed('https://a.com/f', { fetchImpl: async () => resp('<rss>' + 'x'.repeat(5000)), resolveHostImpl: publicResolver, max: 1000, retries: 0 }), /too large/); });
test('redirect to private host blocked', async () => { await assert.rejects(D.fetchFeed('https://a.com/f', { retries: 0, resolveHostImpl: publicResolver, fetchImpl: async () => resp('', { status: 302, headers: { location: 'https://127.0.0.1/x' } }) }), /unsafe/); });
test('redirect loop capped', async () => { await assert.rejects(D.fetchFeed('https://a.com/f', { retries: 0, resolveHostImpl: publicResolver, fetchImpl: async () => resp('', { status: 302, headers: { location: 'https://a.com/f' } }) }), /too many/); });
test('retries 500 then succeeds; 404 not retried', async () => {
  let n = 0; const ok = await D.fetchFeed('https://a.com/f', { sleep: async () => {}, resolveHostImpl: publicResolver, fetchImpl: async () => (++n < 3 ? resp('', { status: 503 }) : resp('<rss><channel><item><title>Airdrop</title><link>https://a.com/1</link></item></channel></rss>')) });
  assert.equal(ok.length, 1); assert.equal(n, 3);
  let m = 0; await assert.rejects(D.fetchFeed('https://a.com/f', { sleep: async () => {}, resolveHostImpl: publicResolver, fetchImpl: async () => (m++, resp('', { status: 404 })) })); assert.equal(m, 1);
});
test('host rate limiter delays same host', async () => { let t = 0, slept = 0; const l = new D.HostLimiter(2000, () => t, async ms => { slept += ms; t += ms; }); await l.wait('a.com'); await l.wait('a.com'); assert.equal(slept, 2000); });
test('status machine blocks skipping review and claim states', () => {
  assert.ok(!canTransition('UNVERIFIED', 'ELIGIBLE_FOR_REVIEW')); assert.ok(!canTransition('REJECTED', 'UNVERIFIED')); assert.ok(canTransition('UNVERIFIED', 'UNDER_REVIEW')); assert.ok(canTransition('ELIGIBLE_FOR_REVIEW', 'AWAITING_USER_APPROVAL'));
});
test('discovery source never yields eligible; duplicates skipped', () => {
  const db = open(tmp()); const r = store.addCampaign(db, { name: 'Free airdrop', sourceUrl: 'https://ton.org/a', requiresGas: false }, S, 'discovery');
  assert.equal(r.status, 'UNVERIFIED'); assert.ok(store.addCampaign(db, { name: 'x', sourceUrl: 'https://ton.org/a?utm_x=1' }, S, 'discovery').duplicate);
});
test('full review path needs evidence and ends ELIGIBLE_FOR_REVIEW', () => {
  const db = open(tmp()); const { id } = store.addCampaign(db, { name: 'Learn', sourceUrl: 'https://ton.org/l' }, S, 'discovery');
  assert.throws(() => store.submitEvidence(db, id, { evidenceUrl: 'https://ton.org/t', confirmFree: true }, S));      // not UNDER_REVIEW yet
  store.startReview(db, id);
  assert.equal(store.submitEvidence(db, id, { evidenceUrl: '', confirmFree: true, rewardAmount: 1, tokenId: 'ton:native' }, S).status, 'UNDER_REVIEW');   // no evidence URL
  assert.equal(store.submitEvidence(db, id, { evidenceUrl: 'https://ton.org/t', confirmFree: false, rewardAmount: 1, tokenId: 'ton:native' }, S).status, 'UNDER_REVIEW'); // terms unconfirmed
  assert.equal(store.submitEvidence(db, id, { evidenceUrl: 'https://ton.org/t', confirmFree: true, rewardAmount: 1, tokenId: 'ton:native' }, S).status, 'UNDER_REVIEW'); // terms alone do not attest the project domain
  evidence.saveSnapshot(db, { campaignId: id, url: 'https://ton.org/t', content: 'No purchase, deposit, gas payment, or transfer is required.' });
  assert.equal(store.submitEvidence(db, id, { evidenceUrl: 'https://ton.org/t', confirmFree: true, confirmOfficialSource: true, rewardAmount: 1, tokenId: 'ton:native' }, S).status, 'ELIGIBLE_FOR_REVIEW');
  const saved = store.list(db).find(c => c.id === id);
  assert.ok(['requiresDeposit','requiresGas','requiresPurchase','requiresStaking','requiresPaidMint','requiresSendingFunds','requiresUnlimitedApproval','requestsSeedPhrase','unclearSignature'].every(f => saved[f] === false));
  assert.equal(saved.unverifiedSite, false);
  assert.ok(db.prepare('SELECT COUNT(*) n FROM status_history WHERE campaign_id=?').get(id).n >= 4);
});
test('confirming terms cannot clear a previously identified unverified source', () => {
  const db = open(tmp());
  const { id } = store.addCampaign(db, { name: 'Review source', sourceUrl: 'https://ton.org/review' }, S, 'discovery');
  db.prepare('UPDATE reward_campaigns SET unverified_site=1 WHERE id=?').run(id);
  store.startReview(db, id);
  const result = store.submitEvidence(db, id, { evidenceUrl: 'https://ton.org/terms', confirmFree: true, confirmOfficialSource: true, rewardAmount: 1, tokenId: 'ton:native' }, S);
  assert.equal(result.status, 'INELIGIBLE');
  assert.equal(store.list(db).find(c => c.id === id).unverifiedSite, true);
});
test('expiry sweep', () => {
  const db = open(tmp()); const { id } = store.addCampaign(db, { name: 'Old', sourceUrl: 'https://ton.org/o', endDate: '2099-01-01' }, S, 'discovery');
  assert.equal(store.sweepExpired(db, new Date('2100-01-01')), 1); assert.equal(db.prepare('SELECT status FROM reward_campaigns WHERE id=?').get(id).status, 'EXPIRED');
});
test('expiry sweep is inclusive of the final date and ignores terminal campaign states', () => {
  const db = open(tmp());
  const current = store.addCampaign(db, { name: 'Today', sourceUrl: 'https://ton.org/today', endDate: '2026-10-26' }, S, 'discovery');
  assert.equal(store.sweepExpired(db, new Date('2026-10-26T15:32:00Z')), 0);
  db.prepare("UPDATE reward_campaigns SET status='REJECTED' WHERE id=?").run(current.id);
  const past = store.addCampaign(db, { name: 'Past', sourceUrl: 'https://ton.org/past' }, S, 'discovery');
  db.prepare("UPDATE reward_campaigns SET end_date='2026-10-25' WHERE id=?").run(past.id);
  assert.equal(store.sweepExpired(db, new Date('2026-10-26T15:32:00Z')), 1);
  assert.equal(db.prepare('SELECT status FROM reward_campaigns WHERE id=?').get(past.id).status, 'EXPIRED');
  assert.equal(db.prepare('SELECT status FROM reward_campaigns WHERE id=?').get(current.id).status, 'REJECTED');
});
test('v1 database upgrades with data preserved and statuses mapped', () => {
  const p = tmp(), old = new Database(p); old.exec(MIGRATIONS[0]); old.pragma('user_version = 1');
  const ins = old.prepare("INSERT INTO reward_campaigns(name,status,last_checked) VALUES(?,?,'x')"); ins.run('a', 'eligible'); ins.run('b', 'rejected'); ins.run('c', 'unverified'); old.close();
  const db = open(p), st = Object.fromEntries(db.prepare('SELECT name,status FROM reward_campaigns').all().map(r => [r.name, r.status]));
  assert.deepEqual(st, { a: 'UNVERIFIED', b: 'REJECTED', c: 'UNVERIFIED' }); assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length);
});
test('interrupted/failed migration rolls back completely', () => {
  const p = tmp(), db = new Database(p); migrate(db, [MIGRATIONS[0]]);
  db.prepare("INSERT INTO reward_campaigns(name,status,last_checked) VALUES('keep','unverified','x')").run();
  assert.throws(() => migrate(db, [MIGRATIONS[0], 'ALTER TABLE reward_campaigns ADD COLUMN z TEXT; SELECT * FROM nonexistent;']));
  assert.equal(db.pragma('user_version', { simple: true }), 1); assert.equal(db.prepare('SELECT COUNT(*) n FROM reward_campaigns').get().n, 1);
  assert.ok(!db.prepare('PRAGMA table_info(reward_campaigns)').all().some(c => c.name === 'z'));
});
