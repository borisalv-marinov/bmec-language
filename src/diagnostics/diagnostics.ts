import type { Span } from '../lexer/lexer.js';
export type Severity='error'|'warning';
export interface Diagnostic {
 code:string; severity:Severity; message:string; file:string; line:number; column:number; span:Span;
 node?:string; path?:string; kind?:string; received?:string; expected?:string; actual?:string;
 suggestions?:string[]; repair?:{type:string;value:string}; related?:{message:string;span:Span}[]
}
export function diagnostic(code:string,message:string,span:Span,extra:Partial<Diagnostic>={}):Diagnostic{return {code,severity:'error',message,file:span.start.file,line:span.start.line,column:span.start.column,span,...extra}}
export function formatDiagnostics(ds:Diagnostic[],json=false){return json?JSON.stringify({schemaVersion:'bmec.diagnostics.v1',languageVersion:'0.1',ok:false,diagnostics:ds},null,2):ds.map(d=>{const detail=d.expected&&d.actual?`\n  Expected: ${d.expected}\n  Actual: ${d.actual}`:'';const hint=d.suggestions?.length?`\n  Hint: ${d.suggestions.join(' ')}`:'';return `${d.code}: ${d.message}\n  ${d.file}:${d.line}:${d.column}${d.path?`\n  Path: ${d.path}`:''}${detail}${hint}`}).join('\n')}
