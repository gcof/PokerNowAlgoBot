# PokerNow Algo Bot 0.8.0

Portable Manifest V3 release for PokerNow NLH without embedded account/table configuration.

- Any local seated player; both PokerNow HTTPS hostnames.
- Range-based equity, position-aware decisions, custom sizing and cancellable 1–2 second pauses.
- Preview by default, opt-in resume, table-transfer reset and duplicate-tab protection.
- English/Russian docs, a dependency-free build, ZIP and SHA-256 checksum.

Extract `pokernow-algo-bot-v0.8.0.zip` and load its folder containing `manifest.json` as an unpacked Chrome/Edge extension. Refresh a permitted test table. Prototype settings are not migrated; start in preview and select your settings again.

Heuristic strategy: ICM, full historical side pots and multiple boards remain unsupported. Automated tests and archive inspection are not a browser compatibility or win-rate benchmark. Perform the CONTRIBUTING.md smoke test before publishing this draft.
