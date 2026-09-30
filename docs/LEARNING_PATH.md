# Learn BMEC, from install to deployment

This path takes a new developer from the exact BMEC package to a checked,
typed full-stack application and a deployment plan. The compiler is the
authority for source syntax. Every BMEC snippet on this page is checked by the
installed package smoke test.

## 1. Install BMEC

**Solve:** Install the published beta CLI without building the BMEC
repository: `npm install -g bmec`. Then run `bmec --version` and
`bmec doctor`.

**Explanation:** Node.js 22 or newer is required. `latest` is intended to
select the explicit `0.9.1-beta.1` prerelease. Use the exact archive and hash
from the release manifest when reviewing an unpublished local candidate.

**Common mistake:** Installing the repository checkout as if it were the
compiled consumer package. The archive contains the built CLI and its runtime.

**Related:** [Installation](INSTALL.md), [editor setup](BMEC_EDITOR_SETUP.md),
[CLI reference](CLI_REFERENCE.md).

## 2. Hello BMEC

**Solve:** Compile the smallest complete BMEC program.

```bmec
app Hello

function greeting() -> text {
  return "Hello, world!"
}
```

**Explanation:** `app` names the program. A function declares both its
parameters and return type. Save this as `main.bmec` and run `bmec check
main.bmec`.

**Common mistake:** Omitting the `app` declaration or the function return
type.

**Related:** [Language basics](LANGUAGE_BASICS.md), [checked examples](../ai/examples.json).

## 3. Types

**Solve:** Make data shape and function contracts explicit.

```bmec
app Types

function isAdult(age integer) -> boolean {
  return age >= 18
}
```

**Explanation:** BMEC checks values before they reach the runtime. Common
types include `text`, `integer`, `number`, `boolean`, `money`, `list<T>`,
`T?`, and `result<T,E>`.

**Common mistake:** Treating a number as a boolean. Conditions must be
`boolean`; BMEC does not use truthiness.

**Related:** [Language and type contracts](../ai/ai-spec.md), [capabilities](CAPABILITIES.md).

## 4. Functions

**Solve:** Put a named, typed operation behind a reusable contract.

```bmec
app Functions

function displayName(first text, last text) -> text {
  return first + " " + last
}
```

**Explanation:** Parameters and results have declared types. Functions that
use a host resource take its capability as a parameter.

**Common mistake:** Calling a capability-backed operation without declaring
and passing the matching capability.

**Related:** [Capability reference](CAPABILITIES.md), [standard library](STANDARD_LIBRARY.md).

## 5. Records, enums, and Results

**Solve:** Represent structured values, finite choices, and expected failures.

```bmec
app Records

type Preferences { name text active boolean }
enum Delivery { standard express }

function greeting(preferences Preferences) -> result<text,text> {
  if preferences.active {
    return ok("Hello, " + preferences.name)
  } else {
    return err("Account is inactive")
  }
}
```

**Explanation:** Records have named typed fields; enums constrain values to
declared variants; `result<T,E>` carries success or an expected error.

**Common mistake:** Using a runtime fault such as overflow as an expected
`Result`. Runtime faults remain runtime failures.

**Related:** [Language contracts](../ai/ai-spec.md), [JSON example](../ai/examples.json).

## 6. Collections

**Solve:** Transform a typed list without changing the source list.

```bmec
app Collections

function nonempty(names list<text>) -> list<text> {
  return filter(names, lambda(name text) -> boolean {
    return name != ""
  })
}
```

**Explanation:** List operations such as `filter`, `map`, `fold`, and `sort`
are typed standard-library functions. Empty lists need a known element type.

**Common mistake:** Assuming list indexing always succeeds; indexing returns an
optional value.

**Related:** [Standard-library contracts](STANDARD_LIBRARY.md), [AI spec](../ai/ai-spec.md).

## 7. JSON

**Solve:** Convert a typed value to JSON or parse JSON into a typed result.

```bmec
app Json

type Preferences { name text active boolean }

function encodePreferences(value Preferences) -> text {
  return encodeJson(value)
}

function decodePreferences(source text) -> result<Preferences,text> {
  return decodeJson(source)
}
```

**Explanation:** `decodeJson` validates the requested BMEC type and returns a
`Result`; callers must handle decoding errors.

**Common mistake:** Treating untrusted JSON as already having the requested
shape.

**Related:** [Compiler JSON contracts](../ai/ai-spec.md), [checked JSON example](../ai/examples.json).

## 8. HTTP

**Solve:** Define a typed route and the capability it needs.

```bmec
app Http

function health() -> text {
  return "ok"
}

serve GET /health with health
```

**Explanation:** Routes connect typed handlers to HTTP methods and paths.
Database and other host access must be declared explicitly.

**Common mistake:** Assuming a route is private because its page is hidden.
Protect the route with an explicit authentication or role policy.

**Related:** [HTTP contracts](../ai/ai-spec.md), [security model](SECURITY_MODEL.md).

## 9. Database

**Solve:** Declare persistent data and generate typed CRUD routes and a page.

```bmec
app Tasks

model Task { title text required done boolean default false }
api /tasks from Task requiring authenticated
page Dashboard { crud Task }
```

**Explanation:** A model describes persistent data. This API explicitly
requires authentication; database adapters and schema operations are owned by
the host runtime.

**Common mistake:** Assuming a model API is protected automatically. Add a
policy before exposing generated routes.

**Related:** [Database production guide](DATABASE_PRODUCTION.md), [capabilities](CAPABILITIES.md).

## 10. UI

**Solve:** Connect a model to a page with generated CRUD controls.

```bmec
app Tasks

model Task { title text required }
page Dashboard { crud Task }
style named DashboardStyle {
  layout is grid columns is 2 gap is 16 on small screens {
    columns is 1
  }
}
```

**Explanation:** Pages and components describe browser UI. Named styles keep
layout and responsive behavior in checked source.

**Common mistake:** Placing bare text directly in a page body; put text inside
a component or another supported page element.

**Related:** [Styling guide](STYLING_GUIDE.md), [UI contract](../ai/ai-spec.md).

## 11. Authentication

**Solve:** Restrict generated model routes with an explicit policy.

```bmec
app PrivateTasks

model Task { title text required }
api /tasks from Task requiring role manager
```

**Explanation:** The source policy is checked by the server runtime before
the protected operation. The deployment host must configure matching identity
and role handling.

**Common mistake:** Treating a client-side sign-in screen as access control.
The server route policy is the enforcement point.

**Related:** [Security model](SECURITY_MODEL.md), [threat model](THREAT_MODEL.md).

## 12. Full-stack application

**Solve:** Keep models, authenticated routes, and UI declarations in one
checked project.

```bmec
app Workspace

model Task { title text required done boolean required }
api /tasks from Task requiring authenticated
component TaskRow { show task title }
page Dashboard {
  state tasks list<Task>
  for each task in tasks show TaskRow
  crud Task
}
```

**Explanation:** `bmec check main.bmec` validates the source; `bmec project
main.bmec --json` reports compiler-owned routes, models, pages, and
capabilities.

**Common mistake:** Assuming every source feature runs on every backend.
Check the documented support boundary before choosing a backend.

**Related:** [Full-stack guide](FULL_STACK_GUIDE.md), [capability coverage](CAPABILITY_COVERAGE.md).

## 13. Testing

**Solve:** Check BMEC test declarations and validate the project before
building.

```sh
bmec check main.bmec
bmec test main.bmec
bmec build main.bmec --release
```

**Explanation:** `bmec test` runs BMEC test declarations in the source file.
Test the hosted HTTP, database, and browser behavior at the host integration
boundary as well.

**Common mistake:** Treating a successful compile as proof of correct runtime
behavior or authorization.

**Related:** [CLI reference](CLI_REFERENCE.md), [security model](SECURITY_MODEL.md).

## 14. Native build

**Solve:** Produce a standalone native executable for supported source.

```sh
bmec check main.bmec
bmec build main.bmec --native
```

**Explanation:** Native builds support a documented subset and require a
compatible C toolchain on the build host. The reference runtime remains the
behavioral authority.

**Common mistake:** Assuming that every valid BMEC program can be built
natively on every platform.

**Related:** [Backend support boundaries](CAPABILITIES.md), [capability coverage](CAPABILITY_COVERAGE.md).

## 15. Deployment

**Solve:** Prepare secrets, database, network boundary, upgrades, and recovery
before putting an app behind a public endpoint.

```sh
bmec check main.bmec
bmec build main.bmec --release
```

**Explanation:** The repository contains a local Linux container reference
deployment. Put TLS at a trusted edge, configure exact allowed origins, keep
credentials in a host secret store, and plan database backup and restoration.

**Common mistake:** Treating the local reference deployment as proof of TLS,
high availability, monitoring, or production readiness.

**Related:** [Deployment guide](DEPLOYMENT.md), [database production guide](DATABASE_PRODUCTION.md), [capabilities and limits](CAPABILITIES.md).
