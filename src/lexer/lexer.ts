export type TokenKind = 'word'|'string'|'number'|'{'|'}'|'('|')'|'['|']'|','|':'|'='|'operator'|'/'|'.'|'?'|'comment'|'eof';
export interface Position { file:string; line:number; column:number; offset:number }
export interface Span { start:Position; end:Position }
export interface Token { kind:TokenKind; value:string; span:Span }

export function lex(source:string, file='<input>', includeTrivia=false): Token[] {
  const out:Token[]=[]; let i=0, line=1, column=1;
  const pos=():Position=>({file,line,column,offset:i});
  const advance=(s:string)=>{ for(const c of s){ if(c==='\n'){line++; column=1}else column++ } i+=s.length };
  while(i<source.length){
    const c=source[i];
    if(/\s/.test(c)){ advance(c); continue }
    if(c==='#'){ const start=pos(); let value=''; while(i<source.length && source[i]!=='\n'){value+=source[i];advance(source[i])} if(includeTrivia)out.push({kind:'comment',value,span:{start,end:pos()}}); continue }
    if(c==='/' && source[i+1]==='/'){ const start=pos(); let value=''; while(i<source.length && source[i]!=='\n'){value+=source[i];advance(source[i])} if(includeTrivia)out.push({kind:'comment',value,span:{start,end:pos()}}); continue }
    const start=pos();
    if(c==='{'||c==='}'||c==='('||c===')'||c==='['||c===']'||c===','||c===':'||c==='.'||c==='?'){ advance(c); out.push({kind:c,value:c,span:{start,end:pos()}}); continue }
    const op=source.slice(i).match(/^(?:=>|->|==|!=|<=|>=|[=+*\-<>/%])/);
    if(op){ advance(op[0]); out.push({kind:'operator',value:op[0],span:{start,end:pos()}}); continue }
    if(c==='"'||c==="'"){ const quote=c; advance(c); let value=''; while(i<source.length && source[i]!==quote){ if(source[i]==='\\' && i+1<source.length){ const n=source[i+1]; value += n==='n'?'\n':n; advance(source.slice(i,i+2)) } else { value+=source[i]; advance(source[i]) } } if(i>=source.length) throw new PipeLexError('PIPE-SYN-001','Unterminated string',start); advance(quote); out.push({kind:'string',value,span:{start,end:pos()}}); continue }
    const m=source.slice(i).match(/^(?:\d+\.\d+|\d+)/); if(m){ advance(m[0]); out.push({kind:'number',value:m[0],span:{start,end:pos()}}); continue }
    const w=source.slice(i).match(/^[A-Za-z_][A-Za-z0-9_-]*/); if(w){ advance(w[0]); out.push({kind:'word',value:w[0],span:{start,end:pos()}}); continue }
    throw new PipeLexError('PIPE-SYN-002',`Unexpected character ${JSON.stringify(c)}`,start);
  }
  const p=pos(); out.push({kind:'eof',value:'',span:{start:p,end:p}}); return out;
}
export class PipeLexError extends Error { constructor(public code:string,message:string,public position:Position){super(message)} }
