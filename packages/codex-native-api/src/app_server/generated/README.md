# Official app-server wire types

Generated from the released **Codex CLI 0.156.1**, tag `rust-v0.156.1`, commit
`b412ff32c417f855c2b2d1581b77058eed87c84b`. Upstream is
https://github.com/openai/codex/tree/rust-v0.156.1/codex-rs/app-server-protocol.
Apache-2.0 license is retained in `LICENSE`.

`stable/` is default generator output. `experimental/` is the full output with
`--experimental`; import it only for explicitly registered experimental dependencies.
These are wire types, not browser/provider presentation models. Generation does
not imply runtime validation or a guarantee that every method works on every version.

`manifest.json` records exact version, source commit, binary hash, generator commands
and every file's original and normalized SHA-256. The only postprocessing appends
`.js` / `/index.js` to relative imports/exports for this repository's NodeNext build.
Do not edit generated files manually. Reproduce with Node 24:

```bash
node scripts/app-server/generate-protocol.mjs --codex-bin /absolute/path/to/codex --out packages/codex-native-api/src/app_server/generated --source-commit b412ff32c417f855c2b2d1581b77058eed87c84b
```

The generator command is an explicit development operation; service startup never
regenerates source or downloads a runtime. The source commit is provenance supplied
by the maintainer after resolving the release tag, not inferred from version text.
