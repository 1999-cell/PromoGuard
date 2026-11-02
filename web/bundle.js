'use strict';

(function exposeBundleApi(root) {
  const MAX_BUNDLE_BYTES = 10 * 1024 * 1024;
  const allowedStatuses = new Set([
    'DISCOVERED', 'UNVERIFIED', 'UNDER_REVIEW', 'INELIGIBLE', 'ELIGIBLE_FOR_REVIEW',
    'AWAITING_USER_APPROVAL', 'CLAIM_SUBMITTED', 'REWARD_PENDING', 'REWARD_RECEIVED',
    'EXPIRED', 'REJECTED', 'FAILED'
  ]);
  const requiredFlags = [
    'requiresDeposit', 'requiresGas', 'requiresPurchase', 'requiresStaking', 'requiresPaidMint',
    'requiresSendingFunds', 'requiresUnlimitedApproval', 'requestsSeedPhrase', 'unclearSignature', 'unverifiedSite'
  ];
  const campaignFields = [
    'id', 'name', 'publisher', 'sourceUrl', 'network', 'tokenId', 'rewardAmount', 'endDate', 'status',
    'reasons', 'evidenceUrl', 'lastChecked', 'archived', 'reviewNote', ...requiredFlags
  ];
  const evidenceFields = ['id', 'campaignId', 'url', 'fetchedAt', 'contentHash', 'note', 'content'];
  const historyFields = ['id', 'campaignId', 'fromStatus', 'toStatus', 'reason', 'occurredAt'];
  const sortedFields = fields => [...fields].sort();
  const hasExactFields = (value, fields) => {
    const keys = Object.keys(value).sort();
    const expected = sortedFields(fields);
    return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
  };

  function invalidBundle() {
    throw new Error('This file is not a supported PromoGuard read-only bundle.');
  }

  function validateBundle(input) {
    let bundle = input;
    if (typeof input === 'string') {
      try { bundle = JSON.parse(input); } catch { invalidBundle(); }
    }
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle) ||
        bundle.format !== 'promoguard.web-readonly' || bundle.contractVersion !== 1 ||
        bundle.readOnly !== true || !hasExactFields(bundle, ['format', 'contractVersion', 'exportedAt', 'readOnly', 'resources']) ||
        !bundle.resources || typeof bundle.resources !== 'object' || Array.isArray(bundle.resources) ||
        !hasExactFields(bundle.resources, ['campaigns', 'evidence', 'statusHistory']) ||
        !Array.isArray(bundle.resources.campaigns) || !Array.isArray(bundle.resources.evidence) ||
        !Array.isArray(bundle.resources.statusHistory)) invalidBundle();

    const campaignIds = new Set();
    for (const campaign of bundle.resources.campaigns) {
      if (!campaign || typeof campaign !== 'object' || Array.isArray(campaign) || !hasExactFields(campaign, campaignFields) ||
          !Number.isSafeInteger(campaign.id) || campaign.id < 1 ||
          campaignIds.has(campaign.id) || typeof campaign.name !== 'string' || campaign.name.length > 200 ||
          !allowedStatuses.has(campaign.status) || typeof campaign.archived !== 'boolean' ||
          !Array.isArray(campaign.reasons) || campaign.reasons.some(reason => typeof reason !== 'string')) invalidBundle();
      campaignIds.add(campaign.id);
      for (const flag of requiredFlags) {
        if (![true, false, null].includes(campaign[flag])) invalidBundle();
      }
    }
    for (const evidence of bundle.resources.evidence) {
      if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) || !hasExactFields(evidence, evidenceFields) ||
          !Number.isSafeInteger(evidence.id) || evidence.id < 1 ||
          !campaignIds.has(evidence.campaignId) || typeof evidence.url !== 'string' ||
          typeof evidence.fetchedAt !== 'string' || !/^[a-f0-9]{64}$/i.test(evidence.contentHash) ||
          !(evidence.content === null || typeof evidence.content === 'string') ||
          !(evidence.note === null || typeof evidence.note === 'string')) invalidBundle();
    }
    for (const event of bundle.resources.statusHistory) {
      if (!event || typeof event !== 'object' || Array.isArray(event) || !hasExactFields(event, historyFields) ||
          !Number.isSafeInteger(event.id) || event.id < 1 || !campaignIds.has(event.campaignId) ||
          !allowedStatuses.has(event.toStatus) ||
          typeof event.occurredAt !== 'string' ||
          !(event.fromStatus === null || allowedStatuses.has(event.fromStatus)) ||
          !(event.reason === null || typeof event.reason === 'string')) invalidBundle();
    }
    return bundle;
  }

  function parseFile(file, callback) {
    if (!file || file.size > MAX_BUNDLE_BYTES) {
      callback(new Error(`Choose a JSON bundle no larger than ${MAX_BUNDLE_BYTES / 1024 / 1024} MB.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try { callback(null, validateBundle(String(reader.result))); }
      catch (error) { callback(error); }
    };
    reader.onerror = () => callback(new Error('The selected file could not be read.'));
    reader.readAsText(file);
  }

  const api = Object.freeze({ MAX_BUNDLE_BYTES, validateBundle, parseFile });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PromoGuardBundle = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
