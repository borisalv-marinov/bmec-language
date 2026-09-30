# BMEC website

Build the static site with `npm run build:website`; output goes to the ignored
`website/dist/` directory. Run `npm run test:website` for browser, link,
responsive layout, and accessibility checks.

`index.html`, `styles.css`, and `app.js` are hand-maintained. The website
builder creates its status and discovery data from package metadata, compiler
output, checked-in catalogs, the repository URL, and an explicit public
document allowlist. It publishes the compiler AI contract, commands,
diagnostics, examples, public capability inventory, and curated showcase.
The generated coverage files come from `docs/capability-map.json`, canonical
compiler metadata, and compiler-checked example files.

The live playground uses BMEC's full source checker and bounded pure-function
runner, bundled into a short-lived browser worker. It returns real diagnostics
and typed IR, then can run only the documented subset of synchronous pure
functions. It does not run a complete app or provide host capabilities.
Source is held in page/worker memory only; the page reads
the public checked-example catalog and BMEC knowledge index, never transmits
the edited source, and caps input at 50,000 characters with a 2-second worker
timeout. The playground route applies a same-origin Content Security Policy.
The website build rejects host filesystem/process imports and explicit worker
network clients. `npm run test:website` checks the real browser behavior, CSP,
no-write network boundary, desktop/tablet/mobile layouts, and axe results.

The shared static route shell is generated for the docs, learn, playground,
examples, showcase, AI, benchmarks, architecture, security, deploy, roadmap,
support, and contact routes. Route copy lives in website/pages/; the required
routes are checked by `npm run test:website`. The playground runs supported
pure functions only and does not build or host an application in the browser.

The builder excludes execution state, internal plans, scratch material, and
historical QA documents. It copies only the screenshot paths explicitly
mapped for the public showcase; other evidence remains private.

The site has not been deployed. The package remains a developer preview, the
VS Code extension is not published to a Marketplace, and the showcase is a
bounded demo catalog rather than a commercial product claim.
Showcase previews use actual screenshots captured from the running apps.

## Production release build

The production project is Vercel `bm-s/bmec-language`. The static build publishes only `website/dist/`; set `BMEC_SITE_BASE_URL`, `BMEC_PACKAGE_ARCHIVE`, and `BMEC_VSIX_ARCHIVE` to the reviewed production origin and immutable release files before building. Set `BMEC_REPOSITORY_URL` to the approved public GitHub repository. Keep these file paths and local Vercel credentials out of Git.

For the review build, leave `BMEC_ALLOW_INDEXING` unset so `robots.txt` disallows indexing. After launch authorization and confirmation of the production origin, set `BMEC_ALLOW_INDEXING=1` and prepare a Vercel Build Output API bundle. Inspect `.vercel/output/static/` against the release manifest before `vercel deploy --prebuilt --prod`. The website must use the locally reviewed package archive and VSIX bytes.

Recovery: keep the last approved `.vercel/output` bundle and its SHA-256 manifest in private release storage. On a failed deployment, stop and keep the prior production domain attached to its existing deployment. Inspect the deployment state before retrying; deploy the preserved bundle only after confirming it is the approved version. Do not overwrite the preserved candidate when rebuilding.
