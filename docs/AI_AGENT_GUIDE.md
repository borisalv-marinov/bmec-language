# AI agent guide

Use compiler-owned JSON interfaces instead of reading BMEC implementation
source:

The complete command and standard-library signatures are listed in the
generated [CLI reference](CLI_REFERENCE.md) and
[standard-library reference](STANDARD_LIBRARY.md).

```sh
bmec ai-spec --json
bmec knowledge "paginate orders" --json
bmec knowledge "authenticated route" --json
bmec stdlib --json
bmec capabilities --json
bmec examples --json
bmec lsp
bmec check main.bmec --json
bmec project main.bmec --json
```

Use `bmec knowledge "TASK" --json` for a small task-focused context pack. It
searches compiler constructs, standard-library signatures, checked examples,
and capability metadata, then returns relevant syntax, constraints, errors,
effects, and examples. Search is deterministic and uses catalog terms plus a
small set of task synonyms; it does not query an external service.

Diagnostics have stable codes, locations, expected/actual context, related
locations, and repair metadata where available. A reliable repair loop is:

1. Write the smallest change.
2. Run `bmec check FILE --json`.
3. Repair from the diagnostic.
4. Run `bmec fmt FILE --check`.
5. Run focused tests and `bmec build FILE --release`.

The package identity is `0.9.1-beta.1`; language compatibility remains `0.1`
and typed IR compatibility remains `2`.
The [capability coverage inventory](CAPABILITY_COVERAGE.md) maps every
compiler construct, standard-library function, and host capability to its
human guide, machine contract, verified example, diagnostics, and version.
