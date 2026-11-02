const test = require('node:test');
const assert = require('node:assert');
const { fetchPublicHttps, isPublicIp } = require('../src/safe-http');

test('public IP validation rejects special-use IPv4 and IPv6 ranges', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '100.64.0.1', '169.254.1.1', '172.31.0.1',
    '192.168.1.1', '198.18.0.1', '203.0.113.1', '224.0.0.1', '::1', '::ffff:127.0.0.1',
    'fc00::1', 'fe80::1', '2001:db8::1', '2002::1']) assert.equal(isPublicIp(address), false, address);
  for (const address of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) assert.equal(isPublicIp(address), true, address);
});

test('HTTPS transport pins the request to a validated DNS address', async () => {
  let actualHost;
  let pinnedAddress;
  const response = { status: 200, ok: true, headers: new Headers(), body: null };
  await fetchPublicHttps('https://feed.example/rss', {
    resolveHostImpl: async host => ({ host, addresses: ['93.184.216.34'], error: null }),
    requestImpl: async (url, address) => {
      actualHost = url.hostname;
      pinnedAddress = address;
      return response;
    }
  });
  assert.equal(actualHost, 'feed.example');
  assert.equal(pinnedAddress, '93.184.216.34');
});

test('HTTPS transport refuses a mixed public/private DNS answer before connecting', async () => {
  let connected = false;
  await assert.rejects(fetchPublicHttps('https://feed.example/rss', {
    resolveHostImpl: async host => ({ host, addresses: ['93.184.216.34', '10.0.0.5'], error: null }),
    requestImpl: async () => { connected = true; }
  }), /public IP/);
  assert.equal(connected, false);
});
