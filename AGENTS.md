# BMEC contributor and coding-agent guidance

BMEC source is the authority for valid syntax and compiler support. Before
writing a program, use `bmec knowledge "TASK" --json`, then confirm uncertain
facts in `bmec ai-spec --json`, `bmec capabilities --json`, or checked
examples. Do not guess syntax from ordinary English or assume a construct is
supported by every backend.

## Repository map

- `src/` contains the compiler, CLI, language server, runtime, and backends.
- `spec/` defines language, type, semantic, invariant, and diagnostic
  contracts.
- `ai/` contains generated machine-readable language, command, capability,
  diagnostic, example, and knowledge catalogs.
- `docs/` contains the human guides; `examples/` contains checked programs.
- `website/` contains the static product website and browser-local checker.
- `vscode-extension/` contains the VS Code client for `bmec lsp`.

## Canonical facts

- Product package: `0.9.1-beta.1`.
- Language compatibility: `0.1`; typed IR compatibility: `2`.
- Preserve the existing compiler, reference runtime, typed IR, and explicit
  capability model. This beta is not a language feature programme.
- Check the exact target and runtime before describing support. The browser
  playground checks source with the full compiler and can run a bounded pure-function subset in a short-lived browser Worker. Keep its limits and host-capability exclusions accurate.
- Authentication does not provide row ownership automatically. Applications
  must put owner or workspace predicates in authorized data operations.

## Build and repair loop

```sh
npm ci
npm run build
node dist/cli/index.js help
node dist/cli/index.js knowledge "custom application" --json
node dist/cli/index.js check main.bmec --json
node dist/cli/index.js fmt main.bmec --check
```

For a source change, make the smallest edit, read compiler diagnostics, repair
the diagnosed issue, then run the focused contract check and relevant test.
Run the repository's broader gates for release work. Do not weaken checks to
make an unsupported target appear to pass.

Treat user data, secrets, generated release artifacts, and private test
fixtures as sensitive. Never add credentials or real personal data to source,
examples, logs, or public test output.
