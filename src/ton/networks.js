'use strict';
// Chain ids are the TON Connect CHAIN values (mainnet -239, testnet -3). API URLs are TON Center API v3 base URLs.
const NETWORKS = {
  'ton-mainnet': { name: 'TON Mainnet', chain: '-239', testnet: false, api: 'https://toncenter.com/api/v3', explorer: 'https://tonviewer.com' },
  'ton-testnet': { name: 'TON Testnet', chain: '-3', testnet: true, api: 'https://testnet.toncenter.com/api/v3', explorer: 'https://testnet.tonviewer.com' }
};
const networkByChain = c => Object.keys(NETWORKS).find(k => NETWORKS[k].chain === String(c)) || null;
function checkMatch(selected, walletChain) {
  const walletNetwork = networkByChain(walletChain);
  if (!walletNetwork) return { ok: false, walletNetwork: null, reason: 'unsupported_network' };
  if (walletNetwork !== selected) return { ok: false, walletNetwork, reason: 'network_mismatch' };
  return { ok: true, walletNetwork };
}
module.exports = { NETWORKS, networkByChain, checkMatch };
