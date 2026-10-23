const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../extension/core.js');
const config = require('../extension/config.js');
const { amount, callAmount, wagerAmount, snapshot, observeTable, setBetValue, stackAmount, callCost, betAmount, readBlinds } = require('../extension/adapter.js');

function fixture({ callText = 'Call 20', canCheck = false, villainStack = 500, heroStack = 1000,
  playerName = 'Local player', playerPath = '/players/local-user', pot = 40, blinds = ['10', '20'],
  heroBetText = 'check', villainBetText = 'Bet 20', villainFolded = false, ante = null } = {}) {
  const text = textContent => ({ textContent });
  const chips = n => ({ querySelector: () => text(String(n)) });
  const cards = values => ({ classList: { contains: () => false }, querySelectorAll: () =>
    values.map(([rank, suit]) => ({ querySelector: sel => text(sel === '.value' ? rank : suit) })) });
  const empty = cards([]);
  const heroCards = cards([['A', 's'], ['K', 'd']]);
  const opponentCards = cards([['', ''], ['', '']]);
  const wager = textContent => ({ textContent, querySelector: () => null });
  const heroFields = {
    '.table-player-name': text(playerName), '.table-player-cards': heroCards,
    '.table-player-stack': chips(heroStack), '.table-player-bet-value': wager(heroBetText),
    '.table-player-name a': { getAttribute: () => playerPath }
  };
  const hero = { className: 'table-player table-player-1 you-player decision-current', classList: { contains: c => c === 'decision-current' }, querySelector: s => heroFields[s] || null };
  const opponent = { className: 'table-player table-player-2', classList: { contains: c => c === 'fold' && villainFolded },
    querySelector: s => s === '.table-player-cards' ? opponentCards :
    s === '.table-player-bet-value' ? wager(villainBetText) : s === '.table-player-stack' ? chips(villainStack) :
    s === '.table-player-name a' ? { getAttribute: () => '/players/villain' } : null };
  const call = { textContent: callText, querySelector: () => null, getClientRects: () => [{}],
    closest: () => null, getAttribute: () => null, disabled: false };
  const doc = {
    querySelector: s => ({ '.table-player.you-player': hero, '.current-type': text('NLH'),
      '.table-cards': empty, '.table-pot-size .main-value': chips(pot),
      '.blind-value.ante .normal-value': ante === null ? null : text(ante),
      '.dealer-button-ctn': { className: 'dealer-button-ctn dealer-position-1' } }[s] || null),
    querySelectorAll: s => ({ '.table-cards': [empty], '.table-player:not(.table-player-seat)': [hero, opponent],
      '.blind-value:not(.ante) .normal-value': blinds.map(text), 'button.call': [call],
      'button.check': canCheck ? [{ ...call, textContent: 'Check' }] : [] }[s] || [])
  };
  return doc;
}
test('a checked hero facing Bet 20 has pot 60 and call cost 20', () => {
  const state = snapshot(fixture());
  assert.equal(state.ready, true);
  assert.equal(state.pot, 60);
  assert.equal(state.ownBet, 0);
  assert.equal(state.call, 20);
  assert.equal(state.opponents, 1);
  assert.deepEqual(state.hole, ['As', 'Kd']);
});
test('quick Bet 20 with class call is not a call and preserves the free check', () => {
  const state = snapshot(fixture({ callText: 'Bet 20', canCheck: true }));
  assert.equal(state.ready, true);
  assert.equal(state.call, 0);
  assert.equal(state.buttons.call, null);
  assert.equal(state.canCheck, true);
});
test('an all-in call remains a call, while a quick raise label is ignored', () => {
  assert.equal(snapshot(fixture({ callText: 'Call All In 9010' })).call, 9010);
  assert.equal(snapshot(fixture({ callText: 'Raise 20', canCheck: true })).call, 0);
});
test('table observation supplies seats, dealer, stacks and public betting without opponent card values', () => {
  const c = observeTable(fixture());
  assert.equal(c.dealer, 1); assert.equal(c.bigBlind, 20); assert.equal(c.pot, 60);
  assert.deepEqual(c.players.map(p => p.seat), [1, 2]);
  assert.equal(c.players[0].hero, true); assert.equal(c.players[0].hint, 'check');
  assert.equal(c.players[1].active, true); assert.equal(c.players[1].stack, 500); assert.equal(c.players[1].bet, 20);
  assert.equal(c.players[1].hole, undefined);
});
test('custom sizing uses the native value setter and dispatches input/change', () => {
  class Input { set value(v) { this.nativeValue = v; } }
  class Event { constructor(type) { this.type = type; } }
  const input = new Input(), events = [];
  input.ownerDocument = { defaultView: { HTMLInputElement: Input, Event } };
  input.dispatchEvent = e => events.push(e.type);
  setBetValue(input, 80);
  assert.equal(input.nativeValue, '80'); assert.deepEqual(events, ['input', 'change']);
});
test('All In is zero remaining stack, not an unknown chip amount or zero wager', () => {
  assert.equal(stackAmount({ textContent: 'All In', querySelector: () => null }), 0);
  assert.equal(stackAmount({ querySelector: () => ({ textContent: 'All In' }) }), 0);
  assert.equal(observeTable(fixture({ villainStack: 'All In' })).players[1].stack, 0);
  assert.throws(() => betAmount({ textContent: 'All In', querySelector: () => null }), /Не видна сумма/);
  assert.equal(snapshot(fixture({ heroStack: 'All In' })).ready, false);
});
test('an all-in call without digits derives its cost from committed chips and hero stack', () => {
  const button = { textContent: 'Call All In', querySelector: () => null };
  assert.equal(callCost(button, 100, 20, 500), 100);
  assert.equal(callCost(button, 1000, 20, 500), 480);
  assert.throws(() => callCost(button, 1000, 20, 20), /Не видна сумма/);
  assert.equal(snapshot(fixture({ callText: 'Call All In' })).call, 20);
});
test('any seated local account and nickname work; an identity change invalidates old decisions', () => {
  const a = snapshot(fixture({ playerName: 'Player A' }));
  const b = snapshot(fixture({ playerName: 'Player B', playerPath: '/players/another-user' }));
  assert.equal(a.ready, true); assert.equal(b.ready, true);
  assert.notEqual(a.key, b.key);
});
test('tournament ante 20 is not mistaken for the big blind 200', () => {
  const doc = { querySelectorAll: selector => (selector === '.blind-value:not(.ante) .normal-value' ? [100, 200] : [100, 200, 20])
    .map(n => ({ textContent: String(n) })) };
  assert.deepEqual(readBlinds(doc), { smallBlind: 100, bigBlind: 200 });
});

test('BB amounts convert to chips using the current blind and preserve chip amounts', () => {
  assert.equal(amount('0.5BB', 2000), 1000);
  assert.equal(amount(' 12.5 bb ', 2000), 25000);
  assert.equal(amount('1,000', 2000), 1000);
  assert.equal(callAmount('Call All In 1.5BB', 2000), 3000);
  assert.equal(wagerAmount('Raise to 2.5BB', 2000), 5000);
  assert.equal(amount('0.5BB', 3000), 1500);
  assert.equal(stackAmount({ textContent: 'All In', querySelector: () => null }, 2000), 0);
});

test('BB amounts fail closed when no chip blind is known or the value is invalid', () => {
  for (const blind of [undefined, 0, -1, Infinity, NaN]) {
    assert.throws(() => amount('0.5BB', blind), /блайнд в фишках/);
  }
  for (const value of ['0.5BBfoo', '-2BB', '1.2.3BB', 'Infinity', '']) {
    assert.throws(() => amount(value, 2000));
  }
  const doc = { querySelectorAll: () => ['0.5BB', '1BB'].map(textContent => ({ textContent })) };
  assert.throws(() => readBlinds(doc), /Переключи отображение/);
});

test('snapshot and history agree in chip units for mixed BB and chip displays', () => {
  const doc = fixture({ blinds: ['1000', '2000'], heroStack: '50BB', villainStack: 50000,
    heroBetText: '0.5BB', villainBetText: 'Bet 4000', pot: '3BB', callText: 'Call 1.5BB' });
  const state = snapshot(doc), history = observeTable(doc);
  assert.equal(state.ready, true);
  assert.equal(state.bigBlind, 2000);
  assert.equal(state.stack, 100000);
  assert.equal(state.ownBet, 1000);
  assert.equal(state.call, 3000);
  assert.equal(state.pot, 11000);
  assert.equal(history.pot, state.pot);
  assert.deepEqual(history.players.map(p => p.stack), [100000, 50000]);
  assert.deepEqual(history.players.map(p => p.bet), [1000, 4000]);
  const button = { textContent: 'Call', querySelector: () => ({ textContent: '0.5BB' }) };
  assert.equal(callCost(button, 10000, 0, 1000, 2000), 1000);
});

test('a folded opponent with lingering card DOM is excluded from active opponents', () => {
  const doc = fixture({ villainFolded: true });
  assert.equal(snapshot(doc).ready, false);
  assert.match(snapshot(doc).message, /Нет активных/);
  assert.equal(observeTable(doc).players[1].active, false);
});

test('observations report small blind and per-player ante in chip units', () => {
  const c = observeTable(fixture({ blinds: ['100', '200'], ante: '0.1BB' }));
  assert.equal(c.smallBlind, 100);
  assert.equal(c.bigBlind, 200);
  assert.equal(c.ante, 20);
  assert.equal(observeTable(fixture()).ante, 0);
});

test('a changed opponent stack invalidates the decision even when pot and hero chips agree', () => {
  const a = snapshot(fixture({ villainStack: 500 }));
  const b = snapshot(fixture({ villainStack: 600 }));
  assert.equal(a.pot, b.pot);
  assert.equal(a.stack, b.stack);
  assert.notEqual(a.tableKey, b.tableKey);
  assert.notEqual(a.key, b.key);
});
