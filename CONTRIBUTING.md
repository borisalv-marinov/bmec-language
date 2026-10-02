# Contributing to BMEC

Thanks for considering a contribution to BMEC. The project is an unpublished
0.9.1-beta.3 developer preview. Read the [README](README.md),
[capability limits](docs/CAPABILITIES.md), and [public roadmap](ROADMAP.md)
before proposing a larger change.

## Development setup

- Use Node.js 22, matching the repository CI workflow.
- Install locked dependencies with `npm ci`.
- Build with `npm run build` and run the suite with `npm test`.
- Run `npm run test:docs`, `npm run test:examples`, `npm run test:package`,
  `npm run test:website`, and `npm run test:security` when a change affects
  those areas. Focused scripts are listed in `package.json`.
- Do not repeatedly use hosted CI to discover failures that local gates can
  find. Hosted CI availability depends on repository account limits.

## Changes

- Preserve the source → parser → semantic analysis → validated typed IR → runtime/backend architecture.
- Treat `TypeRef` and canonical IDs as authoritative. Do not introduce `any` or let JavaScript behavior silently define BMEC semantics.
- Add or update tests and user-facing documentation for behavior changes.
- Keep generated evidence and measurements reproducible. Sanitize machine-specific paths, credentials, and customer data before committing.
- Keep performance claims tied to the workload and platform that produced them.
- Treat the compiler, validated typed IR, and the current canonical AI
  catalogs as authoritative. Update human and machine-facing guidance together
  when a language contract changes.
- Keep generated site output, private review archives, local AI trial material,
  database files, and credentials out of pull requests.

## Pull requests

Describe the behavior, rationale, commands and platform checked, and remaining
limits. Include evidence only when it can be redistributed safely. Remove
credentials, personal paths, customer data, private review archives, and
unreviewed benchmark output. Follow the [Code of Conduct](CODE_OF_CONDUCT.md)
and report suspected vulnerabilities through [SECURITY.md](SECURITY.md).
