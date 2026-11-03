'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

class Element {
  constructor() {
    this.children = [];
    this.listeners = {};
    this.files = [];
    this.value = '';
  }

  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
}

function runApp({ protocol, hostname, isSecureContext, register }) {
  const ids = [
    'bundleFile', 'importStatus', 'offlineStatus', 'summary', 'campaigns',
    'campaignSearch', 'campaignSearchStatus', 'campaignFilter', 'filterStatus',
    'evidence', 'history', 'clearBundle', 'campaignEditor', 'campaignEditorForm',
    'cancelEdit', 'exportBundle', 'draftStatus', 'editorStatus'
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const document = {
    getElementById: id => elements[id],
    createElement: () => new Element()
  };
  const calls = [];
  const window = {
    location: { protocol, hostname },
    isSecureContext,
    navigator: {
      serviceWorker: {
        register(...args) {
          calls.push(args);
          return register();
        }
      }
    },
    PromoGuardBundle: {
      cloneBundle: value => value,
      editedBundle: value => value,
      parseFile: (_file, callback) => callback(null, null)
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8'), { document, window });
  return { elements, calls };
}

function loadWorker({ fetchImpl = async () => ({ ok: true, type: 'basic', clone() { return this; } }) } = {}) {
  const handlers = {};
  const cacheCalls = { added: [], matched: [], put: [] };
  const cachedResponse = { source: 'cache' };
  const cache = {
    async addAll(assets) { cacheCalls.added.push(...assets); },
    async match(request) {
      cacheCalls.matched.push(request.url);
      return request.url.endsWith('/index.html') ? cachedResponse : undefined;
    },
    async put(request, response) { cacheCalls.put.push([request.url, response]); }
  };
  const self = {
    location: { origin: 'https://example.test' },
    registration: { scope: 'https://example.test/preview/' },
    clients: { claim: async () => {} },
    addEventListener: (name, callback) => { handlers[name] = callback; },
    skipWaiting: async () => {}
  };
  const caches = {
    open: async () => cache,
    keys: async () => ['promoguard-offline-old', 'unrelated-cache'],
    delete: async () => true
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, 'web', 'service-worker.js'), 'utf8'),
    { self, caches, fetch: fetchImpl, URL, Promise }
  );
  return { handlers, cacheCalls, cachedResponse };
}

test('offline install support registers only on HTTPS or secure localhost; file import stays available', async () => {
  const fileMode = runApp({ protocol: 'file:', hostname: '', isSecureContext: false, register: () => Promise.resolve() });
  assert.equal(fileMode.calls.length, 0);
  assert.match(fileMode.elements.offlineStatus.textContent, /requires HTTPS or localhost/);

  const insecureHttp = runApp({ protocol: 'http:', hostname: 'promo.example', isSecureContext: false, register: () => Promise.resolve() });
  assert.equal(insecureHttp.calls.length, 0);

  const https = runApp({ protocol: 'https:', hostname: 'promo.example', isSecureContext: true, register: () => Promise.resolve() });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(https.calls.length, 1);
  assert.equal(https.calls[0][0], './service-worker.js');
  assert.equal(https.calls[0][1].scope, './');
  assert.match(https.elements.offlineStatus.textContent, /browser menu to install/);
  assert.match(https.elements.offlineStatus.textContent, /select the exported bundle each time/);

  const localhost = runApp({ protocol: 'http:', hostname: 'localhost', isSecureContext: true, register: () => Promise.resolve() });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(localhost.calls.length, 1);
});

test('service worker caches only the static app shell and only serves same-origin allow-listed GETs', async () => {
  const worker = loadWorker();
  let installWait;
  worker.handlers.install({ waitUntil: promise => { installWait = promise; } });
  await installWait;
  assert.deepEqual(worker.cacheCalls.added, [
    './', './index.html', './style.css', './bundle.js', './app.js',
    './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'
  ]);

  let handled = 0;
  worker.handlers.fetch({
    request: { method: 'GET', url: 'https://outside.test/preview/app.js' },
    respondWith: () => { handled += 1; }
  });
  worker.handlers.fetch({
    request: { method: 'POST', url: 'https://example.test/preview/index.html' },
    respondWith: () => { handled += 1; }
  });
  worker.handlers.fetch({
    request: { method: 'GET', url: 'https://example.test/preview/unlisted.json' },
    respondWith: () => { handled += 1; }
  });
  assert.equal(handled, 0);

  let cachedResult;
  worker.handlers.fetch({
    request: { method: 'GET', url: 'https://example.test/preview/index.html' },
    respondWith: promise => { cachedResult = promise; }
  });
  assert.equal(await cachedResult, worker.cachedResponse);
  assert.deepEqual(worker.cacheCalls.put, []);
});

test('PWA manifest is scoped to the static read-only preview and declares install icons', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'web', 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.start_url, './index.html');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512']);
  for (const icon of manifest.icons) {
    const iconPath = path.join(root, 'web', icon.src);
    assert.equal(fs.existsSync(iconPath), true, `${icon.src} exists`);
  }
});
