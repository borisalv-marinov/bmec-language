import {describe,expect,it} from 'vitest';
import {parse} from '../src/parser/parser.js';
import {analyzeProgram} from '../src/semantic/analyze.js';
import {toIR} from '../src/ir/ir.js';
import {validateSerializedIR} from '../src/ir/validate.js';
import {formatType,isSameType,parseTypeRef,recordType,taskType} from '../src/types/type-ref.js';

describe('canonical TypeRef lowering boundary',()=>{
  it('does not reparse display type strings after semantic analysis',()=>{
    const ast=parse('model User { owner User } function main(value User) -> User { return value }','typeref.pipe');
    const semantic=analyzeProgram(ast);
    expect(semantic.diagnostics).toEqual([]);
    const field=ast.declarations.find(x=>x.kind==='ModelDeclaration')!.fields[0];
    field.type='not-a-type';
    const fn=ast.declarations.find(x=>x.kind==='FunctionDeclaration')!;
    fn.returnType='also-not-a-type';
    const ir=toIR(ast,semantic);
    expect(ir.models[0].fields[0].type).toBe('not-a-type');
    expect(ir.models[0].fields[0].typeRef).toEqual({kind:'model',name:'User',symbol:'typeref.pipe:ModelDeclaration:0'});
    expect(ir.functions[0].returnTypeRef).toEqual({kind:'model',name:'User',symbol:'typeref.pipe:ModelDeclaration:0'});
    expect(validateSerializedIR(JSON.parse(JSON.stringify(ir))).valid).toBe(false);
  });
});

it('supports language-owned task TypeRefs structurally',()=>{const parsed=parseTypeRef('task<Thing>',name=>name==='Thing'?recordType('Thing','m::Thing'):undefined)!;expect(formatType(parsed)).toBe('task<Thing>');expect(isSameType(parsed,taskType(recordType('Thing','m::Thing')))).toBe(true);});
