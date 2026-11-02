'use strict';
const fs = require('fs');
// TON Connect session data (the app's bridge session key) is encrypted with the OS-backed cipher, never stored in SQLite.
// If encryption is unavailable it stays in memory only; it is never written in plaintext.
function createSecureStorage(file, cipher) {
  let map = null;
  let loading = null;
  const load = async () => {
    if (map) return map;
    if (loading) return loading;
    loading = (async () => {
      let loaded = {};
      if (await cipher.available() && fs.existsSync(file)) {
        try { loaded = JSON.parse(await cipher.decrypt(fs.readFileSync(file))); }
        catch { throw new Error('saved encrypted wallet data could not be read; erase local wallet data to reconnect'); }
        if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) throw new Error('saved encrypted wallet data is invalid; erase local wallet data to reconnect');
      }
      map = loaded;
      return map;
    })();
    try { return await loading; } finally { loading = null; }
  };
  const save = async () => { if (await cipher.available()) fs.writeFileSync(file, await cipher.encrypt(JSON.stringify(map))); };
  return { persistent: async () => cipher.available(), async keys() { return Object.keys(await load()); },
    async setItem(k, v) { (await load())[k] = v; await save(); }, async getItem(k) { const values = await load(); return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : null; },
    async removeItem(k) { delete (await load())[k]; await save(); },
    async getKeys() { return Object.keys(await load()); }, async getEntries() { return Object.entries(await load()); }, clear() { map = {}; fs.rmSync(file, { force: true }); } };
}
module.exports = { createSecureStorage };
