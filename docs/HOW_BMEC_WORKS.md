# How BMEC works

BMEC is a statically typed language for applications. You describe your own
data, functions, server routes, and user interface in `.bmec` source. The
compiler checks how those parts fit together, then prepares the parts that a
chosen runtime or backend supports.

## The short version

```text
Your .bmec source
       ↓
Parse names, types, control flow, and required capabilities
       ↓
Typed intermediate representation (IR)
       ↓
Reference runtime · browser UI · server/database output · supported C subset
```

The same source language connects application layers, but a program does not
automatically run on every target. BMEC reports unsupported constructs rather
than silently pretending a target has a capability it does not provide.

## From source to checked program

1. **Write the application you mean to build.** Declare models, typed functions, routes, pages, components, and explicit capabilities in source.
2. **BMEC parses the source.** The lexer and parser identify declarations and statements and report syntax errors with source locations.
3. **The compiler resolves and checks it.** Semantic analysis verifies names, types, control flow, route and UI contracts, and required capabilities. Diagnostics explain what failed and often suggest a focused repair.
4. **The compiler produces typed IR.** This resolved representation keeps language meaning separate from any one output target.
5. **A runtime or backend handles the supported part.** The reference runtime, browser UI generator, server/database adapters, and native C backend have distinct responsibilities and documented support boundaries.

## What the layers look like

| Layer | What it does | What to inspect |
| --- | --- | --- |
| BMEC source | Your models, functions, routes, pages, and styles | `main.bmec` |
| Compiler front end | Parses source and checks names, types, effects, and contracts | `bmec check main.bmec --json` |
| Typed IR | Records resolved program structure and types | `bmec project main.bmec --json` |
| Runtime and outputs | Runs or emits only the constructs supported on that target | `bmec build main.bmec --release` |

## A small example

This function declares its input and return type. The compiler can reject an
incorrect return value before the application runs.

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

Try the full source in the [browser playground](/playground/), or start a
project locally and ask BMEC to check it:

```sh
bmec new my-app
cd my-app
bmec check main.bmec --json
bmec run main.bmec
```

The playground uses the real compiler locally in your browser. Its function
runner is deliberately limited to bounded pure functions; it has no file,
database, network, process, or host-capability access.

## Capabilities and application security

Operations such as database access, HTTP, filesystem, environment, time, and
randomness require explicit capabilities where BMEC defines them. A capability
states what an operation needs; it does not provide the host service by
itself. The selected host must configure the matching implementation.

Authentication is not row authorization. Protect routes with the appropriate
route policy, configure that policy in the server host, and add database
predicates that scope records to the signed-in user or workspace. The compiler
checks declared contracts; it cannot decide whether your business policy is
correct. Read the [security model](SECURITY_MODEL.md) before exposing writes.

## Help a person or coding assistant use BMEC

Use the CLI to retrieve facts for the current compiler version instead of
guessing syntax:

```sh
bmec ai-spec --json
bmec knowledge "authenticated custom route" --json
bmec check main.bmec --json
```

The website also publishes the [AI entry point](/ai/),
[language contract](/ai/ai-spec.json),
[diagnostics](/ai/diagnostics.json), and
[checked examples](/ai/examples.json). The
[AI agent guide](AI_AGENT_GUIDE.md) explains a safe edit-and-check loop.

## Continue learning

- [Build your first app](GETTING_STARTED.md)
- [Learn the language](LANGUAGE_BASICS.md)
- [Connect the full stack](FULL_STACK_GUIDE.md)
- [Understand the target boundaries](CAPABILITIES.md)
- [Read the compiler specification](../ai/ai-spec.md)
