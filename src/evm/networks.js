'use strict';
// CAIP-2 ids. RPC values are configured defaults, not provider endorsements; reads verify the endpoint's chain ID.
const EVM_NETWORKS = {
  'eip155:56': { name: 'BNB Smart Chain', chainId: 56, testnet: false, symbol: 'BNB', rpc: 'https://bsc-dataseed.bnbchain.org', explorer: 'https://bscscan.com' },
  'eip155:97': { name: 'BNB Smart Chain Testnet', chainId: 97, testnet: true, symbol: 'tBNB', rpc: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545', explorer: 'https://testnet.bscscan.com' },
  'eip155:1': { name: 'Ethereum Mainnet', chainId: 1, testnet: false, symbol: 'ETH', rpc: null, explorer: 'https://etherscan.io' },
  'eip155:11155111': { name: 'Ethereum Sepolia Testnet', chainId: 11155111, testnet: true, symbol: 'SepoliaETH', rpc: null, explorer: 'https://sepolia.etherscan.io' }
};
const ADDR = /^0x[0-9a-fA-F]{40}$/;
// CAIP-10 account: eip155:<chainId>:<address>. Anything else is dropped.
function parseCaip10(s) {
  const m = /^eip155:(\d{1,20}):(0x[0-9a-fA-F]{40})$/.exec(String(s)); if (!m) return null;
  const caip2 = `eip155:${m[1]}`; return { caip2, chainId: Number(m[1]), address: m[2].toLowerCase(), network: EVM_NETWORKS[caip2] ? caip2 : null };
}
const resolveRpc = (caip2, overrides = {}) => { const n = EVM_NETWORKS[caip2]; if (!n) return null; const o = overrides[caip2];
  if (o) { try { const u = new URL(o); if (u.protocol === 'https:' && !u.username && !u.password) return o; } catch {} return null; } return n.rpc; };
module.exports = { EVM_NETWORKS, ADDR, parseCaip10, resolveRpc };
