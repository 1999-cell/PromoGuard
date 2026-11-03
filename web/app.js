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
  const editor = document.getElementById('campaignEditor');
  const editorForm = document.getElementById('campaignEditorForm');
  const exportButton = document.getElementById('exportBundle');
  let importedBundle = null;
  let bundle = null;
  let dirty = false;
  let editingCampaignId = null;
  let editorTrigger = null;

  function text(tag, value, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value === null || value === undefined || value === '' ? 'Not provided' : String(value);
    return node;
  }

  function empty(container, message) {
    container.replaceChildren(text('p', message, 'empty'));
  }

  function tableRegion(table, label) {
    const region = document.createElement('div');
    region.className = 'table-scroll';
    region.setAttribute('role', 'region');
    region.setAttribute('aria-label', `${label}; scroll horizontally to view all columns`);
    region.tabIndex = 0;
    region.append(table);
    return region;
  }

  function clear() {
    importedBundle = null;
    bundle = null;
    dirty = false;
    editingCampaignId = null;
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
    exportButton.disabled = true;
    document.getElementById('draftStatus').textContent = 'Edits are unavailable until a bundle is imported.';
    if (editor.open) editor.close();
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
    table.setAttribute('aria-label', 'Campaign search results');
    const head = document.createElement('tr');
    ['Campaign', 'Status', 'Network', 'Reward', 'Archived', 'Reasons', 'Local copy'].forEach(label => {
      const heading = text('th', label);
      heading.scope = 'col';
      head.append(heading);
    });
    table.append(head);
    visible.forEach(item => {
      const row = document.createElement('tr');
      [
        item.name, item.status, item.network, item.rewardAmount,
        item.archived ? 'Yes' : 'No', item.reasons.join('; ') || 'None recorded'
      ].forEach(value => row.append(text('td', value)));
      const actionCell = document.createElement('td');
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Edit copy';
      edit.setAttribute('aria-label', `Edit local copy of ${item.name}`);
      edit.addEventListener('click', () => openEditor(item, edit));
      actionCell.append(edit);
      row.append(actionCell);
      table.append(row);
    });
    campaigns.replaceChildren(tableRegion(table, 'Campaign search results'));
  }

  function renderList(container, entries, columns, emptyMessage, label) {
    if (!entries.length) { empty(container, emptyMessage); return; }
    const table = document.createElement('table');
    table.setAttribute('aria-label', label);
    const head = document.createElement('tr');
    columns.forEach(([, label]) => {
      const heading = text('th', label);
      heading.scope = 'col';
      head.append(heading);
    });
    table.append(head);
    entries.forEach(entry => {
      const row = document.createElement('tr');
      columns.forEach(([key]) => row.append(text('td', entry[key])));
      table.append(row);
    });
    container.replaceChildren(tableRegion(table, label));
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
    ], 'No evidence revisions match this campaign.', 'Evidence revisions');
    renderList(history, visibleHistory, [
      ['campaignId', 'Campaign ID'], ['fromStatus', 'From'], ['toStatus', 'To'], ['reason', 'Reason'], ['occurredAt', 'When']
    ], 'No status history matches this campaign.', 'Status history');
  }

  function show(data) {
    importedBundle = data;
    bundle = window.PromoGuardBundle.cloneBundle(data);
    dirty = false;
    const items = bundle.resources;
    summary.replaceChildren(
      text('p', `${items.campaigns.length} campaign(s), ${items.evidence.length} evidence revision(s), ${items.statusHistory.length} status event(s).`),
      text('p', `Imported ${data.exportedAt}. The selected file is unchanged; working edits exist only in memory.`)
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
    document.getElementById('draftStatus').textContent = 'No edits yet. Edit a local copy to create a separate export.';
    exportButton.disabled = true;
    clearButton.disabled = false;
  }

  function openEditor(campaign, trigger) {
    editingCampaignId = campaign.id;
    editorTrigger = trigger;
    editorForm.elements.namedItem('name').value = campaign.name || '';
    editorForm.elements.namedItem('publisher').value = campaign.publisher || '';
    editorForm.elements.namedItem('network').value = campaign.network || '';
    editorForm.elements.namedItem('tokenId').value = campaign.tokenId || '';
    editorForm.elements.namedItem('rewardAmount').value = campaign.rewardAmount ?? '';
    editorForm.elements.namedItem('endDate').value = campaign.endDate || '';
    editorForm.elements.namedItem('archived').checked = campaign.archived;
    document.getElementById('editorStatus').textContent = `Editing ${campaign.name}. This does not change the imported file.`;
    editor.showModal();
    editorForm.elements.namedItem('name').focus();
  }

  function exportWorkingCopy() {
    if (!bundle || !dirty) return;
    try {
      const outputBundle = window.PromoGuardBundle.cloneBundle(bundle);
      outputBundle.exportedAt = new Date().toISOString();
      const output = JSON.stringify(window.PromoGuardBundle.validateBundle(outputBundle), null, 2);
      const blob = new Blob([output], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'promoguard-offline-edited-bundle.json';
      link.click();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      status.textContent = 'A new edited bundle was prepared for download. The imported file remains unchanged.';
    } catch (error) {
      status.textContent = `The edited bundle could not be exported: ${error.message || 'unknown error'}`;
    }
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
  document.getElementById('cancelEdit').addEventListener('click', () => editor.close());
  editor.addEventListener('close', () => {
    editingCampaignId = null;
    if (editorTrigger && editorTrigger.isConnected) editorTrigger.focus();
    editorTrigger = null;
  });
  editorForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!bundle || !Number.isSafeInteger(editingCampaignId)) return;
    const form = new FormData(editorForm);
    const reward = form.get('rewardAmount');
    const changes = {
      name: String(form.get('name') || ''),
      publisher: String(form.get('publisher') || '').trim() || null,
      network: String(form.get('network') || '').trim() || null,
      tokenId: String(form.get('tokenId') || '').trim() || null,
      rewardAmount: reward === '' ? null : Number(reward),
      endDate: String(form.get('endDate') || '') || null,
      archived: editorForm.elements.namedItem('archived').checked
    };
    try {
      bundle = window.PromoGuardBundle.editedBundle(bundle, editingCampaignId, changes, new Date().toISOString());
      dirty = true;
      editor.close();
      renderCampaigns(bundle.resources.campaigns);
      renderRelatedRecords();
      exportButton.disabled = false;
      document.getElementById('draftStatus').textContent = 'Working copy changed in memory. All edits mark the campaign Unverified; export creates a new file. Nothing is saved by this page.';
      status.textContent = 'Working copy updated. Imported file and evidence revisions remain unchanged.';
    } catch (error) {
      document.getElementById('editorStatus').textContent = `Changes were not applied: ${error.message || 'invalid campaign fields.'}`;
    }
  });
  exportButton.addEventListener('click', exportWorkingCopy);
  clear();
  registerOfflineShell();
})();
