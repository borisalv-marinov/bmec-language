# BMEC 0.9.1 beta

`0.9.1-beta.1` is a prepared prerelease candidate for public developer
evaluation. It carries forward the frozen BMEC 0.8 product source at
`6176f33254f2c978c691566ddb6696234e5bc3b1`; this release-preparation pass
does not change the language (0.1) or typed IR (2) compatibility versions.

The release work focuses on clean installation, an official VS Code
extension, a clearer product website and custom-app learning path, accurate
security and AI guidance, and fresh Windows/Linux validation. It does not add
language features or claim universal target parity.

The VS Code extension is distributed only through the website as a downloadable
VSIX. Install it using **Extensions → Install from VSIX**. The release manifest
records the exact downloadable artifact hashes. Public launch status is verified
separately for GitHub, npm, and the production website.

## Known boundaries

- Node.js 22 or newer is required for the CLI and reference runtime.
- The native backend supports a documented subset and needs a compatible C
  toolchain.
- Windows and Linux checks are recorded against the exact candidate; macOS
  remains unvalidated without an available environment.
- No independent external security audit or production certification is
  claimed.
