# BMEC architecture

BMEC is a typed language, compiler, command-line tool, and reference runtime
for small full-stack applications. The current package is 0.9.1-beta.3; its
language contract is version 0.1.

## Compiler and runtime

```text
.bmec source → lexer/parser → semantic checks → validated typed IR
                                                  ├─ reference runtime
                                                  └─ supported native C backend
```

The compiler owns parsing, type checking, diagnostics, capability metadata,
and the typed intermediate representation. The reference runtime defines
language behavior. The native backend lowers a documented subset to C; it
does not change the language contract. Unsupported native operations fail
explicitly.

## Application boundary

Models, route contracts, pages, components, and styles are declared in BMEC
source and checked together. The Node reference runtime supplies HTTP,
authentication hooks, SQLite, and optional PostgreSQL adapters. Database,
filesystem, environment, time, randomness, and network effects require explicit
capabilities. Authentication policies are enforced on the server; hiding a
browser control is not access control.

Production networking, TLS termination, identity providers, secrets, backup
retention, and availability remain host responsibilities. See the
[security model](docs/SECURITY_MODEL.md), [database guide](docs/DATABASE_PRODUCTION.md),
and [deployment guide](docs/DEPLOYMENT.md).

## Tooling and AI context

The `bmec` CLI wraps compiler-owned checks, formatting, project inspection,
and metadata commands. The language server reuses compiler diagnostics. The
`ai/` catalogs expose the language contract, diagnostics, examples, commands,
and task knowledge from canonical project metadata; they do not replace the
compiler or guarantee that AI-generated programs are correct.

The static website is built from checked-in source, compiler metadata, and
verified examples. The playground runs the shared checker in a browser worker;
after a successful full-source check, it can run only its documented bounded
subset of synchronous pure functions. It does not run a complete application
or provide host capabilities.

## Support boundary

BMEC is an unpublished developer preview. The CLI/reference runtime target
Node.js 22 or newer. Native support is a subset that depends on a compatible C
toolchain. Read [capabilities and limitations](docs/CAPABILITIES.md) before
choosing a feature or backend.
