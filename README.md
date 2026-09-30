# BMEC

BMEC is a statically typed programming language and compiler for building full-stack applications. One checked source project can define application data, server routes, database work, and user interfaces. You create your own application; BMEC supplies the language, compiler, runtime, and tools.

**BMEC 0.9.1 beta** is a prerelease for developer evaluation. It uses product version `0.9.1-beta.1`, language contract `0.1`, and typed IR contract `2`. Targets and runtime operations have documented support boundaries; start with [capabilities](docs/CAPABILITIES.md), [capability coverage](docs/CAPABILITY_COVERAGE.md), and the [security model](docs/SECURITY_MODEL.md).

## Install and start

Use Node.js 22 or newer. Before the reviewed beta is published, install the candidate archive supplied with the release set or build from a source checkout. Once published, install the version-pinned beta:

```sh
npm install -g bmec@0.9.1-beta.1
bmec doctor
bmec new my-app
cd my-app
bmec check main.bmec
bmec run main.bmec
```

For archive and source installation, see [Installation](docs/INSTALL.md). Follow [Getting started](docs/GETTING_STARTED.md) and the [learning path](docs/LEARNING_PATH.md) for your first project.

## Learn and build

- [Language basics](docs/LANGUAGE_BASICS.md), [full-stack guide](docs/FULL_STACK_GUIDE.md), and [custom reading-queue lesson](docs/CUSTOM_APP_READING_QUEUE.md)
- [Checked reading-queue source](examples/reading-queue/main.bmec) and the [example catalog](ai/examples.json)
- [Styling guide](docs/STYLING_GUIDE.md), [standard library](docs/STANDARD_LIBRARY.md), and [CLI reference](docs/CLI_REFERENCE.md)
- [AI agent guide](docs/AI_AGENT_GUIDE.md), [`llms.txt`](llms.txt), and compiler-backed `bmec knowledge`, `bmec ai-spec`, `bmec stdlib`, `bmec capabilities`, and `bmec examples` commands
- [Capability coverage](docs/CAPABILITY_COVERAGE.md) maps compiler constructs, library functions, and host capabilities to their guides and checked examples

## Editor

Install the CLI and make `bmec` available on `PATH`, or set `bmec.executable` in VS Code. On Windows, use the path to `bmec.cmd`. Download the matching extension from the BMEC website, then choose **Extensions → Install from VSIX** in VS Code. See [editor setup](docs/BMEC_EDITOR_SETUP.md) and the [extension guide](vscode-extension/README.md).

## Documentation

- [Installation](docs/INSTALL.md), [VS Code editor setup](docs/BMEC_EDITOR_SETUP.md), and [language-server completion](docs/language-completion.md)
- [AI agent guide](docs/AI_AGENT_GUIDE.md) and [website machine index](docs/AI_WEBSITE.md)
- [Capabilities and limitations](docs/CAPABILITIES.md) and [native compilation boundary](docs/NATIVE_BACKEND_COVERAGE.md)
- [Generated CLI reference](docs/CLI_REFERENCE.md), [standard library](docs/STANDARD_LIBRARY.md), and [capability coverage](docs/CAPABILITY_COVERAGE.md)
- [Database production guidance](docs/DATABASE_PRODUCTION.md), [deployment](docs/DEPLOYMENT.md), [security model](docs/SECURITY_MODEL.md), and [threat model](docs/THREAT_MODEL.md)
- [Showcase guidance](docs/SHOWCASE.md)
## Operations and security

SQLite is the local database path. PostgreSQL adapters and operational guidance are available, but independently hosted deployments remain the operator's responsibility. Read [database operations](docs/DATABASE_PRODUCTION.md), [deployment](docs/DEPLOYMENT.md), [security boundaries](docs/SECURITY_MODEL.md), and the [threat model](docs/THREAT_MODEL.md). macOS and independent production hosting are not validated for this beta. No external security audit or production certification is claimed.

BMEC was created and is led by Borislav Marinov, with extensive AI-assisted software engineering. AI-generated application code still needs developer review. Route authentication does not automatically scope database rows; the developer defines ownership and authorization predicates.

## License and reporting

BMEC is distributed under the [Apache License 2.0](LICENSE). Third-party attributions and the Boost Software License notice are in [NOTICE](NOTICE). Report security issues privately using the repository's reporting feature; see [SECURITY.md](SECURITY.md). Public issue reporting and support details are in [SUPPORT.md](SUPPORT.md).

The [changelog](CHANGELOG.md) and [0.9.1 beta notes](RELEASE_NOTES.md) describe the current release scope.
