# BMEC editor setup

BMEC provides a VS Code extension and a stdio language server. The extension
recognizes `.bmec` and `.pipe` files, applies BMEC bracket/comment behavior,
provides basic TextMate syntax coloring, and starts the compiler-backed server.
The server supplies diagnostics, hover, definitions, references, rename,
document/workspace symbols, formatting, quick fixes, and context-aware
completion.

## Fastest setup

1. Install Node.js 22 or newer.
2. Install the matching BMEC CLI by following the [installation guide](INSTALL.md).
3. Download and install the **BMEC VS Code extension** from the website's
   top navigation. In VS Code, open **Extensions**, choose **Install from VSIX**,
   and select the downloaded `.vsix` file.
4. Open a folder containing a `.bmec` file. The extension starts the local
   BMEC language server for you.
5. Run `bmec doctor` in the integrated terminal if diagnostics do not appear.

The website and playground do not need to be open for the extension to work.
The editor talks to the `bmec` executable installed on your computer; the
extension does not provide an online compiler.

## Run the repository extension in VS Code

From the BMEC repository:

1. Run `npm install` and `npm run build` at the repository root.
2. Run `npm link` at the repository root so the `bmec` command is available
   to the extension.
3. Run `npm ci --prefix vscode-extension` to install the extension client.
4. Open the extension development host with:

   ```sh
   code --extensionDevelopmentPath=./vscode-extension path/to/bmec-project
   ```

If the CLI is installed under a different name or location, set
`bmec.executable` in VS Code settings to that executable. On Windows this may
be the full path to `bmec.cmd`.

The same language server can be started by an editor configured for stdio with
the command `bmec lsp`. From the repository checkout, build first and use
`node dist/cli/index.js lsp` instead.

## If the extension cannot find BMEC

- Confirm the CLI is on your terminal's `PATH` with `bmec --version`.
- Run `bmec doctor` and follow the missing-tool or path message it reports.
- On Windows, set `bmec.executable` to the full path of `bmec.cmd` if VS Code
  does not inherit the same `PATH` as your terminal.
- Restart the BMEC language server from the VS Code command palette after
  changing the executable setting.
- Open the **Output** panel and select **BMEC Language Server** to see the
  extension's startup message.

If colors appear but diagnostics do not, syntax highlighting is working but
the language server is not connected. TextMate coloring is separate from the
compiler-backed editor features.

The extension is prepared for BMEC 0.9.1-beta.1 and uses the same `bmec`
CLI package version. Before Marketplace publication, install the reviewed
VSIX candidate supplied with the release set:

```sh
code --install-extension bmec-language-support-0.9.1-beta.1.vsix
```

The npm CLI package includes this guide but not the VSIX archive; use `bmec
lsp` from the installed package or use the repository checkout to install the
extension. Its grammar is lexical coloring only; BMEC semantics remain
provided by compiler diagnostics and language-server requests. There is no
debugger.
