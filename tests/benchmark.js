const strategy = require('../extension/strategy.js');
const rows = [];
for (const opponents of [1, 3, 8]) {
  const state = { hole: ['Ac', 'Kd'], board: ['Qh', 'Js', '2c', '7d'], opponents, bigBlind: 20,
    stack: 2000, ownBet: 0, pot: 400, call: 100, canCheck: false, canRaise: true, key: 'benchmark:' + opponents };
  const info = { position: 'BTN', inPosition: true, players: opponents + 1,
    villains: Array.from({ length: opponents }, (_, i) => ({ id: String(i), position: 'BB', events: [
      { kind: 'call', board: [], level: 1 }, { kind: 'check', board: ['Qh', 'Js', '2c'] },
      { kind: 'call', board: ['Qh', 'Js', '2c', '7d'] }
    ] })), incomplete: false, preflopRaises: 1, heroRaises: 0, limpers: 0,
    effectiveStack: 2000, callablePot: 400, revision: 1 };
  const started = performance.now();
  const result = strategy.analyze(state, { info: () => info });
  rows.push({ opponents, milliseconds: Math.round(performance.now() - started), samples: result.samples,
    equity: Number(result.equity.toFixed(3)), action: result.action });
}
console.log(JSON.stringify(rows, null, 2));
