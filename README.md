# PokerNow Algo Bot

[![CI](https://github.com/gcof/PokerNowAlgoBot/actions/workflows/ci.yml/badge.svg)](https://github.com/gcof/PokerNowAlgoBot/actions/workflows/ci.yml)

[Русская инструкция](README.ru.md) · [Releases](https://github.com/gcof/PokerNowAlgoBot/releases) · [Changelog](CHANGELOG.md) · [MIT License](LICENSE)

A dependency-free Manifest V3 extension for **PokerNow No Limit Texas Hold'em**. It estimates equity against heuristic opponent ranges, explains decisions in a local overlay, and can optionally execute them through PokerNow's normal controls.

Supports HTTPS table pages on `pokernow.com` and `www.pokernow.com`. No fixed tables, nicknames, player IDs, API keys or account setup. Your seat is detected from PokerNow's `.you-player` marker. The overlay currently uses Russian labels.

Use only where automation is permitted by the platform and participants. Strategy weights are hand-tuned; profitability and tournament win rate have not been validated.

## Install

1. Download `pokernow-algo-bot-vX.Y.Z.zip` from a published [release](https://github.com/gcof/PokerNowAlgoBot/releases) and extract it.
2. Open `chrome://extensions` or `edge://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the extracted folder containing `manifest.json`.
4. Refresh a PokerNow table and take your seat. The overlay appears at the top right.

For a source checkout, load **`extension/`** instead. Node.js is required only for development/builds. After an upgrade, reload the extension and refresh the table.

## Use

- **Только расчёт, без ходов** = **Preview only**, enabled by default. **Запустить** = **Start**, **Стоп** = **Stop**.
- To execute moves, uncheck Preview and click Start. Every move waits a random 1–2 seconds, then revalidates the table.
- Stop or **Esc** cancels pending moves. Switching modes or tables invalidates old decisions.
- **Возобновлять после обновления этого стола** enables opt-in resume on reload. New tables default to stopped preview mode. Settings are separate per table.
- Keep the browser/computer awake. The extension does not sign in, select seats, buy chips, join tournaments, leave Away mode or reconnect the platform for you.

Full-page tournament transfers inject a new overlay; in-page transfers reset the existing one. A new table requires Start unless resume was already enabled for that table. A Web Lock prevents duplicate automation tabs on the same table/origin. Preview remains available without Web Locks.

## Analysis

- Position, effective stack, pot odds and stable observations of current-hand checks/calls/raises.
- Weighted opponent ranges, card removal and jointly valid multiway samples.
- Usually 2,600 Monte Carlo samples (1,200 with more than three opponents), plus a separate continuation-range estimate for value raises.
- Exact weighted enumeration on the river against one opponent.
- Equity-realization/position discounts and sampling uncertainty; no positional discount on fully realized all-in calls.
- Positional openings, stricter repeated-raise thresholds and pot/board-based bet sizes.
- Legal minimum, maximum, slider step and accepted input value are verified before submitting a raise.

The PokerNow adapter supports antes, folded players, all-in labels, mixed chip/BB displays and the quick-bet button that reuses the `call` CSS class. BB conversion needs a readable **chip-denominated big blind** in the header.

## Limits

Ranges, opening frequencies and action likelihoods are heuristics. Monte Carlo error does not measure errors in the opponent model. River enumeration is exact for the supplied range, not the opponent's unknown strategy.

Rapid actions between DOM observations may be missed. Incomplete history is marked; mismatched history waits for synchronization. There is no cross-hand learned player profile, ICM/payout model, full historical side-pot reconstruction, balanced bluffing strategy, Omaha or multiple-board support. Uncallable current-bet excess is excluded, but complex side pots remain a limitation. PokerNow UI changes may require adapter updates.

## Privacy and permissions

Only `storage` permission is requested. Content scripts run only on PokerNow `/games/*` HTTPS pages. No backend, telemetry, dependencies, hidden game APIs or external executable code. Reads your visible cards and the public board, never opponents' hidden cards. Public participant IDs are used transiently to distinguish players, with no account embedded in the source. Per-table preferences stay in `chrome.storage.local`; the short log/hand history stay in memory.

Personal screenshots, logs and build output are excluded from Git and the release ZIP. Sanitize invitation URLs, nicknames and IDs before submitting issues.

## Development

Use **Node.js 24+**; CI targets Node 24 on Windows/Linux. There are no packages to install.

```sh
npm run check
npm test
npm run build
npm run benchmark
```

Without npm:

```sh
node scripts/check.js
node --test --test-isolation=none tests/*.test.js
node scripts/build.js
node tests/benchmark.js
```

| Path | Purpose |
| --- | --- |
| `extension/config.js` | PokerNow URL scope |
| `extension/core.js` | Hand evaluator and weighted equity |
| `extension/strategy.js` | Tracker, ranges, decisions and sizing |
| `extension/adapter.js` | PokerNow DOM parsing and validation |
| `extension/safety.js` | Cross-tab automation lease |
| `extension/bot.js` | Overlay, lifecycle, cancellation and execution |
| `tests/` | Synthetic regressions without private game data |
| `scripts/` | Portability/syntax checks and ZIP build |

Tests exercise representative decisions, weighted sampling, synchronization, cancellation, transfers and bet inputs; they do not demonstrate positive win rate. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Releases

`node scripts/build.js` produces the installable ZIP and `SHA256SUMS` in `dist/`. An explicit runtime allowlist excludes personal artifacts. Fixed ZIP timestamps give byte-identical repeated builds for a given source and Node/zlib runtime.

Version tags `vX.Y.Z` must match both package and manifest versions. Pushing a tag runs checks/tests/builds and creates a **draft GitHub release** with the ZIP/checksum. A maintainer reviews and publishes it. The `0.x` series is experimental.

Independent project, unaffiliated with PokerNow. [MIT](LICENSE). Background: [positional openings](https://www.pokerstars.com/poker/learn/lesson/opening-the-pot/) and [equity realization](https://blog.gtowizard.com/equity-realization/); implementation weights are original approximations.
