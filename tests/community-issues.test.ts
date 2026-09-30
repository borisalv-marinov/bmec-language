import {afterEach,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import Database from 'better-sqlite3';
import {compile} from '../src/compiler.js';
import {ensureSqliteSchema} from '../src/db/sqlite.js';
import {sqliteAdapter} from '../src/db/adapter.js';
import {startNodeHttpSource,type NodeHttpHandle} from '../src/http/node-adapter.js';
import {authenticatedSession,rolePolicy} from '../src/http/auth-policy.js';
import {principalFromRequest} from '../src/runtime/auth-http.js';
import {issueCapability} from '../src/runtime/capabilities.js';
import {AuthService} from '../src/runtime/auth.js';
import {executeAsyncValue} from '../src/core/interpreter.js';

const handles:NodeHttpHandle[]=[];
const clients:InstanceType<typeof Database>[]=[];
afterEach(async()=>{for(const handle of handles.splice(0))await handle.close();for(const client of clients.splice(0))client.close()});

describe('CommunityIssues bounded GitHub-like application probe',()=>{
 it('checks repository, issue search/status, comments, and maintainer access over authenticated SQLite HTTP',async()=>{
  const file='examples/community-issues/main.bmec';
  const program=compile(readFileSync(file,'utf8'),file);
  expect(program.diagnostics).toEqual([]);
  const db=new Database(':memory:');clients.push(db);ensureSqliteSchema(db,program.ir!.db!);
  const auth=new AuthService();
  await auth.register('maintainer','maintainer pass',{role:'maintainer'});
  await auth.register('reporter','reporter pass',{role:'reporter'});
  const database={adapter:sqliteAdapter(db,program.ir!.db!),schema:program.ir!.db!};
  const direct=await executeAsyncValue(program.ir!.functions,'createRepository',[{id:'maintainer',role:'maintainer'},issueCapability('database'),{name:'Direct probe',slug:'direct-probe'}],{database});
  expect(direct).toBe(1n);db.prepare('DELETE FROM "Repository"').run();
  const handle=await startNodeHttpSource(program.ir!,{
   capabilityTokens:new Map([['database',issueCapability('database')],['time',issueCapability('time')]]),
   database,
   configureRouter:router=>{
    router.registerPolicy('authenticated',authenticatedSession(auth.sessions));
    router.registerPolicy('role:maintainer',rolePolicy(auth,'maintainer'));
    router.setPrincipalResolver(request=>principalFromRequest(request,auth));
   },
  });handles.push(handle);
  const login=async(id:string,password:string)=>{
   const session=await auth.login(id,password);
   expect(session).toBeDefined();
   return {authorization:`Bearer ${session!.id}`};
  };
  const maintainer=await login('maintainer','maintainer pass');
  const reporter=await login('reporter','reporter pass');
  expect((await fetch(`${handle.url}/issues`)).status).toBe(403);
  expect((await fetch(`${handle.url}/repositories`,{method:'POST',headers:{...reporter,'content-type':'application/json'},body:JSON.stringify({name:'Compiler',slug:'compiler'})})).status).toBe(403);
  const repositoryResponse=await fetch(`${handle.url}/repositories`,{method:'POST',headers:{...maintainer,'content-type':'application/json'},body:JSON.stringify({name:'Compiler',slug:'compiler'})});
  expect(repositoryResponse.status,await repositoryResponse.clone().text()).toBe(200);expect(await repositoryResponse.json()).toBe(1);
  const invalid=await fetch(`${handle.url}/issues`,{method:'POST',headers:{...reporter,'content-type':'application/json'},body:JSON.stringify({repository:1,title:'Broken',description:'bad status',state:'WontFix'})});
  expect(invalid.status).toBe(400);expect(db.prepare('SELECT COUNT(*) AS count FROM "Issue"').get()).toMatchObject({count:0});
  const missingField=await fetch(`${handle.url}/issues`,{method:'POST',headers:{...reporter,'content-type':'application/json'},body:JSON.stringify({repository:1,title:'Missing description',state:'Open'})});
  expect(missingField.status).toBe(400);expect(db.prepare('SELECT COUNT(*) AS count FROM "Issue"').get()).toMatchObject({count:0});
  const invalidRepository=await fetch(`${handle.url}/issues`,{method:'POST',headers:{...reporter,'content-type':'application/json'},body:JSON.stringify({repository:999,title:'Orphan',description:'missing repository',state:'Open'})});
  expect(invalidRepository.status).toBe(400);expect(db.prepare('SELECT COUNT(*) AS count FROM "Issue"').get()).toMatchObject({count:0});
  const forgedTimestamp=await fetch(`${handle.url}/issues`,{method:'POST',headers:{...reporter,'content-type':'application/json'},body:JSON.stringify({repository:1,title:'Forged date',description:'client timestamp',state:'Open',createdAt:0})});
  expect(forgedTimestamp.status).toBe(400);expect(db.prepare('SELECT COUNT(*) AS count FROM "Issue"').get()).toMatchObject({count:0});
  const createdAtBefore=Date.now();
  const created=await fetch(`${handle.url}/issues`,{method:'POST',headers:{...reporter,'content-type':'application/json'},body:JSON.stringify({repository:1,title:'Offline compiler',description:'Compiler goes offline after restart',state:'Open'})});
  expect(created.status).toBe(200);expect(await created.json()).toBe(1);
  const issueCreatedAt=Number((db.prepare('SELECT "createdAt" FROM "Issue" WHERE "id" = 1').get() as {createdAt:number}).createdAt);
  expect(issueCreatedAt).toBeGreaterThanOrEqual(createdAtBefore);expect(issueCreatedAt).toBeLessThanOrEqual(Date.now());
  const secondRepository=await fetch(`${handle.url}/repositories`,{method:'POST',headers:{...maintainer,'content-type':'application/json'},body:JSON.stringify({name:'Editor',slug:'editor'})});
  expect(secondRepository.status).toBe(200);expect(await secondRepository.json()).toBe(1);
  const secondRepositoryId=(db.prepare('SELECT "id" FROM "Repository" WHERE "slug"=?').get('editor') as {id:number}).id;
  const search=await fetch(`${handle.url}/issues/search?term=offline`,{headers:reporter});
  expect(search.status).toBe(200);expect(await search.json()).toMatchObject([{title:'Offline compiler',state:{type:'IssueState',variant:'Open'},createdBy:'reporter'}]);
  const repositoryIssues=await fetch(`${handle.url}/repositories/1/issues`,{headers:reporter});
  expect(repositoryIssues.status).toBe(200);expect(await repositoryIssues.json()).toHaveLength(1);
  const insertIssue=db.prepare('INSERT INTO "Issue" ("repository","title","description","state","createdBy","createdAt") VALUES (?,?,?,?,?,?)');
  for(let index=0;index<101;index++){insertIssue.run(1,`A noise ${String(index).padStart(3,'0')}`,'ordinary issue without the search phrase','Open','reporter',Date.now());if(index%3===0)insertIssue.run(secondRepositoryId,`Foreign repository ${index}`,'foreign issue','Open','reporter',Date.now());}
  insertIssue.run(1,'Zulu target','late needle-only match','Open','reporter',Date.now());
  insertIssue.run(1,'Zulu literal','contains 100%_ literally','Open','reporter',Date.now());
  const readIssues=async(path:string)=>{const response=await fetch(`${handle.url}${path}`,{headers:reporter});expect(response.status,await response.clone().text()).toBe(200);return await response.json() as Array<{id:number;title:string}>};
  const allIssuePages=[await readIssues('/issues')];expect(allIssuePages[0]).toHaveLength(50);
  while(allIssuePages.at(-1)!.length===50){const last=allIssuePages.at(-1)!.at(-1)!;allIssuePages.push(await readIssues(`/issues/pages/${last.id}`));}
  const allIssues=allIssuePages.flat();expect(allIssuePages.map(page=>page.length)).toEqual([50,50,38]);expect(allIssues).toHaveLength(138);expect(allIssues.map(issue=>issue.id)).toEqual([...allIssues.map(issue=>issue.id)].sort((a,b)=>a-b));expect(new Set(allIssues.map(issue=>issue.id)).size).toBe(138);expect(await readIssues(`/issues/pages/${allIssues.at(-1)!.id}`)).toEqual([]);
  const repositoryPages=[await readIssues('/repositories/1/issues')];expect(repositoryPages[0]).toHaveLength(50);
  while(repositoryPages.at(-1)!.length===50){const last=repositoryPages.at(-1)!.at(-1)!;repositoryPages.push(await readIssues(`/repositories/1/issues/pages/${last.id}`));}
  const repositoryRows=repositoryPages.flat();expect(repositoryPages.map(page=>page.length)).toEqual([50,50,4]);expect(repositoryRows).toHaveLength(104);expect(repositoryRows.every(issue=>!issue.title.startsWith('Foreign repository'))).toBe(true);expect(new Set(repositoryRows.map(issue=>issue.id)).size).toBe(104);expect(await readIssues(`/repositories/1/issues/pages/${repositoryRows.at(-1)!.id}`)).toEqual([]);
  const repositoryList=await fetch(`${handle.url}/repositories`,{headers:reporter});expect(repositoryList.status).toBe(200);expect(await repositoryList.json()).toMatchObject([{name:'Compiler',slug:'compiler'},{name:'Editor',slug:'editor'}]);
  const slugPages=[await readIssues('/repositories/by-slug/compiler/issues')];expect(slugPages[0]).toHaveLength(50);
  while(slugPages.at(-1)!.length===50){const last=slugPages.at(-1)!.at(-1)!;slugPages.push(await readIssues(`/repositories/by-slug/compiler/issues/pages/${last.id}`));}
  const slugRows=slugPages.flat();expect(slugPages.map(page=>page.length)).toEqual([50,50,4]);expect(slugRows).toHaveLength(104);expect(slugRows.every(issue=>!issue.title.startsWith('Foreign repository'))).toBe(true);expect(new Set(slugRows.map(issue=>issue.id)).size).toBe(104);expect(await readIssues(`/repositories/by-slug/compiler/issues/pages/${slugRows.at(-1)!.id}`)).toEqual([]);expect(await readIssues('/repositories/by-slug/does-not-exist/issues')).toEqual([]);
  for(let index=0;index<125;index++)insertIssue.run(1,index%3===0?`needlepaged match ${index}`:`Issue match ${index}`,index%5===0?`body also includes needlepaged ${index}`:`body contains needlepaged ${index}`,'Open','reporter',Date.now());
  const searchPages=[await readIssues('/issues/search/needlepaged')];expect(searchPages[0]).toHaveLength(50);
  while(searchPages.at(-1)!.length===50){const last=searchPages.at(-1)!.at(-1)!;searchPages.push(await readIssues(`/issues/search/needlepaged/pages/${last.id}`));}
  const matchedRows=searchPages.flat();expect(searchPages.map(page=>page.length)).toEqual([50,50,25]);expect(matchedRows).toHaveLength(125);expect(matchedRows.map(issue=>issue.id)).toEqual([...matchedRows.map(issue=>issue.id)].sort((a,b)=>a-b));expect(new Set(matchedRows.map(issue=>issue.id)).size).toBe(125);expect(matchedRows.filter(issue=>issue.title==='needlepaged match 0')).toHaveLength(1);expect(await readIssues(`/issues/search/needlepaged/pages/${matchedRows.at(-1)!.id}`)).toEqual([]);
  insertIssue.run(secondRepositoryId,'needlepaged foreign match','foreign issue','Open','reporter',Date.now());
  const scopedSearchPages=[await readIssues('/repositories/by-slug/compiler/issues/search/needlepaged')];expect(scopedSearchPages[0]).toHaveLength(50);
  while(scopedSearchPages.at(-1)!.length===50){const last=scopedSearchPages.at(-1)!.at(-1)!;scopedSearchPages.push(await readIssues(`/repositories/by-slug/compiler/issues/search/needlepaged/pages/${last.id}`));}
  const scopedMatches=scopedSearchPages.flat();expect(scopedSearchPages.map(page=>page.length)).toEqual([50,50,25]);expect(scopedMatches).toHaveLength(125);expect(new Set(scopedMatches.map(issue=>issue.id)).size).toBe(125);expect(scopedMatches.every(issue=>!issue.title.includes('foreign'))).toBe(true);expect(await readIssues(`/repositories/by-slug/compiler/issues/search/needlepaged/pages/${scopedMatches.at(-1)!.id}`)).toEqual([]);expect(await readIssues('/repositories/by-slug/editor/issues/search/needlepaged')).toMatchObject([{title:'needlepaged foreign match'}]);expect(await readIssues('/repositories/by-slug/does-not-exist/issues/search/needlepaged')).toEqual([]);
  expect(await readIssues(`/issues/search/${encodeURIComponent('%_')}/pages/0`)).toMatchObject([{title:'Zulu literal'}]);
  const lateSearch=await fetch(`${handle.url}/issues/search?term=needle-only`,{headers:reporter});
  expect(lateSearch.status).toBe(200);expect(await lateSearch.json()).toMatchObject([{title:'Zulu target',description:'late needle-only match'}]);
  expect(await (await fetch(`${handle.url}/issues/search?term=NEEDLE-ONLY`,{headers:reporter})).json()).toEqual([]);
  expect(await (await fetch(`${handle.url}/issues/search?term=%25_`,{headers:reporter})).json()).toMatchObject([{title:'Zulu literal'}]);
  const deniedStatus=await fetch(`${handle.url}/issues/1`,{method:'PATCH',headers:{...reporter,'content-type':'application/json'},body:JSON.stringify({title:'Offline compiler',description:'Closed',state:'Closed'})});
  expect(deniedStatus.status).toBe(403);
  const spoofedComment=await fetch(`${handle.url}/comments`,{method:'POST',headers:{...reporter,'content-type':'application/json'},body:JSON.stringify({issue:1,body:'Spoofed',createdBy:'maintainer'})});
  expect(spoofedComment.status).toBe(400);expect(db.prepare('SELECT COUNT(*) AS count FROM "IssueComment"').get()).toMatchObject({count:0});
  const invalidComment=await fetch(`${handle.url}/comments`,{method:'POST',headers:{...reporter,'content-type':'application/json'},body:JSON.stringify({issue:999,body:'Orphan comment'})});
  expect(invalidComment.status).toBe(400);expect(db.prepare('SELECT COUNT(*) AS count FROM "IssueComment"').get()).toMatchObject({count:0});
  const comment=await fetch(`${handle.url}/comments`,{method:'POST',headers:{...reporter,'content-type':'application/json'},body:JSON.stringify({issue:1,body:'Reproduced on Windows'})});
  expect(comment.status).toBe(200);expect(await comment.json()).toBe(1);
  const comments=await fetch(`${handle.url}/issues/1/comments`,{headers:reporter});
  expect(comments.status).toBe(200);expect(await comments.json()).toMatchObject([{body:'Reproduced on Windows',createdBy:'reporter'}]);
  const attemptedAttributionChange=await fetch(`${handle.url}/issues/1`,{method:'PATCH',headers:{...maintainer,'content-type':'application/json'},body:JSON.stringify({title:'Offline compiler',description:'Closed after repair',state:'Closed',createdBy:'maintainer',createdAt:'2099-12-31',repository:1})});
  expect(attemptedAttributionChange.status).toBe(400);
  expect(db.prepare('SELECT "createdBy", "createdAt" FROM "Issue" WHERE "id" = 1').get()).toEqual({createdBy:'reporter',createdAt:issueCreatedAt});
  const updated=await fetch(`${handle.url}/issues/1`,{method:'PATCH',headers:{...maintainer,'content-type':'application/json'},body:JSON.stringify({title:'Offline compiler',description:'Closed after repair',state:'Closed'})});
  expect(updated.status).toBe(200);expect(await updated.json()).toBe(1);
  expect(db.prepare('SELECT "createdBy", "createdAt" FROM "Issue" WHERE "id" = 1').get()).toEqual({createdBy:'reporter',createdAt:issueCreatedAt});
  expect(await (await fetch(`${handle.url}/issues/search?term=repair`,{headers:maintainer})).json()).toMatchObject([{state:{type:'IssueState',variant:'Closed'}}]);
 });
});
