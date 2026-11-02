const test = require('node:test'), assert = require('node:assert');
const p = require('../src/markets/polymarket');

test('normalizeMarket builds web url', () => {
  const m = p.normalizeMarket({ id: '1', slug: 'foo', question: 'Will X?', active: true });
  assert.equal(m.id, '1');
  assert.equal(m.webUrl, 'https://polymarket.com/event/foo');
});

test('fetchMarkets maps mocked response', async () => {
  const fake = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify([{ id: '2', question: 'Q2', slug: 'q2' }]), body: { getReader: () => ({ read: async () => ({ done: true }) }) } });
  const out = await p.fetchMarkets({ fetchImpl: fake });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, '2');
});

test('fetchPositions requires address', async () => {
  await assert.rejects(() => p.fetchPositions(''), /address required/);
});
