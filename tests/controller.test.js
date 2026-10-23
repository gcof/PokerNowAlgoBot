const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const config = require('../extension/config.js');
const source = fs.readFileSync(require.resolve('../extension/bot.js'), 'utf8');

// Run the real controller with a synthetic clock and adapter to test race handling.
function harness({ action = 'call', snapshots, acknowledge = true, turnActive, nextRound, raiseTo, rejectSize = false, delayRandom = 0.5, onDelay,
  table = '/games/test-table', saved = { running: true, dry: false, resume: true } } = {}) {
  let tick, clicks = 0, writes = [], listener, reads = 0, operations = [];
  const nodes = {};
  for (const key of ['#dry', '#resume', '#status', '#log', '#start', '#stop']) {
    nodes[key] = { checked: false, textContent: '', handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; } };
  }
  const host = { style: {}, attachShadow: () => ({ innerHTML: '', querySelector: key => nodes[key] }) };
  const input = { value: '40' };
  const delays = [];
  const settingsKey = 'pokernowAlgoBot:' + table;
  const state = { ready: true, key: 'hand-1', tableKey: 'cards-chips-1', roundKey: 'round-1', hole: ['As', 'Ad'], board: [], opponents: 1,
    canCheck: false, buttons: { call: {} }, stack: 100, ownBet: 0 };
  const context = {
    location: { hostname: 'www.pokernow.com', pathname: table },
    PokerNowAlgoBotConfig: config,
    PokerNowAlgoBotSafety: { createTableLease: () => ({ acquire: async () => true, release() {} }) },
    document: { getElementById: () => null, createElement: () => host,
      querySelectorAll: () => [{ textContent: 'Min Raise', click: () => operations.push('minimum') }],
      querySelector: selector => selector === 'input.value' ? input : selector === 'input.slider-control' ? { max: '100', step: '1' } : {
        click: () => { clicks++; operations.push('submit'); }
      },
      documentElement: { append() {} }, addEventListener: (type, fn) => { if (type === 'keydown') listener = fn; } },
    chrome: { storage: { local: {
      get: async () => saved ? { [settingsKey]: saved } : {},
      set: async value => { writes.push(value); }
    } } },
    PokerNowAlgoBotCore: { equity: () => 0.8, decide: () => ({ action }) },
    PokerNowAlgoBotStrategy: { createTracker: () => ({ observe() {}, reset() {} }),
      analyze: () => ({ action, equity: 0.8, reason: 'Test', samples: 100, raiseTo }) },
    PokerNowAlgoBotAdapter: {
      observeTable: () => null,
      setBetValue: (element, target) => { operations.push('size:' + target); if (!rejectSize) element.value = String(target); },
      enabled: () => true,
      amount: value => Number(value),
      isHeroTurn: () => turnActive ? turnActive() : !(clicks && acknowledge),
      roundKey: () => nextRound ? nextRound() : state.roundKey,
      snapshot: () => {
        reads++;
        if (snapshots) return snapshots(reads, state);
        return clicks && acknowledge ? { ready: false, message: 'Opponent turn' } : state;
      },
      actionButton: () => ({ click: () => {
        operations.push(action === 'raise' ? 'open' : action);
        if (action !== 'raise') clicks++;
      } })
    },
    setInterval: fn => { tick = fn; }, setTimeout: (fn, ms) => { delays.push(ms); onDelay?.(ms, nodes); fn(); }, Date,
    Math: Object.assign(Object.create(Math), { random: () => delayRandom })
  };
  vm.runInNewContext(source, context);
  return { nodes, tick: async () => { await new Promise(resolve => setImmediate(resolve)); return tick(); },
    location: context.location, clicks: () => clicks, writes: () => writes, operations, delays, settingsKey,
    escape: () => listener({ key: 'Escape' }) };
}
test('one click is acknowledged and not replayed', async () => {
  const h = harness(); await Promise.resolve(); await h.tick(); await h.tick();
  assert.equal(h.clicks(), 1);
});
test('unacknowledged action stops instead of clicking again', async () => {
  const h = harness({ acknowledge: false }); await Promise.resolve(); await h.tick(); await h.tick();
  assert.equal(h.clicks(), 1);
  assert.match(h.nodes['#status'].textContent, /Не удалось подтвердить/);
  assert.equal(h.writes().at(-1)[h.settingsKey].running, false);
});
test('changed state before execution cancels the old decision', async () => {
  const h = harness({ snapshots: (n, s) => n < 3 ? s : { ...s, key: 'hand-2' } });
  await Promise.resolve(); await h.tick(); await h.tick(); assert.equal(h.clicks(), 0);
});
test('dry run never clicks', async () => {
  const h = harness(); await Promise.resolve(); h.nodes['#dry'].checked = true;
  await h.tick(); assert.equal(h.clicks(), 0);
});
test('Escape stops future actions and saves the stop', async () => {
  const h = harness(); await Promise.resolve(); h.escape(); await h.tick();
  assert.equal(h.clicks(), 0); assert.equal(h.writes().at(-1)[h.settingsKey].running, false);
});
test('read failure stops and preserves an actionable reason', async () => {
  const h = harness({ snapshots: () => { throw new Error('Broken selector'); } });
  await Promise.resolve(); await h.tick();
  assert.equal(h.clicks(), 0); assert.match(h.nodes['#status'].textContent, /Broken selector/);
});
test('changed pot with the same turn marker is not an acknowledgement', async () => {
  const h = harness({ turnActive: () => true, snapshots: (n, s) => n < 4 ? s : { ...s, key: 'changed-pot' } });
  await Promise.resolve(); await h.tick(); await h.tick(); await h.tick();
  assert.equal(h.clicks(), 1);
  assert.match(h.nodes['#status'].textContent, /Не удалось подтвердить/);
});
test('a fold-only transition does not trigger a decision', async () => {
  const h = harness({ snapshots: (n, s) => ({ ...s, buttons: { fold: {} }, canCheck: false }) });
  await Promise.resolve(); await h.tick(); assert.equal(h.clicks(), 0);
  assert.match(h.nodes['#status'].textContent, /Ожидание кнопок/);
});
test('raise opens the form, selects minimum and submits exactly once', async () => {
  const h = harness({ action: 'raise' }); await Promise.resolve(); await h.tick(); await h.tick();
  assert.equal(h.clicks(), 1); assert.deepEqual(h.operations, ['open', 'minimum', 'submit']);
});
test('a changed hand in the raise form prevents submission', async () => {
  const h = harness({ action: 'raise', snapshots: (n, s) => n < 4 ? s : { ...s, tableKey: 'new-cards' } });
  await Promise.resolve(); await h.tick(); await h.tick();
  assert.equal(h.clicks(), 0); assert.deepEqual(h.operations, ['open']);
});
test('check completing a street is acknowledged even if hero immediately acts again', async () => {
  const h = harness({ action: 'check', turnActive: () => true, nextRound: () => 'round-flop' });
  await Promise.resolve(); await h.tick(); await h.tick();
  assert.equal(h.clicks(), 1);
  assert.equal(h.writes().some(w => w[h.settingsKey].running === false), false);
  assert.doesNotMatch(h.nodes['#status'].textContent, /Стоп/);
});
test('calculated sizing is entered and bounded by the legal minimum and stack', async () => {
  for (const [requested, expected] of [[80, 80], [500, 100], [5, 40]]) {
    const h = harness({ action: 'raise', raiseTo: requested });
    await Promise.resolve(); await h.tick(); await h.tick();
    assert.equal(h.clicks(), 1);
    assert.deepEqual(h.operations, ['open', 'minimum', 'size:' + expected, 'submit']);
  }
});
test('a rejected custom bet size stops before submission', async () => {
  const h = harness({ action: 'raise', raiseTo: 80, rejectSize: true });
  await Promise.resolve(); await h.tick(); await h.tick();
  assert.equal(h.clicks(), 0); assert.match(h.nodes['#status'].textContent, /не принял/);
});
test('every executed decision waits a random 1000–2000 ms', async () => {
  for (const [delayRandom, expected] of [[0, 1000], [0.5, 1500], [0.999999, 2000]]) {
    const h = harness({ delayRandom }); await Promise.resolve(); await h.tick(); await h.tick();
    assert.equal(h.clicks(), 1); assert.equal(h.delays[0], expected);
  }
});
test('Stop during the decision pause cancels the planned click', async () => {
  const h = harness({ onDelay: (ms, nodes) => { if (ms >= 1000) nodes['#stop'].handlers.click(); } });
  await Promise.resolve(); await h.tick(); await h.tick(); assert.equal(h.clicks(), 0);
});
test('Stop followed by Start during a pause invalidates the old decision', async () => {
  const h = harness({ onDelay: (ms, nodes) => {
    if (ms >= 1000) { nodes['#stop'].handlers.click(); nodes['#start'].handlers.click(); }
  } });
  await Promise.resolve(); await h.tick(); await h.tick(); assert.equal(h.clicks(), 0);
});
test('the newly requested table is supported with separate saved settings', async () => {
  const h = harness({ table: '/games/another-table' }); await Promise.resolve(); await h.tick(); await h.tick();
  assert.equal(h.clicks(), 1);
  h.escape(); assert.equal(h.writes().at(-1)[h.settingsKey].running, false);
  assert.ok(h.settingsKey.endsWith('/games/another-table'));
});
test('a newly added table defaults to stopped preview mode', async () => {
  const h = harness({ table: '/games/another-table', saved: null }); await Promise.resolve(); await h.tick(); await h.tick();
  assert.equal(h.clicks(), 0);
});

test('waiting for synchronized history neither clicks nor records a completed decision', async () => {
  const h = harness({ action: 'wait' }); await Promise.resolve();
  await h.tick(); await h.tick(); await h.tick(); await h.tick();
  assert.equal(h.clicks(), 0);
  assert.equal(h.operations.length, 0);
  assert.equal(h.delays.length, 0);
  assert.equal(h.nodes['#log'].textContent, '');
});
test('reload never resumes automation unless explicitly enabled', async () => {
  const h = harness({ saved: { running: true, dry: false, resume: false } });
  await h.tick(); await h.tick(); assert.equal(h.clicks(), 0);
});
test('changing tables during the pause cancels the previous table action', async () => {
  let h;
  h = harness({ onDelay: ms => { if (ms >= 1000) h.location.pathname = '/games/moved'; } });
  await h.tick(); await h.tick(); assert.equal(h.clicks(), 0);
  await h.tick(); assert.equal(h.nodes['#dry'].checked, true);
  assert.equal(h.nodes['#resume'].checked, false);
  assert.match(h.nodes['#status'].textContent, /Готов/);
});
test('Stop while waiting for acknowledgement cancels the monitor without an error', async () => {
  const h = harness({ acknowledge: false, onDelay: (ms, nodes) => { if (ms === 150) nodes['#stop'].handlers.click(); } });
  await h.tick(); await h.tick(); assert.equal(h.clicks(), 1);
  assert.equal(h.nodes['#status'].textContent, 'Остановлен');
});
