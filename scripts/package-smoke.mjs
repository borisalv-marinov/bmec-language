import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execNpm} from './npm-runner.mjs';

const root=mkdtempSync(join(tmpdir(),'bmec-package-smoke-'));
const install=join(root,'install');
const source=join(root,'main.bmec');
const archive=process.env.BMEC_PACKAGE_ARCHIVE?resolve(process.env.BMEC_PACKAGE_ARCHIVE):(()=>{const tarball=execNpm(['pack','--pack-destination',root,'--json'],{encoding:'utf8'});return join(root,JSON.parse(tarball)[0].filename)})();
if(!existsSync(archive)) throw new Error(`BMEC package archive does not exist: ${archive}`);
writeFileSync(source,'app Smoke\nmodel Item { name text required }\npage Main { crud Item }\n');
execNpm(['install','--prefix',install,'--no-audit','--no-fund',archive],{stdio:'inherit'});
const cli=join(install,'node_modules','bmec','dist','cli','index.js');
if(!existsSync(cli)) throw new Error('packed BMEC CLI is missing');
const barePageText=join(root,'bare-page-text.bmec');
writeFileSync(barePageText,'app PackageSmoke\npage Home { text "Welcome" }\n');
const barePageResult=spawnSync(process.execPath,[cli,'check',barePageText,'--json'],{encoding:'utf8'});
if(barePageResult.status!==1) throw new Error('packed BMEC accepted bare text as a page statement');
const barePageDiagnostic=JSON.parse(barePageResult.stderr).diagnostics?.[0];
if(barePageDiagnostic?.code!=='PIPE-SYN-003'||!barePageDiagnostic.message.includes('bare text statements')||!barePageDiagnostic.suggestions?.some(suggestion=>suggestion.includes('component Heading { text "Welcome" }'))) throw new Error('packed BMEC is missing the actionable page-text diagnostic');
const correctedPage=join(root,'component-page-text.bmec');
writeFileSync(correctedPage,'app PackageSmoke\ncomponent Heading { text "Welcome" }\npage Home { use Heading }\n');
const correctedPageResult=JSON.parse(execFileSync(process.execPath,[cli,'check',correctedPage,'--json'],{encoding:'utf8'}));
if(correctedPageResult.ok!==true) throw new Error('packed BMEC rejected the suggested component-based page text form');
const discardedAwait=join(root,'discarded-await.bmec');
writeFileSync(discardedAwait,'app PackageSmoke\nmodel Item { name text required }\nasync function seed(db capability<database>) -> task<integer> {\n  let item = Item { name: "Book" }\n  await add item to Item using db\n  return 1\n}\n');
const discardedAwaitResult=spawnSync(process.execPath,[cli,'check',discardedAwait,'--json'],{encoding:'utf8'});
if(discardedAwaitResult.status!==1) throw new Error('packed BMEC accepted a standalone awaited database operation');
const discardedAwaitDiagnostic=JSON.parse(discardedAwaitResult.stdout||discardedAwaitResult.stderr).diagnostics?.[0];
if(discardedAwaitDiagnostic?.code!=='PIPE-SYN-005'||!discardedAwaitDiagnostic.message.includes('cannot stand alone')||!discardedAwaitDiagnostic.suggestions?.some(suggestion=>suggestion.includes('let inserted = await add'))) throw new Error('packed BMEC is missing the actionable standalone-await diagnostic');
const boundAwait=join(root,'bound-await.bmec');
writeFileSync(boundAwait,'app PackageSmoke\nmodel Item { name text required }\nasync function seed(db capability<database>) -> task<integer> {\n  let item = Item { name: "Book" }\n  let inserted = await add item to Item using db\n  return inserted\n}\n');
const boundAwaitResult=JSON.parse(execFileSync(process.execPath,[cli,'check',boundAwait,'--json'],{encoding:'utf8'}));
if(boundAwaitResult.ok!==true) throw new Error(`packed BMEC rejected the suggested bound-await form: ${JSON.stringify(boundAwaitResult.diagnostics)}`);
const publicGuides=['docs/INSTALL.md','docs/BMEC_EDITOR_SETUP.md','docs/language-completion.md','docs/AI_AGENT_GUIDE.md','docs/GETTING_STARTED.md','docs/LEARNING_PATH.md','docs/LANGUAGE_BASICS.md','docs/FULL_STACK_GUIDE.md','docs/CUSTOM_APP_READING_QUEUE.md','docs/CAPABILITIES.md','docs/NATIVE_BACKEND_COVERAGE.md','docs/CAPABILITY_COVERAGE.md','docs/SHOWCASE.md','docs/CLI_REFERENCE.md','docs/STANDARD_LIBRARY.md','docs/STYLING_GUIDE.md','docs/SECURITY_MODEL.md','docs/THREAT_MODEL.md','docs/DATABASE_PRODUCTION.md','docs/DEPLOYMENT.md'];
for(const guide of publicGuides){if(!existsSync(join(install,'node_modules','bmec',guide))) throw new Error(`packed BMEC public guide is missing: ${guide}`);}
const readmeText=readFileSync(join(install,'node_modules','bmec','README.md'),'utf8');
for(const file of ['LICENSE','NOTICE'])if(!existsSync(join(install,'node_modules','bmec',file)))throw new Error(`packed BMEC is missing ${file}`);
for(const guide of publicGuides){if(!readmeText.includes(guide)) throw new Error(`packed BMEC README does not link ${guide}`);}
for(const match of readmeText.matchAll(/\]\(([^)]+)\)/g)){
 const target=match[1].split('#')[0];
 if(!target||target.startsWith('http:')||target.startsWith('https:')||target.startsWith('/')) continue;
 if(['website/README.md','examples/','ARCHITECTURE.md','ROADMAP.md','CONTRIBUTING.md','SUPPORT.md','SECURITY.md','CODE_OF_CONDUCT.md','CHANGELOG.md','RELEASE_NOTES.md'].includes(target))continue;
 if(!existsSync(join(install,'node_modules','bmec',target))) throw new Error(`packed BMEC README has a broken local link: ${match[1]}`);
}
const guideRoot=join(install,'node_modules','bmec','docs');
const starterGuide=readFileSync(join(guideRoot,'GETTING_STARTED.md'),'utf8');
const basicsGuide=readFileSync(join(guideRoot,'LANGUAGE_BASICS.md'),'utf8');
const learningGuide=readFileSync(join(guideRoot,'LEARNING_PATH.md'),'utf8');
const learningSnippets=[...learningGuide.matchAll(/```bmec\s*\r?\n([\s\S]*?)\r?\n```/g)].map(match=>match[1]);
if(learningSnippets.length<10) throw new Error('packed BMEC learning path is missing compiler-checkable examples');
for(const [index,source] of learningSnippets.entries()){
 const file=join(root,`learning-path-${index+1}.bmec`);writeFileSync(file,source);
 const result=JSON.parse(execFileSync(process.execPath,[cli,'check',file,'--json'],{encoding:'utf8'}));
 if(result.ok!==true) throw new Error(`installed BMEC CLI rejected learning-path example ${index+1}: ${JSON.stringify(result.diagnostics)}`);
}
for(const match of learningGuide.matchAll(/\]\(([^)]+)\)/g)){
 const target=match[1].split('#')[0];
 if(!target||target.startsWith('http:')||target.startsWith('https:')||target.startsWith('/')) continue;
 if(!existsSync(join(guideRoot,target))) throw new Error(`packed BMEC learning path has a broken local link: ${match[1]}`);
}
const starterExample=starterGuide.match(/```bmec\s*\r?\n([\s\S]*?)\r?\n```/)?.[1];
const basicsSection=basicsGuide.split('## Absence and expected failures')[1]??'';
const basicsExample=basicsSection.match(/```bmec\s*\r?\n([\s\S]*?)\r?\n```/)?.[1];
for(const [name,source] of [['getting-started',starterExample],['language-basics',basicsExample]]){
 if(!source) throw new Error(`packed BMEC ${name} guide is missing its checked example`);
 const file=join(root,`${name}.bmec`);writeFileSync(file,source);
 const result=JSON.parse(execFileSync(process.execPath,[cli,'check',file,'--json'],{encoding:'utf8'}));
 if(result.ok!==true) throw new Error(`installed BMEC CLI rejected the ${name} guide example: ${JSON.stringify(result.diagnostics)}`);
}
const aiReference=readFileSync(join(install,'node_modules','bmec','ai','ai-spec.md'),'utf8');
if(!aiReference.includes('### Page content and components')||!aiReference.includes('A page body cannot contain a bare text statement.')) throw new Error('packed BMEC AI reference is missing page-content guidance');
if(!aiReference.includes('databaseCountWhere')) throw new Error('packed BMEC AI reference is missing databaseCountWhere');
if(!aiReference.includes('where id is jobId')) throw new Error('packed BMEC AI reference is missing implicit model-ID query guidance');
if(!aiReference.includes('Model API authorization')) throw new Error('packed BMEC AI reference is missing model API authorization guidance');
if(!aiReference.includes('repeats every dynamic parameter on its base source route')) throw new Error('packed BMEC AI reference is missing scoped search guidance');
if(!aiReference.replace(/\s+/g,' ').includes('manually constructed model values returned by an in-memory function may omit `id` in JSON')) throw new Error('packed BMEC AI reference is missing generated-ID availability guidance for in-memory rows');
const aiSpec=JSON.parse(execFileSync(process.execPath,[cli,'ai-spec','--json'],{encoding:'utf8'}));
const knowledge=JSON.parse(execFileSync(process.execPath,[cli,'knowledge','send email','--json'],{encoding:'utf8'}));
if(knowledge.schemaVersion!=='bmec.knowledge-context.v1'||!knowledge.relevant_symbols.some(symbol=>symbol.id==='STDLIB-sendEmail')) throw new Error('packed BMEC is missing its task-specific knowledge context command');
if(!existsSync(join(install,'node_modules','bmec','llms.txt'))||!existsSync(join(install,'node_modules','bmec','ai','knowledge-index.json'))) throw new Error('packed BMEC is missing its machine-readable AI entry points');
if(!aiSpec.constructs.some(construct=>construct.id==='DB-COUNT-001')) throw new Error('packed BMEC machine spec is missing DB-COUNT-001');
if(!aiSpec.constructs.some(construct=>construct.id==='DB-QUERY-001'&&construct.syntax.includes('or')&&construct.constraints.some(item=>item.includes('case-sensitive literal substring')))) throw new Error('packed BMEC machine spec is missing typed literal text search');
if(!aiSpec.constructs.some(construct=>construct.id==='LANG-API-001'&&construct.syntax.includes('requiring authenticated'))) throw new Error('packed BMEC machine spec is missing model API authorization');
if(!aiSpec.constructs.some(construct=>construct.id==='HTTP-RESULT-STATUS-001'&&construct.syntax.includes('serve POST /jobs requiring role admin and database returns 200 errors 400 with create'))) throw new Error('packed BMEC machine spec is missing the combined controlled-English error-route example');
if(!aiSpec.constructs.some(construct=>construct.id==='UI-PAGE-ROUTE-001'&&construct.syntax.includes('at "/articles/:slug"'))) throw new Error('packed BMEC machine spec is missing typed dynamic page routes');
if(!aiSpec.constructs.some(construct=>construct.id==='UI-PAGE-ACTION-001'&&construct.syntax.includes('productId from product.id')&&construct.constraints.some(item=>item.includes('repeated-list button')))) throw new Error('packed BMEC machine spec is missing typed repeated-row action guidance');
if(!aiSpec.constructs.some(construct=>construct.id==='UI-PAGE-STATE-UPDATE-001'&&construct.syntax.includes('persisted in local storage'))) throw new Error('packed BMEC machine spec is missing typed local-state update guidance');
if(!aiSpec.constructs.some(construct=>construct.id==='UI-PAGE-STATE-UPDATE-001'&&construct.constraints.some(item=>item.includes('manually constructed model values returned by an in-memory function may omit `id` in JSON')))) throw new Error('packed BMEC machine spec is missing generated-ID availability guidance for in-memory rows');
if(!aiReference.includes('event add(product Product) appends product to cart')) throw new Error('packed BMEC AI reference is missing typed local-state update guidance');
if(!aiReference.includes('link "Read article" to Article with slug post.slug')) throw new Error('packed BMEC AI reference is missing dynamic page-link binding guidance');
const dynamicPageSource=join(root,'dynamic-page-route.bmec');
writeFileSync(dynamicPageSource,'app PackageSmoke\nmodel Post { title text slug text required unique }\ncomponent PostRow { link "Read" to Article with slug post.slug }\nasync function bySlug(db capability<database>, slug text) -> task<list<Post>> { return wait for get posts from Post where slug is slug ordered by title ascending limited to 1 using db }\nhttp GET /posts/:slug requires database -> bySlug\npage Articles { state posts list<Post> for each post in posts show PostRow }\npage Article at "/posts/:slug" { state posts list<Post> from GET "/posts/:slug" for each post in posts show post title }\n');
if(!execFileSync(process.execPath,[cli,'check',dynamicPageSource],{encoding:'utf8'}).includes('OK')) throw new Error('packed BMEC cannot compile typed dynamic page routes and page-state GET sources');
const localStateDir=join(root,'local-state');mkdirSync(localStateDir);
const localStateSource=join(localStateDir,'main.bmec');
writeFileSync(localStateSource,'app PackageSmoke\nmodel Product { name text required }\ncomponent ProductRow { button "Add" on add with product from product }\npage Store { event add(product Product) appends product to cart state cart list<Product> = [] persisted in local storage state products list<Product> for each product in products show ProductRow }\n');
if(!execFileSync(process.execPath,[cli,'check',localStateSource],{encoding:'utf8'}).includes('OK')) throw new Error('packed BMEC cannot compile typed local list updates and browser persistence');
execFileSync(process.execPath,[cli,'build',localStateSource,'--release'],{stdio:'inherit'});
const stateRelease=join(localStateDir,'release'),stateHtml=readFileSync(join(stateRelease,'index.html'),'utf8'),stateBundle=readFileSync(join(stateRelease,'app.js'),'utf8');
if(!stateHtml.includes('data-pipe-state-update')||!stateBundle.includes('PIPE_UI_APPLY_STATE_UPDATE')||!stateBundle.includes('bmec-state:')) throw new Error('packed BMEC release is missing typed local-state update or persistence runtime');
const successStateDir=join(root,'success-state');mkdirSync(successStateDir);
const successStateSource=join(successStateDir,'main.bmec');
writeFileSync(successStateSource,'app PackageSmoke\ntype CartLine { productId id quantity integer }\ntype CheckoutRequest { token text }\nfunction placeOrder(body CheckoutRequest) -> text { return body.token }\nhttp POST /checkout -> placeOrder\ncomponent CheckoutForm form { input token text button "Place order" on checkout }\npage Store { state cart list<CartLine> = [] persisted in local storage event checkout(token text) sends POST "/checkout" then clears cart on success use CheckoutForm }\n');
if(!execFileSync(process.execPath,[cli,'check',successStateSource],{encoding:'utf8'}).includes('OK')) throw new Error('packed BMEC cannot type-check a post-success persisted-list clear');
execFileSync(process.execPath,[cli,'build',successStateSource,'--release'],{stdio:'inherit'});
const successBundle=readFileSync(join(successStateDir,'release','app.js'),'utf8');
if(!successBundle.includes('successUpdate')||!successBundle.includes('PIPE_UI_APPLY_STATE_UPDATE')||!successBundle.includes('saved list could not be cleared')) throw new Error('packed BMEC release is missing post-success list clearing or its persistence-failure status');
const idFilterSource=join(root,'implicit-id-filter.bmec');
writeFileSync(idFilterSource,'app PackageSmoke\nmodel Job { title text required }\nasync function findJob(db capability<database>, jobId integer) -> task<list<Job>> { return wait for get items from Job where id is jobId using db }\n');
if(!execFileSync(process.execPath,[cli,'check',idFilterSource],{encoding:'utf8'}).includes('OK')) throw new Error('packed BMEC cannot compile a filtered read by the implicit model ID');
const memberValueFilterSource=join(root,'member-value-filter.bmec');
writeFileSync(memberValueFilterSource,'app PackageSmoke\nmodel Product { sku text required unique stock integer required }\ntype Line { productId integer }\nasync function findProduct(db capability<database>, line Line) -> task<list<Product>> { return wait for get products from Product where id is line.productId using db }\nasync function findId(db capability<database>, sku text) -> task<integer?> { let products = await get products from Product where sku is sku using db let product = first(products) if product != none { return product.id } else { return none } }\nasync function reserve(db capability<database>, productId integer, quantity integer) -> task<integer> { return await databaseDecrementWhere(db, "Product", "stock", quantity, "id", productId) }\n');
if(!execFileSync(process.execPath,[cli,'check',memberValueFilterSource],{encoding:'utf8'}).includes('OK')) throw new Error('packed BMEC cannot compile member-valued product filtering and generated-ID stock reservation');
const textSearchSource=join(root,'literal-text-search.bmec');
writeFileSync(textSearchSource,'app PackageSmoke\nmodel Issue { title text required description text required }\nasync function search(db capability<database>, term text) -> task<list<Issue>> { return wait for get issues from Issue where title contains term or description contains term ordered by title ascending limited to 100 using db }\n');
if(!execFileSync(process.execPath,[cli,'check',textSearchSource],{encoding:'utf8'}).includes('OK')) throw new Error('packed BMEC cannot compile a typed literal text search query');
const scopedCursorSource=join(root,'scoped-cursor-query.bmec');
writeFileSync(scopedCursorSource,'app PackageSmoke\nmodel Task { workspaceId integer required ownerAuthId text required title text required }\nasync function nextTasks(db capability<database>, workspace integer, owner text, after integer) -> task<list<Task>> { return wait for get tasks from Task where workspaceId is workspace and ownerAuthId is owner and id is greater than after ordered by id ascending limited to 50 using db }\n');
if(!execFileSync(process.execPath,[cli,'check',scopedCursorSource],{encoding:'utf8'}).includes('OK')) throw new Error('packed BMEC cannot compile a three-predicate owner/workspace/cursor query');
const cursorUiSource=join(root,'integer-cursor-ui.bmec');
writeFileSync(cursorUiSource,'app PackageSmoke\nmodel Task { title text required }\nasync function first(db capability<database>) -> task<list<Task>> { return wait for get tasks from Task ordered by id ascending limited to 50 using db }\nasync function after(db capability<database>, after integer) -> task<list<Task>> { return wait for get tasks from Task where id is greater than after ordered by id ascending limited to 50 using db }\napi /tasks from Task\nhttp GET /tasks requires database -> first\nhttp GET /tasks/pages/:after requires database -> after\npage Dashboard { state tasks list<Task> from GET "/tasks" next GET "/tasks/pages/:after" cursor by id crud Task }\n');
if(!execFileSync(process.execPath,[cli,'check',cursorUiSource],{encoding:'utf8'}).includes('OK')) throw new Error('packed BMEC cannot compile generated CRUD paging with the integer model ID cursor');
const rowActionSource=join(root,'typed-row-action.bmec');
writeFileSync(rowActionSource,'app PackageSmoke\nmodel Product { sku text required quantity integer required }\nmodel CartLine { productId integer required quantity integer required }\napi /cart-lines from CartLine\ncomponent ProductRow { button "Add" on add with productId from product.id and quantity from product.quantity }\npage Store { event add(productId integer, quantity integer) sends POST "/cart-lines" state products list<Product> for each product in products show ProductRow }\n');
if(!execFileSync(process.execPath,[cli,'check',rowActionSource],{encoding:'utf8'}).includes('OK')) throw new Error('packed BMEC cannot compile typed action bindings from repeated-list fields');
const scopedSearchUiSource=join(root,'scoped-search-ui.bmec');
writeFileSync(scopedSearchUiSource,'app PackageSmoke\nmodel Issue { repositorySlug text title text description text }\nasync function first(db capability<database>, slug text) -> task<list<Issue>> { return wait for get issues from Issue where repositorySlug is slug ordered by id ascending limited to 50 using db }\nasync function search(db capability<database>, slug text, term text) -> task<list<Issue>> { return wait for get issues from Issue where repositorySlug is slug and (title contains term or description contains term) ordered by id ascending limited to 50 using db }\nasync function after(db capability<database>, slug text, term text, after integer) -> task<list<Issue>> { return wait for get issues from Issue where repositorySlug is slug and (title contains term or description contains term) and id is greater than after ordered by id ascending limited to 50 using db }\nhttp GET /repositories/:slug/issues requires database -> first\nhttp GET /repositories/:slug/issues/search/:term requires database -> search\nhttp GET /repositories/:slug/issues/search/:term/pages/:after requires database -> after\ncomponent IssueRow { show issue title }\npage Issues at "/repositories/:slug/issues" { state issues list<Issue> from GET "/repositories/:slug/issues" search GET "/repositories/:slug/issues/search/:term" next GET "/repositories/:slug/issues/search/:term/pages/:after" cursor by id for each issue in issues show IssueRow filter by title }\n');
if(!execFileSync(process.execPath,[cli,'check',scopedSearchUiSource],{encoding:'utf8'}).includes('OK')) throw new Error('packed BMEC cannot compile scoped server-side search and cursor routes');
const resultRouteSource=join(root,'controlled-result-route.bmec');
writeFileSync(resultRouteSource,'app PackageSmoke\nasync function create(db capability<database>) -> task<result<integer,text>> { return err("invalid_input") }\nserve POST /jobs requiring role admin and database returns 200 errors 400 with create\n');
if(!execFileSync(process.execPath,[cli,'check',resultRouteSource],{encoding:'utf8'}).includes('OK')) throw new Error('packed BMEC cannot compile a role-protected controlled-English Result status route');
const resultTransactionSource=join(root,'result-transaction-assignment.bmec');
writeFileSync(resultTransactionSource,'app PackageSmoke\nmodel Item { name text required unique }\ntype Receipt { itemId integer }\nasync function checkout(db capability<database>, name text) -> task<result<Receipt,text>> { var itemId integer = 0 transaction using db { let item = Item { name: name } itemId = await add item to Item using db } return ok(Receipt { itemId: itemId }) }\n');
if(!execFileSync(process.execPath,[cli,'check',resultTransactionSource],{encoding:'utf8'}).includes('OK')) throw new Error('packed BMEC cannot compile a Result-returning transaction assignment after a record initializer');
const apiPolicySource=join(root,'model-api-policy.bmec');
writeFileSync(apiPolicySource,'app PackageSmoke\nmodel Item { name text required }\napi /items from Item requiring authenticated\n');
const apiPolicyRoutes=JSON.parse(execFileSync(process.execPath,[cli,'routes',apiPolicySource,'--json'],{encoding:'utf8'}));
if(apiPolicyRoutes.routes.length!==5||apiPolicyRoutes.routes.some(route=>route.policyId!=='authenticated')) throw new Error('packed BMEC does not protect every generated model CRUD route');
const env={...process.env,BMEC_PORT:'0'};
const examples=JSON.parse(execFileSync(process.execPath,[cli,'examples','--json'],{encoding:'utf8',env}));
if(examples.schemaVersion!=='bmec.examples.v1'||!Array.isArray(examples.examples)||examples.examples.length===0) throw new Error('packed bmec examples catalog is unavailable');
for(const example of examples.examples){const file=join(root,`${example.name}.bmec`);writeFileSync(file,example.source);if(!execFileSync(process.execPath,[cli,'check',file],{encoding:'utf8',env}).includes('OK'))throw new Error(`packed example failed check: ${example.name}`);}
const created=execFileSync(process.execPath,[cli,'new',join(root,'starter')],{encoding:'utf8',env});
if(!created.includes('Created')) throw new Error('packed bmec new failed');
const doctor=JSON.parse(execFileSync(process.execPath,[cli,'doctor',join(root,'starter'),'--json'],{encoding:'utf8',env}));
if(doctor.schemaVersion!=='bmec.doctor.v1'||doctor.status!=='pass') throw new Error(`packed bmec doctor failed: ${JSON.stringify(doctor)}`);
if(!execFileSync(process.execPath,[cli,'check',source],{encoding:'utf8',env}).includes('OK')) throw new Error('packed bmec check failed');
execFileSync(process.execPath,[cli,'build',source,'--release'],{stdio:'inherit',env});
const child=spawn(process.execPath,[cli,'run',source],{env,stdio:['ignore','pipe','pipe']});
let output='';
child.stdout.on('data',chunk=>{output+=chunk.toString();});
child.stderr.on('data',chunk=>{output+=chunk.toString();});
try{
  const deadline=Date.now()+15000;
  let url;
  while(Date.now()<deadline&&!url){const match=output.match(/http:\/\/[^\s]+/);if(match)url=match[0];else await new Promise(resolve=>setTimeout(resolve,100));}
  if(!url) throw new Error(`packed bmec run did not start: ${output}`);
  const response=await fetch(url);if(response.status!==200)throw new Error(`packed bmec run returned ${response.status}`);
  console.log(`PACKAGE_SMOKE PASS — installed tarball, created project, doctor/check/release passed, and served ${url}`);
}finally{
  child.kill();
  await new Promise(resolve=>child.once('exit',resolve));
  rmSync(root,{recursive:true,force:true});
}
