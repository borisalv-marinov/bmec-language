import {describe,expect,it} from 'vitest';
import {symbolId} from '../src/identity.js';
import {decodeJson,decodeJsonAs,encodeJson,roundTripJson} from '../src/runtime/json.js';
import {listType,modelType,primitive} from '../src/types/type-ref.js';

describe('lossless PIPE JSON boundary',()=>{
  it('preserves integer, money, and structured values',()=>{
    const value={kind:'record',type:{kind:'record',name:'Invoice',symbol:'invoice.pipe::Invoice'},fields:{count:{kind:'integer',value:9223372036854775807n},amount:{kind:'money',minor:1234n,scale:2 as const}}} as const;
    const encoded=encodeJson(value);
    expect(encoded).toContain('9223372036854775807');
    expect(roundTripJson(value)).toEqual(value);
  });

  it('rejects malformed JSON',()=>expect(()=>decodeJson('{')).toThrow('PIPE-JSON-001'));

  it('validates decoded values against TypeRefs',()=>{
    const source=encodeJson({kind:'integer',value:1n} as const);
    expect(decodeJsonAs(source,primitive('integer')).kind).toBe('integer');
    expect(()=>decodeJsonAs(source,primitive('text'))).toThrow('PIPE-JSON-002');
  });

  it('accepts generated integer IDs on plain JSON model list values',()=>{
    const symbol=symbolId('json.test::Product');
    const product=modelType('Product',symbol);
    const schemas={Product:{symbol,kind:'model' as const,fields:{sku:primitive('text'),price:primitive('money')}}};
    const decoded=decodeJsonAs('[{"id":1,"sku":"PH-101","price":24}]',listType(product),schemas);
    expect(decoded.kind).toBe('list');
    if(decoded.kind!=='list')throw new Error('expected model list');
    expect(decoded.items).toHaveLength(1);
    const item=decoded.items[0];
    expect(item.kind).toBe('model');
    if(item.kind!=='model')throw new Error('expected model value');
    expect(item.fields.id).toEqual({kind:'integer',value:1n});
    expect(item.fields.sku).toEqual({kind:'text',value:'PH-101'});
    expect(item.fields.price).toEqual({kind:'money',minor:2400n,scale:2});
  });

  it('rejects malformed generated IDs on model list values',()=>{
    const symbol=symbolId('json.test::Product');
    const product=modelType('Product',symbol);
    const schemas={Product:{symbol,kind:'model' as const,fields:{sku:primitive('text')}}};
    expect(()=>decodeJsonAs('[{"id":"one","sku":"PH-101"}]',listType(product),schemas)).toThrow('PIPE-JSON-002');
  });
});
