(function () {
  'use strict';
  if (!globalThis.PokerNowAlgoBotConfig.isAllowedGame(location)) return;
  let table = globalThis.PokerNowAlgoBotConfig.tablePath(location);
  let settingsKey = 'pokernowAlgoBot:' + table;
  const createLease = () => globalThis.PokerNowAlgoBotSafety.createTableLease(globalThis.navigator?.locks, 'pokernow-algo-bot:' + table);
  let lease = createLease();
  if (document.getElementById('pokernow-algo-bot')) return;
  const adapter = globalThis.PokerNowAlgoBotAdapter;
  const strategy = globalThis.PokerNowAlgoBotStrategy, tracker = strategy.createTracker();
  const host = document.createElement('div');
  host.id = 'pokernow-algo-bot';
  host.style.cssText = 'position:fixed;right:12px;top:65px;z-index:2147483647';
  const ui = host.attachShadow({ mode: 'open' });
  ui.innerHTML = `<style>
    :host{font:13px/1.4 system-ui;color:#e9f4ef}section{background:#122b24;border:1px solid #668c7d;border-radius:12px;padding:12px;width:270px;box-shadow:0 6px 25px #0008}
    h3{margin:0 0 6px;font-size:15px}p{margin:6px 0}button{font:inherit;border:0;border-radius:6px;padding:7px 10px;background:#b6eccb;color:#122b24;cursor:pointer}button+button{margin-left:6px;background:#e6c8bb}label{display:block;margin:8px 0}pre{white-space:pre-wrap;font:11px/1.4 monospace;max-height:170px;overflow:auto;border-top:1px solid #668c7d;padding-top:6px}.small{font-size:11px;color:#b5c9bf}
    </style><section><h3>PokerNow Algo Bot v${chrome.runtime?.getManifest?.().version || 'development'}</h3><p id="status">Загрузка…</p><button id="start">Запустить</button><button id="stop">Стоп</button><label><input id="dry" type="checkbox" checked> Только расчёт, без ходов</label><label><input id="resume" type="checkbox"> Возобновлять после обновления этого стола</label><p class="small">Пауза 1–2 с · диапазоны и позиция · Esc — стоп</p><pre id="log"></pre></section>`;
  document.documentElement.append(host);
  let running = false, busy = false, lastKey = null, candidateKey = null, stopped = false, runEpoch = 0;
  const rows = [], dry = ui.querySelector('#dry'), resume = ui.querySelector('#resume');
  const status = text => { ui.querySelector('#status').textContent = text; };
  function log(text) {
    rows.unshift(new Date().toLocaleTimeString() + ' ' + text);
    rows.length = Math.min(rows.length, 14);
    ui.querySelector('#log').textContent = rows.join('\n');
  }
  async function save() { await chrome.storage.local.set({ [settingsKey]: { running, dry: dry.checked, resume: resume.checked } }); }
  async function stop(reason = 'Остановлен') {
    runEpoch++; running = false; stopped = true; lease.release(); status(reason); log(reason); await save();
  }
  async function start() {
    lease.release(); const epoch = ++runEpoch;
    tracker.reset(); running = false; stopped = false; lastKey = null; candidateKey = null;
    if (!globalThis.PokerNowAlgoBotConfig.isAllowedGame(location)) { status('Открой стол PokerNow'); return; }
    if (!dry.checked && !await lease.acquire()) {
      if (runEpoch === epoch) status('Автоигра уже запущена в другой вкладке этого стола или Web Locks недоступны');
      return;
    }
    if (runEpoch !== epoch) return;
    running = true; status('Работает'); await save();
  }
  ui.querySelector('#start').addEventListener('click', () => start().catch(e => status(e.message)));
  ui.querySelector('#stop').addEventListener('click', () => stop().catch(e => status(e.message)));
  dry.addEventListener('change', () => { runEpoch++; lastKey = null; lease.release();
    if (running) start().catch(e => status(e.message)); else save().catch(e => status(e.message)); });
  resume.addEventListener('change', () => save().catch(e => status(e.message)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') stop().catch(() => {}); }, true);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function execute(state, decision, epoch) {
    const active = () => running && !dry.checked && runEpoch === epoch &&
      globalThis.PokerNowAlgoBotConfig.isAllowedGame(location) && globalThis.PokerNowAlgoBotConfig.tablePath(location) === table;
    const fresh = adapter.snapshot();
    if (!active() || !fresh.ready || fresh.key !== state.key) return false;
    if (decision.action === 'raise') {
      adapter.actionButton(fresh, 'raise').click();
      // Ask the site for its legal minimum before applying the strategy's sizing.
      await delay(120);
      const after = adapter.snapshot();
      if (!active() || !after.ready || after.tableKey !== state.tableKey) return false;
      const min = [...document.querySelectorAll('button.default-bet-button')].find(e => /^Min (Raise|Bet)$/i.test(e.textContent.trim()) && adapter.enabled(e));
      if (!min) throw new Error('Не найдена кнопка минимальной ставки');
      min.click();
      await delay(80);
      let input = document.querySelector('input.value');
      const minimum = adapter.amount(input?.value);
      if (Number.isFinite(decision.raiseTo)) {
        const slider = document.querySelector('input.slider-control');
        const maximum = Math.min(state.stack + state.ownBet, slider?.max ? adapter.amount(slider.max) : Infinity);
        const step = slider?.step && slider.step !== 'any' ? adapter.amount(slider.step) : 1;
        if (maximum < minimum || step <= 0) throw new Error('Не удалось проверить границы ставки');
        const target = Math.min(maximum, Math.max(minimum, Number((Math.ceil(decision.raiseTo / step) * step).toFixed(8))));
        adapter.setBetValue(input, target);
        await delay(100);
        input = document.querySelector('input.value');
        if (Math.abs(adapter.amount(input?.value) - target) > 1e-7) throw new Error('Сайт не принял рассчитанный размер ставки');
      }
      const latest = adapter.snapshot();
      if (!active() || !latest.ready || latest.tableKey !== state.tableKey) return false;
      const value = adapter.amount(input?.value);
      if (value <= state.ownBet || value > state.stack + state.ownBet) throw new Error('Некорректный размер рейза');
      const submit = document.querySelector('input.bet[type="submit"]');
      if (!adapter.enabled(submit)) throw new Error('Нет подтверждения рейза');
      submit.click();
      log('Рейз до ' + value);
    } else adapter.actionButton(fresh, decision.action).click();
    // Hero can act last on one street and first on the next without an observable
    // departure of his turn marker. New cards also acknowledge the previous action.
    // A changed pot alone remains insufficient because it updates during animations.
    for (let n = 0; n < 40; n++) {
      await delay(150);
      if (!active()) return true;
      tracker.observe(adapter.observeTable());
      if (!adapter.isHeroTurn()) { lastKey = null; return true; }
      const nextRound = adapter.roundKey();
      if (nextRound && nextRound !== state.roundKey) { lastKey = null; candidateKey = null; return true; }
    }
    throw new Error('Не удалось подтвердить ход: очередь и улица не изменились');
  }
  async function tick() {
    const nextTable = globalThis.PokerNowAlgoBotConfig.tablePath(location);
    if (nextTable !== table) {
      await stop('Стол сменился — ожидается запуск на новом столе');
      table = nextTable; settingsKey = 'pokernowAlgoBot:' + table;
      tracker.reset(); lastKey = null; candidateKey = null; lease = createLease();
      dry.checked = true; resume.checked = false;
      if (globalThis.PokerNowAlgoBotConfig.isAllowedGame(location)) await loadSettings();
      return;
    }
    if (!running || busy) return;
    busy = true;
    try {
      if (!globalThis.PokerNowAlgoBotConfig.isAllowedGame(location)) throw new Error('Открой стол PokerNow');
      tracker.observe(adapter.observeTable());
      const s = adapter.snapshot();
      if (!s.ready) { candidateKey = null; status(s.message); return; }
      if (!s.canCheck && !s.buttons.call) {
        if (s.dialog) throw new Error('Закрой открытую вручную форму ставки и перезапусти бота');
        candidateKey = null; status('Ожидание кнопок хода'); return;
      }
      if (s.key === lastKey) return;
      // Require the cards, chips and enabled actions to agree in two observations.
      if (candidateKey !== s.key) { candidateKey = s.key; status('Проверка состояния хода'); return; }
      const epoch = runEpoch;
      const decision = strategy.analyze(s, tracker);
      if (decision.action === 'wait') { candidateKey = null; status(decision.reason); return; }
      const eq = decision.equity;
      if (!running) return;
      status((dry.checked ? 'Расчёт: ' : 'Ход: ') + decision.action + ' · ' + Math.round(eq * 100) + '%');
      log(s.hole.join(' ') + ' / ' + (s.board.join(' ') || 'префлоп') + ' → ' + decision.action + ' (' + Math.round(eq * 100) + '%)');
      log((decision.position || '?') + ' · цена ' + Math.round((decision.odds || 0) * 100) + '% · ' + decision.reason +
        (Number.isFinite(decision.continuationEquity) ? ' · против продолжения ' + Math.round(decision.continuationEquity * 100) + '%' : '') +
        (decision.incomplete ? ' · история неполная' : '') + (decision.exact ? ' · точный перебор ривера' : ' · ' + decision.samples + ' симуляций'));
      lastKey = s.key;
      if (!dry.checked) {
        const pauseMs = 1000 + Math.floor(Math.random() * 1001);
        status('Пауза ' + (pauseMs / 1000).toFixed(2) + ' с → ' + decision.action);
        await delay(pauseMs);
        if (!running || dry.checked || runEpoch !== epoch) return;
        tracker.observe(adapter.observeTable());
        status('Ход: ' + decision.action + ' · ' + Math.round(eq * 100) + '%');
        if (!await execute(s, decision, epoch)) {
          lastKey = null; candidateKey = null;
          if (running && runEpoch === epoch) status('Состояние изменилось — пересчёт');
        }
      }
    } catch (e) { await stop('Стоп: ' + e.message); }
    finally { busy = false; }
  }
  async function loadSettings() {
    const epoch = runEpoch, key = settingsKey;
    const settings = await chrome.storage.local.get(key), saved = settings[key];
    if (runEpoch !== epoch || settingsKey !== key) return;
    dry.checked = saved?.dry !== false;
    resume.checked = saved?.resume === true;
    if (resume.checked && saved?.running === true) await start();
    else status('Готов · нажми Запустить');
  }
  loadSettings().catch(e => status('Ошибка настроек: ' + e.message));
  document.addEventListener('visibilitychange', () => { if (document.hidden) candidateKey = null; });
  setInterval(tick, 400);
})();
