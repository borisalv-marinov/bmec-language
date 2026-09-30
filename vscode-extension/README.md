# BMEC Language Support

The BMEC VS Code extension associates `.bmec` and `.pipe` files with BMEC,
provides basic syntax coloring and bracket behavior, and starts the BMEC stdio
language server for compiler diagnostics and editor features.

Install the BMEC CLI separately and make the `bmec` command available on
`PATH`, or set the `bmec.executable` VS Code setting to its full executable
path. On Windows, use the path to `bmec.cmd` when the CLI was installed through
npm.

The language server runs locally and uses the BMEC compiler. The extension
does not bundle the compiler or include a debugger.

If VS Code opens an untrusted workspace in Restricted Mode, the extension
stays disabled until you explicitly trust that workspace. Review the folder
before granting trust.

Install the CLI with `npm install -g @b.marinov/bmec@0.9.1-beta.1`. This extension's
version tracks the matching BMEC beta; its language contract remains version
0.1. Download the matching `.vsix` from the BMEC website. In VS Code, open
**Extensions**, choose **Install from VSIX**, and select the file. Updates use
the same procedure. The extension is distributed only through the website.

Licensed under the MIT License. See [LICENSE](LICENSE).

Third-party package attributions and license texts are collected in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
