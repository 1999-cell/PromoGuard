'use strict';
const { EVM_NETWORKS, ADDR } = require('./networks');
const { readLimited, HostLimiter } = require('../discovery');
const { formatUnits } = require('../ton/provider');
const hexQty = h => { if (typeof h !== 'string' || !/^0x[0-9a-fA-F]+$/.test(h)) throw new Error('malformed quantity'); return BigInt(h); };
function createEvmProvider({ network, rpcUrl, fetchImpl = fetch, limiter = new HostLimiter(500), sleep = ms => new Promise(r => setTimeout(r, ms)), retries = 2 }) {
  const net = EVM_NETWORKS[network]; if (!net) throw new Error('unknown network'); if (!rpcUrl) throw new Error('no rpc provider configured');
  let verified = false, id = 0;
  async function call(method, params) {
    for (let n = 0; ; n++) {
      await limiter.wait(new URL(rpcUrl).hostname);
      const res = await fetchImpl(rpcUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
      if ((res.status === 429 || res.status >= 500) && n < retries) { await sleep(1000 * 2 ** n); continue; }
      if (!res.ok) throw new Error('rpc http ' + res.status);
      const j = JSON.parse(await readLimited(res, 500_000)); if (j.error) throw new Error('rpc error ' + (j.error.code ?? '')); return j.result;
    }
  }
  return { network, name: new URL(rpcUrl).hostname,
    async verifyChain() { const got = Number(hexQty(await call('eth_chainId', []))); if (got !== net.chainId) throw new Error(`rpc chain mismatch: expected ${net.chainId}, got ${got}`); verified = true; },
    async balance(addr) { if (!ADDR.test(addr)) throw new Error('invalid address'); if (!verified) await this.verifyChain(); return hexQty(await call('eth_getBalance', [addr, 'latest'])).toString(); } };
}
module.exports = { createEvmProvider, formatWei: v => formatUnits(v, 18) };
