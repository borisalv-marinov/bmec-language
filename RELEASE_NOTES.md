# BMEC 0.9.1 beta

`0.9.1-beta.3` is a prepared public website candidate for developer evaluation.
It continues the `0.9.1` beta line and keeps language compatibility `0.1` and
typed IR compatibility `2` unchanged. It does not add a language feature
program.

This candidate carries forward the current public `bmec-language` source,
including its browser-local compiler and bounded playground Worker, complete
graph identifiers, responsive site, and current learning and showcase pages.
It includes verified fixes for small-limit knowledge discovery, the
performance-gate input contract, development-authentication guidance, static
asset symlink handling, readiness rate limiting, and benchmark wording and
measurements. A local interpreter performance ranking is included with its
workload and machine scope stated on the site.

The matching package archive and VS Code extension are served as website
downloads. This candidate has not been published to npm or the VS Code
Marketplace. Install the package archive from the [BMEC downloads page](https://bmec-language.vercel.app/downloads/).

## Known boundaries

- Node.js 22 or newer is required for the CLI and reference runtime.
- The native backend supports a documented subset and needs a compatible C
  toolchain.
- The playground checks full BMEC source but runs only its documented bounded
  pure-function subset in a short-lived browser Worker.
- Human onboarding and actual screen-reader sessions remain unverified unless
  they occur; automated checks do not replace those sessions.
- This is a developer beta, not an independent external security audit or
  production certification.
