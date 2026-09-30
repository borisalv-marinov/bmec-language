# Security policy

BMEC 0.9.1-beta.1 is a developer beta. It is not security certified, and the
project has not had an independent penetration test. The
[security model](docs/SECURITY_MODEL.md) describes the reference runtime,
tested controls, and operator responsibilities.

## Reporting a vulnerability

Do not report vulnerabilities in a public issue or disclose them publicly
before maintainers can assess them. Use the repository's **Report a
vulnerability** link to open a private GitHub security advisory. Before the
public launch, the repository owner must confirm that private vulnerability
reporting is enabled. If GitHub does not provide that route, publication must
wait until the owner names an approved private contact; do not guess an email
address or send reports to an unrelated channel.

The maintainer should check GitHub's private vulnerability reports and
security notifications each working day, record receipt and affected
versions, and keep discussion in the private advisory. Triage impact and
reproduction before proposing a fix; coordinate any public disclosure only
after a fix or mitigation is available. No response-time guarantee or bug
bounty is offered. Include a minimal reproduction and remove real secrets,
customer data, and personal paths from the report.

## Scope and response

Reports about the compiler, CLI, reference runtime, native code generation,
generated applications, dependencies, or repository automation are in scope.
Maintainers will assess reports and coordinate disclosure after a fix or
mitigation is available. No response-time guarantee or bug bounty is offered.

The reference runtime has authentication and role checks, Origin validation,
request bounds, and rate limits. Production still requires a trusted TLS edge,
careful capability and authorization policy, host-managed secrets, and tested
database backups. A local test or dependency scan is not proof of production
security. Consult the security model for the exact boundary.
