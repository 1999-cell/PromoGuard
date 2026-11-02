'use strict';

(() => {
  const picker = document.getElementById('bundleFile');
  const status = document.getElementById('importStatus');
  const offlineStatus = document.getElementById('offlineStatus');
  const summary = document.getElementById('summary');
  const campaigns = document.getElementById('campaigns');
  const campaignSearch = document.getElementById('campaignSearch');
  const campaignSearchStatus = document.getElementById('campaignSearchStatus');
  const campaignFilter = document.getElementById('campaignFilter');
  const filterStatus = document.getElementById('filterStatus');
  const evidence = document.getElementById('evidence');
  const history = document.getElementById('history');
  const clearButton = document.getElementById('clearBundle');
  let bundle = null;

  function text(tag, value, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value === null || value === undefined || value === '' ? 'Not provided' : String(value);
    return node;
  }

  function empty(container, message) {
    container.replaceChildren(text('p', message, 'empty'));
  }

  function clear() {
    bundle = null;
    picker.value = '';
    status.textContent = 'No bundle loaded. Your file stays on this device.';
    summary.replaceChildren();
    empty(campaigns, 'Import a bundle to view campaign records.');
    campaignSearch.value = '';
    campaignSearch.disabled = true;
    campaignSearchStatus.textContent = 'Import a bundle to search campaigns.';
    campaignFilter.replaceChildren(text('option', 'All campaigns'));
    campaignFilter.children[0].value = 'all';
    campaignFilter.value = 'all';
    campaignFilter.disabled = true;
    filterStatus.textContent = 'Import a bundle to filter its evidence and history.';
    empty(evidence, 'Evidence revisions appear after a bundle is imported.');
    empty(history, 'Status history appears after a bundle is imported.');
    clearButton.disabled = true;
  }

  function renderCampaigns(resources) {
    const query = campaignSearch.value.trim().toLowerCase();
    const visible = resources.filter(item => [
      item.name, item.publisher, item.network, item.status, ...item.reasons
    ].some(value => value && String(value).toLowerCase().includes(query)));
    campaignSearchStatus.textContent = query
      ? `Showing ${visible.length} of ${resources.length} campaign(s).`
      : `${resources.length} campaign(s).`;
    if (!visible.length) {
      empty(campaigns, 'No campaigns match this search.');
      return;
    }
    const table = document.createElement('table');
    const head = document.createElement('tr');
    ['Campaign', 'Status', 'Network', 'Reward', 'Archived', 'Reasons'].forEach(label => head.append(text('th', label)));
    table.append(head);
    visible.forEach(item => {
      const row = document.createElement('tr');
      [
        item.name, item.status, item.network, item.rewardAmount,
        item.archived ? 'Yes' : 'No', item.reasons.join('; ') || 'None recorded'
      ].forEach(value => row.append(text('td', value)));
      table.append(row);
    });
    campaigns.replaceChildren(table);
  }

  function renderList(container, entries, columns, emptyMessage) {
    if (!entries.length) { empty(container, emptyMessage); return; }
    const table = document.createElement('table');
    const head = document.createElement('tr');
    columns.forEach(([, label]) => head.append(text('th', label)));
    table.append(head);
    entries.forEach(entry => {
      const row = document.createElement('tr');
      columns.forEach(([key]) => row.append(text('td', entry[key])));
      table.append(row);
    });
    container.replaceChildren(table);
  }

  function renderRelatedRecords() {
    if (!bundle) return;
    const items = bundle.resources;
    const selected = campaignFilter.value;
    const matches = entry => selected === 'all' || String(entry.campaignId) === selected;
    const visibleEvidence = items.evidence.filter(matches);
    const visibleHistory = items.statusHistory.filter(matches);
    const selectedCampaign = items.campaigns.find(item => String(item.id) === selected);
    filterStatus.textContent = selectedCampaign
      ? `Showing ${visibleEvidence.length} evidence revision(s) and ${visibleHistory.length} status event(s) for ${selectedCampaign.name}.`
      : `Showing ${visibleEvidence.length} evidence revision(s) and ${visibleHistory.length} status event(s) across all campaigns.`;
    renderList(evidence, visibleEvidence, [
      ['campaignId', 'Campaign ID'], ['url', 'Evidence URL'], ['fetchedAt', 'Captured'], ['contentHash', 'SHA-256'], ['note', 'Provenance note'], ['content', 'Text snapshot']
    ], 'No evidence revisions match this campaign.');
    renderList(history, visibleHistory, [
      ['campaignId', 'Campaign ID'], ['fromStatus', 'From'], ['toStatus', 'To'], ['reason', 'Reason'], ['occurredAt', 'When']
    ], 'No status history matches this campaign.');
  }

  function show(data) {
    bundle = data;
    const items = data.resources;
    summary.replaceChildren(
      text('p', `${items.campaigns.length} campaign(s), ${items.evidence.length} evidence revision(s), ${items.statusHistory.length} status event(s).`),
      text('p', `Exported ${data.exportedAt}. Read-only snapshot; not synced.`)
    );
    campaignSearch.value = '';
    campaignSearch.disabled = items.campaigns.length === 0;
    renderCampaigns(items.campaigns);
    campaignFilter.replaceChildren(text('option', 'All campaigns'));
    campaignFilter.children[0].value = 'all';
    items.campaigns.forEach(item => {
      const option = text('option', `${item.name} (#${item.id})`);
      option.value = String(item.id);
      campaignFilter.append(option);
    });
    campaignFilter.value = 'all';
    campaignFilter.disabled = items.campaigns.length === 0;
    renderRelatedRecords();
    status.textContent = 'Bundle loaded locally. No network request was made.';
    clearButton.disabled = false;
  }

  function registerOfflineShell() {
    const location = window.location;
    const serviceWorker = window.navigator && window.navigator.serviceWorker;
    const localHttpOrigin = location && location.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname.toLowerCase());
    const secureOrigin = location && window.isSecureContext
      && (location.protocol === 'https:' || localHttpOrigin);

    if (!secureOrigin || !serviceWorker) {
      offlineStatus.textContent = 'Installable offline mode requires HTTPS or localhost. Direct file import remains available.';
      return;
    }

    offlineStatus.textContent = 'Preparing offline app support…';
    serviceWorker.register('./service-worker.js', { scope: './' })
      .then(() => {
        offlineStatus.textContent = 'Offline app support is ready. Use your browser menu to install; select the exported bundle each time you open it.';
      })
      .catch(error => {
        offlineStatus.textContent = `Offline app support could not be enabled: ${error.message}. Bundle import still works.`;
      });
  }

  picker.addEventListener('change', () => {
    const file = picker.files && picker.files[0];
    if (!file) return;
    status.textContent = 'Validating selected bundle…';
    window.PromoGuardBundle.parseFile(file, (error, data) => {
      if (error) {
        status.textContent = error.message;
        clearButton.disabled = false;
        return;
      }
      show(data);
    });
  });
  campaignSearch.addEventListener('input', () => {
    if (bundle) renderCampaigns(bundle.resources.campaigns);
  });
  campaignFilter.addEventListener('change', renderRelatedRecords);
  clearButton.addEventListener('click', clear);
  clear();
  registerOfflineShell();
})();
