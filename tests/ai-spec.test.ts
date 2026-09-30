import {describe,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CONTROLLED_ENGLISH_API_VOCABULARY,CONTROLLED_ENGLISH_AUTHORIZATION_VOCABULARY,CONTROLLED_ENGLISH_DATABASE_VOCABULARY,CONTROLLED_ENGLISH_STYLE_VOCABULARY,CONTROLLED_ENGLISH_UI_VOCABULARY} from '../src/tooling/completion-vocabulary.js';
import {AI_LANGUAGE_CONSTRUCTS} from '../src/cli/ai-language.js';
import {compile} from '../src/compiler.js';

describe('BMEC AI command specification',()=>{
 it('advertises cache support consistently in dynamic and static specs',()=>{
  const cli=process.cwd()+'/dist/cli/index.js';
  const dynamic=JSON.parse(execFileSync(process.execPath,[cli,'ai-spec','--json'],{encoding:'utf8'}));
  expect(dynamic).toMatchObject({schemaVersion:'bmec.ai-spec.v1',languageVersion:'0.1',version:'0.1-alpha'});
  expect(dynamic.constructs).toEqual(AI_LANGUAGE_CONSTRUCTS);
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'LANG-BIND-001',syntax:expect.stringContaining('let name = expression'),constraints:expect.arrayContaining([expect.stringContaining('compatibility spellings'),expect.stringContaining('formatter preserves')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'LANG-COMPARE-001',syntax:expect.stringContaining('left >= right'),constraints:expect.arrayContaining([expect.stringContaining('Controlled-English expressions'),expect.stringContaining('same typed operators')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'LANG-IF-001',constraints:expect.arrayContaining([expect.stringContaining('otherwise'),expect.stringContaining('first-use')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'LANG-APP-001',syntax:expect.stringContaining('description'),constraints:expect.arrayContaining([expect.stringContaining('absolute HTTP(S) canonical URL')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'LANG-API-001',syntax:expect.stringContaining('requiring authenticated'),constraints:expect.arrayContaining([expect.stringContaining('all generated list, create, read, update, and delete routes'),expect.stringContaining('inherits the API policy'),expect.stringContaining('authorization before route capability')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'UI-PAGE-LIST-001',syntax:expect.stringContaining('paginate 25'),properties:expect.arrayContaining(['filterBy','pageSize','empty']),constraints:expect.arrayContaining([expect.stringContaining('do not limit database reads'),expect.stringContaining('CRUD rows do not populate a list source')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'UI-COMPONENT-001',syntax:expect.stringContaining('[uses style StyleName]'),constraints:expect.arrayContaining([expect.stringContaining('Attach a named style in the component header')]),example:expect.stringContaining('component Metric uses style MetricCard')}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'UI-PAGE-ROUTE-001',syntax:expect.stringContaining('at "/articles/:slug"'),constraints:expect.arrayContaining([expect.stringContaining('must match a text field'),expect.stringContaining('URL-encoded parameter values')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'UI-PAGE-STATE-SOURCE-001',syntax:expect.stringContaining('from GET'),constraints:expect.arrayContaining([expect.stringContaining('match the page state list type exactly'),expect.stringContaining('generated integer id'),expect.stringContaining('uses the continuation for its next-page control'),expect.stringContaining('does not require PIPE_UI_STATE')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'UI-PAGE-ACTION-001',syntax:expect.stringContaining('then clears stateName on success'),constraints:expect.arrayContaining([expect.stringContaining('page state using'),expect.stringContaining('repeated-list button'),expect.stringContaining('explicit idempotency-key action'),expect.stringContaining('accessible live status region'),expect.stringContaining('locally persisted list'),expect.stringContaining('server handlers and database IR stay server-side')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'UI-PAGE-STATE-UPDATE-001',syntax:expect.stringContaining('persisted in local storage'),constraints:expect.arrayContaining([expect.stringContaining('parameter whose type exactly matches'),expect.stringContaining('scopes data by app, page, and state name'),expect.stringContaining('browser-storage write must succeed'),expect.stringContaining('multiplies two numeric fields'),expect.stringContaining('manually constructed model values returned by an in-memory function may omit `id` in JSON')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'HTTP-ROUTE-001',constraints:expect.arrayContaining([expect.stringContaining('declared record type named Principal'),expect.stringContaining('never populated from path, query, header, or body input'),expect.stringContaining('distinct role policies and an identical request/response contract')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'DB-MUTATION-001',syntax:expect.stringContaining('where ownerId is principalId'),constraints:expect.arrayContaining([expect.stringContaining('one or two equality guards into one database operation'),expect.stringContaining('cannot transfer a row out of the guarded scope'),expect.stringContaining('empty required text at insertion'),expect.stringContaining('integer field alone does not')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'DB-MUTATION-001',constraints:expect.arrayContaining([expect.stringContaining('map a narrower request DTO to a typed model value')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'DB-QUERY-001',constraints:expect.arrayContaining([expect.stringContaining('simple local identifier'),expect.stringContaining('member/property expressions to a typed local')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'DB-QUERY-001',syntax:expect.stringContaining('predicate...'),constraints:expect.arrayContaining([expect.stringContaining('mixed and/or connectors with parentheses'),expect.stringContaining('and binds more tightly than or'),expect.stringContaining('case-sensitive literal substring'),expect.stringContaining('bound parameter')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'DB-TRANSACTION-001',syntax:'transaction using db { statements }',constraints:expect.arrayContaining([expect.stringContaining('SQLite begins with BEGIN IMMEDIATE'),expect.stringContaining('Normal completion commits'),expect.stringContaining('Nested transactions')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'DB-CURSOR-001',name:'server-side keyset pagination',constraints:expect.arrayContaining([expect.stringContaining('execute in the database'),expect.stringContaining('must be unique'),expect.stringContaining('do not share a database snapshot'),expect.stringContaining('does not provide arbitrary offset or composite cursor pagination'),expect.stringContaining('combine a cursor comparison with owner/workspace filters')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'DB-INDEX-001',name:'declared database index',syntax:'index name on Model by field, field',constraints:expect.arrayContaining([expect.stringContaining('safe additive'),expect.stringContaining('changed definition')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'DB-INSERT-ID-001',name:'typed insert with generated row ID',syntax:'await databaseInsertId(db, "Model", value)',constraints:expect.arrayContaining([expect.stringContaining('SQLite reads'),expect.stringContaining('PostgreSQL uses INSERT'),expect.stringContaining('databaseInsert operation continues')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'DB-INSERT-ABSENT-001',syntax:expect.stringContaining('databaseInsertIdIfAbsent'),constraints:expect.arrayContaining([expect.stringContaining('ON CONFLICT'),expect.stringContaining('none means the unique key already existed')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'DB-TRANSACTION-001',constraints:expect.arrayContaining([expect.stringContaining('rolls back first'),expect.stringContaining('SQLite begins with BEGIN IMMEDIATE')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'DB-DECREMENT-001',syntax:expect.stringContaining('databaseDecrementWhere'),constraints:expect.arrayContaining([expect.stringContaining('at least the requested amount'),expect.stringContaining('zero rows'),expect.stringContaining('generated integer model id')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'DB-COUNT-001',name:'database-side counts',syntax:expect.stringContaining('databaseCountWhere'),constraints:expect.arrayContaining([expect.stringContaining('SQL COUNT(*)'),expect.stringContaining('without loading model rows')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'DB-MUTATION-001',syntax:expect.stringContaining('databaseUpdateUniqueWhere'),constraints:expect.arrayContaining([expect.stringContaining('one or two equality guards'),expect.stringContaining('same atomic equality predicates')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'HTTP-RESULT-STATUS-001',name:'typed result HTTP error status',syntax:'serve POST /jobs requiring role admin and database returns 200 errors 400 with create',constraints:expect.arrayContaining([expect.stringContaining('An ok result keeps'),expect.stringContaining('first status'),expect.stringContaining('JSON response body remains'),expect.stringContaining('before or after requiring'),expect.stringContaining('commas between authorization policy and capabilities')])}));
  expect(dynamic.constructs).toContainEqual(expect.objectContaining({id:'HTTP-ROUTE-001',constraints:expect.arrayContaining([expect.stringContaining('time capability receive it for server-side timestamps')])}));
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('CRUD rows do not populate a page-state list');
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('protect every generated list, create, read, update, and delete route');
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('host-provided `PIPE_UI_STATE`');
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('This is server-side keyset pagination');
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('databaseCountWhere');
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('COUNT(*)');
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('BMEC memory');
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('databaseDecrementWhere');
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('generated integer model `id` is a valid key field');
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('with idempotency key');
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('basic Open Graph tags');
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('Guard fields stay at their matched values');
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('databaseUpdateUniqueWhere');
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('not a narrower');
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('bind it to a typed local');
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('only one of `ordered by` or `limited to`');
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('integer field such as `customerId integer` is only a number');
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('Request-supplied claims cannot populate this value');
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('a distinct `role:NAME` policy');
  expect(dynamic.syntax).toContain('page Store { event add(productId id, quantity integer) sends POST "/cart/items" use CartForm }');
  expect(dynamic.syntax).toContain('api /tasks from Task requiring authenticated');
  expect(dynamic.completionVocabulary.controlledEnglishUi).toContain('sends');
  expect(readFileSync(process.cwd()+'/ai/ai-spec.md','utf8')).toContain('route cannot require query or other header inputs');
  expect(dynamic.projectionSchemas).toMatchObject({project:{schemaVersion:'bmec.project.v1',payload:'project object'},symbols:{schemaVersion:'bmec.symbols.v1',payload:'symbols'},types:{schemaVersion:'bmec.types.v1',payload:'types'},models:{schemaVersion:'bmec.models.v1',payload:'models'},routes:{schemaVersion:'bmec.routes.v1',payload:'routes'},pages:{schemaVersion:'bmec.pages.v1',payload:'pages'},styles:{schemaVersion:'bmec.styles.v1',payload:'styles'},capabilities:{schemaVersion:'bmec.used-capabilities.v1',payload:'capabilities'},stdlib:{schemaVersion:'bmec.stdlib.v1',payload:'functions and contracts'}});
  expect(execFileSync(process.execPath,[cli,'ai-spec','--json'],{encoding:'utf8'})).toBe(execFileSync(process.execPath,[cli,'ai-spec','--json'],{encoding:'utf8'}));
  expect(dynamic.commandOptions.check).toEqual(['--json','--cache']);
  expect(dynamic.stdlibContracts).toEqual(expect.arrayContaining([expect.objectContaining({name:'textReplace',arity:3,returns:'text'}),expect.objectContaining({name:'power',arity:2,arguments:['number','number'],returns:'number'}),expect.objectContaining({name:'sqrt',arity:1,arguments:['number'],returns:'number'}),expect.objectContaining({name:'encodeJson',arity:1,arguments:['T'],returns:'text'}),expect.objectContaining({name:'decodeJson',arity:1,arguments:['text'],returns:'result<T,text>'}),expect.objectContaining({name:'httpRequestJson',arity:7,returns:'task<result<T,text>>',capabilities:['http']}),expect.objectContaining({name:'sendEmail',arity:4,returns:'task<result<boolean,text>>',capabilities:['email']}),expect.objectContaining({name:'delay',arity:2,returns:'task<result<boolean,text>>',capabilities:['time']})]));
  expect(dynamic.stdlibContracts.map((entry:{name:string})=>entry.name)).toEqual(dynamic.stdlib);
  expect(dynamic.diagnosticSchema).toBe('bmec.diagnostics.v1');
  expect(dynamic.projectionSchemas.diagnostics).toEqual({schemaVersion:'bmec.diagnostics.v1',payload:'ok and diagnostics'});
  expect(dynamic.projectionSchemas.check).toEqual(dynamic.projectionSchemas.diagnostics);
  expect(dynamic.diagnosticEnvelope).toBe('{schemaVersion,languageVersion,ok:false,diagnostics:[...]}');
  expect(dynamic.diagnosticRequiredFields).toEqual(['code','severity','message','file','line','column','span']);
  expect(dynamic.diagnosticOptionalFields).toEqual(['node','path','kind','received','expected','actual','suggestions','repair','related']);
  expect(dynamic.releaseBoundarySchema).toEqual({version:'bmec.release-boundary.v1',fields:{publicArtifacts:'string[]',privateArtifacts:'string[]',browserExcludes:'string[]',protectedRoutes:'route[]',capabilityRoutes:'route[]',credentialHandling:'server-only',sessionHandling:'server-only'},routeFields:['id','method','path','policyId','capabilities'],invariants:['server-ir.json is private','credentials and session internals are never projected']});
  expect(JSON.stringify(dynamic.releaseBoundarySchema)).not.toMatch(/password|sessionId|passwordHash|scrypt/i);
  const project=JSON.parse(execFileSync(process.execPath,[cli,'project','examples/controlled-english/main.bmec','--json'],{encoding:'utf8'}));
  expect(project.releaseBoundary.version).toBe(dynamic.releaseBoundarySchema.version);
  expect(Object.keys(project.releaseBoundary).sort()).toEqual(expect.arrayContaining(['version',...Object.keys(dynamic.releaseBoundarySchema.fields)]));
  expect(project.releaseBoundary.protectedRoutes[0]).toEqual(expect.objectContaining({id:expect.any(String),method:expect.any(String),path:expect.any(String),policyId:expect.any(String),capabilities:expect.any(Array)}));
  expect(dynamic.completionVocabulary.controlledEnglishDatabase).toEqual(['wait','get','from','where','is','at','least','most','greater','less','than','equal','to','not','ordered','by','ascending','descending','limited','using','db','add','body','update','in','with','delete']);
  expect(dynamic.completionVocabulary.controlledEnglishApi).toEqual([...CONTROLLED_ENGLISH_API_VOCABULARY]);
  expect(dynamic.completionVocabulary.controlledEnglishStyle).toEqual(expect.arrayContaining(['style','named','token','background','hovered','focused','responsive','grid','columns','padding','margin','font','size','weight','opacity','textColor','ringed','compact']));
  expect(dynamic.completionVocabulary.controlledEnglishAuthorization).toEqual(['serve','requiring','requires','authenticated','role','attribute','with','and','database','environment','time','random','secureRandom','filesystem','email']);
  expect(dynamic.completionVocabulary.controlledEnglishUi).toEqual([...CONTROLLED_ENGLISH_UI_VOCABULARY]);
  expect(dynamic.completionVocabulary.controlledEnglishDatabase).toEqual([...CONTROLLED_ENGLISH_DATABASE_VOCABULARY]);
  expect(dynamic.completionVocabulary.controlledEnglishStyle).toEqual([...CONTROLLED_ENGLISH_STYLE_VOCABULARY]);
  expect(dynamic.completionVocabulary.controlledEnglishAuthorization).toEqual([...CONTROLLED_ENGLISH_AUTHORIZATION_VOCABULARY]);
  expect(dynamic.completionVocabulary.controlledEnglishUi).toEqual([...CONTROLLED_ENGLISH_UI_VOCABULARY]);
  expect(dynamic.validationRules).toEqual(['nonempty','email','number','date','datetime','url']);
  expect(dynamic.validationRuleAliases).toEqual({required:'nonempty',numeric:'number','iso-date':'date','iso-datetime':'datetime','http-url':'url'});
  expect(dynamic.syntax).toEqual(expect.arrayContaining(['component Form form { input Email text validate email button "Save" on Save }','style named Card { layout is column alignment is center padding is 12 }','style token SpaceSmall padding is 8','when focused { show focus ring }','on small screens { columns is 1 }','on small screens { gap is 8 }','on small screens { padding is 8 }','on small screens { margin is 8 }','on small screens { font size is 14 }','on small screens { font line height is 1.4 }','serve GET /private requiring role manager with private','serve GET /admin requiring attribute admin with private','serve GET /health requiring environment with health','serve GET /health requiring role manager and database with health','serve GET /health requiring authenticated and database with health','wait for get items from Item using db','wait for get items from Item where active is true ordered by name descending limited to 10 using db','wait for add body to Item using db','wait for update body in Item with id using db','wait for delete id from Item using db','update payload in Item with id using db','delete id from Item using db']));
  expect(dynamic.commands).toContain('repl');
  expect(dynamic.commands).toContain('examples');
  expect(dynamic.commands).toContain('knowledge');
  expect(dynamic.commands).toContain('doctor');
  expect(dynamic.commandUsage.repl).toBe('bmec repl');
  expect(dynamic.commandUsage.examples).toBe('bmec examples --json');
  expect(dynamic.commandUsage.knowledge).toBe('bmec knowledge "QUERY" [--json]');
  expect(dynamic.commandUsage.doctor).toBe('bmec doctor [path] [--json]');
  const staticSpec=JSON.parse(readFileSync('ai/commands.json','utf8'));
  expect(staticSpec).toMatchObject({schemaVersion:'bmec.commands.v1',languageVersion:dynamic.languageVersion});
  expect(staticSpec.projectionSchemas).toEqual(dynamic.projectionSchemas);
  const diagnosticSpec=JSON.parse(readFileSync('ai/diagnostics.json','utf8'));
  expect(diagnosticSpec).toMatchObject({schemaVersion:'bmec.diagnostics.v1',languageVersion:dynamic.languageVersion,diagnostic:{required:['code','severity','message','file','line','column','span'],optional:dynamic.diagnosticOptionalFields}});
  expect(dynamic.projectionSchemas.diagnostics.schemaVersion).toBe(diagnosticSpec.schemaVersion);
  expect(staticSpec.commands.map((entry:{name:string})=>entry.name).sort()).toEqual([...dynamic.commands].sort());
  for(const command of staticSpec.commands) expect(dynamic.commandUsage[command.name]).toBe(command.usage);
  for(const command of staticSpec.commands.filter((entry:{name:string})=>['check','ir','expand','graph','project','symbols','types','models','routes','pages','styles','capabilities','stdlib','examples','knowledge','inspect','affected','repl','ai-spec','build'].includes(entry.name))) expect(dynamic.commandUsage[command.name]).toBe(command.usage);
  expect(staticSpec.commands.find((command:{name:string})=>command.name==='check').usage).toContain('--cache');
  expect(staticSpec.commands.find((command:{name:string})=>command.name==='repl').usage).toBe('bmec repl');
 });
 it('keeps the documented database filter and DTO-to-model patterns compiler-valid',()=>{
  const source=`app TeamBoard
model Job { assigneeId text required title text required createdAt integer required }
type Principal { id text }
type JobInput { title text }
async function listAssigned(db capability<database>, principal Principal) -> task<list<Job>> {
  let workerId text = principal.id
  return wait for get items from Job where assigneeId is workerId ordered by createdAt ascending limited to 100 using db
}
async function createJob(db capability<database>, time capability<time>, body JobInput) -> task<integer> {
  let job Job = Job { assigneeId: "worker", title: body.title, createdAt: currentTime(time) }
  return await databaseInsertId(db, "Job", job)
}`;
  expect(compile(source).diagnostics).toEqual([]);
 });
 it('compiles named styles attached to reusable UI components',()=>{
  const source='app StyledMetrics\nstyle named MetricCard { surface is elevated padding is 16 corners is rounded }\ncomponent Metric uses style MetricCard { text "Open 6" }\npage Dashboard { use Metric }';
  expect(compile(source).diagnostics).toEqual([]);
 });
 it('lists the AI introspection commands in CLI help',()=>{
  const cli=process.cwd()+'/dist/cli/index.js';
  const help=execFileSync(process.execPath,[cli,'--help'],{encoding:'utf8'});
  for(const command of ['repl','expand','graph','project','symbols','inspect','affected','types','models','routes','pages','styles','capabilities','stdlib','examples','knowledge','doctor']) expect(help).toContain(`  ${command}`);
 });
 it('projects the compiler-owned standard-library names without a source file',()=>{
  const cli=process.cwd()+'/dist/cli/index.js';
  const result=JSON.parse(execFileSync(process.execPath,[cli,'stdlib','--json'],{encoding:'utf8'}));
  expect(result).toMatchObject({version:'bmec.stdlib.v1',languageVersion:'0.1',functions:expect.arrayContaining(['parseInteger','randomId','dateYear','currentTime','today','randomNumber','randomInteger'])});
  expect(result.functions).toEqual([...result.functions].sort());
  expect(result.functions).not.toContain('databaseSelect');
  expect(result.functions).toEqual(expect.arrayContaining(['environmentText','environmentSecret','revealSecret','environmentInteger','environmentBoolean','uploadFilename','uploadMediaType','uploadSize','saveUpload']));
  expect(result.contracts).toEqual(expect.arrayContaining([expect.objectContaining({name:'textReplace',arity:3,arguments:['text','text','text'],returns:'text'}),expect.objectContaining({name:'power',arity:2,arguments:['number','number'],returns:'number'}),expect.objectContaining({name:'sqrt',arity:1,arguments:['number'],returns:'number'}),expect.objectContaining({name:'encodeJson',arity:1,arguments:['T'],returns:'text'}),expect.objectContaining({name:'decodeJson',arity:1,arguments:['text'],returns:'result<T,text>'}),expect.objectContaining({name:'httpRequestJson',arity:7,returns:'task<result<T,text>>',capabilities:['http']}),expect.objectContaining({name:'sendEmail',arity:4,returns:'task<result<boolean,text>>',capabilities:['email']}),expect.objectContaining({name:'delay',arity:2,returns:'task<result<boolean,text>>',capabilities:['time']}),expect.objectContaining({name:'randomId',capabilities:['random'],returns:'id'}),expect.objectContaining({name:'randomInteger',arity:3,arguments:['capability<random>','integer','integer'],returns:'integer',capabilities:['random']})]));
  expect(result.contracts.map((entry:{name:string})=>entry.name)).toEqual(result.functions);
 });
 it('keeps stdlib and ai-spec projections exactly in parity',()=>{
  const cli=process.cwd()+'/dist/cli/index.js';
  const stdlib=JSON.parse(execFileSync(process.execPath,[cli,'stdlib','--json'],{encoding:'utf8'}));
  const spec=JSON.parse(execFileSync(process.execPath,[cli,'ai-spec','--json'],{encoding:'utf8'}));
  expect(spec.stdlib).toEqual(stdlib.functions);
  expect(spec.stdlibContracts).toEqual(stdlib.contracts);
  expect(stdlib.contracts.filter((contract:{capabilities?:string[]})=>contract.capabilities).every((contract:{capabilities?:string[]})=>contract.capabilities!.every((capability)=>['http','database','environment','time','random','secureRandom','filesystem','email'].includes(capability)))).toBe(true);
 });
 it('publishes deterministic runnable examples with valid BMEC source',()=>{
  const cli=process.cwd()+'/dist/cli/index.js';
  const first=execFileSync(process.execPath,[cli,'examples','--json'],{encoding:'utf8'});
  expect(execFileSync(process.execPath,[cli,'examples','--json'],{encoding:'utf8'})).toBe(first);
  const catalog=JSON.parse(first);
  expect(catalog).toMatchObject({schemaVersion:'bmec.examples.v1',languageVersion:'0.1',examples:expect.arrayContaining([expect.objectContaining({id:'EXAMPLE-HELLO-001',name:'hello-world'}),expect.objectContaining({id:'EXAMPLE-RECORD-001',name:'typed-record-and-json'}),expect.objectContaining({id:'EXAMPLE-TODO-001',name:'todo-model-and-page'}),expect.objectContaining({id:'EXAMPLE-DASHBOARD-001',name:'controlled-english-dashboard'}),expect.objectContaining({id:'EXAMPLE-LOG-001',name:'log-analyzer'})])});
  expect(new Set(catalog.examples.map((item:{id:string})=>item.id)).size).toBe(catalog.examples.length);
  const root=mkdtempSync(join(tmpdir(),'bmec-public-examples-'));
  for(const example of catalog.examples as Array<{name:string;fileName:string;source:string}>){
   expect(example.source.length).toBeGreaterThan(0);
   const directory=join(root,example.name);mkdirSync(directory,{recursive:true});
   const file=join(directory,example.fileName);writeFileSync(file,example.source);
   expect(execFileSync(process.execPath,[cli,'check',file],{encoding:'utf8'})).toContain('OK');
  }
 });
 it('publishes structured core construct contracts with compiler-valid examples',()=>{
  const cli=process.cwd()+'/dist/cli/index.js';
  const first=execFileSync(process.execPath,[cli,'ai-spec','--json'],{encoding:'utf8'});
  expect(execFileSync(process.execPath,[cli,'ai-spec','--json'],{encoding:'utf8'})).toBe(first);
  const catalog=JSON.parse(first).constructs as typeof AI_LANGUAGE_CONSTRUCTS;
  expect(catalog).toHaveLength(AI_LANGUAGE_CONSTRUCTS.length);
  for(const construct of catalog){
   expect(construct).toMatchObject({id:expect.any(String),name:expect.any(String),purpose:expect.any(String),syntax:expect.any(String),types:expect.any(Array),constraints:expect.any(Array),errors:expect.any(Array),example:expect.any(String),related:expect.any(Array),properties:expect.any(Array),events:expect.any(Array),effects:expect.any(Array)});
   const source=construct.example.startsWith('app ')?construct.example:`app CatalogFixture\n${construct.example}`;
   const result=compile(source,`<${construct.id}>`);
   expect(result.diagnostics,`${construct.id}: ${JSON.stringify(result.diagnostics)}`).toEqual([]);
  }
 });
 it('projects validated styles through the dedicated JSON command',()=>{
  const cli=process.cwd()+'/dist/cli/index.js';
  const dir=mkdtempSync(join(tmpdir(),'bmec-ai-styles-'));
  const file=join(dir,'main.bmec');
  writeFileSync(file,'app Styled\nstyle named Card { layout is grid gap is 16 on small screens { columns is 1 } }\n');
  const styles=JSON.parse(execFileSync(process.execPath,[cli,'styles',file,'--json'],{encoding:'utf8'}));
  expect(styles).toMatchObject({schemaVersion:'bmec.styles.v1',languageVersion:'0.1',styles:[expect.objectContaining({name:'Card',layout:'grid',gap:16,responsiveColumns:1})]});
 });
 it('versions deterministic project and source projection envelopes',()=>{
  const cli=process.cwd()+'/dist/cli/index.js';
  const dir=mkdtempSync(join(tmpdir(),'bmec-projection-schemas-'));
  const file=join(dir,'main.bmec');
  writeFileSync(file,'app Demo\nmodel Item { name text required ownerAuthId text? }\npage Home { crud Item excluding ownerAuthId }\napi /items from Item\nstyle named Card layout is grid\n');
  const cases=[['project','bmec.project.v1',''],['symbols','bmec.symbols.v1','symbols'],['types','bmec.types.v1','types'],['models','bmec.models.v1','models'],['routes','bmec.routes.v1','routes'],['pages','bmec.pages.v1','pages'],['styles','bmec.styles.v1','styles'],['capabilities','bmec.used-capabilities.v1','capabilities']] as const;
  for(const [command,schemaVersion,payload] of cases){
   const args=command==='project'||command==='symbols'?[command,file,'--json']:[command,file,'--json'];
   const first=execFileSync(process.execPath,[cli,...args],{encoding:'utf8'});
   expect(execFileSync(process.execPath,[cli,...args],{encoding:'utf8'})).toBe(first);
   const value=JSON.parse(first);
   expect(value.schemaVersion).toBe(schemaVersion);
   expect(value.languageVersion).toBe('0.1');
   if(payload)expect(value[payload]).toBeInstanceOf(Array);
  }
  const pages=JSON.parse(execFileSync(process.execPath,[cli,'pages',file,'--json'],{encoding:'utf8'}));expect(pages.pages[0].crudDetails[0]).toMatchObject({name:'Item',excludedFields:['ownerAuthId']});
 });
 it('documents graph query JSON contracts for AI tooling',()=>{
  const spec=readFileSync('ai/ai-spec.md','utf8');
  expect(spec).toContain('### Page content and components');
  expect(spec).toContain('A page body cannot contain a bare text statement.');
  expect(compile('app PageContentGuidance\ncomponent Heading { text "Welcome" }\npage Home { use Heading }').diagnostics).toEqual([]);
  expect(spec).toContain('Use `bmec repl` for the compiler-backed interactive session');
  expect(spec).toContain('`:help` lists `:type NAME`, `:stdlib`, `:capabilities`, `:reset`, and `:quit`');
  expect(spec).toContain('The compiler-backed REPL also supports `:scope`');
  expect(spec).toContain('canonical compiler order');
  expect(spec).toContain('application root, module roots, nested UI nodes in source order');
  expect(spec).toContain('returns one canonical graph node object');
  expect(spec).toContain('returns a deterministic JSON array');
  expect(spec).toContain('package-qualified `modules[].id` values');
  expect(spec).toContain('`modules[].imports` module edges');
  expect(spec).toContain('PIPE-AI-001');
  expect(spec).toContain('These projections remain deterministic when the entry module imports a declared local package');
  expect(spec).toContain('Structured diagnostic JSON uses `schemaVersion: "bmec.diagnostics.v1"`');
  expect(spec).toContain('Every diagnostic includes `code`, `severity`, `message`, `file`, `line`, `column`, and `span`');
  expect(spec).toContain('`repair` (`{type,value}` for a compiler-known repair)');
  expect(spec).toContain('Consumers should use `code` and structured fields for repair decisions');
  expect(spec).toContain('The JSON spec exposes the same contract through `diagnosticEnvelope`');
 });
});
