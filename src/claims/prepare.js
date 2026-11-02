'use strict';
// Phase 5: Seven-stage claim preparation pipeline.
// Pipeline: Recheck -> Active -> Eligibility -> Destination -> Fee check -> Explain -> Approve and monitor.
// Never auto-signs; never counts pending as received; rejects every payment-required campaign.

const crypto = require('crypto');
const { verifyFeeFree } = require('./verify-fee-free');
const { PAYMENT_FLAGS } = require('./verify-fee-free');
const { endDateState } = require('../status');

const STAGES = ['recheck','active','eligibility','destination','fee_check','explain','approve_monitor'];

function contentHash(text) {
  return crypto.createHash('sha256').update(text || '').digest('hex');
}

function stageRecheck(campaign, fetchedTerms) {
  if (typeof fetchedTerms !== 'string' || !fetchedTerms.trim()) {
    return { stage: 'recheck', ok: false, reason: 'official_terms_not_fetched', next: 'UNVERIFIED' };
  }
  if (/^https?:\/\/\S+$/i.test(fetchedTerms.trim())) {
    return { stage: 'recheck', ok: false, reason: 'official_terms_not_fetched', next: 'UNVERIFIED' };
  }
  const hash = contentHash(fetchedTerms);
  const changed = campaign.contentHash && campaign.contentHash !== hash;
  return { stage: 'recheck', ok: true, contentHash: hash, termsChanged: changed, next: changed ? 'UNDER_REVIEW' : 'active' };
}

function stageActive(campaign, now = new Date()) {
  const expiry = endDateState(campaign.endDate, now);
  if (expiry === 'expired') return { stage: 'active', ok: false, reason: 'campaign_expired', next: 'EXPIRED' };
  if (expiry === 'invalid') return { stage: 'active', ok: false, reason: 'invalid_end_date', next: 'UNVERIFIED' };
  if (campaign.distributionStatus === 'closed' || campaign.distributionStatus === 'ended') return { stage: 'active', ok: false, reason: 'distribution_closed', next: 'EXPIRED' };
  return { stage: 'active', ok: true, next: 'eligibility' };
}

function stageEligibility(campaign) {
  const unknown = PAYMENT_FLAGS.filter(flag => campaign[flag] === undefined || campaign[flag] === null);
  if (unknown.length) return { stage: 'eligibility', ok: false, reason: 'eligibility_not_verifiable', unknown, next: 'UNVERIFIED' };
  return { stage: 'eligibility', ok: true, next: 'destination' };
}

function stageDestination(campaign, walletNetwork, selectedNetwork) {
  if (!walletNetwork || !selectedNetwork) return { stage: 'destination', ok: false, reason: 'network_not_set', next: null };
  if (walletNetwork !== selectedNetwork) return { stage: 'destination', ok: false, reason: 'network_mismatch', next: null };
  return { stage: 'destination', ok: true, next: 'fee_check' };
}

function stageFeeCheck(campaign) {
  const result = verifyFeeFree(campaign);
  if (!result.allowed) return { stage: 'fee_check', ok: false, reason: result.reason, evidence: result.evidence, next: 'REJECTED' };
  return { stage: 'fee_check', ok: true, reason: result.reason, evidence: result.evidence, next: 'explain' };
}

function stageExplain(campaign) {
  const network = campaign.network;
  const tokenId = campaign.tokenId || campaign.token_id;
  const rewardAmount = campaign.rewardAmount ?? campaign.reward_amount;
  const endDate = campaign.endDate || campaign.end_date;
  if (!network || !tokenId || typeof rewardAmount !== 'number') {
    return { stage: 'explain', ok: false, reason: 'undecodable_claim_data', next: null };
  }
  return { stage: 'explain', ok: true, action: 'claim', network, contract: tokenId, amount: rewardAmount, endDate, next: 'approve_monitor' };
}

function stageApproveMonitor(campaign, userApproved) {
  if (userApproved !== true) return { stage: 'approve_monitor', ok: false, reason: 'user_approval_required', next: 'AWAITING_USER_APPROVAL' };
  return { stage: 'approve_monitor', ok: false, reason: 'transaction_submission_not_supported', next: 'AWAITING_USER_APPROVAL' };
}

function runPipeline(campaign, context = {}) {
  const now = context.now || new Date();
  const results = [];

  const s1 = stageRecheck(campaign, context.fetchedTerms);
  results.push(s1);
  if (!s1.ok) return { pipeline: results, final: s1.next, reason: s1.reason };
  if (s1.termsChanged) return { pipeline: results, final: 'UNDER_REVIEW', reason: 'terms_changed' };

  const s2 = stageActive(campaign, now);
  results.push(s2);
  if (!s2.ok) return { pipeline: results, final: s2.next, reason: s2.reason };

  const s3 = stageEligibility(campaign);
  results.push(s3);
  if (!s3.ok) return { pipeline: results, final: s3.next, reason: s3.reason, unknown: s3.unknown };

  const s4 = stageDestination(campaign, context.walletNetwork, context.selectedNetwork);
  results.push(s4);
  if (!s4.ok) return { pipeline: results, final: null, reason: s4.reason };

  const s5 = stageFeeCheck(campaign);
  results.push(s5);
  if (!s5.ok) return { pipeline: results, final: s5.next, reason: s5.reason, evidence: s5.evidence };

  const s6 = stageExplain(campaign);
  results.push(s6);
  if (!s6.ok) return { pipeline: results, final: null, reason: s6.reason };

  const s7 = stageApproveMonitor(campaign, context.userApproved);
  results.push(s7);
  if (!s7.ok) return { pipeline: results, final: s7.next, reason: s7.reason };

  return { pipeline: results, final: s7.next, reason: s7.reason || 'claim_preparation_only' };
}

module.exports = { runPipeline, STAGES, stageRecheck, stageActive, stageEligibility, stageDestination, stageFeeCheck, stageExplain, stageApproveMonitor, contentHash };
