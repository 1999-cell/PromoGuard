'use strict';
// Global discovery adapters: each returns { title, link, description, published, source }.
const adapters = {
  githubReleases: (repo) => `https://github.com/${repo}/releases.atom`,
  googleNews: (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}`,
};
function normalizeItem(raw, source) {
  return {
    title: String(raw.title || '').slice(0, 200),
    link: raw.link || raw.url || '',
    description: String(raw.description || '').slice(0, 500),
    published: raw.published || null,
    source
  };
}
function listAdapters() { return Object.keys(adapters); }
function buildUrl(name, ...args) {
  const fn = adapters[name]; if (!fn) throw new Error('unknown adapter: ' + name);
  return fn(...args);
}
module.exports = { adapters, normalizeItem, listAdapters, buildUrl };
