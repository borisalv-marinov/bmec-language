import {describe,expect,it} from 'vitest';
import {validateHttp} from '../src/http/ir.js';
import {primitive} from '../src/types/type-ref.js';
import {CAPABILITY_KINDS} from '../src/runtime/capabilities.js';

describe('typed HTTP IR',()=>{
 it('validates route identity and response contract',()=>{
  expect(validateHttp({routes:[{id:'R1',method:'GET',path:'/health',pathParams:[],query:[],headers:[],responseBody:primitive('text'),status:200,handlerId:'FUNC-1'}]})).toEqual([]);
 });
 it('accepts every canonical capability including secureRandom',()=>{
  for(const capability of CAPABILITY_KINDS)expect(validateHttp({routes:[{id:'R1',method:'GET',path:'/health',pathParams:[],query:[],headers:[],status:200,handlerId:'FUNC-1',capabilities:[capability]}]})).toEqual([]);
 });
 it('allows exact route alternatives only under distinct policies and one contract',()=>{
  const route={id:'R1',method:'GET' as const,path:'/jobs',pathParams:[],query:[],headers:[],status:200,handlerId:'FUNC-1',policyId:'role:admin',responseBody:{kind:'list' as const,element:{kind:'primitive' as const,name:'text'}}};
  const worker={...route,id:'R2',handlerId:'FUNC-2',policyId:'role:worker'};
  expect(validateHttp({routes:[route,worker]})).toEqual([]);
  expect(validateHttp({routes:[route,{...worker,policyId:'role:admin'}]})).toContain('HTTP route alternatives for "GET /jobs" require distinct authorization policies');
  expect(validateHttp({routes:[route,{...worker,policyId:'authenticated'}]})).toContain('HTTP route alternatives for "GET /jobs" require role policies');
  expect(validateHttp({routes:[route,{...worker,responseBody:primitive('text')}]})).toContain('HTTP route alternatives for "GET /jobs" must have the same request and response contract');
 });
 it('requires path placeholders and parameter TypeRefs to agree',()=>{
  const valid={id:'R1',method:'GET' as const,path:'/users/:id',pathParams:[{name:'id',type:primitive('id')}],query:[],headers:[],status:200,handlerId:'FUNC-1'};
  expect(validateHttp({routes:[valid]})).toEqual([]);
  expect(validateHttp({routes:[{...valid,pathParams:[{name:'other',type:primitive('id')}]}]})).toContain('HTTP route path parameters do not match route "R1"');
  expect(validateHttp({routes:[{...valid,pathParams:[{name:'id',type:{kind:'wat'} as any}]}]})).toContain('Invalid HTTP pathParams TypeRef "id"');
 });
 it('returns errors instead of throwing on malformed route objects',()=>{
  expect(validateHttp({routes:[{id:123 as any,method:'NOPE' as any,path:42 as any,pathParams:null as any,query:[],headers:[],status:200,handlerId:''}]})).toEqual(expect.arrayContaining([expect.stringContaining('Invalid HTTP route contract')]));
 });
});
