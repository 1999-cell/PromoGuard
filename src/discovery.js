'use strict';
const net = require('net');
const { fetchPublicHttps } = require('./safe-http');
const KEYWORDS = /(airdrop|giveaway|free\s+(token|crypto|nft|claim)|learn[\s-]?and[\s-]?earn|reward|bounty|campaign|promo)/i;
const TEMPLATES = { googleNews: 'https://news.google.com/rss/search?q={q}', gdelt: 'https://api.gdeltproject.org/api/v2/doc/doc?query={q}&mode=artlist&format=json&maxrecords=25' };
const MAX_BYTES = 2_000_000, MAX_REDIRECTS = 3;
function isSafeFeedUrl(raw) {
  let u; try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return false;
  if (net.isIP(h) || h.startsWith('[')) return false;
  return true;
}
const clean = s => (s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
const tag = (block, t) => (block.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`, 'i')) || [])[1];
function parseRss(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const title = clean(tag(m[0], 'title')), link = clean(tag(m[0], 'link'));
    if (title && link) out.push({ title: title.slice(0, 200), link, description: clean(tag(m[0], 'description')).slice(0, 500), published: tag(m[0], 'pubDate') || null });
  }
  return out;
}
function parseAtom(xml) {
  const out = [];
  for (const m of xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
    const href = (m[0].match(/<link\b[^>]*\bhref=["']([^"']+)["']/i) || [])[1];
    const title = clean(tag(m[0], 'title'));
    if (title && href) out.push({ title: title.slice(0, 200), link: href, description: clean(tag(m[0], 'summary') || tag(m[0], 'content')).slice(0, 500), published: tag(m[0], 'updated') || null });
  }
  return out;
}
function parseGdelt(json) {
  try { return (JSON.parse(json).articles || []).filter(a => a && a.url && a.title).map(a => ({ title: String(a.title).slice(0, 200), link: String(a.url), description: '', published: a.seendate || null })); }
  catch { return []; }
}
function parseFeed(text) {
  const t = text.trimStart();
  if (t.startsWith('{')) return parseGdelt(text);
  if (/<feed\b/i.test(t)) return parseAtom(text);
  if (/<(rss|rdf:RDF|channel)\b/i.test(t)) return parseRss(text);
  throw new Error('malformed feed');
}
const relevant = i => KEYWORDS.test(`${i.title} ${i.description}`);
// Same campaign reached through tracking-parameter or trailing-slash variants gets the same key.
function dedupeKey(raw) {
  try {
    const u = new URL(raw); u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$)/i.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '') || '/'}${u.search}`;
  } catch { return null; }
}
async function readLimited(res, max) {
  const reader = res.body.getReader(); const chunks = []; let total = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length;
    if (total > max) { await reader.cancel(); throw new Error('response too large'); } chunks.push(value); }
  return Buffer.concat(chunks).toString('utf8');
}
class HostLimiter {            // minimum gap between requests to the same host
  constructor(gapMs = 2000, clock = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms))) { this.gap = gapMs; this.last = new Map(); this.clock = clock; this.sleep = sleep; }
  async wait(host) { const prev = this.last.get(host); if (prev !== undefined) { const d = prev + this.gap - this.clock(); if (d > 0) await this.sleep(d); } this.last.set(host, this.clock()); }
}
async function fetchOnce(url, fetchImpl, max, resolveHostImpl) {
  let cur = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {      // every redirect target is re-validated
    if (!isSafeFeedUrl(cur)) throw new Error('unsafe url');
    const res = await fetchPublicHttps(cur, { fetchImpl, resolveHostImpl, timeoutMs: 15000, maxBytes: max, signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'PromoGuard/0.2' } });
    if ([301, 302, 303, 307, 308].includes(res.status)) { const loc = res.headers.get('location'); if (!loc) throw new Error('bad redirect'); cur = new URL(loc, cur).href; continue; }
    if (!res.ok) { const e = new Error('http ' + res.status); e.retry = res.status >= 500 || res.status === 429; throw e; }
    return parseFeed(await readLimited(res, max));
  }
  throw new Error('too many redirects');
}
async function fetchFeed(url, { fetchImpl, resolveHostImpl, sleep = ms => new Promise(r => setTimeout(r, ms)), retries = 2, max = MAX_BYTES } = {}) {
  for (let n = 0; ; n++) {
    try { return await fetchOnce(url, fetchImpl, max, resolveHostImpl); }
    catch (e) { const transient = e.retry || e.name === 'TimeoutError' || e.name === 'TypeError'; if (!transient || n >= retries) throw e; await sleep(500 * 2 ** n); }
  }
}
module.exports = { readLimited, isSafeFeedUrl, parseRss, parseAtom, parseGdelt, parseFeed, relevant, dedupeKey, fetchFeed, HostLimiter, TEMPLATES, MAX_BYTES };
