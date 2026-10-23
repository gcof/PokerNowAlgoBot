const { test } = require('node:test');
const assert = require('node:assert/strict');
const { card, evaluate, equity, decide } = require('../extension/core.js');
const { amount, callAmount, betAmount } = require('../extension/adapter.js');
const hand = s => evaluate(s.split(' ').map(card));
function rng(seed = 1234) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
test('all hand categories sort correctly', () => {
  const hands = ['As Kd 9c 5h 3s', 'As Ad 9c 5h 3s', 'As Ad 9c 9h 3s', 'As Ad Ac 5h 3s',
    'As 2d 3c 4h 5s', 'As Js 9s 5s 3s', 'As Ad Ac 5h 5s', 'As Ad Ac Ah 3s', '9s Ts Js Qs Ks'];
  for (let i = 1; i < hands.length; i++) assert.ok(hand(hands[i]) > hand(hands[i - 1]), hands[i]);
});
test('best of seven: two trips, three pairs, wheel, kickers', () => {
  assert.equal(hand('As Ad Ac Kh Ks Kd 2c'), hand('As Ad Ac Kh Ks'));
  assert.equal(hand('As Ad Kh Ks Qh Qd 2c'), hand('As Ad Kh Ks Qh'));
  assert.equal(hand('As 2d 3c 4h 5s 9s Tc'), hand('As 2d 3c 4h 5s'));
  assert.ok(hand('As Ad Kh Qs 9h 8d 2c') > hand('As Ad Kh Js 9h 8d 2c'));
});
test('royal board splits with all active opponents', () => {
  assert.equal(equity(['2c', '3d'], ['As', 'Ks', 'Qs', 'Js', 'Ts'], 1, 20, rng()), 0.5);
  assert.ok(Math.abs(equity(['2c', '3d'], ['As', 'Ks', 'Qs', 'Js', 'Ts'], 4, 20, rng()) - 0.2) < 1e-9);
});
test('river nuts always win; AA exceeds a weak offsuit hand preflop', () => {
  assert.equal(equity(['As', 'Ks'], ['Qs', 'Js', 'Ts', '2d', '3c'], 3, 40, rng()), 1);
  const aces = equity(['As', 'Ad'], [], 1, 1800, rng());
  const weak = equity(['7s', '2d'], [], 1, 1800, rng());
  assert.ok(aces > 0.78 && aces < 0.91, String(aces));
  assert.ok(weak < 0.43, String(weak));
});
test('malformed/duplicate cards and unsupported street are rejected', () => {
  assert.throws(() => card('1x'));
  assert.throws(() => equity(['As', 'As'], [], 1));
  assert.throws(() => equity(['As', 'Kd'], ['As', '2c', '3d'], 1));
  assert.throws(() => equity(['As', 'Kd'], ['2c'], 1));
  assert.throws(() => evaluate([1, 1, 2, 3, 4]));
});
test('decisions respect free checks, expensive calls, value raises and short stacks', () => {
  const base = { canCheck: false, call: 20, pot: 40, stack: 1000, bigBlind: 20, opponents: 1, canRaise: true };
  assert.equal(decide(base, 0.2).action, 'fold');
  assert.equal(decide(base, 0.55).action, 'call');
  assert.equal(decide(base, 0.9).action, 'raise');
  assert.equal(decide({ ...base, call: 0, canCheck: true }, 0.1).action, 'check');
  assert.equal(decide({ ...base, stack: 10 }, 0.9).action, 'call');
  assert.equal(decide({ ...base, call: 1000, pot: 1000 }, 0.6).action, 'fold');
  assert.throws(() => decide({ ...base, pot: NaN }, 0.6));
  assert.throws(() => decide({ ...base, call: 0, canCheck: false }, 0.9));
});
test('chip parser handles separators but rejects ambiguous abbreviations', () => {
  assert.equal(amount('10,000'), 10000);
  assert.equal(amount('1\u00a0000.5'), 1000.5);
  assert.throws(() => amount('10k'));
  assert.throws(() => amount(''));
});
test('normal and all-in call labels parse the exact cost', () => {
  assert.equal(callAmount('Call 10'), 10);
  assert.equal(callAmount('Call All In 9010'), 9010);
  assert.equal(callAmount('Call All In 9,010'), 9010);
  assert.equal(callAmount('Call All In 1 000.5'), 1000.5);
  assert.throws(() => callAmount('Call All In'));
  assert.throws(() => callAmount('Raise 40'));
});
test('check and fold labels are zero wagers; numeric wagers keep their amount', () => {
  const label = text => ({ textContent: text, querySelector: () => null });
  assert.equal(betAmount(label('check')), 0);
  assert.equal(betAmount(label('Fold')), 0);
  assert.equal(betAmount(null), 0);
  assert.equal(betAmount(label('')), 0);
  assert.equal(betAmount({ textContent: 'Call 20', querySelector: () => ({ textContent: '20' }) }), 20);
  assert.equal(betAmount(label('100')), 100);
  assert.throws(() => betAmount(label('unknown action')));
});
test('wager labels preserve the chip amount instead of treating actions as zero', () => {
  const label = text => ({ textContent: text, querySelector: () => null });
  for (const text of ['Bet 20', 'Call 20', 'Raise 20', 'Raise to 20', 'bet\u00a020', 'Bet All In 20', 'All-in 20']) {
    assert.equal(betAmount(label(text)), 20, text);
  }
  assert.equal(betAmount(label('Raise to 1,000')), 1000);
  assert.equal(betAmount({ textContent: 'Bet 20', querySelector: () => ({ textContent: 'Bet 20' }) }), 20);
  for (const text of ['Bet', 'Raise to', 'Bet -20', 'Bet unknown 20', 'Bet 20 Pot 40', 'Reset 20']) {
    assert.throws(() => betAmount(label(text)), text);
  }
});
