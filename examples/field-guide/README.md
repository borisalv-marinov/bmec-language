# Field Guide

A static, three-page BMEC content site demonstrating page navigation and the
release generator's responsive layout and keyboard-visible focus defaults.

From the repository root:

```sh
node dist/cli/index.js check examples/field-guide/main.bmec
node dist/cli/index.js build examples/field-guide/main.bmec --release
```

The release output is written to `examples/field-guide/release/`. It contains
the browser HTML, bundled JavaScript, a release manifest, and server IR. The
pages use same-document hash navigation, so the browser can open the static
HTML directly.

Scope: this is a static informational site. The release generator currently
supports authored app-level descriptions, absolute HTTP(S) canonical URLs, and
basic Open Graph title/description/URL tags in the generated static HTML. The
`.example` canonical host in the source is a reserved placeholder and must be
replaced with the deployed site URL. Per-page metadata, social-card images, and
independent screen-reader or human accessibility review remain unsupported or
unverified.
