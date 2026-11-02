const test = require('node:test'), assert = require('node:assert');
const { fetchTerms, normalizeTermsUrl, contentHash, isPrivateOrResolvedPrivate } = require('../src/terms-fetch');
const publicResolver = async host => ({ host, addresses: ['93.184.216.34'], error: null });
const fetchMock = (url, options) => globalThis.fetch(url, options);
const fetchWithMock = (url, options = {}) => fetchTerms(url, { fetchImpl: fetchMock, resolveHostImpl: publicResolver, ...options });

function responding(status, body, headers = {}) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers } });
}

test('normalizeTermsUrl rejects non-https', () => assert.throws(() => normalizeTermsUrl('http://example.com/terms'), /public HTTPS/));
test('normalizeTermsUrl rejects credentials', () => assert.throws(() => normalizeTermsUrl('https://user:pass@example.com/terms'), /public HTTPS/));
test('normalizeTermsUrl rejects fragment', () => assert.throws(() => normalizeTermsUrl('https://example.com/terms#x'), /fragment/));
test('normalizeTermsUrl rejects IP host', () => assert.throws(() => normalizeTermsUrl('https://127.0.0.1/terms')));
test('normalizeTermsUrl accepts valid https', () => assert.equal(normalizeTermsUrl('https://example.com/terms'), 'https://example.com/terms'));

test('contentHash is stable and 64 hex chars', () => {
  const h = contentHash('hello'); assert.equal(h.length, 64); assert.equal(contentHash('hello'), h);
});

test('fetchTerms returns content and hash', async () => {
  globalThis.fetch = () => Promise.resolve(responding(200, 'No payment is required.'));
  const r = await fetchWithMock('https://example.com/terms');
  assert.equal(r.content, 'No payment is required.');
  assert.equal(r.contentHash, contentHash('No payment is required.'));
  assert.ok(r.fetchedAt);
  assert.equal(r.redirects.length, 0);
});

test('fetchTerms follows redirects and validates each target', async () => {
  let calls = 0;
  globalThis.fetch = (url) => {
    calls++;
    if (calls === 1) return Promise.resolve(responding(302, '', { location: 'https://example.com/final' }));
    return Promise.resolve(responding(200, 'final terms'));
  };
  const r = await fetchWithMock('https://example.com/start');
  assert.equal(calls, 2);
  assert.equal(r.url, 'https://example.com/final');
  assert.equal(r.content, 'final terms');
  assert.equal(r.redirects.length, 1);
  assert.equal(r.redirects[0].status, 302);
});

test('fetchTerms blocks redirect to private host', async () => {
  globalThis.fetch = () => Promise.resolve(responding(302, '', { location: 'http://127.0.0.1/terms' }));
  await assert.rejects(fetchWithMock('https://example.com/terms'));
});

test('fetchTerms rejects oversized response', async () => {
  globalThis.fetch = () => Promise.resolve(responding(200, 'x'.repeat(200_000)));
  await assert.rejects(fetchWithMock('https://example.com/terms'), /too large/);
});

test('fetchTerms rejects http scheme', async () => {
  await assert.rejects(fetchTerms('http://example.com/terms'), /public HTTPS/);
});

test('isPrivateOrResolvedPrivate flags local/private hosts', () => {
  assert.ok(isPrivateOrResolvedPrivate('localhost'));
  assert.ok(isPrivateOrResolvedPrivate('127.0.0.1'));
  assert.ok(isPrivateOrResolvedPrivate('10.0.0.1'));
  assert.ok(isPrivateOrResolvedPrivate('192.168.1.5'));
  assert.ok(isPrivateOrResolvedPrivate('172.20.0.1'));
  assert.ok(!isPrivateOrResolvedPrivate('example.com'));
  assert.ok(!isPrivateOrResolvedPrivate('ton.org'));
});

test('terms requests reject mixed public and private DNS results before connecting', async () => {
  let calls = 0;
  await assert.rejects(fetchTerms('https://example.com/terms', {
    resolveHostImpl: async host => ({ host, addresses: ['93.184.216.34', '10.0.0.4'], error: null }),
    fetchImpl: async () => { calls++; return responding(200, 'must not be requested'); }
  }), /public IP/);
  assert.equal(calls, 0);
});
