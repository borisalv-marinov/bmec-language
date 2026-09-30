# BMEC AI spec

Language version: 0.1

`bmec ai-spec --json` identifies its machine contract as `bmec.ai-spec.v1`
through `schemaVersion`, and publishes `languageVersion: "0.1"`. The legacy
`version: "0.1-alpha"` field remains for compatibility. `ai/commands.json`
uses `schemaVersion: "bmec.commands.v1"` and the same language version.
The `constructs` array provides stable IDs and structured core-language
records. Each record carries `name`, `purpose`, `syntax`, `types`,
`constraints`, `errors`, a compiler-checked `example`, and `related` constructs.
The catalog covers core declarations, control flow, common types, capabilities,
error propagation, typed UI inputs/components/page lists/styles, routes, and
the supported database read/query/count/mutation/transaction forms. The examples are
checked against the reference compiler in the contract tests.

### Page content and components

Put visible text inside a component, then include that component on a page with
`use`. A page body cannot contain a bare text statement.

```bmec
component Heading { text "Welcome" }
page Home { use Heading }
```

### Model API authorization

Use `api /tasks from Task requiring authenticated` or `requiring role manager`
to protect every generated list, create, read, update, and delete route. A
custom `serve` or `http` handler that replaces one of those routes inherits
the API policy unless it declares a route policy of its own. The host must
register the named authentication or authorization policy. An API without
`requiring` is public unless the host applies a default route policy.

```bmec
model Task { title text required }
api /tasks from Task requiring authenticated
```

### Database transactions

Use `transaction using db { ... }` inside an async function to group awaited
database operations. The block commits when execution reaches its end; a
thrown failure rolls back the writes in the block. A normal `err(...)` value
does not itself trigger rollback if the block ends normally. A `return`,
`break`, or `continue` that leaves the block rolls back first, then propagates
the control flow, so `return err(...)` can abort a multi-write operation.
Capture success values in mutable bindings declared before the block and
return them afterward. Nested transactions are rejected. Keep non-database
side effects outside the block because rollback cannot undo them. SQLite uses
`BEGIN IMMEDIATE`, serializes other requests on the same client and competing
writers, and PostgreSQL uses one leased client for the transaction.

```bmec
model Item { name text required }

async function save(db capability<database>, item Item) -> task<integer> {
  var id integer = 0
  transaction using db {
    id = await add item to Item using db
  }
  return id
}
```

### Idempotent inserts and page actions

`databaseInsertIdIfAbsent(db, "Model", value, "uniqueField")` inserts a typed
record only when its declared unique field is unused. It returns the generated
integer ID when inserted and `none` when the key already exists. SQLite and
PostgreSQL use one parameterized `ON CONFLICT ... DO NOTHING RETURNING` query.
Inside a transaction, read the existing record and compare its request
fingerprint before returning the original result; never reserve inventory again
for a matching retry.

A page event can declare `sends POST "/path" with idempotency key`. Its route
must declare a required text `idempotencyKey` header. The generated browser
client persists a secure key and a SHA-256 digest of the request body, reuses
the key on retries, and starts a new key after success or when the body changes.
It does not store the submitted fields in local storage and fails closed when
secure randomness or Web Crypto is unavailable.

### Conditional inventory decrements

`databaseDecrementWhere` performs one parameterized update that subtracts a
positive integer amount only when a typed key matches and enough quantity is
available. The generated integer model `id` is a valid key field as well as
declared fields such as `sku`. It returns an affected-row count: one for a successful decrement,
zero when the row is missing or the quantity is insufficient. The SQL
condition keeps the stored quantity from going below zero. Put several
decrements in a transaction and return a typed error from the block when any
count is zero; that return rolls all earlier decrements back.

```bmec
model Product { sku text required unique stock integer required }

async function reserve(db capability<database>, sku text, quantity integer) -> task<integer> {
  return await databaseDecrementWhere(db, "Product", "stock", quantity, "sku", sku)
}
```

### Database counts

Use `await databaseCount(db, "Model")` for a total row count and
`await databaseCountWhere(db, "Model", "field", "=", value)` for a typed
comparison-filtered count. To scope a count by two conditions, pass a second
field/operator/value triple, for example
`await databaseCountWhere(db, "Task", "ownerAuthId", "=", owner, "status", "=", Status.Active())`.
Both forms return `task<integer>` and execute SQL `COUNT(*)` through the SQLite
or PostgreSQL adapter, so rows are not loaded into BMEC memory. Each model name
and filtered field is checked against the declared model; each comparison value
must match its field type and is bound as a query parameter. Supported
operators are `=`, `!=`, `<`, `<=`, `>`, `>=`.

The representative fixture `examples/controlled-english/main.bmec`
demonstrates the controlled-English surface across typed models, validated
forms with validation and named click events, page lists, responsive styles,
async database reads and inserts, and authenticated routes.

App declarations may include optional static-site metadata:
`app Name { description "..." canonical "https://example.org/path" }`.
The compiler requires a non-empty description and an absolute HTTP(S) canonical
URL without credentials, query, or fragment. The static HTML generator escapes
these values and emits description, canonical, and basic Open Graph tags. This
is app-level metadata; per-page metadata and social-card images are not part of
the current contract.

The `bmec stdlib --json` projection includes `contracts` alongside the
backward-compatible `functions` array. Each contract exposes `name`,
`arity`, typed `arguments`, `returns`, and optional capability names.
The `ai-spec --json` projection exposes the same array as
`stdlibContracts`, so an agent can obtain language and standard-library
contracts from one machine-readable response.
It also exposes `completionVocabulary.controlledEnglishApi`,
`completionVocabulary.controlledEnglishDatabase` and
`completionVocabulary.controlledEnglishStyle`, and
`completionVocabulary.controlledEnglishAuthorization`, and
`completionVocabulary.controlledEnglishUi`, the canonical ordered
vocabularies for API/CRUD declarations, async database operations, typed style authoring, route
authorization requirements, and UI/event authoring used by the language
server.
The compiler-backed REPL also provides `:stdlib` for the same deterministic
human-readable contracts and `:capabilities` for the canonical effect kinds.

`bmec capabilities --json` returns the versioned `bmec.capabilities.v1` global
effect inventory and the standard-library functions requiring each capability.
The project and source-scoped projections identify their contract with
`schemaVersion` and `languageVersion: "0.1"`. `project --json` uses
`bmec.project.v1`; `symbols`, `types`, `models`, `routes`, `pages`, and `styles`
return envelopes whose payload keys match their command names and whose schema
IDs are `bmec.symbols.v1`, `bmec.types.v1`, `bmec.models.v1`,
`bmec.routes.v1`, `bmec.pages.v1`, and `bmec.styles.v1`. Source-scoped
capabilities use `bmec.used-capabilities.v1`. Global capabilities retain
`bmec.capabilities.v1`, and stdlib retains `bmec.stdlib.v1`; both now also
publish the language version. `ai-spec --json` and `ai/commands.json` list these
schema IDs and payload keys in `projectionSchemas`.
`bmec examples --json` returns the packaged `bmec.examples.v1` catalog. Each
entry includes a stable ID, name, purpose, included file name, relevant
constructs, valid source text, and a check command. Save the source as the
listed file name and run `bmec check` from that directory. The catalog is part
of the package, so it remains available after installation.

Graph queries are versioned too: `graph --json` returns a `nodes` envelope
under `bmec.graph.v1`; `expand --json` uses `bmec.expand.v1`; `inspect --json`
retains the inspected node fields and adds `bmec.inspect.v1` metadata; and
`affected --json` returns a `nodes` array under `bmec.affected.v1`. Canonical
node IDs and deterministic graph ordering are preserved.

The filesystem contracts include `createDirectory(capability<filesystem>, text) -> result<boolean,text>`; it creates one bounded directory, refuses traversal or absolute paths, and does not create missing parent directories.

Windows and Linux native builds can select a filesystem entry with
`bmec build FILE --native --entry NAME`. Such an entry takes
`capability<filesystem>` first, then positional `text` parameters, and returns
`result<boolean,text>` or `result<text,text>`. The executable receives its
capability root explicitly with `--fs-root DIR`; its Result value is printed
as JSON. The current native filesystem boundary supports `readTextFile` and
`writeTextFile` on both platforms. Both native and reference filesystem paths
reject symlink escapes; native additionally rejects reparse-point components.
Both implementations reject malformed UTF-8 reads with `err("invalid_utf8")`.

`environmentArguments(capability<environment>) -> list<text>` returns only the host-supplied argument vector. `bmec exec` accepts it through explicit `--argv JSON`; no implicit process arguments are exposed.

`readStdin(capability<environment>) -> task<result<text,text>>` reads stdin only when the host explicitly supplies a sink. Without `--stdin` it returns `err("input_unavailable")`; a host read failure returns `err("input_failed")`. `bmec exec` enables the sink with explicit `--stdin`.

`writeStdout(capability<environment>, text)` and `writeStderr(capability<environment>, text)` return `result<boolean,text>` and require explicit host output sinks; without a sink they return `err("output_unavailable")`.

`environmentText(capability<environment>, text) -> text?` reads an optional
text configuration value. `environmentSecret(capability<environment>, text)
-> secret<text>?` reads an opaque secret; only
`revealSecret(secret<text>, capability<environment>) -> text` can unwrap it.
Secrets cannot be displayed or serialized and all three operations require the
explicit environment capability.

`environmentInteger(capability<environment>, text) -> result<integer,text>`
and `environmentBoolean(capability<environment>, text) ->
result<boolean,text>` parse typed configuration values, returning `err("missing")`
for absent keys and `err("invalid_value")` for malformed values.

The Node HTTP adapter has a bounded multipart transport boundary. A source
handler with `body upload` receives the first file as a typed `upload` value,
and `body list<upload>` receives all bounded files in multipart order;
`uploadFilename(upload)`, `uploadMediaType(upload)`, and
`uploadSize(upload)` expose metadata, while
`saveUpload(capability<filesystem>, upload, text) -> result<boolean,text>`
writes the bounded bytes below the supplied filesystem root. The adapter also
exposes UTF-8 fields and additional file metadata (`fieldName`, safe
`filename`, `mediaType`, `size`) through `HttpRequest`. Raw bytes are not
projected through JSON or browser artifacts. For a typed record or model body,
multipart fields bind by declared field name: text-like fields use their first
UTF-8 value, `upload` uses the first matching file, and `list<upload>` uses all
matching files in multipart order. Optional fields may be omitted; required
fields produce a deterministic multipart binding error.

`setExitCode(capability<environment>, integer)` returns `result<boolean,text>`, accepts only codes 0 through 255, and requires an explicit host exit-code sink; without one it returns `err("exit_code_unavailable")`.

Numeric helpers include `power(number, number) -> number` and `sqrt(number) -> number`. Both require finite numbers; `sqrt` rejects negative inputs and `power` rejects non-finite results with deterministic runtime diagnostics.

`textIndexOf(text, text) -> integer?` searches by Unicode code point and returns `none` when the needle is absent; an empty needle returns index `0`. `base64Encode(text) -> text` encodes UTF-8 text using canonical Base64, while `base64Decode(text) -> result<text,text>` accepts only canonical padded Base64 and returns `err("invalid_base64")` for malformed or non-canonical input.

`encodeJson(value)` returns the lossless tagged JSON wire form for typed values. `decodeJson(text)` returns `result<T,text>` when used in a typed Result return context. It accepts either that tagged wire form or ordinary JSON matching the expected payload type, including lists and declared record/model fields. Ordinary JSON integers must be within JavaScript's safe integer range; use the tagged form for larger exact integers. Ordinary money must be finite and exactly representable to two decimal places. Both forms validate dates, datetimes, IDs, optionals, lists, records, models, enums, and Result values. `httpRequestJson(http, url, method, body, timeout)` and its seven-argument headers/query form encode the typed request body, set JSON content type by default, and decode successful responses against the typed `Result` context, accepting either ordinary JSON or the tagged form. Invalid or mismatched input returns a structured `err` payload beginning with `PIPE-JSON-001` or `PIPE-JSON-002`; typed HTTP response failures use `PIPE-HTTP-003`. Large integers and money are never silently rounded.

For example, a typed record list can be decoded directly from a conventional JSON file after `readTextFile` returns its text:

```bmec
type Attendee { name text age integer }
function decodeAttendees(source text) -> result<list<Attendee>, text> {
  return decodeJson(source)
}
```
`bmec capabilities file.bmec --json` remains the source-scoped used-capability
projection.

`sendEmail(capability<email>, to, subject, body)` returns
`task<result<boolean,text>>`. It requires an explicit email capability and
host adapter; the adapter is intentionally narrow and does not implement SMTP.
Without an adapter it returns `err("email_unavailable")`; adapter failures
return `err("send_failed")`.

`httpRequestMultipart(capability<http>, text, text, list<text>, list<text>,
list<upload>, integer) -> task<result<text,text>>` sends paired text
field-name/value entries and paired upload field names/values as bounded
multipart form data. It requires the HTTP capability, accepts the same
GET/POST/PUT/PATCH/DELETE method set and positive timeout bound as the other
HTTP clients, and returns the successful response text or a typed transport
error. Upload bytes are sent only through this explicit network contract and
are never serialized as JSON.

`delay(capability<time>, milliseconds)` returns
`task<result<boolean,text>>` for a bounded timer from 0 through 60000
milliseconds. It requires the time capability and is an in-process delay, not
a persistent or distributed scheduling facility.
`scheduleOnce(capability<time>, milliseconds, () -> task<result<boolean,text>>)`
delays one typed callback for 0 through 60000 milliseconds and returns its
`result<boolean,text>`. The callback must return that typed Result; callback
errors become `err("scheduled_failed")`. This is bounded in-process scheduling,
not persistent storage, a queue, or cron.
`timeout(capability<time>, task<T>, milliseconds) -> task<result<T,text>>`
races an existing typed task against the same 0 through 60000 millisecond
bound and returns `err("timeout")` when the timer wins. It does not cancel the
underlying task; callers must treat the operation as still running.
`cancel(capability<time>, task<T>) -> result<boolean,text>` requests
cancellation of a PIPE-owned task and returns `ok(true)` when the request is
accepted. A repeated request returns `err("already_cancelled")`; this boundary
does not terminate host work that has already started.

The checked-in `ai/commands.json` and `bmec ai-spec --json` expose the same
command names and invocation strings, including `new`, `run`, `test`, `fmt`, and
`lock`.

Modules use `import { Name } from "./relative.pipe"`; built-in standard modules use names such as `std.text`, `std.math`, and `std.list`. Imports are static, direct, and project-root bounded. A module sees only local declarations and explicitly imported names plus the documented standard library.

Declarations include `app`, `model`, `type`, `enum`, `page`, `api`, `function`, and `style`. `model` is persistent/application data; `type` is a general in-memory record.

Core types: `text`, `number`, `integer`, `boolean`, `money`, `date`, `datetime`, `id`, `T?`, `list<T>`, and function types such as `(integer) -> integer`. `none` is the only absence value. There is no truthiness. Named functions can be assigned to variables and called indirectly; function values are typed and are not host JavaScript functions.

Enums are explicit tagged values. Every `match` must name every variant exactly once; payload variants require a binding and payloadless variants reject one. Missing, duplicate, and unknown arms are compiler errors.

```pipe
enum Status { Pending Running Done Failed(text) }
function describe(status Status) -> text {
    return match status { Pending => "pending", Running => "running", Done => "done", Failed(message) => message }
}
```

Canonical examples:

```pipe
type User { name text nickname text? }
let users list<User> = []
let first = users[0]          # User?
if first != none { return first.name }
for user in users { return user.name }
let point = Point { x: 1 y: 2 }
```

Empty lists require a contextual `list<T>`. Lists are immutable and homogeneous. Safe indexing returns `T?`; negative and too-large indexes return `none`. Use `length(list)` and `contains(list, value)` for the small initial list API. Record literals require every declared field exactly once, reject unknown/duplicate/wrong fields, and support `value.field`.

Commands: `new`, `check`, `exec`, `run`, `test`, `fmt`, `lock`, `ir`, `expand`, `graph`, `project`, `symbols`, `types`, `models`, `routes`, `pages`, `styles`, `capabilities`, `stdlib`, `inspect`, `affected`, `repl`, `ai-spec`, and `build`. `bmec exec file.bmec FUNCTION --args JSON --filesystem-root DIR` invokes one declared typed function, injects only the explicitly supported filesystem capability, and emits deterministic JSON; no host environment or implicit filesystem root is exposed. `bmec stdlib --json` returns the versioned `bmec.stdlib.v1` projection of the compiler-owned standard-library names without requiring a source file. Use `bmec repl` for the compiler-backed interactive session; `:help` lists `:type NAME`, `:stdlib`, `:capabilities`, `:reset`, and `:quit` without changing expression semantics. Use `--json` for machine output; `check --cache` opts into content-hash incremental reuse with source/manifest/lock invalidation. Diagnostics and IR are versioned machine-readable structures. `expand --json` returns a `bmec.expand.v1` envelope containing the validated IR plus canonical graph facts. `graph file.bmec --json` returns graph nodes in canonical compiler order: application root, module roots, nested UI nodes in source order, their owning pages/components, then remaining declarations. `project --json` exposes the validated package manifest, lock dependency facts, deterministic transitive package nodes/edges when a project manifest is present, package-qualified `modules[].id` values, and `modules[].imports` module edges. It also exposes a versioned `releaseBoundary` object with public/private artifacts, browser exclusions, protected routes, capability routes, and server-only credential/session handling; it never includes credentials, password hashes, session identifiers, or server implementation details. `inspect NODE file.bmec --json` returns one canonical graph node object; style nodes additionally expose validated typed `facts` including values, composition, layout, alignment, and other style semantics; `affected NODE file.bmec --json` returns a deterministic JSON array of directly referenced and containing owner nodes. Both accept compiler-assigned IDs including nested UI IDs and component IDs. Unknown or missing IDs return `{ok:false,diagnostics:[...]}` with stable code `PIPE-AI-001` on stderr and a non-zero exit. Structured diagnostics may include `suggestions`, a safe `repair` descriptor, and `related` source locations; missing-export diagnostics identify the imported module and suggest making the target declaration public. The introspection commands are read-only projections of validated IR and use compiler-assigned canonical IDs.
The recommended machine workflow is: run `check --json`, repair from structured diagnostics, run `fmt --check` or `fmt --write`, then query `project`, `symbols`, `types`, `models`, `routes`, `pages`, and `capabilities` with `--json` before building. `bmec new` generates a starter that demonstrates controlled-English page lists and bound fields, and brace-delimited styles while retaining the canonical compiler pipeline. `pages --json` and the `project.pages` projection preserve the legacy `crud` name array and add deterministic `crudDetails` entries with `{name,fields:[{id,name,type,required,unique,control,validation,optional}]}` facts sourced from validated model IR. Enum-backed fields additionally expose `typeRef` and deterministic payload-free `options`. They also expose typed page `children`, including list nodes with `source`, `item`, and recursively projected `body` facts, so agents can discover controlled-English page lists without reparsing source. `control` is one of `text`, `number`, `date`, `datetime-local`, `checkbox`, or `select`; enum-backed selects expose deterministic payload-free variant names in `options`. `validation` is one of the documented validation rules or an empty string. These projections remain deterministic when the entry module imports a declared local package.
The `ai-spec --json` `commandUsage` map publishes the exact invocation string for each machine-facing command and is kept consistent with `ai/commands.json`. `component Form form { ... }` lowers to a canonical semantic form component while retaining typed input validation and named events; an input whose type is an enum lowers to an accessible `select` with one option per payload-free enum variant. Form-contained named button events are dispatched only after the existing input validators pass. Source inputs may add `label "..." placeholder "..." help "..."` before `validate` or `on`; placeholder and help are non-semantic hints, while the explicit label remains the accessible name. Generated HTML exposes help through a described-by element, and the direct DOM renderer exposes it through `aria-description`; neither hint changes validation or wire values. `bmec styles file.bmec --json` returns deterministic validated style facts, including composition, dimensions, numeric `radius`, responsive rules, states, and semantic properties. Projected UI input facts add deterministic `control`, `options`, `optional`, `placeholder`, `help`, and normalized `validation` fields; component/page input projections use the same control vocabulary as generated browser forms. Typed design tokens use `style token SpaceSmall padding is 8` and compose through `style named Card composes SpaceSmall`; token facts are marked `token: true` and tokens do not emit standalone CSS selectors.

`api /tasks from Task` generates collection and item routes on `/tasks`. GET collection returns 200 and a JSON array; POST accepts ordinary JSON matching the model or the lossless tagged form, returns 201 and an integer affected-row count; GET item returns 200 with the model or 404 with JSON error; PUT accepts either model body form and returns 200 with an integer affected-row count; DELETE returns 200 with an integer affected-row count. Unknown paths return 404 JSON. `bmec run` also exposes the compatibility route `/api/<Model>`; its legacy database values may differ in wire representation (for example, a SQLite boolean may be returned as `0` or `1`). Inspect `routes --json` for the exact declared route paths, statuses, body types, and parameter bindings.

Structured diagnostic JSON uses `schemaVersion: "bmec.diagnostics.v1"` and `languageVersion: "0.1"`. `bmec check FILE --json` returns `{schemaVersion,languageVersion,ok,diagnostics}` on success or failure; failure envelopes are written to stderr with a non-zero exit status. Every diagnostic includes `code`, `severity`, `message`, `file`, `line`, `column`, and `span`; `span` contains `start` and `end` locations with `file`, `line`, `column`, and `offset`. Optional fields are `node`, `path`, `kind`, `received`, `expected`, and `actual`. A diagnostic may include `suggestions` (safe human-readable actions), `repair` (`{type,value}` for a compiler-known repair), and `related` locations (`{message,span}`) for declarations or modules involved in the failure. Consumers should use `code` and structured fields for repair decisions rather than scraping message text.
Unsupported validation rules remain suggestion-only unless the rule is one of the exact compiler-known aliases `required`, `numeric`, `iso-date`, `iso-datetime`, or `http-url`; those aliases carry a `validation` repair descriptor and the LSP exposes a precise replacement edit.

In LSP, completion after a `validate` clause returns the canonical validation rules and these exact aliases in deterministic order. `ai-spec --json` and `project --json` expose the canonical set as `validationRules` and safe migrations as `validationRuleAliases`. Unknown validation diagnostics expose the same canonical set in `expected` and retain a human-readable `suggestions` field. Reusable components also accept `when Save is clicked`, which lowers to the existing `button "Save" on Save` UI IR. Pages accept `for each task in tasks show TaskRow`, which lowers to the existing typed list UI IR. Inline display also accepts `for each user in users show user name`, lowering directly to the same list IR with a binding body. A row component can render a bound field with `show task name`; this lowers to a canonical UI binding and is hydrated by both the direct renderer and generated browser artifact. The compiler validates that the receiver is the declared page-list item and that the field exists on its model/record, reporting `PIPE-UI-006` or `PIPE-UI-007` otherwise. In function bodies, `let user name be "Alex"` is a deterministic spelling of the local binding `user_name`; typed declarations such as `let user User be ...` retain their existing meaning. Expressions accept spaced field access such as `user name` and `user age`, which lower to the existing typed `user.name` and `user.age` field access. The LSP offers deterministic model/record field completion after a typed spaced receiver such as `user ` inside a function. Controlled-English conditionals accept `otherwise if condition { ... } otherwise { ... }` and lower to nested typed `IfStatement` branches; this is syntax sugar only and does not create a second runtime conditional model.
The JSON spec exposes the same contract through `diagnosticEnvelope`, `diagnosticRequiredFields`, and `diagnosticOptionalFields`. It publishes the exact `releaseBoundarySchema` for `project --json`, including `bmec.release-boundary.v1`, route field names, public/private artifact arrays, browser exclusions, and the server-only credential/session invariants; the schema contains no credential or session implementation data.
Form validation rules are `nonempty`, `email`, `number`, `date`, `datetime`, and
`url`; unknown rules produce `PIPE-UI-004` with a `suggestions` entry listing
that supported set.
The direct-DOM renderer mirrors generated-form validation accessibility by
projecting `aria-label`, `aria-invalid`, and `aria-required` state from the
validated UI IR.
HTTP source routes may use `requires role manager`, which lowers to the
server-owned `role:manager` policy boundary; request claims never grant access.
The `routes --json` and `project --json` projections preserve that boundary as
`policyId: "role:manager"` for deterministic agent inspection.
Controlled-English HTTP routes may use `serve GET /admin requiring attribute admin with private`, lowering to the existing server-registered `policyId` boundary `attribute:admin`; the compiler never treats browser-provided attributes as authorization.
Controlled-English routes may also use `serve GET /health requiring environment with health`, lowering to the existing typed route capability boundary `capabilities: ["environment"]`; capability tokens remain server-injected and opaque.
Controlled-English `serve` declarations also accept ordinary compact parameterized paths such as `serve GET /jobs/:id with showJob`; path segments and `:name` parameters are lowered to the same typed HTTP route IR as canonical `http` declarations. Canonical `http` declarations may add `headers name, otherName` before `returns`, `requires`, or `->`; each listed name must be a handler parameter, is removed from query binding, and is projected as a typed required-or-optional header fact. Header values are validated and injected into the matching handler parameters by the HTTP boundary. A non-GET handler parameter named `body` may be optional; an omitted or empty request body then binds `none` instead of producing a missing-body or malformed-JSON error.
Both canonical `http` and controlled-English `serve` routes accept the additive `returns STATUS errors STATUS[, STATUS]` contract. Put it before `->` in `http` routes and before `with` in `serve` routes; a `serve` route may put the status clause before or after `requiring`. For example, `serve POST /jobs requiring role admin and database returns 201 errors 400 with create` declares a role-protected database handler. The equivalent canonical form is `http POST /jobs returns 201 errors 400 requires role admin, database -> create`; canonical route requirements use commas between policy and capabilities. Both forms enforce the declared success and application-error statuses in the same typed router.
Authorization and capability requirements may be combined explicitly, for example `serve GET /health requiring role manager and database with health`; this lowers to `policyId: "role:manager"` plus `capabilities: ["database"]`.
The same explicit conjunction accepts `authenticated`, lowering to `policyId: "authenticated"` plus the typed capability list.
Model API and route authorization is evaluated before route capability checks and request path/query/header/body validation. Unauthorized callers receive the policy denial without learning whether their submitted body is valid; policy callbacks receive the raw request, before typed body decoding.
The Task Manager and Inventory application fixtures use these controlled-English
route forms directly; their release and live database tests preserve the same
route methods, capabilities, and policy boundaries.

Controlled-English database filters accept the deterministic comparison phrases
`is at least`, `is at most`, `is greater than`, `is less than`, `is equal to`,
and `is not`; they lower to the existing typed `DbPredicate` operators and
remain parameterized across SQLite and PostgreSQL adapters.

Every model table also has an implicit generated integer primary key named
`id`. It is not a declared model field and must not be added to model
constructors, but database filters may use it directly when the caller already
has the row ID:

```bmec
async function findJob(db capability<database>, jobId integer) -> task<list<Job>> {
  return wait for get items from Job where id is jobId using db
}
```

This can be combined with both ordering and a fixed limit, as with other
filtered reads. Keep the ID in a typed local or route parameter for later
updates/deletes; the query returns the declared `Job` model type.

Controlled-English reads may also use `limited to N`, for example
`get items from Item limited to 10 using db`; this lowers to the existing
typed select `limit` field and rejects negative or non-integer limits.

The canonical async surface is `wait for get items from Item using db` for
reads and `wait for add body to Item using db`, `wait for update body in Item
with id using db`, or `wait for delete id from Item using db` for mutations.
Insert, update, and delete each return an `integer`: inserts return the
generated row ID, while updates and deletes return the affected-row count.
For an insert, `body` must be a value of the target model type, not a narrower
request DTO. Construct a complete typed model value from validated request fields and
add server-owned values such as the current timestamp before inserting it;
use `databaseInsertId` when a later audit write needs the generated row ID.
For example (use your declared fields and server-owned values):

```bmec
model Job { title text required createdAt integer required }
type JobInput { title text }
async function createJob(db capability<database>, time capability<time>, body JobInput) -> task<integer> {
  let job Job = Job { title: body.title, createdAt: currentTime(time) }
  return await databaseInsertId(db, "Job", job)
}
```

Similarly, `update body in Item` expects a value with the target model type;
copy validated patch fields into a model value before updating.
An update may add an atomic equality guard, as in
`update body in Item with id where workerId is assignedWorkerId using db`.
The update succeeds only when both the primary key and guard match. The guarded field is set to the guard value, so this form cannot transfer a record to a different owner.
Each form lowers to the existing typed, capability-gated database IR.

Reads may combine `ordered by field ascending|descending` with that limit;
filtered reads may combine all three clauses, for example
`get items from Item where active is true ordered by name descending limited to 1 using db`.
These forms lower to the existing typed predicate, `orderBy`, and `limit` IR
fields and remain parameterized at runtime; the compiler validates both model
fields and lowers direction to the existing typed `orderBy` IR field.
The right-hand comparison value is a literal, parameter, or simple local
identifier. Do not place a member expression such as `principal.id` directly in
the query; first bind it to a typed local and use that name:

```bmec
model Job { assigneeId text required createdAt integer required }
type Principal { id text }
async function listAssigned(db capability<database>, principal Principal) -> task<list<Job>> {
  let workerId text = principal.id
  return wait for get items from Job where assigneeId is workerId ordered by createdAt ascending limited to 100 using db
}
```

For this package version, a filtered read supports either `where` by itself or
the combined `where` + `ordered by` + `limited to` form. Do not combine `where`
with only one of `ordered by` or `limited to`; those partial combinations are
not accepted by the compiler.

For large results, use keyset pagination in the database rather than loading
all records and slicing a page-state list. Order by a unique, stable field,
filter after the last returned value, and keep a fixed result limit. For
example, an HTTP handler can accept the prior name as `after` and return the
next 50 records:

```bmec
model Record { name text required unique }
async function nextPage(db capability<database>, after text) -> task<list<Record>> {
  return wait for get records from Record where name is greater than after ordered by name ascending limited to 50 using db
}
http GET /records/page/:after requires database -> nextPage
```

This is server-side keyset pagination: the predicate, ordering, and limit are
sent to the database. With unchanged rows, the unique field gives strict page
boundaries without overlap. Requests do not share a snapshot, so concurrent
inserts or updates can affect traversal. It does not provide arbitrary offset
paging or a composite cursor.

A generated page list can bind that continuation to an initial typed GET source.
The continuation must return the same list type, take exactly one text or
integer path parameter, and use a unique text or integer field on the listed
type. A model's generated integer `id` can be used directly:

```bmec
page Explorer {
  state records list<Record> from GET "/records/page" next GET "/records/page/:after" cursor by name
  for each record in records show record name
}
```

The generated page requests further bounded pages with a “Next page” control,
reports loading and failures accessibly, and hides the control after the
endpoint returns an empty page. It keeps only the current page in browser
state, so advancing does not accumulate the full result set in memory. This
binding traverses forward; it does not keep prior pages for backward navigation.
The browser only receives route data; the handler and database query remain
server-side. A matching generated CRUD section uses this state source for its
next-page control while keeping create, edit, and delete actions available.
Independent requests do not share a database snapshot, so concurrent writes
can affect traversal. This form supports one unique text or integer cursor and
does not provide composite cursors or arbitrary offset navigation.

Declare additive composite indexes in source with `index name on Model by
field, field`. For example:

```bmec
model Record { region text required name text required }
index record_region_name on Record by region, name
```

SQLite startup and transactional PostgreSQL startup migrations create declared
indexes. Reusing an index name with a different definition fails migration;
deploy a new name and review obsolete-index cleanup separately. See the
[database production guide](../docs/DATABASE_PRODUCTION.md) for migration,
pool, and recovery boundaries.

Database mutations retain explicit capability use in their readable forms:
`update payload in Item with id using db`, its guarded form with
`where field is value`, and `delete id from Item using db` lower to typed,
parameterized database update/delete IR. `databaseUpdateWhere` supports one or
two equality guards; `databaseDeleteWhere` combines the row ID with one or two
equality guards atomically. `databaseUpdateUniqueWhere` updates through a
schema-declared unique field without a read-then-write gap.
Guard fields stay at their matched values during updates. Required model fields reject absent,
null, or empty text values at insertion. A model-typed reference in a field
(such as `customer Customer`) declares a relationship; fresh SQLite schemas
enforce it, and typed route JSON supplies the related model ID as an integer.
An integer field such as `customerId integer` is only a number and declares no
relationship. Routes that declare `time` receive the host time capability, so
handlers can set timestamps with `currentTime(time)` instead of accepting
client-supplied time. Use an enum-typed model field for a constrained status;
ordinary JSON accepts only declared variants and SQLite stores simple variants
by name.
# BMEC AI guidance

For first-use source, prefer inferred or typed bindings with `=`, symbolic
comparisons, and `else`, matching the main BMEC examples. `let name is value`,
`let name be value`, English comparison phrases such as `age is at least 18`,
and `otherwise` are supported aliases with the same typed meaning. The
formatter preserves the spelling it receives; use one style consistently in a
project.

The compiler-backed REPL also supports `:scope`, which lists all persistent
bindings as deterministic `name: type` lines sorted by binding name; it is
useful when an agent needs session state without probing names one at a time.

BMEC types are semantic values, not JavaScript values. Use `text`, `integer` (checked signed int64), `number`, `money` (exact fixed-point), `boolean`, `date`, `datetime`, `id`, `T?`, `list<T>`, records, and models. `none` is explicit absence. String literals in an expected `date`, `datetime`, or `id` context become typed values only when they pass the canonical validator; invalid literals produce `PIPE-TYPE-006`. `randomId(random)` returns a UUID-shaped `id` and requires the opaque `capability<random>` value; `randomNumber(random)` returns a unit `number`; `randomInteger(random, lower, upper)` returns an integer in the inclusive-lower/exclusive-upper range `[lower, upper)`, requires safe-integer bounds, a safe range width, and `lower < upper`, and is ordinary capability-gated randomness. Security-sensitive code must use `secureRandomId(secureRandom)` or `secureRandomInteger(secureRandom, lower, upper)`, which use the host cryptographic runtime and require a separate opaque `capability<secureRandom>`; secure integer ranges must be safe integers with `lower < upper` and width below `2^48`. `currentTime(time)` returns epoch milliseconds, while `today(time)` returns the current UTC calendar date as a typed `date`; `dateYear`, `dateMonth`, and `dateDay` accept `date` or `datetime` values and return checked integers; `formatDate(value)` returns the canonical ISO text of a typed `date` or `datetime`; `addDays(value, days)` accepts a typed `date` and signed integer calendar-day count, returns `result<date,text>`, and reports `date_out_of_range` when the result cannot be represented by the date validator; `addSeconds(value, seconds)` accepts a typed UTC `datetime` and a signed integer second count, returns `result<datetime,text>`, canonicalizes successful values to ISO UTC text with milliseconds, and reports `datetime_out_of_range` outside the supported year range; `datetimeDifference(start, finish)` accepts two typed UTC datetimes and returns the signed whole-second difference `finish - start`, truncating sub-second remainders toward zero; `dateDifference(start, finish)` accepts two typed dates and returns the signed UTC calendar-day difference `finish - start` as an integer.

Use the small standard library: `trim`, `lower`, `upper`, `textLength`, `textContains`, `startsWith`, `endsWith`, `textReplace`, `substring`, `absInt`, `absNumber`, `minInt`, `maxInt`, `clamp`, `floor`, `ceil`, `round`, `first`, and `last`. List operations also include non-mutating `reverse`, bounded `slice(list, start, end)`, and equality-based `distinct`; `length` and `contains` remain list operations. `pathJoin(left, right)`, `pathBasename(path)`, `pathDirname(path)`, and `pathRelative(from, to)` return host-platform path results using the standard path library. `textReplace(value, old, new)` returns text with every matching occurrence replaced deterministically. `substring(value, start, end)` slices Unicode code points using non-negative integer bounds with `start <= end`; invalid bounds are runtime errors. `clamp(value, lower, upper)` requires finite numbers and `lower <= upper`, returning the bounded value. `httpRequest(http, url, method, body, timeout)` remains supported for compatibility. The extended `httpRequest(http, url, method, body, headers, query, timeout)` form additionally accepts even-length `list<text>` key/value pairs for headers and query parameters, requires `capability<http>`, and returns `task<result<text,text>>`; methods are limited to GET, POST, PUT, PATCH, and DELETE, response bodies are text, non-2xx responses return `err("http_STATUS")`, and transport/timeout/invalid-URL failures return typed error text. `readTextFile(filesystem, path)` requires `capability<filesystem>` and returns `result<text,text>`; `writeTextFile(filesystem, path, contents)`, `appendTextFile(filesystem, path, contents)`, and `fileExists(filesystem, path)` require the same capability; writes and existence checks return `result<boolean,text>`. `listDirectory(filesystem, path)` returns a sorted `result<list<text>,text>` of immediate entry names only. `copyTextFile(filesystem, source, destination)`, `moveTextFile(filesystem, source, destination)`, and `removeTextFile(filesystem, path)` return `result<boolean,text>` and require all paths to stay inside the bounded root. The host supplies a bounded root, absolute and traversal paths return `err("path_outside_root")`, missing reads return `err("not_found")`, and writes never create parent directories.

Use `result<T,E>` for expected failures. Return `ok(value)` or `err(error)`, then check with `isOk`/`isErr` before reading `.value`/`.error`. In a function returning a compatible Result or Optional, postfix `expression?` propagates an error/absence; `propagate name` is also accepted for a named Result or Optional value. These are propagation forms, not exceptions. Do not use Result for compiler/runtime faults or use optional values as errors.

Example:

function normalize(name text?) -> result<text,text> {
    if name == none { return err("Name missing") }
    let cleaned = trim(name)
    if textLength(cleaned) == 0 { return err("Name empty") }
    return ok(cleaned)
}
## Typed style facts

Named style facts in `project --json` are typed projections of the style IR.
Supported semantic fields include layout, dimensions, responsive columns,
themes, colors, borders, shadows, corners, accessibility states, typography,
and `fontWeight` (`normal` or `bold`), plus positive numeric `fontSize`, numeric non-negative `radius`, responsive `fontSize`, and
`lineHeight` values. Typed text and background colors include `blue`, `muted`,
`red`, and `green`; typed border styles include `subtle`, `strong`, `red`, and
`green`.
Typed alignment styles accept `start`, `center`, `end`, or `stretch` and lower
deterministically to scoped browser alignment rules. `layout` and `alignment`
may appear together in either order; duplicate modifiers are rejected. Composed
styles inherit these properties deterministically. Brace blocks also accept
opacity percentages and `when disabled { opacity is ... percent }`, which lower
to typed opacity facts and scoped disabled selectors. Background properties also
accept the controlled-English phrase `dark blue`, canonically represented as
`dark-blue` and lowered to a deterministic browser color.
Brace blocks also accept `text color is white|black|inherit`, exposed as the
typed `textColor` style fact. State blocks may use the same text-color phrase,
which lowers to a typed state property and deterministic pseudo-class CSS.
The accessibility form `when focused { show focus ring }` lowers to the
existing validated `focus: ringed` style semantic.
Responsive blocks may use `on small screens { columns is 1 }`, which lowers to
the existing typed responsive-column style fact.
They may also use `on small screens { gap is 8 }`, which lowers to a typed
responsive-gap fact and deterministic scoped media-query CSS.
Responsive padding is available through `on small screens { padding is 8 }`
with the same typed, composable lowering.
Responsive margin is likewise available through `on small screens { margin is 8 }`.
Responsive layout direction is available through `on small screens { layout is column }`,
lowering to a typed composable responsive-layout fact and deterministic scoped flex CSS.
The generated `bmec new` starter uses this responsive grid form so its first
project demonstrates a mobile layout without requiring raw CSS.
Source forms such as `style named Primary font weight is bold`, `on small screens { font size is 14 }`, `on small screens { font line height is 1.4 }`, and brace-delimited
blocks such as `style named Card { layout is column alignment is center padding is 12 when hovered { background is blue } }`
lower to the same typed style IR. `style named
Reading line height is 1.5` must remain deterministic through check, format,
validated IR, and browser CSS generation.
Typed transitions use `transition duration is 180`, `transition property is
background|color|transform|opacity|all`, and `transition easing is ease|linear`.
They compose deterministically and are emitted only when
`prefers-reduced-motion: no-preference` is active.

HTTP client extension: the compatibility form is
`httpRequest(http, url, method, body, timeout)`. The extended form is
`httpRequest(http, url, method, body, headers, query, timeout)`, where
`headers` and `query` are even-length `list<text>` key/value pairs. It keeps
the `capability<http>` boundary and returns `task<result<text,text>>`; query
values are URL-encoded, headers are sent as request headers, and malformed
pairs return the typed `PIPE-HTTP-002` runtime error. `httpRequestJson` has the same two arities but accepts a typed optional body and returns `task<result<T,text>>`; it requires a typed Result context so the response schema is compiler-owned, encodes the body losslessly, and accepts ordinary JSON or the tagged wire form for a successful response. It returns `PIPE-HTTP-003` for an absent context or invalid/mismatched JSON response.
`httpRequestMultipart(http, url, method, fields, fileFieldNames, files, timeout)` sends even-length text field pairs and paired `list<text>`/`list<upload>` entries as bounded multipart form data, returning `task<result<text,text>>` under the same HTTP capability and method/timeout boundary. In a source `http` route, a handler parameter whose type is optional becomes an optional query field; absent values are omitted from the handler parameter map and present values still receive canonical scalar validation.
Source routes may add `returns STATUS` before `-> handler` to declare their successful HTTP status (for example, `http POST /items returns 201 -> create`); the existing typed router rejects a handler response whose status is not the declared status or an explicit error status.
The same clause may add `errors STATUS[, STATUS]` (for example, `returns 201 errors 400, 404 -> create`) to declare accepted application-error responses; error statuses must be distinct 4xx/5xx codes and differ from the success status.

Generated client bindings preserve each source route's declared `responseBody`
as a TypeScript response alias and function return type. When canonical project
schema context is supplied, named BMEC records/models are emitted with their
typed fields; routes without a declared body remain `unknown`, and named types
without schema context use a safe structural fallback.
`disabled`, `readonly`, and `password` are also valid source input modifiers before `validate` or `on`. `disabled` prevents interaction and is projected as a deterministic boolean; `readonly` preserves validation and wire-value semantics while making text-like generated controls read-only (selects ignore it); `password` changes only the browser input mode. `validate email` selects the semantic email input mode. Generated HTML and the direct DOM renderer expose these states through `disabled`/`aria-disabled`, `readonly`/`aria-readonly`, and the corresponding email/password input types; typed values and validation remain compiler-owned.

Page-list data boundary: `for each item in items` reads values from its declared
page-state list. Without a typed server-search source, its filtering and
pagination operate on those supplied values; they do not query the database.
With a server-search source, the filter term is sent to that route and the
complete returned set is rendered without an additional one-field client
filter. A generated `crud Model` section is separate:
CRUD rows do not populate a page-state list, and BMEC provides no automatic
binding between the two. A page can exclude optional fields from its generated
CRUD form and table with `crud Task excluding ownerAuthId`; comma-separated
field names are supported. Exclusions are a presentation setting only: fields
must exist and cannot be required, hidden values are preserved for edits, and
server handlers remain responsible for authorization and validation.
Generated CRUD tables include a filter across visible fields and sortable
visible columns. Both operations run in the browser against rows returned by
the route; they do not add database filtering or paging.

A typed list state can declare a public, static GET source:
`state tasks list<Task> from GET "/tasks"`. The compiler checks that the GET
route returns the exact declared list type. The generated browser fetches that
route, announces loading and failures accessibly, and renders the response
through the typed page-list path. This avoids host-provided `PIPE_UI_STATE` for
that list, while keeping route handlers and database details server-side. The
GET source itself does not add database filters or limits; use a bounded typed
database query for server-side filtering or paging.

An optionally filtered list may pair its visible `filter by title` control with
a typed server search source. Add `label "Search posts by title or description"`
after the field name when the control searches more broadly than one field:
`state posts list<Post> from GET "/posts" next GET "/posts/pages/:after" cursor by slug search GET "/posts/search/:term" next GET "/posts/search/:term/pages/:after" cursor by slug`.
The search GET repeats every dynamic parameter on its base source route and
adds exactly one text path parameter for the search term; it returns the same
list type. A dynamic page's search cursor repeats both its scope parameters and
the search term, then adds the typed cursor. The generated client carries the
current page values through both requests, but each server handler must still
apply the scope predicate to its database query. The generated input debounces
requests, URL-encodes the term, and replaces
the current page state with the server response. When a base continuation is
declared, the search source must also declare its own continuation; the browser
uses the base cursor for an empty filter and the search cursor with the term for
a non-empty filter. The compiler checks both cursor routes and their unique
cursor fields.
Handlers must apply the search and cursor predicates in the database before
their limit. Keep visibility rules, such as `published is true`, in both query
routes. Clearing the input reloads the unfiltered initial source.

Pages may declare a URL pattern with `page Article at "/articles/:slug"`.
Each route placeholder must match a text field or a model item generated integer `id` in the page's typed list item.
A component link supplies the matching value with
`link "Read article" to Article with slug post.slug`; generated links encode
the value, and direct links and browser back/forward select the matching page.
On a dynamic page, the list renders only rows whose corresponding text fields
match the route values. A dynamic page-state GET source may instead use the same
ordered parameter names as the page route, with matching typed handler
parameters, and return exactly the declared list type. The data route prefix
may differ from the page route. The generated browser supplies current route
values when it fetches the initial list. A cursor continuation for a scoped
source carries those route parameters and adds the cursor parameter; its
database query must retain the same scope predicate. Server routes
must filter unpublished or private data before returning it. Client-side
matching only filters data already returned by that route and is not a
substitute for authorization or server-side filtering.

A query may combine two or more typed predicates with `and`, `or`, and
parentheses, followed by ordering and a required limit. `and` binds more tightly
than `or`; use parentheses when the intended grouping differs. Comparison values
are type-checked and bound as database parameters. A text `contains` predicate
matches a case-sensitive literal substring like `textContains`; `%` and `_`
are ordinary characters. SQLite and PostgreSQL lower it to their literal
substring functions rather than wildcard matching. This supports a published-
only keyset continuation and a workspace-, owner-, and cursor-scoped page:

```bmec
async function publishedPost(db capability<database>, slug text) -> task<list<Post>> {
  return wait for get posts from Post where published is true and slug is slug ordered by title ascending limited to 1 using db
}
async function nextPublishedPosts(db capability<database>, after text) -> task<list<Post>> {
  return wait for get posts from Post where published is true and slug is greater than after ordered by slug ascending limited to 50 using db
}
model Task { workspaceId integer required ownerAuthId text required title text required }
async function nextWorkspaceTasks(db capability<database>, workspace integer, owner text, after integer) -> task<list<Task>> {
  return wait for get tasks from Task where workspaceId is workspace and ownerAuthId is owner and id is greater than after ordered by id ascending limited to 50 using db
}
http GET /published-posts/:slug requires database -> publishedPost
http GET /published-posts/pages/:after requires database -> nextPublishedPosts
page Articles {
  state posts list<Post> from GET "/published-posts" next GET "/published-posts/pages/:after" cursor by slug
  for each post in posts show post title
}
page Article at "/articles/:slug" {
  state posts list<Post> from GET "/published-posts/:slug"
  for each post in posts show post title empty "Article not found or unpublished."
}
```

```bmec
model Post { title text slug text required unique published boolean }
component ArticleRow {
  show post title
  link "Read article" to Article with slug post.slug
}
page Articles {
  state posts list<Post> from GET "/published-posts"
  for each post in posts show ArticleRow
}
page Article at "/articles/:slug" {
  state posts list<Post> from GET "/published-posts/:slug"
  for each post in posts show post title empty "Article not found or unpublished."
}
```

The detail example uses a server query filtered by both the slug and
publication status, limited to one row. Draft bodies therefore never reach the
browser. Title filtering on the listing page remains client-side over its
bounded route response.

Typed page actions may bind a named event to one declared HTTP route, including a route with typed path parameters:
`page Store { event add(productId id, quantity integer) sends POST "/cart/items" }`.
Non-path event parameters must exactly match the route's declared model/record body.
Typed parameters may come from matching inputs in the enclosing form or from
explicit bindings on the action button. A button can combine both sources, for
example `button "Checkout" on checkout with items from cart` binds a parameter
from a page state while the other parameters come from the form. The state
TypeRef must exactly match the event parameter. Page state is client-provided
request data, so server handlers must still validate it and apply normal
authorization checks. Repeated-list buttons can bind
parameters from typed row fields, such as
`button "Add" on add with productId from product.id`; each row binding must
match a field on the list item and the corresponding action parameter type.
Every path placeholder must have an event parameter with the same name and type
as the declared route parameter; its value is URL-encoded and excluded from the
JSON body. The route cannot require query or other header inputs.
The generated browser submits same-origin JSON
and announces submission, success, and failure through a live status region.
It receives only the public method, path, and field types; handler functions,
database schema, and server IR remain server-side.
Events without `sends` keep their host callback behavior unless they declare a
typed local list update. For example, `event add(product Product) appends product to cart`
and `event remove(product Product) removes product from cart` update a
`list<Product>` state from a repeated-row button such as
`button "Add" on add with product from product`. The parameter must match the
list item type; the whole item binding or a type-matched field may be supplied.
The row value must actually contain every field used by an append projection.
An `id` on a model is generated when a row is persisted by the database; a
manually constructed model values returned by an in-memory function may omit `id`
in JSON. If the source list is not database-backed, project
a stable field that the response does contain (such as a unique product name),
or explicitly include a stable key in the returned values. Otherwise the typed
cart-line projection can be rejected at runtime and the click will not update
the list.
`state cart list<Product> = [] persisted in local storage` initializes an
empty list and stores it under an app/page/state-scoped key. The generated
browser validates restored JSON against the declared TypeRef and model fields,
discards invalid entries, and commits an update only after the storage write
succeeds. Persistent state cannot also have a remote GET source. The direct-DOM
renderer applies the same append/remove reducer and accepts the same storage
key from UI IR. A repeated-row event can also change a numeric field by one:
`event more(line CartLine) increases quantity of line in cart` and
`event less(line CartLine) decreases quantity of line in cart`. The row parameter
must match the list item model or record, and the named field must be numeric.
The direct-DOM and generated-browser renderers update the row matched by its
generated `id` when available (otherwise by complete value), preserve other
fields, validate finite and safe-range results, and use the same persistence write
before committing. Local state-update events do not send HTTP requests. A server action
may read a persisted list state as a typed request value; the generated browser reads
the current state after any local updates and combines it with the form fields when
building the request. An action may clear a persisted list after its HTTP request
succeeds: `event checkout() sends POST "/checkout" then clears cart on success`. The
clear and local-storage write happen only after a successful response; typed application
errors, HTTP failures, and network failures leave the list unchanged. This clause
currently supports clearing one persisted list; other local reducers remain separate
from server actions.

Authenticated route handlers may request the server-resolved session principal with a record named `Principal`:

```bmec
type Principal { id text role text }
function identity(principal Principal) -> text { return principal.id }
serve GET /whoami requiring authenticated with identity
```

The route projection exposes `principalParam`; that parameter is excluded from
path, query, header, and body bindings. The router resolves it from the active
session for authorization checks, then invokes the handler only if the declared
policy passes. `id` comes from the authenticated user, and other fields come
from server-owned principal attributes. Make an attribute optional in the
record when some users may lack it. Request-supplied claims cannot populate this value. A route that requests `Principal` without an authorization policy is rejected.

The Node runtime rejects unsafe requests with an `Origin` header unless it
matches the request origin or an explicitly configured trusted origin. Set
`BMEC_ALLOWED_ORIGINS` to a comma-separated list of canonical origins when a
trusted reverse proxy or separate browser UI needs a different public origin.
Requests without `Origin` remain accepted for non-browser clients; this check
does not replace CSRF tokens or an edge policy when origin-less browser
requests must also be denied.

Protected routes may share an exact method and path when each declaration has
a distinct `role:NAME` policy and all alternatives have the same request and
response contract. The router checks them in declaration order and invokes the
first handler whose role policy allows the authenticated request. Other forms
of duplicate routes remain invalid.
