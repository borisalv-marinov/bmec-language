# Build your first BMEC app

This is the shortest executable path from installation to a local app.

```sh
bmec new hello
cd hello
bmec check main.bmec
bmec fmt main.bmec --check
bmec build main.bmec --release
bmec run main.bmec
```

`bmec new` creates a `bmec.toml`, `bmec.lock`, and `main.bmec`. The starter
contains a model, generated CRUD API, page, form, component, and named style.
Open the URL printed by `bmec run` in a browser.

The important declarations are:

```bmec
app Starter
model Item { name text required }
api /items from Item
page Main { crud Item }
```

Use `bmec project main.bmec --json` to inspect the compiler-owned model,
route, page, style, and capability facts. Use `bmec check main.bmec --json`
when a tool or agent needs structured diagnostics.

For the complete public surface, run `bmec ai-spec --json` and
`bmec stdlib --json`.

## Common mistake

Running `bmec run` before `bmec check` can make it harder to distinguish a
source error from a runtime or local database problem. Check first, then run.

## Related capabilities

This starter exercises typed models, generated routes, CRUD pages, forms,
components, styles, local SQLite, and the development server. Continue with
the [15-step learning path](LEARNING_PATH.md) or the
[capability guide](CAPABILITIES.md).
