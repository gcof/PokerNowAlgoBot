const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTableLease } = require('../extension/safety.js');
function lockManager() {
  const held = new Set();
  return { async request(name, options, callback) {
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name }); } finally { held.delete(name); }
  } };
}
test('only one controller holds a table lease and release permits another tab', async () => {
  const locks = lockManager(), a = createTableLease(locks, 'table'), b = createTableLease(locks, 'table');
  assert.equal(await a.acquire(), true); assert.equal(await b.acquire(), false);
  a.release(); await Promise.resolve(); await Promise.resolve();
  assert.equal(await b.acquire(), true); b.release();
});
test('different tables can run independently and unavailable Web Locks deny automation', async () => {
  const locks = lockManager(), a = createTableLease(locks, 'first'), b = createTableLease(locks, 'second');
  assert.equal(await a.acquire(), true); assert.equal(await b.acquire(), true);
  a.release(); b.release(); assert.equal(await createTableLease(null, 'table').acquire(), false);
});
test('a pending lease is cancelled if Stop occurs before grant', async () => {
  let grant;
  const lease = createTableLease({ request: (n, opts, cb) => new Promise(resolve => { grant = () => resolve(cb({ name: n })); }) }, 'table');
  const pending = lease.acquire(); lease.release(); grant(); assert.equal(await pending, false);
});
