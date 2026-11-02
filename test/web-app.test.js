'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag = '') {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.disabled = false;
    this.files = [];
    this.value = '';
  }

  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes ||= {}; this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  click() { this.listeners.click(); }
}

test('campaign search and filter scope local records and invalid bundles preserve the current view', () => {
  const ids = ['bundleFile', 'importStatus', 'offlineStatus', 'summary', 'campaigns', 'campaignSearch', 'campaignSearchStatus', 'campaignFilter', 'filterStatus', 'evidence', 'history', 'clearBundle'];
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
