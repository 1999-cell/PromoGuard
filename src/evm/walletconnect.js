'use strict';
const { parseCaip10, EVM_NETWORKS } = require('./networks');
// Read-only WalletConnect v2 wrapper (Sign API). It requests NO signing methods and exposes NO request(), sign or send function.
function createWcService({ SignClientImpl, makeCore, projectId, metadata, approvalTimeoutMs = 300000 }) {
  if (!/^[A-Za-z0-9]{16,64}$/.test(projectId || '')) throw new Error('invalid project id');
  let client = null, session = null, state = { status: 'disconnected', accounts: [], error: null }; const listeners = new Set();
  const set = s => { state = s; listeners.forEach(f => f(state)); };
  const fromSession = s => { const raw = (s && s.namespaces && s.namespaces.eip155 && s.namespaces.eip155.accounts) || [];
    const seen = new Set(), accounts = []; for (const a of raw) { const p = parseCaip10(a); if (p && !seen.has(a)) { seen.add(a); accounts.push(p); } } return accounts; };
  const apply = s => { session = s; set(s ? { status: 'connected', accounts: fromSession(s), error: null } : { status: 'disconnected', accounts: [], error: null }); };
  async function init() {
    if (client) return client;
    client = await SignClientImpl.init({ core: makeCore(projectId), metadata });
    client.on('session_delete', () => apply(null));
    client.on('session_expire', () => apply(null));
    client.on('session_update', ({ topic }) => { if (session && topic === session.topic) apply(client.session.get(topic)); });
    client.on('session_event', ({ topic }) => { if (session && topic === session.topic) apply(client.session.get(topic)); });   // chainChanged / accountsChanged
    const old = client.session.getAll(); if (old.length) apply(old[old.length - 1]);
    return client;
  }
  return {
    getState: () => state, onChange: f => (listeners.add(f), () => listeners.delete(f)), init,
    async connect(caip2List) {
      const chains = caip2List.filter(c => EVM_NETWORKS[c]); if (!chains.length) throw new Error('no supported chains selected');
      const c = await init(); set({ status: 'connecting', accounts: [], error: null });
      const { uri, approval } = await c.connect({ requiredNamespaces: {}, optionalNamespaces: { eip155: { chains, methods: [], events: ['chainChanged', 'accountsChanged'] } } });
      if (!uri || !/^wc:/.test(uri)) throw new Error('no pairing uri');
      let timer; const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('approval timed out'), { code: 'timeout' })), approvalTimeoutMs); if (timer.unref) timer.unref(); });
      Promise.race([approval(), timeout]).finally(() => clearTimeout(timer))
        .then(apply).catch(e => set({ status: 'error', accounts: [], error: e.code === 'timeout' ? 'timeout' : /reject|5000|declin/i.test(`${e.code} ${e.message}`) ? 'rejected' : 'connection_error' }));
      return uri;
    },
    async disconnect() { try { if (client && session) await client.disconnect({ topic: session.topic, reason: { code: 6000, message: 'User disconnected.' } }); } catch {} apply(null); }
  };
}
module.exports = { createWcService };
