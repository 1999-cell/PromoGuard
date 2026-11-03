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

  function cloneBundle(input) {
    return JSON.parse(JSON.stringify(validateBundle(input)));
  }

  function editedBundle(input, campaignId, changes, editedAt) {
    const bundle = cloneBundle(input);
    if (!Number.isSafeInteger(campaignId) || !changes || typeof changes !== 'object' || Array.isArray(changes)) invalidBundle();
    const allowed = new Set(['name', 'publisher', 'network', 'tokenId', 'rewardAmount', 'endDate', 'archived']);
    if (Object.keys(changes).length === 0 || Object.keys(changes).some(key => !allowed.has(key))) invalidBundle();
    const campaign = bundle.resources.campaigns.find(item => item.id === campaignId);
    if (!campaign) invalidBundle();

    const stringFields = { publisher: 200, network: 80, tokenId: 256, endDate: 32 };
    if (Object.hasOwn(changes, 'name')) {
      if (typeof changes.name !== 'string' || !changes.name.trim() || changes.name.trim().length > 200) invalidBundle();
      campaign.name = changes.name.trim();
    }
    for (const [field, maxLength] of Object.entries(stringFields)) {
      if (!Object.hasOwn(changes, field)) continue;
      const value = changes[field];
      if (value !== null && (typeof value !== 'string' || value.length > maxLength)) invalidBundle();
      campaign[field] = typeof value === 'string' && value.trim() ? value.trim() : null;
    }
    if (Object.hasOwn(changes, 'endDate') && campaign.endDate !== null) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(campaign.endDate);
      if (!match) invalidBundle();
      const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      if (date.toISOString().slice(0, 10) !== campaign.endDate) invalidBundle();
    }
    if (Object.hasOwn(changes, 'rewardAmount')) {
      const amount = changes.rewardAmount;
      if (amount !== null && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0)) invalidBundle();
      campaign.rewardAmount = amount;
    }
    if (Object.hasOwn(changes, 'archived')) {
      if (typeof changes.archived !== 'boolean') invalidBundle();
      campaign.archived = changes.archived;
    }

    const previousStatus = campaign.status;
    campaign.status = 'UNVERIFIED';
    campaign.reasons = [...campaign.reasons, 'Offline companion edit; desktop review required.'];
    const historyIds = new Set(bundle.resources.statusHistory.map(entry => entry.id));
    let nextHistoryId = 1;
    while (historyIds.has(nextHistoryId)) nextHistoryId += 1;
    bundle.resources.statusHistory.push({
      id: nextHistoryId,
      campaignId,
      fromStatus: previousStatus,
      toStatus: 'UNVERIFIED',
      reason: 'Offline companion edit; desktop review required.',
      occurredAt: editedAt
    });
    return validateBundle(bundle);
  }

  function createdDraftBundle(input, draft, createdAt) {
    const bundle = cloneBundle(input);
    const fields = ['name', 'publisher', 'network', 'tokenId', 'rewardAmount', 'endDate'];
    if (!draft || typeof draft !== 'object' || Array.isArray(draft) || !hasExactFields(draft, fields) ||
        typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt)) ||
        new Date(createdAt).toISOString() !== createdAt) invalidBundle();

    const stringFields = { publisher: 200, network: 80, tokenId: 256, endDate: 32 };
    if (typeof draft.name !== 'string' || !draft.name.trim() || draft.name.trim().length > 200) invalidBundle();
    for (const [field, maxLength] of Object.entries(stringFields)) {
      if (draft[field] !== null &&
          (typeof draft[field] !== 'string' || draft[field].length > maxLength)) invalidBundle();
    }
    if (draft.endDate !== null) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draft.endDate);
      if (!match) invalidBundle();
      const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      if (date.toISOString().slice(0, 10) !== draft.endDate) invalidBundle();
    }
    if (draft.rewardAmount !== null &&
        (typeof draft.rewardAmount !== 'number' || !Number.isFinite(draft.rewardAmount) || draft.rewardAmount < 0)) invalidBundle();

    const nextUnusedId = usedIds => {
      let candidate = 1;
      while (usedIds.has(candidate)) {
        if (candidate === Number.MAX_SAFE_INTEGER) invalidBundle();
        candidate += 1;
      }
      return candidate;
    };
    const campaignIds = new Set(bundle.resources.campaigns.map(campaign => campaign.id));
    const campaignId = nextUnusedId(campaignIds);
    const historyId = nextUnusedId(new Set(bundle.resources.statusHistory.map(event => event.id)));
    const warning = 'Created in offline companion; desktop review required. This draft is not evidence of eligibility or payment.';
    const campaign = {
      id: campaignId,
      name: draft.name.trim(),
      publisher: draft.publisher?.trim() || null,
      sourceUrl: null,
      network: draft.network?.trim() || null,
      tokenId: draft.tokenId?.trim() || null,
      rewardAmount: draft.rewardAmount,
      endDate: draft.endDate,
      status: 'UNVERIFIED',
      reasons: [warning],
      evidenceUrl: null,
      lastChecked: null,
      archived: false,
      reviewNote: 'Draft created locally; review in PromoGuard desktop before relying on any campaign details.',
      ...Object.fromEntries(requiredFlags.map(flag => [flag, null]))
    };
    bundle.resources.campaigns.push(campaign);
    bundle.resources.statusHistory.push({
      id: historyId,
      campaignId,
      fromStatus: null,
      toStatus: 'UNVERIFIED',
      reason: warning,
      occurredAt: createdAt
    });
    return validateBundle(bundle);
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

  const api = Object.freeze({ MAX_BUNDLE_BYTES, validateBundle, cloneBundle, editedBundle, createdDraftBundle, parseFile });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PromoGuardBundle = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
