import {describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import Database from 'better-sqlite3';
import {compile} from '../src/compiler.js';
import {ensureSqliteSchema} from '../src/db/sqlite.js';
import {sqliteAdapter} from '../src/db/adapter.js';
import {issueCapability} from '../src/runtime/capabilities.js';
import {buildRelease} from '../src/release/release.js';
import {startNodeRelease,type NodeHttpHandle} from '../src/release/server.js';
import {AuthService} from '../src/runtime/auth.js';
import {authenticatedSession,rolePolicy} from '../src/http/auth-policy.js';
import {principalFromRequest} from '../src/runtime/auth-http.js';

describe('BMEC 0.7 content application probes',()=>{
 it('builds a static informational site with linked pages and responsive navigation defaults',()=>{
  const source=readFileSync('examples/field-guide/main.bmec','utf8');
  const compiled=compile(source,'examples/field-guide/main.bmec');
  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.ir!.app.metadata).toEqual({
   description:'A "small" field guide to BMEC & tooling.',
   canonical:'https://bmec.example/field-guide',
  });
  const output=join(mkdtempSync(join(tmpdir(),'bmec-field-guide-')),'release');
  const release=buildRelease(compiled.ir!,output,{packageName:'field-guide',packageVersion:'0.7.0',languageVersion:'0.1'});
  const html=readFileSync(join(output,release.artifacts.browser),'utf8');
  expect(html).toContain('<title>Field Guide</title>');
  expect(html).toContain('<meta name="description" content="A &quot;small&quot; field guide to BMEC &amp; tooling.">');
  expect(html).toContain('<link rel="canonical" href="https://bmec.example/field-guide">');
  expect(html).toContain('<meta property="og:title" content="Field Guide">');
  expect(html).toContain('<meta property="og:description" content="A &quot;small&quot; field guide to BMEC &amp; tooling.">');
  expect(html).toContain('<meta property="og:url" content="https://bmec.example/field-guide">');
  expect(html).toContain('<nav data-pipe-nav aria-label="Application navigation">');
  expect(html).toContain('href="#pipe-page-');
  expect(html).toContain('data-pipe-page="/welcome"');
  expect(html).toContain('data-pipe-page="/language"');
  expect(html).toContain('data-pipe-page="/principles"');
  expect(html).toContain('meta name="viewport"');
  expect(html).toContain('nav[data-pipe-nav] a:focus-visible');
  expect(html).toContain('@media (max-width:640px)');
 });

 it('rejects empty descriptions and invalid canonical URLs with focused diagnostics',()=>{
  const empty=compile('app Empty { description "" }');
  expect(empty.diagnostics).toMatchObject([{code:'PIPE-APP-001',message:'App description must not be empty'}]);
  const invalid=compile('app Invalid {\n canonical "javascript:alert(1)"\n}');
  expect(invalid.diagnostics).toMatchObject([{code:'PIPE-APP-002',line:2}]);
 });

 it('serves a persisted blog-editor model through SQLite with required-field validation',async()=>{
  const compiled=compile(readFileSync('examples/journal/main.bmec','utf8'),'examples/journal/main.bmec');
  expect(compiled.diagnostics).toEqual([]);
  const output=join(mkdtempSync(join(tmpdir(),'bmec-journal-')),'release');
  const release=buildRelease(compiled.ir!,output,{packageName:'journal',packageVersion:'0.7.0',languageVersion:'0.1'});
  const html=readFileSync(join(output,release.artifacts.browser),'utf8');
  expect(html).toContain('data-model="Post"');
  expect(html).toContain('data-api="/posts"');
  expect(html).toContain('data-pipe-validation="nonempty"');
  expect(html).toContain('Add Post');
  expect(compiled.ir!.ui!.components.some(component=>component.state.some(state=>state.source?.path==='/published-posts'))).toBe(true);
  expect(html).toContain('data-pipe-list-filter-by="title"');
  expect(html).toContain('data-pipe-cursor-state="posts"');
  expect(compiled.ir!.ui!.components.find(component=>component.name==='Articles')?.state).toMatchObject([{name:'posts',source:{method:'GET',path:'/published-posts',next:{method:'GET',path:'/published-posts/pages/:after',parameter:'after',cursorField:'slug'},search:{method:'GET',path:'/published-posts/search/:term',parameter:'term',next:{method:'GET',path:'/published-posts/search/:term/pages/:after',parameter:'after',cursorField:'slug'}}}}]);
  expect(html).toContain('No published posts.');
  expect(html).toContain('data-pipe-route-link="/articles/:slug"');
  expect(html).toContain('data-pipe-route-params="slug=post.slug"');
  expect(html).toContain('data-pipe-page="/articles/:slug"');
  expect(html).toContain('Article not found or unpublished.');
  expect(compiled.ir!.ui!.components.find(component=>component.name==='Article')?.state).toMatchObject([{name:'posts',source:{method:'GET',path:'/published-posts/:slug'}}]);

  const dataFile=join(mkdtempSync(join(tmpdir(),'bmec-journal-db-')),'journal.sqlite');
  let client=new Database(dataFile);ensureSqliteSchema(client,compiled.ir!.db!);
  const token=issueCapability('database');
  const auth=new AuthService();await auth.register('editor','editor pass',{role:'admin'});
  const session=await auth.login('editor','editor pass');expect(session).toBeDefined();
  const editor={authorization:`Bearer ${session!.id}`};
  const options={capabilityTokens:new Map([['database',token]]),database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!},configureRouter:(router:import('../src/http/runtime.js').HttpRouter)=>{router.setPrincipalResolver(request=>principalFromRequest(request,auth));router.registerPolicy('role:admin',rolePolicy(auth,'admin'));}};
  let server:NodeHttpHandle=await startNodeRelease(output,options);
  try {
   const anonymous=await fetch(`${server.url}/posts`,{method:'POST',headers:{'content-type':'application/json'},body:'{' });
   expect(anonymous.status).toBe(403);
   expect(await (await fetch(`${server.url}/posts`)).text()).toContain('forbidden');
   const malformed=await fetch(`${server.url}/posts`,{method:'POST',headers:{...editor,'content-type':'application/json'},body:JSON.stringify({slug:'first-post'})});
   expect(malformed.status).toBe(400);
   expect(await (await fetch(`${server.url}/posts`,{headers:editor})).json()).toEqual([]);
   const created=await fetch(`${server.url}/posts`,{method:'POST',headers:{...editor,'content-type':'application/json'},body:JSON.stringify({title:'First post',slug:'first-post',summary:'A persisted entry',body:'First article body',published:false})});
   expect(created.status,await created.clone().text()).toBe(201);
   expect(await created.json()).toBe(1);
   expect(await (await fetch(`${server.url}/posts`,{headers:editor})).json()).toMatchObject([{title:'First post',slug:'first-post',published:false}]);
  const published=await fetch(`${server.url}/posts`,{method:'POST',headers:{...editor,'content-type':'application/json'},body:JSON.stringify({title:'Published note',slug:'published-note',summary:'A visible article',body:'Published article body',published:true})});
  expect(published.status,await published.clone().text()).toBe(201);
  const matchingSlugs:string[]=[];
  for(let index=0;index<73;index++){
   const slug=`needle-${String(index).padStart(3,'0')}`;matchingSlugs.push(slug);
   const response=await fetch(`${server.url}/posts`,{method:'POST',headers:{...editor,'content-type':'application/json'},body:JSON.stringify({title:`needle journal result ${index}`,slug,summary:'A searchable published entry',body:'Published search fixture',published:true})});
   expect(response.status,await response.clone().text()).toBe(201);
  }
  for(let index=0;index<7;index++){
   const response=await fetch(`${server.url}/posts`,{method:'POST',headers:{...editor,'content-type':'application/json'},body:JSON.stringify({title:`needle draft ${index}`,slug:`needle-draft-${index}`,summary:'Drafts stay private',body:'Unpublished search fixture',published:false})});
   expect(response.status,await response.clone().text()).toBe(201);
  }
  const firstSearch=await (await fetch(`${server.url}/published-posts/search/needle`)).json() as {slug:string;published:boolean}[];
  const secondSearch=await (await fetch(`${server.url}/published-posts/search/needle/pages/${firstSearch.at(-1)!.slug}`)).json() as {slug:string;published:boolean}[];
  const endSearch=await (await fetch(`${server.url}/published-posts/search/needle/pages/${secondSearch.at(-1)!.slug}`)).json();
  expect([firstSearch.length,secondSearch.length,endSearch.length]).toEqual([50,23,0]);
  expect([...firstSearch,...secondSearch].map(post=>post.slug)).toEqual(matchingSlugs);
  expect([...firstSearch,...secondSearch].every(post=>post.published)).toBe(true);
  expect(new Set([...firstSearch,...secondSearch].map(post=>post.slug)).size).toBe(73);
  expect(await (await fetch(`${server.url}/published-posts/search/missing`)).json()).toEqual([]);
  expect(await (await fetch(`${server.url}/published-posts/pages/needle-072`)).json()).toContainEqual(expect.objectContaining({title:'Published note',published:true}));
  } finally {await server.close();client.close();}

  client=new Database(dataFile);
  server=await startNodeRelease(output,{...options,database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!}});
  try {
   expect((await fetch(`${server.url}/posts`)).status).toBe(403);
   const persistedPosts=await (await fetch(`${server.url}/posts`,{headers:editor})).json() as {title:string;slug:string}[];
   expect(persistedPosts.find(post=>post.slug==='first-post')).toMatchObject({title:'First post'});
   expect(persistedPosts.find(post=>post.slug==='published-note')).toMatchObject({title:'Published note'});
   expect(persistedPosts).toHaveLength(82);
   expect(await (await fetch(`${server.url}/published-posts/pages/needle-072`)).json()).toContainEqual(expect.objectContaining({title:'Published note',slug:'published-note',published:true}));
   expect(await (await fetch(`${server.url}/published-posts/published-note`)).json()).toMatchObject([{title:'Published note',slug:'published-note',body:'Published article body',published:true}]);
   expect(await (await fetch(`${server.url}/published-posts/first-post`)).json()).toEqual([]);
   expect(await (await fetch(`${server.url}/published-posts/pages/needle-072`)).json()).toContainEqual(expect.objectContaining({slug:'published-note',published:true}));
  } finally {await server.close();client.close();}
 });

 it('serves persisted PulseBoard metrics through typed page state',async()=>{
 const compiled=compile(readFileSync('examples/pulseboard/main.bmec','utf8'),'examples/pulseboard/main.bmec');
 expect(compiled.diagnostics).toEqual([]);
  expect(compiled.ir!.apis).toEqual(expect.arrayContaining([expect.objectContaining({route:'/tasks',model:'Task',policyId:'authenticated'})]));
  const output=join(mkdtempSync(join(tmpdir(),'bmec-pulseboard-')),'release');
  const release=buildRelease(compiled.ir!,output,{packageName:'pulseboard',packageVersion:'0.7.0',languageVersion:'0.1'});
  const html=readFileSync(join(output,release.artifacts.browser),'utf8');
  expect(compiled.ir!.ui!.components.some(component=>component.state.some(state=>state.source?.path==='/dashboard/metrics'))).toBe(true);
  expect(html).toContain('data-pipe-list="metrics"');
  expect(html).toContain('data-pipe-bind="metric.name"');
  expect(html).toContain('data-pipe-bind="metric.value"');
  expect(html).toContain('data-pipe-bind="metric.workspaceName"');
  expect(html).toContain('/workspace-selection');
  expect(html).toContain('Use this workspace');

  const client=new Database(join(mkdtempSync(join(tmpdir(),'bmec-pulseboard-db-')),'pulseboard.sqlite'));
  ensureSqliteSchema(client,compiled.ir!.db!);
  const workspaceOne=101,workspaceTwo=202;
  client.prepare('INSERT INTO Workspace (workspaceId,name) VALUES (?,?)').run(workspaceOne,'Northstar');
  client.prepare('INSERT INTO Workspace (workspaceId,name) VALUES (?,?)').run(workspaceTwo,'Orbit');
  client.prepare('INSERT INTO WorkspaceMembership (workspaceId,authId,role) VALUES (?,?,?)').run(workspaceOne,'admin','Owner');
  client.prepare('INSERT INTO WorkspaceMembership (workspaceId,authId,role) VALUES (?,?,?)').run(workspaceOne,'member','Member');
  client.prepare('INSERT INTO WorkspaceMembership (workspaceId,authId,role) VALUES (?,?,?)').run(workspaceTwo,'member','Manager');
  client.prepare('INSERT INTO WorkspaceMembership (workspaceId,authId,role) VALUES (?,?,?)').run(workspaceTwo,'outsider','Member');
  client.prepare('INSERT INTO Task (title,status,priority,ownerAuthId,workspaceId) VALUES (?,?,?,?,?)').run('Inbox item','Inbox','Low','admin',workspaceOne);
  client.prepare('INSERT INTO Task (title,status,priority,ownerAuthId,workspaceId) VALUES (?,?,?,?,?)').run('Active item','Active','High','admin',workspaceOne);
  client.prepare('INSERT INTO Task (title,status,priority,ownerAuthId,workspaceId) VALUES (?,?,?,?,?)').run('Done item','Done','Medium','admin',workspaceOne);
  client.prepare('INSERT INTO Task (title,status,priority,ownerAuthId,workspaceId) VALUES (?,?,?,?,?)').run('Private member task','Active','Low','member',workspaceOne);
  client.prepare('INSERT INTO Task (title,status,priority,ownerAuthId,workspaceId) VALUES (?,?,?,?,?)').run('Other workspace task','Done','High','outsider',workspaceTwo);
  const token=issueCapability('database');
  const auth=new AuthService();
  await auth.register('admin','admin password',{role:'admin'});await auth.register('member','member password',{role:'member'});await auth.register('outsider','outsider password',{role:'member'});
  const adminSession=await auth.login('admin','admin password'),memberSession=await auth.login('member','member password'),outsiderSession=await auth.login('outsider','outsider password');
  expect(adminSession).toBeTruthy();expect(memberSession).toBeTruthy();expect(outsiderSession).toBeTruthy();
  const server=await startNodeRelease(output,{capabilityTokens:new Map([['database',token]]),database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!},configureRouter:router=>{router.setPrincipalResolver(request=>principalFromRequest(request,auth));router.registerPolicy('authenticated',authenticatedSession(auth.sessions));router.registerPolicy('role:admin',rolePolicy(auth,'admin'));}});
  try {
   const adminHeaders={authorization:`Bearer ${adminSession!.id}`,'content-type':'application/json'};
   const memberHeaders={authorization:`Bearer ${memberSession!.id}`,'content-type':'application/json'};
   const outsiderHeaders={authorization:`Bearer ${outsiderSession!.id}`,'content-type':'application/json'};
   const anonymous=await fetch(`${server.url}/tasks`,{method:'POST',headers:{'content-type':'application/json'},body:'{'});
   expect(anonymous.status).toBe(403);
   const memberCreate=await fetch(`${server.url}/tasks`,{method:'POST',headers:memberHeaders,body:JSON.stringify({title:'Member created task',status:'Inbox',priority:'Low',ownerAuthId:'admin',workspaceId:workspaceTwo})});
   expect(memberCreate.status,await memberCreate.clone().text()).toBe(200);
   const memberRows=await (await fetch(`${server.url}/tasks`,{headers:memberHeaders})).json();
   const adminRows=await (await fetch(`${server.url}/tasks`,{headers:adminHeaders})).json();
   expect(memberRows.map((row:any)=>row.title)).toEqual(['Private member task','Member created task']);
   expect(memberRows.every((row:any)=>row.ownerAuthId==='member')).toBe(true);
   expect(memberRows.every((row:any)=>row.workspaceId===workspaceOne)).toBe(true);
   expect(adminRows.map((row:any)=>row.title)).toEqual(['Inbox item','Active item','Done item','Private member task','Member created task']);
   const memberWorkspaces=await (await fetch(`${server.url}/workspaces`,{headers:memberHeaders})).json();
   expect(memberWorkspaces.map((row:any)=>({workspaceId:row.workspaceId,workspaceName:row.workspaceName,role:row.role.variant,selected:row.selected}))).toEqual([{workspaceId:workspaceOne,workspaceName:'Northstar',role:'Member',selected:"Selected"},{workspaceId:workspaceTwo,workspaceName:'Orbit',role:'Manager',selected:"Available"}]);
   const memberRoster=await fetch(`${server.url}/workspaces/${workspaceOne}/members`,{headers:memberHeaders});
   expect(memberRoster.status).toBe(403);
   const managerRoster=await fetch(`${server.url}/workspaces/${workspaceTwo}/members`,{headers:memberHeaders});
   expect(managerRoster.status,await managerRoster.clone().text()).toBe(200);
   expect((await managerRoster.json()).value.map((row:any)=>row.authId)).toEqual(['member','outsider']);
   const foreignWorkspaceRoster=await fetch(`${server.url}/workspaces/${workspaceTwo}/members`,{headers:outsiderHeaders});
   expect(foreignWorkspaceRoster.status).toBe(403);
   const workspaceOneRoster=await fetch(`${server.url}/workspace-members`,{headers:adminHeaders});
   expect(workspaceOneRoster.status).toBe(200);
   const workspaceOneMembers=await workspaceOneRoster.json();
   expect(workspaceOneMembers.map((row:any)=>({authId:row.authId,role:row.role.variant}))).toEqual([{authId:'admin',role:'Owner'},{authId:'member',role:'Member'}]);
   const workspaceTwoMemberId=(client.prepare('SELECT id FROM WorkspaceMembership WHERE workspaceId=? AND authId=?').get(workspaceTwo,'outsider') as any).id;
   const workspaceOneMemberId=(client.prepare('SELECT id FROM WorkspaceMembership WHERE workspaceId=? AND authId=?').get(workspaceOne,'member') as any).id;
   const workspaceOneOwnerId=(client.prepare('SELECT id FROM WorkspaceMembership WHERE workspaceId=? AND authId=?').get(workspaceOne,'admin') as any).id;
   const memberDetail=await fetch(`${server.url}/workspace-members/${workspaceOneMemberId}`,{headers:adminHeaders});
   expect(memberDetail.status).toBe(200);
   expect((await memberDetail.json()).map((row:any)=>row.authId)).toEqual(['member']);
   const anonymousRoleChange=await fetch(`${server.url}/workspace-members/${workspaceOneMemberId}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({role:'Manager'})});
   expect(anonymousRoleChange.status).toBe(403);
   const memberRoleChange=await fetch(`${server.url}/workspace-members/${workspaceOneMemberId}`,{method:'PATCH',headers:memberHeaders,body:JSON.stringify({role:'Manager'})});
   expect(memberRoleChange.status).toBe(403);
   expect(client.prepare('SELECT role FROM WorkspaceMembership WHERE id=?').get(workspaceOneMemberId)).toEqual({role:'Member'});
   const managerChoose=await fetch(`${server.url}/workspace-selection`,{method:'POST',headers:memberHeaders,body:JSON.stringify({workspaceId:workspaceTwo})});
   expect(managerChoose.status).toBe(200);
   const managerRoleChange=await fetch(`${server.url}/workspace-members/${workspaceTwoMemberId}`,{method:'PATCH',headers:memberHeaders,body:JSON.stringify({role:'Manager'})});
   expect(managerRoleChange.status).toBe(403);
   expect(client.prepare('SELECT role FROM WorkspaceMembership WHERE id=?').get(workspaceTwoMemberId)).toEqual({role:'Member'});
   const managerRestoreWorkspace=await fetch(`${server.url}/workspace-selection`,{method:'POST',headers:memberHeaders,body:JSON.stringify({workspaceId:workspaceOne})});
   expect(managerRestoreWorkspace.status).toBe(200);
   client.prepare('DELETE FROM ActiveWorkspace WHERE ownerAuthId=?').run('member');
   const ownerRoleChange=await fetch(`${server.url}/workspace-members/${workspaceOneMemberId}`,{method:'PATCH',headers:adminHeaders,body:JSON.stringify({role:'Manager'})});
   expect(ownerRoleChange.status,await ownerRoleChange.clone().text()).toBe(200);
   expect((await ownerRoleChange.json()).value).toBe(1);
   expect(client.prepare('SELECT role FROM WorkspaceMembership WHERE id=?').get(workspaceOneMemberId)).toEqual({role:'Manager'});
   const ownerPromotion=await fetch(`${server.url}/workspace-members/${workspaceOneMemberId}`,{method:'PATCH',headers:adminHeaders,body:JSON.stringify({role:'Owner'})});
   expect(ownerPromotion.status).toBe(403);
   expect(client.prepare('SELECT role FROM WorkspaceMembership WHERE id=?').get(workspaceOneMemberId)).toEqual({role:'Manager'});
   const invalidRoleChange=await fetch(`${server.url}/workspace-members/${workspaceOneMemberId}`,{method:'PATCH',headers:adminHeaders,body:JSON.stringify({role:'Superadmin'})});
   expect(invalidRoleChange.status).toBe(400);
   expect(client.prepare('SELECT role FROM WorkspaceMembership WHERE id=?').get(workspaceOneMemberId)).toEqual({role:'Manager'});
   const ownerDemotion=await fetch(`${server.url}/workspace-members/${workspaceOneOwnerId}`,{method:'PATCH',headers:adminHeaders,body:JSON.stringify({role:'Member'})});
   expect(ownerDemotion.status).toBe(403);
   expect(client.prepare('SELECT role FROM WorkspaceMembership WHERE id=?').get(workspaceOneOwnerId)).toEqual({role:'Owner'});
   const missingMembership=await fetch(`${server.url}/workspace-members/999999`,{method:'PATCH',headers:adminHeaders,body:JSON.stringify({role:'Member'})});
   expect(missingMembership.status).toBe(403);
   expect(client.prepare('SELECT COUNT(*) AS count FROM WorkspaceMembership').get()).toEqual({count:4});
   const foreignWorkspaceRoleChange=await fetch(`${server.url}/workspace-members/${workspaceTwoMemberId}`,{method:'PATCH',headers:adminHeaders,body:JSON.stringify({role:'Manager'})});
   expect(foreignWorkspaceRoleChange.status).toBe(403);
   expect(client.prepare('SELECT role FROM WorkspaceMembership WHERE id=?').get(workspaceTwoMemberId)).toEqual({role:'Member'});
   const ownerRoleRestore=await fetch(`${server.url}/workspace-members/${workspaceOneMemberId}`,{method:'PATCH',headers:adminHeaders,body:JSON.stringify({role:'Member'})});
   expect(ownerRoleRestore.status).toBe(200);
   expect(client.prepare('SELECT role FROM WorkspaceMembership WHERE id=?').get(workspaceOneMemberId)).toEqual({role:'Member'});
   const workspaceDirectory=await fetch(`${server.url}/workspace-directory`,{headers:adminHeaders});
   expect(workspaceDirectory.status).toBe(200);
   expect((await workspaceDirectory.json()).map((row:any)=>row.name)).toEqual(['Northstar','Orbit']);
   expect((await fetch(`${server.url}/workspace-directory`,{headers:memberHeaders})).status).toBe(403);
   const foreignId=adminRows[0].id;
   const foreignRead=await fetch(`${server.url}/tasks/${foreignId}`,{headers:memberHeaders});
   expect(foreignRead.status).toBe(404);expect(await foreignRead.json()).toMatchObject({state:'err',error:'not_found'});
   const foreignUpdate=await fetch(`${server.url}/tasks/${foreignId}`,{method:'PUT',headers:memberHeaders,body:JSON.stringify({title:'Stolen edit',status:'Done',priority:'High',ownerAuthId:'member'})});
   expect(foreignUpdate.status).toBe(200);expect(await foreignUpdate.json()).toBe(0);
   const foreignDelete=await fetch(`${server.url}/tasks/${foreignId}`,{method:'DELETE',headers:memberHeaders});
   expect(foreignDelete.status).toBe(200);expect(await foreignDelete.json()).toBe(0);
   expect(client.prepare('SELECT title,ownerAuthId FROM Task WHERE id=?').get(foreignId)).toEqual({title:'Inbox item',ownerAuthId:'admin'});
   const response=await fetch(`${server.url}/dashboard/metrics`,{headers:adminHeaders});
   expect(response.status,await response.clone().text()).toBe(200);
   expect(await response.json()).toEqual([
    {name:'Tasks tracked',value:5,workspaceName:'Northstar'},
    {name:'In progress',value:2,workspaceName:'Northstar'},
    {name:'Completed',value:1,workspaceName:'Northstar'},
   ]);
   const memberMetrics=await (await fetch(`${server.url}/dashboard/metrics`,{headers:memberHeaders})).json();
   expect(memberMetrics).toEqual([{name:'Tasks tracked',value:5,workspaceName:'Northstar'},{name:'In progress',value:2,workspaceName:'Northstar'},{name:'Completed',value:1,workspaceName:'Northstar'}]);

   const settingsResponse=await fetch(`${server.url}/settings`,{method:'POST',headers:memberHeaders,body:JSON.stringify({ownerAuthId:'admin',displayName:'Member',timeZone:'Europe/Sofia',weeklyDigest:true})});
   expect(settingsResponse.status,await settingsResponse.clone().text()).toBe(201);
   const createdSettings=await settingsResponse.json();
   expect(createdSettings).toMatchObject({state:'ok'});
   const settingsId=createdSettings.value;
   expect(client.prepare('SELECT ownerAuthId,displayName,timeZone,weeklyDigest FROM UserSettings WHERE id=?').get(settingsId)).toEqual({ownerAuthId:'member',displayName:'Member',timeZone:'Europe/Sofia',weeklyDigest:1});
   const memberSettings=await (await fetch(`${server.url}/settings`,{headers:memberHeaders})).json();
   expect(memberSettings).toHaveLength(1);
   const foreignSettings=await fetch(`${server.url}/settings/${settingsId}`,{headers:adminHeaders});
   expect(foreignSettings.status).toBe(404);
   const foreignSettingsUpdate=await fetch(`${server.url}/settings/${settingsId}`,{method:'PUT',headers:adminHeaders,body:JSON.stringify({displayName:'Spoofed',timeZone:'UTC',weeklyDigest:false})});
   expect(foreignSettingsUpdate.status).toBe(200);
   expect(await foreignSettingsUpdate.json()).toMatchObject({state:'ok',value:0});
   const foreignSettingsDelete=await fetch(`${server.url}/settings/${settingsId}`,{method:'DELETE',headers:adminHeaders});
   expect(foreignSettingsDelete.status).toBe(200);
   expect(await foreignSettingsDelete.json()).toBe(0);
   expect(client.prepare('SELECT displayName,timeZone,weeklyDigest FROM UserSettings WHERE id=?').get(settingsId)).toEqual({displayName:'Member',timeZone:'Europe/Sofia',weeklyDigest:1});

   const crossOriginSelection=await fetch(`${server.url}/workspace-selection`,{method:'POST',headers:{...memberHeaders,origin:'https://untrusted.example'},body:JSON.stringify({workspaceId:workspaceTwo})});
   expect(crossOriginSelection.status).toBe(403);
   expect(client.prepare('SELECT COUNT(*) AS count FROM ActiveWorkspace WHERE ownerAuthId=?').get('member')).toEqual({count:0});
   const selectedWorkspace=await fetch(`${server.url}/workspace-selection`,{method:'POST',headers:memberHeaders,body:JSON.stringify({workspaceId:workspaceTwo})});
   expect(selectedWorkspace.status,await selectedWorkspace.clone().text()).toBe(200);
   expect(await selectedWorkspace.json()).toMatchObject({state:'ok',value:workspaceTwo});
   const selectedAccess=await (await fetch(`${server.url}/workspaces`,{headers:memberHeaders})).json();
   expect(selectedAccess.map((row:any)=>({workspaceId:row.workspaceId,selected:row.selected}))).toEqual([{workspaceId:workspaceOne,selected:"Available"},{workspaceId:workspaceTwo,selected:"Selected"}]);
   const switchedTasks=await (await fetch(`${server.url}/tasks`,{headers:memberHeaders})).json();
   expect(switchedTasks.map((row:any)=>row.title)).toEqual(['Other workspace task']);
   const selectedMetrics=await (await fetch(`${server.url}/dashboard/metrics`,{headers:memberHeaders})).json();
   expect(selectedMetrics).toEqual([{name:'Tasks tracked',value:1,workspaceName:'Orbit'},{name:'In progress',value:0,workspaceName:'Orbit'},{name:'Completed',value:1,workspaceName:'Orbit'}]);
   const managedTaskId=switchedTasks[0].id;
   const managerUpdate=await fetch(`${server.url}/tasks/${managedTaskId}`,{method:'PUT',headers:memberHeaders,body:JSON.stringify({title:'Manager edited task',status:'Done',priority:'High',ownerAuthId:'member',workspaceId:workspaceOne})});
   expect(await managerUpdate.json()).toBe(1);
   expect(client.prepare('SELECT title,ownerAuthId,workspaceId FROM Task WHERE id=?').get(managedTaskId)).toEqual({title:'Manager edited task',ownerAuthId:'outsider',workspaceId:workspaceTwo});
   const managerDelete=await fetch(`${server.url}/tasks/${managedTaskId}`,{method:'DELETE',headers:memberHeaders});
   expect(await managerDelete.json()).toBe(1);
   const selectedCreate=await fetch(`${server.url}/tasks`,{method:'POST',headers:memberHeaders,body:JSON.stringify({title:'Orbit task',status:'Inbox',priority:'Low',workspaceId:workspaceOne})});
   expect(selectedCreate.status).toBe(200);
   const orbitRow=client.prepare('SELECT ownerAuthId,workspaceId FROM Task WHERE title=?').get('Orbit task');
   expect(orbitRow).toEqual({ownerAuthId:'member',workspaceId:workspaceTwo});
   const crossWorkspaceSelection=await fetch(`${server.url}/workspace-selection`,{method:'POST',headers:outsiderHeaders,body:JSON.stringify({workspaceId:workspaceOne})});
   expect(crossWorkspaceSelection.status).toBe(403);
   expect(client.prepare('SELECT COUNT(*) AS count FROM ActiveWorkspace WHERE ownerAuthId=?').get('outsider')).toEqual({count:0});

   const invalidSettings=await fetch(`${server.url}/settings/${settingsId}`,{method:'PUT',headers:memberHeaders,body:JSON.stringify({displayName:'Changed',timeZone:'Mars/Olympus',weeklyDigest:false})});
   expect(invalidSettings.status).toBe(400);
   expect(client.prepare('SELECT displayName,timeZone,weeklyDigest FROM UserSettings WHERE id=?').get(settingsId)).toEqual({displayName:'Member',timeZone:'Europe/Sofia',weeklyDigest:1});
   const validUpdate=await fetch(`${server.url}/settings/${settingsId}`,{method:'PUT',headers:memberHeaders,body:JSON.stringify({ownerAuthId:'admin',displayName:'Member Updated',timeZone:'UTC',weeklyDigest:false})});
   expect(validUpdate.status,await validUpdate.clone().text()).toBe(200);
   expect(await validUpdate.json()).toMatchObject({state:'ok',value:1});
   expect(client.prepare('SELECT ownerAuthId,displayName,timeZone,weeklyDigest FROM UserSettings WHERE id=?').get(settingsId)).toEqual({ownerAuthId:'member',displayName:'Member Updated',timeZone:'UTC',weeklyDigest:0});
   const duplicateSettings=await fetch(`${server.url}/settings`,{method:'POST',headers:memberHeaders,body:JSON.stringify({displayName:'Duplicate',timeZone:'UTC',weeklyDigest:false})});
   expect(duplicateSettings.status).toBe(400);
   expect(client.prepare('SELECT COUNT(*) AS count FROM UserSettings').get()).toEqual({count:1});
  } finally {await server.close();client.close();}
 });

 it('applies PulseBoard member ownership filtering before the 50-row task limit',async()=>{
  const compiled=compile(readFileSync('examples/pulseboard/main.bmec','utf8'),'examples/pulseboard/main.bmec');expect(compiled.diagnostics).toEqual([]);
  const output=join(mkdtempSync(join(tmpdir(),'bmec-pulseboard-member-limit-')),'release');buildRelease(compiled.ir!,output,{packageName:'pulseboard-member-limit',packageVersion:'0.7.0',languageVersion:'0.1'});
  const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);client.prepare('INSERT INTO Workspace (workspaceId,name) VALUES (?,?)').run(101,'Northstar');client.prepare('INSERT INTO WorkspaceMembership (workspaceId,authId,role) VALUES (?,?,?)').run(101,'member','Member');
  const insert=client.prepare('INSERT INTO Task (title,status,priority,ownerAuthId,workspaceId) VALUES (?,?,?,?,?)');for(let index=0;index<101;index++)insert.run(`Other member ${index}`,'Active','Low','other',101);insert.run('Member task beyond first 100','Inbox','Low','member',101);
  const auth=new AuthService();await auth.register('member','member password',{role:'member'});const session=await auth.login('member','member password');expect(session).toBeTruthy();
  const server=await startNodeRelease(output,{capabilityTokens:new Map([['database',issueCapability('database')]]),database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!},configureRouter:router=>{router.setPrincipalResolver(request=>principalFromRequest(request,auth));router.registerPolicy('authenticated',authenticatedSession(auth.sessions));}});
  try{const response=await fetch(`${server.url}/tasks`,{headers:{authorization:`Bearer ${session!.id}`}});expect(response.status,await response.clone().text()).toBe(200);expect(await response.json()).toMatchObject([{title:'Member task beyond first 100',ownerAuthId:'member',workspaceId:101}]);}finally{await server.close();client.close();}
 });

 it('pages PulseBoard tasks by ID while preserving member and manager workspace scope',async()=>{
  const compiled=compile(readFileSync('examples/pulseboard/main.bmec','utf8'),'examples/pulseboard/main.bmec');expect(compiled.diagnostics).toEqual([]);
  const output=join(mkdtempSync(join(tmpdir(),'bmec-pulseboard-cursor-')),'release');buildRelease(compiled.ir!,output,{packageName:'pulseboard-cursor',packageVersion:'0.7.0',languageVersion:'0.1'});
  const client=new Database(':memory:');ensureSqliteSchema(client,compiled.ir!.db!);client.prepare('INSERT INTO Workspace (workspaceId,name) VALUES (?,?)').run(101,'Northstar');client.prepare('INSERT INTO Workspace (workspaceId,name) VALUES (?,?)').run(202,'Orbit');
  const membership=client.prepare('INSERT INTO WorkspaceMembership (workspaceId,authId,role) VALUES (?,?,?)');membership.run(101,'member','Member');membership.run(101,'manager','Manager');membership.run(202,'outsider','Member');
  const insert=client.prepare('INSERT INTO Task (title,status,priority,ownerAuthId,workspaceId) VALUES (?,?,?,?,?)');for(let index=0;index<75;index++){insert.run(`Member task ${String(index).padStart(2,'0')}`,'Active','Low','member',101);if(index%5===0)insert.run(`Manager task ${index}`,'Inbox','High','manager',101)}for(let index=0;index<4;index++)insert.run(`Foreign workspace task ${index}`,'Done','Medium','outsider',202);
  const auth=new AuthService();for(const id of ['member','manager','outsider'])await auth.register(id,`${id} password`,{role:'member'});const sessions={member:await auth.login('member','member password'),manager:await auth.login('manager','manager password'),outsider:await auth.login('outsider','outsider password')};expect(sessions.member&&sessions.manager&&sessions.outsider).toBeTruthy();
  const server=await startNodeRelease(output,{capabilityTokens:new Map([['database',issueCapability('database')]]),database:{adapter:sqliteAdapter(client,compiled.ir!.db!),schema:compiled.ir!.db!},configureRouter:router=>{router.setPrincipalResolver(request=>principalFromRequest(request,auth));router.registerPolicy('authenticated',authenticatedSession(auth.sessions));}});
  const getPage=async(sessionId:string,path:string)=>{const response=await fetch(`${server.url}${path}`,{headers:{authorization:`Bearer ${sessionId}`}});expect(response.status,await response.clone().text()).toBe(200);return await response.json() as Array<{id:number;ownerAuthId:string;workspaceId:number}>};
  try{
   const first=await getPage(sessions.member!.id,'/tasks');expect(first).toHaveLength(50);expect(first.every(row=>row.ownerAuthId==='member'&&row.workspaceId===101)).toBe(true);
   const second=await getPage(sessions.member!.id,`/tasks/pages/${first.at(-1)!.id}`);expect(second).toHaveLength(25);expect(second.every(row=>row.id>first.at(-1)!.id&&row.ownerAuthId==='member'&&row.workspaceId===101)).toBe(true);
   const end=await getPage(sessions.member!.id,`/tasks/pages/${second.at(-1)!.id}`);expect(end).toEqual([]);const memberIds=[...first,...second].map(row=>row.id);expect(new Set(memberIds).size).toBe(75);
   const managerPages=[await getPage(sessions.manager!.id,'/tasks')];while(managerPages.at(-1)!.length){const last=managerPages.at(-1)!.at(-1)!;managerPages.push(await getPage(sessions.manager!.id,`/tasks/pages/${last.id}`))}const managerRows=managerPages.flat();expect(managerRows.every(row=>row.workspaceId===101)).toBe(true);expect(new Set(managerRows.map(row=>row.id)).size).toBe(managerRows.length);expect(new Set(managerRows.map(row=>row.ownerAuthId))).toEqual(new Set(['member','manager']));
   const outsiderRows=await getPage(sessions.outsider!.id,'/tasks');expect(outsiderRows).toHaveLength(4);expect(outsiderRows.every(row=>row.workspaceId===202&&row.ownerAuthId==='outsider')).toBe(true);
  }finally{await server.close();client.close();}
 });
});
