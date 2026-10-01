# Tidehouse example editing guide

This is a BMEC source example. Read `README.md` for the local run steps and
visual editing map before making changes. Use the repository's BMEC project
instructions and `bmec knowledge` to check supported language, CSS, and asset
behavior instead of guessing syntax.

## Edit the requested layer

- Change visible wording and BMEC page/component structure in `main.bmec`.
- Change the photo files assigned to `coast`, `room`, and `breakfast` in
  `bmec.toml`; keep image files local under `assets/`.
- Change exact visual measurements, box positions, typography, and photo crop
  in `styles/site.css`. Begin with the named `--tide-*` variables at the top
  of `:root`; use the `data-bmec-page` and `data-bmec-component` selectors for
  individual boxes. Use pixel values when the request names exact dimensions.
- Adjust the `@media (max-width: 720px)` declarations separately for mobile.

Do not edit generated runtime HTML, copied release assets, or content-hashed
URLs. After a visual change, run `bmec doctor examples/azores-retreat`,
`bmec check examples/azores-retreat/main.bmec --json`, and verify both desktop
and mobile renders before describing the result as pixel accurate. For a
browser-release check, build with `bmec build examples/azores-retreat/main.bmec
--release` and run `bmec doctor examples/azores-retreat/release`. If preparing
static hosting, expose only `index.html`, `app.js`, `pipe-release.json`, and
`assets/`; keep `server-ir.json` private.
