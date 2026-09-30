# BMEC language basics

BMEC is statically typed. Values include `text`, `number`, `integer`,
`boolean`, `money`, `date`, `datetime`, `id`, optionals (`T?`), lists
(`list<T>`), results (`result<T,E>`), and tasks (`task<T>`).

```bmec
app Basics

function allowed(age integer) -> boolean {
  if age >= 18 {
    return true
  } else {
    return false
  }
}
```

Use `let name = value`, symbolic comparisons, and `else` as the recommended
first-use style. The main examples and compiler-owned AI examples use these
forms. For controlled-English variants, BMEC also accepts `let name is value`,
`let name be value`, comparisons such as `age is at least 18`, and `otherwise`
in place of `else`. These spellings have the same typed meaning. The formatter
preserves the spelling in the source, so choose one style within a project.

Functions declare their types. Models declare persistent data and can back
generated APIs and CRUD pages. Pages and components describe UI; named styles
describe layout, spacing, typography, states, and responsive behavior.

Database, HTTP, filesystem, environment, time, and random operations require
explicit capabilities. Authentication and authorization are route policies,
not client-side conventions. Use `bmec check --json` for machine-readable
repair information and `bmec fmt --write` for consistent layout. Formatting
does not choose among accepted syntax aliases.

For a step-by-step path from a new project to a running model-backed page, see
[`GETTING_STARTED.md`](GETTING_STARTED.md).

## Absence and expected failures

Use `T?` when a value may be absent (`some(value)` or `none`). Use
`result<T,E>` for an expected operation failure. The `?` operator returns an
error from the current function early; that function must itself return a
compatible `result`. Runtime faults such as overflow remain runtime failures
and are not converted into `err` values.

Capabilities make access explicit in function parameters. This function
returns the filesystem write result and propagates a failed read before it
tries to write:

```bmec
app LanguageBasics

function copyText(fs capability<filesystem>, input text, output text) -> result<boolean,text> {
  let contents = readTextFile(fs, input)?
  return writeTextFile(fs, output, contents)
}
```

For the complete construct catalog, see [`../ai/ai-spec.md`](../ai/ai-spec.md).

## Common mistake

An optional `T?` value is not a `T`; narrow it with a match or an explicit
presence check before reading its value.

## Related capabilities

Continue with [records, enums, collections, and JSON](LEARNING_PATH.md), then
review the [compiler contracts](../ai/ai-spec.md) and
[capability coverage](CAPABILITY_COVERAGE.md).
