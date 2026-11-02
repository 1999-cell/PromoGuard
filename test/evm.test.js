const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const { EVM_NETWORKS, parseCaip10, resolveRpc } = require('../src/evm/networks'), { createEvmProvider, formatWei } = require('../src/evm/rpc'), { createWcService } = require('../src/evm/walletconnect');
const { createSecureStorage } = require('../src/ton/secure-storage'), W = require('../src/ton/store'), { open } = require('../src/db');
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pg-')), 't.db'), ADDR = '0x' + 'ab'.repeat(20), noWait = { wait: async () => {} };
const rpcResp = r => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, ...r }));
test('caip10 parsing: valid, unsupported chain flagged, junk dropped', () => {
  assert.deepEqual(parseCaip10(`eip155:56:${ADDR.toUpperCase().replace('0X', '0x')}`).network, 'eip155:56'); assert.equal(parseCaip10(`eip155:999:${ADDR}`).network, null);
  for (const bad of ['solana:1:abc', 'eip155:56:0x12', 'eip155:56', `eip155:abc:${ADDR}`, null, '']) assert.equal(parseCaip10(bad), null);
});
test('network registry: testnets marked, rpc only https, overrides validated', () => {
  assert.equal(EVM_NETWORKS['eip155:97'].testnet, true); assert.equal(EVM_NETWORKS['eip155:56'].testnet, false); assert.equal(resolveRpc('eip155:1'), null);
  assert.equal(resolveRpc('eip155:1', { 'eip155:1': 'https://rpc.example' }), 'https://rpc.example'); assert.equal(resolveRpc('eip155:1', { 'eip155:1': 'http://rpc.example' }), null); assert.equal(resolveRpc('eip155:1', { 'eip155:1': 'https://u:p@x' }), null); assert.equal(resolveRpc('nope'), null);
});
test('wei formatting uses integers', () => { assert.equal(formatWei('1500000000000000000'), '1.5'); assert.equal(formatWei('1'), '0.000000000000000001'); assert.throws(() => formatWei('0x1')); });
test('rpc: verifies chain id before reading balance and parses hex', async () => {
  const calls = []; const p = createEvmProvider({ network: 'eip155:97', rpcUrl: 'https://rpc.test', limiter: noWait, fetchImpl: async (u, o) => { const b = JSON.parse(o.body); calls.push(b.method); return rpcResp({ result: b.method === 'eth_chainId' ? '0x61' : '0xde0b6b3a7640000' }); } });
  assert.equal(await p.balance(ADDR), '1000000000000000000'); assert.deepEqual(calls, ['eth_chainId', 'eth_getBalance']);
});
test('rpc: wrong chain endpoint, malformed result, rpc error, 500 and bad address rejected', async () => {
  const mk = f => createEvmProvider({ network: 'eip155:56', rpcUrl: 'https://rpc.test', limiter: noWait, sleep: async () => {}, retries: 0, fetchImpl: f });
  await assert.rejects(mk(async () => rpcResp({ result: '0x1' })).balance(ADDR), /chain mismatch/);
  await assert.rejects(mk(async (u, o) => rpcResp({ result: JSON.parse(o.body).method === 'eth_chainId' ? '0x38' : 'junk' })).balance(ADDR), /malformed/);
  await assert.rejects(mk(async () => rpcResp({ error: { code: -32000 } })).balance(ADDR), /rpc error/);
  await assert.rejects(mk(async () => new Response('', { status: 500 })).balance(ADDR), /http 500/);
  await assert.rejects(mk(async () => rpcResp({ result: '0x38' })).balance('0x123'), /invalid address/); assert.throws(() => createEvmProvider({ network: 'eip155:1', rpcUrl: null }), /no rpc/);
});
test('rpc: retries 429 then succeeds', async () => { let n = 0; const p = createEvmProvider({ network: 'eip155:56', rpcUrl: 'https://rpc.test', limiter: noWait, sleep: async () => {}, fetchImpl: async (u, o) => (++n === 1 ? new Response('', { status: 429 }) : rpcResp({ result: '0x38' })) }); await p.verifyChain(); assert.equal(n, 2); });
// ---- mocked WalletConnect ----
function mockSC(opts = {}) { const ev = {}; const sessions = opts.sessions || []; const sess = { topic: 't1', namespaces: { eip155: { accounts: [`eip155:97:${ADDR}`, `eip155:97:${ADDR}`, `eip155:137:${ADDR}`, 'garbage'] } } };
  const client = { on: (e, f) => { ev[e] = f; }, session: { getAll: () => sessions, get: () => client.cur || sess }, async connect(p) { client.proposal = p; return { uri: 'wc:abc@2?symKey=1', approval: opts.approval || (async () => sess) }; }, async disconnect(a) { client.disc = a; } };
  return { client, ev, sess, Impl: { init: async o => { client.initOpts = o; return client; } } }; }
const mkSvc = (m, extra = {}) => createWcService({ SignClientImpl: m.Impl, makeCore: p => ({ p }), projectId: 'a'.repeat(32), metadata: {}, ...extra });
const tick = () => new Promise(r => setTimeout(r, 5));
test('wc: requests no signing methods; no signing API; connect + account filtering', async () => {
  const m = mockSC(), s = mkSvc(m); const uri = await s.connect(['eip155:97', 'eip155:56', 'bad']); assert.match(uri, /^wc:/); await tick();
  assert.deepEqual(m.client.proposal.optionalNamespaces.eip155.methods, []); assert.deepEqual(m.client.proposal.requiredNamespaces, {}); assert.deepEqual(m.client.proposal.optionalNamespaces.eip155.chains, ['eip155:97', 'eip155:56']);
  const st = s.getState(); assert.equal(st.status, 'connected'); assert.equal(st.accounts.length, 2); assert.equal(st.accounts.filter(a => !a.network).length, 1);   // dup and junk removed, 137 unsupported
  for (const k of ['request', 'sendTransaction', 'signMessage', 'personalSign', 'signTypedData']) assert.equal(s[k], undefined);
});
test('wc: rejection, timeout, unsupported chain request, bad project id', async () => {
  const r = mkSvc(mockSC({ approval: async () => { throw Object.assign(new Error('User rejected'), { code: 5000 }); } })); await r.connect(['eip155:56']); await tick(); assert.equal(r.getState().error, 'rejected');
  const t = mkSvc(mockSC({ approval: () => new Promise(() => {}) }), { approvalTimeoutMs: 10 }); await t.connect(['eip155:56']); await new Promise(x => setTimeout(x, 40)); assert.equal(t.getState().error, 'timeout');
  await assert.rejects(mkSvc(mockSC()).connect(['eip155:999']), /no supported chains/); assert.throws(() => createWcService({ SignClientImpl: {}, makeCore: () => ({}), projectId: 'bad id!' }), /invalid project/);
});
test('wc: chain/account change events, remote disconnect, user disconnect, restore', async () => {
  const m = mockSC(), s = mkSvc(m); await s.connect(['eip155:97']); await tick();
  m.client.cur = { topic: 't1', namespaces: { eip155: { accounts: [`eip155:56:0x${'cd'.repeat(20)}`] } } }; m.ev.session_event({ topic: 't1' }); assert.equal(s.getState().accounts[0].network, 'eip155:56'); assert.equal(s.getState().accounts[0].address, '0x' + 'cd'.repeat(20));
  m.ev.session_delete({}); assert.equal(s.getState().status, 'disconnected');
  const m2 = mockSC(), s2 = mkSvc(m2); await s2.connect(['eip155:97']); await tick(); await s2.disconnect(); assert.equal(m2.client.disc.topic, 't1'); assert.equal(s2.getState().status, 'disconnected');
  const m3 = mockSC({ sessions: [{ topic: 'old', namespaces: { eip155: { accounts: [`eip155:56:${ADDR}`] } } }] }), s3 = mkSvc(m3); await s3.init(); assert.equal(s3.getState().status, 'connected');
});
test('wc: session storage adapter is encrypted and WalletConnect-compatible', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pg-')), 'w.bin'), c = { available: () => true, encrypt: s => Buffer.from(s).toString('base64'), decrypt: b => Buffer.from(b.toString(), 'base64').toString() };
  const st = createSecureStorage(f, c); await st.setItem('wc@2:core:0.3//keychain', { symKey: 'SUPERSECRETKEY' }); assert.ok(!fs.readFileSync(f, 'utf8').includes('SUPERSECRETKEY'));
  assert.deepEqual(await st.getKeys(), ['wc@2:core:0.3//keychain']); assert.equal((await st.getEntries())[0][1].symKey, 'SUPERSECRETKEY');
});
test('store: per-host consent, testnet/mainnet separation, balance rise detection data', () => {
  const db = open(tmp()); assert.equal(W.hasPermission(db, 'rpc:a.test', 'read_public_data', 'eip155:56'), false); W.grantPermission(db, 'rpc:a.test', 'read_public_data', 'eip155:56');
  assert.ok(W.hasPermission(db, 'rpc:a.test', 'read_public_data', 'eip155:56')); assert.equal(W.hasPermission(db, 'rpc:b.test', 'read_public_data', 'eip155:56'), false); assert.equal(W.hasPermission(db, 'rpc:a.test', 'read_public_data', 'eip155:97'), false);
  const id = W.saveConnection(db, { name: 'wc:trust', address: ADDR, network: 'eip155:97' }); assert.equal(db.prepare('SELECT provider FROM wallet_connections').get().provider, 'wc:trust');
  assert.equal(W.previousBalance(db, ADDR, 'eip155:97'), null); W.saveSnapshot(db, id, 'eip155:97', '5', [], 'x'); assert.equal(W.previousBalance(db, ADDR, 'eip155:97'), '5'); assert.equal(W.previousBalance(db, ADDR, 'eip155:56'), null);
});
