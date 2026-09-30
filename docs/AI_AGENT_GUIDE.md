# Work with BMEC and coding assistants

This guide gives an AI coding tool a small, reliable path into BMEC. It uses
the installed compiler and its versioned catalogs as the source of truth.

## Start with the project in front of you

From the BMEC project directory, ask the compiler about this version and
the task you need to do:

```sh
bmec --version
bmec ai-spec --json
bmec knowledge "authenticated custom route" --json
```

`bmec knowledge` returns matching syntax, types, capabilities, diagnostics,
and checked example paths. Keep the search specific. For example:

```sh
bmec knowledge "decode JSON into a typed result" --json
bmec knowledge "page component with a form" --json
bmec knowledge "SQLite database transaction" --json
```

The command searches the local compiler-owned catalog. It does not send the
prompt or source code to a BMEC service.

## Use a compiler-backed change loop

1. Read the relevant catalog result and the smallest linked example.
2. Make one focused edit to the project.
3. Check the changed source and request structured diagnostics:

   ```sh
   bmec check main.bmec --json
   ```

4. Fix the reported diagnostic codes. Do not invent a spelling when BMEC
   reports an unsupported construct.
5. Format and check the result before building:

   ```sh
   bmec fmt main.bmec --check
   bmec build main.bmec --release
   ```

The command-line tool prints exact public usage with `bmec help` and
`bmec help COMMAND`. Use `bmec project main.bmec --json` to inspect the
compiler's model, routes, pages, styles, and capabilities for one app.

## Follow the versioned language contract

The website and installed package expose stable machine-readable references:

- `bmec ai-spec --json` describes language syntax, types, operators,
  capability rules, standard-library signatures, and UI contracts.
- `/ai/commands.json` describes the published CLI command schemas.
- `bmec capabilities --json` describes host capabilities and their functions.
- `/ai/diagnostics.json` describes stable diagnostic codes and repairs.
- `bmec examples --json` lists checked source examples.
- `bmec stdlib --json` lists standard-library functions and required effects.

For a high-level explanation of parsing, semantic checks, typed IR, and
target-specific behavior, read [How BMEC works](HOW_BMEC_WORKS.md).

These outputs are versioned. Keep the package version, language version, and
typed IR version distinct; a change in one does not automatically change the
others. The generated website catalog also appears under `/ai/` as JSON.

## Connect VS Code

Install the BMEC VS Code extension and the matching `bmec` CLI. The extension
starts the local stdio language server; diagnostics and editor information
come from the compiler running on the developer's machine. It is not a hosted
AI service and it does not upload a project's source to BMEC.

See the [editor setup guide](BMEC_EDITOR_SETUP.md) for installation,
executable selection, and troubleshooting. From a clean project, verify the
connection with `bmec doctor`, open a `.bmec` file, then check it from the
terminal if you need reproducible JSON diagnostics.

## Keep security and runtime boundaries explicit

BMEC checks language contracts; it does not automatically make application
authorization correct. State route access policy and database ownership
predicates in the application. Read the [security model](SECURITY_MODEL.md)
and [capability guide](CAPABILITIES.md) before changing trust or I/O behavior.

The [browser playground](PLAYGROUND_GUIDE.md) can execute a bounded subset of
pure functions in an isolated worker. It does not provide files, process
execution, network, databases, secrets, or host capabilities. Use a local
project for application routes and capability-backed code.

## Stable source files for agents

The generated website publishes an index and schema-versioned catalogs at:

- `/ai/index.json` — entry points and their schemas
- `/ai/ai-spec.json` — language and UI contract
- `/ai/knowledge-index.json` — searchable compiler knowledge
- `/ai/commands.json` — CLI commands and schemas
- `/ai/capabilities.json` — host features and effects
- `/ai/diagnostics.json` — diagnostic codes and repairs
- `/ai/examples.json` — checked BMEC programs
- `/llms.txt` — concise human- and agent-readable site map

For task-sized output, prefer `bmec knowledge "TASK" --json` to copying the
entire specification into a prompt.
