import type {CallExpression, Expression, FunctionDeclaration, Program, Statement} from '../ast/ast.js';
import {parse} from './parser.js';
import type {PredicateExpression} from '../db/predicate-expression.js';

type SourcePredicate=PredicateExpression<string>;
function parseMixedDatabasePredicate(source:string,operatorForPhrase:Record<string,string>):SourcePredicate|undefined {
 const lexical=/\s*(\(|\)|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|[A-Za-z_]\w*)/y,tokens:string[]=[];let offset=0;
 while(offset<source.length){lexical.lastIndex=offset;const match=lexical.exec(source);if(!match)return undefined;tokens.push(match[1]!);offset=lexical.lastIndex;}
 let index=0;const peek=()=>tokens[index],take=()=>tokens[index++];
 const atom=():SourcePredicate=>{
  const field=take();if(!field||! /^[A-Za-z_]\w*$/.test(field))throw new Error('Expected field');
  const first=take();let operator:string,value:string;
  if(first==='contains'){operator='contains';value=take()??'';}
  else if(first==='is'){
   const phrase=[peek(),tokens[index+1]].join(' ');
   if(operatorForPhrase[phrase]){take();take();operator=operatorForPhrase[phrase]!;}
   else{const simple=peek();operator=simple==='not'?'!=':'=';if(simple==='not')take();}
   value=take()??'';
  }else throw new Error('Expected contains or is');
  if(!value||value==='('||value===')')throw new Error('Expected value');
  return {kind:'compare',field,operator:operator as Extract<SourcePredicate,{kind:'compare'}>['operator'],value};
 };
 let depth=0;
 const primary=():SourcePredicate=>{if(peek()==='('){take();if(++depth>64)throw new Error('Too deeply nested');const nested=or();if(take()!==')')throw new Error('Missing closing parenthesis');depth--;return nested;}return atom();};
 const and=():SourcePredicate=>{const items=[primary()];while(peek()==='and'){take();items.push(primary());}return items.length===1?items[0]!: {kind:'and',items};};
 const or=():SourcePredicate=>{const items=[and()];while(peek()==='or'){take();items.push(and());}return items.length===1?items[0]!: {kind:'or',items};};
 try{const expression=or();if(index!==tokens.length)return undefined;return expression;}catch{return undefined;}
}

function rewriteCompoundDatabaseReads(source:string):string {
 const operatorForPhrase:Record<string,string>={'at least':'>=','at most':'<=','greater than':'>','less than':'<','equal to':'=','not':'!='};
 const value='"(?:[^"\\\\]|\\\\.)*"|true|false|-?\\d+(?:\\.\\d+)?|[A-Za-z_]\\w*';
 const predicate=new RegExp(`([A-Za-z_]\\w*)\\s+(contains\\s+(${value})|is(?:\\s+(at least|at most|greater than|less than|equal to|not))?\\s+(${value}))`,'y');
 const connector=/\s+(and|or)\s+/y;
 const read=/\bawait\s+get\s+[A-Za-z_]\w*\s+from\s+([A-Za-z_]\w*)\s+where\s+([^\r\n{}]+?)\s+ordered\s+by\s+([A-Za-z_]\w*)\s+(ascending|descending)\s+limited\s+to\s+(\d+)\s+using\s+([A-Za-z_]\w*)/g;
 return source.replace(read,(original,model:string,conditions:string,orderField:string,direction:string,limit:string,database:string)=>{
  if(/[()]/.test(conditions)||/\band\b/.test(conditions)&&/\bor\b/.test(conditions)){
   const expression=parseMixedDatabasePredicate(conditions,operatorForPhrase);if(!expression)return original;
   const flatten=(node:SourcePredicate):string[]=>{
    if(node.kind==='compare')return [JSON.stringify(node.field),JSON.stringify(node.operator),node.value];
    let parts=flatten(node.items[0]!);for(const item of node.items.slice(1))parts=[JSON.stringify('('),...parts,JSON.stringify(node.kind),...flatten(item),JSON.stringify(')')];return parts;
   };
   return `await(databaseSelectWhere(${database}, ${JSON.stringify(model)}, ${flatten(expression).join(', ')}, ${JSON.stringify(orderField)}, ${JSON.stringify(direction)}, ${limit}))`;
  }
  const predicates:{field:string;operator:string;value:string}[]=[];let position=0,joiner:string|undefined;
  while(position<conditions.length){
   predicate.lastIndex=position;const match=predicate.exec(conditions);if(!match)return original;
   const field=match[1]!,contains=match[2]!.startsWith('contains'),phrase=match[4];
   predicates.push({field,operator:contains?'contains':phrase?operatorForPhrase[phrase]??'=':'=',value:contains?match[3]!:match[5]!});
   position=predicate.lastIndex;if(position===conditions.length)break;
   connector.lastIndex=position;const joined=connector.exec(conditions);if(!joined)return original;
   if(joiner&&joiner!==joined[1])return original;joiner=joined[1];position=connector.lastIndex;
  }
  if(predicates.length<2||!joiner)return original;
  const predicateArguments=predicates.map(item=>`"${item.field}", "${item.operator}", ${item.value}`).join(', ');
  return `await(databaseSelectWhere(${database}, "${model}", ${predicateArguments}, "${orderField}", "${direction}", ${limit}, "${joiner}"))`;
 });
}

/** Extends the authoritative parser without replacing it. Async syntax is
 * lowered to ordinary parser calls, then restored as a distinct AST node. */
export function parseAsync(source: string, file = '<input>'): Program {
  const asyncNames = new Set<string>();
  const asyncStarts = new Map<string, number>();
  const rewritten = rewriteCompoundDatabaseReads(source
    .replace(/\bwait\s+for\s+/g, (match) => `await${' '.repeat(Math.max(1, match.length - 5))}`))
    .replace(/\bawait\s+get\s+[A-Za-z_]\w*\s+from\s+([A-Za-z_]\w*)\s+where\s+([A-Za-z_]\w*)\s+contains\s+([A-Za-z_]\w*|"[^"\n]*")\s+or\s+([A-Za-z_]\w*)\s+contains\s+([A-Za-z_]\w*|"[^"\n]*")\s+ordered\s+by\s+([A-Za-z_]\w*)\s+(ascending|descending)\s+limited\s+to\s+(\d+)\s+using\s+([A-Za-z_]\w*)/g, (_match, model: string, field1: string, value1: string, field2: string, value2: string, orderField: string, direction: string, limit: string, database: string) => `await(databaseSelectWhere(${database}, "${model}", "${field1}", "contains", ${value1}, "${field2}", "contains", ${value2}, "${orderField}", "${direction}", ${limit}, "or"))`)
    .replace(/\bawait\s+get\s+[A-Za-z_]\w*\s+from\s+([A-Za-z_]\w*)\s+where\s+([A-Za-z_]\w*)\s+is\s+(?:(at least|at most|greater than|less than|equal to|not)\s+)?(true|false|-?\d+(?:\.\d+)?|"[^"\n]*"|[A-Za-z_]\w*)\s+and\s+([A-Za-z_]\w*)\s+is\s+(?:(at least|at most|greater than|less than|equal to|not)\s+)?(true|false|-?\d+(?:\.\d+)?|"[^"\n]*"|[A-Za-z_]\w*)\s+ordered\s+by\s+([A-Za-z_]\w*)\s+(ascending|descending)\s+limited\s+to\s+(\d+)\s+using\s+([A-Za-z_]\w*)/g, (_match, model: string, field1: string, phrase1: string|undefined, value1: string, field2: string, phrase2: string|undefined, value2: string, orderField: string, direction: string, limit: string, database: string) => { const operator: Record<string,string> = {'at least':'>=','at most':'<=','greater than':'>','less than':'<','equal to':'=','not':'!='}; return `await(databaseSelectWhere(${database}, "${model}", "${field1}", "${phrase1?operator[phrase1]:'='}", ${value1}, "${field2}", "${phrase2?operator[phrase2]:'='}", ${value2}, "${orderField}", "${direction}", ${limit}))`; })
    .replace(/\bawait\s+get\s+[A-Za-z_]\w*\s+from\s+([A-Za-z_]\w*)\s+where\s+([A-Za-z_]\w*)\s+is\s+((?!true\b|false\b)[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+ordered\s+by\s+([A-Za-z_]\w*)\s+(ascending|descending)(?:\s+limited\s+to\s+(-?\d+))?\s+using\s+([A-Za-z_]\w*)/g, (_match, model: string, field: string, value: string, orderField: string, direction: string, limit: string|undefined, database: string) => `await(databaseSelectWhere(${database}, "${model}", "${field}", "=", ${value}, "${orderField}", "${direction}"${limit===undefined?'':`, ${limit}`}))`)
    .replace(/\bawait\s+get\s+[A-Za-z_]\w*\s+from\s+([A-Za-z_]\w*)\s+where\s+([A-Za-z_]\w*)\s+is\s+((?!true\b|false\b)[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+using\s+([A-Za-z_]\w*)/g, (_match, model: string, field: string, value: string, database: string) => `await(databaseSelectWhere(${database}, "${model}", "${field}", "=", ${value}))`)
    .replace(/\bawait\s+get\s+[A-Za-z_]\w*\s+from\s+([A-Za-z_]\w*)\s+where\s+([A-Za-z_]\w*)\s+is\s+(at least|at most|greater than|less than|equal to|not)\s+((?!true\b|false\b)[A-Za-z_]\w*)\s+ordered\s+by\s+([A-Za-z_]\w*)\s+(ascending|descending)(?:\s+limited\s+to\s+(-?\d+))?\s+using\s+([A-Za-z_]\w*)/g, (_match, model: string, field: string, phrase: string, value: string, orderField: string, direction: string, limit: string|undefined, database: string) => { const operator: Record<string,string> = {'at least':'>=','at most':'<=','greater than':'>','less than':'<','equal to':'=','not':'!='}; return `await(databaseSelectWhere(${database}, "${model}", "${field}", "${operator[phrase]}", ${value}, "${orderField}", "${direction}"${limit===undefined?'':`, ${limit}`}))`; })
    .replace(/\bawait\s+get\s+[A-Za-z_]\w*\s+from\s+([A-Za-z_]\w*)\s+where\s+([A-Za-z_]\w*)\s+is\s+(at least|at most|greater than|less than|equal to|not)\s+((?!true\b|false\b)[A-Za-z_]\w*)\s+using\s+([A-Za-z_]\w*)/g, (_match, model: string, field: string, phrase: string, value: string, database: string) => { const operator: Record<string,string> = {'at least':'>=','at most':'<=','greater than':'>','less than':'<','equal to':'=','not':'!='}; return `await(databaseSelectWhere(${database}, "${model}", "${field}", "${operator[phrase]}", ${value}))`; })
    .replace(/\bawait\s+get\s+[A-Za-z_]\w*\s+from\s+([A-Za-z_]\w*)\s+where\s+([A-Za-z_]\w*)\s+is\s+(at least|at most|greater than|less than|equal to|not)\s+(true|false|-?\d+(?:\.\d+)?|"[^"\n]*")\s+using\s+([A-Za-z_]\w*)/g, (_match, model: string, field: string, phrase: string, value: string, database: string) => { const operator: Record<string,string> = {'at least':'>=','at most':'<=','greater than':'>','less than':'<','equal to':'=','not':'!='}; return `await(databaseSelectWhere(${database}, "${model}", "${field}", "${operator[phrase]}", ${value}))`; })
    .replace(/\bawait\s+get\s+[A-Za-z_]\w*\s+from\s+([A-Za-z_]\w*)\s+where\s+([A-Za-z_]\w*)\s+is\s+(true|false|-?\d+(?:\.\d+)?|"[^"\n]*")\s+ordered\s+by\s+([A-Za-z_]\w*)\s+(ascending|descending)(?:\s+limited\s+to\s+(-?\d+))?\s+using\s+([A-Za-z_]\w*)/g, (_match, model: string, field: string, value: string, orderField: string, direction: string, limit: string|undefined, database: string) => `await(databaseSelectWhere(${database}, "${model}", "${field}", "=", ${value}, "${orderField}", "${direction}"${limit===undefined?'':`, ${limit}`}))`)
    .replace(/\bawait\s+get\s+[A-Za-z_]\w*\s+from\s+([A-Za-z_]\w*)\s+where\s+([A-Za-z_]\w*)\s+is\s+(at least|at most|greater than|less than|equal to|not)\s+(true|false|-?\d+(?:\.\d+)?|"[^"\n]*")\s+ordered\s+by\s+([A-Za-z_]\w*)\s+(ascending|descending)(?:\s+limited\s+to\s+(-?\d+))?\s+using\s+([A-Za-z_]\w*)/g, (_match, model: string, field: string, phrase: string, value: string, orderField: string, direction: string, limit: string|undefined, database: string) => { const operator: Record<string,string> = {'at least':'>=','at most':'<=','greater than':'>','less than':'<','equal to':'=','not':'!='}; return `await(databaseSelectWhere(${database}, "${model}", "${field}", "${operator[phrase]}", ${value}, "${orderField}", "${direction}"${limit===undefined?'':`, ${limit}`}))`; })
    .replace(/\bawait\s+get\s+[A-Za-z_]\w*\s+from\s+([A-Za-z_]\w*)\s+where\s+([A-Za-z_]\w*)\s+is\s+(true|false|-?\d+(?:\.\d+)?|"[^"\n]*")\s+using\s+([A-Za-z_]\w*)/g, (_match, model: string, field: string, value: string, database: string) => `await(databaseSelectWhere(${database}, "${model}", "${field}", ${value}))`)
    .replace(/\bawait\s+get\s+[A-Za-z_]\w*\s+from\s+([A-Za-z_]\w*)\s+limited\s+to\s+(-?\d+)\s+using\s+([A-Za-z_]\w*)/g, (_match, model: string, limit: string, database: string) => `await(databaseSelect(${database}, "${model}", ${limit}))`)
    .replace(/\bawait\s+get\s+[A-Za-z_]\w*\s+from\s+([A-Za-z_]\w*)\s+ordered\s+by\s+([A-Za-z_]\w*)\s+(ascending|descending)(?:\s+limited\s+to\s+(-?\d+))?\s+using\s+([A-Za-z_]\w*)/g, (_match, model: string, field: string, direction: string, limit: string|undefined, database: string) => `await(databaseSelect(${database}, "${model}", "${field}", "${direction}"${limit===undefined?'':`, ${limit}`}))`)
    .replace(/\bawait\s+get\s+[A-Za-z_]\w*\s+from\s+([A-Za-z_]\w*)\s+using\s+([A-Za-z_]\w*)/g, (_match, model: string, database: string) => `await(databaseSelect(${database}, "${model}"))`)
    .replace(/\bawait\s+add\s+([A-Za-z_]\w*)\s+to\s+([A-Za-z_]\w*)\s+using\s+([A-Za-z_]\w*)/g, (_match, value: string, model: string, database: string) => `await(databaseInsert(${database}, "${model}", ${value}))`)
    .replace(/\bawait\s+remove\s+([A-Za-z_]\w*)\s+with\s+([A-Za-z_]\w*)\s+using\s+([A-Za-z_]\w*)/g, (_match, model: string, id: string, database: string) => `await(databaseDelete(${database}, "${model}", ${id}))`)
    .replace(/\bawait\s+change\s+([A-Za-z_]\w*)\s+on\s+([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s+using\s+([A-Za-z_]\w*)/g, (_match, value: string, model: string, id: string, database: string) => `await(databaseUpdate(${database}, "${model}", ${id}, ${value}))`)
    .replace(/\bawait\s+update\s+([A-Za-z_]\w*)\s+in\s+([A-Za-z_]\w*)\s+with\s+([A-Za-z_]\w*)\s+where\s+([A-Za-z_]\w*)\s+is\s+(true|false|-?\d+(?:\.\d+)?|"[^"\n]*"|[A-Za-z_]\w*)\s+using\s+([A-Za-z_]\w*)/g, (_match, value: string, model: string, id: string, field: string, owner: string, database: string) => `await(databaseUpdateWhere(${database}, "${model}", ${id}, ${value}, "${field}", ${owner}))`)
    .replace(/\bawait\s+delete\s+([A-Za-z_]\w*)\s+from\s+([A-Za-z_]\w*)\s+using\s+([A-Za-z_]\w*)/g, (_match, id: string, model: string, database: string) => `await(databaseDelete(${database}, "${model}", ${id}))`)
    .replace(/\bawait\s+update\s+([A-Za-z_]\w*)\s+in\s+([A-Za-z_]\w*)\s+with\s+([A-Za-z_]\w*)\s+using\s+([A-Za-z_]\w*)/g, (_match, value: string, model: string, id: string, database: string) => `await(databaseUpdate(${database}, "${model}", ${id}, ${value}))`)
    .replace(/\basync\s+function\s+([A-Za-z_]\w*)/g, (_match, name: string, offset: number) => {
      asyncNames.add(name);
      asyncStarts.set(name, offset);
      // Keep the rewritten source length stable so parser diagnostics retain
      // the offsets reported for the user's async declaration.
      return `      function ${name}`;
    })
    .replace(/\bawait\s+([A-Za-z_]\w*(?:\([^{}\n]*\))?|(?:-?\d+(?:\.\d+)?)|(?:true|false|none))/g, 'await($1)');
  const program = parse(rewritten, file);
  const transform = (expression: Expression): Expression => {
    if (expression.kind === 'CallExpression') {
      const args = expression.args.map(transform);
      if (expression.callee === 'await' && args.length === 1) return {kind: 'AwaitExpression', operand: args[0]!, span: expression.span};
      return {...expression, args};
    }
    if (expression.kind === 'UnaryExpression') return {...expression, operand: transform(expression.operand)};
    if (expression.kind === 'BinaryExpression') return {...expression, left: transform(expression.left), right: transform(expression.right)};
    if (expression.kind === 'IndexExpression') return {...expression, object: transform(expression.object), index: transform(expression.index)};
    if (expression.kind === 'FieldAccessExpression') return {...expression, object: transform(expression.object)};
    if (expression.kind === 'ListLiteralExpression') return {...expression, elements: expression.elements.map(transform)};
    if (expression.kind === 'RecordValueExpression') return {...expression, fields: expression.fields.map(field => ({...field, value: transform(field.value)}))};
    if (expression.kind === 'PropagateExpression') return {...expression, operand: transform(expression.operand)};
    if (expression.kind === 'MatchExpression') return {...expression, value: transform(expression.value), arms: expression.arms.map(arm => ({...arm, value: transform(arm.value)}))};
    return expression;
  };
  const statement = (value: Statement): Statement => {
    if (value.kind === 'LetStatement' || value.kind === 'AssignStatement' || value.kind === 'ReturnStatement') return {...value, value: transform(value.value)};
    if (value.kind === 'ExpectStatement') return {...value, actual: transform(value.actual), expected: transform(value.expected)};
    if (value.kind === 'IfStatement') return {...value, condition: transform(value.condition), thenBody: value.thenBody.map(statement), elseBody: value.elseBody?.map(statement)};
    if (value.kind === 'ForStatement') return {...value, iterable: transform(value.iterable), body: value.body.map(statement)};
    if (value.kind === 'WhileStatement') return {...value, condition: transform(value.condition), body: value.body.map(statement)};
    if (value.kind === 'RepeatStatement') return {...value, count: transform(value.count), body: value.body.map(statement)};
    if (value.kind === 'TransactionStatement') return {...value, body: value.body.map(statement)};
    return value;
  };
  for (const declaration of program.declarations) {
    if (declaration.kind === 'FunctionDeclaration') {
      const functionDeclaration = declaration as FunctionDeclaration;
      functionDeclaration.async = asyncNames.has(functionDeclaration.name);
      const originalStart = asyncStarts.get(functionDeclaration.name);
      if (originalStart !== undefined) functionDeclaration.span = {...functionDeclaration.span, start: {...functionDeclaration.span.start, offset: originalStart, column: functionDeclaration.span.start.column - 6}};
      functionDeclaration.body = functionDeclaration.body.map(statement);
    }
  }
  return program;
}
