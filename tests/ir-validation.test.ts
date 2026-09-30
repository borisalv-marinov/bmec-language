import {describe,expect,it} from 'vitest';
import {compile} from '../src/compiler.js';
import {validateSerializedIR} from '../src/ir/validate.js';

const source='type User { name text } enum State { Ready Busy } function add(a integer, b integer) -> integer { return a + b } function main() -> integer { let f = add let xs list<integer> = [1, 2] let first = xs[0] if true { for x in xs { let u = User { name: "Ada" } } } else { let z = 0 } return f(1, 2) }';
const serialized=()=>{const result=compile(source,'validation.pipe');expect(result.diagnostics).toEqual([]);return JSON.parse(JSON.stringify(result.ir));};

describe('recursive typed IR validator',()=>{
  it('rejects malformed identities, declarations, and TypeRefs',()=>{
    const cases=[
      (ir:any)=>{ir.functions[0].id=ir.functions[1].id;},
      (ir:any)=>{ir.functions[0].parameters[0].typeRef={kind:'primitive',name:'text'};},
      (ir:any)=>{ir.functions[0].parameters[0].name='';},
      (ir:any)=>{delete ir.functions[1].body[0].value.symbolId;},
      (ir:any)=>{ir.functions[1].body[0].value.typeRef={kind:'list',element:{kind:'wat'}};},
    ];
    for(const mutate of cases){const ir=serialized();mutate(ir);expect(validateSerializedIR(ir).valid).toBe(false);}
  });
  it('rejects malformed direct/indirect calls and recursive child nodes',()=>{
    const direct=serialized();const directCall=direct.functions[1].body[4].value;directCall.calleeId='missing';expect(validateSerializedIR(direct).valid).toBe(false);
    const indirect=serialized();const indirectCall=indirect.functions[1].body[4].value;indirectCall.calleeSymbolId='';expect(validateSerializedIR(indirect).valid).toBe(false);
    const list=serialized();list.functions[1].body[3].thenBody[0].iterable.elements=[{kind:'wat'}];expect(validateSerializedIR(list).valid).toBe(false);
    const lambdaResult=compile('function main() -> integer { let f = lambda(x integer) -> integer { return x } return f(1) }');expect(lambdaResult.diagnostics).toEqual([]);const lambda=JSON.parse(JSON.stringify(lambdaResult.ir));lambda.functions[0].body[0].value.lambda.body=[{kind:'wat'}];expect(validateSerializedIR(lambda).valid).toBe(false);
    const module=serialized();module.modules=[{id:'MOD-001',file:'x',imports:['./x'],importIds:[3],symbols:['x'],symbolIds:['S']}];expect(validateSerializedIR(module).valid).toBe(false);
  });
  it('validates postfix Result propagation nodes',()=>{
    const result=compile('function parse() -> result<integer,text> { return ok(1) } function main() -> result<integer,text> { return parse()? }');
    expect(result.diagnostics).toEqual([]);
    expect(validateSerializedIR(JSON.parse(JSON.stringify(result.ir))).valid).toBe(true);
  });
  it('accepts all typed statement forms emitted by the current analyzer',()=>{
    const result=compile(`function main(limit integer) -> integer {
      var current integer = 0
      while current < limit {
        current = current + 1
        if current == 3 { continue }
        if current == 4 { break }
      }
      repeat 1 { current = current + 1 }
      return current
    }`);
    expect(result.diagnostics).toEqual([]);
    expect(validateSerializedIR(JSON.parse(JSON.stringify(result.ir))).valid).toBe(true);
  });
  it('rejects implementation methods absent from the interface contract',()=>{
    const ir=serialized();
    ir.interfaces=[{id:'I1',name:'Printable',methods:['print'],methodIds:['I1:print']}];
    ir.implementations=[{id:'IMPL-1',interfaceId:'I1',type:'User',methods:['missing'],methodIds:[]}];
    expect(validateSerializedIR(ir).valid).toBe(false);
  });
  it('rejects malformed structured interface requirements',()=>{
    const result=compile('interface Printable { print(self) -> text }','requirements.pipe');
    expect(result.diagnostics).toEqual([]);
    const ir=JSON.parse(JSON.stringify(result.ir));
    ir.interfaces[0].requirements[0].name='missing';
    expect(validateSerializedIR(ir).valid).toBe(false);
  });
  it('rejects constraints that reference stale type parameters or interfaces',()=>{
    const result=compile('interface Printable { print(self) -> text } function show<T: Printable>(value T) -> text { return "ok" }','constraint.pipe');
    expect(result.diagnostics).toEqual([]);
    const ir=JSON.parse(JSON.stringify(result.ir));
    ir.functions.find((f:any)=>f.name==='show').constraints[0].parameter='U';
    expect(validateSerializedIR(ir).valid).toBe(false);
  });
  it('validates function visibility metadata',()=>{
    const ir=serialized();
    ir.functions[0].visibility='not-a-visibility';
    expect(validateSerializedIR(ir).valid).toBe(false);
  });
  it('validates declaration visibility metadata',()=>{
    const ir=serialized();
    ir.records=[{id:'R1',name:'R',visibility:'invalid',fields:[]}];
    expect(validateSerializedIR(ir).valid).toBe(false);
  });
});
