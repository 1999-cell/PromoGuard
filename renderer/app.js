(() => {
'use strict';
if (!window.pg) {
  const notice = document.getElementById('runtimeNotice');
  notice.replaceChildren(
    Object.assign(document.createElement('strong'), { textContent: 'Browser preview mode' }),
    document.createTextNode(' — This page cannot access PromoGuard’s secure local database, feeds, wallets, or AI. To use the full app, close this tab and double-click '),
    Object.assign(document.createElement('code'), { textContent: 'Start PromoGuard.bat' }),
    document.createTextNode(' in the project folder, or run '),
    Object.assign(document.createElement('code'), { textContent: 'npm start' }),
    document.createTextNode(' from that folder. Preview navigation is available; service controls are disabled.')
  );
  notice.hidden = false;
  document.querySelectorAll('input, select, textarea').forEach(control => { control.disabled = true; });
  document.querySelectorAll('button:not([data-view]):not(#navToggle)').forEach(button => { button.disabled = true; });
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    const name = button.dataset.view;
    document.querySelectorAll('[data-view-panel]').forEach(panel => {
      const active = panel.dataset.viewPanel === name;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    const heading = document.querySelector(`[data-view-panel="${name}"] h1`);
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    document.querySelectorAll('[data-view]').forEach(item => {
      const active = item.dataset.view === name;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    document.getElementById('pageTitle').textContent = { overview: 'Overview', promoguard: 'PromoGuard', markets: 'Markets', predictions: 'Predictions (Paper)', wallets: 'Wallet Center', activity: 'Activity', analytics: 'Analytics', settings: 'Settings & AI' }[name] || 'Overview';
    document.body.classList.remove('sidebar-open');
    const toggle = document.getElementById('navToggle');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation');
    document.getElementById('mobileBackdrop').hidden = true;
  }));
  document.querySelectorAll('[data-view-link]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    document.querySelector(`[data-view="${link.dataset.viewLink}"]`)?.click();
  }));
  const toggle = document.getElementById('navToggle'), backdrop = document.getElementById('mobileBackdrop');
  toggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('sidebar-open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    backdrop.hidden = !open;
    if (open) document.querySelector('.primary-nav [data-view]')?.focus();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !document.body.classList.contains('sidebar-open')) return;
    document.body.classList.remove('sidebar-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation');
    backdrop.hidden = true;
    toggle.focus();
  });
  backdrop.addEventListener('click', () => {
    document.body.classList.remove('sidebar-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation');
    backdrop.hidden = true;
    toggle.focus();
  });
  return;
}
const LABEL = { DISCOVERED: 'Discovered', UNVERIFIED: 'Unverified. Do not claim', UNDER_REVIEW: 'Under review', INELIGIBLE: 'Ineligible',
  ELIGIBLE_FOR_REVIEW: 'Eligible for review', AWAITING_USER_APPROVAL: 'Awaiting your approval', CLAIM_SUBMITTED: 'Claim submitted',
  REWARD_PENDING: 'Reward pending confirmation', REWARD_RECEIVED: 'Received (on-chain)', EXPIRED: 'Expired', REJECTED: 'Rejected', FAILED: 'Failed' };
const cls = s => s === 'ELIGIBLE_FOR_REVIEW' ? 'eligible' : (s === 'REJECTED' || s === 'INELIGIBLE') ? 'rejected' : (s === 'REWARD_RECEIVED') ? 'eligible' : (s === 'CLAIM_SUBMITTED' || s === 'REWARD_PENDING' || s === 'AWAITING_USER_APPROVAL') ? 'warn' : 'unverified';
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x !== undefined) n.textContent = x; return n; };
const say = (id, t) => { document.getElementById(id).textContent = t; };
const showAppError = message => {
  const box = document.getElementById('appError');
  box.textContent = `This action could not be completed. ${message || 'Check the app state and try again.'}`;
  box.hidden = false;
};
const clearAppError = () => { document.getElementById('appError').hidden = true; };
window.addEventListener('unhandledrejection', event => {
  event.preventDefault();
  const reason = event.reason;
  const message = reason && reason.message ? reason.message : String(reason || 'Unexpected application error');
  console.error('PromoGuard action failed:', reason);
  showAppError(message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
});
window.addEventListener('error', event => {
  console.error('PromoGuard renderer error:', event.error || event.message);
  showAppError('The interface encountered an unexpected error. Please restart the app if it continues.');
});
const viewNames = { overview: 'Overview', promoguard: 'PromoGuard', markets: 'Markets', predictions: 'Predictions (Paper)', wallets: 'Wallet Center', activity: 'Activity', analytics: 'Analytics', settings: 'Settings & AI' };
function setView(name) {
  if (!viewNames[name]) return;
  document.querySelectorAll('[data-view-panel]').forEach(panel => {
    const active = panel.dataset.viewPanel === name;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  const heading = document.querySelector(`[data-view-panel="${name}"] h1`);
  if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === name;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.getElementById('pageTitle').textContent = viewNames[name];
  document.body.classList.remove('sidebar-open');
  const toggle = document.getElementById('navToggle');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Open navigation');
  document.getElementById('mobileBackdrop').hidden = true;
  clearAppError();
  if (name === 'analytics') renderAnalytics();
  if (name === 'activity') { renderHealth(); renderNotifications(); renderAlerts(); renderReceipts(); }
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('[data-view-link]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  setView(link.dataset.viewLink);
}));
document.getElementById('navToggle').addEventListener('click', () => {
  const open = document.body.classList.toggle('sidebar-open');
  document.getElementById('navToggle').setAttribute('aria-expanded', String(open));
  document.getElementById('navToggle').setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  document.getElementById('mobileBackdrop').hidden = !open;
  if (open) document.querySelector('.primary-nav [data-view]')?.focus();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !document.body.classList.contains('sidebar-open')) return;
  document.body.classList.remove('sidebar-open');
  const toggle = document.getElementById('navToggle');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Open navigation');
  document.getElementById('mobileBackdrop').hidden = true;
  toggle.focus();
});
document.getElementById('mobileBackdrop').addEventListener('click', () => {
  document.body.classList.remove('sidebar-open');
  const toggle = document.getElementById('navToggle');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Open navigation');
  document.getElementById('mobileBackdrop').hidden = true;
  toggle.focus();
});
const FLAGS = ['requiresDeposit','requiresGas','requiresPurchase','requiresStaking','requiresPaidMint','requiresSendingFunds','requiresUnlimitedApproval','requestsSeedPhrase','unclearSignature','unverifiedSite'];
function reviewForm(r) {
  const f = el('form', 'rev');
  const url = Object.assign(el('input'), { type: 'url', placeholder: 'Official terms URL (https)', required: true });
  const terms = Object.assign(el('textarea'), { rows: 8, maxLength: 100000, placeholder: 'Paste the current official terms text here. PromoGuard records the text you provide; it does not fetch or independently verify this page.' });
  const amt = Object.assign(el('input'), { type: 'number', step: 'any', placeholder: 'Published reward amount' });
  const tok = Object.assign(el('input'), { placeholder: 'Token ID (network + contract)' });
  const urlLabel = el('label', 'field'); urlLabel.append(el('span', '', 'Official terms URL'), url);
  const termsLabel = el('label', 'field'); termsLabel.append(el('span', '', 'Terms text snapshot (paste from the official page)'), terms);
  const fetchBtn = Object.assign(el('button', 'button button-secondary', 'Fetch official terms'), { type: 'button' });
  const fetchStatus = el('p', 'fetch-status'); fetchStatus.setAttribute('role', 'status');
  const amountLabel = el('label', 'field'); amountLabel.append(el('span', '', 'Published reward amount'), amt);
  const tokenLabel = el('label', 'field'); tokenLabel.append(el('span', '', 'Token ID'), tok);
  const snapshotHelp = el('small', '', 'Manual evidence only: no site is contacted. Verify the source yourself, remove any personal information, and keep the URL identical to the snapshot URL.');
  const snapshotStatus = el('p', 'snapshot-status');
  snapshotStatus.setAttribute('role', 'status');
  const history = el('div', 'snapshot-history');
  const lab = el('label', 'check-inline'); const cb = Object.assign(el('input'), { type: 'checkbox' });
  lab.append(cb, document.createTextNode(' I reviewed the terms and confirmed no payment-related conditions apply'));
  const sourceLab = el('label', 'check-inline'); const sourceCb = Object.assign(el('input'), { type: 'checkbox' });
  sourceLab.append(sourceCb, document.createTextNode(' I independently verified that this is the official project source'));
  const save = el('button', 'button button-secondary', 'Save terms snapshot');
  save.type = 'button';
  const go = el('button', '', 'Submit evidence');
  f.append(urlLabel, termsLabel, fetchBtn, fetchStatus, snapshotHelp, save, snapshotStatus, history, amountLabel, tokenLabel, lab, sourceLab, go);
  const loadHistory = async () => {
    const snapshots = await pg.listCampaignTermsSnapshots(r.id);
    history.replaceChildren(el('strong', '', `Saved terms snapshots: ${snapshots.length}`));
    if (!snapshots.length) history.append(el('p', 'empty-state', 'No terms snapshot saved. A snapshot is required before a campaign can pass local review.'));
    snapshots.forEach(snapshot => {
      const item = el('div', 'snapshot-item');
      item.append(
        el('small', '', `${snapshot.fetched_at} · ${snapshot.url}`),
        el('code', '', `SHA-256 ${snapshot.content_hash}`)
      );
      const load = el('button', 'button button-quiet', 'Load saved text for review');
      load.type = 'button';
      load.addEventListener('click', async () => {
        try {
          const saved = await pg.getCampaignTermsSnapshot(r.id, snapshot.id);
          if (!saved) throw new Error('saved snapshot is unavailable');
          url.value = saved.url;
          terms.value = saved.content;
          snapshotStatus.textContent = 'Loaded an immutable saved snapshot for review. Editing this text does not change the saved revision.';
        } catch (error) { snapshotStatus.textContent = `Could not load snapshot: ${error.message || 'try again.'}`; }
      });
      item.append(load);
      history.append(item);
    });

    // Snapshot version diff
    const diffSection = el('div', 'snapshot-diff');
    const diffTitle = el('h3', '', 'Compare snapshot revisions');
    const diffNote = el('small', '', 'Select two saved revisions to see what changed between them.');
    const selA = Object.assign(el('select'), { className: 'diff-select' });
    const selB = Object.assign(el('select'), { className: 'diff-select' });
    snapshots.forEach(s => {
      const label = `${s.fetched_at} · SHA-256 ${s.content_hash.slice(0, 12)}`;
      selA.append(Object.assign(el('option'), { value: s.id, textContent: label }));
      selB.append(Object.assign(el('option'), { value: s.id, textContent: label }));
    });
    if (snapshots.length >= 2) selB.value = snapshots[1].id;
    const cmpBtn = Object.assign(el('button', 'button button-secondary', 'Compare revisions'), { type: 'button' });
    const diffResult = el('div', 'diff-result');
    diffResult.setAttribute('role', 'status');
    diffResult.setAttribute('aria-live', 'polite');
    diffResult.setAttribute('aria-atomic', 'true');
    const revisionALabel = el('label', 'field'); revisionALabel.append(el('span', '', 'Earlier revision'), selA);
    const revisionBLabel = el('label', 'field'); revisionBLabel.append(el('span', '', 'Later revision'), selB);
    diffSection.append(diffTitle, diffNote, revisionALabel, revisionBLabel, cmpBtn, diffResult);
    history.append(diffSection);

    cmpBtn.addEventListener('click', async () => {
      const idA = Number(selA.value); const idB = Number(selB.value);
      if (idA === idB) { diffResult.textContent = 'Select two different revisions.'; return; }
      diffResult.textContent = 'Comparing…';
      try {
        const result = await pg.compareSnapshots(r.id, idA, idB);
        diffResult.replaceChildren();
        const summary = el('div', 'diff-summary');
        summary.append(el('b', '', `Revision ${result.snapshotA.id} → ${result.snapshotB.id}`),
          el('span', '', ` +${result.summary.added} / -${result.summary.removed} lines, ${result.summary.unchanged} unchanged`));
        diffResult.append(summary);
        const diffTable = el('div', 'diff-table');
        diffTable.setAttribute('role', 'list');
        result.diff.forEach(op => {
          const row = el('div', `diff-row diff-${op.type}`);
          row.setAttribute('role', 'listitem');
          row.setAttribute('aria-label', `${op.type === 'added' ? 'Added' : op.type === 'removed' ? 'Removed' : 'Unchanged'} line: ${op.line || 'blank line'}`);
          const marker = el('span', 'diff-marker', op.type === 'added' ? '+' : op.type === 'removed' ? '-' : ' ');
          marker.setAttribute('aria-hidden', 'true');
          const content = el('span', 'diff-content', op.line);
          row.append(marker, content);
          diffTable.append(row);
        });
        diffResult.append(diffTable);
      } catch (error) { diffResult.textContent = `Comparison failed: ${error.message || 'try again.'}`; }
    });
  };
  loadHistory().catch(error => { snapshotStatus.textContent = `Could not load saved evidence: ${error.message || 'try again.'}`; });
  save.addEventListener('click', async () => {
    snapshotStatus.textContent = 'Saving snapshot…';
    try {
      const result = await pg.saveCampaignTermsSnapshot(r.id, url.value, terms.value);
      snapshotStatus.textContent = `${result.duplicate ? 'This exact snapshot was already saved.' : 'Snapshot saved.'} SHA-256 ${result.contentHash}. User-provided text; not fetched or independently verified.`;
      await loadHistory();
    } catch (error) {
      snapshotStatus.textContent = `Snapshot was not saved: ${error.message || 'check the URL and pasted text.'}`;
    }
  });
  fetchBtn.addEventListener('click', async () => {
    fetchStatus.textContent = 'Fetching official terms…';
    try {
      const fetched = await pg.fetchCampaignTerms(url.value, r.evidence || undefined);
      terms.value = fetched.content;
      url.value = fetched.url;
      const verification = await pg.verifySource(url.value, r.evidence || undefined);
      const matchNote = verification.ownershipMatch === null ? '' : verification.ownershipMatch ? ' Source domain matches the campaign evidence URL.' : ' WARNING: fetched domain does not match the campaign evidence URL — treat as unverified.';
      const dnsNote = verification.allAddressesPublic === false ? ' DNS resolves to non-public address(es).' : verification.dnsResolution.error ? ` DNS lookup: ${verification.dnsResolution.error}.` : ` DNS resolves to ${verification.dnsResolution.addresses.join(', ')}.`;
      const verifiedNote = verification.verified ? ' Source verification: PASS.' : ' Source verification: FAIL — do not treat fetched terms as verified evidence.';
      fetchStatus.textContent = `Fetched ${fetched.bytes} bytes from ${fetched.url}. Review the text before saving — fetched content is not independently verified.${fetched.redirects.length ? ` Followed ${fetched.redirects.length} redirect(s).` : ''}${matchNote}${dnsNote}${verifiedNote}`;
    } catch (error) {
      fetchStatus.textContent = `Terms could not be fetched: ${error.message || 'check the URL and try again.'}`;
    }
  });
  f.addEventListener('submit', async e => { e.preventDefault();
    try {
      const res = await pg.reviewEvidence(r.id, { evidenceUrl: url.value, confirmFree: cb.checked, confirmOfficialSource: sourceCb.checked,
        rewardAmount: amt.value === '' ? undefined : Number(amt.value), tokenId: tok.value || undefined });
      say('result', `${LABEL[res.status]}${res.reasons.length ? ': ' + res.reasons.join(', ') : ''}`); render();
    } catch (error) { snapshotStatus.textContent = `Review was not submitted: ${error.message || 'check the evidence and try again.'}`; }
  });
  return f;
}
function claimForm(r) {
  const f = el('div', 'claim');
  const go = el('button', 'button button-secondary', 'Run read-only checks');
  go.type = 'button';
  go.addEventListener('click', async () => {
    const prep = await pg.claimPrepare(r, {});
    const fee = await pg.claimFeeCheck(r);
    const box = document.getElementById('claimform');
    const result = el('div', 'row unverified claim-result');
    result.append(el('div', 'tag', 'Read-only preflight — not a claim'));
    result.append(el('div', '', `Result: ${prep.reason === 'official_terms_not_fetched' ? 'Blocked: no saved terms snapshot matches this campaign URL.' : prep.final || 'Not available'}`));
    result.append(el('div', '', `Local fee-condition check: ${fee.allowed ? 'conditions are recorded as clear' : 'blocked'} — ${fee.reason || 'No reason returned'}`));
    if (Array.isArray(prep.pipeline)) {
      const stages = el('ul');
      prep.pipeline.forEach(stage => {
        const item = el('li', '', `${stage.stage}: ${stage.ok ? 'passed' : stage.reason || 'not passed'}`);
        stages.append(item);
      });
      result.append(stages);
    }
    box.replaceChildren(result);
  });
  f.append(go);
  return f;
}
async function renderClaims() {
  const records = await pg.claimList(), box = document.getElementById('claimlist');
  box.replaceChildren();
  if (!records.length) { box.append(el('p', 'empty', 'No claim or preparation records.')); return; }
  const preparations = records.filter(c => c.state === 'AWAITING_USER_APPROVAL');
  const active = records.filter(c => c.state !== 'AWAITING_USER_APPROVAL');
  if (active.length) {
    box.append(el('h3', '', 'Monitoring records'));
    active.forEach(c => {
      const d = el('div', 'row ' + cls(c.state));
      d.append(el('div', 'tag', `${c.name}: ${LABEL[c.state] || c.state}`),
        el('div', '', `${c.network}, wallet ${c.wallet}, expected ${c.expected_amount_nano || c.expected_amount_wei || 'amount not set'}`),
        el('small', '', `Fee check: ${c.fee_check_result || 'none'}. ${c.tx_hash ? 'Tx: ' + c.tx_hash : 'No tx yet.'}`));
      const mon = el('button', '', 'Check for confirmation');
      mon.onclick = async () => { const result = await pg.claimMonitor(); say('claimresult', `${result.results.length} monitoring result(s).`); renderClaims(); };
      d.append(mon); box.append(d);
    });
  }
  if (preparations.length) {
    box.append(el('h3', '', 'Saved preflight records — not submitted'));
    preparations.forEach(c => {
      const d = el('div', 'row unverified');
      d.append(el('div', 'tag', `${c.name}: preparation only`),
        el('div', '', `${c.network}, wallet ${c.wallet}`),
        el('small', '', 'No transaction was submitted. Confirmation monitoring is not available for a preparation record.'));
      box.append(d);
    });
  }
}
const editCampaignDialog = document.getElementById('editCampaignDialog');
const editCampaignForm = document.getElementById('editCampaignForm');
let editingCampaignId = null;
let campaignEditorTrigger = null;
function openCampaignEditor(campaign) {
  editingCampaignId = campaign.id;
  campaignEditorTrigger = document.activeElement;
  const form = editCampaignForm.elements;
  form.namedItem('name').value = campaign.name || '';
  form.namedItem('network').value = campaign.network || '';
  form.namedItem('tokenId').value = campaign.token_id || '';
  form.namedItem('rewardAmount').value = campaign.reward_amount ?? '';
  form.namedItem('endDate').value = campaign.end_date || '';
  document.getElementById('editCampaignStatus').textContent = '';
  editCampaignDialog.showModal();
  form.namedItem('name').focus();
}
document.getElementById('cancelCampaignEdit').addEventListener('click', () => editCampaignDialog.close());
editCampaignDialog.addEventListener('close', () => {
  editingCampaignId = null;
  if (campaignEditorTrigger?.isConnected) campaignEditorTrigger.focus();
  campaignEditorTrigger = null;
});
editCampaignForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!Number.isSafeInteger(editingCampaignId)) return;
  const form = new FormData(editCampaignForm);
  const reward = form.get('rewardAmount');
  const changes = {
    name: String(form.get('name') || ''),
    network: String(form.get('network') || '').trim() || null,
    tokenId: String(form.get('tokenId') || '').trim() || null,
    rewardAmount: reward === '' ? null : Number(reward),
    endDate: String(form.get('endDate') || '') || null
  };
  const submit = editCampaignForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const result = await pg.editCampaign(editingCampaignId, changes);
    say('result', `Campaign updated. Status: ${LABEL[result.status] || result.status}${result.reasons.length ? ' · ' + result.reasons.join(', ') : ''}`);
    editCampaignDialog.close();
    await render();
    const heading = document.getElementById('campaigns-title');
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  } catch (error) {
    document.getElementById('editCampaignStatus').textContent = `Campaign could not be updated: ${error.message || 'try again.'}`;
  } finally {
    submit.disabled = false;
  }
});
async function render() {
  const showArchived = document.getElementById('showArchived')?.checked === true;
  const rows = await (showArchived ? pg.listArchivedCampaigns() : pg.listCampaigns()), box = document.getElementById('list');
  const n = statuses => rows.filter(r => statuses.includes(r.status)).length;
  const tally = document.getElementById('tally'); tally.replaceChildren();
  [['Campaigns tracked', rows.length, ''], ['Eligible for review', n(['ELIGIBLE_FOR_REVIEW']), 'stat-accent'], ['Under review', n(['UNDER_REVIEW']), ''], ['Rejected', n(['REJECTED', 'INELIGIBLE']), 'stat-danger']].forEach(([k, v, tone]) => {
    const d = el('div', 'stat-card'); d.setAttribute('role', 'listitem'); d.append(el('b', tone, v), el('span', '', k)); tally.append(d); });

  const recent = document.getElementById('overview-recent');
  recent.replaceChildren();
  if (!rows.length) recent.append(el('p', 'empty-state', 'Campaigns you add or discover will appear here.'));
  else rows.slice(0, 4).forEach(r => {
    const item = el('div', 'recent-item');
    const detail = el('div');
    detail.append(el('strong', '', r.name || 'Unnamed campaign'), el('small', '', `${r.network || 'Network not set'} · updated ${r.last_checked || 'unknown'}`));
    const status = el('span', `status-pill recent-status ${r.status === 'ELIGIBLE_FOR_REVIEW' ? 'status-eligible' : r.status === 'REJECTED' || r.status === 'INELIGIBLE' ? 'status-error' : 'status-warning'}`, LABEL[r.status] || r.status);
    item.append(detail, status);
    recent.append(item);
  });

  const search = (document.getElementById('campaignSearch').value || '').trim().toLowerCase();
  const selectedStatus = document.getElementById('campaignStatus').value;
  const filtered = rows.filter(r => {
    if (!showArchived && r.archived) return false;
    const statusMatch = selectedStatus === 'all' || (selectedStatus === 'REJECTED' ? ['REJECTED', 'INELIGIBLE'].includes(r.status) : r.status === selectedStatus);
    const searchMatch = !search || [r.name, r.description, r.source_url, r.network, r.token_id].some(value => String(value || '').toLowerCase().includes(search));
    return statusMatch && searchMatch;
  });
  const listStatus = document.getElementById('campaignListStatus');
  const statusText = `Showing ${filtered.length} of ${rows.length} campaign record${rows.length === 1 ? '' : 's'}.${filtered.length ? '' : ' No records match the selected filters.'}`;
  if (listStatus.textContent !== statusText) listStatus.textContent = statusText;
  box.replaceChildren();
  if (!filtered.length) {
    const emptyResult = el('p', 'empty-state', rows.length ? 'No campaigns match these filters.' : 'No campaigns yet. Add one from its official terms or discover a lead below.');
    emptyResult.setAttribute('role', 'listitem');
    box.append(emptyResult);
    renderClaims();
    return;
  }
  box.replaceChildren(...filtered.map(r => {
    const d = el('div', 'row ' + cls(r.status));
    d.setAttribute('role', 'listitem');
    d.append(el('div', 'tag', `${r.name}: ${LABEL[r.status] || r.status}`),
      el('div', '', `${r.network || 'no network'}, ${r.reward_amount ?? 'amount not published'} ${r.token_id || ''}, ends ${r.end_date || 'unknown'}`),
      el('div', '', `Reasons: ${safeReasons(r.reasons).join(', ') || 'none recorded'}`),
      el('small', '', `Terms snapshots: ${r.evidence_count || 0}${r.latest_evidence_hash ? ` · latest SHA-256 ${r.latest_evidence_hash}` : ''}. User-provided evidence is not independently verified.`),
      el('small', '', `History: ${r.history || 'none'}. Last checked ${r.last_checked}. Estimated or pending rewards are never counted as received.`));
    if (r.status === 'UNVERIFIED') { const b = el('button', '', 'Start review'); b.onclick = async () => { await pg.reviewStart(r.id); render(); }; d.append(b); }
    if (r.status === 'ELIGIBLE_FOR_REVIEW') { const b = el('button', '', 'Re-review terms'); b.onclick = async () => { await pg.reviewStart(r.id); render(); }; d.append(b); }
    if (r.status === 'UNDER_REVIEW') d.append(reviewForm(r));
    if (['UNVERIFIED', 'UNDER_REVIEW', 'ELIGIBLE_FOR_REVIEW'].includes(r.status)) { const b = el('button', '', 'Reject'); b.onclick = async () => { await pg.reviewReject(r.id, 'rejected by user'); render(); }; d.append(b); }
    if (r.status === 'ELIGIBLE_FOR_REVIEW') d.append(claimForm(r));
    const editB = el('button', 'button-quiet', 'Edit'); editB.setAttribute('aria-label', `Edit ${r.name}`); editB.onclick = () => openCampaignEditor(r); d.append(editB);
    const archB = el('button', 'button-quiet', r.archived ? 'Unarchive' : 'Archive'); archB.onclick = async () => {
      try { await pg.archiveCampaign(r.id, !r.archived); say('result', `Campaign ${r.archived ? 'unarchived' : 'archived'}.`); render(); } catch (error) { showAppError(`Archive failed: ${error.message || 'try again.'}`); }
    }; d.append(archB);
    return d; }));
  renderClaims();
  if (!document.getElementById('view-analytics').hidden) renderAnalytics();
}
function safeReasons(value) {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return ['Stored review reasons could not be read']; }
}
document.getElementById('campaignSearch').addEventListener('input', render);
document.getElementById('campaignStatus').addEventListener('change', render);
document.getElementById('showArchived').addEventListener('change', render);
document.getElementById('backupExport').addEventListener('click', async () => {
  try { const res = await pg.backupExport(); say('dres', res.exported ? `Backup exported: ${res.campaigns} campaign(s) to ${res.path}` : 'Export cancelled.'); } catch (error) { showAppError(`Export failed: ${error.message || 'try again.'}`); }
});
document.getElementById('backupImport').addEventListener('click', async () => {
  try { const res = await pg.backupImport(); if (!res.imported) { say('dres', 'Import cancelled.'); return; } say('dres', `Imported ${res.importedCount} campaign(s), skipped ${res.skippedCount} duplicate(s).`); render(); } catch (error) { showAppError(`Import failed: ${error.message || 'try again.'}`); }
});
document.getElementById('webBundleExport').addEventListener('click', async () => {
  try {
    const result = await pg.exportWebBundle();
    say('dres', result.exported ? `Read-only web bundle exported: ${result.campaigns} campaign(s) to ${result.path}` : 'Web bundle export cancelled.');
  } catch (error) { showAppError(`Web bundle export failed: ${error.message || 'try again.'}`); }
});
document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault(); clearAppError(); const f = new FormData(e.target), free = f.get('confirmFree') === 'on';
  const c = { name: f.get('name'), sourceUrl: f.get('sourceUrl'), network: f.get('network'), tokenId: f.get('tokenId'),
    rewardAmount: f.get('rewardAmount') === '' ? undefined : Number(f.get('rewardAmount')), endDate: f.get('endDate') || undefined };
  FLAGS.filter(k => k !== 'unverifiedSite').forEach(k => { if (free) c[k] = false; });
  if (f.get('confirmOfficialSource') === 'on') c.unverifiedSite = false;
  const r = await pg.addCampaign(c);
  say('result', r.duplicate ? 'Already tracked (duplicate source).' : `${LABEL[r.status]}${r.reasons.length ? ': ' + r.reasons.join(', ') : ''}`); render();
});
document.getElementById('ff').addEventListener('submit', async e => { e.preventDefault();
  try {
    const result = await pg.addFeed(new FormData(e.target).get('url'));
    if (result.added) e.target.reset();
    say('dres', result.added ? 'Feed added. Scheduled checks need new consent.' : 'That feed is already configured.');
    await renderFeeds();
  }
  catch (error) { say('dres', `Feed was not added: ${error.message || 'check the URL and try again.'}`); } });
document.getElementById('run').addEventListener('click', async () => { const r = await pg.runDiscovery();
  say('dres', `${r.note || ''} Found ${r.found}, added ${r.added}, expired ${r.expired || 0}. ${(r.errors || []).join('; ')}`); render(); });
async function renderFeeds() {
  const [feeds, settings] = await Promise.all([pg.listFeeds(), pg.getSettings()]);
  const box = document.getElementById('feedList');
  box.replaceChildren();
  if (!feeds.length) box.append(el('p', 'empty-state', 'No feeds configured.'));
  feeds.forEach(feed => {
    const item = el('div', 'feed-item');
    let host = 'Configured HTTPS feed';
    try { host = new URL(feed).hostname; } catch {}
    item.append(el('span', '', host));
    const remove = el('button', 'button button-quiet', 'Remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove feed from ${host}`);
    remove.addEventListener('click', async () => {
      try {
        await pg.removeFeed(feed);
        say('dres', 'Feed removed. Scheduled checks were disabled and need new consent.');
        await renderFeeds();
      } catch (error) { say('dres', `Could not remove feed: ${error.message || 'try again.'}`); }
    });
    item.append(remove);
    box.append(item);
  });
  document.getElementById('mins').value = settings.intervalMinutes || 60;
  document.getElementById('scheduleStatus').textContent = settings.scheduleEnabled
    ? `Enabled. Checks run every ${settings.intervalMinutes} minutes for the configured sites.`
    : 'Disabled. Enabling asks for separate consent for the selected sites and interval.';
}
document.getElementById('sched').addEventListener('click', async () => {
  try {
    const enabled = await pg.enableSchedule(Number(document.getElementById('mins').value));
    say('dres', enabled ? 'Scheduled checks enabled.' : 'Scheduled checks were not enabled.');
    await renderFeeds();
  } catch (error) { say('dres', `Schedule was not enabled: ${error.message || 'check the interval and configured feeds.'}`); }
});
document.getElementById('unsched').addEventListener('click', async () => {
  try { await pg.disableSchedule(); say('dres', 'Scheduled checks disabled.'); await renderFeeds(); }
  catch (error) { say('dres', `Schedule could not be disabled: ${error.message || 'restart the app and try again.'}`); }
});
renderFeeds();

const fmt = (v, d = 9) => { const s = BigInt(v).toString().padStart(d + 1, '0'), f = s.slice(-d).replace(/0+$/, ''); return f ? `${s.slice(0, -d)}.${f}` : s.slice(0, -d); };
const TXL = { confirmed: 'Confirmed on-chain', failed: 'Failed', unknown: 'Unconfirmed' };
let lastAddr = '';
async function renderTon() {
  const { state: st, data } = await pg.tonDashboard(), box = document.getElementById('tondash'), top = document.getElementById('tonstate');
  document.getElementById('net').value = st.selectedNetwork; lastAddr = st.wallet ? st.wallet.friendly : '';
  document.getElementById('wdata').hidden = st.status !== 'connected' || !st.match || !st.match.ok || st.dataConsent;
  document.getElementById('wrevoke').hidden = !st.dataConsent;
  const test = st.selectedNetwork === 'ton-testnet';
  top.textContent = st.status === 'connected' ? `Connected: ${st.wallet.name} on ${st.wallet.network}` : st.status === 'connecting' ? 'Waiting for approval in your wallet...' : st.error ? `Problem: ${st.error}` : st.manifestSet ? 'Manifest configured. Not connected.' : 'Set a public HTTPS TON Connect manifest to connect.';
  box.replaceChildren();
  if (st.status !== 'connected') return;
  if (st.match && !st.match.ok) box.append(el('p', 'note', `Network mismatch: your wallet is on ${st.match.walletNetwork || 'an unsupported network'} but PromoGuard is set to ${st.selectedNetwork}. No data is requested until they match.`));
  box.append(el('div', '', `Address: ${st.wallet.friendly}`), el('small', '', `Raw: ${st.wallet.address}, chain ${st.wallet.chain}. ${st.persistentSession ? 'Session stored with OS encryption.' : 'Session kept in memory only.'}`));
  if (!st.dataConsent) { box.append(el('p', 'empty', 'Balances and history are off. Allow lookups to send your public address to TON Center.')); return; }
  if (!data || !data.snapshot) { box.append(el('p', 'empty', 'No data yet. Press Refresh.')); return; }
  const s = data.snapshot; box.append(el('div', 'tag', `${fmt(s.native_balance_nano)} ${test ? 'test TON (no real value)' : 'TON'}`),
    el('small', '', `Source: ${s.provider}. Retrieved ${s.retrieved}. Not a price; no fiat value is shown.`));
  box.append(el('h3', '', 'Tokens'));
  if (!s.tokens.length) box.append(el('p', 'empty', 'No tokens found by the provider.'));
  s.tokens.forEach(t => box.append(el('div', 'row unverified', `${t.rawBalance} raw units. Token ${t.tokenId}. Metadata unverified, symbol not trusted.`)));
  box.append(el('h3', '', 'Incoming transfers'));
  if (!data.txs.length) box.append(el('p', 'empty', 'No incoming transfers found.'));
  data.txs.forEach(t => box.append(el('div', 'row ' + (t.status === 'confirmed' ? 'eligible' : 'unverified'), `${fmt(t.amount_nano)} from ${t.counterparty}: ${TXL[t.status] || t.status}. Hash ${t.tx_hash}, ${t.ts || 'time unknown'}`)));
}
const tonAct = (id, fn) => document.getElementById(id).addEventListener('click', async () => { try { await fn(); } catch (e) { say('tonstate', 'Problem: ' + String(e.message).replace(/^Error invoking remote method '[^']+': Error: /, '')); } renderTon(); });
tonAct('setm', () => pg.tonSetManifest(document.getElementById('manifest').value));
document.getElementById('net').addEventListener('change', async e => { await pg.tonSetNetwork(e.target.value); renderTon(); });
tonAct('wload', async () => { const l = await pg.tonWallets(), s = document.getElementById('wsel'); s.replaceChildren(...l.map(w => Object.assign(el('option'), { value: w.name, textContent: w.name }))); });
tonAct('wconn', async () => { await pg.tonConnect(document.getElementById('wsel').value); });
tonAct('wdis', () => pg.tonDisconnect()); tonAct('wdata', () => pg.tonEnableData()); tonAct('wrevoke', () => pg.tonRevokeData()); tonAct('wrefresh', () => pg.tonRefresh()); tonAct('wexp', () => pg.tonExplorer());
tonAct('wcopy', async () => { if (lastAddr) await navigator.clipboard.writeText(lastAddr); });
tonAct('wwipe', async () => { if (confirm('Erase the TON wallet session, cached balances and transfers, and revoke lookup consent? The saved manifest URL will remain.')) await pg.tonWipeLocal(); });
setInterval(renderTon, 3000); renderTon();

let wcAddr = '';
async function renderWc() {
  const { state: st, data, symbol } = await pg.wcDashboard(), box = document.getElementById('wcdash'), top = document.getElementById('wcstate'); box.replaceChildren();
  document.getElementById('wcdata').hidden = !st.selected || !st.rpcConfigured || st.dataConsent;
  document.getElementById('wcrevoke').hidden = !st.dataConsent;
  top.textContent = st.status === 'connected' ? 'Connected via WalletConnect' : st.status === 'connecting' ? 'Waiting for approval in Trust Wallet...' : st.error ? `Problem: ${st.error}` : st.projectIdSet && !st.projectIdPersistent ? 'Project ID is available for this session only; re-enter it after restarting.' : st.projectIdSet ? 'Project ID configured. Not connected.' : 'Add a WalletConnect project ID first';
  if (st.status !== 'connected') { if (st.status !== 'connecting') document.getElementById('wcqr').hidden = true; return; }
  document.getElementById('wcqr').hidden = true;
  if (st.unsupported.length) box.append(el('p', 'note', `Unsupported networks ignored: ${st.unsupported.join(', ')}.`));
  if (!st.accounts.length) { box.append(el('p', 'note', 'The wallet shared no supported account. Reconnect and approve a supported network.')); return; }
  const sel = st.accounts.find(a => a.network === st.selected); wcAddr = sel.address;
  const pick = Object.assign(el('select'), {}); st.accounts.forEach(a => pick.append(Object.assign(el('option'), { value: a.network, textContent: `${a.name}${a.testnet ? ' (test)' : ''}` }))); pick.value = st.selected;
  const networkLabel = el('label', 'field'); networkLabel.append(el('span', '', 'Wallet network'), pick);
  pick.onchange = async () => { await pg.wcSelect(pick.value); renderWc(); }; box.append(networkLabel, el('div', '', `Address: ${sel.address}`), el('small', '', `Network ${sel.network}. ${st.persistentSession ? 'Session stored with OS encryption.' : 'Session kept in memory only.'}`));
  if (!st.rpcConfigured) { box.append(el('p', 'note', 'No RPC provider is configured for this network. Add one above to read balances.')); return; }
  if (!st.dataConsent) { box.append(el('p', 'empty', 'Balance lookups are off. Allow them to send your public address to the RPC provider.')); return; }
  if (!data || !data.snapshot) { box.append(el('p', 'empty', 'No data yet. Press Refresh.')); return; }
  const s = data.snapshot; box.append(el('div', 'tag', `${fmt(s.native_balance_nano, 18)} ${symbol}${sel.testnet ? ' (no real value)' : ''}`), el('small', '', `Source: ${s.provider}. Retrieved ${s.retrieved}. A rise in balance is an observed change, not a verified receipt. No tokens or history shown.`));
}
const wcAct = (id, fn) => document.getElementById(id).addEventListener('click', async () => { try { await fn(); } catch (e) { say('wcstate', 'Problem: ' + String(e.message).replace(/^Error invoking remote method '[^']+': Error: /, '')); } renderWc(); });
const wnet = () => document.getElementById('wcnet').value;
wcAct('wcsetpid', async () => { await pg.wcSetProjectId(document.getElementById('wcpid').value); document.getElementById('wcpid').value = ''; });
wcAct('wcsetrpc', () => pg.wcSetRpc(wnet(), document.getElementById('wcrpc').value));
wcAct('wcconn', async () => { const qr = await pg.wcConnect([wnet()]); const i = document.getElementById('wcqr'); if (qr) { i.src = qr; i.hidden = false; } });
wcAct('wcdis', () => pg.wcDisconnect()); wcAct('wcdata', () => pg.wcEnableData()); wcAct('wcrevoke', () => pg.wcRevokeData()); wcAct('wcrefresh', () => pg.wcRefresh()); wcAct('wcexp', () => pg.wcExplorer());
wcAct('wccopy', async () => { if (wcAddr) await navigator.clipboard.writeText(wcAddr); });
wcAct('wcwipe', async () => { if (confirm('Erase the WalletConnect session, project ID, cached balances and transfers, and revoke lookup consent? The saved RPC URL will remain.')) await pg.wcWipeLocal(); });
setInterval(renderWc, 3000); renderWc();
document.getElementById('clear').addEventListener('click', async () => {
  if (!confirm('Delete locally stored wallet connections, balance snapshots, transfers, and revoke all lookup permissions? Saved encrypted wallet sessions are not removed.')) return;
  try { await pg.clearWalletMetadata(); await renderTon(); await renderWc(); say('wcstate', 'Local wallet metadata cleared and lookup permissions revoked.'); }
  catch (error) { showAppError(`Wallet metadata could not be cleared: ${error.message || 'try again.'}`); }
});
render();

async function renderMcp() {
  const tools = await pg.mcpListTools(), box = document.getElementById('mcptools'), cons = document.getElementById('mcpconsent');
  box.replaceChildren(); cons.replaceChildren();
  if (!tools.length) { box.append(el('p', 'empty', 'No MCP tools available.')); return; }
  tools.forEach(t => {
    const d = el('div', 'row ' + (t.granted ? 'eligible' : 'unverified'));
    d.append(el('div', 'tag', t.name),
      el('small', '', `Granted: ${t.granted ? 'yes' : 'no'}`));
    const g = el('button', '', t.granted ? 'Revoke' : 'Grant');
    g.onclick = async () => { await (t.granted ? pg.mcpRevoke(t.name) : pg.mcpGrant(t.name)); renderMcp(); };
    d.append(g);
    box.append(d);
  });
  cons.append(el('p', 'note', 'MCP tools are read-only. Each tool needs your explicit consent before it can be invoked.'));
}
document.getElementById('aisum').addEventListener('click', async () => {
  const t = document.getElementById('aitext').value; if (!t) return;
  const r = await pg.aiSummarize(t); say('airesult', r.content);
});
document.getElementById('aiextract').addEventListener('click', async () => {
  const t = document.getElementById('aitext').value; if (!t) return;
  const r = await pg.aiExtract(t); say('airesult', r.content);
});
document.getElementById('aicomp').addEventListener('click', async () => {
  const t = document.getElementById('aitext').value; if (!t) return;
  const r = await pg.aiCompare(t); say('airesult', r.content);
});
document.getElementById('airisk').addEventListener('click', async () => {
  const t = document.getElementById('aitext').value; if (!t) return;
  const r = await pg.aiRisk(t, []); say('airesult', r.content);
});
document.getElementById('aievidence').addEventListener('click', async () => {
  const t = document.getElementById('aitext').value; if (!t) return;
  const r = await pg.aiEvidence('campaign', { text: t }); say('airesult', r.content);
});
document.getElementById('mcpinvoke').addEventListener('click', async () => {
  const name = document.getElementById('mcpname').value; let args = {};
  try { args = JSON.parse(document.getElementById('mcpparams').value || '{}'); } catch { say('mcpresult', 'Invalid JSON arguments.'); return; }
  try { const r = await pg.mcpInvoke(name, args); say('mcpresult', JSON.stringify(r, null, 2)); } catch (e) { say('mcpresult', 'Error: ' + e.message); }
  renderMcp();
});
renderMcp();

async function renderApprovedDomains() {
  const settings = await pg.getSettings();
  const box = document.getElementById('approvedDomains');
  const domains = Array.isArray(settings.approvedDomains) ? settings.approvedDomains : [];
  box.replaceChildren();
  if (!domains.length) {
    box.append(el('p', 'empty-state', 'No domains are approved. Add a domain only after independently checking it.'));
    return;
  }
  domains.forEach(domain => {
    const item = el('div', 'domain-item');
    item.append(el('span', '', domain));
    const remove = el('button', '', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${domain} from the domain allow-list`);
    remove.addEventListener('click', async () => {
      try {
        const result = await pg.removeApprovedDomain(domain);
        say('domainStatus', `Removed ${domain}. Existing campaigns need another review to apply the updated list.`);
        renderApprovedDomains();
        render();
        return result;
      } catch (error) { say('domainStatus', `Could not remove domain: ${error.message || 'try again.'}`); }
    });
    item.append(remove);
    box.append(item);
  });
}
document.getElementById('domainForm').addEventListener('submit', async event => {
  event.preventDefault();
  clearAppError();
  const input = document.getElementById('domainInput');
  try {
    const result = await pg.addApprovedDomain(input.value);
    input.value = '';
    say('domainStatus', result.added ? 'Domain added to the local allow-list. This does not verify that it is legitimate.' : 'That domain is already on the local allow-list.');
    await renderApprovedDomains();
  } catch (error) { say('domainStatus', `Domain was not added: ${error.message || 'check the domain and try again.'}`); }
});
renderApprovedDomains();

async function renderMinReward() {
  const settings = await pg.getSettings();
  const input = document.getElementById('minRewardInput');
  if (document.activeElement !== input) input.value = settings.minReward;
}
document.getElementById('saveMinReward').addEventListener('click', async () => {
  const input = document.getElementById('minRewardInput');
  const value = input.valueAsNumber;
  if (!Number.isFinite(value) || value < 0) {
    say('minRewardStatus', 'Enter a valid non-negative amount.');
    return;
  }
  try {
    const result = await pg.setMinReward(value);
    say('minRewardStatus', `Saved. Campaigns below ${result.minReward} stated token units are rejected; zero still requires a positive reward.`);
    await render();
  } catch (error) { say('minRewardStatus', `Threshold was not saved: ${error.message || 'check the amount.'}`); }
});
renderMinReward();

// ---- Phase 7: health, notifications, alerts, receipts ----
async function renderHealth() {
  const h = await pg.healthGet(), box = document.getElementById('health');
  box.replaceChildren();
  box.append(el('h3', '', 'Local activity summary'));
  box.append(el('div', '', `Campaigns tracked: ${h.counts.campaigns}`));
  box.append(el('div', '', `Eligible for review: ${h.counts.eligible}`));
  box.append(el('div', '', `Pending claims: ${h.counts.pendingClaims}`));
  box.append(el('div', '', `Saved preflight records (not submitted): ${h.counts.preparations}`));
  box.append(el('div', '', `Rewards received: ${h.counts.received}`));
  box.append(el('div', '', `Rejected/ineligible: ${h.counts.rejected}`));
  const healthRows = Object.entries(h.health || {}).map(([k, v]) => el('div', '', `${k}: ${typeof v.value === 'object' ? JSON.stringify(v.value) : v.value} (updated ${v.updated})`));
  if (healthRows.length) box.append(...healthRows);
  else box.append(el('p', 'empty', 'External services are not health-checked here. Review feed and wallet status in their own panels.'));
}
async function renderNotifications() {
  const ns = await pg.notificationsList(), box = document.getElementById('notifications');
  box.replaceChildren();
  if (!ns.length) { const empty = el('p', 'empty', 'No notifications.'); empty.setAttribute('role', 'listitem'); box.append(empty); return; }
  ns.forEach(n => {
    const d = el('div', 'row ' + (n.dismissed ? 'rejected' : 'unverified'));
    d.setAttribute('role', 'listitem');
    d.append(el('div', 'tag', `${n.kind} (ref ${n.ref_id || '-'})`), el('div', '', n.message || 'No message was recorded for this older notification.'), el('small', '', `${n.shown_at} ${n.dismissed ? '[dismissed]' : ''}`));
    if (!n.dismissed) { const b = el('button', '', 'Dismiss'); b.onclick = async () => { await pg.notificationsDismiss(n.id); document.getElementById('notificationsStatus').textContent = `Notification ${n.kind} dismissed.`; renderNotifications(); }; d.append(b); }
    box.append(d);
  });
}
async function renderAlerts() {
  const as = await pg.alertsList(), box = document.getElementById('alerts');
  box.replaceChildren();
  if (!as.length) { const empty = el('p', 'empty', 'No alerts.'); empty.setAttribute('role', 'listitem'); box.append(empty); return; }
  as.forEach(a => { const item = el('div', 'row unverified', `${a.kind}: ${a.message}`); item.setAttribute('role', 'listitem'); box.append(item); });
}
async function renderReceipts() {
  const rs = await pg.receiptsList(), box = document.getElementById('receipts');
  box.replaceChildren();
  if (!rs.length) { const empty = el('p', 'empty', 'No claims yet.'); empty.setAttribute('role', 'listitem'); box.append(empty); return; }
  rs.forEach(r => { const item = el('div', 'row ' + cls(r.state), `${r.name}: ${LABEL[r.state] || r.state} — ${r.network}, amount ${r.reward_amount ?? 'n/a'}, tx ${r.tx_hash || 'none'}`); item.setAttribute('role', 'listitem'); box.append(item); });
}
renderHealth(); renderNotifications(); renderAlerts(); renderReceipts(); renderAnalytics();

function renderChartData(summaryId, tableId, label, entries, emptyMessage) {
  const summary = document.getElementById(summaryId);
  const tableContainer = document.getElementById(tableId);
  if (!entries.length) {
    summary.textContent = emptyMessage;
    tableContainer.replaceChildren(el('p', 'empty', emptyMessage));
    return;
  }
  summary.textContent = `${label}: ${entries.map(([key, value]) => `${key}, ${value}`).join('; ')}.`;
  const table = el('table');
  table.append(el('caption', '', label));
  const head = el('tr');
  for (const heading of ['Category', 'Count']) {
    const th = el('th', '', heading);
    th.scope = 'col';
    head.append(th);
  }
  table.append(head);
  entries.forEach(([key, value]) => {
    const row = el('tr');
    row.append(el('th', '', key), el('td', '', value));
    row.children[0].scope = 'row';
    table.append(row);
  });
  tableContainer.replaceChildren(table);
}

async function renderAnalytics() {
  try {
    const [overview, flags, history, rewards] = await Promise.all([
      pg.analyticsOverview(), pg.analyticsFlags(), pg.analyticsHistory(), pg.analyticsRewards()
    ]);

    const box = document.getElementById('analyticsOverviewStats');
    box.replaceChildren();
    const byStatus = overview.byStatus || {};
    const total = overview.total || 0;
    const statRows = [
      ['Campaigns tracked', total, ''],
      ['Eligible for review', byStatus.ELIGIBLE_FOR_REVIEW || 0, 'stat-accent'],
      ['Under review', byStatus.UNDER_REVIEW || 0, ''],
      ['Rejected / ineligible', (byStatus.REJECTED || 0) + (byStatus.INELIGIBLE || 0), 'stat-danger'],
      ['Unverified', byStatus.UNVERIFIED || 0, ''],
      ['Expired', byStatus.EXPIRED || 0, '']
    ];
    statRows.forEach(([k, v, tone]) => {
      const d = el('div', 'stat-card'); d.append(el('b', tone, v), el('span', '', k)); box.append(d);
    });

    const rewardsBox = document.getElementById('analyticsRewardsNote');
    const rc = overview.rewards || {};
    rewardsBox.textContent = `Stated rewards on ${rc.count || 0} campaign(s). Total ${rc.total || 0}, avg ${(rc.avg || 0).toFixed(2)}, range ${rc.min || 0}–${rc.max || 0}. Stated amounts are not earnings or balances.`;

    drawDonut('chartStatus', byStatus, {
      ELIGIBLE_FOR_REVIEW: '#54d5a0', REJECTED: '#ff7b80', INELIGIBLE: '#ff7b80',
      UNDER_REVIEW: '#f2bd65', UNVERIFIED: '#71839a', EXPIRED: '#9aaabd',
      DISCOVERED: '#74a9ff', AWAITING_USER_APPROVAL: '#74a9ff', CLAIM_SUBMITTED: '#74a9ff',
      REWARD_PENDING: '#f2bd65', REWARD_RECEIVED: '#54d5a0', FAILED: '#ff7b80'
    }, 'Campaign status');
    const statusEntries = Object.entries(byStatus).filter(([, value]) => value > 0).map(([key, value]) => [LABEL[key] || key, value]);
    renderChartData('chartStatusSummary', 'chartStatusTable', 'Campaigns by status', statusEntries, 'No campaign records are available for this chart.');

    const byNetwork = overview.byNetwork || {};
    drawDonut('chartNetwork', byNetwork, {
      'ton-testnet': '#40c9b0', 'ton-mainnet': '#20aa96', 'eip155:1': '#74a9ff',
      'eip155:56': '#f2bd65', 'eip155:97': '#f2bd65', 'eip155:11155111': '#74a9ff'
    }, 'Network');
    renderChartData('chartNetworkSummary', 'chartNetworkTable', 'Campaigns by network', Object.entries(byNetwork).filter(([, value]) => value > 0), 'No network records are available for this chart.');

    drawBars('chartFlags', flags || {}, 'Payment condition flags', v => v > 0 ? '#ff7b80' : '#27384a');
    const flagEntries = Object.entries(flags || {}).filter(([, value]) => value > 0).map(([key, value]) => [key.replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase()), value]);
    renderChartData('chartFlagsSummary', 'chartFlagsTable', 'Campaigns with payment-condition flags', flagEntries, 'No payment-condition flags are recorded.');

    const daily = (history && history.daily) || [];
    drawHistory('chartHistory', daily, 'Status changes per day');
    renderChartData('chartHistorySummary', 'chartHistoryTable', 'Status changes per day', daily.filter(([, value]) => value > 0), 'No status changes are recorded for the chart period.');

    const bins = (rewards && rewards.bins) || [];
    drawRewardHistogram('chartRewards', bins, 'Stated reward amount histogram (bins of 5 token units)');
    renderChartData('chartRewardsSummary', 'chartRewardsTable', 'Campaign counts by stated-reward range (token units)', bins.filter(([, value]) => value > 0), 'No stated reward amounts are available for this chart.');
  } catch (error) {
    console.error('Analytics failed:', error);
    showAppError(`Analytics could not be loaded: ${error.message || 'unknown error'}`);
  }
}

function ctxOf(id) { return document.getElementById(id).getContext('2d'); }

function fitCanvas(canvas) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth || 400; const cssH = canvas.clientHeight || 260;
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  return { ctx, w: cssW, h: cssH };
}

function clearCanvas(ctx, w, h) { ctx.clearRect(0, 0, w, h); }

function donutSegments(values) {
  const total = Object.values(values).reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  let start = 0; const out = [];
  for (const [k, v] of Object.entries(values)) {
    if (!v) continue;
    const slice = (v / total) * 2 * Math.PI; out.push({ key: k, value: v, start, end: start + slice }); start += slice;
  }
  return out;
}

function drawDonut(id, values, colorMap, title) {
  const { ctx, w, h } = fitCanvas(document.getElementById(id));
  clearCanvas(ctx, w, h);
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  const cx = w / 2, cy = h / 2 - 8, outerR = Math.min(w, h) / 2 - 22, innerR = outerR * 0.52;
  const segs = donutSegments(values);
  if (segs.length === 0) { ctx.fillStyle = '#71839a'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('No data', cx, cy + 4); return; }
  let cursor = 0;
  for (const s of segs) {
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, outerR, s.start, s.end); ctx.closePath();
    ctx.fillStyle = colorMap[s.key] || '#74a9ff'; ctx.fill();
  }
  ctx.beginPath(); ctx.arc(cx, cy, innerR, 0, 2 * Math.PI); ctx.fillStyle = '#0b111a'; ctx.fill();
  ctx.fillStyle = '#edf3f8'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(title, cx, cy - 6); ctx.font = '16px system-ui'; ctx.fillText(String(total), cx, cy + 6);
  ctx.font = '10px system-ui'; ctx.fillStyle = '#9aaabd';
  const legendX = w - 130; let legendY = 22;
  for (const s of segs) {
    ctx.fillStyle = colorMap[s.key] || '#74a9ff'; ctx.fillRect(legendX, legendY, 10, 10);
    ctx.fillStyle = '#edf3f8'; ctx.fillText(`${s.key}: ${s.value}`, legendX + 16, legendY + 9); legendY += 16;
  }
}

function drawBars(id, values, title, colorOf) {
  const { ctx, w, h } = fitCanvas(document.getElementById(id));
  clearCanvas(ctx, w, h);
  const items = Object.entries(values).filter(([, v]) => v > 0);
  if (items.length === 0) { ctx.fillStyle = '#71839a'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('No data', w / 2, h / 2); return; }
  const maxV = Math.max(...items.map(([, v]) => v));
  const pad = 44, gap = 14; const barW = (w - pad * 2 - gap * (items.length - 1)) / items.length;
  ctx.fillStyle = '#edf3f8'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(title, w / 2, 16);
  items.forEach(([k, v], i) => {
    const bh = Math.max(4, (v / maxV) * (h - pad - 34)); const x = pad + i * (barW + gap); const y = h - pad - bh;
    ctx.fillStyle = colorOf(v); ctx.fillRect(x, y, barW, bh);
    ctx.fillStyle = '#9aaabd'; ctx.font = '9px system-ui'; ctx.textAlign = 'center'; ctx.fillText(k, x + barW / 2, h - pad + 11);
    ctx.fillStyle = '#edf3f8'; ctx.font = '10px system-ui'; ctx.fillText(String(v), x + barW / 2, y - 6);
  });
}

function drawHistory(id, daily, title) {
  const { ctx, w, h } = fitCanvas(document.getElementById(id));
  clearCanvas(ctx, w, h);
  const pts = daily.filter(([, v]) => v > 0);
  if (pts.length === 0) { ctx.fillStyle = '#71839a'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('No data', w / 2, h / 2); return; }
  const maxV = Math.max(...pts.map(([, v]) => v));
  const pad = 44, topPad = 26; const plotW = w - pad * 2; const plotH = h - pad - topPad;
  ctx.fillStyle = '#edf3f8'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(title, w / 2, 16);
  ctx.strokeStyle = '#27384a'; ctx.beginPath(); ctx.moveTo(pad, h - pad); ctx.lineTo(w - pad, h - pad); ctx.stroke();
  pts.forEach(([d, v], i) => {
    const x = pad + (i / Math.max(1, pts.length - 1)) * plotW; const y = h - pad - (v / maxV) * plotH;
    ctx.fillStyle = '#40c9b0'; ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI); ctx.fill();
    if (i > 0) { const px = pad + ((i - 1) / Math.max(1, pts.length - 1)) * plotW; const py = h - pad - (pts[i - 1][1] / maxV) * plotH;
      ctx.strokeStyle = '#40c9b0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke(); }
    ctx.fillStyle = '#9aaabd'; ctx.font = '9px system-ui'; ctx.textAlign = 'center'; ctx.fillText(d.slice(5), x, h - pad + 13);
  });
}

function drawRewardHistogram(id, bins, title) {
  const { ctx, w, h } = fitCanvas(document.getElementById(id));
  clearCanvas(ctx, w, h);
  const items = bins.filter(([, v]) => v > 0);
  if (items.length === 0) { ctx.fillStyle = '#71839a'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('No data', w / 2, h / 2); return; }
  const maxV = Math.max(...items.map(([, v]) => v));
  const pad = 56, gap = 10; const barW = (w - pad * 2 - gap * (items.length - 1)) / items.length;
  ctx.fillStyle = '#edf3f8'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(title, w / 2, 16);
  items.forEach(([b, v], i) => {
    const bh = Math.max(4, (v / maxV) * (h - pad - 34)); const x = pad + i * (barW + gap); const y = h - pad - bh;
    ctx.fillStyle = '#74a9ff'; ctx.fillRect(x, y, barW, bh);
    ctx.fillStyle = '#9aaabd'; ctx.font = '9px system-ui'; ctx.textAlign = 'center'; ctx.fillText(String(b), x + barW / 2, h - pad + 11);
    ctx.fillStyle = '#edf3f8'; ctx.font = '10px system-ui'; ctx.fillText(String(v), x + barW / 2, y - 6);
  });
}
})();
