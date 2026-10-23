# Contributing

Use Node.js 24+ and run `npm run check`, `npm test` and `npm run build`. No dependency installation is needed. CI targets Windows/Linux and Node 24.

Keep PokerNow DOM knowledge in `adapter.js`, lifecycle in `bot.js`, decisions in `strategy.js` and evaluators in `core.js`. New variants need explicit parser/evaluator support.

Add representative synthetic regressions for bug fixes. Do not commit private table invitations, player identifiers, credentials, personal screenshots or account-specific defaults. For strategy changes, document assumptions and comparison scenarios; passing tests alone does not establish improved win rate.

## Release checklist

1. Update package and manifest to the same semantic version.
2. Update changelog and `docs/RELEASE_NOTES.md` with material limitations.
3. Run checks/tests/builds; inspect ZIP entries and `SHA256SUMS`.
4. Smoke-test unpacked installation on a permitted test table: preview, Start/Stop/Esc, custom sizing, duplicate-tab prevention and transfers.
5. Commit reviewed changes, create annotated `vX.Y.Z`, and push branch/tag when authorized.
6. The tag workflow creates a draft release. Inspect assets/notes/checksums before publishing.

```sh
git tag -a vX.Y.Z -m "PokerNow Algo Bot vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

Never overwrite a published tag. Make a new patch release for corrections.
