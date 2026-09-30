const vscode = require('vscode');
const {LanguageClient, TransportKind} = require('vscode-languageclient/node');

let client;
function activate(context) {
  const executable = vscode.workspace.getConfiguration('bmec').get('executable', 'bmec');
  const windowsScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
  const serverOptions = windowsScript
    ? {command: 'cmd.exe', args: ['/d', '/s', '/c', `""${executable}" lsp"`], options: {windowsVerbatimArguments: true}, transport: TransportKind.stdio}
    : {command: executable, args: ['lsp'], options: {shell: process.platform === 'win32'}, transport: TransportKind.stdio};
  const clientOptions = {documentSelector: [{scheme: 'file', language: 'bmec'}], synchronize: {fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{bmec,pipe}')}};
  client = new LanguageClient('bmec', 'BMEC Language Server', serverOptions, clientOptions);
  context.subscriptions.push(client.start());
}
function deactivate() { return client?.stop(); }
module.exports = {activate, deactivate};
