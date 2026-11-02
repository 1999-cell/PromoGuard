'use strict';
const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const DATA_BASE = 'https://data-api.polymarket.com';
const MAX_BYTES = 2_000_000;

async function fetchJson(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'PromoGuard/0.2', Accept: 'application/json' } });
  if (!res.ok) { const e = new Error('http ' + res.status); e.retry = res.status >= 500 || res.status === 429; throw e; }
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('response too large');
  return JSON.parse(text);
}

function normalizeMarket(m) {
  if (!m || !m.id) return null;
  return {
    id: String(m.id),
    slug: m.slug || null,
    question: m.question || m.title || '',
    category: m.category || null,
    endDate: m.endDate || m.end_date_iso || null,
    volume: m.volume || m.volumeNum || null,
    liquidity: m.liquidity || m.liquidityNum || null,
    active: m.active !== false,
    closed: !!m.closed,
    outcomePrices: m.outcomePrices || null,
    webUrl: m.slug ? `https://polymarket.com/event/${m.slug}` : null
  };
}

async function fetchMarkets({ limit = 20, offset = 0, active = true, closed = false, fetchImpl = fetch } = {}) {
  const url = `${GAMMA_BASE}/markets?limit=${limit}&offset=${offset}&active=${active}&closed=${closed}`;
  const data = await fetchJson(url, fetchImpl);
  const arr = Array.isArray(data) ? data : (data.markets || data.data || []);
  return arr.map(normalizeMarket).filter(Boolean);
}

async function fetchMarket(id, fetchImpl = fetch) {
  const data = await fetchJson(`${GAMMA_BASE}/markets/${encodeURIComponent(id)}`, fetchImpl);
  return normalizeMarket(data);
}

async function searchMarkets(query, fetchImpl = fetch) {
  const url = `${GAMMA_BASE}/markets?_q=${encodeURIComponent(query)}&limit=20`;
  const data = await fetchJson(url, fetchImpl);
  const arr = Array.isArray(data) ? data : (data.markets || data.data || []);
  return arr.map(normalizeMarket).filter(Boolean);
}

async function fetchPositions(address, fetchImpl = fetch) {
  if (!address) throw new Error('address required');
  const url = `${DATA_BASE}/positions?user=${encodeURIComponent(address)}`;
  const data = await fetchJson(url, fetchImpl);
  const arr = Array.isArray(data) ? data : (data.positions || data.data || []);
  return arr.map(p => ({
    conditionId: p.conditionId || p.condition_id || null,
    title: p.title || p.market || '',
    outcome: p.outcome || null,
    size: p.size || null,
    avgPrice: p.avgPrice || null,
    currentValue: p.currentValue || null,
    redeemable: !!p.redeemable,
    webUrl: p.slug ? `https://polymarket.com/event/${p.slug}` : null
  }));
}

module.exports = { GAMMA_BASE, DATA_BASE, fetchMarkets, fetchMarket, searchMarkets, fetchPositions, normalizeMarket };
