# Journal

A bounded blog/content-app slice. `Post` is a persisted model exposed through
the generated `/posts` CRUD API and the release UI. The model exercises
required-field and unique-slug validation; the generated admin page supports
listing, creating, editing, and deleting records. A separate `Articles` page
hydrates published posts from a typed database route, with a bounded list and
50-row keyset pagination. Its title filter sends debounced, URL-encoded terms
to typed server routes; the title predicate, publication condition, cursor,
ordering, and limit run in the database. Published article rows link to a generated detail
route at `/articles/:slug`; the page renders only the published row matching
the typed slug parameter, including direct links and browser history. The
detail source uses a separate server route filtered by both slug and
`published = true`, and returns at most one row.

From the repository root:

```sh
node dist/cli/index.js check examples/journal/main.bmec
node dist/cli/index.js build examples/journal/main.bmec --release
```

The static release UI expects the BMEC reference server at its configured API
endpoint; it does not make the database itself static.

Scope: this proves persisted admin CRUD, a database-side published-only list,
search and cursor continuation, a parameterized server-side detail lookup, and
generated browser search controls. Draft list, search, and detail queries
exclude draft rows on the server; draft bodies are not sent to the browser.
There is no publishing workflow. Title matching is case-sensitive literal
substring search. The PostgreSQL route gate is `node scripts/journal-postgres-e2e.mjs`;
it requires `BMEC_POSTGRES_URL` and
`BMEC_POSTGRES_DISPOSABLE=1`, creates a fresh scoped schema, and drops only that
schema after the run. This gate passes on Windows and Linux against an isolated
local PostgreSQL 18.6 server; it does not establish hosted/production performance
or independent editorial review.
