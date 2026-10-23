(function (root) {
  'use strict';
  const RANKS = '23456789TJQKA';
  function card(value) {
    const normalized = String(value).trim().replace(/^10/, 'T');
    const match = /^([2-9TJQKA])([cdhs])$/i.exec(normalized);
    if (!match) throw new Error('Неизвестная карта: ' + value);
    return 'cdhs'.indexOf(match[2].toLowerCase()) * 13 + RANKS.indexOf(match[1].toUpperCase());
  }
  function straight(ranks) {
    const set = new Set(ranks);
    if (set.has(14)) set.add(1);
    for (let top = 14; top >= 5; top--) {
      if ([0, 1, 2, 3, 4].every(i => set.has(top - i))) return top;
    }
    return 0;
  }
  function encode(category, values) {
    let result = category;
    for (let i = 0; i < 5; i++) result = result * 15 + (values[i] || 0);
    return result;
  }
  // Evaluates the best five-card hand directly from five to seven cards.
  function evaluate(cards) {
    if (cards.length < 5 || cards.length > 7 || new Set(cards).size !== cards.length ||
        cards.some(c => !Number.isInteger(c) || c < 0 || c > 51)) throw new Error('Неверный набор карт');
    const counts = Array(15).fill(0), suits = [[], [], [], []];
    for (const c of cards) { const r = c % 13 + 2; counts[r]++; suits[Math.floor(c / 13)].push(r); }
    const ranks = Array.from({ length: 13 }, (_, i) => 14 - i).filter(r => counts[r]);
    const groups = ranks.slice().sort((a, b) => counts[b] - counts[a] || b - a);
    const flush = suits.find(s => s.length >= 5)?.sort((a, b) => b - a);
    const sf = flush && straight(flush);
    if (sf) return encode(8, [sf]);
    if (counts[groups[0]] === 4) return encode(7, [groups[0], ranks.find(r => r !== groups[0])]);
    if (counts[groups[0]] === 3 && counts[groups[1]] >= 2) return encode(6, groups.slice(0, 2));
    if (flush) return encode(5, flush.slice(0, 5));
    const run = straight(ranks);
    if (run) return encode(4, [run]);
    if (counts[groups[0]] === 3) return encode(3, [groups[0], ...ranks.filter(r => r !== groups[0]).slice(0, 2)]);
    const pairs = ranks.filter(r => counts[r] === 2);
    if (pairs.length >= 2) return encode(2, [...pairs.slice(0, 2), ranks.find(r => !pairs.slice(0, 2).includes(r))]);
    if (pairs.length) return encode(1, [pairs[0], ...ranks.filter(r => r !== pairs[0]).slice(0, 3)]);
    return encode(0, ranks.slice(0, 5));
  }
  function equity(hole, board, opponents, iterations = 500, random = Math.random) {
    if (hole.length !== 2 || ![0, 3, 4, 5].includes(board.length) ||
        !Number.isInteger(opponents) || opponents < 1 || opponents > 9 || iterations < 1) throw new Error('Неверное состояние раздачи');
    const known = [...hole, ...board].map(card);
    if (new Set(known).size !== known.length) throw new Error('Карты повторяются');
    const available = Array.from({ length: 52 }, (_, i) => i).filter(c => !known.includes(c));
    const drawCount = 5 - board.length + opponents * 2;
    let wins = 0;
    for (let sample = 0; sample < iterations; sample++) {
      const deck = available.slice();
      for (let i = 0; i < drawCount; i++) {
        const j = i + Math.floor(random() * (deck.length - i));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      const fullBoard = [...known.slice(2), ...deck.slice(0, 5 - board.length)];
      const hero = evaluate([...known.slice(0, 2), ...fullBoard]);
      let ties = 1, lost = false, cursor = 5 - board.length;
      for (let p = 0; p < opponents; p++) {
        const villain = evaluate([...fullBoard, deck[cursor++], deck[cursor++]]);
        if (villain > hero) { lost = true; break; }
        if (villain === hero) ties++;
      }
      if (!lost) wins += 1 / ties;
    }
    return wins / iterations;
  }
  function decide(state, eq) {
    const { canCheck, call, pot, stack, bigBlind, opponents, canRaise } = state;
    if (![call, pot, stack, bigBlind, eq].every(Number.isFinite) || call < 0 || pot < 0 ||
        stack < 0 || bigBlind <= 0 || eq < 0 || eq > 1 || opponents < 1) throw new Error('Неверные размеры ставок');
    if (!canCheck && call === 0) throw new Error('Кнопки хода ещё не готовы');
    const price = Math.min(call, stack);
    const odds = price / Math.max(1, pot + price);
    const raiseThreshold = Math.max(0.65, 1 / (opponents + 1) + 0.20);
    // Equity assumes random opponent hands; large bets demand a conservative margin.
    const margin = price > 8 * bigBlind ? 0.14 : 0.08;
    if (canRaise && eq > raiseThreshold && stack > price + 2 * bigBlind) {
      return { action: 'raise', reason: 'Сильная рука', equity: eq };
    }
    if (canCheck) return { action: 'check', reason: 'Бесплатное продолжение', equity: eq };
    if (price > 0 && eq >= odds + margin) return { action: 'call', reason: 'Эквити выше цены колла с запасом', equity: eq };
    return { action: 'fold', reason: 'Недостаточно эквити для колла', equity: eq };
  }
  function rangeEquity(hole, board, ranges, options = {}) {
    const iterations = options.iterations ?? 2200, random = options.random || Math.random;
    const maxMs = options.maxMs ?? 450;
    if (hole.length !== 2 || ![0, 3, 4, 5].includes(board.length) ||
        !Array.isArray(ranges) || ranges.length < 1 || ranges.length > 9 ||
        !Number.isInteger(iterations) || iterations < 50 || !(maxMs > 0)) throw new Error('Неверные параметры диапазонов');
    const known = [...hole, ...board].map(card), knownSet = new Set(known);
    if (knownSet.size !== known.length) throw new Error('Карты повторяются');
    const tables = ranges.map(range => {
      let total = 0;
      const entries = [];
      for (const combo of range) {
        const [a, b] = combo.cards;
        if (![a, b].every(c => Number.isInteger(c) && c >= 0 && c < 52) || a === b ||
            !Number.isFinite(combo.weight) || combo.weight < 0) throw new Error('Неверная комбинация диапазона');
        if (knownSet.has(a) || knownSet.has(b) || combo.weight === 0) continue;
        total += combo.weight;
        entries.push({ cards: combo.cards, cumulative: total, weight: combo.weight });
      }
      if (!(total > 0)) throw new Error('Диапазон не содержит доступных комбинаций');
      return { entries, total };
    });
    if (board.length === 5 && tables.length === 1) {
      const hero = evaluate(known), t = tables[0];
      let sum = 0;
      for (const c of t.entries) {
        const villain = evaluate([...known.slice(2), ...c.cards]);
        sum += c.weight * (hero > villain ? 1 : hero === villain ? 0.5 : 0);
      }
      return { equity: sum / t.total, stderr: 0, samples: t.entries.length, exact: true };
    }
    function draw(t) {
      const target = random() * t.total;
      let lo = 0, hi = t.entries.length - 1;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (t.entries[mid].cumulative > target) hi = mid; else lo = mid + 1; }
      return t.entries[lo].cards;
    }
    const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
    const started = now();
    let sum = 0, sum2 = 0, samples = 0;
    for (let attempt = 0; samples < iterations && attempt < iterations * 100; attempt++) {
      if (attempt % 32 === 0 && now() - started > maxMs) break;
      // Draw independent ranges then reject the WHOLE deal on collisions. Sequentially
      // renormalizing only later players would bias the joint hand distribution.
      const used = new Set(known), hands = [];
      let collision = false;
      for (const t of tables) {
        const pair = draw(t);
        if (used.has(pair[0]) || used.has(pair[1])) { collision = true; break; }
        used.add(pair[0]); used.add(pair[1]); hands.push(pair);
      }
      if (collision) continue;
      const deck = Array.from({ length: 52 }, (_, i) => i).filter(c => !used.has(c));
      const fullBoard = known.slice(2);
      for (let i = 0; i < 5 - board.length; i++) {
        const j = i + Math.floor(random() * (deck.length - i));
        [deck[i], deck[j]] = [deck[j], deck[i]]; fullBoard.push(deck[i]);
      }
      const hero = evaluate([...known.slice(0, 2), ...fullBoard]);
      let lost = false, ties = 1;
      for (const h of hands) {
        const villain = evaluate([...h, ...fullBoard]);
        if (villain > hero) { lost = true; break; }
        if (villain === hero) ties++;
      }
      const value = lost ? 0 : 1 / ties;
      sum += value; sum2 += value * value; samples++;
    }
    if (samples < 50) throw new Error('Недостаточно допустимых симуляций диапазонов');
    const eq = sum / samples;
    return { equity: eq, stderr: Math.sqrt(Math.max(0, sum2 / samples - eq * eq) / samples), samples, exact: false };
  }
  const api = { card, evaluate, equity, decide, rangeEquity };
  root.PokerNowAlgoBotCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
