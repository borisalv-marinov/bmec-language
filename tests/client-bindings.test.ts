import {describe,expect,it} from 'vitest';
import {transformSync} from 'esbuild';
import {generateClientBindings} from '../src/http/client-bindings.js';
import {listType,modelType,primitive} from '../src/types/type-ref.js';

describe('derived HTTP client bindings',()=>{
  it('derives valid paths, parameters, and declared response types from routes',()=>{
    const source=generateClientBindings({routes:[{id:'users.get',method:'GET',path:'/users/:id',pathParams:[{name:'id',type:primitive('id'),required:true}],query:[{name:'q',type:primitive('text')}],headers:[{name:'x-trace',type:primitive('id')}],responseBody:listType(primitive('text')),status:200,handlerId:'users.get'}]});
    expect(source).toContain('interface users_getParams');
    expect(source).toContain('type users_getResponse = Array<string>');
    expect(source).toContain('id:string');
    expect(source).toContain('q?:string');
    expect(source).toContain('encodeURIComponent(String(params.id))');
    expect(source).toContain('query.set("q"');
    expect(source).toContain('headers["x-trace"]');
    expect(source).toContain('request("GET"');
  });

  it('executes the generated client transport contract',async()=>{
    const source=generateClientBindings({routes:[{id:'users.get',method:'GET',path:'/users/:id',pathParams:[{name:'id',type:primitive('id'),required:true}],query:[{name:'q',type:primitive('text')}],headers:[],responseBody:listType(primitive('text')),status:200,handlerId:'users.get'}]});
    const javascript=transformSync(source,{loader:'ts',format:'esm',target:'es2020'}).code;
    const module=await import(`data:text/javascript,${encodeURIComponent(javascript)}`) as {users_get:(params:{id:string;q?:string},request:(method:string,path:string,body?:unknown,headers?:Record<string,string>)=>Promise<unknown>)=>Promise<Array<string>>};
    const calls:any[]=[];
    const result=await module.users_get({id:'a/b',q:'ready'},async(method,path,body,headers)=>{calls.push({method,path,body,headers});return ['ok']});
    expect(result).toEqual(['ok']);
    expect(calls).toEqual([{method:'GET',path:'/users/a%2Fb?q=ready',body:undefined,headers:{}}]);
  });

  it('projects named model fields when the canonical project schema is supplied',()=>{
    const source=generateClientBindings({routes:[{id:'users.get',method:'GET',path:'/users/:id',pathParams:[{name:'id',type:primitive('id'),required:true}],query:[],headers:[],responseBody:modelType('User','MODEL-USER'),status:200,handlerId:'users.get'}]},{models:[{id:'MODEL-USER',name:'User',fields:[{id:'FIELD-ID',name:'id',type:'id',typeRef:primitive('id'),required:true},{id:'FIELD-NAME',name:'displayName',type:'text',typeRef:primitive('text'),required:true}]}],records:[],enums:[]});
    expect(source).toContain('export interface User');
    expect(source).toContain('displayName: string;');
    expect(source).toContain('type users_getResponse = User');
  });
});
