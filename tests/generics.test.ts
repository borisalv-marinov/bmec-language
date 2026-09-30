import {describe,expect,it} from 'vitest';
import {compile} from '../src/compiler.js';
import {executeValue,ListValue,VariantValue} from '../src/core/interpreter.js';

describe('generic function foundations',()=>{
  it('parses canonical type parameters and infers integer/text calls',()=>{
    const r=compile('function identity<T>(value T) -> T { return value } function main() -> integer { return identity(5) }');
    expect(r.diagnostics).toEqual([]);
    expect(r.ir!.functions[0].typeParameters).toEqual(['T']);
    expect(r.ir!.functions[0].parameters[0].typeRef.kind).toBe('typeParameter');
    expect(executeValue(r.ir!.functions,'main',[])).toBe(5n);
  });
  it('keeps separate generic owners distinct',()=>{
    const r=compile('function first<T>(value T) -> T { return value } function second<T>(value T) -> T { return value }');
    expect(r.diagnostics).toEqual([]);
    const a=r.ir!.functions[0].parameters[0].typeRef,b=r.ir!.functions[1].parameters[0].typeRef;
    expect(a).not.toEqual(b);
  });
  it('supports multiple generic parameters and higher-order generic values',()=>{
    const r=compile('function choose<A, B>(a A, b B) -> A { return a } function main() -> list<integer> { return map([1, 2], lambda(x integer) -> integer { return choose(x, "unused") }) }');
    expect(r.diagnostics).toEqual([]);
    expect(executeValue(r.ir!.functions,'main',[])).toEqual(new ListValue([1n,2n]));
  });
  it('rejects duplicate generic parameters',()=>{
    const r=compile('function bad<T, T>(value T) -> T { return value }');
    expect(r.diagnostics.map(x=>x.code)).toContain('PIPE-GEN-001');
  });
  it('parses explicit generic arguments and diagnoses conflicts',()=>{
    const ok=compile('function identity<T>(value T) -> T { return value } function main() -> integer { return identity<integer>(5) }');
    expect(ok.diagnostics).toEqual([]);
    expect(executeValue(ok.ir!.functions,'main',[])).toBe(5n);
    const bad=compile('function identity<T>(value T) -> T { return value } function main() -> integer { return identity<text>(5) }');
    expect(bad.diagnostics.map(x=>x.code)).toContain('PIPE-GEN-005');
  });
  it('retains concrete arguments on generic record and enum TypeRefs',()=>{
    const r=compile('type Pair<A, B> { first A second B } enum Box<T> { value(T), empty } function main(p Pair<integer,text>, b Box<integer>) -> Pair<integer,text> { return p }');
    expect(r.diagnostics).toEqual([]);
    const pair=r.ir!.functions.find(x=>x.name==='main')!.parameters[0].typeRef;
    const box=r.ir!.functions.find(x=>x.name==='main')!.parameters[1].typeRef;
    expect(pair.kind).toBe('record');
    expect(pair.kind==='record'&&pair.typeArguments?.map(x=>x.kind)).toEqual(['primitive','primitive']);
    expect(box.kind).toBe('enum');
  });
  it('substitutes generic enum payloads for matching and binding',()=>{
    const r=compile('enum Box<T> { value(T), empty } function read(b Box<integer>) -> integer { return match b { value(x) => x empty => 0 } }');
    expect(r.diagnostics).toEqual([]);
    expect(executeValue(r.ir!.functions,'read',[new VariantValue('Box','value',7n)])).toBe(7n);
    const binding=r.ir!.functions[0].body[0];
    expect(binding.kind==='return'&&binding.value.kind==='match'&&binding.value.arms?.[0].value.typeRef).toEqual({kind:'primitive',name:'integer'});
  });
  it('substitutes generic record fields through nested generic records',()=>{
    const r=compile('type Pair<A, B> { first A second B } type Wrapper<T> { value Pair<T, text> } function read(w Wrapper<integer>) -> integer { return w.value.first }');
    expect(r.diagnostics).toEqual([]);
    const field=r.ir!.functions[0].body[0];
    expect(field.kind==='return'&&field.value.typeRef).toEqual({kind:'primitive',name:'integer'});
  });
});
