'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

class Element {
  constructor(tag = '', document = null) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.disabled = false;
    this.files = [];
    this.value = '';
    this.attributes = {};
    this.document = document;
    this.isConnected = true;
  }

  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  click() {
    this.clicked = true;
    if (this.tag === 'a') this.document.downloads.push({ href: this.href, download: this.download });
    this.listeners.click?.();
  }
  dispatchEvent(event) { this.listeners[event.type]?.(event); }
  showModal() { this.open = true; }
  close() { this.open = false; this.listeners.close?.(); }
  focus() { this.document.activeElement = this; }
  reset() {}
  remove() { this.removed = true; }
}

test('campaign search and filter scope local records and invalid bundles preserve the current view', () => {
  const ids = ['bundleFile', 'importStatus', 'offlineStatus', 'summary', 'campaigns', 'campaignSearch', 'campaignSearchStatus', 'campaignFilter', 'filterStatus', 'evidence', 'history', 'clearBundle', 'campaignEditor', 'campaignEditorForm', 'cancelEdit', 'exportBundle', 'draftStatus', 'editorStatus', 'addDraftCampaign', 'draftCampaignDialog', 'draftCampaignForm', 'draftCampaignStatus', 'cancelDraftCampaign', 'discardChangesDialog', 'discardChangesMessage', 'keepLocalEdits', 'confirmDiscardLocalEdits'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const document = {
    getElementById: id => elements[id],
    createElement: tag => new Element(tag)
  };
  const window = {
    location: { protocol: 'file:', hostname: '' },
    isSecureContext: false,
    navigator: {},
    PromoGuardBundle: {
      cloneBundle: value => value,
      editedBundle: value => value,
      parseFile(file, callback) {
        callback(file.error || null, file.data || null);
      }
    }
  };
  const script = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  vm.runInNewContext(script, { document, window });
  assert.match(elements.offlineStatus.textContent, /requires HTTPS or localhost/);

  const campaign = {
    id: 1,
    name: 'Existing imported campaign',
    status: 'UNVERIFIED',
    network: null,
    rewardAmount: null,
    archived: false,
    reasons: []
  };
  const otherCampaign = { ...campaign, id: 2, name: 'Second campaign' };
  const evidence = id => ({
    id, campaignId: id, url: 'https://example.test/terms', fetchedAt: 'now',
    contentHash: 'a'.repeat(64), note: null, content: null
  });
  const history = id => ({
    id, campaignId: id, fromStatus: null, toStatus: 'UNVERIFIED',
    reason: null, occurredAt: 'now'
  });
  elements.bundleFile.files = [{
    data: {
      exportedAt: 'now',
      resources: {
        campaigns: [campaign, otherCampaign],
        evidence: [evidence(1), evidence(2)],
        statusHistory: [history(1), history(2)]
      }
    }
  }];
  elements.campaignSearch.value = 'stale filter from previous bundle';
  elements.bundleFile.listeners.change();
  let campaignRegion = elements.campaigns.children[0];
  let loadedRow = campaignRegion.children[0].children[1];
  assert.equal(campaignRegion.attributes.role, 'region');
  assert.match(campaignRegion.attributes['aria-label'], /Campaign search results/);
  assert.equal(campaignRegion.tabIndex, 0);
  assert.equal(campaignRegion.children[0].attributes['aria-label'], 'Campaign search results');
  assert.equal(campaignRegion.children[0].children[0].children[0].scope, 'col');
  assert.equal(loadedRow.children[0].textContent, campaign.name);
  assert.equal(elements.campaignSearch.value, '');
  assert.equal(elements.campaignSearchStatus.textContent, '2 campaign(s).');
  assert.equal(elements.campaignSearch.disabled, false);
  assert.equal(elements.campaignFilter.children.length, 3);
  assert.equal(elements.evidence.children[0].children[0].children.length, 3);
  assert.equal(elements.evidence.children[0].attributes.role, 'region');
  assert.equal(elements.evidence.children[0].tabIndex, 0);
  assert.equal(elements.evidence.children[0].children[0].attributes['aria-label'], 'Evidence revisions');
  assert.equal(elements.evidence.children[0].children[0].children[0].children[0].scope, 'col');
  assert.equal(elements.history.children[0].children[0].children.length, 3);
  assert.equal(elements.history.children[0].attributes.role, 'region');
  assert.equal(elements.history.children[0].tabIndex, 0);
  assert.equal(elements.history.children[0].children[0].attributes['aria-label'], 'Status history');
  assert.equal(elements.clearBundle.disabled, false);

  elements.campaignSearch.value = 'SECOND';
  elements.campaignSearch.listeners.input();
  assert.equal(elements.campaignSearchStatus.textContent, 'Showing 1 of 2 campaign(s).');
  assert.equal(elements.campaigns.children[0].children[0].children.length, 2);
  assert.equal(elements.campaigns.children[0].children[0].children[1].children[0].textContent, 'Second campaign');
  elements.campaignSearch.value = 'does not exist';
  elements.campaignSearch.listeners.input();
  assert.equal(elements.campaignSearchStatus.textContent, 'Showing 0 of 2 campaign(s).');
  assert.equal(elements.campaigns.children[0].textContent, 'No campaigns match this search.');
  elements.campaignSearch.value = '';
  elements.campaignSearch.listeners.input();
  loadedRow = elements.campaigns.children[0].children[0].children[1];

  elements.campaignFilter.value = '2';
  elements.campaignFilter.listeners.change();
  assert.equal(elements.filterStatus.textContent, 'Showing 1 evidence revision(s) and 1 status event(s) for Second campaign.');
  assert.equal(elements.evidence.children[0].children[0].children.length, 2);
  assert.equal(elements.evidence.children[0].children[0].children[1].children[0].textContent, '2');
  assert.equal(elements.history.children[0].children[0].children.length, 2);
  assert.equal(elements.history.children[0].children[0].children[1].children[0].textContent, '2');

  elements.bundleFile.files = [{ error: new Error('Rejected invalid bundle') }];
  elements.bundleFile.listeners.change();
  assert.equal(elements.importStatus.textContent, 'Rejected invalid bundle');
  assert.strictEqual(elements.campaigns.children[0].children[0].children[1], loadedRow);
  assert.equal(elements.clearBundle.disabled, false);
  assert.equal(elements.evidence.children[0].children[0].children[1].children[0].textContent, '2');

  elements.clearBundle.click();
  assert.equal(elements.importStatus.textContent, 'No bundle loaded. Your file stays on this device.');
  assert.equal(elements.campaigns.children[0].textContent, 'Import a bundle to view campaign records.');
  assert.equal(elements.campaignSearch.value, '');
  assert.equal(elements.campaignSearch.disabled, true);
  assert.equal(elements.campaignFilter.value, 'all');
  assert.equal(elements.campaignFilter.disabled, true);
  assert.equal(elements.clearBundle.disabled, true);
});

test('offline editing changes only an in-memory copy and exports a separate unverified bundle', () => {
  const ids = [
    'bundleFile', 'importStatus', 'offlineStatus', 'summary', 'campaigns',
    'campaignSearch', 'campaignSearchStatus', 'campaignFilter', 'filterStatus',
    'evidence', 'history', 'clearBundle', 'campaignEditor', 'campaignEditorForm',
    'exportBundle', 'draftStatus', 'cancelEdit', 'editorStatus', 'addDraftCampaign',
    'draftCampaignDialog', 'draftCampaignForm', 'draftCampaignStatus', 'cancelDraftCampaign',
    'discardChangesDialog', 'discardChangesMessage', 'keepLocalEdits', 'confirmDiscardLocalEdits'
  ];
  const document = { downloads: [], activeElement: null };
  document.body = new Element('body', document);
  const elements = Object.fromEntries(ids.map(id => [id, new Element('', document)]));
  const fields = ['name', 'publisher', 'network', 'tokenId', 'rewardAmount', 'endDate', 'archived'];
  const controls = Object.fromEntries(fields.map(name => [name, new Element('input', document)]));
  elements.campaignEditorForm.elements = { namedItem: name => controls[name] };
  const draftFields = ['name', 'publisher', 'network', 'tokenId', 'rewardAmount', 'endDate'];
  const draftControls = Object.fromEntries(draftFields.map(name => [name, new Element('input', document)]));
  elements.draftCampaignForm.elements = { namedItem: name => draftControls[name] };
  const blobs = [];
  const parsedFiles = [];
  let revoked = null;
  document.getElementById = id => elements[id];
  document.createElement = tag => new Element(tag, document);
  const api = require('../web/bundle');
  const window = {
    location: { protocol: 'file:', hostname: '' },
    isSecureContext: false,
    navigator: {},
    URL: {
      createObjectURL(blob) { blobs.push(blob); return 'blob:local-export'; },
      revokeObjectURL(url) { revoked = url; }
    },
    setTimeout(callback) { callback(); },
    PromoGuardBundle: {
      ...api,
      parseFile: (file, callback) => {
        parsedFiles.push(file);
        callback(file.error || null, file.data || imported);
      }
    }
  };
  class FormDataMock {
    constructor(form) { this.form = form; }
    get(name) {
      if (name === 'archived') return controls.archived.checked ? 'on' : null;
      return this.form.elements.namedItem(name).value;
    }
  }
  class BlobMock {
    constructor(parts, options) { this.parts = parts; this.options = options; }
    async text() { return this.parts.join(''); }
  }
  const imported = {
    format: 'promoguard.web-readonly',
    contractVersion: 1,
    exportedAt: '2026-11-03T00:00:00.000Z',
    readOnly: true,
    resources: {
      campaigns: [{
        id: 1, name: 'Original name', publisher: null, sourceUrl: null, network: null, tokenId: null,
        rewardAmount: null, endDate: null, status: 'ELIGIBLE_FOR_REVIEW', reasons: [], evidenceUrl: null,
        lastChecked: null, archived: false, reviewNote: null,
        ...Object.fromEntries([
          'requiresDeposit', 'requiresGas', 'requiresPurchase', 'requiresStaking', 'requiresPaidMint',
          'requiresSendingFunds', 'requiresUnlimitedApproval', 'requestsSeedPhrase', 'unclearSignature', 'unverifiedSite'
        ].map(flag => [flag, null]))
      }],
      evidence: [{
        id: 1, campaignId: 1, url: 'https://example.test/terms', fetchedAt: '2026-11-03T00:00:00.000Z',
        contentHash: 'c'.repeat(64), note: 'saved', content: 'Original terms'
      }],
      statusHistory: []
    }
  };
  const originalCopy = JSON.parse(JSON.stringify(imported));
  vm.runInNewContext(fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8'), {
    document, window, FormData: FormDataMock, Blob: BlobMock, console
  });

  elements.bundleFile.files = [{ name: 'input.json' }];
  elements.bundleFile.listeners.change();
  assert.equal(elements.exportBundle.disabled, true);
  const findEdit = node => {
    if (node.attributes['aria-label'] === 'Edit local copy of Original name') return node;
    for (const child of node.children) {
      const found = findEdit(child);
      if (found) return found;
    }
    return null;
  };
  const editButton = findEdit(elements.campaigns);
  assert.ok(editButton);
  editButton.click();
  assert.equal(elements.campaignEditor.open, true);
  controls.name.value = 'Changed locally';
  controls.publisher.value = 'Local note';
  controls.network.value = '';
  controls.tokenId.value = '';
  controls.rewardAmount.value = '0';
  controls.endDate.value = '';
  controls.archived.checked = true;
  elements.campaignEditorForm.dispatchEvent({ type: 'submit', preventDefault() {} });

  assert.deepEqual(imported, originalCopy);
  assert.equal(elements.campaignEditor.open, false);
  assert.equal(elements.exportBundle.disabled, false);
  assert.match(elements.draftStatus.textContent, /Unverified/);
  assert.match(elements.importStatus.textContent, /imported file and evidence revisions remain unchanged/i);
  assert.equal(elements.campaigns.children[0].children[0].children[1].children[0].textContent, 'Changed locally');
  assert.equal(elements.history.children[0].children[0].children[1].children[3].textContent, 'Offline companion edit; desktop review required.');

  elements.exportBundle.click();
  assert.equal(document.downloads.length, 1);
  assert.equal(document.downloads[0].download, 'promoguard-offline-working-copy.json');
  assert.equal(revoked, 'blob:local-export');
  assert.equal(window.navigator.serviceWorker, undefined);
  assert.equal(window.networkRequests, undefined);
  return blobs[0].text().then(output => {
    const exported = api.validateBundle(output);
    assert.equal(exported.resources.campaigns[0].status, 'UNVERIFIED');
    assert.equal(exported.resources.campaigns[0].name, 'Changed locally');
    assert.equal(exported.resources.campaigns[0].rewardAmount, 0);
    assert.equal(exported.resources.campaigns[0].archived, true);
    assert.equal(exported.resources.evidence[0].contentHash, 'c'.repeat(64));
    elements.addDraftCampaign.click();
    assert.equal(elements.draftCampaignDialog.open, true);
    draftControls.name.value = 'New local draft';
    draftControls.publisher.value = 'Unverified publisher';
    draftControls.network.value = '';
    draftControls.tokenId.value = '';
    draftControls.rewardAmount.value = '';
    draftControls.endDate.value = '';
    elements.draftCampaignForm.dispatchEvent({ type: 'submit', preventDefault() {} });
    assert.equal(elements.draftCampaignDialog.open, false);
    assert.equal(imported.resources.campaigns.length, 1);
    assert.equal(imported.resources.evidence[0].contentHash, 'c'.repeat(64));
    assert.match(elements.draftStatus.textContent, /desktop review is required/i);
    assert.equal(elements.exportBundle.disabled, false);
    elements.exportBundle.click();
    return blobs[1].text();
  }).then(output => {
    const exported = api.validateBundle(output);
    const draft = exported.resources.campaigns.find(item => item.name === 'New local draft');
    assert.ok(draft);
    assert.equal(draft.status, 'UNVERIFIED');
    assert.equal(draft.archived, false);
    assert.ok(Object.keys(draft).filter(key => key.startsWith('requires') || ['requestsSeedPhrase', 'unclearSignature', 'unverifiedSite'].includes(key))
      .every(key => draft[key] === null));
    assert.equal(exported.resources.evidence.length, 1);
    assert.equal(exported.resources.evidence[0].contentHash, 'c'.repeat(64));
    assert.match(exported.resources.statusHistory.find(entry => entry.campaignId === draft.id).reason, /desktop review required/i);

    const replacement = JSON.parse(JSON.stringify(imported));
    replacement.resources.campaigns[0].name = 'Replacement bundle campaign';
    elements.bundleFile.files = [{ name: 'replacement.json', data: replacement }];
    elements.bundleFile.listeners.change();
    assert.equal(elements.discardChangesDialog.open, true);
    assert.equal(parsedFiles.length, 1);
    elements.keepLocalEdits.click();
    assert.equal(parsedFiles.length, 1);
    assert.equal(elements.exportBundle.disabled, false);
    assert.ok(elements.campaigns.children[0].children[0].children.some(row => row.children?.[0]?.textContent === 'New local draft'));
    elements.bundleFile.files = [{ name: 'invalid.json', error: new Error('Rejected replacement') }];
    elements.bundleFile.listeners.change();
    assert.equal(elements.discardChangesDialog.open, true);
    elements.confirmDiscardLocalEdits.click();
    assert.equal(parsedFiles.length, 2);
    assert.equal(elements.importStatus.textContent, 'Rejected replacement');
    assert.equal(elements.exportBundle.disabled, false);
    assert.ok(elements.campaigns.children[0].children[0].children.some(row => row.children?.[0]?.textContent === 'New local draft'));
    elements.bundleFile.files = [{ name: 'replacement.json', data: replacement }];
    elements.bundleFile.listeners.change();
    assert.equal(parsedFiles.length, 2);
    elements.confirmDiscardLocalEdits.click();
    assert.equal(parsedFiles.length, 3);
    assert.equal(elements.exportBundle.disabled, true);
    assert.equal(elements.campaigns.children[0].children[0].children[1].children[0].textContent, 'Replacement bundle campaign');

    elements.addDraftCampaign.click();
    draftControls.name.value = 'Clear confirmation draft';
    elements.draftCampaignForm.dispatchEvent({ type: 'submit', preventDefault() {} });
    elements.clearBundle.click();
    assert.equal(elements.discardChangesDialog.open, true);
    elements.keepLocalEdits.click();
    assert.equal(elements.exportBundle.disabled, false);
    assert.ok(elements.campaigns.children[0].children[0].children.some(row => row.children?.[0]?.textContent === 'Clear confirmation draft'));
    elements.clearBundle.click();
    assert.equal(elements.discardChangesDialog.open, true);
    elements.confirmDiscardLocalEdits.click();
    assert.deepEqual(imported.resources.campaigns.map(item => item.name), ['Original name']);
    assert.equal(elements.exportBundle.disabled, true);
    assert.equal(elements.campaignEditor.open, false);
  });
});

test('offline companion blocks API connections and does not use browser persistence', () => {
  const html = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8');
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(app, /\b(?:localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|WebSocket)\b/);
});
