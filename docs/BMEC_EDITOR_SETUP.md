# BMEC editor setup

BMEC provides a VS Code extension and a stdio language server. The extension
recognizes `.bmec` and `.pipe` files, applies BMEC bracket/comment behavior,
provides basic TextMate syntax coloring, and starts the compiler-backed server.
The server supplies diagnostics, hover, definitions, references, rename,
document/workspace symbols, formatting, quick fixes, and context-aware
completion.

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