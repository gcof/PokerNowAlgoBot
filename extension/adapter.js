(function (root) {
  'use strict';
  function amount(text, bigBlind) {
    const s = String(text ?? '').trim().replace(/[\s,\u00a0]/g, '');
    const match = /^(\d+(?:\.\d+)?)(BB)?$/i.exec(s);
    if (!match) throw new Error('Неизвестный формат фишек: ' + text);
    if (match[2] && !(Number.isFinite(bigBlind) && bigBlind > 0)) {
      throw new Error('Для суммы в BB нужен большой блайнд в фишках. Переключи отображение сумм на фишки');
    }
    const value = Number(match[1]) * (match[2] ? bigBlind : 1);
    if (!Number.isFinite(value)) throw new Error('Некорректная сумма фишек: ' + text);
    return value;
  }
  function callAmount(text, bigBlind) {
    return amount(String(text).trim().replace(/^Call\s*/i, '').replace(/^All\s*In\s*/i, ''), bigBlind);
  }
  function wagerAmount(text, bigBlind) {
    const label = String(text ?? '').trim()
      .replace(/^(?:bet|call|raise(?:\s+to)?)\s*/i, '')
      .replace(/^all[\s-]*in\s*/i, '');
    return amount(label, bigBlind);
  }
  const allInOnly = text => /^all[\s-]*in$/i.test(String(text ?? '').trim());
  function stackAmount(element, bigBlind) {
    const value = element?.querySelector('.normal-value')?.textContent ?? element?.textContent;
    return allInOnly(value) ? 0 : amount(value, bigBlind);
  }
  function callCost(button, stack, ownBet, largestBet, bigBlind) {
    const value = button.querySelector('.normal-value')?.textContent;
    const label = button.textContent.trim();
    if (allInOnly(value) || /^Call\s+All[\s-]*In$/i.test(label)) {
      const cost = Math.min(stack, Math.max(0, largestBet - ownBet));
      if (!(cost > 0)) throw new Error('Не видна сумма для колла All In');
      return cost;
    }
    return value ? amount(value, bigBlind) : callAmount(label, bigBlind);
  }
  function betAmount(element, bigBlind) {
    if (!element) return 0;
    const value = element.querySelector('.normal-value');
    if (value) return wagerAmount(value.textContent, bigBlind);
    const label = element.textContent.trim();
    if (!label || /^(check|fold)$/i.test(label)) return 0;
    if (allInOnly(label)) throw new Error('Не видна сумма вложенной ставки All In');
    return wagerAmount(label, bigBlind);
  }
  const visible = e => !!e && e.getClientRects().length > 0 && !e.closest('.hidden');
  const enabled = e => visible(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true';
  const isHeroTurn = (doc = document) => !!doc.querySelector('.table-player.you-player.decision-current');
  const numeric = (e, bigBlind) => amount(e?.querySelector('.normal-value')?.textContent ?? e?.textContent, bigBlind);
  function readBlinds(doc = document) {
    const values = [...doc.querySelectorAll('.blind-value:not(.ante) .normal-value')].map(e => amount(e.textContent));
    if (values.length < 2 || values[1] <= 0) throw new Error('Не удалось прочитать малый и большой блайнды');
    return { smallBlind: values[0], bigBlind: values[1] };
  }
  function readCards(parent) {
    return [...(parent?.querySelectorAll('.card-container') || [])].map(e => {
      const rank = e.querySelector('.value')?.textContent.trim();
      const suit = e.querySelector('.suit')?.textContent.trim();
      if (!rank || !suit) return null;
      const code = rank.replace('10', 'T') + suit;
      root.PokerNowAlgoBotCore.card(code);
      return code;
    }).filter(Boolean);
  }
  function roundKey(doc = document) {
    const hole = readCards(doc.querySelector('.you-player .table-player-cards'));
    const board = readCards(doc.querySelector('.table-cards'));
    if (hole.length !== 2 || ![0, 3, 4, 5].includes(board.length)) return null;
    if (new Set([...hole, ...board]).size !== hole.length + board.length) return null;
    return JSON.stringify({ hole, board });
  }
  function observeTable(doc = document) {
    const hero = doc.querySelector('.table-player.you-player');
    if (!hero) return null;
    const hole = readCards(hero.querySelector('.table-player-cards'));
    const board = readCards(doc.querySelector('.table-cards'));
    if (hole.length !== 2 || ![0, 3, 4, 5].includes(board.length)) return null;
    const { smallBlind, bigBlind } = readBlinds(doc);
    const anteNode = doc.querySelector('.blind-value.ante .normal-value');
    const ante = anteNode ? amount(anteNode.textContent, bigBlind) : 0;
    const dealerClass = doc.querySelector('.dealer-button-ctn')?.className || '';
    const dealer = Number(/dealer-position-(\d+)/.exec(dealerClass)?.[1]);
    const players = [...doc.querySelectorAll('.table-player:not(.table-player-seat)')].map(p => {
      const seat = Number(/\btable-player-(\d+)\b/.exec(p.className)?.[1]);
      const cards = p.querySelector('.table-player-cards');
      const inHand = cards?.querySelectorAll('.card-container').length === 2;
      const active = inHand && !cards.classList.contains('hide-cards') && !p.classList.contains('fold');
      const betNode = p.querySelector('.table-player-bet-value');
      return { id: p.querySelector('.table-player-name a')?.getAttribute('href') || String(seat), seat,
        hero: p === hero, active: !!active, inHand: !!inHand, stack: stackAmount(p.querySelector('.table-player-stack'), bigBlind),
        bet: betAmount(betNode, bigBlind), hint: /^check$/i.test(betNode?.textContent.trim() || '') ? 'check' : '',
        current: p.classList.contains('decision-current') };
    });
    if (!Number.isFinite(dealer) || !Number.isFinite(bigBlind) || players.some(p => !Number.isFinite(p.seat))) return null;
    const pot = numeric(doc.querySelector('.table-pot-size .main-value'), bigBlind) + players.reduce((n, p) => n + p.bet, 0);
    return { hole, board, players, dealer, smallBlind, bigBlind, ante, pot };
  }
  function setBetValue(input, value) {
    const win = input.ownerDocument.defaultView;
    const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(value));
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
  }
  function snapshot(doc = document) {
    const hero = doc.querySelector('.table-player.you-player');
    if (!hero) return { ready: false, message: 'Нужно занять место за столом' };
    const name = hero.querySelector('.table-player-name')?.textContent.trim();
    // PokerNow marks the current user's seat with .you-player, independent of nick/ID.
    const heroId = hero.querySelector('.table-player-name a')?.getAttribute('href') || hero.className;
    const type = doc.querySelector('.current-type')?.textContent.trim();
    if (type !== 'NLH') return { ready: false, message: 'Поддерживается только NLH' };
    if (!hero.classList.contains('decision-current')) return { ready: false, message: 'Ожидание твоего хода' };
    const hole = readCards(hero.querySelector('.table-player-cards'));
    const boards = [...doc.querySelectorAll('.table-cards')].filter(e => readCards(e).length);
    if (boards.length > 1) throw new Error('Несколько бордов не поддерживаются');
    const board = readCards(doc.querySelector('.table-cards'));
    if (hole.length !== 2 || ![0, 3, 4, 5].includes(board.length)) return { ready: false, message: 'Ожидание карт / завершения анимации' };
    if (new Set([...hole, ...board].map(root.PokerNowAlgoBotCore.card)).size !== hole.length + board.length) throw new Error('Дубли карт в DOM');
    const players = [...doc.querySelectorAll('.table-player:not(.table-player-seat)')];
    const live = players.filter(p => {
      const cards = p.querySelector('.table-player-cards');
      return cards && !p.classList.contains('fold') && !cards.classList.contains('hide-cards') && cards.querySelectorAll('.card-container').length === 2;
    });
    const opponents = live.filter(p => p !== hero).length;
    if (!opponents) return { ready: false, message: 'Нет активных соперников' };
    const buttons = {};
    for (const kind of ['call', 'check', 'fold', 'raise', 'bet']) {
      const found = [...doc.querySelectorAll('button.' + kind)].filter(enabled).filter(e => {
        // PokerNow also assigns class "call" to its quick "Bet 20" button.
        if (kind === 'call') return /^Call(?:\s|$)/i.test(e.textContent.trim());
        return true;
      });
      if (found.length > 1) throw new Error('Неоднозначная кнопка: ' + kind);
      buttons[kind] = found[0] || null;
    }
    const { bigBlind } = readBlinds(doc);
    const stack = stackAmount(hero.querySelector('.table-player-stack'), bigBlind);
    if (stack === 0) return { ready: false, message: 'Стек вложен олл-ин — ожидание раздачи' };
    const settled = numeric(doc.querySelector('.table-pot-size .main-value'), bigBlind);
    const bets = players.map(p => betAmount(p.querySelector('.table-player-bet-value'), bigBlind));
    const pot = settled + bets.reduce((a, b) => a + b, 0);
    const ownBetNode = hero.querySelector('.table-player-bet-value');
    const ownBet = betAmount(ownBetNode, bigBlind);
    const call = buttons.call ? callCost(buttons.call, stack, ownBet, Math.max(0, ...bets), bigBlind) : 0;
    const canCheck = !!buttons.check, canRaise = !!(buttons.raise || buttons.bet);
    const dealer = /dealer-position-(\d+)/.exec(doc.querySelector('.dealer-button-ctn')?.className || '')?.[1];
    const publicPlayers = players.map((p, index) => ({
      id: p.querySelector('.table-player-name a')?.getAttribute('href') || p.className,
      stack: stackAmount(p.querySelector('.table-player-stack'), bigBlind), bet: bets[index], active: live.includes(p)
    }));
    const tableKey = JSON.stringify({ heroId, hole, board, pot, stack, ownBet, opponents, dealer, publicPlayers });
    const key = JSON.stringify({ tableKey, call, canCheck, canRaise });
    return { ready: true, name, heroId, publicPlayers, hole, board, opponents, stack, bigBlind, pot, call, ownBet,
      canCheck, canRaise, buttons, key, tableKey, roundKey: JSON.stringify({ hole, board }),
      dialog: doc.querySelector('input.value') };
  }
  function actionButton(state, action) {
    const e = action === 'raise' ? state.buttons.raise || state.buttons.bet : state.buttons[action];
    if (!enabled(e)) throw new Error('Ход больше недоступен: ' + action);
    return e;
  }
  const api = { amount, callAmount, wagerAmount, stackAmount, callCost, betAmount, readBlinds, readCards, roundKey, observeTable, setBetValue,
    snapshot, actionButton, enabled, isHeroTurn };
  root.PokerNowAlgoBotAdapter = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
