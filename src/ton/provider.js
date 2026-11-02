'use strict';
const { NETWORKS } = require('./networks');
const { readLimited, HostLimiter } = require('../discovery');
const digits = v => typeof v === 'string' && /^\d+$/.test(v) || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0);
// Integer math only. Balances are never converted to floating point.
function formatUnits(v, decimals = 9) {
  if (!digits(v)) throw new Error('malformed amount');
  const s = BigInt(v).toString().padStart(decimals + 1, '0'), frac = s.slice(-decimals).replace(/0+$/, '');
  return frac ? `${s.slice(0, -decimals)}.${frac}` : s.slice(0, -decimals);
}
const norm = a => String(a || '').toLowerCase();
function parseJettons(json, network) {
  const out = []; let skipped = 0;
  for (const w of (json && json.jetton_wallets) || []) {
    if (!w || !digits(w.balance) || typeof w.jetton !== 'string' || !w.jetton) { skipped++; continue; }
    out.push({ tokenId: `${network}:${norm(w.jetton)}`, master: w.jetton, rawBalance: String(w.balance), decimals: null, metadataVerified: false });
  }
  return { tokens: out, skipped };
}
// Incoming = internal message with a source, addressed to this account, with value > 0.
function parseIncoming(json, account) {
  const out = [];
  for (const tx of (json && json.transactions) || []) {
    const m = tx && tx.in_msg; if (!m || !m.source || norm(m.destination) !== norm(account) || !digits(m.value) || BigInt(m.value) === 0n || !tx.hash) continue;
    const status = tx.description && tx.description.aborted === true ? 'failed' : Number.isInteger(tx.mc_block_seqno) ? 'confirmed' : 'unknown';
    out.push({ hash: String(tx.hash), lt: tx.lt != null ? String(tx.lt) : null, time: Number.isFinite(tx.now) ? new Date(tx.now * 1000).toISOString() : null, from: String(m.source), amountNano: String(m.value), status });
  }
  return out;
}
function createProvider({ network, fetchImpl = fetch, apiKey, limiter = new HostLimiter(1100), sleep = ms => new Promise(r => setTimeout(r, ms)), retries = 3 }) {
  const net = NETWORKS[network]; if (!net) throw new Error('unknown network');
  async function get(path, params) {
    const u = new URL(net.api + path); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    for (let n = 0; ; n++) {
      await limiter.wait(u.hostname);
      const res = await fetchImpl(u.href, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', ...(apiKey ? { 'X-API-Key': apiKey } : {}) } });
      if (res.status === 429 && n < retries) { await sleep(1000 * 2 ** n); continue; }   // documented: back off on 429
      if (!res.ok) throw new Error('provider http ' + res.status);
      return JSON.parse(await readLimited(res, 1_000_000));
    }
  }
  return {
    network, name: 'TON Center API v3',
    async balance(addr) { const j = await get('/accountStates', { address: addr, include_boc: 'false' }); const a = j && j.accounts && j.accounts[0]; if (!a || !digits(a.balance)) throw new Error('balance unavailable'); return String(a.balance); },
    async jettons(addr) { return parseJettons(await get('/jetton/wallets', { owner_address: addr, limit: '50', offset: '0' }), network); },
    async incoming(addr) { return parseIncoming(await get('/transactions', { account: addr, limit: '20', sort: 'desc' }), addr); }
  };
}
module.exports = { formatUnits, parseJettons, parseIncoming, createProvider };
