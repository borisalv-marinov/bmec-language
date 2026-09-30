#!/usr/bin/env node
import {createConnection,ProposedFeatures,TextDocuments} from 'vscode-languageserver/node';
import {TextDocument} from 'vscode-languageserver-textdocument';
import {createLanguageService} from './service.js';
import {filePathFromDocumentUri} from './uri.js';
// Keep stdin flowing when the server is launched by an external client through
// a pipe. This is a no-op for already-flowing streams and is required by some
// Linux Node stream implementations before the JSON-RPC reader is attached.
process.stdin.resume();
const connection=createConnection(ProposedFeatures.all,process.stdin,process.stdout);const documents=new TextDocuments(TextDocument);const service=createLanguageService();
connection.onInitialize(()=>({capabilities:{textDocumentSync:1,hoverProvider:true,definitionProvider:true,referencesProvider:true,renameProvider:true,documentSymbolProvider:true,workspaceSymbolProvider:true,documentFormattingProvider:true,codeActionProvider:true,completionProvider:{triggerCharacters:[' ','<','@']}}}));
documents.onDidOpen(event=>{const document=event.document;const diagnostics=service.open({uri:document.uri,file:filePathFromDocumentUri(document.uri),text:document.getText()});connection.sendDiagnostics({uri:document.uri,diagnostics})});
documents.onDidChangeContent(event=>{const document=event.document;const diagnostics=service.update({uri:document.uri,file:filePathFromDocumentUri(document.uri),text:document.getText()});connection.sendDiagnostics({uri:document.uri,diagnostics})});
documents.onDidClose(event=>service.close(event.document.uri));
connection.onHover(params=>service.hover(params.textDocument.uri,params.position));
connection.onDefinition(params=>service.definition(params.textDocument.uri,params.position));
connection.onReferences(params=>service.references(params.textDocument.uri,params.position));
connection.onRenameRequest(params=>service.rename(params.textDocument.uri,params.position,params.newName));
connection.onDocumentSymbol(params=>service.symbols(params.textDocument.uri));
connection.onWorkspaceSymbol(params=>service.workspaceSymbols(params.query));
connection.onCompletion(params=>service.completion(params.textDocument.uri,params.position));
connection.onDocumentFormatting(params=>service.formatting(params.textDocument.uri));
connection.onCodeAction(params=>service.codeActions(params.textDocument.uri,params.context.diagnostics));
documents.listen(connection);connection.listen();
