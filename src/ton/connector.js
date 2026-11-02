'use strict';
const { TonConnect, toUserFriendlyAddress } = require('@tonconnect/sdk');
const { networkByChain, NETWORKS } = require('./networks');
// Read-only wrapper. It deliberately does NOT expose sendTransaction, signData or signMessage, and requests no ton_proof.
function createTonService({ manifestUrl, storage, TonConnectImpl = TonConnect }) {
  if (!/^https:\/\//.test(manifestUrl || '')) throw new Error('manifest URL must be public https');
  const tc = new TonConnectImpl({ manifestUrl, storage });
  let state = { status: 'disconnected', wallet: null, error: null }; const sources = new Map(); const listeners = new Set();
  const set = s => { state = s; listeners.forEach(f => f(state)); };
  tc.onStatusChange(w => {
    if (!w || !w.account) { if (state.status !== 'error') set({ status: 'disconnected', wallet: null, error: null }); return; }
    const network = networkByChain(w.account.chain);
    if (!network) { set({ status: 'error', wallet: null, error: 'unsupported_network' }); tc.disconnect().catch(() => {}); return; }   // reject unknown networks
    const raw = String(w.account.address);
    set({ status: 'connected', error: null, wallet: { name: (w.device && w.device.appName) || (w.name || 'wallet'), address: raw, friendly: toUserFriendlyAddress(raw, NETWORKS[network].testnet), chain: String(w.account.chain), network } });
  }, e => {
    const msg = String((e && (e.name || e.constructor && e.constructor.name)) || '') + String((e && e.message) || '');
    set({ status: 'error', wallet: null, error: /UserRejects|reject|declin/i.test(msg) ? 'rejected' : /Manifest/i.test(msg) ? 'manifest_problem' : 'connection_error' });
  });
  return {
    getState: () => state, onChange: f => (listeners.add(f), () => listeners.delete(f)),
    async wallets() {
      sources.clear(); const list = await tc.getWallets(), out = [];
      for (const w of list) if (w.universalLink && /^https:\/\//.test(w.universalLink) && w.bridgeUrl) { sources.set(w.name, { universalLink: w.universalLink, bridgeUrl: w.bridgeUrl }); out.push({ name: w.name, bridgeHost: new URL(w.bridgeUrl).hostname }); }
      return out;
    },
    connect(name) {      // renderer supplies only a wallet NAME; the link comes from the SDK's wallet list
      const src = sources.get(name); if (!src) throw new Error('unsupported wallet'); set({ status: 'connecting', wallet: null, error: null });
      const link = tc.connect(src); if (typeof link !== 'string' || !/^https:\/\//.test(link)) throw new Error('bad connect link'); return link;
    },
    restore: () => tc.restoreConnection(),
    async disconnect() { try { await tc.disconnect(); } catch {} set({ status: 'disconnected', wallet: null, error: null }); }
  };
}
module.exports = { createTonService };
