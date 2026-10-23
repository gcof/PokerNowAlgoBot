(function (root) {
  'use strict';
  // A Web Lock is shared between same-origin tabs and released by the browser on close.
  function createTableLease(locks, name) {
    let unlock = null, pending = null, generation = 0;
    async function acquire() {
      if (unlock) return true;
      if (!locks?.request) return false;
      if (pending) return pending;
      const ticket = generation;
      const request = new Promise((resolve, reject) => {
        Promise.resolve(locks.request(name, { ifAvailable: true }, async lock => {
          if (!lock || ticket !== generation) { resolve(false); return; }
          await new Promise(release => { unlock = release; resolve(true); });
        })).catch(reject);
      });
      pending = request;
      try { return await request; } finally { if (pending === request) pending = null; }
    }
    function release() { generation++; pending = null; const callback = unlock; unlock = null; callback?.(); }
    return { acquire, release };
  }
  const api = { createTableLease };
  root.PokerNowAlgoBotSafety = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
