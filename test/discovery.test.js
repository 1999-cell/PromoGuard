const test = require('node:test'), assert = require('node:assert');
const d = require('../src/discovery');
test('blocks unsafe feed urls', () => {
  for (const u of ['http://a.com/x','https://localhost/x','https://127.0.0.1/x','https://u:p@a.com','file:///c:/x','nope']) assert.equal(d.isSafeFeedUrl(u), false);
  assert.equal(d.isSafeFeedUrl('https://news.google.com/rss/search?q=airdrop'), true);
});
test('parses rss and filters relevance', () => {
  const x = '<rss><item><title><![CDATA[Free token airdrop live]]></title><link>https://a.com/1</link></item><item><title>Weather</title><link>https://a.com/2</link></item></rss>';
  const items = d.parseRss(x); assert.equal(items.length, 2); assert.equal(items.filter(d.relevant).length, 1);
});
test('parses gdelt', () => assert.equal(d.parseGdelt('{"articles":[{"title":"Airdrop","url":"https://b.com"}]}').length, 1));
test('discovered items never become eligible', () => {
  const { evaluateCampaign } = require('../src/policy');
  assert.notEqual(evaluateCampaign({ name:'Free airdrop', sourceUrl:'https://ton.org/a' }, { minReward:0.01, approvedDomains:['ton.org'] }).status, 'eligible');
});
test('feed requests reject mixed public and private DNS results before connecting', async () => {
  let calls = 0;
  await assert.rejects(d.fetchFeed('https://feed.example/rss', {
    retries: 0,
    resolveHostImpl: async host => ({ host, addresses: ['93.184.216.34', '192.168.1.5'], error: null }),
    fetchImpl: async () => { calls++; return new Response('<rss/>'); }
  }), /public IP/);
  assert.equal(calls, 0);
});
test('feed redirects re-resolve and reject a private destination', async () => {
  let calls = 0;
  await assert.rejects(d.fetchFeed('https://feed.example/rss', {
    retries: 0,
    resolveHostImpl: async host => ({ host, addresses: host === 'feed.example' ? ['93.184.216.34'] : ['127.0.0.1'], error: null }),
    fetchImpl: async () => {
      calls++;
      return new Response('', { status: 302, headers: { location: 'https://private.example/rss' } });
    }
  }), /public IP/);
  assert.equal(calls, 1);
});
