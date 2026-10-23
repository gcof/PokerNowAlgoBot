(function (root) {
  'use strict';
  const core = root.PokerNowAlgoBotCore || (typeof require !== 'undefined' && require('./core.js'));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const sigmoid = v => 1 / (1 + Math.exp(-v));
  const streetName = n => ({ 0: 'префлоп', 3: 'флоп', 4: 'тёрн', 5: 'ривер' }[n]);
  function seedRandom(text) {
    let seed = 2166136261;
    for (const ch of String(text)) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
    return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  }
  // Transparent starting-hand ordering, not solver charts or calibrated win rates.
  function startingScore(a, b) {
    const hi = Math.max(a % 13, b % 13) + 2, lo = Math.min(a % 13, b % 13) + 2;
    if (hi === lo) return 0.54 + hi * 0.035;
    const gap = hi - lo;
    return hi * 0.035 + lo * 0.018 + (Math.floor(a / 13) === Math.floor(b / 13) ? 0.055 : 0) +
      (gap === 1 ? 0.035 : gap === 2 ? 0.015 : gap >= 4 ? -0.04 : 0) + (hi === 14 ? 0.03 : 0);
  }
  const allCombos = [];
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) allCombos.push({ cards: [a, b], score: startingScore(a, b) });
  allCombos.sort((a, b) => b.score - a.score);
  const percentiles = new Map();
  for (let i = 0; i < allCombos.length;) {
    let j = i + 1;
    while (j < allCombos.length && Math.abs(allCombos[j].score - allCombos[i].score) < 1e-10) j++;
    for (let k = i; k < j; k++) {
      allCombos[k].percentile = (i + j) / (2 * allCombos.length);
      percentiles.set(allCombos[k].cards.join(','), allCombos[k].percentile);
    }
    i = j;
  }
  function percentile(hole) { return percentiles.get(hole.map(core.card).sort((a, b) => a - b).join(',')); }
  function position(seats, dealer, seat) {
    const sorted = [...new Set(seats)].sort((a, b) => a - b);
    const d = sorted.indexOf(dealer);
    if (d < 0 || !sorted.includes(seat) || sorted.length < 2) return 'UNKNOWN';
    const order = [...sorted.slice(d + 1), ...sorted.slice(0, d + 1)];
    const i = order.indexOf(seat), n = order.length;
    if (n === 2) return seat === dealer ? 'BTN' : 'BB';
    if (i === 0) return 'SB'; if (i === 1) return 'BB'; if (i === n - 1) return 'BTN';
    if (n >= 4 && i === n - 2) return 'CO';
    if (n >= 5 && i === n - 3) return 'HJ';
    return i <= Math.floor((n - 1) / 2) ? 'EP' : 'MP';
  }
  function openingFraction(pos, players = 6) {
    const base = { EP: 0.15, MP: 0.21, HJ: 0.26, CO: 0.33, BTN: 0.46, SB: 0.37, BB: 0.40, UNKNOWN: 0.17 }[pos] ?? 0.17;
    return players === 2 && pos === 'BTN' ? 0.65 : base;
  }
  function boardTexture(board) {
    const ids = board.map(core.card), counts = [0, 0, 0, 0];
    const ranks = [...new Set(ids.map(c => c % 13 + 2))].sort((a, b) => a - b);
    for (const c of ids) counts[Math.floor(c / 13)]++;
    const connected = ranks.some((r, i) => ranks.slice(i).filter(v => v - r <= 4).length >= 3);
    return { wet: counts.some(n => n >= 2) || connected, monotone: counts.some(n => n >= 3), paired: ranks.length < ids.length };
  }
  function drawStrength(cards, board) {
    if (board.length >= 5 || board.length < 3) return 0;
    const all = [...cards, ...board], counts = [0, 0, 0, 0];
    for (const c of all) counts[Math.floor(c / 13)]++;
    const flush = counts.some((n, suit) => n === 4 && cards.some(c => Math.floor(c / 13) === suit));
    const ranks = new Set(all.map(c => c % 13 + 2)); if (ranks.has(14)) ranks.add(1);
    const missing = new Set(); let made = false;
    for (let high = 5; high <= 14; high++) {
      const run = Array.from({ length: 5 }, (_, i) => high - i), absent = run.filter(r => !ranks.has(r));
      if (!absent.length) made = true;
      if (absent.length === 1 && cards.some(c => run.includes(c % 13 + 2) || (c % 13 === 12 && run.includes(1)))) missing.add(absent[0]);
    }
    return (flush ? 0.65 : 0) + (!made ? missing.size >= 2 ? 0.45 : missing.size === 1 ? 0.20 : 0 : 0);
  }
  function boardQuantiles(combos, board) {
    const ids = board.map(core.card), rows = combos.map(c => ({ key: c.cards.join(','), value: core.evaluate([...c.cards, ...ids]) }));
    rows.sort((a, b) => a.value - b.value);
    const result = new Map();
    for (let i = 0; i < rows.length;) {
      let j = i + 1; while (j < rows.length && rows[j].value === rows[i].value) j++;
      for (let k = i; k < j; k++) result.set(rows[k].key, (i + j) / (2 * rows.length));
      i = j;
    }
    return result;
  }
  function preflopWidth(event, pos, count) {
    if (event.kind === 'raise') {
      const depth = event.depthBB ?? 100;
      const level = event.level || 1;
      let width = level >= 4 ? 0.025 : level === 3 ? 0.045 : level === 2 ? 0.11 : openingFraction(pos, count);
      if (depth > 25) {
        if (event.toBB > 50) width = Math.min(width, 0.025);
        else if (event.toBB > 20) width = Math.min(width, 0.06);
        else if (event.toBB > 8) width = Math.min(width, 0.12);
      }
      if (depth <= 12 && level === 1) width = Math.max(width, 0.22);
      return width;
    }
    if (event.kind === 'call') return event.level >= 3 ? 0.09 : event.level >= 2 ? 0.20 : 0.42;
    return 0.98;
  }
  function postflopLikelihood(combo, event, quantiles) {
    const q = quantiles.get(combo.cards.join(',')) ?? 0.5;
    const draw = drawStrength(combo.cards, event.board.map(core.card));
    if (event.kind === 'check') return 0.35 + 0.55 * (1 - q);
    if (event.kind === 'call') return Math.min(0.99, 0.04 + 0.82 * sigmoid((q - 0.42) / 0.15) + 0.24 * draw);
    const size = clamp(event.ratio ?? 0.5, 0, 2);
    const threshold = 0.65 + 0.09 * size + 0.045 * Math.max(0, (event.level || 1) - 1);
    // Nonzero bluff/trap mass is deliberate: no observed action proves exact cards.
    return Math.min(0.99, 0.025 + 0.94 * sigmoid((q - threshold) / 0.07) + 0.18 * draw);
  }
  function buildRanges(state, info, continuing = false) {
    const known = new Set([...state.hole, ...state.board].map(core.card));
    const combos = allCombos.filter(c => !c.cards.some(card => known.has(card)));
    const cache = new Map();
    function quantiles(board) {
      const key = board.join(''); if (!cache.has(key)) cache.set(key, boardQuantiles(combos, board));
      return cache.get(key);
    }
    return info.villains.map(v => {
      const events = [...v.events];
      if (continuing && v.canContinue !== false) events.push(state.board.length ? { kind: 'call', board: state.board, level: 1 } :
        { kind: 'call', board: [], level: Math.max(2, info.preflopRaises + 1) });
      return combos.map(combo => {
        let weight = 1;
        for (const event of events) {
          if (!event.board.length) {
            const width = preflopWidth(event, v.position, info.players);
            weight *= 0.012 + 0.988 * sigmoid((width - combo.percentile) / 0.03);
          } else weight *= postflopLikelihood(combo, event, quantiles(event.board));
        }
        return { cards: combo.cards, weight: Math.max(1e-12, weight) };
      });
    });
  }
  function createTracker() {
    let hand = null, previous = null, lastRound = null, raises = 0, revision = 0, pending = null;
    const events = new Map();
    function reset() { hand = null; previous = null; lastRound = null; raises = 0; revision = 0; pending = null; events.clear(); }
    function observe(ctx) {
      if (!ctx || ctx.hole.length !== 2 || ![0, 3, 4, 5].includes(ctx.board.length)) return;
      const fingerprint = JSON.stringify(ctx);
      if (pending !== fingerprint) { pending = fingerprint; return; }
      const token = ctx.hole.join('') + ':' + ctx.dealer + ':' + ctx.players.find(p => p.hero)?.id;
      if (!hand || hand.token !== token || (previous && ctx.board.length < previous.board.length)) {
        reset();
        hand = { token, seats: ctx.players.filter(p => p.inHand).map(p => p.seat), dealer: ctx.dealer,
          incomplete: ctx.board.length > 0 || ctx.players.some(p => p.bet > ctx.bigBlind) || ctx.pot > (ctx.smallBlind ?? 0.5 * ctx.bigBlind) + ctx.bigBlind +
            (ctx.ante ?? 0) * ctx.players.filter(p => p.inHand).length + 0.001, preflopRaises: 0 };
      }
      if (ctx.board.length !== lastRound) { raises = 0; lastRound = ctx.board.length; previous = null; }
      const priorMax = previous ? Math.max(ctx.board.length ? 0 : ctx.bigBlind, ...previous.players.map(p => p.bet)) : ctx.board.length ? 0 : ctx.bigBlind;
      const changed = ctx.players.filter(p => {
        const old = previous?.players.find(v => v.id === p.id);
        return p.bet > (old?.bet ?? (ctx.board.length ? 0 : Math.min(p.bet, ctx.bigBlind))) ||
          (p.hint === 'check' && old?.hint !== 'check');
      }).sort((a, b) => a.bet - b.bet);
      if (changed.filter(p => p.bet > priorMax).length > 1) hand.incomplete = true;
      let max = priorMax;
      for (const p of changed) {
        const old = previous?.players.find(v => v.id === p.id);
        let kind = p.bet > max + 0.001 ? 'raise' : p.bet > (old?.bet ?? 0) ? 'call' : 'check';
        if (kind === 'raise') { raises++; if (!ctx.board.length) hand.preflopRaises++; }
        // An initial snapshot of an advanced street cannot reconstruct prior betting.
        const event = { kind, board: ctx.board.slice(), level: raises,
          ratio: Math.max(0, p.bet - (old?.bet ?? 0)) / Math.max(ctx.bigBlind, ctx.pot - Math.max(0, p.bet - (old?.bet ?? 0))),
          toBB: p.bet / ctx.bigBlind, depthBB: (p.stack + p.bet) / ctx.bigBlind };
        if (!events.has(p.id)) events.set(p.id, []);
        events.get(p.id).push(event); revision++;
        max = Math.max(max, p.bet);
      }
      previous = ctx;
    }
    function info(state) {
      const ctx = previous;
      if (!ctx || !hand) return { ...infoWithoutContext(state), revision, stale: true };
      const hero = ctx.players.find(p => p.hero), villains = ctx.players.filter(p => !p.hero && p.active);
      const sameCards = (a, b, ordered = false) => {
        const ids = cards => ordered ? cards.map(core.card) : cards.map(core.card).sort((x, y) => x - y);
        return JSON.stringify(ids(a)) === JSON.stringify(ids(b));
      };
      const sameAmount = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6;
      const samePlayers = !state.publicPlayers || state.publicPlayers.length === ctx.players.length && state.publicPlayers.every(p => {
        const observed = ctx.players.find(v => v.id === p.id);
        return observed && sameAmount(p.stack, observed.stack) && sameAmount(p.bet, observed.bet) && p.active === observed.active;
      });
      if (!hero || villains.length !== state.opponents || !sameCards(ctx.hole, state.hole) ||
          !sameCards(ctx.board, state.board, true) || !sameAmount(ctx.bigBlind, state.bigBlind) ||
          !sameAmount(ctx.pot, state.pot) || !sameAmount(hero.stack, state.stack) ||
          !sameAmount(hero.bet, state.ownBet ?? 0) || !samePlayers || (state.heroId && state.heroId !== hero.id)) {
        return { ...infoWithoutContext(state), revision, stale: true };
      }
      const seats = hand.seats.length >= 2 ? hand.seats : ctx.players.map(p => p.seat);
      const heroPosition = position(seats, hand.dealer, hero.seat);
      const postflopOrder = seats.slice().sort((a, b) => ((a - hand.dealer + 10) % 10 || 10) - ((b - hand.dealer + 10) % 10 || 10));
      const inPosition = villains.every(p => postflopOrder.indexOf(p.seat) < postflopOrder.indexOf(hero.seat));
      return { position: heroPosition, inPosition, players: seats.length,
        villains: villains.map(p => ({ id: p.id, position: position(seats, hand.dealer, p.seat),
          canContinue: p.stack > 0, events: events.get(p.id) || [] })),
        incomplete: hand.incomplete, preflopRaises: hand.preflopRaises,
        heroRaises: (events.get(hero.id) || []).filter(e => e.board.length === state.board.length && e.kind === 'raise').length,
        limpers: ctx.board.length ? 0 : ctx.players.filter(p => !p.hero && p.bet === ctx.bigBlind && position(seats, hand.dealer, p.seat) !== 'BB').length,
        effectiveStack: Math.max(0, Math.min(state.stack, Math.max(...villains.map(p => p.stack + p.bet - hero.bet)))),
        callablePot: Math.max(0, state.pot - ctx.players.filter(p => !p.hero).reduce((sum, p) => sum + Math.max(0, p.bet - hero.bet - state.stack), 0)),
        revision };
    }
    function infoWithoutContext(state) {
      const pressure = state.call > (state.board.length ? 0 : state.bigBlind);
      return { position: 'UNKNOWN', inPosition: false, players: state.opponents + 1, incomplete: true,
        villains: Array.from({ length: state.opponents }, (_, i) => ({ id: String(i), position: 'UNKNOWN',
          events: i === 0 && pressure ? [{ kind: 'raise', board: state.board, level: 1,
            toBB: ((state.ownBet || 0) + state.call) / state.bigBlind, depthBB: state.stack / state.bigBlind,
            ratio: state.call / Math.max(state.bigBlind, state.pot - state.call) }] : [] })),
        preflopRaises: state.call > state.bigBlind ? 1 : 0, heroRaises: 0, limpers: 0,
        effectiveStack: state.stack, callablePot: state.pot };
    }
    return { observe, info, reset };
  }
  function choose(state, estimate, info, continuing) {
    const eq = estimate.equity, se = estimate.stderr, price = Math.min(state.call, state.stack);
    if (![eq, se, price, state.pot, state.stack, state.bigBlind].every(Number.isFinite) ||
        state.bigBlind <= 0 || state.stack < 0 || state.pot < 0 || price < 0 || eq < 0 || eq > 1 || se < 0 ||
        ![info.callablePot, info.effectiveStack].every(v => Number.isFinite(v) && v >= 0) ||
        (continuing && (!Number.isFinite(continuing.equity) || continuing.equity < 0 || continuing.equity > 1 ||
          !Number.isFinite(continuing.stderr) || continuing.stderr < 0))) throw new Error('Неверные данные стратегии');
    if (!state.canCheck && price === 0) throw new Error('Кнопки хода ещё не готовы');
    const odds = price / Math.max(1, info.callablePot + price);
    const p = percentile(state.hole), texture = boardTexture(state.board), depth = info.effectiveStack / state.bigBlind;
    const fullyRealized = state.board.length === 5 || price >= info.effectiveStack;
    const realization = fullyRealized ? 1 : clamp((info.inPosition ? 0.98 : 0.88) - (state.opponents - 1) * 0.035, 0.72, 1);
    const conservative = Math.max(0, eq - 1.5 * se) * realization;
    const margin = fullyRealized ? 0 : 0.015 + (info.incomplete ? 0.015 : 0);
    const maxTotal = (state.ownBet || 0) + Math.min(state.stack, info.effectiveStack);
    function answer(action, reason, target) {
      return { action, reason, equity: eq, odds, realizedEquity: conservative, position: info.position,
        stderr: se, samples: estimate.samples, exact: estimate.exact, incomplete: info.incomplete,
        continuationEquity: continuing?.equity,
        spr: info.effectiveStack / Math.max(1, state.pot), raiseTo: target ? Math.min(maxTotal, Math.ceil(target)) : undefined };
    }
    const raiseRoom = state.canRaise && info.effectiveStack > price + state.bigBlind;
    if (!state.board.length) {
      const unopened = info.preflopRaises === 0 && state.call <= state.bigBlind;
      const fraction = openingFraction(info.position, info.players);
      if (unopened && raiseRoom && p <= fraction) {
        const target = state.bigBlind * ((info.position === 'SB' ? 3 : 2.5) + info.limpers);
        return answer('raise', 'Открытие из ' + info.position + ': рука входит в позиционный диапазон', depth <= 8 && p < 0.10 ? maxTotal : target);
      }
      const cont = continuing ? continuing.equity - 1.5 * continuing.stderr : conservative;
      if (!unopened && raiseRoom && p < (info.preflopRaises >= 2 ? 0.018 : 0.09) && cont > (info.heroRaises ? 0.82 : 0.63)) {
        const currentBet = (state.ownBet || 0) + state.call;
        return answer('raise', 'Вэлью против диапазона продолжения; учтены предыдущие рейзы', currentBet * (info.inPosition ? 3 : 3.5));
      }
      // Avoid limping weak unopened hands just because they beat a random hand often.
      if (unopened && !state.canCheck && p > fraction && info.position !== 'BB') return answer('fold', 'Рука вне диапазона входа из ' + info.position);
    } else if (raiseRoom && continuing) {
      const value = continuing.equity - 1.5 * continuing.stderr;
      const required = info.heroRaises ? 0.83 : state.opponents > 1 ? 0.68 : price > 0 ? 0.65 : 0.58;
      if (value > required && conservative > odds + margin) {
        const target = price > 0 ? (state.ownBet || 0) + price + 0.75 * (state.pot + price) :
          (state.ownBet || 0) + Math.max(state.bigBlind, state.pot * (state.board.length === 5 ? 0.75 : texture.wet ? 0.66 : 0.40));
        return answer('raise', 'Вэлью против диапазона колла; размер по структуре борда и банку', target);
      }
    }
    if (state.canCheck) return answer('check', 'Бесплатный чек; недостаточно оснований для вэлью-ставки');
    if (conservative >= odds + margin) return answer('call', 'Эквити против диапазонов покрывает цену колла с поправкой на позицию');
    return answer('fold', 'Скорректированное эквити ниже цены продолжения');
  }
  function analyze(state, tracker, options = {}) {
    const info = tracker.info(state), seed = state.key + ':' + info.revision;
    if (info.stale) return { action: 'wait', reason: 'Ожидание актуальной истории стола' };
    const ranges = buildRanges(state, info);
    const estimate = core.rangeEquity(state.hole, state.board, ranges, {
      iterations: options.iterations ?? (state.opponents > 3 ? 1200 : 2600), maxMs: options.maxMs ?? 400, random: seedRandom(seed)
    });
    let continuing = null;
    if (state.canRaise && estimate.equity > 0.48) {
      continuing = core.rangeEquity(state.hole, state.board, buildRanges(state, info, true), {
        iterations: options.iterations ?? 1300, maxMs: options.maxMs ?? 220, random: seedRandom(seed + ':continue')
      });
    }
    return choose(state, estimate, info, continuing);
  }
  const api = { seedRandom, percentile, position, openingFraction, boardTexture, drawStrength,
    createTracker, buildRanges, choose, analyze, streetName };
  root.PokerNowAlgoBotStrategy = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
