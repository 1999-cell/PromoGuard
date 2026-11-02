'use strict';
const STATUSES = ['candidate', 'reviewing', 'verified', 'rejected', 'claimed-externally'];
function normalizeCandidate(raw) {
  if (!raw || !raw.sourceUrl) throw new Error('sourceUrl required');
  return {
    id: raw.id || null,
    sourceUrl: String(raw.sourceUrl),
    chain: raw.chain || null,
    address: raw.address || null,
    amount: raw.amount != null ? String(raw.amount) : null,
    token: raw.token || null,
    expiresAt: raw.expiresAt || null,
    proofUrl: raw.proofUrl || null,
    status: STATUSES.includes(raw.status) ? raw.status : 'candidate',
    notes: raw.notes ? String(raw.notes).slice(0, 500) : null
  };
}
function isClaimable(c) { return c.status === 'verified' && !c.claimedAt; }
module.exports = { STATUSES, normalizeCandidate, isClaimable };
