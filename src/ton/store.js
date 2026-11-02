'use strict';
const now = () => new Date().toISOString();
function saveConnection(db, { name, address, network }) {
  const prov = name.includes(':') ? name : 'ton:' + name, row = db.prepare('SELECT id FROM wallet_connections WHERE provider=? AND address=? AND network=?').get(prov, address, network);
  if (row) { db.prepare('UPDATE wallet_connections SET last_used=? WHERE id=?').run(now(), row.id); return row.id; }
  return Number(db.prepare('INSERT INTO wallet_connections(provider,address,network,first_connected,last_used) VALUES(?,?,?,?,?)').run(prov, address, network, now(), now()).lastInsertRowid);
}
function saveSnapshot(db, connId, network, balanceNano, tokens, provider) {
  db.prepare('INSERT INTO wallet_snapshots(connection_id,network,native_balance_nano,tokens_json,retrieved,provider,freshness) VALUES(?,?,?,?,?,?,?)').run(connId, network, balanceNano, JSON.stringify(tokens), now(), provider, 'fresh');
}
function saveTransactions(db, address, network, txs, provider) {
  let fresh = 0; const ins = db.prepare(`INSERT OR IGNORE INTO wallet_transactions(address,network,tx_hash,status,provider,ts,direction,amount_nano,counterparty,lt) VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const upd = db.prepare('UPDATE wallet_transactions SET status=? WHERE network=? AND tx_hash=?');
  for (const t of txs) { const r = ins.run(address, network, t.hash, t.status, provider, t.time, 'in', t.amountNano, t.from, t.lt); if (r.changes && t.status === 'confirmed') fresh++; else upd.run(t.status, network, t.hash); }
  return fresh;
}
function latest(db, address, network) {
  const snap = db.prepare(`SELECT s.* FROM wallet_snapshots s JOIN wallet_connections c ON c.id=s.connection_id WHERE c.address=? AND s.network=? ORDER BY s.id DESC LIMIT 1`).get(address, network);
  const txs = db.prepare('SELECT tx_hash,status,ts,amount_nano,counterparty FROM wallet_transactions WHERE address=? AND network=? ORDER BY ts DESC LIMIT 20').all(address, network);
  return { snapshot: snap ? { ...snap, tokens: JSON.parse(snap.tokens_json || '[]') } : null, txs };
}
const previousBalance = (db, address, network) => { const r = db.prepare(`SELECT s.native_balance_nano b FROM wallet_snapshots s JOIN wallet_connections c ON c.id=s.connection_id WHERE c.address=? AND s.network=? ORDER BY s.id DESC LIMIT 1`).get(address, network); return r ? r.b : null; };
const hasPermission = (db, provider, op, scope) => !!db.prepare('SELECT 1 FROM wallet_permissions WHERE provider=? AND operation=? AND scope=? AND revoked IS NULL').get(provider, op, scope);
const grantPermission = (db, provider, op, scope) => { if (!hasPermission(db, provider, op, scope)) db.prepare('INSERT INTO wallet_permissions(provider,operation,scope,approved) VALUES(?,?,?,?)').run(provider, op, scope, now()); };
const revokePermission = (db, provider, op, scope) => db.prepare('UPDATE wallet_permissions SET revoked=? WHERE provider=? AND operation=? AND scope=? AND revoked IS NULL').run(now(), provider, op, scope);
function eraseProviderData(db, connectionPrefix, permissionPrefix, at = now()) {
  const connectionPattern = `${connectionPrefix}%`;
  db.transaction(() => {
    db.prepare(`DELETE FROM wallet_transactions WHERE EXISTS (
      SELECT 1 FROM wallet_connections c
      WHERE c.provider LIKE ? AND c.address=wallet_transactions.address AND c.network=wallet_transactions.network
    )`).run(connectionPattern);
    db.prepare('DELETE FROM wallet_connections WHERE provider LIKE ?').run(connectionPattern);
    db.prepare(`UPDATE wallet_permissions SET revoked=?
      WHERE provider LIKE ? AND operation='read_public_data' AND revoked IS NULL`).run(at, `${permissionPrefix}%`);
  })();
}
module.exports = { previousBalance, saveConnection, saveSnapshot, saveTransactions, latest, hasPermission, grantPermission, revokePermission, eraseProviderData };
