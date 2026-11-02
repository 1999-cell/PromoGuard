'use strict';
// Phase 6: Read-only MCP tools.
// Strict input validation, narrow output, explicit consent per tool.
// No private keys, no filesystem or command access, no signing.

// Consent-gated tool factory. Returns handler functions keyed by tool name.
function createMcpTools({ db, getWalletContext, hasConsent, grantConsent, revokeConsent }) {
  const TOOLS = [
    'get_connected_wallets',
    'get_public_wallet_address',
    'get_wallet_balance',
    'get_supported_token_balances',
    'get_recent_transactions',
    'get_network_status',
    'analyze_reward_campaign',
    'check_campaign_eligibility',
    'explain_transaction_request'
  ];

  function ensureGrant(tool) {
    if (!hasConsent(tool)) throw new Error(`consent required for MCP tool: ${tool}`);
  }

  function isGranted(tool) {
    return !!hasConsent(tool);
  }

  function listTools() {
    return TOOLS.map(t => ({ name: t, granted: isGranted(t) }));
  }

  async function getConnectedWallets() {
    ensureGrant('get_connected_wallets');
    const ctx = getWalletContext ? getWalletContext() : {};
    const out = (ctx.wallets || []).map(w => ({ provider: w.provider, network: w.network }));
    return { wallets: out, note: 'Provider and network only. Addresses omitted unless you grant address access.' };
  }

  async function getPublicWalletAddress() {
    ensureGrant('get_public_wallet_address');
    const ctx = getWalletContext ? getWalletContext() : {};
    const sel = ctx.selected || {};
    if (!sel.address) return { address: null, note: 'No connected wallet or address not available.' };
    return { address: sel.address, network: sel.network, note: 'Public address only. Consent required and recorded.' };
  }

  async function getWalletBalance() {
    ensureGrant('get_wallet_balance');
    const ctx = getWalletContext ? getWalletContext() : {};
    const sel = ctx.selected || {};
    const snap = ctx.snapshot || null;
    return {
      network: sel.network,
      nativeBalance: snap ? snap.native_balance_nano : null,
      retrieved: snap ? snap.retrieved : null,
      provider: snap ? snap.provider : null,
      note: 'Last stored snapshot with time and source. Not a live quote.'
    };
  }

  async function getSupportedTokenBalances() {
    ensureGrant('get_supported_token_balances');
    const ctx = getWalletContext ? getWalletContext() : {};
    const snap = ctx.snapshot || null;
    const tokens = snap && snap.tokens ? snap.tokens : [];
    return {
      tokens: tokens.map(t => ({ tokenId: t.tokenId, rawBalance: t.rawBalance, metadataVerified: t.metadataVerified || false })),
      note: 'Stored token list; metadata labels unverified and not trusted.'
    };
  }

  async function getRecentTransactions() {
    ensureGrant('get_recent_transactions');
    const ctx = getWalletContext ? getWalletContext() : {};
    const txs = ctx.transactions || [];
    return {
      transactions: txs.map(t => ({ hash: t.tx_hash, status: t.status, amount: t.amount_nano, counterparty: t.counterparty, time: t.ts })),
      note: 'Stored incoming transfers. Confirmed status required to count as received.'
    };
  }

  async function getNetworkStatus() {
    ensureGrant('get_network_status');
    const ctx = getWalletContext ? getWalletContext() : {};
    const sel = ctx.selected || {};
    const walletNetwork = ctx.walletNetwork || null;
    const selected = ctx.selectedNetwork || null;
    return {
      selectedNetwork: selected,
      walletNetwork,
      match: walletNetwork && selected ? walletNetwork === selected : null,
      note: 'Selected and wallet networks, with mismatch flag.'
    };
  }

  async function analyzeRewardCampaign({ campaignId }) {
    ensureGrant('analyze_reward_campaign');
    if (typeof campaignId !== 'number' || !Number.isInteger(campaignId) || campaignId < 1) throw new Error('invalid campaign id');
    const row = db.prepare('SELECT * FROM reward_campaigns WHERE id=?').get(campaignId);
    if (!row) throw new Error('campaign not found');
    const summary = {
      id: row.id,
      name: row.name,
      status: row.status,
      network: row.network,
      rewardAmount: row.reward_amount,
      tokenId: row.token_id,
      endDate: row.end_date,
      reasons: JSON.parse(row.reasons || '[]'),
      evidence: row.evidence || null,
      note: 'Evidence-based summary. AI output is advisory and never decides eligibility.'
    };
    return summary;
  }

  async function checkCampaignEligibility({ campaignId }) {
    ensureGrant('check_campaign_eligibility');
    if (typeof campaignId !== 'number' || !Number.isInteger(campaignId) || campaignId < 1) throw new Error('invalid campaign id');
    const row = db.prepare('SELECT * FROM reward_campaigns WHERE id=?').get(campaignId);
    if (!row) throw new Error('campaign not found');
    return {
      id: row.id,
      status: row.status,
      reasons: JSON.parse(row.reasons || '[]'),
      note: 'Policy result and reasons. Not a verdict; user confirms terms.'
    };
  }

  async function explainTransactionRequest(txData) {
    ensureGrant('explain_transaction_request');
    if (!txData || typeof txData !== 'object') throw new Error('invalid transaction data');
    const keys = Object.keys(txData || {});
    const decodable = keys.some(k => ['to','value','data','gas','chainId'].includes(k));
    if (!decodable) return { decoded: null, warning: 'Transaction data cannot be decoded or is missing recognized fields.' };
    return {
      decoded: { to: txData.to || null, value: txData.value || null, chainId: txData.chainId || null },
      note: 'Decoded explanation only. Never signs or sends.'
    };
  }

  function revoke(tool) {
    if (!TOOLS.includes(tool)) throw new Error('unknown tool');
    revokeConsent(tool);
    return { tool, granted: false };
  }

  function grant(tool) {
    if (!TOOLS.includes(tool)) throw new Error('unknown tool');
    grantConsent(tool);
    return { tool, granted: true };
  }

  const handlers = {
    get_connected_wallets: getConnectedWallets,
    get_public_wallet_address: getPublicWalletAddress,
    get_wallet_balance: getWalletBalance,
    get_supported_token_balances: getSupportedTokenBalances,
    get_recent_transactions: getRecentTransactions,
    get_network_status: getNetworkStatus,
    analyze_reward_campaign: analyzeRewardCampaign,
    check_campaign_eligibility: checkCampaignEligibility,
    explain_transaction_request: explainTransactionRequest
  };
  async function invoke(tool, args) {
    const handler = handlers[tool];
    if (!handler) throw new Error('unknown or disallowed tool');
    return handler(args || {});
  }

  return { listTools, invoke, getConnectedWallets, getPublicWalletAddress, getWalletBalance, getSupportedTokenBalances, getRecentTransactions, getNetworkStatus, analyzeRewardCampaign, checkCampaignEligibility, explainTransactionRequest, grant, revoke };
}

module.exports = { createMcpTools };
