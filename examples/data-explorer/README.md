# BMEC Data Explorer

An API-first database workload that reads a large record set through explicitly
bounded, ordered BMEC queries. It includes equality filters, a model relationship,
a controlled insert route, and server-side keyset pagination.

Run the reproducible SQLite workload with `npm run test:data-explorer-large`.
It seeds 250,000 deterministic records by default, checks bounded reads,
filter/sort correctness, concurrent reads, indexed query plans, the region
foreign key, and one typed write. Set `BMEC_EXPLORER_ROWS=1000000` to run the
million-row workload used for the committed evidence. `GET /records/page` returns
the first 50 rows; `GET /records/page/:after` returns the next 50 after the prior
page's last unique name. URL-encode that name in the path. BMEC applies the cursor
predicate, ordering, and limit in the database. The generated Explorer page
hydrates its typed `records` list and exposes the server cursor control. A record's
“Browse this category” link opens a category-filtered page with its own typed cursor.
The browser fetches the declared routes and renders server responses without a
`PIPE_UI_STATE` data adapter.

The `GET /records/region/:region` and `/records/category/:category` routes have
matching `/pages/:after` continuations. Region and category predicates compose
with the unique name cursor, ordered and capped at 50 rows. `GET /records/summary`
returns total and active counts using database-side `COUNT(*)`, without loading
the million model rows into BMEC memory.

The SQLite gate records local SQLite timings; those are not PostgreSQL performance
claims. A separate local PostgreSQL gate verifies 250,000- and one-million-row
bounded HTTP pages, composite plans, and `COUNT` results on Windows and Linux.
The model's unique name field supplies the cursor index. The source declares
composite region/name and category/name indexes; both database gates verify
that those indexes are selected by the bounded filtered queries. This is keyset pagination over a unique field; it does not cover
arbitrary offset or composite cursors, `SUM`/`AVG`, or full-text search. Page requests do not share a snapshot, so
concurrent changes can affect a long traversal. The one-million-row browser
traversal itself was not run; Chromium traverses the base and filtered views on a
120-row fixture, while the million-row gate exercises bounded HTTP/database pages.

The PostgreSQL route gate is `node scripts/data-explorer-postgres-smoke.mjs`. It
requires `BMEC_POSTGRES_URL` and the explicit `BMEC_POSTGRES_DISPOSABLE=1` guard.
It creates a randomly named schema, runs the bounded cursor/count/auth checks
there, provisions the schema through BMEC's additive migration workflow, runs
the bounded cursor/count/auth checks, then drops only that schema. Use a verified
disposable PostgreSQL database. Set `BMEC_EXPLORER_ROWS=1000000` for the
one-million-row case. The gate does not claim hosted or production performance.
