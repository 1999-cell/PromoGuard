'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Narrow surface: no generic invoke, no signing, no transactions.
const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('pg', Object.freeze({
  getSettings: () => inv('settings:get'), setMinReward: v => inv('settings:setMinReward', Number(v)),
  addApprovedDomain: domain => inv('settings:addApprovedDomain', String(domain)),
  removeApprovedDomain: domain => inv('settings:removeApprovedDomain', String(domain)),
  setUpdateCheckUrl: url => inv('settings:setUpdateCheckUrl', url),
  addCampaign: c => inv('campaign:add', c), listCampaigns: () => inv('campaign:list'), listArchivedCampaigns: () => inv('campaign:listArchived'),
  saveCampaignTermsSnapshot: (id, url, content) => inv('campaign:evidenceSnapshot', Number(id), { url: String(url), content: String(content) }),
  listCampaignTermsSnapshots: id => inv('campaign:evidenceList', Number(id)),
  getCampaignTermsSnapshot: (id, evidenceId) => inv('campaign:evidenceGet', Number(id), Number(evidenceId)),
  fetchCampaignTerms: (url, expectedEvidenceUrl) => inv('campaign:fetchTerms', String(url), expectedEvidenceUrl ? String(expectedEvidenceUrl) : null),
  verifySource: (url, expectedEvidenceUrl) => inv('campaign:verifySource', String(url), expectedEvidenceUrl ? String(expectedEvidenceUrl) : null),
  compareSnapshots: (campaignId, idA, idB) => inv('campaign:compareSnapshots', Number(campaignId), Number(idA), Number(idB)),
  editCampaign: (id, changes) => inv('campaign:edit', Number(id), changes || {}),
  archiveCampaign: (id, archived) => inv('campaign:archive', Number(id), Boolean(archived)),
  reviewStart: id => inv('review:start', Number(id)), reviewReject: (id, n) => inv('review:reject', Number(id), String(n || '')),
  reviewEvidence: (id, ev) => inv('review:evidence', Number(id), ev),
  listFeeds: () => inv('feeds:list'), addFeed: u => inv('feeds:add', String(u)), removeFeed: u => inv('feeds:remove', String(u)), runDiscovery: () => inv('discovery:run'),
  enableSchedule: m => inv('schedule:enable', Number(m)), disableSchedule: () => inv('schedule:disable'),
  tonState: () => inv('ton:state'), tonSetManifest: u => inv('ton:setManifest', String(u)), tonSetNetwork: n => inv('ton:setNetwork', String(n)),
  tonWallets: () => inv('ton:wallets'), tonConnect: n => inv('ton:connect', String(n)), tonDisconnect: () => inv('ton:disconnect'),
  tonEnableData: () => inv('ton:enableData'), tonRevokeData: () => inv('ton:revokeData'), tonRefresh: () => inv('ton:refresh'),
  tonDashboard: () => inv('ton:dashboard'), tonExplorer: () => inv('ton:explorer'), tonWipeLocal: () => inv('ton:wipeLocal'),
  wcState: () => inv('wc:state'), wcSetProjectId: i => inv('wc:setProjectId', String(i)), wcSetRpc: (n, u) => inv('wc:setRpc', String(n), String(u)),
  wcConnect: n => inv('wc:connect', Array.isArray(n) ? n.map(String) : []), wcSelect: n => inv('wc:select', String(n)), wcEnableData: () => inv('wc:enableData'),
  wcRefresh: () => inv('wc:refresh'), wcDashboard: () => inv('wc:dashboard'), wcDisconnect: () => inv('wc:disconnect'), wcExplorer: () => inv('wc:explorer'), wcWipeLocal: () => inv('wc:wipeLocal'), wcRevokeData: () => inv('wc:revokeData'),
  clearWalletMetadata: () => inv('wallet:clearMetadata'), openLink: u => inv('link:open', String(u)),
  // Claim preparation (Phase 5, approve-intent only, no signing)
  claimPrepare: (campaign, context) => inv('claim:prepare', campaign, context || {}),
  claimFeeCheck: (campaign) => inv('claim:feeCheck', campaign),
  claimSubmit: (campaignId, opts) => inv('claim:submit', Number(campaignId), opts || {}),
  claimList: () => inv('claim:list'),
  claimEvidence: (campaignId, ev) => inv('claim:evidence', Number(campaignId), ev || {}),
  claimMonitor: () => inv('claim:monitor'),
  // Backup / import / export
  backupExport: () => inv('backup:export'),
  backupImport: () => inv('backup:import'),
  exportWebBundle: () => inv('webBundle:export'),
  // AI / MCP (Phase 6, advisory only, read-only)
  aiSummarize: (t) => inv('ai:summarize', String(t)),
  aiExtract: (t) => inv('ai:extract', String(t)),
  aiCompare: (t) => inv('ai:compare', String(t)),
  aiRisk: (t, ind) => inv('ai:risk', { campaignText: String(t), indicators: Array.isArray(ind) ? ind : [] }),
  aiEvidence: (name, ev) => inv('ai:evidence', { campaignName: String(name), evidence: ev || {} }),
  mcpListTools: () => inv('mcp:listTools'),
  mcpInvoke: (tool, args) => inv('mcp:invoke', String(tool), args || {}),
  mcpGrant: (tool) => inv('mcp:grant', String(tool)),
  mcpRevoke: (tool) => inv('mcp:revoke', String(tool)),
  // Phase 7: health, notifications, alerts, receipts
  healthGet: () => inv('health:get'),
  notificationsList: () => inv('notifications:list'),
  notificationsDismiss: (id) => inv('notifications:dismiss', Number(id)),
  notificationsAdd: (kind, refId, msg) => inv('notifications:add', String(kind), refId || null, String(msg)),
  alertsList: () => inv('alerts:list'),
  receiptsList: () => inv('receipts:list'),
  // Analytics: read-only graphical data aggregates
  analyticsOverview: () => inv('analytics:overview'),
  analyticsCampaigns: () => inv('analytics:campaigns'),
  analyticsHistory: () => inv('analytics:history'),
  analyticsFlags: () => inv('analytics:flags'),
  analyticsRewards: () => inv('analytics:rewards'),
  analyticsActivity: () => inv('analytics:activity'),
  analyticsStatusTransitions: () => inv('analytics:statusTransitions'),
  // Update check
  updateCheck: () => inv('update:check')
}));
