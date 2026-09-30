# Full-stack BMEC guide

Use one `.bmec` project for typed models, server routes, generated browser
artifacts, and UI declarations. Start with a model and generated CRUD API:

```bmec
app Tasks
model Task { title text required }
api /tasks from Task
page Dashboard { crud Task }
```

Compile and inspect it with:

```sh
bmec check main.bmec --json
bmec project main.bmec --json
bmec build main.bmec --release
```

For custom routes, declare typed request/response contracts and explicit
authentication, authorization, and capabilities. PostgreSQL is supported for
server integrations; local `bmec run` uses persistent SQLite. Release builds
keep server IR, credentials, sessions, and database capabilities out of the
browser artifacts.

Model APIs are public unless you declare an access policy. Add
`requiring authenticated`, `requiring role manager`, or
`requiring attribute admin` after the model name to apply that policy to all
generated CRUD routes. Custom handlers at the same API path inherit its policy
unless they declare a more specific policy. The server host must configure the
matching authentication or authorization policy.
The router checks that policy before checking the request body or route
capabilities, so anonymous callers receive the access denial for malformed
requests too.

The Journal editor, Shop product editor, legacy Tasks sample, Job Booking,
PulseBoard task CRUD, Data Explorer writes, and administrative Inventory routes
declare role policies in source. Journal keeps
its `/published-posts` listing public while protecting editorial CRUD. Treat
examples that omit `requiring` as intentionally public demonstrations; add an
explicit policy before exposing their generated writes in a deployment.

## Common mistake

Adding an authenticated UI control does not protect a route. Put the policy
on the API or custom route and configure the matching server authentication
and role handling.

## Related capabilities

Continue with the [15-step learning path](LEARNING_PATH.md), then consult the
[database guide](DATABASE_PRODUCTION.md), [security model](SECURITY_MODEL.md),
and [capability coverage](CAPABILITY_COVERAGE.md).
