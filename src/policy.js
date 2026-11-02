'use strict';
const { endDateState } = require('./status');
// Pure, testable rules. The zero-payment filter is hard-coded: no setting or AI tool can disable it.
const PAYMENT_FLAGS = ['requiresDeposit','requiresGas','requiresPurchase','requiresStaking','requiresPaidMint',
  'requiresSendingFunds','requiresUnlimitedApproval','requestsSeedPhrase','unclearSignature','unverifiedSite'];
const SUSPICIOUS_PATTERNS = [/seed\s*phrase/i, /recovery\s*phrase/i, /private\s*key/i, /double\s+your/i,
  /guaranteed\s+(profit|return)/i, /send\s+\d*\.?\d*\s*(ton|eth|bnb|usdt)/i, /validate\s+your\s+wallet/i, /unlock\s+fee/i];
const SHORTENERS = new Set(['bit.ly','t.co','tinyurl.com','cutt.ly','is.gd','rb.gy']);

function checkUrl(raw, approvedDomains = []) {
  const flags = [];
  let u;
  try { u = new URL(raw); } catch { return { ok: false, flags: ['malformed_url'] }; }
  if (u.protocol !== 'https:') flags.push('not_https');
  const host = u.hostname.toLowerCase();
  if (u.username || u.password) flags.push('credentials_in_url');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) flags.push('ip_address_host');
  if (host.startsWith('xn--') || host.includes('.xn--')) flags.push('punycode_lookalike');
  if (SHORTENERS.has(host)) flags.push('url_shortener');
  const approved = approvedDomains.some(d => host === d || host.endsWith('.' + d));
  if (!approved) flags.push('domain_not_approved');
  return { ok: flags.length === 0, flags, host };
}

// status: eligible | rejected | unverified | expired
function evaluateCampaign(c, settings, now = new Date()) {
  const reasons = [];
  const expiry = endDateState(c.endDate, now);
  if (expiry === 'expired') return { status: 'expired', reasons: ['campaign_ended'] };
  if (expiry === 'invalid') reasons.push('invalid_end_date');
  for (const f of PAYMENT_FLAGS) if (c[f] === true) reasons.push(f);
  const text = `${c.name || ''} ${c.description || ''}`;
  for (const p of SUSPICIOUS_PATTERNS) if (p.test(text)) reasons.push('suspicious_text:' + p.source);
  reasons.push(...checkUrl(c.sourceUrl || '', settings.approvedDomains).flags);
  if (reasons.length) {
    const hard = reasons.some(r => PAYMENT_FLAGS.includes(r) || r.startsWith('suspicious_text'));
    return { status: hard ? 'rejected' : 'unverified', reasons };
  }
  const unknown = PAYMENT_FLAGS.filter(f => c[f] !== false); // undefined = unknown, never assumed free
  if (unknown.length) return { status: 'unverified', reasons: unknown.map(f => 'unconfirmed:' + f) };
  if (typeof c.rewardAmount !== 'number' || !c.tokenId) return { status: 'unverified', reasons: ['reward_amount_not_published'] };
  if (c.rewardAmount <= 0) return { status: 'rejected', reasons: ['reward_amount_not_positive'] };
  if (c.rewardAmount < settings.minReward) return { status: 'rejected', reasons: ['below_minimum_reward'] };
  return { status: 'eligible', reasons: [] };
}

// Token identity = network + contract (or native), never the symbol.
const tokenKey = (network, contract) => `${network}:${(contract || 'native').toLowerCase()}`;
module.exports = { evaluateCampaign, checkUrl, tokenKey, PAYMENT_FLAGS };
