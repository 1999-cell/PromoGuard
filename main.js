'use strict';
const { app, BrowserWindow, ipcMain, shell, session, dialog, Notification, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { open } = require('./src/db');
const backup = require('./src/backup');
const campaignContract = require('./src/campaign-contract');
const { PAYMENT_FLAGS } = require('./src/policy');
const FLAG_COLUMNS = Object.fromEntries(PAYMENT_FLAGS.map(flag => [flag, flag.replace(/[A-Z]/g, c => '_' + c.toLowerCase())]));
const discovery = require('./src/discovery');
const { saveSnapshot, listSnapshotMetadata, getSnapshot, latestSnapshot, compareSnapshots } = require('./src/evidence');
const { fetchTerms, normalizeTermsUrl, verifySource } = require('./src/terms-fetch');
const store = require('./src/store');
const { NETWORKS, checkMatch } = require('./src/ton/networks');
const { createProvider } = require('./src/ton/provider');
const { createTonService } = require('./src/ton/connector');
const { createSecureStorage } = require('./src/ton/secure-storage');
const wstore = require('./src/ton/store');
const QRCode = require('qrcode');
const { EVM_NETWORKS, resolveRpc } = require('./src/evm/networks');
const { createEvmProvider, formatWei } = require('./src/evm/rpc');
const { createWcService } = require('./src/evm/walletconnect');
const { runPipeline, STAGES } = require('./src/claims/prepare');
const { verifyFeeFree } = require('./src/claims/verify-fee-free');
const { saveClaimAttempt, getPendingClaims, recordEvidence, monitorTon, monitorEvm } = require('./src/claims/monitor');
const { ollamaChat, fenceInput, DEFAULT_MODEL } = require('./src/ai/ollama');
const { summarizeRules, extractAmountsDeadlines, compareTermsWithPolicy, explainRiskIndicators, writeEvidenceSummary, PROMPT_VERSION } = require('./src/ai/prompts');
const { createMcpTools } = require('./src/ai/mcp-tools');
const { ignoreBrokenPipe } = require('./src/logging/output-streams');
const APP_VERSION = require('./package.json').version;

let db, win, timer, ton, tonStorage, tonUnsub, tonPoll, wc, wcStorage, wcConfig, wcSel = null;
ignoreBrokenPipe(process.stdout);
ignoreBrokenPipe(process.stderr);
const limiter = new discovery.HostLimiter(2000);
const now = () => new Date().toISOString();
const safeStorageCipher = {
  available: () => safeStorage.isAsyncEncryptionAvailable(),
  encrypt: text => safeStorage.encryptStringAsync(text),
  decrypt: async buffer => (await safeStorage.decryptStringAsync(buffer)).result
};
const DEFAULTS = { minReward: 0.01, approvedDomains: ['ton.org','trustwallet.com','walletconnect.com','reown.com'], intervalMinutes: 60, feeds: [], scheduleConsent: null, tonManifestUrl: '', tonNetwork: 'ton-testnet', evmRpc: {}, updateCheckUrl: '' };
const getSettings = () => { const row = db.prepare("SELECT value FROM settings WHERE key='app'").get(); return { ...DEFAULTS, ...(row ? JSON.parse(row.value) : {}) }; };
const saveSettings = patch => db.prepare("INSERT OR REPLACE INTO settings VALUES('app',?)").run(JSON.stringify({ ...getSettings(), ...patch }));
const audit = (event, outcome, info = '') => db.prepare('INSERT INTO wallet_audit_events(event,outcome,ts,info) VALUES(?,?,?,?)').run(event, outcome, new Date().toISOString(), info);
const hostsOf = feeds => [...new Set(feeds.map(f => new URL(f).hostname))].sort();
const consentHash = (feeds, mins) => crypto.createHash('sha256').update(hostsOf(feeds).join(',') + '|' + mins).digest('hex');
const scheduleEnabled = s => !!s.scheduleConsent && s.scheduleConsent === consentHash(s.feeds, s.intervalMinutes) && s.feeds.length > 0;
const addNotification = (kind, refId, message) => {
  if (typeof kind !== 'string' || !kind.trim() || kind.length > 80) throw new Error('invalid notification kind');
  if (typeof message !== 'string' || !message.trim() || message.length > 1000) throw new Error('invalid notification message');
  const id = db.prepare('INSERT INTO notifications(kind,ref_id,message,shown_at) VALUES(?,?,?,?)')
    .run(kind.trim(), Number.isInteger(refId) && refId > 0 ? refId : null, message.trim(), now()).lastInsertRowid;
  return Number(id);
};

function createWindow() {
  const smokeWidth = Number(process.env.PG_SMOKE_WIDTH);
  const width = process.env.PG_SMOKE && Number.isInteger(smokeWidth) && smokeWidth >= 300 && smokeWidth <= 1800 ? smokeWidth : 1180;
  win = new BrowserWindow({ width, height: 780, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile('renderer/index.html');
}
const trusted = e => e.senderFrame && e.senderFrame.url.startsWith('file://') && e.sender === win.webContents;
const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { if (!trusted(e)) throw new Error('untrusted sender'); return fn(...a); });
const int = (v, lo, hi) => { if (!Number.isInteger(v) || v < lo || v > hi) throw new Error('invalid'); return v; };
const normalizeDomain = value => {
  if (typeof value !== 'string') throw new Error('enter a domain name only');
  const domain = value.trim().toLowerCase().replace(/\.$/, '');
  const labels = domain.split('.');
  if (domain.length > 253 || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    !/^[a-z]{2,63}$/.test(labels[labels.length - 1]) || domain.includes('xn--') || /^\d+(?:\.\d+){3}$/.test(domain))
    throw new Error('enter a valid public domain without a scheme, path, wildcard, or IP address');
  return domain;
};
function validateBackupSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('invalid backup settings');
  const result = { ...DEFAULTS };
  if (Object.hasOwn(settings, 'minReward')) {
    if (typeof settings.minReward !== 'number' || !Number.isFinite(settings.minReward) || settings.minReward < 0) throw new Error('invalid backup minimum reward');
    result.minReward = settings.minReward;
  }
  if (Object.hasOwn(settings, 'approvedDomains')) {
    if (!Array.isArray(settings.approvedDomains) || settings.approvedDomains.length > 100) throw new Error('invalid backup approved domains');
    result.approvedDomains = [...new Set(settings.approvedDomains.map(normalizeDomain))].sort();
  }
  if (Object.hasOwn(settings, 'feeds')) {
    if (!Array.isArray(settings.feeds) || settings.feeds.length > 50 || settings.feeds.some(url => !discovery.isSafeFeedUrl(url))) throw new Error('invalid backup feeds');
    result.feeds = [...new Set(settings.feeds)];
  }
  if (Object.hasOwn(settings, 'intervalMinutes')) {
    if (!Number.isInteger(settings.intervalMinutes) || settings.intervalMinutes < 15 || settings.intervalMinutes > 1440) throw new Error('invalid backup schedule interval');
    result.intervalMinutes = settings.intervalMinutes;
  }
  if (Object.hasOwn(settings, 'tonNetwork')) {
    if (!Object.hasOwn(NETWORKS, settings.tonNetwork)) throw new Error('invalid backup TON network');
    result.tonNetwork = settings.tonNetwork;
  }
  const publicHttpsUrl = (value, label) => {
    if (typeof value !== 'string' || (value && !discovery.isSafeFeedUrl(value))) throw new Error(`invalid backup ${label}`);
    return value;
  };
  if (Object.hasOwn(settings, 'tonManifestUrl')) result.tonManifestUrl = publicHttpsUrl(settings.tonManifestUrl, 'TON manifest URL');
  if (Object.hasOwn(settings, 'updateCheckUrl')) result.updateCheckUrl = publicHttpsUrl(settings.updateCheckUrl, 'update URL');
  if (Object.hasOwn(settings, 'evmRpc')) {
    const rpc = settings.evmRpc;
    if (!rpc || typeof rpc !== 'object' || Array.isArray(rpc)) throw new Error('invalid backup RPC settings');
    const validated = {};
    for (const [network, value] of Object.entries(rpc)) {
      if (!Object.hasOwn(EVM_NETWORKS, network) || !discovery.isSafeFeedUrl(value)) throw new Error('invalid backup RPC URL');
      validated[network] = value;
    }
    result.evmRpc = validated;
  }
  result.scheduleConsent = null;
  return result;
}

async function runDiscovery(trigger) {
  const s = getSettings(), swept = store.sweepExpired(db);
  const job = db.prepare('INSERT INTO discovery_jobs(trigger,started,feeds) VALUES(?,?,?)').run(trigger, new Date().toISOString(), s.feeds.length).lastInsertRowid;
  let found = 0, added = 0; const errors = [];
  for (const f of s.feeds) {
    try {
      await limiter.wait(new URL(f).hostname);
      for (const i of (await discovery.fetchFeed(f)).filter(discovery.relevant).slice(0, 25)) {
        found++;
        const r = store.addCampaign(db, { name: i.title, description: i.description, sourceUrl: i.link }, s, 'discovery');
        if (!r.duplicate) added++;
      }
    } catch (e) { errors.push(`${new URL(f).hostname}: ${e.message}`); }
  }
  db.prepare('UPDATE discovery_jobs SET finished=?,found=?,added=?,errors=? WHERE id=?').run(new Date().toISOString(), found, added, errors.join('; '), job);
  audit('discovery', errors.length ? 'partial' : 'ok', `${trigger}: found ${found}, added ${added}, expired ${swept}`);
  if (added && trigger === 'scheduled') {
    const message = `${added} new unverified candidate(s) to review.`;
    addNotification('discovery', null, message);
    if (Notification.isSupported()) new Notification({ title: 'PromoGuard', body: message }).show();
  }
  return { found, added, errors, expired: swept };
}
function reschedule() {
  clearInterval(timer); const s = getSettings();
  if (s.scheduleConsent && s.scheduleConsent === consentHash(s.feeds, s.intervalMinutes) && s.feeds.length)
    timer = setInterval(() => runDiscovery('scheduled').catch(e => audit('discovery', 'error', e.message)), s.intervalMinutes * 60000);
}

if (process.env.PG_SMOKE) app.disableHardwareAcceleration();

app.whenReady().then(() => {
  db = open(process.env.PG_SMOKE ? ':memory:' : path.join(app.getPath('userData'), 'promoguard.db'));
  store.sweepExpired(db);
  handle('settings:get', () => ({ ...getSettings(), scheduleEnabled: scheduleEnabled(getSettings()), appVersion: APP_VERSION }));
  // Update check: reads a configured update URL and compares the latest version against the app version.
  // No automatic download or install; the user decides whether to fetch a new installer.
  handle('update:check', async () => {
    const s = getSettings(); const updateUrl = s.updateCheckUrl;
    if (!updateUrl || !/^https:\/\//.test(updateUrl)) return { checked: false, currentVersion: APP_VERSION, latestVersion: null, updateAvailable: false, reason: 'No update URL configured.' };
    try {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
      let res;
      try { res = await fetch(updateUrl, { signal: controller.signal, headers: { 'User-Agent': `PromoGuard/${APP_VERSION}` } }); } finally { clearTimeout(timer); }
      if (!res.ok) throw new Error(`http ${res.status}`);
      const data = await res.json();
      const latest = String(data.version || '').replace(/^v/, '');
      const current = APP_VERSION.replace(/^v/, '');
      const [cMaj, cMin, cPat] = current.split('.').map(Number); const [lMaj, lMin, lPat] = latest.split('.').map(Number);
      const updateAvailable = lMaj > cMaj || (lMaj === cMaj && lMin > cMin) || (lMaj === cMaj && lMin === cMin && lPat > cPat);
      return { checked: true, currentVersion: APP_VERSION, latestVersion: latest, updateAvailable, releaseNotes: data.release_notes || null, downloadUrl: data.download_url || null };
    } catch (e) { return { checked: false, currentVersion: APP_VERSION, latestVersion: null, updateAvailable: false, reason: e.message || 'Update check failed.' }; }
  });
  handle('settings:setMinReward', v => { if (typeof v !== 'number' || !isFinite(v) || v < 0) throw new Error('minimum reward must be a non-negative number'); saveSettings({ minReward: v }); return { minReward: v }; });
  handle('settings:addApprovedDomain', value => {
    const domain = normalizeDomain(value), current = getSettings().approvedDomains || [];
    if (current.includes(domain)) return { added: false, domains: current };
    if (current.length >= 100) throw new Error('the approved domain list is full');
    const domains = [...current, domain].sort();
    saveSettings({ approvedDomains: domains }); audit('source_domain_added', 'ok', domain);
    return { added: true, domains };
  });
  handle('settings:removeApprovedDomain', value => {
    const domain = normalizeDomain(value), domains = (getSettings().approvedDomains || []).filter(item => item !== domain);
    saveSettings({ approvedDomains: domains }); audit('source_domain_removed', 'ok', domain);
    return { removed: true, domains };
  });
  handle('settings:setUpdateCheckUrl', url => {
    if (url !== null && url !== undefined && (typeof url !== 'string' || !/^https:\/\//.test(url))) throw new Error('update check URL must be https');
    saveSettings({ updateCheckUrl: url || '' }); return { updateCheckUrl: url || '' };
  });
  handle('campaign:add', c => { if (!c || typeof c.name !== 'string' || c.name.length > 200) throw new Error('invalid campaign'); const r = store.addCampaign(db, c, getSettings(), 'manual'); audit('campaign_added', r.status || 'duplicate'); return r; });
  handle('campaign:list', () => store.list(db));
  handle('campaign:listArchived', () => store.list(db, true));
  handle('campaign:evidenceSnapshot', (id, payload) => {
    if (!payload || typeof payload !== 'object') throw new Error('invalid terms snapshot');
    const result = saveSnapshot(db, {
      campaignId: int(id, 1, 1e9),
      url: payload.url,
      content: payload.content
    });
    audit('campaign_terms_snapshot', result.duplicate ? 'duplicate' : 'saved', String(id));
    return result;
  });
  handle('campaign:evidenceList', id => listSnapshotMetadata(db, int(id, 1, 1e9)));
  handle('campaign:evidenceGet', (id, evidenceId) => getSnapshot(db, int(id, 1, 1e9), int(evidenceId, 1, 1e9)));
  // App-initiated terms fetch: retrieves official-terms content under strict safety limits.
  // It does not save anything; the user reviews the fetched text and saves a snapshot explicitly.
  handle('campaign:fetchTerms', async (url, expectedEvidenceUrl) => {
    const normalized = normalizeTermsUrl(url);
    return fetchTerms(normalized, { expectedEvidenceUrl: expectedEvidenceUrl ? String(expectedEvidenceUrl) : null });
  });
  // Source-ownership auto-verification: DNS resolution, public-IP check, domain-match against evidence URL.
  handle('campaign:verifySource', async (url, expectedEvidenceUrl) => {
    const normalized = normalizeTermsUrl(url);
    return verifySource(normalized, expectedEvidenceUrl ? String(expectedEvidenceUrl) : null);
  });
  // Campaign versioning: compare two saved terms snapshot revisions line-by-line.
  handle('campaign:compareSnapshots', (campaignId, idA, idB) => compareSnapshots(db, int(campaignId, 1, 1e9), int(idA, 1, 1e9), int(idB, 1, 1e9)));
  handle('campaign:edit', (id, changes) => {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('invalid campaign id');
    if (!changes || typeof changes !== 'object') throw new Error('invalid changes');
    const row = db.prepare('SELECT * FROM reward_campaigns WHERE id=?').get(id);
    if (!row) throw new Error('campaign not found');
    const allowed = ['name', 'network', 'tokenId', 'rewardAmount', 'endDate'];
    const updates = [];
    const values = [];
    if (changes.name !== undefined) { if (typeof changes.name !== 'string' || !changes.name.trim() || changes.name.length > 200) throw new Error('invalid name'); updates.push('name=?'); values.push(changes.name.trim()); }
    if (changes.network !== undefined) { updates.push('network=?'); values.push(typeof changes.network === 'string' ? changes.network : null); }
    if (changes.tokenId !== undefined) { updates.push('token_id=?'); values.push(typeof changes.tokenId === 'string' ? changes.tokenId : null); }
    if (changes.rewardAmount !== undefined) { if (typeof changes.rewardAmount !== 'number' || !isFinite(changes.rewardAmount) || changes.rewardAmount < 0) throw new Error('invalid reward amount'); updates.push('reward_amount=?'); values.push(changes.rewardAmount); }
    if (changes.endDate !== undefined) { updates.push('end_date=?'); values.push(typeof changes.endDate === 'string' ? changes.endDate : null); }
    if (updates.length === 0) throw new Error('no changes provided');
    updates.push('last_checked=?'); values.push(now());
    values.push(id);
    db.prepare(`UPDATE reward_campaigns SET ${updates.join(', ')} WHERE id=?`).run(...values);
    // Data changed: terms evidence may no longer match; reset to under review.
    const clean = { name: row.name, sourceUrl: row.source_url, network: changes.network !== undefined ? changes.network : row.network, tokenId: changes.tokenId !== undefined ? changes.tokenId : row.token_id, rewardAmount: changes.rewardAmount !== undefined ? changes.rewardAmount : row.reward_amount, endDate: changes.endDate !== undefined ? changes.endDate : row.end_date, evidenceUrl: row.evidence };
    for (const k of PAYMENT_FLAGS) clean[k] = row[FLAG_COLUMNS[k]] === 1;
    const d = store.decide(clean, getSettings(), 'manual');
    db.prepare(`UPDATE reward_campaigns SET status=?, reasons=? WHERE id=?`).run(d.status === 'ELIGIBLE_FOR_REVIEW' ? 'UNDER_REVIEW' : d.status, JSON.stringify(d.reasons), id);
    db.prepare('INSERT INTO status_history(campaign_id,from_status,to_status,reason,ts) VALUES(?,?,?,?,?)').run(id, row.status, d.status === 'ELIGIBLE_FOR_REVIEW' ? 'UNDER_REVIEW' : d.status, 'campaign edited: evidence may be stale', now());
    return { id, status: d.status === 'ELIGIBLE_FOR_REVIEW' ? 'UNDER_REVIEW' : d.status, reasons: d.reasons };
  });
  handle('campaign:archive', (id, archived) => {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('invalid campaign id');
    if (typeof archived !== 'boolean') throw new Error('archived must be a boolean');
    const row = db.prepare('SELECT id FROM reward_campaigns WHERE id=?').get(id);
    if (!row) throw new Error('campaign not found');
    db.prepare('UPDATE reward_campaigns SET archived=? WHERE id=?').run(archived ? 1 : 0, id);
    audit('campaign_archived', archived ? 'archived' : 'unarchived', String(id));
    return { id, archived };
  });
  handle('backup:export', async () => {
    const result = await dialog.showSaveDialog(win, { title: 'Export PromoGuard backup', defaultPath: 'promoguard-backup.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return { exported: false };
    const payload = backup.makeBackup(db, getSettings(), APP_VERSION);
    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
    audit('backup_exported', 'ok', result.filePath);
    return { exported: true, path: result.filePath, campaigns: payload.campaigns.length };
  });
  handle('webBundle:export', async () => {
    const result = await dialog.showSaveDialog(win, {
      title: 'Export read-only web data bundle',
      defaultPath: 'promoguard-web-bundle.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { exported: false };
    const bundle = campaignContract.makeOfflineBundle(db);
    fs.writeFileSync(result.filePath, JSON.stringify(bundle, null, 2), 'utf8');
    audit('web_bundle_exported', 'ok', result.filePath);
    return { exported: true, path: result.filePath, campaigns: bundle.resources.campaigns.length };
  });
  handle('backup:import', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Import PromoGuard backup', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (result.canceled || !result.filePaths.length) return { imported: false };
    const filePath = result.filePaths[0];
    if (fs.statSync(filePath).size > 50_000_000) throw new Error('backup file is too large');
    const raw = fs.readFileSync(filePath, 'utf8');
    let payload;
    try { payload = JSON.parse(raw); } catch { throw new Error('invalid backup file'); }
    const importResult = backup.importBackup(db, payload, validateBackupSettings);
    if (importResult.settingsImported) reschedule();
    audit('backup_imported', 'ok', `imported ${importResult.importedCount}, skipped ${importResult.skippedCount}`);
    return { imported: true, ...importResult };
  });
  handle('review:start', id => store.startReview(db, int(id, 1, 1e9)));
  handle('review:reject', (id, note) => store.rejectCampaign(db, int(id, 1, 1e9), note));
  handle('review:evidence', (id, ev) => { if (!ev || typeof ev !== 'object') throw new Error('invalid'); return store.submitEvidence(db, int(id, 1, 1e9), { evidenceUrl: String(ev.evidenceUrl || ''), confirmFree: ev.confirmFree === true,
    confirmOfficialSource: ev.confirmOfficialSource === true, rewardAmount: typeof ev.rewardAmount === 'number' ? ev.rewardAmount : undefined,
    tokenId: ev.tokenId ? String(ev.tokenId) : undefined, endDate: ev.endDate ? String(ev.endDate) : undefined }, getSettings()); });
  handle('feeds:list', () => getSettings().feeds);
  handle('feeds:add', url => {
    if (typeof url !== 'string' || !discovery.isSafeFeedUrl(url)) throw new Error('feed must be a public https URL');
    const current = getSettings().feeds;
    if (current.includes(url)) return { added: false, feeds: current };
    if (current.length >= 50) throw new Error('the feed list is full; remove a feed before adding another');
    const feeds = [...current, url].sort();
    saveSettings({ feeds, scheduleConsent: null }); reschedule();
    return { added: true, feeds };
  });
  handle('feeds:remove', url => {
    if (typeof url !== 'string' || !discovery.isSafeFeedUrl(url)) throw new Error('invalid feed URL');
    const current = getSettings().feeds, feeds = current.filter(feed => feed !== url);
    if (feeds.length === current.length) return { removed: false, feeds };
    saveSettings({ feeds, scheduleConsent: null }); reschedule();
    audit('feed_removed', 'ok', new URL(url).hostname);
    return { removed: true, feeds };
  });
  handle('discovery:run', async () => {
    const s = getSettings(); if (!s.feeds.length) return { found: 0, added: 0, errors: [], note: 'Add a feed first.' };
    const ok = await dialog.showMessageBox(win, { type: 'question', buttons: ['Cancel', 'Allow once'], defaultId: 0, cancelId: 0, message: 'Contact these sites?', detail: hostsOf(s.feeds).join('\n') + '\n\nOnly the feed request is sent. No wallet address or personal data is shared.' });
    if (ok.response !== 1) { audit('discovery', 'declined'); return { found: 0, added: 0, errors: [], note: 'Cancelled.' }; }
    return runDiscovery('manual');
  });
  handle('schedule:enable', async mins => {          // one consent covers exactly these hosts and this interval
    int(mins, 15, 1440); const s = getSettings(); if (!s.feeds.length) throw new Error('add a feed first');
    const ok = await dialog.showMessageBox(win, { type: 'question', buttons: ['Cancel', 'Allow scheduled checks'], defaultId: 0, cancelId: 0, message: `Check these sites every ${mins} minutes?`, detail: hostsOf(s.feeds).join('\n') + '\n\nAdding a feed or changing the interval asks again.' });
    if (ok.response !== 1) return false;
    saveSettings({ intervalMinutes: mins, scheduleConsent: consentHash(s.feeds, mins) }); audit('schedule', 'enabled'); reschedule(); return true;
  });
  handle('schedule:disable', () => { saveSettings({ scheduleConsent: null }); clearInterval(timer); audit('schedule', 'disabled'); });
  handle('wallet:clearMetadata', () => {
    db.transaction(() => {
      db.exec('DELETE FROM wallet_connections; DELETE FROM wallet_transactions');
      db.prepare("UPDATE wallet_permissions SET revoked=? WHERE operation='read_public_data' AND revoked IS NULL").run(now());
    })();
    audit('wallet_metadata_cleared', 'ok');
  });
  handle('link:open', url => { const u = new URL(url); if (u.protocol !== 'https:' || !getSettings().approvedDomains.some(d => u.hostname === d || u.hostname.endsWith('.' + d))) throw new Error('blocked'); return shell.openExternal(u.href); });

  // ---- TON (read-only) ----
  const PROV = 'toncenter';
  tonStorage = createSecureStorage(path.join(app.getPath('userData'), 'ton-session.bin'), safeStorageCipher);
  const tonState = async () => { const s = getSettings(), st = ton ? ton.getState() : { status: 'disconnected', wallet: null, error: null };
    const match = st.wallet ? checkMatch(s.tonNetwork, st.wallet.chain) : null;
    return { ...st, selectedNetwork: s.tonNetwork, manifestSet: !!s.tonManifestUrl, dataConsent: wstore.hasPermission(db, PROV, 'read_public_data', s.tonNetwork), match, persistentSession: await tonStorage.persistent() }; };
  const ensureTon = () => { const s = getSettings(); if (!s.tonManifestUrl) throw new Error('set the manifest URL first');
    if (!ton) { ton = createTonService({ manifestUrl: s.tonManifestUrl, storage: tonStorage }); tonUnsub = ton.onChange(st => { if (st.wallet) wstore.saveConnection(db, st.wallet); startPoll(); }); } return ton; };
  async function refreshTon() {
    const st = await tonState(); if (st.status !== 'connected') throw new Error('not connected');
    if (!st.match.ok) throw new Error(st.match.reason);                                    // never query the wrong network
    if (!st.dataConsent) throw new Error('data provider not enabled');                      // address goes to a third party only with consent
    const w = st.wallet, p = createProvider({ network: w.network });
    try {
      const bal = await p.balance(w.address), jt = await p.jettons(w.address), tx = await p.incoming(w.address);
      wstore.saveSnapshot(db, wstore.saveConnection(db, w), w.network, bal, jt.tokens, p.name);
      const fresh = wstore.saveTransactions(db, w.address, w.network, tx, p.name); audit('ton_refresh', 'ok', w.network);
      if (fresh) {
        const message = `${fresh} new confirmed incoming transfer(s) on ${NETWORKS[w.network].name}.`;
        addNotification('wallet_transfer', null, message);
        if (Notification.isSupported()) new Notification({ title: 'PromoGuard', body: message }).show();
      }
    } catch (e) { audit('ton_refresh', 'error', e.message); throw e; }
  }
  const startPoll = () => { clearInterval(tonPoll); tonPoll = setInterval(async () => { try { const s = await tonState(); if (s.status === 'connected' && s.match.ok && s.dataConsent) await refreshTon(); else if (s.status !== 'connected') clearInterval(tonPoll); } catch (e) { audit('ton_poll', 'error', e.message); clearInterval(tonPoll); } }, 60000); };
  handle('ton:state', () => tonState());
  handle('ton:setManifest', url => { if (typeof url !== 'string' || !discovery.isSafeFeedUrl(url) || !/\.json(\?.*)?$/.test(new URL(url).pathname + new URL(url).search)) throw new Error('manifest must be a public https .json URL'); saveSettings({ tonManifestUrl: url }); ton = null; });
  handle('ton:setNetwork', async id => {
    if (!NETWORKS[id]) throw new Error('unknown network');
    if (!NETWORKS[id].testnet) { const ok = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Stay on testnet', 'Use mainnet (read-only)'], defaultId: 0, cancelId: 0, message: 'Mainnet holds real assets', detail: 'PromoGuard only reads public data. It never signs or sends anything.' }); if (ok.response !== 1) return false; }
    saveSettings({ tonNetwork: id }); return true; });
  handle('ton:wallets', async () => ensureTon().wallets());
  handle('ton:connect', async name => {
    const svc = ensureTon(), s = getSettings(), list = await svc.wallets(), w = list.find(x => x.name === name); if (!w) throw new Error('unsupported wallet');
    const ok = await dialog.showMessageBox(win, { type: 'question', buttons: ['Cancel', 'Connect'], defaultId: 0, cancelId: 0, message: `Connect ${name} on ${NETWORKS[s.tonNetwork].name}?`,
      detail: `Sites contacted: ${new URL(s.tonManifestUrl).hostname} (your manifest), the TON Connect wallet list, and ${w.bridgeHost} (wallet bridge).\nYou will approve in your wallet app. PromoGuard cannot spend funds or sign transactions.` });
    if (ok.response !== 1) { audit('ton_connect', 'declined'); return null; }
    const link = svc.connect(name); audit('ton_connect', 'started', name); await shell.openExternal(link); return link; });
  handle('ton:disconnect', async () => { if (ton) await ton.disconnect(); clearInterval(tonPoll); audit('ton_disconnect', 'ok'); });
  handle('ton:enableData', async () => { const s = getSettings(), ok = await dialog.showMessageBox(win, { type: 'question', buttons: ['Cancel', 'Allow'], defaultId: 0, cancelId: 0, message: 'Send your public address to TON Center?',
      detail: `${new URL(NETWORKS[s.tonNetwork].api).hostname} will receive your public wallet address to return balances and incoming transfers. No keys or personal data are sent. Free use is limited to about 1 request per second.` });
    if (ok.response !== 1) return false; wstore.grantPermission(db, PROV, 'read_public_data', s.tonNetwork); audit('ton_data_consent', 'granted', s.tonNetwork); return true; });
  handle('ton:revokeData', () => { wstore.revokePermission(db, PROV, 'read_public_data', getSettings().tonNetwork); audit('ton_data_consent', 'revoked'); });
  handle('ton:refresh', async () => { await refreshTon(); return true; });
  handle('ton:dashboard', async () => { const st = await tonState(); return { state: st, data: st.wallet ? wstore.latest(db, st.wallet.address, st.wallet.network) : null }; });
  handle('ton:explorer', async () => { const st = await tonState(); if (!st.wallet) throw new Error('not connected'); return shell.openExternal(`${NETWORKS[st.wallet.network].explorer}/${st.wallet.friendly}`); });
  handle('ton:wipeLocal', async () => {
    if (ton) await ton.disconnect();
    clearInterval(tonPoll); tonStorage.clear();
    wstore.eraseProviderData(db, 'ton:', PROV);
    audit('ton_local_wipe', 'ok');
  });
  if (getSettings().tonManifestUrl) {
    try { ensureTon().restore().catch(e => audit('ton_restore', 'error', e.message)); }
    catch (e) { audit('ton_restore', 'error', e.message); }
  }

  // ---- Trust Wallet via WalletConnect v2 (read-only, EVM) ----
  wcStorage = createSecureStorage(path.join(app.getPath('userData'), 'wc-session.bin'), safeStorageCipher);
  wcConfig = createSecureStorage(path.join(app.getPath('userData'), 'wc-config.bin'), safeStorageCipher);
  const WC_META = { name: 'PromoGuard', description: 'Read-only reward tracker', url: 'https://promoguard.invalid', icons: [] };

  // ---- MCP tools (Phase 6, read-only) ----
  const mcpConsent = (tool) => !!db.prepare('SELECT 1 FROM mcp_grants WHERE tool=? AND granted=1 AND revoked IS NULL').get(tool);
  const mcpGrant = (tool) => db.prepare(`INSERT INTO mcp_grants(tool,granted,revoked) VALUES(?,1,NULL)
    ON CONFLICT(tool) DO UPDATE SET granted=1,revoked=NULL`).run(tool);
  const mcpRevoke = (tool) => db.prepare('UPDATE mcp_grants SET revoked=? WHERE tool=? AND revoked IS NULL').run(now(), tool);
  const walletCtx = () => {
    const st = ton ? ton.getState() : { status: 'disconnected', wallet: null };
    const wcst = wc ? wc.getState() : { status: 'disconnected', accounts: [] };
    const wallets = [];
    if (st.wallet) wallets.push({ provider: 'ton', network: st.wallet.network, address: st.wallet.address });
    for (const a of (wcst.accounts || [])) if (a.network) wallets.push({ provider: 'wc', network: a.network, address: a.address });
    const sel = wallets[0] || null;
    const snap = sel ? wstore.latest(db, sel.address, sel.network) : null;
    return { wallets, selected: sel, selectedNetwork: getSettings().tonNetwork || (sel && sel.network), walletNetwork: sel ? sel.network : null, snapshot: snap ? snap.snapshot : null, transactions: (snap && snap.txs) || [] };
  };
  const mcp = createMcpTools({ db, getWalletContext: walletCtx, hasConsent: mcpConsent, grantConsent: mcpGrant, revokeConsent: mcpRevoke });
  const rpcFor = id => resolveRpc(id, getSettings().evmRpc || {});
  const wcPerm = id => `rpc:${(() => { try { return new URL(rpcFor(id)).hostname; } catch { return 'none'; } })()}`;
  const ensureWc = async () => { if (wc) return wc; const pid = await wcConfig.getItem('projectId'); if (!pid) throw new Error('set a WalletConnect project ID first');
    const { SignClient } = require('@walletconnect/sign-client'), { Core } = require('@walletconnect/core');
    wc = createWcService({ SignClientImpl: SignClient, makeCore: p => new Core({ projectId: p, storage: wcStorage }), projectId: pid, metadata: WC_META }); await wc.init(); return wc; };
  const wcActive = () => { const st = wc ? wc.getState() : { status: 'disconnected', accounts: [], error: null }; const acc = st.accounts.filter(a => a.network);
    const sel = acc.find(a => a.network === wcSel) || acc[0] || null; return { st, acc, sel }; };
  const wcState = async () => { const { st, acc, sel } = wcActive(); const s = getSettings();
    return { status: st.status, error: st.error, accounts: acc.map(a => ({ network: a.network, name: EVM_NETWORKS[a.network].name, address: a.address, testnet: EVM_NETWORKS[a.network].testnet })),
      unsupported: st.accounts.filter(a => !a.network).map(a => a.caip2), selected: sel && sel.network, projectIdSet: !!(await wcConfig.getItem('projectId')), projectIdPersistent: await wcConfig.persistent(), persistentSession: await wcStorage.persistent(),
      rpcConfigured: sel ? !!rpcFor(sel.network) : null, dataConsent: sel ? wstore.hasPermission(db, wcPerm(sel.network), 'read_public_data', sel.network) : false }; };
  async function refreshWc() {
    const { sel } = wcActive(); if (!sel) throw new Error('no supported account'); const rpc = rpcFor(sel.network); if (!rpc) throw new Error('no RPC provider configured for this network');
    if (!wstore.hasPermission(db, wcPerm(sel.network), 'read_public_data', sel.network)) throw new Error('data provider not enabled');
    try { const p = createEvmProvider({ network: sel.network, rpcUrl: rpc }), bal = await p.balance(sel.address), prev = wstore.previousBalance(db, sel.address, sel.network);
      wstore.saveSnapshot(db, wstore.saveConnection(db, { name: 'wc:trust', address: sel.address, network: sel.network }), sel.network, bal, [], p.name); audit('wc_refresh', 'ok', sel.network);
      if (prev !== null && BigInt(bal) > BigInt(prev)) {
        const message = `Balance rose on ${EVM_NETWORKS[sel.network].name}. This is an observed change, not a verified receipt.`;
        addNotification('wallet_balance_change', null, message);
        if (Notification.isSupported()) new Notification({ title: 'PromoGuard', body: message }).show();
      }
    } catch (e) { audit('wc_refresh', 'error', e.message); throw e; }
  }
  handle('wc:state', () => wcState());
  handle('wc:setProjectId', async id => { if (typeof id !== 'string' || !/^[A-Za-z0-9]{16,64}$/.test(id)) throw new Error('invalid project ID'); await wcConfig.setItem('projectId', id); wc = null; });
  handle('wc:setRpc', async (net, url) => { if (!EVM_NETWORKS[net]) throw new Error('unknown network'); let u; try { u = new URL(url); } catch { throw new Error('invalid URL'); } if (u.protocol !== 'https:' || u.username || u.password) throw new Error('RPC must be https');
    const ok = await dialog.showMessageBox(win, { type: 'question', buttons: ['Cancel', 'Use this provider'], defaultId: 0, cancelId: 0, message: 'Use this RPC provider?', detail: `${u.hostname} will receive your public address when you refresh balances. Check its terms and rate limits first.` });
    if (ok.response !== 1) return false; saveSettings({ evmRpc: { ...(getSettings().evmRpc || {}), [net]: url } }); return true; });
  handle('wc:connect', async nets => {
    if (!Array.isArray(nets) || !nets.length || nets.some(n => !EVM_NETWORKS[n])) throw new Error('choose supported networks'); const s = await ensureWc();
    const ok = await dialog.showMessageBox(win, { type: 'question', buttons: ['Cancel', 'Show QR code'], defaultId: 0, cancelId: 0, message: 'Connect Trust Wallet through WalletConnect?',
      detail: `Networks: ${nets.map(n => EVM_NETWORKS[n].name).join(', ')}.\nThe WalletConnect/Reown relay service carries the encrypted session. You approve in the Trust Wallet app. PromoGuard requests no signing or transaction methods.` });
    if (ok.response !== 1) { audit('wc_connect', 'declined'); return null; }
    wcSel = nets[0]; const uri = await s.connect(nets); audit('wc_connect', 'started'); return QRCode.toDataURL(uri, { margin: 1, width: 280 }); });   // URI is shown once, never stored or logged
  handle('wc:select', n => { if (!EVM_NETWORKS[n]) throw new Error('unknown network'); wcSel = n; });
  handle('wc:enableData', async () => { const { sel } = wcActive(); if (!sel) throw new Error('no supported account'); const rpc = rpcFor(sel.network); if (!rpc) throw new Error('configure an RPC provider first');
    const ok = await dialog.showMessageBox(win, { type: 'question', buttons: ['Cancel', 'Allow'], defaultId: 0, cancelId: 0, message: 'Send your public address to the RPC provider?', detail: `${new URL(rpc).hostname} receives your address and the network to return the native balance. No keys are sent.` });
    if (ok.response !== 1) return false; wstore.grantPermission(db, wcPerm(sel.network), 'read_public_data', sel.network); audit('wc_data_consent', 'granted', sel.network); return true; });
  handle('wc:revokeData', () => {
    const { sel } = wcActive(); if (!sel) throw new Error('no supported account');
    wstore.revokePermission(db, wcPerm(sel.network), 'read_public_data', sel.network);
    audit('wc_data_consent', 'revoked', sel.network);
    return true;
  });
  handle('wc:refresh', async () => { await refreshWc(); return true; });
  handle('wc:dashboard', async () => { const { sel } = wcActive(); return { state: await wcState(), data: sel ? wstore.latest(db, sel.address, sel.network) : null, symbol: sel ? EVM_NETWORKS[sel.network].symbol : null }; });
  handle('wc:disconnect', async () => { if (wc) await wc.disconnect(); audit('wc_disconnect', 'ok'); });
  handle('wc:explorer', () => { const { sel } = wcActive(); if (!sel) throw new Error('not connected'); return shell.openExternal(`${EVM_NETWORKS[sel.network].explorer}/address/${sel.address}`); });
  handle('wc:wipeLocal', async () => {
    if (wc) await wc.disconnect();
    wcStorage.clear(); wcConfig.clear(); wc = null;
    wstore.eraseProviderData(db, 'wc:', 'rpc:');
    audit('wc_local_wipe', 'ok');
  });
  // ---- Claim preparation (Phase 5, approve-intent only, no signing) ----
  handle('claim:prepare', (campaign, context = {}) => {
    if (!campaign || typeof campaign !== 'object') throw new Error('invalid campaign');
    const campaignId = int(campaign.id, 1, 1e9);
    const stored = db.prepare('SELECT evidence FROM reward_campaigns WHERE id=?').get(campaignId);
    const snapshot = latestSnapshot(db, campaignId);
    const fetchedTerms = stored && snapshot && stored.evidence === snapshot.url ? snapshot.content : undefined;
    const result = runPipeline(campaign, { ...context, fetchedTerms });
    return { stages: result.pipeline, final: result.final, reason: result.reason, unknown: result.unknown, evidence: result.evidence };
  });
  handle('claim:feeCheck', (campaign) => {
    if (!campaign || typeof campaign !== 'object') throw new Error('invalid campaign');
    return verifyFeeFree(campaign);
  });
  handle('claim:submit', (campaignId, { network, wallet, state, feeCheckResult, feeCheckEvidence }) => {
    if (!Number.isInteger(campaignId) || campaignId < 1) throw new Error('invalid campaign id');
    if (state !== 'AWAITING_USER_APPROVAL') throw new Error('PromoGuard cannot submit or mark a claim as submitted');
    const campaign = db.prepare('SELECT status,network FROM reward_campaigns WHERE id=?').get(campaignId);
    if (!campaign || campaign.status !== 'ELIGIBLE_FOR_REVIEW') throw new Error('campaign must be eligible for review');
    if (network !== campaign.network || typeof wallet !== 'string' || !wallet) throw new Error('wallet network must match the campaign');
    const id = saveClaimAttempt(db, { campaignId, network, wallet, state, feeCheckResult, feeCheckEvidence });
    audit('claim_preparation_saved', 'ok', String(campaignId));
    return { id };
  });
  handle('claim:list', () => getPendingClaims(db));
  handle('claim:evidence', (campaignId, { url, contentHash, note }) => {
    if (typeof campaignId !== 'number') throw new Error('invalid campaign id');
    if (!url || !contentHash) throw new Error('url and contentHash required');
    const id = recordEvidence(db, { campaignId, url, contentHash, note });
    audit('claim_evidence', 'recorded', String(campaignId));
    return { id };
  });
  handle('claim:monitor', async () => {
    const pending = getPendingClaims(db);
    const results = [];
    const s = getSettings();
    for (const p of pending) {
      if (p.state === 'AWAITING_USER_APPROVAL') continue;
      if (p.campaign_network.startsWith('ton')) {
        if (!wstore.hasPermission(db, PROV, 'read_public_data', p.network)) {
          results.push({ id: p.id, state: p.state, error: 'TON read consent required' });
          continue;
        }
        const prov = createProvider({ network: p.network });
        results.push(...await monitorTon(db, [p], prov, p.wallet));
      } else if (p.campaign_network.startsWith('eip155')) {
        const rpc = resolveRpc(p.network, s.evmRpc || {});
        let providerScope;
        try { providerScope = `rpc:${new URL(rpc).hostname}`; } catch { providerScope = null; }
        if (!providerScope || !wstore.hasPermission(db, providerScope, 'read_public_data', p.network)) {
          results.push({ id: p.id, state: p.state, error: 'EVM RPC read consent required' });
          continue;
        }
        const prov = createEvmProvider({ network: p.network, rpcUrl: rpc });
        results.push(...await monitorEvm(db, [p], prov, p.wallet));
      }
    }
    return { checked: pending.length, results };
  });

  // ---- AI / MCP (Phase 6, advisory only, read-only) ----
  handle('ai:summarize', async (campaignText) => {
    if (typeof campaignText !== 'string') throw new Error('invalid input');
    const msgs = summarizeRules(fenceInput(campaignText));
    const { content } = await ollamaChat({ messages: msgs });
    db.prepare('INSERT INTO ai_summaries(campaign_id,model,prompt_version,summary,created,flagged_uncertain) VALUES(?,?,?,?,?,?)').run(null, DEFAULT_MODEL, PROMPT_VERSION, content, now(), 0);
    return { content, advisory: true, model: DEFAULT_MODEL };
  });
  handle('ai:extract', async (campaignText) => {
    if (typeof campaignText !== 'string') throw new Error('invalid input');
    const msgs = extractAmountsDeadlines(fenceInput(campaignText));
    const { content } = await ollamaChat({ messages: msgs });
    return { content, advisory: true, model: DEFAULT_MODEL };
  });
  handle('ai:compare', async (campaignText) => {
    if (typeof campaignText !== 'string') throw new Error('invalid input');
    const msgs = compareTermsWithPolicy(fenceInput(campaignText), Object.keys(require('./src/policy').PAYMENT_FLAGS || {}));
    const { content } = await ollamaChat({ messages: msgs });
    return { content, advisory: true, model: DEFAULT_MODEL };
  });
  handle('ai:risk', async ({ campaignText, indicators }) => {
    if (typeof campaignText !== 'string') throw new Error('invalid input');
    const msgs = explainRiskIndicators(fenceInput(campaignText), Array.isArray(indicators) ? indicators : []);
    const { content } = await ollamaChat({ messages: msgs });
    return { content, advisory: true, model: DEFAULT_MODEL };
  });
  handle('ai:evidence', async ({ campaignName, evidence }) => {
    if (typeof campaignName !== 'string') throw new Error('invalid input');
    const msgs = writeEvidenceSummary(evidence, campaignName);
    const { content } = await ollamaChat({ messages: msgs });
    return { content, advisory: true, model: DEFAULT_MODEL };
  });
  handle('mcp:listTools', () => mcp.listTools());
  handle('mcp:invoke', (tool, args) => {
    if (typeof tool !== 'string') throw new Error('unknown or disallowed tool');
    return mcp.invoke(tool, args || {});
  });
  handle('mcp:grant', tool => mcp.grant(tool));
  handle('mcp:revoke', tool => mcp.revoke(tool));

  // ---- Phase 7: health, notifications, alerts, receipts ----
  handle('health:get', () => {
    const rows = db.prepare('SELECT key,value,updated FROM app_health ORDER BY key').all();
    return { health: rows.reduce((a, r) => { a[r.key] = { value: JSON.parse(r.value), updated: r.updated }; return a; }, {}), counts: {
      campaigns: db.prepare('SELECT COUNT(*) n FROM reward_campaigns').get().n,
      pendingClaims: db.prepare("SELECT COUNT(*) n FROM claim_attempts WHERE state IN ('CLAIM_SUBMITTED','REWARD_PENDING')").get().n,
      preparations: db.prepare("SELECT COUNT(*) n FROM claim_attempts WHERE state='AWAITING_USER_APPROVAL'").get().n,
      received: db.prepare("SELECT COUNT(*) n FROM claim_attempts WHERE state='REWARD_RECEIVED'").get().n,
      eligible: db.prepare("SELECT COUNT(*) n FROM reward_campaigns WHERE status='ELIGIBLE_FOR_REVIEW'").get().n,
      rejected: db.prepare("SELECT COUNT(*) n FROM reward_campaigns WHERE status IN ('REJECTED','INELIGIBLE')").get().n
    } };
    });
    handle('notifications:list', () => db.prepare('SELECT * FROM notifications ORDER BY shown_at DESC').all());
  handle('notifications:dismiss', (id) => { if (typeof id !== 'number') throw new Error('invalid id'); db.prepare('UPDATE notifications SET dismissed=1 WHERE id=?').run(id); return { id }; });
  handle('notifications:add', (kind, refId, msg) => ({ id: addNotification(kind, refId, msg) }));
  handle('alerts:list', () => {
    const alerts = [];
    const expiring = db.prepare(`SELECT id,name,end_date FROM reward_campaigns WHERE end_date IS NOT NULL AND status IN ('DISCOVERED','UNVERIFIED','UNDER_REVIEW','ELIGIBLE_FOR_REVIEW')`).all();
    const now = new Date(); const week = 7 * 24 * 60 * 60 * 1000;
    for (const c of expiring) { if (new Date(c.end_date) - now < week) alerts.push({ kind: 'expiry', refId: c.id, message: `Campaign "${c.name}" expires ${c.end_date}.` }); }
    const failed = db.prepare("SELECT id FROM claim_attempts WHERE state='FAILED'").all();
    for (const f of failed) alerts.push({ kind: 'failed_claim', refId: f.id, message: `Claim ${f.id} failed.` });
    const pending = db.prepare("SELECT id FROM claim_attempts WHERE state='REWARD_PENDING'").all();
    for (const p of pending) alerts.push({ kind: 'pending_reward', refId: p.id, message: `Claim ${p.id} awaiting on-chain confirmation.` });
    return alerts;
  });
  handle('receipts:list', () => db.prepare(`SELECT ca.*, rc.name, rc.network, rc.token_id, rc.reward_amount FROM claim_attempts ca JOIN reward_campaigns rc ON rc.id=ca.campaign_id ORDER BY ca.id DESC`).all());

  // ---- Analytics: read-only aggregates for graphical data views ----
  handle('analytics:overview', () => {
    const rows = store.list(db);
    const byStatus = {};
    let totalReward = 0; let rewardCount = 0; let minReward = Infinity; let maxReward = -Infinity;
    const byNetwork = {};
    rows.forEach(r => {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      if (r.network) { byNetwork[r.network] = (byNetwork[r.network] || 0) + 1; }
      if (typeof r.reward_amount === 'number' && Number.isFinite(r.reward_amount)) {
        totalReward += r.reward_amount; rewardCount++; if (r.reward_amount < minReward) minReward = r.reward_amount; if (r.reward_amount > maxReward) maxReward = r.reward_amount;
      }
    });
    return {
      total: rows.length,
      byStatus,
      byNetwork,
      rewards: { count: rewardCount, total: totalReward, avg: rewardCount ? totalReward / rewardCount : 0, min: minReward === Infinity ? 0 : minReward, max: maxReward === -Infinity ? 0 : maxReward }
    };
  });
  handle('analytics:campaigns', () => store.list(db).map(r => ({ id: r.id, name: r.name, status: r.status, network: r.network, reward_amount: r.reward_amount, end_date: r.end_date, last_checked: r.last_checked })));
  handle('analytics:history', () => {
    const rows = db.prepare('SELECT to_status, ts FROM status_history ORDER BY id ASC').all();
    const byDay = {}; rows.forEach(r => { const d = r.ts ? r.ts.slice(0, 10) : 'unknown'; byDay[d] = (byDay[d] || 0) + 1; });
    return { daily: Object.entries(byDay).sort(), total: rows.length };
  });
  handle('analytics:flags', () => {
    const rows = store.list(db); const counts = {};
    PAYMENT_FLAGS.forEach(f => { const key = FLAG_COLUMNS[f]; counts[f] = rows.filter(r => r[key] === 1).length; });
    return counts;
  });
  handle('analytics:rewards', () => {
    const rows = store.list(db).filter(r => typeof r.reward_amount === 'number' && Number.isFinite(r.reward_amount)).map(r => r.reward_amount).sort((a, b) => a - b);
    const bins = {}; rows.forEach(v => { const b = Math.floor(v / 5) * 5; bins[b] = (bins[b] || 0) + 1; });
    return { values: rows, bins: Object.entries(bins).sort((a, b) => Number(a[0]) - Number(b[0])), count: rows.length };
  });
  handle('analytics:activity', () => {
    const rows = db.prepare(`SELECT shown_at AS ts FROM notifications UNION ALL SELECT ts FROM wallet_transactions UNION ALL SELECT last_checked AS ts FROM reward_campaigns WHERE last_checked IS NOT NULL`).all();
    const grid = {}; rows.forEach(r => { if (!r.ts) return; const dt = new Date(r.ts); const dow = dt.getDay(); const hour = dt.getHours(); const key = `${dow},${hour}`; grid[key] = (grid[key] || 0) + 1; });
    return grid;
  });
  handle('analytics:statusTransitions', () => {
    const rows = db.prepare('SELECT from_status, to_status, COUNT(*) n FROM status_history GROUP BY from_status, to_status ORDER BY n DESC').all();
    return rows;
  });

  createWindow(); reschedule();
  if (process.env.PG_SMOKE) win.webContents.once('did-finish-load', async () => {
    const r = await win.webContents.executeJavaScript(`(async()=>{const o={};o.pg=typeof window.pg;o.node=typeof require+typeof process;
    o.offlineWebBundleApi=typeof window.pg.exportWebBundle==='function';
      o.styled=getComputedStyle(document.body).backgroundColor!=='rgba(0, 0, 0, 0)';
      o.viewCount=document.querySelectorAll('[data-view-panel]').length;
      o.navigationTargets=[...document.querySelectorAll('[data-view]')].every(b=>document.querySelector('[data-view-panel="'+b.dataset.view+'"]'));
      o.noHorizontalOverflow=document.documentElement.scrollWidth<=document.documentElement.clientWidth;
      o.previewNoticeHidden=document.querySelector('#runtimeNotice').hidden;
      o.appErrorHidden=document.querySelector('#appError').hidden;
      const campaignTotals=document.querySelector('#tally');
      o.dashboardStatsList=campaignTotals?.getAttribute('role')==='list'&&campaignTotals.getAttribute('aria-label')==='Campaign totals'&&campaignTotals.querySelectorAll(':scope > [role="listitem"]').length===4;
      o.accessibleControlsByView={};
      for(const name of ['overview','promoguard','markets','predictions','wallets','activity','analytics','settings']){
        document.querySelector('[data-view="'+name+'"]').click();
        await new Promise(resolve=>setTimeout(resolve,30));
        const panel=document.querySelector('[data-view-panel="'+name+'"]');
        const controls=[...panel.querySelectorAll('input:not([type="hidden"]),select,textarea,button')].filter(control=>control.getClientRects().length>0&&!control.disabled);
        o.accessibleControlsByView[name]=controls.filter(control=>{
          const named=control.matches('button')
            ? Boolean(control.getAttribute('aria-label')||control.getAttribute('title')||control.textContent.trim())
            : Boolean(control.getAttribute('aria-label')||control.getAttribute('aria-labelledby')||control.labels?.length);
          return !named;
        }).map(control=>`${control.tagName.toLowerCase()}${control.id?`#${control.id}`:''}`);
      }
      o.visibleControlsNamed=Object.values(o.accessibleControlsByView).every(missing=>missing.length===0);
      document.querySelector('[data-view="markets"]').click();
      o.marketsNavigation=!document.querySelector('#view-markets').hidden&&document.querySelector('#pageTitle').textContent==='Markets';
      o.marketsHeadingFocus=document.activeElement===document.querySelector('#view-markets h1')&&document.querySelector('#view-markets h1').tabIndex===-1;
      o.activeNavigation=document.querySelector('[data-view="markets"]').getAttribute('aria-current')==='page';
      document.querySelector('[data-view="analytics"]').click();
      o.analyticsNavigation=!document.querySelector('#view-analytics').hidden&&document.querySelector('#pageTitle').textContent==='Analytics';
      try{o.analyticsFlags=Object.keys(await pg.analyticsFlags()).length===10;o.analyticsActivity=typeof await pg.analyticsActivity()==='object'}catch(e){o.analytics='ERR '+e.message}
      document.querySelector('[data-view="overview"]').click();
      o.overviewNavigation=!document.querySelector('#view-overview').hidden&&document.querySelector('#view-markets').hidden;
      if(getComputedStyle(document.querySelector('#navToggle')).display!=='none'){
        const toggle=document.querySelector('#navToggle');
        toggle.click();o.mobileMenuExpanded=toggle.getAttribute('aria-expanded')==='true'&&toggle.getAttribute('aria-label')==='Close navigation';
        o.mobileMenuFocus=document.activeElement===document.querySelector('.primary-nav [data-view]');
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        o.mobileEscapeCloses=toggle.getAttribute('aria-expanded')==='false'&&toggle.getAttribute('aria-label')==='Open navigation'&&document.activeElement===toggle;
        toggle.click();
        document.querySelector('[data-view="wallets"]').click();
        o.mobileMenuCloses=toggle.getAttribute('aria-expanded')==='false'&&document.querySelector('#mobileBackdrop').hidden;
        o.mobileViewFocus=document.activeElement===document.querySelector('#view-wallets h1')
      }
      try{const a=await pg.addCampaign({name:'t',sourceUrl:'https://ton.org/a'});o.add=a.status;o.dup=(await pg.addCampaign({name:'t',sourceUrl:'https://ton.org/a/?utm_source=x'})).duplicate;
        await pg.reviewStart(a.id);o.review=(await pg.listCampaigns())[0].status;
        await pg.archiveCampaign(a.id,true);o.archived=(await pg.listCampaigns()).length===0&&(await pg.listArchivedCampaigns()).some(c=>c.id===a.id);
        await pg.archiveCampaign(a.id,false);
        let proof={evidenceUrl:'https://ton.org/terms',confirmFree:true,rewardAmount:1,tokenId:'ton:native'};
        o.sourceUnverified=(await pg.reviewEvidence(a.id,proof)).status;
        o.snapshot=(await pg.saveCampaignTermsSnapshot(a.id,'https://ton.org/terms','No payment is required.')).contentHash.length===64;
        document.querySelector('[data-view="promoguard"]').click();
        document.getElementById('campaignSearch').dispatchEvent(new Event('input'));
        for(let i=0;i<40&&document.querySelector('#campaignListStatus')?.textContent!=='Showing 1 of 1 campaign record.';i++)await new Promise(resolve=>setTimeout(resolve,25));
        o.campaignListAnnounced=document.querySelector('#campaignListStatus')?.getAttribute('role')==='status'&&document.querySelector('#campaignListStatus').getAttribute('aria-live')==='polite'&&document.querySelector('#campaignListStatus').textContent==='Showing 1 of 1 campaign record.';
        const campaignResults=document.querySelector('#list');
        o.campaignResultsList=campaignResults?.getAttribute('role')==='list'&&campaignResults.getAttribute('aria-label')==='Campaign search results'&&campaignResults.querySelectorAll(':scope > [role="listitem"]').length===1;
        const search=document.getElementById('campaignSearch');
        search.value='no matching campaign in smoke';
        search.dispatchEvent(new Event('input'));
        for(let i=0;i<40&&document.querySelector('#campaignListStatus')?.textContent!=='Showing 0 of 1 campaign record. No records match the selected filters.';i++)await new Promise(resolve=>setTimeout(resolve,25));
        o.campaignEmptyListItem=campaignResults.querySelector(':scope > [role="listitem"]')?.textContent==='No campaigns match these filters.';
        o.campaignEmptyAnnounced=document.querySelector('#campaignListStatus')?.textContent==='Showing 0 of 1 campaign record. No records match the selected filters.';
        search.value='';
        search.dispatchEvent(new Event('input'));
        for(let i=0;i<40&&document.querySelectorAll('#list .snapshot-diff label').length<2;i++)await new Promise(resolve=>setTimeout(resolve,25));
        const revisionLabels=[...document.querySelectorAll('#list .snapshot-diff label')];
        o.snapshotRevisionLabels=revisionLabels.length===2&&revisionLabels.every(label=>Boolean(label.querySelector('select')&&label.querySelector('span').textContent.trim()));
        const reviewControls=[...document.querySelectorAll('#list .rev input,#list .rev textarea,#list .rev select')];
        o.reviewControlsLabeled=reviewControls.length===8&&reviewControls.every(control=>Boolean(control.closest('label')||control.labels?.length||control.getAttribute('aria-label')));
        await pg.saveCampaignTermsSnapshot(a.id,'https://ton.org/terms','No payment is required. Terms updated for smoke test.');
        document.getElementById('campaignSearch').dispatchEvent(new Event('input'));
        for(let i=0;i<40&&document.querySelectorAll('#list .snapshot-diff select option').length<4;i++)await new Promise(resolve=>setTimeout(resolve,25));
        const comparison=document.querySelector('#list .diff-result');
        o.snapshotComparisonAnnounced=Boolean(comparison&&comparison.getAttribute('role')==='status'&&comparison.getAttribute('aria-live')==='polite'&&comparison.getAttribute('aria-atomic')==='true');
        document.querySelector('#list .snapshot-diff button').click();
        for(let i=0;i<40&&!document.querySelector('#list .diff-table [role="listitem"]');i++)await new Promise(resolve=>setTimeout(resolve,25));
        const diffRows=[...document.querySelectorAll('#list .diff-table [role="listitem"]')];
        o.diffRowsAccessible=diffRows.length>0&&diffRows.some(row=>row.getAttribute('aria-label')?.startsWith('Added line:'))&&diffRows.every(row=>row.querySelector('.diff-marker')?.getAttribute('aria-hidden')==='true');
        proof.confirmOfficialSource=true;o.sourceAttested=(await pg.reviewEvidence(a.id,proof)).status;
        o.preflightSnapshot=(await pg.claimPrepare((await pg.listCampaigns())[0],{fetchedTerms:'forged renderer evidence'})).reason!=='official_terms_not_fetched'
      }catch(e){o.add='ERR '+e.message}
      try{o.badDomain='ACCEPTED';await pg.addApprovedDomain('https://bad.example/path')}catch(e){o.badDomain='rejected'}
      try{o.domainAdded=(await pg.addApprovedDomain('smoke.example')).added;o.domainRemoved=(await pg.removeApprovedDomain('smoke.example')).removed}catch(e){o.domain='ERR '+e.message}
      try{await pg.addFeed('http://127.0.0.1/x');o.badfeed='ACCEPTED'}catch(e){o.badfeed='rejected'}
      try{await pg.tonSetManifest('http://x.io/m.json');o.badmanifest='ACCEPTED'}catch(e){o.badmanifest='rejected'}
      try{const d=await pg.tonDashboard();o.ton=d.state.status+'/'+d.state.selectedNetwork+'/consent='+d.state.dataConsent}catch(e){o.ton='ERR '+e.message}
      try{await pg.tonRefresh();o.refresh='RAN'}catch(e){o.refresh='refused'}
      try{const w=await pg.wcState();o.wc=w.status+'/id='+w.projectIdSet}catch(e){o.wc='ERR'}
      try{await pg.wcSetProjectId('not-hex');o.badpid='ACCEPTED'}catch(e){o.badpid='rejected'}
      try{await pg.wcRefresh('eip155:1','0x'+'a'.repeat(40));o.wcrefresh='RAN'}catch(e){o.wcrefresh='refused'}
      try{const w=await pg.wcDashboard();o.wc=w.state.status+'/pid='+w.state.projectIdSet}catch(e){o.wc='ERR '+e.message}
      try{await pg.wcSetProjectId('bad id!');o.wcbad='ACCEPTED'}catch(e){o.wcbad='rejected'}
      try{await pg.wcRefresh();o.wcrefresh='RAN'}catch(e){o.wcrefresh='refused'}
      try{
        const before=await pg.getSettings();o.minRewardDefault=before.minReward;
        const saved=await pg.setMinReward(0);o.minRewardSaved=saved.minReward===0;
        const added=await pg.addFeed('https://example.org/announcements.xml');
        o.feedAdded=added.added&&(await pg.listFeeds()).includes('https://example.org/announcements.xml');
        const removed=await pg.removeFeed('https://example.org/announcements.xml');
        o.feedRemoved=removed.removed&&!(await pg.listFeeds()).includes('https://example.org/announcements.xml');
        o.scheduleDisabled=!(await pg.getSettings()).scheduleEnabled
      }catch(e){o.settings='ERR '+e.message}
      try{
        const n=await pg.notificationsAdd('smoke',null,'Smoke notification message');
        o.notificationMessage=(await pg.notificationsList()).find(x=>x.id===n.id).message==='Smoke notification message';
        o.notificationDismissed=(await pg.notificationsDismiss(n.id)).id===n.id
      }catch(e){o.notification='ERR '+e.message}
      o.signApi=Object.keys(pg).filter(k=>/^(sign|signData|send|sendTransaction|approve|approveToken|transfer|transferFrom|requestTransaction)$/i.test(k)).length;
      o.inline=await new Promise(r=>{window.__x=0;const s=document.createElement('script');s.textContent='window.__x=1';document.head.append(s);setTimeout(()=>r(window.__x===1?'RAN':'blocked'),200)});
      return o})()`);
    const required = ['pg','node','offlineWebBundleApi','styled','viewCount','navigationTargets','noHorizontalOverflow','previewNoticeHidden','appErrorHidden',
      'dashboardStatsList','visibleControlsNamed','marketsNavigation','marketsHeadingFocus','activeNavigation','analyticsNavigation','analyticsFlags','analyticsActivity','overviewNavigation','add','dup','review','archived','sourceUnverified','snapshot','sourceAttested','preflightSnapshot','badDomain','domainAdded','domainRemoved',
      'campaignListAnnounced','campaignResultsList','campaignEmptyListItem','campaignEmptyAnnounced','snapshotRevisionLabels','reviewControlsLabeled','snapshotComparisonAnnounced','diffRowsAccessible','badfeed','badmanifest','ton','refresh','wc','badpid','wcrefresh','wcbad','minRewardDefault','minRewardSaved','feedAdded','feedRemoved',
      'scheduleDisabled','notificationMessage','notificationDismissed','signApi','inline'];
    const checks = { pg: r.pg === 'object', node: r.node === 'undefinedundefined', offlineWebBundleApi: r.offlineWebBundleApi, styled: r.styled,
      viewCount: r.viewCount === 8, navigationTargets: r.navigationTargets, noHorizontalOverflow: r.noHorizontalOverflow,
      previewNoticeHidden: r.previewNoticeHidden, appErrorHidden: r.appErrorHidden, marketsNavigation: r.marketsNavigation,
      dashboardStatsList: r.dashboardStatsList,
      visibleControlsNamed: r.visibleControlsNamed,
      marketsHeadingFocus: r.marketsHeadingFocus, activeNavigation: r.activeNavigation,
      analyticsNavigation: r.analyticsNavigation, overviewNavigation: r.overviewNavigation, add: r.add === 'UNVERIFIED', dup: r.dup, review: r.review === 'UNDER_REVIEW',
      analyticsFlags: r.analyticsFlags, analyticsActivity: r.analyticsActivity,
      archived: r.archived,
      sourceUnverified: r.sourceUnverified === 'UNDER_REVIEW', snapshot: r.snapshot, sourceAttested: r.sourceAttested === 'ELIGIBLE_FOR_REVIEW',
      snapshotRevisionLabels: r.snapshotRevisionLabels,
      reviewControlsLabeled: r.reviewControlsLabeled,
      campaignListAnnounced: r.campaignListAnnounced,
      campaignResultsList: r.campaignResultsList,
      campaignEmptyListItem: r.campaignEmptyListItem,
      campaignEmptyAnnounced: r.campaignEmptyAnnounced,
      snapshotComparisonAnnounced: r.snapshotComparisonAnnounced,
      diffRowsAccessible: r.diffRowsAccessible,
      preflightSnapshot: r.preflightSnapshot,
      badDomain: r.badDomain === 'rejected', domainAdded: r.domainAdded, domainRemoved: r.domainRemoved, badfeed: r.badfeed === 'rejected',
      badmanifest: r.badmanifest === 'rejected', ton: r.ton === 'disconnected/ton-testnet/consent=false', refresh: r.refresh === 'refused',
      wc: r.wc === 'disconnected/pid=false', badpid: r.badpid === 'rejected', wcrefresh: r.wcrefresh === 'refused',
      wcbad: r.wcbad === 'rejected', minRewardDefault: r.minRewardDefault === 0.01, minRewardSaved: r.minRewardSaved,
      feedAdded: r.feedAdded, feedRemoved: r.feedRemoved, scheduleDisabled: r.scheduleDisabled,
      notificationMessage: r.notificationMessage, notificationDismissed: r.notificationDismissed, signApi: r.signApi === 0, inline: r.inline === 'blocked' };
    const failed = required.filter(k => checks[k] !== true);
    if (process.env.PG_SMOKE_WIDTH && Number(process.env.PG_SMOKE_WIDTH) <= 760) {
      if (!r.mobileMenuExpanded) failed.push('mobileMenuExpanded');
      if (!r.mobileMenuFocus) failed.push('mobileMenuFocus');
      if (!r.mobileEscapeCloses) failed.push('mobileEscapeCloses');
      if (!r.mobileMenuCloses) failed.push('mobileMenuCloses');
      if (!r.mobileViewFocus) failed.push('mobileViewFocus');
    }
    console.log('SMOKE ' + JSON.stringify({ ...r, failed }));
    app.exit(failed.length ? 1 : 0);
  });
});
app.on('window-all-closed', () => app.quit());
