import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compile,compileProject} from '../src/compiler.js';
import {startRuntime,type RuntimeHandle} from '../src/runtime/server.js';

const handles:RuntimeHandle[]=[];
const roots:string[]=[];
afterEach(async()=>{for(const handle of handles.splice(0))await handle.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

describe('admin-facing example model APIs',()=>{
 it.each([
  {name:'shop',path:'examples/shop/main.pipe',compile:(path:string)=>compileProject(path),collection:'/products'},
  {name:'legacy Tasks',path:'examples/tasks.pipe',compile:(path:string)=>compile(readFileSync(path,'utf8'),path),collection:'/tasks'},
  {name:'Journal',path:'examples/journal/main.bmec',compile:(path:string)=>compile(readFileSync(path,'utf8'),path),collection:'/posts'},
 ])('requires an admin policy for $name CRUD',async fixture=>{
  const entry=join(process.cwd(),fixture.path),compiled=fixture.compile(entry);
  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.ir!.apis.find(api=>api.route===fixture.collection)?.policyId).toBe('role:admin');
  const root=mkdtempSync(join(tmpdir(),'bmec-example-api-security-'));roots.push(root);
  const handle=await startRuntime(compiled.ir!,join(root,'generated'),join(root,'data.sqlite'),0,{authUsers:[{id:'admin',password:'admin password',role:'admin'}],defaultPolicy:'none'});handles.push(handle);
  for(const [path,method] of [[fixture.collection,'GET'],[`${fixture.collection}/1`,'GET'],[`${fixture.collection}/1`,'DELETE']] as const){
   expect((await fetch(`${handle.url}${path}`,{method})).status,`anonymous ${method} ${path}`).toBe(403);
  }
  expect((await fetch(`${handle.url}${fixture.collection}`,{method:'POST',headers:{'content-type':'application/json'},body:'{'})).status).toBe(403);
  const login=await fetch(`${handle.url}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'admin',password:'admin password'})});
  expect(login.status).toBe(200);
  const cookie=login.headers.get('set-cookie')!.split(';',1)[0]!;
  expect((await fetch(`${handle.url}${fixture.collection}`,{headers:{cookie}})).status).toBe(200);
 });

 it('keeps the Journal published-post list public while protecting editorial CRUD',async()=>{
  const entry=join(process.cwd(),'examples/journal/main.bmec'),compiled=compile(readFileSync(entry,'utf8'),entry);
  expect(compiled.diagnostics).toEqual([]);
  const root=mkdtempSync(join(tmpdir(),'bmec-journal-public-list-'));roots.push(root);
  const handle=await startRuntime(compiled.ir!,join(root,'generated'),join(root,'data.sqlite'),0,{authUsers:[{id:'admin',password:'admin password',role:'admin'}],defaultPolicy:'none'});handles.push(handle);
  expect((await fetch(`${handle.url}/posts`)).status).toBe(403);
  const publicList=await fetch(`${handle.url}/published-posts`);
  expect(publicList.status).toBe(200);
  expect(await publicList.json()).toEqual([]);
 });
});
