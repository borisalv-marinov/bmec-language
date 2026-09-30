import {describe,it,expect} from 'vitest';
import fc from 'fast-check';
import {formatType,isSameType,isAssignable,listType,optionalType,primitive,recordType} from '../src/types/type-ref.js';
import {compareValue,deserializeValue,roundTripValue,sameValue,serializeValue} from '../src/runtime/value-contract.js';

describe('structured TypeRef and semantic value contracts',()=>{
 it('round-trips validated date, datetime, and id values',()=>{
  for(const value of [{kind:'date',value:'2026-09-16'} as const,{kind:'datetime',value:'2026-09-16T12:34:56Z'} as const,{kind:'id',value:'user_123'} as const]) expect(roundTripValue(value)).toEqual(value);
 });
 it('compares nested types structurally and keeps display separate',()=>{
  const t=listType(optionalType(recordType('User','types.pipe::User')));
  expect(formatType(t)).toBe('list<User?>');
  expect(isSameType(t,listType(optionalType(recordType('User','types.pipe::User'))))).toBe(true);
  expect(isSameType(t,listType(optionalType(recordType('User','other.pipe::User'))))).toBe(false);
  expect(isAssignable({kind:'none'},optionalType(primitive('text')))).toBe(true);
  expect(isSameType({kind:'none'},optionalType(primitive('text')))).toBe(false);
 });
 it('orders exact numeric and temporal primitives',()=>{expect(compareValue({kind:'integer',value:2n},{kind:'integer',value:10n})).toBe(-1);expect(compareValue({kind:'date',value:'2026-01-01'},{kind:'date',value:'2026-02-01'})).toBe(-1);});
 it('round-trips int64 max without Number conversion',()=>{const x={kind:'integer',value:9223372036854775807n} as const;const wire=serializeValue(x);expect(wire).toEqual({version:1,kind:'integer',value:'9223372036854775807'});expect(sameValue(x,roundTripValue(x))).toBe(true)});
 it('round-trips exact money minor units',()=>{const x={kind:'money',minor:1234n,scale:2} as const;expect(roundTripValue(x)).toEqual(x)});
 it('round-trips nested lists, records, none, and Result variants',()=>{const type=recordType('User','types.pipe::User');const x={kind:'result',state:'ok',value:{kind:'list',elementType:optionalType(type),items:[{kind:'optional',inner:null},{kind:'optional',inner:{kind:'record',type,fields:{name:{kind:'text',value:'Ada'}}}}]}} as const;expect(sameValue(x,roundTripValue(x))).toBe(true);const err={kind:'result',state:'err',error:{kind:'text',value:'bad'}} as const;expect(deserializeValue(serializeValue(err))).toEqual(err)});
 it('rejects malformed and out-of-range wire values',()=>{expect(()=>deserializeValue({version:1,kind:'integer',value:'9223372036854775808'})).toThrow('PIPE-CONTRACT-001');expect(()=>deserializeValue({version:1,kind:'none',extra:false})).toThrow('PIPE-CONTRACT-001');expect(()=>deserializeValue({version:1,kind:'result',state:'ok'})).toThrow('PIPE-CONTRACT-001')});
 it('rejects calendar-invalid dates and times',()=>{expect(()=>deserializeValue({version:1,kind:'date',value:'2025-02-29'})).toThrow('PIPE-CONTRACT-001');expect(()=>deserializeValue({version:1,kind:'datetime',value:'2026-09-16T24:00:00Z'})).toThrow('PIPE-CONTRACT-001')});
 it('validates temporal values on serialization too',()=>{expect(()=>serializeValue({kind:'date',value:'2025-02-29'})).toThrow('PIPE-CONTRACT-001');expect(()=>serializeValue({kind:'datetime',value:'2026-09-16T24:00:00Z'})).toThrow('PIPE-CONTRACT-001');expect(()=>serializeValue({kind:'id',value:'bad id'})).toThrow('PIPE-CONTRACT-001')});
 it('preserves arbitrary generated int64 values through the contract',()=>{fc.assert(fc.property(fc.bigInt({min:-(2n**63n),max:2n**63n-1n}),n=>sameValue({kind:'integer',value:n},roundTripValue({kind:'integer',value:n})) ),{numRuns:100,seed:20260915})});
});
