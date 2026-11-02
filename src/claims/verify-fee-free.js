'use strict';
// Phase 5: Fee-free verification (the hardest part).
// Gas is paid by the sender. A claim you send yourself always costs gas, so it fails the zero-payment rule.
// Allowed paths: direct distribution to your address (monitor and record, send nothing), or a sponsored /
// relayed claim where the project pays and this can be proven from documentation and a simulated
// transaction showing zero cost to you. Unlimited or unnecessary token approvals are rejected outright.

const PAYMENT_FLAGS = ['requiresDeposit','requiresGas','requiresPurchase','requiresStaking','requiresPaidMint',
  'requiresSendingFunds','requiresUnlimitedApproval','requestsSeedPhrase','unclearSignature','unverifiedSite'];

function checkFeeFree(campaign) {
  const reasons = [];
  for (const f of PAYMENT_FLAGS) {
    if (campaign[f] === true) reasons.push(`${f}_required`);
    else if (campaign[f] !== false) reasons.push(`${f}_unconfirmed`);
  }
  if (campaign.requiresUnlimitedApproval === true) reasons.push('unlimited_approval_rejected');
  if (campaign.requiresGas === true) reasons.push('gas_not_free');
  return { feeFree: reasons.length === 0, reasons };
}

function distributionPath(campaign) {
  // Direct distribution: project sends to your address; you monitor and record, send nothing.
  return {
    allowed: campaign.distributionMethod === 'direct_distribution',
    reason: campaign.distributionMethod === 'direct_distribution' ? '' : 'not_a_direct_distribution'
  };
}

function sponsoredPath(campaign) {
  // Sponsored / relayed claim: project pays. Must be provable from documentation + simulated tx at zero cost.
  const proof = campaign.sponsoredProof || {};
  return {
    allowed: proof.documented === true && proof.zeroCostSimulated === true,
    reason: (proof.documented === true && proof.zeroCostSimulated === true) ? '' : 'sponsorship_not_proven'
  };
}

function verifyFeeFree(campaign) {
  const feeCheck = checkFeeFree(campaign);
  if (!feeCheck.feeFree) return { allowed: false, reason: feeCheck.reasons.join(', '), evidence: null };

  const dist = distributionPath(campaign);
  if (dist.allowed) return { allowed: true, reason: 'direct_distribution', evidence: { type: 'direct_distribution', monitored: true } };

  const spons = sponsoredPath(campaign);
  if (spons.allowed) return { allowed: true, reason: 'sponsored_relayed', evidence: { type: 'sponsored', proof: campaign.sponsoredProof } };

  return { allowed: false, reason: 'no_fee_free_path', evidence: null };
}

module.exports = { verifyFeeFree, checkFeeFree, distributionPath, sponsoredPath, PAYMENT_FLAGS };
