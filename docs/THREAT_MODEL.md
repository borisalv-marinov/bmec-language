# BMEC Threat Model

**Status:** BMEC 0.9.1 beta threat model for the reference Node HTTP runtime and generated web applications. Assumptions must be revisited for a different adapter or deployment topology.

## Security objectives

Protect user credentials and sessions, enforce server-owned identities and roles, prevent cross-user/cross-tenant data access, preserve database integrity, keep private configuration out of browser artifacts and logs, and limit unauthenticated resource abuse. Keep failures bounded and understandable without revealing secrets or internal implementation details.

## Assets

- Password input during registration/login and persisted password hashes.
- Opaque session identifiers in cookies or bearer headers, and server-side session records.
- User identities, role attributes, workspace memberships, and application records.
- Database credentials, email/provider credentials, environment secrets, and capability tokens.
- Generated server code/IR, public browser bundle, and release metadata.
- Service availability, integrity of writes, audit/operational logs, backups, and migration state.

## Actors and assumptions

- **Unauthenticated remote caller:** can send arbitrary HTTP requests and attempt credential guessing, parser abuse, oversized requests, or resource exhaustion.
- **Authenticated low-privilege user:** can alter IDs, ownership fields, workspace selectors, query values, and role-like fields in every request.
- **Cross-site attacker:** can cause a victim browser to navigate to or submit requests to the application; may control another origin or a sibling subdomain.
- **Malicious or compromised dependency:** can execute within the application process if admitted to the dependency tree.
- **Deployment operator or trusted proxy:** controls TLS termination, database access, host configuration, and forwarding headers. These are trusted; a compromised operator/host is outside this model.

The model does not claim protection from XSS in application-authored/generated UI content, compromised browser extensions or endpoints, stolen user devices, denial of service above configured edge capacity, physical host access, compromised dependencies after installation, weak account recovery/MFA (not implemented here), or all timing/power side channels. Application developers remain responsible for row-level/tenant authorization and safe output handling.

## Entry points and abuse cases

| Entry point | Threat | Required control / verification |
| --- | --- | --- |
| Registration and login | Password guessing, account enumeration, malformed inputs, resource exhaustion from scrypt | Generic credential failure, input bounds, shared production rate limits, bounded concurrency, and negative integration tests |
| Session cookie or bearer header | Forgery, fixation, replay after logout/expiry, theft over plaintext transport | Unpredictable opaque ID, server-side expiry/revocation, rotation, TLS, Secure/HttpOnly/SameSite cookie attributes, and no token logging |
| State-changing HTTP routes | CSRF, missing or hostile Origin, simple form/multipart submission, state changes hidden behind GET | Production Origin policy, route-specific body type validation, BMEC source GET read-only guard for DB and external effects, tests for missing/foreign/null origins and attempted GET writes |
| User IDs, roles, owner/workspace fields | Privilege escalation or cross-tenant reads/writes | Resolve principal and roles server-side; authorize before mutation; scope DB operations; adversarial tests with forged values |
| HTTP body, headers, content type, path | Oversized input, ambiguous parsing, MIME confusion, parser/path abuse | Validated limits, route-appropriate content types, typed validation, fixed error output, encoded path handling, tests at and above boundaries |
| Public static files and generated browser code | Secret, source, or session data accidentally shipped; script injection | Explicit public-file allowlist, secret/source package checks, CSP and browser security headers, artifact inspection |
| Official website playground | Malicious source triggers expensive compiler or runner work, is accidentally uploaded, or reaches host authority | Full compiler check plus a bounded pure-function subset in a short-lived Worker; source, step, loop, depth, integer, text, list, and wall-clock limits; no files, databases, network, processes, environment, secrets, async calls, or capabilities; same-origin CSP; static metadata GETs only; browser test checks no write/source-bearing requests |
| Database and transaction boundary | Injection, partial writes, unsafe rollback, unauthorized migration | Bound SQL parameters, route authorization before mutation, transaction tests, constrained migration identity and tested recovery |
| Logs and diagnostics | Credential/session leakage or internal SQL/config disclosure | Log allowlist, generic external errors, secret-pattern checks, tests with sentinel credentials/tokens |
| Dependencies and startup config | Vulnerable package or unsafe/mistyped production settings | High-severity dependency audit, SBOM/package check, validated config, fail-closed production startup |

## Trust boundaries and data flow

1. The browser sends untrusted bytes and possibly a cookie/bearer token to the Node server or an operator-managed proxy.
2. The HTTP adapter establishes a request ID, applies transport checks and bounds, then passes a normalized request to `HttpRouter`.
3. The router evaluates the route policy before capability access and typed request validation. The policy resolves the presented token to a server-side session and principal.
4. Handlers use explicit capabilities and database adapters. Query values are bound; authorization scope must be represented in the selected operation.
5. The response encoder returns the route's declared shape or a generic failure. The logger receives a constrained event, not the body or credential headers.
6. Static browser assets are served from the configured public directory using an explicit filename allowlist.
7. The official website playground keeps source in its editor, posts it only to a same-origin short-lived worker, and returns diagnostics/IR/context. After a successful check, it can interpret only its documented synchronous pure-function subset; it cannot run an application or access host capabilities. It does not send code to a remote checker. The only playground network reads are the public checked-example and knowledge JSON files.

A TLS-terminating proxy is a separate trust boundary. Only explicitly configured canonical origins may be accepted from a separate UI. Forwarded host/protocol/client-IP headers are attacker-controlled unless the connection is known to come from the trusted proxy and the proxy overwrites those headers.

## Residual gaps and deployment limits

- Development mode intentionally uses process-local users, sessions, and rate limits; deployments must opt into production mode explicitly.
- Production requires an operator-managed HTTPS edge. BMEC does not terminate TLS, emit HSTS, or authenticate proxy forwarding headers.
- Origin validation is the browser CSRF strategy; there is no synchronizer-token mechanism. For an unsafe request without `Origin`, the Node adapter checks only that the bearer header has valid syntax; route authentication and authorization validate the token downstream. A syntactically valid header is not itself proof of identity.
- Rate limiting uses the socket peer. A shared reverse proxy causes all app requests to share the proxy's address bucket; enforce client-address limits at the edge. BMEC intentionally ignores forwarded IP headers.
- Local Windows tests use PostgreSQL 18.6 for session, user, rate-limit, and application workflows. Separate WSL2 Linux-container evidence covers a PostgreSQL-backed app's persistence, health/readiness, and graceful shutdown. These are local bounded checks, not a hosted production deployment or availability assessment.
- The default CSP is suitable for generated same-origin pages but must be reviewed against each application's assets and embed needs. Applications may configure a policy; no generic policy can account for every app.
- The official site's playground check and limited pure-function runner are browser-local and resource-bounded, but run within the visitor's browser origin. The runner accepts only its documented subset and does not provide application hosting or a general sandbox for third-party JavaScript or hostile compiler binaries. The playground's CSP is currently a page meta policy; static-host response headers and deployed behavior remain unverified until Phase 14.
- No external penetration test, DAST report, production edge/TLS deployment, or multi-browser cookie enforcement run is claimed.

These are deployment and validation limits, not controls that can be inferred from local tests. Reassess them for the actual host, proxy, database, and browser environment.

## Verification plan

- Verify anonymous and wrong-role requests cannot read or mutate protected records, including forged owner/role/workspace fields.
- Verify GET handlers cannot mutate database or filesystem state, send email, schedule or cancel tasks, or issue unsafe outgoing HTTP requests; read-only database, HTTP GET, and filesystem operations remain available.
- Verify durable session creation, expiry across instances, logout revocation, and login/session rotation. SQLite restart persistence is covered locally; live PostgreSQL cross-instance behavior remains unverified here.
- Verify cookie flags in production mode and that production mode refuses unsafe direct HTTP exposure or requires trusted TLS configuration.
- Verify hostile, opaque, absent, and explicitly allowed Origins for cookie-backed state changes; verify generated clients satisfy the accepted policy.
- Verify per-account/per-address login limits and shared-store behavior across two runtime instances; ensure 429 does not reveal account existence.
- Verify missing/unsupported content types, body/header boundaries, no default CORS, fixed security headers, and CSP behavior.
- Send sentinel passwords, cookies, bearer tokens, database URLs, and arbitrary handler errors through rejected/failing requests; prove responses/logs omit them.
- Run the dependency audit, release-package leakage gate, core security tests, and representative SQLite/PostgreSQL paths where configured.

## Residual risks after repository verification

Passing automated tests does not replace independent review, deployment-specific proxy/TLS validation, browser matrix testing, operational alerting, or penetration testing. Rate limits do not prevent volumetric denial of service; place public services behind an operator-controlled edge. CSP quality depends on application-generated markup and may require per-application policy. SQL safety depends on every adapter and application query honoring parameter and authorization contracts.
