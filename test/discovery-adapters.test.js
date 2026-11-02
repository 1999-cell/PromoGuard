const test = require('node:test'), assert = require('node:assert');
const a = require('../src/discovery-adapters');
test('listAdapters includes githubReleases', () => assert.ok(a.listAdapters().includes('githubReleases')));
test('buildUrl github', () => assert.equal(a.buildUrl('githubReleases', 'foo/bar'), 'https://github.com/foo/bar/releases.atom'));
test('normalizeItem', () => {
  const x = a.normalizeItem({ title: 'T', link: 'https://x.com', description: 'D' }, 'gh');
  assert.equal(x.source, 'gh');
  assert.equal(x.title, 'T');
});
test('unknown adapter throws', () => assert.throws(() => a.buildUrl('nope'), /unknown adapter/));
