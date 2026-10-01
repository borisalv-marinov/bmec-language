# Tidehouse

A photo-led BMEC UI example for a fictional guesthouse on São Miguel in the
Azores. It demonstrates the BMEC page and component model, responsive project
CSS, and locally bundled photo assets without adding a JavaScript front-end
framework.

## Run it

From the repository root:

```sh
npm run build
node dist/cli/index.js doctor examples/azores-retreat
node dist/cli/index.js run examples/azores-retreat/main.bmec
```

Open the local URL printed by the CLI. Choose **Rooms** or **Island** to try
the page navigation. The site is a visual example only: it does not offer live
availability, booking, payment, or a real guesthouse service.

## Prepare a browser release

From the repository root, check the source and build a browser release:

```sh
node dist/cli/index.js check examples/azores-retreat/main.bmec --json
node dist/cli/index.js doctor examples/azores-retreat
node dist/cli/index.js build examples/azores-retreat/main.bmec --release
node dist/cli/index.js doctor examples/azores-retreat/release
```

When hosting this static example, publish only `index.html`, `app.js`,
`pipe-release.json`, and the hashed files under `assets/`. Keep
`server-ir.json` private; it is included as a build-time artifact and is not a
public browser file. Configure the host to serve over HTTPS and to deny files
outside that explicit allowlist. The example itself still has no booking,
availability, or payment backend.

The photos in `assets/` were generated for this example and converted to
optimized JPEG files. The CSS uses the `[ui.assets]` manifest aliases, so the
images stay local and receive content-hashed URLs in browser releases.

## AI editing map

Use this file map when asking an AI to change the example:

- Text, button labels, component structure, and page order: `main.bmec`.
- Which photo appears in each image box: `bmec.toml`, under `[ui.assets]`.
  Replace or add a local image in `assets/`, then update its alias path.
- Exact sizes and positions: `styles/site.css`. Start with the documented
  `--tide-*` controls at the top of `:root` for content width and gutters,
  hero columns and gap, photo heights and crop position, corner shape, title
  size, and mobile spacing. Set values in `px` for exact measurements. Use
  the `data-bmec-page` and `data-bmec-component` rules below for a specific
  box, grid placement, or per-page adjustment.
- Mobile layout: the `@media (max-width: 720px)` rules at the end of the CSS.
  Tune mobile measurements there independently from desktop.

After changes, run `bmec doctor examples/azores-retreat` and
`bmec check examples/azores-retreat/main.bmec --json`, then inspect desktop
and mobile browser views. A source measurement alone does not confirm the
rendered pixel position.

Files:

- `main.bmec` — checked BMEC pages and components
- `styles/site.css` — project-owned responsive presentation
- `bmec.toml` — package entry, stylesheet, and asset allowlist
- `assets/` — original example photographs
