# BMEC editor and completion support

BMEC provides a stdio language server used by the official VS Code extension.
It checks open source with the same compiler contracts as the command-line
tool and returns source diagnostics with editor ranges and repair information.

The stdio language server advertises synchronization, hover, definition, references, rename, document symbols, workspace symbols, document formatting, code actions, and completion.

Completion suggestions come from BMEC declarations and the compiler's current
language vocabulary. The advertised trigger characters are space, `<`, or `@`:
they help the editor request suggestions while writing controlled BMEC syntax,
generic types, and annotations. A trigger only requests completion; it does not
make unsupported syntax valid.

The VS Code extension supports `.bmec` and `.pipe` files. It starts the local
language-server bundle packaged in the extension. To use a separate CLI
installation, set `bmec.executable` to its executable path; on Windows, use the
`bmec.cmd` shim. See [editor setup](BMEC_EDITOR_SETUP.md) for installation and
configuration.

Formatting uses the BMEC formatter. Code actions are limited to compiler
repairs whose replacement is unambiguous. Diagnostics remain authoritative:
the extension does not execute programs or add host capabilities.
