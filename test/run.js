// Runs tests under Electron's Node so native modules (better-sqlite3) match the ABI used by the app.
const { spawnSync } = require('child_process'); const path = require('path');
const files = ['policy', 'discovery', 'discovery-adapters', 'safe-http', 'backup', 'campaign-contract', 'web-bundle', 'web-app', 'db', 'phase2', 'evidence', 'ton', 'evm', 'claim', 'unclaimed', 'scanner', 'ai', 'logging', 'markets', 'terms-fetch'].map(n => path.join(__dirname, n + '.test.js'));const r = spawnSync(require('electron'), ['--test', ...files], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
process.exit(r.status ?? 1);
