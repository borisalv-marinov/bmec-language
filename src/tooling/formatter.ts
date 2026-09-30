import {readFileSync} from 'node:fs';
import {lex} from '../lexer/lexer.js';

/** Deterministic token formatter. Comments are lexed as trivia and emitted in
 * their original order so formatting does not silently erase source context. */
export function formatSource(source:string):string {
  source=source.replace(/\b(let|var)\s+([A-Za-z_]\w*)\s+(?![A-Z][A-Za-z0-9_]*\b|(?:text|number|integer|boolean|money|date|datetime|id|list|result)\b)([A-Za-z_]\w*)\s+(?:is|be)(?=\s)/g,'$1 $2_$3 = ');
  const tokens=lex(source,'<format>',true).filter(t=>t.kind!=='eof');
  const genericTypeBrackets=new Set<number>();
  const genericTypeNames=new Set(['list','result','task','capability','secret']);
  for(let index=1;index<tokens.length;index++){
    if(tokens[index]?.value!=='<'||tokens[index-1]?.kind!=='word'||!genericTypeNames.has(tokens[index-1]!.value))continue;
    let depth=0;
    for(let close=index;close<tokens.length;close++){
      const value=tokens[close]!.value;
      if(value==='<')depth++;
      else if(value==='>'&&--depth===0){genericTypeBrackets.add(index);genericTypeBrackets.add(close);break;}
      if(['{','}',';'].includes(value))break;
    }
  }
  const declarationStarts=new Set(['import','component','app','model','type','enum','interface','impl','page','api','serve','async','function','http','style','test']);
  const statementStarts=new Set(['state','event','input','use','crud','text','show','return','let','if','for','while','repeat','assert','expect']);
  let out='',indent=0,lineStart=true;
  const newline=()=>{out=out.trimEnd()+'\n';lineStart=true};
  const write=(value:string)=>{if(lineStart){out+='  '.repeat(indent);lineStart=false}out+=value};
  for(let index=0;index<tokens.length;index++){const token=tokens[index]!,previous=tokens[index-1],next=tokens[index+1];
    if(token.kind==='comment'){if(!lineStart)newline();write(token.value.trimEnd());newline();continue}
    const value=token.kind==='string'?JSON.stringify(token.value):token.value;
    const previousValue=previous?.value;
    const sourceLineBreak=Boolean(previous&&token.span.start.line>previous.span.end.line);
    if(token.kind==='word'&&indent===0&&declarationStarts.has(value)&&value!=='function'&&previousValue!=='async'&&!lineStart)newline();
    else if(token.kind==='word'&&indent>0&&statementStarts.has(value)&&sourceLineBreak&&!lineStart)newline();
    if(token.kind==='{'){if(!lineStart&&previousValue!=='(')write(' ');write('{');indent++;newline();continue}
    if(token.kind==='}'){
      if(!lineStart)newline();indent=Math.max(0,indent-1);write('}');
      if(next?.value!=='from'&&next?.value!=='else'&&next?.kind!==',')newline();
      continue;
    }
    const tight=token.kind===')'||token.kind===']'||token.kind===','||token.kind==='.'||token.kind==='?'||genericTypeBrackets.has(index)||(token.kind==='('&&!['if','for','while','repeat'].includes(previousValue??''))||previous?.kind==='('||previous?.kind==='['||previous?.kind==='.'||(genericTypeBrackets.has(index-1)&&previous?.value==='<');
    if(!lineStart&&!tight&&previous?.kind!==':'&&previous?.kind!=='?')out+=' ';
    write(value);
  }
  return out.trimEnd()+'\n';
}

export function formatFile(file:string):string{return formatSource(readFileSync(file,'utf8'));}
