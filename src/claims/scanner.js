'use strict';
// Read-only unclaimed reward scanner. Never claims; returns candidates only.
function scanIncoming(transfers, { minAmount = 0 } = {}) {
  const out = [];
  for (const t of transfers || []) {
    if (!t || t.direction !== 'in') continue;
    const amt = Number(t.amount);
    if (!Number.isFinite(amt) || amt < minAmount) continue;
    out.push({
      sourceUrl: t.sourceUrl || t.txUrl || '',
      chain: t.chain || null,
      address: t.to || null,
      amount: String(t.amount),
      token: t.token || null,
      expiresAt: t.expiresAt || null,
      proofUrl: t.txUrl || null,
      status: 'candidate',
      notes: t.memo || null
    });
  }
  return out;
}
module.exports = { scanIncoming };
