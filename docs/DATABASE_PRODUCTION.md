# Database production guide

BMEC's reference runtime supports persistent SQLite and PostgreSQL model
schemas. This guide defines the migration, indexing, transaction, and recovery
boundaries that applications can rely on. Database credentials and backup
files belong to the host environment, never BMEC source or browser assets.

## Schema and migration behavior

On SQLite startup, BMEC applies safe additive model changes in a transaction
and records them in `_pipe_migrations`. On PostgreSQL startup, BMEC creates
model tables, additive fields, foreign keys, unique constraints, and declared
indexes in one transaction and records successful changes in
`_bmec_migrations` (`version`, `applied_at`, and a JSON change list). A failed
migration rolls back its DDL and does not add a successful history row.

Adding an optional field is safe. Adding a required field requires a scalar
default so existing rows can be populated. Field removal, type or nullability
changes, and other destructive schema edits stop startup with `PIPE-MIG-001`.
Plan those changes with a reviewed, data-preserving migration outside the
automatic path. BMEC does not create or drop a PostgreSQL database or schema;
the configured role must be able to create and alter tables, indexes, and the
migration ledger in its selected schema/search path.

Use a dedicated database or schema/search path for each application. The
ledger records successful changes; inspect it together with the live schema
when diagnosing a failed rollout. Because each migration is transactional,
repair the source or database permission issue and restart. If an operator
performs a manual repair, take a backup first and reconcile the model schema
with the database before restarting.

## Indexes

Declare composite indexes at source level:

```bmec
model Record { region text required name text required }
index record_region_name on Record by region, name
```

Every field must belong to the model. Index creation is additive. BMEC refuses
to reuse an existing index name with a different field order or uniqueness
definition. Give a changed index a new name, deploy it, verify the query plan,
then remove the obsolete index through reviewed host SQL during a maintenance
window. Current automatic migrations do not drop indexes.

## Transactions, bounded reads, and aggregates

Database transactions use one transaction boundary: SQLite starts with
`BEGIN IMMEDIATE`; PostgreSQL leases one pool connection. An exception or
early control-flow exit rolls back awaited database work. Returning an
ordinary `err(...)` is a normal return and commits unless the code explicitly
exits the transaction. Keep external side effects outside the transaction.

Use typed keyset pagination with an ordered unique field and a fixed limit.
The Data Explorer demonstrates equality filters combined with a keyset cursor,
50-row pages, and database-side `COUNT(*)` aggregates. Independent page
requests do not share a snapshot, and BMEC does not promise arbitrary offset or
composite cursor pagination. Run `npm run test:data-explorer-large` for the
SQLite plan and `node scripts/data-explorer-postgres-smoke.mjs` with a
disposable PostgreSQL service for the PostgreSQL plan. The script outputs the
selected indexes and measured fixture sizes; `examples/data-explorer/README.md`
describes the workload.

## Connection pool and shutdown

When `BMEC_POSTGRES_URL` is set, the reference runtime uses a PostgreSQL pool
with at most 10 connections, a 10-second idle timeout, and a 5-second
connection timeout. Set the PostgreSQL server's connection budget to include
every BMEC process and other clients; a pool is created per process. Readiness
checks the selected database. Graceful shutdown stops accepting requests,
drains active requests, and closes the pool.

## Backup and recovery

For SQLite, use the online backup API or stop the service before copying its
database file. Keep an encrypted copy outside the web root, check its integrity,
and retain a known-good copy before restore. Stop BMEC, preserve the current
database, restore the verified copy, and start the service. Confirm readiness
and application data before returning traffic. The restored schema must be
compatible with the deployed source or pass the safe additive migration checks.

For PostgreSQL, use the database operator's managed backup and point-in-time
recovery process. Test restore on an isolated target with the same BMEC source,
verify the migration ledger and application data, then switch traffic according
to the host's recovery procedure. BMEC does not perform PostgreSQL backup or
failover orchestration.

## Verification scope

The SQLite and PostgreSQL Data Explorer smoke gates verify bounded pages,
filters, aggregates, declared indexes, and query plans. PostgreSQL migration
integration tests require `BMEC_POSTGRES_URL`; they cover additive changes,
index creation, transaction rollback on unsafe changes, and persistence across
runtime restart. These local checks establish adapter behavior, not production
availability, failover, TLS, backup retention, or external security review.
