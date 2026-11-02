const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const { NETWORKS, networkByChain, checkMatch } = require('../src/ton/networks');
const P = require('../src/ton/provider'), { createTonService } = require('../src/ton/connector'), { createSecureStorage } = require('../src/ton/secure-storage');
const W = require('../src/ton/store'), { open, migrate, MIGRATIONS } = require('../src/db'); const Database = require('better-sqlite3');
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pg-')), 't.db'); const A = '0:' + 'ab'.repeat(32);
const json = (o, init) => new Response(JSON.stringify(o), init);
test('networks: chain ids and mismatch', () => {
  assert.equal(networkByChain('-3'), 'ton-testnet'); assert.equal(networkByChain(-239), 'ton-mainnet'); assert.equal(networkByChain('1'), null);
  assert.equal(checkMatch('ton-testnet', '-239').reason, 'network_mismatch'); assert.equal(checkMatch('ton-mainnet', '99').reason, 'unsupported_network'); assert.ok(checkMatch('ton-testnet', '-3').ok);
});
test('formatUnits uses integer math and rejects junk', () => {
  assert.equal(P.formatUnits('1500000000'), '1.5'); assert.equal(P.formatUnits('1'), '0.000000001'); assert.equal(P.formatUnits('123456789012345678901'), '123456789012.345678901');
  for (const bad of ['-1', '1.5', 'abc', '', null, {}]) assert.throws(() => P.formatUnits(bad));
});
test('malformed token metadata skipped; token id is network+master, never symbol', () => {
  const r = P.parseJettons({ jetton_wallets: [{ balance: '5', jetton: '0:AA' }, { balance: 'x', jetton: '0:BB' }, { jetton: '0:CC' }, null, { balance: '1', jetton: '' }] }, 'ton-testnet');
  assert.equal(r.tokens.length, 1); assert.equal(r.skipped, 4); assert.equal(r.tokens[0].tokenId, 'ton-testnet:0:aa'); assert.equal(r.tokens[0].metadataVerified, false);
});
test('incoming parsing: status, outgoing and external messages ignored', () => {
  const j = { transactions: [
    { hash: 'h1', lt: 1, now: 1700000000, mc_block_seqno: 5, in_msg: { source: '0:s', destination: A.toUpperCase(), value: '100' } },
    { hash: 'h2', in_msg: { source: '0:s', destination: A, value: '7' }, description: { aborted: true } },
    { hash: 'h3', in_msg: { source: '0:s', destination: A, value: '7' } },
    { hash: 'h4', in_msg: { source: null, destination: A, value: '9' } }, { hash: 'h5', in_msg: { source: '0:s', destination: '0:other', value: '9' } },
    { hash: 'h6', in_msg: { source: '0:s', destination: A, value: '0' } }, { in_msg: { source: '0:s', destination: A, value: '1' } }] };
  assert.deepEqual(P.parseIncoming(j, A).map(t => [t.hash, t.status]), [['h1', 'confirmed'], ['h2', 'failed'], ['h3', 'unknown']]);
});
test('provider: 429 backoff, size cap, bad balance, only registry hosts', async () => {
  let n = 0; const urls = []; const p = P.createProvider({ network: 'ton-testnet', sleep: async () => {}, limiter: { wait: async () => {} }, fetchImpl: async u => { urls.push(u); return ++n < 3 ? new Response('', { status: 429 }) : json({ accounts: [{ balance: '42' }] }); } });
  assert.equal(await p.balance(A), '42'); assert.equal(n, 3); assert.ok(urls.every(u => u.startsWith('https://testnet.toncenter.com/api/v3/')));
  const bad = P.createProvider({ network: 'ton-mainnet', limiter: { wait: async () => {} }, fetchImpl: async () => json({ accounts: [{ balance: 'NaN' }] }) }); await assert.rejects(bad.balance(A), /unavailable/);
  const big = P.createProvider({ network: 'ton-mainnet', limiter: { wait: async () => {} }, fetchImpl: async () => new Response('{"x":"' + 'a'.repeat(2_000_000) + '"}') }); await assert.rejects(big.balance(A), /too large/);
  assert.throws(() => P.createProvider({ network: 'evil' }));
});
test('provider: RPC failure surfaces as an error', async () => { const p = P.createProvider({ network: 'ton-testnet', limiter: { wait: async () => {} }, fetchImpl: async () => new Response('', { status: 500 }) }); await assert.rejects(p.incoming(A), /http 500/); });
// ---- mocked TON Connect ----
function mockTC() { let cb, eb; const C = class { constructor(o) { C.opts = o; C.inst = this; } onStatusChange(a, b) { cb = a; eb = b; return () => {}; } async getWallets() { return [{ name: 'Tonkeeper', universalLink: 'https://app.tonkeeper.com/ton-connect', bridgeUrl: 'https://bridge.tonapi.io/bridge' }, { name: 'Sketchy', universalLink: 'http://evil', bridgeUrl: 'https://b' }, { name: 'NoBridge', universalLink: 'https://x.io' }];}
  connect() { return 'https://app.tonkeeper.com/ton-connect?v=2&id=1'; } async restoreConnection() {} async disconnect() { this.disc = (this.disc || 0) + 1; cb && cb(null); } }; return { C, ok: w => cb(w), err: e => eb(e) }; }
const wallet = chain => ({ account: { address: A, chain }, device: { appName: 'tonkeeper' } });
test('connector: manifest must be https; wallets filtered; no signing API exposed', async () => {
  const m = mockTC(); assert.throws(() => createTonService({ manifestUrl: 'http://x/m.json', TonConnectImpl: m.C }));
  const s = createTonService({ manifestUrl: 'https://x.io/m.json', storage: {}, TonConnectImpl: m.C });
  assert.deepEqual((await s.wallets()).map(w => w.name), ['Tonkeeper']);
  for (const k of ['sendTransaction', 'signData', 'signMessage', 'send']) assert.equal(s[k], undefined);
  assert.throws(() => s.connect('Sketchy'), /unsupported/); assert.match(s.connect('Tonkeeper'), /^https:/);
});
test('connector: connect, account change, mismatch, unsupported network, disconnect', async () => {
  const m = mockTC(), s = createTonService({ manifestUrl: 'https://x.io/m.json', storage: {}, TonConnectImpl: m.C }); await s.wallets(); s.connect('Tonkeeper'); assert.equal(s.getState().status, 'connecting');
  m.ok(wallet('-3')); let st = s.getState(); assert.equal(st.status, 'connected'); assert.equal(st.wallet.network, 'ton-testnet'); assert.match(st.wallet.friendly, /^[A-Za-z0-9_-]{48}$/);
  m.ok({ account: { address: '0:' + 'cd'.repeat(32), chain: '-3' } }); assert.notEqual(s.getState().wallet.address, A);            // account change
  m.ok(wallet('-239')); assert.equal(checkMatch('ton-testnet', s.getState().wallet.chain).reason, 'network_mismatch');                // mainnet/testnet confusion
  m.ok(wallet('777')); assert.equal(s.getState().error, 'unsupported_network'); assert.equal(s.getState().wallet, null); assert.equal(m.C.inst.disc, 1);
  await s.disconnect(); assert.equal(s.getState().status, 'disconnected');
});
test('connector: rejection and errors mapped', async () => {
  const m = mockTC(), s = createTonService({ manifestUrl: 'https://x.io/m.json', storage: {}, TonConnectImpl: m.C });
  m.err(Object.assign(new Error('User rejects the action'), { name: 'UserRejectsError' })); assert.equal(s.getState().error, 'rejected');
  m.err(new Error('Manifest not found')); assert.equal(s.getState().error, 'manifest_problem'); m.err(new Error('boom')); assert.equal(s.getState().error, 'connection_error');
});
test('secure storage: encrypted on disk, never plaintext, memory-only when unavailable', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pg-')), 's.bin'), enc = { available: () => true, encrypt: s => Buffer.from(s.split('').reverse().join('')), decrypt: b => b.toString().split('').reverse().join('') };
  const st = createSecureStorage(f, enc); await st.setItem('k', 'SECRETVALUE'); assert.ok(!fs.readFileSync(f, 'utf8').includes('SECRETVALUE')); assert.equal(await createSecureStorage(f, enc).getItem('k'), 'SECRETVALUE');
  const g = path.join(path.dirname(f), 'n.bin'), none = createSecureStorage(g, { available: () => false }); await none.setItem('a', 'b'); assert.equal(fs.existsSync(g), false); assert.equal(await none.getItem('a'), 'b');
});
test('secure storage awaits asynchronous safe-storage operations', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pg-')), 'async.bin');
  const cipher = {
    available: async () => true,
    encrypt: async value => Buffer.from(`encrypted:${value}`),
    decrypt: async value => value.toString().replace(/^encrypted:/, '')
  };
  const storage = createSecureStorage(f, cipher);
  await storage.setItem('projectId', 'test-project');
  assert.equal(await storage.persistent(), true);
  assert.equal(await createSecureStorage(f, cipher).getItem('projectId'), 'test-project');
});
test('secure storage reports unreadable encrypted state and permits explicit erasure', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pg-')), 'bad.bin');
  fs.writeFileSync(f, 'corrupt');
  const st = createSecureStorage(f, { available: () => true, encrypt: s => Buffer.from(s), decrypt: () => { throw new Error('cipher failure'); } });
  await assert.rejects(st.getItem('key'), /saved encrypted wallet data could not be read/);
  st.clear();
  assert.equal(fs.existsSync(f), false);
});
test('store: consent gating, snapshots, dedup transactions, wipe cascades', () => {
  const db = open(tmp()); assert.equal(W.hasPermission(db, 'toncenter', 'read_public_data', 'ton-testnet'), false);
  W.grantPermission(db, 'toncenter', 'read_public_data', 'ton-testnet'); assert.ok(W.hasPermission(db, 'toncenter', 'read_public_data', 'ton-testnet')); assert.equal(W.hasPermission(db, 'toncenter', 'read_public_data', 'ton-mainnet'), false);
  W.revokePermission(db, 'toncenter', 'read_public_data', 'ton-testnet'); assert.equal(W.hasPermission(db, 'toncenter', 'read_public_data', 'ton-testnet'), false);
  const id = W.saveConnection(db, { name: 'tk', address: A, network: 'ton-testnet' }); assert.equal(W.saveConnection(db, { name: 'tk', address: A, network: 'ton-testnet' }), id);
  W.saveSnapshot(db, id, 'ton-testnet', '1000', [], 'TON Center API v3');
  const tx = [{ hash: 'h1', status: 'unknown', time: null, amountNano: '5', from: '0:s', lt: '1' }];
  assert.equal(W.saveTransactions(db, A, 'ton-testnet', tx, 'p'), 0); tx[0].status = 'confirmed'; assert.equal(W.saveTransactions(db, A, 'ton-testnet', tx, 'p'), 0);   // upgrade, not a duplicate row
  assert.equal(db.prepare('SELECT COUNT(*) n FROM wallet_transactions').get().n, 1); assert.equal(W.latest(db, A, 'ton-testnet').txs[0].status, 'confirmed');
  assert.equal(W.latest(db, A, 'ton-mainnet').snapshot, null);                                  // testnet data never shown as mainnet
  db.exec('DELETE FROM wallet_connections'); assert.equal(db.prepare('SELECT COUNT(*) n FROM wallet_snapshots').get().n, 0);
});
test('store: provider wipe removes matching wallet data and revokes its lookup consent only', () => {
  const db = open(tmp()), evm = '0x' + 'cd'.repeat(20);
  const tonId = W.saveConnection(db, { name: 'Tonkeeper', address: A, network: 'ton-testnet' });
  W.saveSnapshot(db, tonId, 'ton-testnet', '10', [], 'TON provider');
  const wcId = W.saveConnection(db, { name: 'wc:trust', address: evm, network: 'eip155:56' });
  W.saveSnapshot(db, wcId, 'eip155:56', '20', [], 'RPC provider');
  W.saveTransactions(db, evm, 'eip155:56', [{ hash: 'evm-hash', status: 'confirmed', time: 'now', amountNano: '2', from: '0xsource' }], 'rpc.test');
  W.grantPermission(db, 'rpc:rpc.test', 'read_public_data', 'eip155:56');
  W.grantPermission(db, 'toncenter', 'read_public_data', 'ton-testnet');
  W.eraseProviderData(db, 'wc:', 'rpc:');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM wallet_connections WHERE provider LIKE 'wc:%'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM wallet_transactions WHERE tx_hash='evm-hash'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM wallet_snapshots WHERE network='eip155:56'").get().n, 0);
  assert.equal(W.hasPermission(db, 'rpc:rpc.test', 'read_public_data', 'eip155:56'), false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM wallet_connections WHERE provider LIKE ?').get('ton:%').n, 1);
  assert.equal(W.hasPermission(db, 'toncenter', 'read_public_data', 'ton-testnet'), true);
});
test('migration v3 preserves v2 data; no secret-like columns', () => {
  const p = tmp(), old = new Database(p); migrate(old, MIGRATIONS.slice(0, 2)); old.prepare("INSERT INTO reward_campaigns(name,status,last_checked) VALUES('keep','UNVERIFIED','x')").run();
  old.prepare("INSERT INTO wallet_transactions(address,network,tx_hash,status) VALUES('a','n','h','confirmed')").run(); old.close();
  const db = open(p); assert.equal(db.prepare('SELECT COUNT(*) n FROM reward_campaigns').get().n, 1); assert.equal(db.prepare('SELECT status FROM wallet_transactions').get().status, 'confirmed');
  const cols = db.prepare("SELECT p.name c FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type='table'").all(); assert.equal(cols.filter(x => /seed|private|mnemonic|password|session_key|secret/i.test(x.c) && x.c !== 'requests_seed_phrase').length, 0);
});
