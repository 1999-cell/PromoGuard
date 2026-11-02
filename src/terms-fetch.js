'use strict';

const net = require('net');
const crypto = require('crypto');
const { isSafeFeedUrl } = require('./discovery');
const { fetchPublicHttps, isPublicIp, resolveHost } = require('./safe-http');

const MAX_TERMS_BYTES = 100_000;
const MAX_TERMS_REDIRECTS = 5;
const TERMS_FETCH_TIMEOUT_MS = 15000;
const PRIVATE_IP_PREFIXES = ['10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.', '192.168.', '127.', '0.0.0.0', '::1', '::ffff:127.0.0.1', '::ffff:0.0.0.0'];
const LINK_LOCAL_PREFIX = '169.254.';

function isPrivateOrResolvedPrivate(host) {
  if (net.isIP(host)) {
    if (host === '127.0.0.1' || host === '0.0.0.0') return true;
    if (host.startsWith('10.') || host.startsWith(LINK_LOCAL_PREFIX)) return true;
    if (host.startsWith('172.')) {
      const parts = host.split('.');
      const second = Number(parts[1]);
      if (Number.isInteger(second) && second >= 16 && second <= 31) return true;
    }
    if (host.startsWith('192.168.')) return true;
    if (host.includes(':')) {
      const lower = host.toLowerCase();
      if (lower === '::1' || lower.startsWith('::ffff:127.0.0.1') || lower.startsWith('::ffff:0.0.0.0') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
      if (lower.startsWith('fe80:')) return true;
    }
    return false;
  }
  const lower = host.toLowerCase();
  return lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal') || lower.endsWith('.localhost') || lower.startsWith('xn--');
}

function normalizeTermsUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('terms URL is invalid');
  let url;
  try { url = new URL(value); } catch { throw new Error('terms URL is invalid'); }
  if (!isSafeFeedUrl(url.href) || url.hash) throw new Error('terms URL must be a public HTTPS URL without credentials or a fragment');
  if (isPrivateOrResolvedPrivate(url.hostname)) throw new Error('terms URL must point to a public host');
  return url.href;
}

function contentHash(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

function hostMatchesEvidence(fetchedUrl, evidenceUrl) {
  const fh = hostOf(fetchedUrl); const eh = hostOf(evidenceUrl);
  if (!fh || !eh) return false;
  if (fh === eh) return true;
  if (fh.endsWith('.' + eh)) return true;
  return false;
}

async function verifySource(url, expectedEvidenceUrl = null) {
  const normalized = normalizeTermsUrl(url);
  const parsed = new URL(normalized);
  const resolution = await resolveHost(parsed.hostname);
  const publicIps = resolution.addresses.filter(isPublicIp);
  const allPublic = resolution.addresses.length > 0 && publicIps.length === resolution.addresses.length;
  const ownershipMatch = expectedEvidenceUrl ? hostMatchesEvidence(normalized, expectedEvidenceUrl) : null;
  return {
    url: normalized,
    hostname: parsed.hostname,
    dnsResolution: resolution,
    allAddressesPublic: allPublic,
    ownershipMatch,
    verified: allPublic && (expectedEvidenceUrl === null || ownershipMatch === true),
    note: expectedEvidenceUrl && !ownershipMatch ? 'Fetched domain does not match the campaign evidence URL — treat as unverified.' : null
  };
}

async function readLimited(res, max) {
  const reader = res.body.getReader(); const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.length; if (total > max) { await reader.cancel(); throw new Error('terms page too large'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchTerms(url, { fetchImpl, resolveHostImpl = resolveHost, max = MAX_TERMS_BYTES, maxRedirects = MAX_TERMS_REDIRECTS, timeoutMs = TERMS_FETCH_TIMEOUT_MS, expectedEvidenceUrl = null } = {}) {
  const startUrl = normalizeTermsUrl(url);
  let cur = startUrl; const redirects = [];
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!isSafeFeedUrl(cur)) throw new Error('unsafe redirect target');
    const parsed = new URL(cur);
    if (isPrivateOrResolvedPrivate(parsed.hostname)) throw new Error('redirect target is not a public host');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchPublicHttps(cur, { fetchImpl, resolveHostImpl, timeoutMs, maxBytes: max, tooLargeMessage: 'terms page too large',
        signal: controller.signal, headers: { 'User-Agent': 'PromoGuard/0.2' } });
    } finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location'); if (!loc) throw new Error('bad redirect');
      const next = new URL(loc, cur).href; redirects.push({ from: cur, to: next, status: res.status }); cur = next; continue;
    }
    if (!res.ok) { const e = new Error(`http ${res.status}`); e.retry = res.status >= 500 || res.status === 429; throw e; }
    const text = await readLimited(res, max);
    const resolution = { host: new URL(cur).hostname, addresses: res.resolvedAddresses || [], error: null };
    const publicIps = resolution.addresses.filter(isPublicIp);
    const allPublic = resolution.addresses.length > 0 && publicIps.length === resolution.addresses.length;
    return { url: cur, requestedUrl: startUrl, content: text, contentHash: contentHash(text), bytes: Buffer.byteLength(text, 'utf8'), fetchedAt: new Date().toISOString(), redirects, ownershipMatch: expectedEvidenceUrl ? hostMatchesEvidence(cur, expectedEvidenceUrl) : null, sourceVerification: { hostname: new URL(cur).hostname, dnsResolution: resolution, allAddressesPublic: allPublic, verified: allPublic && (expectedEvidenceUrl === null || hostMatchesEvidence(cur, expectedEvidenceUrl) === true) } };
  }
  throw new Error('too many redirects');
}

module.exports = { MAX_TERMS_BYTES, MAX_TERMS_REDIRECTS, TERMS_FETCH_TIMEOUT_MS, normalizeTermsUrl, contentHash, fetchTerms, isPrivateOrResolvedPrivate, hostMatchesEvidence, verifySource, resolveHost, isPublicIp };
