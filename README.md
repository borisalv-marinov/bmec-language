<div align="center">

# BMEC

### One language. Real applications.

**Typed data, server routes, database work, and browser UI in one checked source project.**

[![npm beta](https://img.shields.io/badge/npm-0.9.1--beta.1-18181b?logo=npm)](https://www.npmjs.com/package/@b.marinov/bmec)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-18181b?logo=nodedotjs)](docs/INSTALL.md)
[![License](https://img.shields.io/badge/license-Apache--2.0-18181b)](LICENSE)

[**Try it in your browser**](https://bmec-language.vercel.app/playground/) · [**Build your first app**](https://bmec-language.vercel.app/learn/) · [**Website**](https://bmec-language.vercel.app/) · [**Download VS Code extension**](https://bmec-language.vercel.app/downloads/bmec-language-support-0.9.1-beta.1.vsix)

</div>

BMEC is a statically typed programming language and compiler for full-stack applications. Define your application's records, behavior, routes, and interface together. The compiler resolves names, checks types and capabilities, and produces typed intermediate representation for its supported runtimes and backends.

```bmec
app HelloWorld

function greeting() -> text {
  return "Hello, world!"
}
```

Start with a function in the [playground](https://bmec-language.vercel.app/playground/), then build a [private reading queue](docs/CUSTOM_APP_READING_QUEUE.md) with data, routes, and a custom interface. You design the application; BMEC supplies the language and tools.

## What you can build with

| Part of your app | BMEC provides |
| --- | --- |
| Data and behavior | Typed models, functions, records, enums, results, and collections |
| Server | Declared HTTP routes, authentication policies, and explicit host capabilities |
| Database | SQLite and PostgreSQL adapters, declared indexes, and documented migration workflows |
| Interface | Pages, components, forms, lists, and responsive styles |
| Editor | Compiler diagnostics, completion, navigation, formatting, and more through the local language server |
| AI workflow | Compiler-backed syntax, constraints, examples, and diagnostics through `bmec knowledge` |

**Developer beta:** package `0.9.1-beta.1`, language contract `0.1`, typed IR `2`. Support varies by target. See [capabilities](docs/CAPABILITIES.md), [coverage](docs/CAPABILITY_COVERAGE.md), and [security boundaries](docs/SECURITY_MODEL.md) before choosing a runtime.

## Install and start

Use Node.js 22 or newer and install the pinned beta from [npm](https://www.npmjs.com/package/@b.marinov/bmec):

```sh
npm install -g @b.marinov/bmec@0.9.1-beta.1
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

## Work in VS Code

1. Install the CLI above and make `bmec` available on `PATH`.
2. [Download the matching VSIX](https://bmec-language.vercel.app/downloads/bmec-language-support-0.9.1-beta.1.vsix).
3. In VS Code, open **Extensions → Install from VSIX** and select the file.
4. Open a `.bmec` file to connect to the local language server.

If needed, set `bmec.executable` to the CLI's full path; on Windows, use `bmec.cmd`. The extension is distributed through the website. See [editor setup](docs/BMEC_EDITOR_SETUP.md) and the [extension guide](vscode-extension/README.md).

## Give your AI assistant compiler facts

```sh
bmec knowledge "authenticated custom route" --json
bmec check main.bmec --json
```

The first command retrieves task-focused language context. The second checks the result against the compiler. Start with the [AI agent guide](docs/AI_AGENT_GUIDE.md) and [machine-readable entry point](https://bmec-language.vercel.app/ai/).

## Try it without installing

The [browser playground](https://bmec-language.vercel.app/playground/) checks BMEC source and runs a bounded, synchronous pure-function subset in a disposable local worker. Source stays on your device. Filesystem, network, database, process, and environment capabilities require your local project; the browser does not execute the full language.

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

If BMEC is useful to you, star the repository or share the [playground](https://bmec-language.vercel.app/playground/). [Report a bug](https://github.com/borisalv-marinov/bmec-language/issues/new/choose) with a small reproduction, or read [Contributing](CONTRIBUTING.md) to help improve it.
