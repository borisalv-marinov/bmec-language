# BMEC runtime operations

This guide describes the reference Node runtime started with `bmec run`.
Keep application data under `.pipe/` and keep database credentials in the
service environment, not in BMEC source or browser assets.

## Health and readiness

The Node runtime exposes `GET /healthz` for process liveness and `GET /readyz`
for readiness. Liveness returns `200` while the HTTP process can answer.
Readiness returns `200` only while the runtime is accepting work and its
selected database can answer a lightweight `SELECT 1`; otherwise it returns
`503`. Both responses are no-store and include `X-Request-Id`. These endpoints
are intended for local process supervisors and container probes. A reverse
proxy should not expose operational details beyond these bounded responses.

## Configuration and logs

`bmec run` validates the port and security settings before opening the
listener. Set `BMEC_SECURITY_MODE=production` and configure
`BMEC_ALLOWED_ORIGINS` with comma-separated canonical HTTPS origins when the
service handles browser authentication. Set `BMEC_POSTGRES_URL` to use the
PostgreSQL connection pool; otherwise the reference runtime uses SQLite at
`.pipe/<App>.db`.

The CLI writes one JSON object per request to standard output. Events include
an ISO timestamp, level, service, request ID, method, pathname, status,
duration, and outcome. Query strings and request bodies are never logged.
Long token-like path segments are replaced with `:redacted`; authorization,
cookie, and other request headers are not logged. Keep application-level logs
under the same secret-redaction rule.

`Ctrl+C` and `SIGTERM` begin a graceful stop: the HTTP listener stops accepting
new work, active requests drain, and then the database connection or
PostgreSQL pool closes. A subsequent start reopens the persistent database.

## SQLite migrations

The reference runtime checks the compiled model schema at startup and applies
safe additive SQLite migrations in a transaction. It records successful
changes in `_pipe_migrations`. Removing a model or field, changing a field
type or constraint, or adding a unique field to an existing table fails
startup with `PIPE-MIG-001`; review and plan a data-preserving migration before
deploying that schema. Do not edit the database while the service is running.

PostgreSQL startup uses a transaction to create application tables and apply
safe additive model changes, foreign keys, unique constraints, and declared
indexes. It records completed changes in `_bmec_migrations`. Removing a field,
changing its type or nullability, or adding a required field without a default
fails startup with `PIPE-MIG-001`. Index removal or redefinition requires a new
index name and an explicit reviewed cleanup. Keep each application in a
dedicated database or schema/search path so its migration ledger and model
tables are isolated.

## SQLite backup and restore

Use SQLite's online backup API while the service is running, or stop the
service before copying the database file. Keep backups outside the web root
and restrict access because they contain application data.

With `better-sqlite3` available in the project installation, create and check
a backup from the project directory:

```js
// save as backup.mjs
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
mkdirSync('./private-backups', { recursive: true });
const source = new Database('.pipe/MyApp.db', { readonly: true });
await source.backup('./private-backups/MyApp.db');
source.close();
const check = new Database('./private-backups/MyApp.db', { readonly: true });
console.log(check.pragma('integrity_check'));
check.close();
```

Confirm the integrity result is `ok` and retain an encrypted off-host copy
according to the application's retention policy. To restore, stop `bmec run`,
keep a copy of the current database for rollback, place the selected verified
backup at `.pipe/MyApp.db`, and start the service. Check `/readyz` and the
application's data before resuming traffic. Startup migration checks run
against the restored copy, so restore a backup compatible with the deployed
BMEC schema or follow a reviewed migration procedure first.

## PostgreSQL lifecycle

`BMEC_POSTGRES_URL` enables the `pg` pool. Startup verifies a connection and
applies safe additive application-schema changes transactionally before it
initializes authentication tables. Readiness probes the pool; graceful
shutdown calls `pool.end()`. The pool allows at most 10 connections, closes
idle connections after 10 seconds, and times out connection acquisition after
5 seconds. Configure PostgreSQL server-side limits to account for every BMEC
instance. See the [database production guide](DATABASE_PRODUCTION.md) for
migration, recovery, and verification boundaries.

For a reproducible local Linux container setup with PostgreSQL, see the
[deployment guide](DEPLOYMENT.md).
