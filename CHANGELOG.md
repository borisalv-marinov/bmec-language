# Changelog

This file records notable user-facing changes. Package and language versions
are separate. Beta entries are prereleases and do not imply registry
publication.

## 0.9.1-beta.1 — prepared beta candidate

- Carries forward the frozen BMEC 0.8 product source with language 0.1 and IR
  2 compatibility unchanged.
- Prepares clean installation, VS Code distribution, custom-app learning,
  compiler-backed AI discovery, and the product website.
- Adds no language features. Publication awaits owner review.
- The browser playground can run a documented, resource-bounded subset of
  synchronous pure functions after checking the complete source; it is not a
  general BMEC runtime or application host.

## 0.9.1-beta.1 — private preview, unpublished

- Added an install-to-deployment learning path with compiler-checked BMEC
  examples and exact-package onboarding checks.
- Added a browser-local playground for compiler diagnostics, typed IR, AI
  context, and a resource-bounded subset of synchronous pure functions.
- Added the responsive BMEC website source, documentation routes, checked
  example catalog, security guidance, and local browser checks. The website
  has not been deployed.
- Added production database migrations, pooling, recovery guidance, and a
  local Linux container reference. This does not claim an external production
  deployment or independent security review.
- The release candidate remains a developer preview; see the capability
  guide for supported features and limitations.

## 0.7 — engineering milestone, unreleased

- Added cold-start AI trials against equivalent TypeScript and Python tasks and recorded original failures separately from maintainer follow-up fixes.
- Improved SQLite-backed role handling, principal context, owner-scoped writes, enum validation/persistence, model references, and server timestamp capabilities based on application trials.
- Aligned malformed UTF-8 file reads across the reference and native runtimes.
- Aligned native JSON decoding errors with current reference behavior for scalar, optional-scalar, and primitive integer-list cases.
- Added Windows package-install, documentation, editor/LSP, security, fuzz, and full-matrix QA records.
- Recorded remaining platform, human study, UI/data binding, storefront, editor, and deployment-security limitations in the 0.7 reports.

No package, extension, or website publication is associated with this entry.
