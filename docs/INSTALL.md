# Install BMEC 0.9.1 beta

Use Node.js 22 or newer. The beta package is a prerelease, published as `@b.marinov/bmec` with the `beta` tag. The executable is named `bmec`.

To install an exact downloaded archive from the BMEC website:

```sh
npm install -g PATH_TO_REVIEWED_ARCHIVE
bmec --version
bmec doctor
```

For a registry install, use the pinned beta version:

```sh
npm install -g @b.marinov/bmec@0.9.1-beta.1
bmec --version
bmec doctor
```

Pinning the prerelease avoids depending on a mutable `latest` tag. This beta does not represent a stable release.

## Create and check a project

```sh
bmec new hello
cd hello
bmec doctor
bmec check main.bmec
bmec run main.bmec
```

Open the local URL printed by `bmec run`. `bmec doctor` checks the project manifest, lockfile, configured entry, and local runtime prerequisites.

## Install from a source checkout

Contributors can build the CLI from source instead of using the package archive:

```sh
npm ci
npm run build
node dist/cli/index.js --version
```

## Editor support

An npm-installed CLI provides editor integration through `bmec lsp`. For the VS Code client and executable configuration, see [editor setup](BMEC_EDITOR_SETUP.md).

## Keep credentials out of source

Local development credentials and production database URLs belong in the host environment or secret store, never in BMEC source, browser-prefixed environment variables, or committed files. Production origin, cookie, and database requirements are documented in the [security model](SECURITY_MODEL.md) and [database guide](DATABASE_PRODUCTION.md).

## Next steps

Continue with the [15-step learning path](LEARNING_PATH.md), the shorter [first-app guide](GETTING_STARTED.md), or the [custom reading-queue lesson](CUSTOM_APP_READING_QUEUE.md). The exact archive is exercised by `npm run test:package`; that check installs a clean package and verifies its CLI, docs, examples, and application smoke workflow.
