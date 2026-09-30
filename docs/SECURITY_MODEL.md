# BMEC Security Model

**Status:** BMEC 0.9.1 beta implementation contract. This document describes the reference runtime and separates it from controls a deployment host must provide. It is not a security certification.

## Scope and trust boundaries

BMEC compiles source into project IR and generated application code. The compiler and CLI are development tools; they are not an isolation boundary for hostile source. A generated application may run through BMEC's Node reference runtime or through a host-provided runtime/adapter. The reference runtime owns HTTP routing, validation, authentication hooks, and capability dispatch. The deployment operator owns the public network edge, TLS termination, durable database operations, environment secrets, and any external identity or email service.

Trust boundaries are:

1. **Browser/client → HTTP edge:** all request fields, cookies, headers, body content, and client-side state are untrusted. Authorization is resolved on the server.
2. **HTTP adapter → BMEC router:** the adapter bounds request bodies, normalizes the request, applies Origin checks, and converts unexpected runtime failures to generic responses. The router matches routes, checks policies before capabilities and typed input validation, and invokes handlers.
3. **Application → database/capabilities:** SQL values are bound parameters through database adapters. File, email, environment, time, and database effects are issued through host capabilities; possession of client data does not grant a capability.
4. **Application process → host services:** the host controls process credentials, TLS/proxy configuration, environment variables, database credentials, logs, backups, and availability.
5. **Generated browser bundle → public network:** only public client code and explicitly public release metadata should be served. Private environment values, database credentials, password hashes, and server session state must remain server-side.

## Official website playground

The website playground compiles the full source language, then interprets only a documented subset of synchronous, pure functions in a short-lived Worker. It is not an application host or a general-purpose sandbox. Files, databases, network, processes, environment, secrets, asynchronous functions, and host capabilities are unavailable. The runner bounds source (50,000 characters), steps (20,000), loop iterations (1,000), call depth (32), integer range (signed 64-bit), text (50,000 characters per value), and list length (1,000 items); inputs allow at most 16 arguments, 5,000 JSON values, and 32 nested levels; outputs allow at most 5,000 values and 100,000 text characters total. The page terminates the Worker after two seconds. It fetches only the public checked-example catalog and knowledge index, keeps edited source in browser memory, and sends no source to a server or persistent storage. Its page policy allows same-origin scripts, worker, and connections only. These controls do not protect against a compromised browser/device or a malicious website release; production hosting headers and deployment behavior must be checked at launch.

## Authentication and authorization

The reference authentication service hashes passwords with Node's scrypt implementation and compares derived hashes with a timing-safe comparison. Unknown-user login attempts also perform a dummy scrypt derivation so that the ordinary response path does not directly reveal account existence by doing no password work. Session identifiers are generated from 32 random bytes. Persistent stores keep only a SHA-256 digest of the session identifier. Every lookup checks server-side expiry; logout revokes the identifier, and a successful login rotates a presented session identifier.

A valid session resolves a user record on the server. Route policies evaluate the resolved principal and its server-held attributes; request bodies, query parameters, and browser-supplied role claims do not establish identity or privilege. Applications must still scope database rows to the principal/workspace in their handlers or typed API predicates. Authentication alone does not imply tenant isolation.

The local development profile uses process-memory stores. Production mode uses SQLite-backed users and sessions for a single process, or PostgreSQL-backed stores shared across instances. The PostgreSQL tables use parameterized statements, hashed session identifiers, indexed expiry, and idempotent startup creation. A host may inject its own `UserStore` or `SessionRepository`. Production seeding inserts `BMEC_AUTH_USERS` only when a user ID is absent; it does not overwrite a persisted password or role. Logout and successful login rotation invalidate sessions across PostgreSQL-backed instances.

## Browser sessions and CSRF

The local development cookie is `pipe_session` with `HttpOnly`, `SameSite=Lax`, and `Path=/`. Production emits the host-only `__Host-pipe_session` cookie with `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`; no `Domain` attribute is set. Production requires `BMEC_SECURITY_MODE=production` and a configured canonical HTTPS origin allowlist. The reference listener is HTTP and must sit behind a correctly configured TLS edge.

The HTTP adapter rejects unsafe methods when a supplied `Origin` is malformed, opaque, or outside the request origin and configured allowlist. In production, an unsafe request without `Origin` is allowed past this transport check only when its `Authorization` header has the syntax `Bearer <non-whitespace-token>`. The adapter does not validate that token; route authentication and authorization happen downstream. An invalid bearer token does not fall back to a valid cookie. `BMEC_ALLOWED_ORIGINS` accepts canonical HTTP or HTTPS origins; production deployments should configure the exact public HTTPS origin and provide TLS at a trusted host edge. `SameSite=Lax` is defense in depth; the Origin policy is the browser CSRF control. There is no synchronizer-token flow. Do not trust arbitrary forwarded-host/proto headers when deriving the public origin.

Production rejects unsafe requests with a malformed, opaque, or untrusted
`Origin`. When `Origin` is missing, the transport gate accepts only a
syntactically valid bearer header; this exception does not authenticate the
caller. Protected routes must still validate the bearer session and apply
their route policy. Apps using a separate UI must configure its exact HTTPS
origin. Cryptographic tokens use Node's
cryptographic random generator and established constructions; BMEC does not
define a custom MAC or token scheme.

## Rate limits and abuse controls

The runtime applies a fixed-window limit of 120 requests per minute per socket peer, 10 login attempts per 15 minutes per peer and account, and 5 registrations per hour per peer. Development uses a bounded in-memory store. Production uses a persistent SQLite store for one process or a PostgreSQL store whose parameterized atomic upsert shares counters across instances. PostgreSQL keys are hashed; stale windows are cleaned periodically. Rejections return HTTP 429 with `Retry-After` and a generic body. Client identity is the socket peer; forwarding headers are ignored. Put public instances behind an edge that also limits true client addresses, especially when all traffic reaches BMEC through one proxy.

## HTTP input, errors, and response policy

The Node adapter defaults to a 1,000,000-byte body limit and a validated 16,384-byte header limit; the CLI can configure both. Production rejects non-empty bodies without JSON, `+json`, or multipart content types. Responses include `X-Content-Type-Options: nosniff`, a strict-origin referrer policy, frame denial, and a restrictive permissions policy. Production also uses a default CSP suitable for generated same-origin apps; `BMEC_CONTENT_SECURITY_POLICY` may replace it after application review. Unexpected application and adapter failures return generic errors rather than stack traces, SQL text, secrets, or raw exception messages.

For BMEC-compiled handlers, `GET` routes may perform read-only database, HTTP, and filesystem operations. The runtime rejects database writes (including writes inside transactions), filesystem writes, email sends, task scheduling or cancellation, and outgoing HTTP methods other than GET. Rejected effects return 405 before they change state. This prevents state changes through safe methods in the reference source runtime. Custom handlers registered by a host through `configureRouter` remain host code and must follow the same method semantics.

No permissive CORS response is added by default. HSTS belongs at the HTTPS edge after TLS and domain behavior are verified; the reference runtime cannot assert that TLS is active when it is behind a proxy.

## Secrets, logs, and storage

Secrets belong in server-side environment/configuration or a dedicated host secret store. They must be validated at startup, excluded from generated browser assets and release metadata, and redacted from logs and errors. Passwords, authorization headers, cookies, bearer tokens, and session IDs must never be logged. The HTTP logger callback receives only request ID, method, path, status, duration, and outcome; query strings, request bodies, and headers are omitted. Deployments should keep this low-data event shape.

Database adapters bind values as parameters. Authorization must be checked before mutation and tenant-scoped predicates must be included in the query. Multi-step writes must use transaction boundaries, and errors that require rollback must escape/return from the transaction in the documented form. Database credentials and migration authority remain host responsibilities. Backups, restore tests, and connection shutdown are operational controls.

## Deployment profiles

- **Local development:** loopback listener, process-memory users/sessions/limits, HTTP-compatible cookie mode. Suitable for local work and isolated tests only.
- **Single-process service:** `BMEC_SECURITY_MODE=production`, trusted TLS edge, exact allowed origins, persistent SQLite or PostgreSQL users/sessions/limits, startup configuration, and reviewed application CSP. The operator must secure the edge and secrets.
- **Multi-instance service:** PostgreSQL-backed session and rate-limit stores share state and enforce atomic limits across instances without a paid cache service. TLS, proxy identity, database pooling/migrations, backups, and graceful shutdown remain host responsibilities.

## Verification limits

Repository tests establish only their stated scope. Local Windows PostgreSQL
18.6 tests cover application database workflows; a separate WSL2 Linux
container check covers the reference deployment's PostgreSQL persistence,
health/readiness, and shutdown behavior. This is not a hosted production
deployment, TLS-edge assessment, availability test, or independent security
review. A successful dependency audit and local HTTP tests do not establish
resistance to all attacks. See [Threat Model](THREAT_MODEL.md) for attacker
and residual-risk assumptions.

## References

- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
- [OWASP HTTP Headers Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html)
