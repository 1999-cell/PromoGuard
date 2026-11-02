'use strict';
// Allowed status transitions. Claim statuses exist for Phase 5 but nothing can enter them yet.
const STATUSES = ['DISCOVERED','UNVERIFIED','UNDER_REVIEW','INELIGIBLE','ELIGIBLE_FOR_REVIEW','AWAITING_USER_APPROVAL',
  'CLAIM_SUBMITTED','REWARD_PENDING','REWARD_RECEIVED','EXPIRED','REJECTED','FAILED'];
const NEXT = {
  DISCOVERED: ['UNVERIFIED','REJECTED','EXPIRED'],
  UNVERIFIED: ['UNDER_REVIEW','REJECTED','EXPIRED'],
  UNDER_REVIEW: ['ELIGIBLE_FOR_REVIEW','INELIGIBLE','UNVERIFIED','REJECTED','EXPIRED'],
  ELIGIBLE_FOR_REVIEW: ['UNDER_REVIEW','REJECTED','EXPIRED','AWAITING_USER_APPROVAL'],
  AWAITING_USER_APPROVAL: ['CLAIM_SUBMITTED','UNVERIFIED','REJECTED','EXPIRED'],
  CLAIM_SUBMITTED: ['REWARD_PENDING','FAILED','EXPIRED'],
  REWARD_PENDING: ['REWARD_RECEIVED','FAILED','EXPIRED'],
  REWARD_RECEIVED: [],
  FAILED: [],
  EXPIRED: [],
  REJECTED: [],
  INELIGIBLE: []
};
const OPEN = ['DISCOVERED', 'UNVERIFIED', 'UNDER_REVIEW', 'ELIGIBLE_FOR_REVIEW'];
const canTransition = (a, b) => (NEXT[a] || []).includes(b);
const fromPolicy = s => ({ eligible: 'ELIGIBLE_FOR_REVIEW', rejected: 'REJECTED', unverified: 'UNVERIFIED', expired: 'EXPIRED' })[s] || 'UNVERIFIED';
function endDateState(value, now = new Date()) {
  if (value === null || value === undefined || value === '') return 'active';
  if (typeof value !== 'string') return 'invalid';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return 'invalid';
    return value < now.toISOString().slice(0, 10) ? 'expired' : 'active';
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return 'invalid';
  return parsed.getTime() < now.getTime() ? 'expired' : 'active';
}
module.exports = { STATUSES, canTransition, fromPolicy, OPEN, endDateState };
