import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe,expect,it} from 'vitest';

describe('AI route authorization facts',()=>{
  it('projects controlled-English role policies through routes and project JSON',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-ai-route-policy-')),file=join(root,'main.bmec'),cli=join(process.cwd(),'dist','cli','index.js');
    writeFileSync(file,'app Secure\nfunction private() -> text { return "ok" }\nserve GET /private requiring role manager with private\n');
    const routes=JSON.parse(execFileSync(process.execPath,[cli,'routes',file,'--json'],{encoding:'utf8'}));
    const project=JSON.parse(execFileSync(process.execPath,[cli,'project',file,'--json'],{encoding:'utf8'}));
    expect(routes.routes).toEqual([expect.objectContaining({method:'GET',path:'/private',policyId:'role:manager'})]);
    expect(project.routes).toEqual([expect.objectContaining({method:'GET',path:'/private',policyId:'role:manager'})]);
  });
  it('projects controlled-English capability routes through routes and project JSON',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-ai-route-capability-')),file=join(root,'main.bmec'),cli=join(process.cwd(),'dist','cli','index.js');
    writeFileSync(file,'app Secure\nfunction health(env capability<environment>) -> text { return "ready" }\nserve GET /health requiring environment with health\n');
    const routes=JSON.parse(execFileSync(process.execPath,[cli,'routes',file,'--json'],{encoding:'utf8'}));
    const project=JSON.parse(execFileSync(process.execPath,[cli,'project',file,'--json'],{encoding:'utf8'}));
    expect(routes.routes).toEqual([expect.objectContaining({method:'GET',path:'/health',capabilities:['environment']})]);
    expect(project.routes).toEqual([expect.objectContaining({method:'GET',path:'/health',capabilities:['environment']})]);
  });
  it('projects combined controlled-English authorization and capability routes',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-ai-route-combined-')),file=join(root,'main.bmec'),cli=join(process.cwd(),'dist','cli','index.js');
    writeFileSync(file,'app Secure\nfunction health(db capability<database>) -> text { return "ready" }\nserve GET /health requiring role manager and database with health\n');
    const routes=JSON.parse(execFileSync(process.execPath,[cli,'routes',file,'--json'],{encoding:'utf8'}));
    expect(routes.routes).toEqual([expect.objectContaining({method:'GET',path:'/health',policyId:'role:manager',capabilities:['database']})]);
  });
  it('projects authenticated controlled-English capability routes',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-ai-route-authenticated-')),file=join(root,'main.bmec'),cli=join(process.cwd(),'dist','cli','index.js');
    writeFileSync(file,'app Secure\nfunction health(db capability<database>) -> text { return "ready" }\nserve GET /health requiring authenticated and database with health\n');
    const routes=JSON.parse(execFileSync(process.execPath,[cli,'routes',file,'--json'],{encoding:'utf8'}));
    expect(routes.routes).toEqual([expect.objectContaining({method:'GET',path:'/health',policyId:'authenticated',capabilities:['database']})]);
  });
  it('projects server-resolved Principal inputs without treating them as query parameters',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-ai-route-principal-')),file=join(root,'main.bmec'),cli=join(process.cwd(),'dist','cli','index.js');
    writeFileSync(file,'app Secure\ntype Principal { id text }\nfunction identity(principal Principal) -> text { return principal.id }\nserve GET /whoami requiring authenticated with identity\n');
    const routes=JSON.parse(execFileSync(process.execPath,[cli,'routes',file,'--json'],{encoding:'utf8'}));
    expect(routes.routes).toEqual([expect.objectContaining({method:'GET',path:'/whoami',policyId:'authenticated',principalParam:'principal',query:[]})]);
  });
  it('projects API authorization policies to generated CRUD routes and API facts',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-ai-api-policy-')),file=join(root,'main.bmec'),cli=join(process.cwd(),'dist','cli','index.js');
    writeFileSync(file,'app Secure\nmodel Task { title text required }\napi /tasks from Task requiring role manager');
    const routes=JSON.parse(execFileSync(process.execPath,[cli,'routes',file,'--json'],{encoding:'utf8'}));
    const project=JSON.parse(execFileSync(process.execPath,[cli,'project',file,'--json'],{encoding:'utf8'}));
    expect(routes.routes).toHaveLength(5);expect(routes.routes.every((route:{policyId?:string})=>route.policyId==='role:manager')).toBe(true);
    expect(project.apis).toEqual([expect.objectContaining({route:'/tasks',model:'Task',policyId:'role:manager'})]);
  });
});
