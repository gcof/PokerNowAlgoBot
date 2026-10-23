const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../extension/core.js');
const strategy = require('../extension/strategy.js');
const { seedRandom, createTracker, choose, analyze, buildRanges } = strategy;
const combo = (a, b, weight = 1) => ({ cards: [a, b].map(core.card), weight });
const base = { hole: ['Jh', 'Js'], board: [], opponents: 1, bigBlind: 20, stack: 2000, ownBet: 20,
  pot: 140, call: 40, canCheck: false, canRaise: true, key: 'scenario-1' };
const baseInfo = { position: 'BTN', inPosition: true, players: 2, villains: [{ id: 'v', position: 'BB', events: [] }],
  incomplete: false, preflopRaises: 1, heroRaises: 0, limpers: 0, effectiveStack: 2000, callablePot: 140, revision: 1 };
const estimate = equity => ({ equity, stderr: 0, samples: 2000, exact: false });
function ctx({ board = [], dealer = 1, heroBet = 10, villainBet = 20, hint = '', heroStack, villainStack } = {}) {
  return { hole: ['Jh', 'Js'], board, dealer, bigBlind: 20, pot: 40 + heroBet + villainBet,
    players: [
      { id: 'h', seat: 1, hero: true, active: true, inHand: true, stack: heroStack ?? 2000 - heroBet, bet: heroBet, hint: '' },
      { id: 'v', seat: 2, hero: false, active: true, inHand: true, stack: villainStack ?? 2000 - villainBet, bet: villainBet, hint }
    ] };
}
function observe(t, c) { t.observe(c); t.observe(c); }

function stateFor(c, extra = {}) {
  const hero = c.players.find(p => p.hero);
  return { ...base, hole: c.hole, board: c.board, bigBlind: c.bigBlind, stack: hero.stack,
    ownBet: hero.bet, pot: c.pot, opponents: c.players.filter(p => !p.hero && p.active).length, ...extra };
}


test('weighted river enumeration is exact, including ties and blockers', () => {
  const result = core.rangeEquity(['As', 'Ad'], ['2c', '3d', '5h', '7s', '9c'], [[
    combo('Kh', 'Kd', 3), combo('2h', '2d', 1), combo('As', 'Ac', 500)
  ]]);
  assert.equal(result.exact, true); assert.equal(result.samples, 2); assert.equal(result.equity, 0.75);
  assert.equal(core.rangeEquity(['2h', '3h'], ['As', 'Ks', 'Qs', 'Js', 'Ts'], [[combo('4d', '5d')]]).equity, 0.5);
});
test('Monte Carlo ranges never share cards across opponents or the runout', () => {
  const r = core.rangeEquity(['As', 'Ad'], [], [
    [combo('Kh', 'Kd'), combo('Qh', 'Qd')], [combo('Kh', 'Kd'), combo('Jh', 'Jd')]
  ], { iterations: 2000, maxMs: 5000, random: seedRandom('joint') });
  assert.equal(r.samples, 2000); assert.ok(r.equity > 0.55 && r.equity < 0.8);
  assert.throws(() => core.rangeEquity(['As', 'Ad'], [], [[combo('Kh', 'Kd')], [combo('Kh', 'Kd')]],
    { iterations: 50, maxMs: 5000, random: seedRandom('impossible') }), /Недостаточно/);
});
test('joint rejection sampling preserves weights conditioned on card collisions', () => {
  // Legal deals have weights 3 (AA,JJ), 3 (QQ,AA), 1 (QQ,JJ). Hero wins only the last.
  const r = core.rangeEquity(['Ks', 'Kd'], ['2c', '3d', '5h', '7s', '9c'], [
    [combo('As', 'Ad', 3), combo('Qh', 'Qd')], [combo('As', 'Ad', 3), combo('Jh', 'Jd')]
  ], { iterations: 8000, maxMs: 5000, random: seedRandom('conditional') });
  assert.ok(Math.abs(r.equity - 1 / 7) < 0.02, String(r.equity));
});
test('equity changes with opponent ranges, not just number of opponents', () => {
  const strong = core.rangeEquity(['Jh', 'Js'], [], [[combo('Ah', 'Ad'), combo('Kh', 'Kd'), combo('Qh', 'Qd')]],
    { iterations: 3000, maxMs: 5000, random: seedRandom('strong') });
  const weak = core.rangeEquity(['Jh', 'Js'], [], [[combo('9h', '9d'), combo('Th', 'Td'), combo('8h', '8d')]],
    { iterations: 3000, maxMs: 5000, random: seedRandom('weak') });
  assert.ok(strong.equity < 0.25); assert.ok(weak.equity > 0.72);
});
test('invalid and empty ranges are rejected', () => {
  assert.throws(() => core.rangeEquity(['As', 'As'], [], [[combo('Kh', 'Kd')]]));
  assert.throws(() => core.rangeEquity(['As', 'Ad'], [], [[]]));
  assert.throws(() => core.rangeEquity(['As', 'Ad'], [], [[combo('Kh', 'Kd', -1)]]));
});
test('position ordering handles heads up, gaps and full tables', () => {
  assert.equal(strategy.position([1, 2], 1, 1), 'BTN');
  assert.equal(strategy.position([1, 2], 1, 2), 'BB');
  assert.equal(strategy.position([2, 5, 9], 9, 2), 'SB');
  assert.equal(strategy.position([1, 2, 3, 4, 5, 6], 6, 3), 'EP');
  assert.equal(strategy.position([1, 2, 3, 4, 5, 6], 6, 5), 'CO');
  assert.equal(strategy.position([1, 2], 8, 1), 'UNKNOWN');
});
test('same hand is opened later but folded early; BB keeps a free check', () => {
  const s = { ...base, hole: ['Kh', '9h'], pot: 30, call: 10 };
  const i = { ...baseInfo, preflopRaises: 0, players: 6, callablePot: 30 };
  assert.equal(choose(s, estimate(0.55), { ...i, position: 'EP' }).action, 'fold');
  assert.equal(choose(s, estimate(0.55), { ...i, position: 'BTN' }).action, 'raise');
  assert.equal(choose({ ...s, hole: ['7h', '2d'], canCheck: true, call: 0 }, estimate(0.3), { ...i, position: 'BB' }).action, 'check');
});
test('JJ no longer enters a raise war against a four-bet range', () => {
  const decision = choose({ ...base, pot: 1300, call: 900 }, estimate(0.26),
    { ...baseInfo, preflopRaises: 3, heroRaises: 1, callablePot: 1300 }, estimate(0.22));
  assert.equal(decision.action, 'fold');
  assert.equal(choose(base, estimate(0.76), { ...baseInfo, heroRaises: 1 }, estimate(0.75)).action, 'call');
});
test('river calling uses pot odds without arbitrary margin; a board chop is defended', () => {
  const s = { ...base, board: ['As', 'Ks', 'Qs', 'Ts', '9s'], canRaise: false, pot: 100, call: 50 };
  const i = { ...baseInfo, callablePot: 100 };
  assert.equal(choose(s, estimate(0.34), i).action, 'call');
  assert.equal(choose(s, estimate(0.32), i).action, 'fold');
  assert.equal(choose({ ...s, pot: 1000, call: 900 }, estimate(0.5), { ...i, callablePot: 1000 }).action, 'call');
});
test('marginal draws get a positional discount before calling', () => {
  const s = { ...base, board: ['2c', '9d', 'Th'], canRaise: false, pot: 100, call: 50 };
  const i = { ...baseInfo, callablePot: 100 };
  assert.equal(choose(s, estimate(0.36), { ...i, inPosition: true }).action, 'call');
  assert.equal(choose(s, estimate(0.36), { ...i, inPosition: false }).action, 'fold');
});
test('all-in calls realize their equity fully even out of position', () => {
  const s = { ...base, pot: 200, call: 100, stack: 100, canRaise: false };
  const i = { ...baseInfo, effectiveStack: 100, callablePot: 200, inPosition: false };
  assert.equal(choose(s, estimate(0.34), i).action, 'call');
  assert.equal(choose(s, estimate(0.32), i).action, 'fold');
});
test('value bets need equity against continuing hands and use pot sizing', () => {
  const s = { ...base, board: ['2c', '9d', 'Th'], pot: 200, call: 0, canCheck: true, ownBet: 0 };
  assert.equal(choose(s, estimate(0.76), baseInfo, estimate(0.40)).action, 'check');
  const value = choose(s, estimate(0.90), baseInfo, estimate(0.80));
  assert.equal(value.action, 'raise'); assert.ok(value.raiseTo > 2 * s.bigBlind);
  assert.ok(value.raiseTo <= s.stack);
});
test('range weights tighten after reraises while retaining bluff combinations', () => {
  const info = { ...baseInfo, villains: [{ id: 'v', position: 'BTN', events: [
    { kind: 'raise', board: [], level: 3, toBB: 25, depthBB: 100 }
  ] }] };
  const range = buildRanges({ ...base, hole: ['7h', '2d'] }, info)[0];
  const weight = (a, b) => range.find(c => c.cards.includes(core.card(a)) && c.cards.includes(core.card(b))).weight;
  assert.ok(weight('Ah', 'Ad') > weight('9h', '8d') * 20);
  assert.ok(weight('9h', '8d') > 0);
});
test('tracker does not count blinds as raises or repeated observations as new bets', () => {
  const t = createTracker(); observe(t, { ...ctx(), pot: 30 }); observe(t, { ...ctx(), pot: 30 });
  assert.equal(t.info(stateFor({ ...ctx(), pot: 30 })).preflopRaises, 0);
  observe(t, ctx({ villainBet: 60 }));
  assert.equal(t.info(stateFor(ctx({ villainBet: 60 }))).preflopRaises, 1);
  const revision = t.info(stateFor(ctx({ villainBet: 60 }))).revision;
  observe(t, ctx({ villainBet: 60 })); assert.equal(t.info(stateFor(ctx({ villainBet: 60 }))).revision, revision);
});
test('tracker preserves preflop evidence on later streets and resets for a new hand', () => {
  const t = createTracker(); observe(t, ctx()); observe(t, ctx({ villainBet: 60 }));
  observe(t, ctx({ board: ['2c', '3h', '9s'], heroBet: 0, villainBet: 40 }));
  const i = t.info(stateFor(ctx({ board: ['2c', '3h', '9s'], heroBet: 0, villainBet: 40 })));
  assert.ok(i.villains[0].events.some(e => !e.board.length && e.kind === 'raise'));
  assert.ok(i.villains[0].events.some(e => e.board.length === 3 && e.kind === 'raise'));
  observe(t, { ...ctx({ dealer: 2 }), pot: 30 });
  assert.equal(t.info(stateFor({ ...ctx({ dealer: 2 }), pot: 30 })).preflopRaises, 0);
});
test('tracker marks late attachment and discounts uncallable all-in overage', () => {
  const t = createTracker(); observe(t, ctx({ board: ['2c', '3h', '9s'], heroBet: 0, villainBet: 1000, heroStack: 100 }));
  const i = t.info(stateFor(ctx({ board: ['2c', '3h', '9s'], heroBet: 0, villainBet: 1000, heroStack: 100 })));
  assert.equal(i.incomplete, true); assert.equal(i.callablePot, 140);
});
test('analysis is reproducible and returns an explanation plus uncertainty', () => {
  const tracker = { info: () => baseInfo };
  const a = analyze(base, tracker, { iterations: 800, maxMs: 5000 });
  const b = analyze(base, tracker, { iterations: 800, maxMs: 5000 });
  assert.deepEqual(a, b); assert.ok(a.reason.length > 10); assert.ok(a.samples >= 50); assert.ok(a.stderr > 0);
});
test('changed participant identity or public stack cannot reuse synchronized ranges', () => {
  const t = createTracker(), c = ctx(); observe(t, c);
  const s = { ...base, heroId: 'h', ownBet: 10, stack: 1990, pot: c.pot,
    publicPlayers: c.players.map(p => ({ id: p.id, stack: p.stack, bet: p.bet, active: p.active })) };
  assert.equal(t.info(s).stale, undefined);
  assert.equal(t.info({ ...s, heroId: 'other' }).stale, true);
  assert.equal(t.info({ ...s, publicPlayers: s.publicPlayers.map(p => p.id === 'v' ? { ...p, stack: p.stack + 1 } : p) }).stale, true);
});

test('new hand and unconfirmed street never reuse previous betting history', () => {
  const t = createTracker(), c = ctx({ villainBet: 60 }); observe(t, c);
  const newHand = { ...stateFor(c), hole: ['As', 'Ad'] };
  const info = t.info(newHand);
  assert.equal(info.stale, true); assert.equal(info.position, 'UNKNOWN');
  assert.ok(info.villains.every(v => v.events.every(e => e.board.length === 0)));
  assert.equal(analyze(newHand, t).action, 'wait');
  const next = ctx({ board: ['2c', '3h', '9s'], heroBet: 0, villainBet: 0 });
  t.observe(next);
  assert.equal(analyze(stateFor(next), t).action, 'wait');
  t.observe(next);
  assert.notEqual(t.info(stateFor(next)).stale, true);
  assert.ok(t.info(stateFor(next)).villains[0].events.some(e => e.board.length === 0));
});

test('changed chips or blind wait for matching stable context; card order is immaterial', () => {
  const t = createTracker(), c = ctx(); observe(t, c);
  const s = stateFor(c);
  assert.notEqual(t.info({ ...s, hole: s.hole.slice().reverse() }).stale, true);
  for (const key of ['stack', 'ownBet', 'bigBlind', 'pot']) {
    assert.equal(t.info({ ...s, [key]: s[key] + 1 }).stale, true, key);
  }
});

test('normal antes and unequal blinds do not falsely mark initial history incomplete', () => {
  const t = createTracker();
  const c = { ...ctx({ heroBet: 5, villainBet: 20 }), smallBlind: 5, ante: 2, pot: 29 };
  observe(t, c);
  assert.equal(t.info(stateFor(c)).incomplete, false);
  const late = createTracker(), raised = { ...c, pot: 100 };
  observe(late, raised);
  assert.equal(late.info(stateFor(raised)).incomplete, true);
});

test('all-in opponent keeps the same range when modeling further calls', () => {
  const i = { ...baseInfo, villains: [
    { id: 'allin', position: 'BB', events: [], canContinue: false },
    { id: 'active', position: 'BTN', events: [], canContinue: true }
  ] };
  const before = buildRanges(base, i), after = buildRanges(base, i, true);
  assert.deepEqual(after[0], before[0]);
  assert.notDeepEqual(after[1], before[1]);
  const t = createTracker(), c = ctx({ villainBet: 2000, villainStack: 0 }); observe(t, c);
  assert.equal(t.info(stateFor(c)).villains[0].canContinue, false);
});

test('invalid uncertainty and pot context cannot produce a decision', () => {
  assert.throws(() => choose(base, { ...estimate(0.7), stderr: -1 }, baseInfo));
  assert.throws(() => choose(base, estimate(0.7), { ...baseInfo, callablePot: NaN }));
  assert.throws(() => choose(base, estimate(0.7), baseInfo, estimate(1.1)));
});

test('fractional stack caps are never rounded above available chips', () => {
  const s = { ...base, hole: ['As', 'Ad'], stack: 120.5, ownBet: 0, call: 0, canCheck: true };
  const i = { ...baseInfo, preflopRaises: 0, position: 'BTN', effectiveStack: 120.5 };
  assert.equal(choose(s, estimate(0.9), i).raiseTo, 120.5);
});
