# BMEC capabilities and support boundaries

This guide describes the public BMEC **0.9.1-beta.1 package** and **0.1 language**
surface. The compiler-owned specification and catalogs are the authoritative
symbol lists; this guide explains how to use them and where the host remains
responsible. The [generated coverage inventory](CAPABILITY_COVERAGE.md) links
each capability to its specification, AI metadata, example, diagnostics, and
version.

Start with [installation](INSTALL.md), then [getting started](GETTING_STARTED.md).
The examples below are BMEC source; check a complete source file with
`bmec check FILE.bmec` before building it.

## Language syntax and types

Source files use `.bmec`. A project starts with `app Name`. Declarations
include `type`, `enum`, `model`, `function`, `component`, `page`, `api`, and
`style`. Blocks use braces. A semicolon is optional between statements.
Bindings declared with `let` are immutable; `var` is available when a local
must change. Conditions are boolean expressions; BMEC does not use
truthiness.

Primitive types include `text`, `integer`, `number`, `money`, `boolean`,
`date`, `datetime`, and `id`. Integers are checked signed 64-bit values;
numbers must be finite. `T?` means a value or `none`, and `list<T>` is an
immutable homogeneous list. Function, model, record, enum, and capability
types are checked by the compiler. See the [language spec](../spec/language.md)
and [type contract](../spec/types.md).

## Functions and control flow

Declare parameter and return types. Use `if`/`else`, `for item in values`,
`while`, `break`, `continue`, and `match` where appropriate. Async functions
return `task<T>` and await asynchronous work with `await`. Capabilities are
explicit parameters, so a function that accesses a database or filesystem
declares that dependency in its signature.

```bmec
app Greeting

function greeting(name text) -> text {
  if name == "" { return "Hello" }
  return "Hello, " + name
}
```

## Collections, records, and enums

Lists can be created with `[value, ...]`; an empty list needs an explicit
contextual type. Indexing returns an optional element. Standard list
operations include mapping, filtering, folding, finding, sorting, slicing,
deduplication, and bounded range construction. Their exact names and
signatures are in `bmec stdlib --json`.

Use `type Name { field Type }` for an in-memory record. Construction supplies
each field exactly once. Use `enum Name { Variant ... }` for a finite set of
variants; `match` checks that variants are handled. Persistent records use
`model`, described under [databases](#database-adapters).

## Result and optionals

Use `T?` and `none` to represent absence. Check or match an optional before
using its value. `result<T,E>` represents an expected operation failure and
has `ok(value)` and `err(error)` constructors. The `?` operator propagates an
error from a function whose return type can carry that error. Runtime faults
such as overflow are not converted into Results. See
[`spec/semantics.md`](../spec/semantics.md) and the stable Result diagnostics
in [`spec/diagnostics.md`](../spec/diagnostics.md).

## JSON and serialization

`encodeJson(...)` and `decodeJson(...)` operate on typed BMEC values, including records,
models, lists, optionals, enums, Results, IDs, temporal values, and Money.
Numbers must be finite; exact integer and Money values retain their typed
representation at the BMEC boundary. HTTP JSON helpers use the same typed
conversion. See the [compiler-generated standard-library contracts](/ai/ai-spec.json)
and runnable JSON examples in `examples/json-*-bench/`.

## Filesystem and paths

Filesystem calls require `capability<filesystem>` and operate under the root
provided by the host. Public operations include `readTextFile(...)`,
`writeTextFile(...)`, `appendTextFile(...)`, `fileExists(...)`,
`listDirectory(...)`, `createDirectory(...)`, `copyTextFile(...)`,
`moveTextFile(...)`, and `removeTextFile(...)`, plus bounded
`saveUpload(...)`. Paths use typed helpers such as `pathJoin(...)`,
`pathBasename(...)`, `pathDirname(...)`, and `pathRelative(...)`; they
follow the host platform's path rules. `bmec exec` accepts an explicit
`--filesystem-root` for filesystem-capable functions. Never pass untrusted
paths to a host process outside the supplied root.

## HTTP

Declare typed server routes with `serve`/`http` handlers or expose a model API
with `api`. Route handlers receive typed path, query, header, and body values;
they declare capabilities and may declare success and application-error
statuses. The runtime provides an HTTP adapter. Client calls such as
`httpRequest(...)`, `httpRequestJson(...)`, and `httpRequestMultipart(...)`
are capability-gated; JSON and multipart helpers have typed inputs and Results.
See the [route contracts](/ai/ai-spec.json) and
[full-stack guide](FULL_STACK_GUIDE.md).

## Database adapters

`model` declares persistent application data. Typed reads, filters, ordering,
limits, counts, inserts, updates, deletes, and transactions use an explicit
`capability<database>`. Local `bmec run` uses persistent SQLite. A host can
configure PostgreSQL with `BMEC_POSTGRES_URL`; BMEC applies safe additive
tables and fields in the selected schema/search path and records migration
history. The PostgreSQL connection role needs permission to create and alter
application tables, indexes, and the migration ledger. BMEC does not create
or drop the database or schema. See the [database production guide](DATABASE_PRODUCTION.md).

### Migrations, indexes, and transactions

The runtime applies safe additive schema migrations and refuses destructive
changes. Declare composite indexes with `index name on Model by field, field`;
SQLite and PostgreSQL create them during startup migration. Changing or
removing an index requires a new name and reviewed cleanup. Transactions group
awaited database operations and roll back when execution throws or exits the
block early. Returning an ordinary `err(...)` value is normal completion
unless control flow exits the block. SQLite uses `BEGIN IMMEDIATE`; PostgreSQL
holds one leased connection for the transaction. Separate page requests do
not share a database snapshot.

## Authentication and authorization

Routes can require `authenticated`, a named `role`, or a named `attribute`.
Generated model CRUD APIs are public unless they declare `requiring ...` or
the host applies a default policy. The host must register matching policies;
unknown policies deny access. Authorization runs before body validation and
route capabilities. Local development can seed users through
`BMEC_AUTH_USERS`; do not use that convenience setting for production. The
host owns durable user storage and identity-provider integration. Sessions
are server-managed and use HttpOnly cookies; configure trusted origins when a
browser frontend has a separate public origin.

## Security boundaries

Keep database, secret, server-environment, and authentication state on the
server. Release builds separate browser assets from server IR and credentials.
Use parameterized typed database operations, explicit route policies, and
host-provided capability roots. `environmentSecret` yields a non-displayable,
non-serializable secret value; only an explicit environment capability can
reveal it. BMEC does not provide an external security audit or replace host
deployment security review. See [`spec/invariants.md`](../spec/invariants.md)
and [security operations](../SECURITY.md) in the repository.

## User interfaces and design system

Declare typed components, pages, navigation, dialogs, input fields, feedback,
and model CRUD sections in `.bmec` source. Named styles control layout,
spacing, color, typography, borders, focus/hover/active/disabled states, and
responsive overrides. Styles can compose other named styles. The
[styling guide](STYLING_GUIDE.md) covers syntax; the compiler's `styles` and
`project` commands expose resolved facts.

## Frontend state and forms

Page state is typed and can be initialized, updated, or sourced from a typed
GET route. UI actions send typed requests and can append projections or clear
state on success. Forms use typed input declarations and validation rules;
server handlers must still validate and authorize every request. Browser
state is not an authorization boundary. See the `UI-PAGE-STATE-*`,
`UI-PAGE-ACTION-*`, and `UI-INPUT-*` contracts in `/ai/ai-spec.json`.

## Responsive design

Use named style rules such as `on small screens { columns is 1 }` to change
layout, spacing, font size, and line height at supported breakpoints. The
style compiler validates the properties it accepts. Verify the generated
application at the viewport sizes your users need; a responsive declaration
does not guarantee that arbitrary custom content fits.

## Accessibility

BMEC UI contracts generate semantic controls and labels for declared inputs,
buttons, links, feedback, and dialogs. Provide useful input labels and status
messages, preserve keyboard focus, and check generated pages with a screen
reader and automated accessibility tooling. BMEC cannot infer the meaning of
all application content; application authors remain responsible for text,
contrast choices, and complete user workflows.

## Money and time

`money` is fixed-point with two fractional digits and deterministic
half-up division rounding; it is not binary floating point. Date and datetime
operations are typed and capability-gated where they read the current clock.
Current time-zone and duration semantics are intentionally narrow; check the
[generated capability coverage](CAPABILITY_COVERAGE.md) before relying on
calendar or clock behavior.

## Configuration and secrets

Read process configuration through `capability<environment>` using
`environmentText(...)`, `environmentInteger(...)`, `environmentBoolean(...)`,
and `environmentSecret(...)`. Text values can be optional; typed integer and
boolean readers return parse Results. Secrets
are opaque values that cannot be displayed or serialized. Supply production
configuration through the deployment host's secret manager, not source files,
browser state, or checked-in manifests.

## Email, time, randomness, and encoding

`sendEmail(...)` is available through a host-supplied startup adapter; provider
delivery, retries, and credentials belong to that adapter. `delay(...)`,
`scheduleOnce(...)`, `timeout(...)`, and `cancel(...)` are in-process and do
not persist across restart. `random` is for non-security use; security-
sensitive values use `secureRandomId(...)` and `secureRandomInteger(...)` with
the separate `secureRandom` capability. `base64Encode(...)` and
`base64Decode(...)` handle UTF-8 text, and decode returns a typed Result. BMEC
does not define a general cryptography API or implement TLS, password hashing,
or cryptographic primitives itself.

## Testing and diagnostics

Put test declarations in BMEC source and run `bmec test FILE.bmec`. Use
`bmec check FILE.bmec --json` for stable diagnostic codes, locations,
expected/actual context, suggestions, and deterministic repairs when
available. `bmec doctor` checks project and runtime setup. The human
[diagnostic reference](../spec/diagnostics.md) and machine-readable
`/ai/diagnostics.json` describe the diagnostic envelope and categories.

```bmec
app TestExample

function double(value integer) -> integer {
  return value * 2
}

test "double returns twice the value" {
  expect(double(3)).toEqual(6)
}
```

Run `bmec test main.bmec` to execute the declaration after the source compiles.

## Native compilation

`bmec build FILE.bmec --native` lowers supported typed BMEC programs through
generated C and a host C compiler. The native backend does not make every
server, database, or browser feature available in a standalone executable.
Check the program against the native support boundary and diagnostics before
depending on native output. The reference runtime remains the semantic
comparison point.

## Packaging

`bmec new` creates a project manifest and lockfile; `bmec lock` updates the
lock from declared dependencies. `bmec build FILE.bmec --release` creates
release artifacts with separate browser and server boundaries. The published
npm package contains the CLI runtime and public AI contracts, not repository
tests, evidence, or private planning documents. Verify the exact archive and
target runtime before distributing it.

## Deployment and operations

BMEC supplies a local runtime and release artifacts; the deployment host
provides process supervision, TLS termination, secret storage, database
provisioning/backups, and operational alerting. `bmec run` writes its startup
URL to standard output and closes on SIGINT/SIGTERM. Its default database file
is under the project `.pipe/` directory; persist that directory for local
SQLite data. Configure PostgreSQL schema, origin policy, authentication, and
filesystem roots explicitly.

The Node HTTP adapter returns an `x-request-id` for each request and has an
optional structured log callback when used as a host adapter. The `bmec run`
CLI does not configure a log sink. There is no built-in health/readiness route;
declare a route for a deployment probe and keep its response independent of
secret or database details. Send process output to the host's log collector.

BMEC has no maintained Dockerfile or published container image. The package
can be installed in a Linux Node.js 22+ environment when the platform can
load its native SQLite dependency. Run `bmec doctor` and the app's database
smoke on the target image. `bmec run` binds to `127.0.0.1` and has no CLI
setting to bind a container interface, so publishing a Docker port does not
expose the app outside the container. Do not treat this CLI path as a
production container deployment. There is no BMEC-managed hosting service or
one-command production deployment target.

## AI discovery and compiler architecture

Use `bmec ai-spec --json`, `bmec stdlib --json`, `bmec capabilities --json`,
`bmec examples --json`, and `bmec check --json` instead of guessing syntax or
reading implementation source. The website publishes the same compiler-owned
language/UI contract, command catalog, diagnostic envelope, examples, and
generated coverage inventory. Schema versions are declared in each catalog.

The compiler pipeline is source → lexer/parser → semantic analysis → typed
validated IR → reference runtime or a backend. TypeRef and canonical IDs are
the authoritative type and symbol identities. The reference runtime defines
language behavior; backend parity is verified only for the tested constructs.

## Known limitations

- BMEC is a developer preview. The package and language versions are separate;
  this guide labels package 0.9.1-beta.1 and language 0.1.
- The reference runtime creates SQLite and PostgreSQL model schemas and applies
  safe additive changes. Destructive migration still requires a separate,
  reviewed recovery procedure.
- Composite indexes can be declared as `index name on Model by field, field`;
  removing or redefining an index is treated as destructive.
- In-process schedules are not durable or distributed.
- Email delivery depends on a host adapter.
- No WebSocket/realtime contract is offered.
- No arbitrary binary-buffer or cryptographic-primitive API is offered.
- Native compilation covers a bounded program subset; check its gate for the
  exact constructs available.
- The CLI HTTP listener binds to loopback; a container-facing bind option and
  maintained Docker image are not provided.
- Authentication provider identity, TLS termination, monitoring, and
  deployment orchestration remain host responsibilities. The runtime includes
  liveness/readiness endpoints and SQLite backup/restore guidance.
- The compiler's accessibility support does not replace application-level
  accessibility review.

For the complete function signatures, see the generated
[standard-library reference](STANDARD_LIBRARY.md). For the capability-by-
capability version and example index, see
[CAPABILITY_COVERAGE.md](CAPABILITY_COVERAGE.md).
