import {execFileSync} from 'node:child_process';
import Database from 'better-sqlite3';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {compile,compileProject} from '../dist/compiler.js';
import {buildRelease} from '../dist/release/release.js';
import {ensureSqliteSchema} from '../dist/db/sqlite.js';
import {sqliteAdapter} from '../dist/db/adapter.js';
import {startNodeHttpSource} from '../dist/http/node-adapter.js';
import {issueCapability} from '../dist/runtime/capabilities.js';

const root = mkdtempSync(join(tmpdir(), 'bmec-data-explorer-ui-'));
const playwrightDir = mkdtempSync(join(tmpdir(), 'bmec-data-explorer-playwright-'));
let handle;
let supportHandle;
let storeHandle;
let browser;
let db;
let storeDb;
try {
  const project = compileProject(join(process.cwd(), 'examples', 'data-explorer', 'main.pipe'));
  if (project.diagnostics.length) throw new Error(`Data Explorer compile failed: ${project.diagnostics.map(item => item.code).join(', ')}`);
  const dbPath = join(root, 'explorer.sqlite');
  const generated = join(root, 'generated');
  const release = buildRelease(project.ir, generated, {packageName: 'data-explorer', packageVersion: '0.7.0', languageVersion: '0.1'});
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  ensureSqliteSchema(db, project.ir.db);
  db.prepare('INSERT INTO "Region" (name) VALUES (?), (?)').run('Browser test region 0', 'Browser test region 1');
  const insertRecord = db.prepare('INSERT INTO "ExplorerRecord" (name, category, region, value, active) VALUES (?, ?, ?, ?, ?)');
  for (let index = 0; index < 120; index++) insertRecord.run(`Browser sourced record ${String(index).padStart(3, '0')}`, `Browser ${index % 2}`, index % 2 + 1, index, 1);
  handle = await startNodeHttpSource(project.ir, {port: 0, publicDirectory: generated, capabilityTokens: new Map([['database', issueCapability('database')]]), database: {adapter: sqliteAdapter(db, project.ir.db), schema: project.ir.db}});

  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--prefix', playwrightDir, '--no-save', '--ignore-scripts', 'playwright@1.63.0'], {stdio: 'inherit', shell: process.platform === 'win32'});
  const playwright = await import(pathToFileURL(join(playwrightDir, 'node_modules', 'playwright', 'index.js')).href);
  const {chromium} = playwright.default ?? playwright;
  let needsBrowser = !existsSync(chromium.executablePath());
  if (process.platform === 'linux' && !needsBrowser) try { needsBrowser = execFileSync('ldd', [chromium.executablePath()], {encoding: 'utf8'}).includes('not found'); } catch { needsBrowser = true; }
  if (needsBrowser) execFileSync(join(playwrightDir, 'node_modules', '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright'), ['install', ...(process.platform === 'linux' ? ['--with-deps'] : []), 'chromium'], {cwd: playwrightDir, stdio: 'inherit', shell: process.platform === 'win32'});
  browser = await chromium.launch({headless: true});
  const page = await browser.newPage();
  const requestedRoutes = [];
  const filteredRoutes = [];
  page.on('request', request => { if (request.url().includes('/records/page')) requestedRoutes.push(new URL(request.url()).pathname); });
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/records/category/')) filteredRoutes.push(path); });
  await page.route('**/records/page', async route => { await new Promise(resolve => setTimeout(resolve, 150)); await route.continue(); });
  await page.goto(`${handle.url}/#pipe-page--explorer`, {waitUntil: 'domcontentloaded'});
  const list = page.locator('#pipe-page--explorer [data-pipe-list="records"]');
  const loading = list.locator('xpath=..').locator('[data-pipe-list-loading]');
  await loading.waitFor({state: 'visible'});
  if (await loading.getAttribute('role') !== 'status' || await list.getAttribute('aria-busy') !== 'true') throw new Error('Loading state is not announced accessibly');
  await page.waitForFunction(() => document.querySelector('#pipe-page--explorer [data-pipe-bind="summary.total"]')?.textContent === '120' && document.querySelector('#pipe-page--explorer [data-pipe-bind="summary.active"]')?.textContent === '120');
  const summaryCounts = await page.evaluate(() => ({total: document.querySelector('#pipe-page--explorer [data-pipe-bind="summary.total"]')?.textContent, active: document.querySelector('#pipe-page--explorer [data-pipe-bind="summary.active"]')?.textContent}));
  await list.locator('[data-pipe-bind="record.name"]').getByText('Browser sourced record 000').waitFor();
  if (await page.evaluate(() => { delete globalThis.PIPE_UI_STATE; return globalThis.PIPE_UI_STATE !== undefined; })) throw new Error('Data Explorer requires a global page-state adapter');
  if ((await list.locator('[data-pipe-bind="record.category"]').first().textContent()) !== 'Browser 0') throw new Error('The generated page did not render the SQLite-backed row fields');
  const cursorButton = page.locator('#pipe-page--explorer').getByRole('button', {name: 'Next page'});
  const pageCounts = [await list.locator('[data-pipe-bind="record.name"]').count()];
  const allNames = await list.locator('[data-pipe-bind="record.name"]').allTextContents();
  for (let count = 0; count < 2; count++) {
    await cursorButton.click();
    const expectedCount = count === 0 ? 50 : 20;
    await page.waitForFunction(expected => document.querySelectorAll('#pipe-page--explorer [data-pipe-bind="record.name"]').length === expected, expectedCount);
    await page.getByText(`${expectedCount} records loaded.`, {exact: true}).waitFor();
    pageCounts.push(await list.locator('[data-pipe-bind="record.name"]').count());
    allNames.push(...await list.locator('[data-pipe-bind="record.name"]').allTextContents());
    if (pageCounts.at(-1) > 50) throw new Error('The browser retained more than one bounded page of records');
  }
  if (pageCounts.join(',') !== '50,50,20') throw new Error(`Expected bounded server pages of 50, 50, and 20 rows; received ${pageCounts.join(',')}`);
  if (new Set(allNames).size !== 120 || allNames[0] !== 'Browser sourced record 000' || allNames.at(-1) !== 'Browser sourced record 119') throw new Error(`Cursor traversal produced missing, duplicate, or unordered rows: ${allNames.length} captured; first=${allNames[0]}; last=${allNames.at(-1)}; duplicates=${allNames.length - new Set(allNames).size}`);
  await cursorButton.click();
  await page.getByText('No more records.').waitFor();
  if (await cursorButton.isVisible()) throw new Error('End-of-list control should be hidden after the final empty page');
  const traversalRoutes = requestedRoutes.slice();
  await page.unroute('**/records/page');
  if (requestedRoutes.length !== 4 || requestedRoutes[0] !== '/records/page' || requestedRoutes.slice(1).some(path => !path.startsWith('/records/page/'))) throw new Error(`Expected first, next, deep, and terminal cursor requests; received ${requestedRoutes.join(', ')}`);
  await page.goto(`${handle.url}/#pipe-page--explorer`, {waitUntil: 'networkidle'});
  await page.getByRole('link', {name: 'Browse this category'}).first().click();
  const categoryList = page.locator('[data-pipe-page="/records/category/:category"] [data-pipe-list="records"]');
  await categoryList.locator('[data-pipe-bind="record.name"]').first().waitFor();
  const categoryNames = await categoryList.locator('[data-pipe-bind="record.name"]').allTextContents();
  if (categoryNames.length !== 50 || (await categoryList.locator('[data-pipe-bind="record.category"]').allTextContents()).some(category => category !== 'Browser 0')) throw new Error('The generated category route did not hydrate a bounded, correctly scoped first page');
  const categoryNext = page.locator('[data-pipe-page="/records/category/:category"] [data-pipe-cursor-state="records"]');
  await categoryNext.click();
  await page.waitForFunction(() => document.querySelectorAll('[data-pipe-page="/records/category/:category"] [data-pipe-bind="record.name"]').length === 10);
  categoryNames.push(...await categoryList.locator('[data-pipe-bind="record.name"]').allTextContents());
  if (categoryNames.length !== 60 || new Set(categoryNames).size !== 60 || categoryNames[0] !== 'Browser sourced record 000' || categoryNames.at(-1) !== 'Browser sourced record 118' || categoryNames.some((name, index) => !/^Browser sourced record \d{3}$/.test(name) || index > 0 && categoryNames[index - 1] >= name)) throw new Error(`Filtered category cursor traversal lost order or duplicated rows: ${categoryNames.length} total`);
  if (!filteredRoutes.some(path => path === '/records/category/Browser%200') || !filteredRoutes.some(path => path.startsWith('/records/category/Browser%200/pages/'))) throw new Error(`Expected filtered first and cursor requests; received ${filteredRoutes.join(', ')}`);
  const browserBundle = readFileSync(join(generated, release.artifacts.browser), 'utf8');
  if (browserBundle.includes('listRecords') || browserBundle.includes('databaseSelect') || browserBundle.includes('sqlite_autoindex')) throw new Error('Release browser artifact contains server implementation details');

  await page.goto(`${handle.url}/#pipe-page--explorer`, {waitUntil: 'networkidle'});
  await page.route('**/records/page', route => route.fulfill({status: 503, contentType: 'application/json', body: '{"error":"unavailable"}'}));
  await page.reload({waitUntil: 'networkidle'});
  const failure = page.locator('[data-pipe-list-error]:visible');
  await failure.waitFor();
  if (await failure.getAttribute('role') !== 'alert') throw new Error('Request failure is not announced as an alert');
  const evidence = {
    schemaVersion: 'bmec.page-state-cursor.v1',
    platform: `${process.platform} ${process.arch}`,
    node: process.version,
    browser: `Chromium ${browser.version()}`,
    application: 'Data Explorer',
    database: 'SQLite',
    declaredSource: 'GET /records/page',
    continuation: 'GET /records/page/:after cursor by name',
    traversedRows: allNames.length,
    pageCounts,
    summaryCounts: {route: 'GET /records/summary', ...summaryCounts},
    filteredCategoryTraversal: {route: '/records/category/:category', category: 'Browser 0', rows: categoryNames.length, pages: [50, 10], uniqueOrderedRows: new Set(categoryNames).size === 60 && categoryNames[0] === 'Browser sourced record 000' && categoryNames.at(-1) === 'Browser sourced record 118', requestPaths: filteredRoutes},
    maximumRowsHeldInBrowserAtOnce: Math.max(...pageCounts),
    uniqueOrderedTraversal: new Set(allNames).size === 120 && allNames[0] === 'Browser sourced record 000' && allNames.at(-1) === 'Browser sourced record 119',
    terminalPageAnnounced: true,
    browserFetchedOnlyDeclaredRoutes: traversalRoutes.length === 4 && traversalRoutes[0] === '/records/page' && traversalRoutes.slice(1).every(path => path.startsWith('/records/page/')),
    pipeUiStateRequired: false,
    accessibleLoadingState: true,
    accessibleFailureState: true,
    browserContainsServerImplementation: false,
  };
  mkdirSync(join(process.cwd(), 'output', 'evidence'), {recursive: true});
  writeFileSync(join(process.cwd(), 'output', 'evidence', 'bmec-0.7-page-state-cursor.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log('DATA_EXPLORER_UI PASS — 120 rows and a 60-row category filter traversed through bounded SQLite cursor pages without PIPE_UI_STATE');

  const supportSource=`app SupportDesk
type Ticket { id text subject text requester text priority text status text updated text searchable text }
function listTickets() -> list<Ticket> { return [Ticket { id: "T-1001", subject: "Cannot reset password", requester: "Mira Chen", priority: "High", status: "Open", updated: "10 minutes ago", searchable: "Cannot reset password Mira Chen" }, Ticket { id: "T-1002", subject: "Invoice shows wrong total", requester: "Luis Romero", priority: "Normal", status: "In progress", updated: "25 minutes ago", searchable: "Invoice shows wrong total Luis Romero" }, Ticket { id: "T-1003", subject: "Mobile app crashes", requester: "Nadia Patel", priority: "High", status: "Open", updated: "40 minutes ago", searchable: "Mobile app crashes Nadia Patel" }, Ticket { id: "T-1004", subject: "Update billing address", requester: "Owen Brooks", priority: "Low", status: "Resolved", updated: "1 hour ago", searchable: "Update billing address Owen Brooks" }, Ticket { id: "T-1005", subject: "Export report is blank", requester: "Eva Müller", priority: "Normal", status: "In progress", updated: "2 hours ago", searchable: "Export report is blank Eva Müller" }, Ticket { id: "T-1006", subject: "Add a second team member", requester: "Sam Okafor", priority: "Low", status: "Open", updated: "3 hours ago", searchable: "Add a second team member Sam Okafor" }] }
http GET /tickets -> listTickets
component SupportIntro { text "Support overview" text "A clear view of what needs attention from your team today." }
component SupportNav { link "Overview" to Support link "Customers" to Customers link "Knowledge base" to Knowledge link "Reports" to Reports }
component OpenMetric { text "6" text "Open" }
component ProgressMetric { text "3" text "In progress" }
component ResolvedMetric { text "12" text "Resolved today" }
component TicketSearchLabel { text "Search by subject or requester" }
component TicketRow { show ticket id show ticket subject show ticket requester show ticket priority show ticket status show ticket updated }
page Support { use style Dashboard use SupportNav use SupportIntro use OpenMetric use ProgressMetric use ResolvedMetric use TicketSearchLabel state tickets list<Ticket> from GET "/tickets" for each ticket in tickets show TicketRow filter by searchable label "Search by subject or requester" empty "No tickets match your search." }
page Customers {}
page Knowledge {}
page Reports {}
style named Dashboard { layout is column alignment is stretch gap is 16 padding is 24 when focused { show focus ring } on small screens { columns is 1 } }`;
  const supportProject=compile(supportSource,'support-dashboard-followup.pipe');
  if(supportProject.diagnostics.length)throw new Error(`T7 follow-up compile failed: ${supportProject.diagnostics.map(item=>`${item.code} ${item.message} at ${item.line}:${item.column}`).join('; ')}`);
  const supportGenerated=join(root,'support-generated');
  const supportRelease=buildRelease(supportProject.ir,supportGenerated,{packageName:'support-dashboard-followup',packageVersion:'0.7.0',languageVersion:'0.1'});
  supportHandle=await startNodeHttpSource(supportProject.ir,{port:0,publicDirectory:supportGenerated});
  const supportPage=await browser.newPage({viewport:{width:1280,height:900}});
  const supportRequests=[];
  supportPage.on('request',request=>{if(request.url().includes('/tickets'))supportRequests.push(new URL(request.url()).pathname)});
  await supportPage.route('**/tickets',async route=>{await new Promise(resolve=>setTimeout(resolve,100));await route.continue()});
  await supportPage.goto(`${supportHandle.url}/#pipe-page--support`,{waitUntil:'domcontentloaded'});
  const supportList=supportPage.locator('[data-pipe-list="tickets"]');
  const supportLoading=supportPage.locator('[data-pipe-list-loading]');
  await supportLoading.waitFor({state:'visible'});
  if(await supportLoading.getAttribute('role')!=='status'||await supportList.getAttribute('aria-busy')!=='true')throw new Error('T7 follow-up initial loading state is not announced accessibly');
  await supportList.locator('[data-pipe-bind="ticket.id"]').filter({hasText:'T-1001'}).waitFor();
  if(await supportList.locator('[data-pipe-bind="ticket.id"]').count()!==6)throw new Error('T7 follow-up did not render all six typed GET ticket rows');
  const search=supportPage.getByRole('searchbox',{name:'Search by subject or requester'});
  await search.fill('Cannot reset password');
  await supportPage.waitForFunction(()=>document.querySelectorAll('[data-pipe-bind="ticket.id"]').length===1);
  if((await supportList.locator('[data-pipe-bind="ticket.id"]').textContent())!=='T-1001')throw new Error('T7 follow-up subject filtering did not select the expected ticket');
  await search.fill('Luis Romero');
  await supportPage.waitForFunction(()=>document.querySelectorAll('[data-pipe-bind="ticket.id"]').length===1);
  if((await supportList.locator('[data-pipe-bind="ticket.id"]').textContent())!=='T-1002')throw new Error('T7 follow-up requester filtering did not select the expected ticket');
  await search.fill('no matching requester');
  await supportPage.getByText('No matching items.',{exact:true}).waitFor();
  const emptySearchAnnounced=await supportPage.getByText('No matching items.',{exact:true}).getAttribute('role')==='status';
  if(!emptySearchAnnounced)throw new Error('T7 follow-up empty-search state is not announced as a status');
  await search.fill('');
  await supportPage.waitForFunction(()=>document.querySelectorAll('[data-pipe-bind="ticket.id"]').length===6);
  await search.focus();
  const focusOutline=await search.evaluate(node=>getComputedStyle(node).outlineWidth);
  if(focusOutline!=='3px')throw new Error(`T7 follow-up focus outline was ${focusOutline}, expected 3px`);
  const desktop=await supportPage.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,viewport:innerWidth}));
  await supportPage.setViewportSize({width:390,height:844});
  const mobile=await supportPage.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,viewport:innerWidth,rows:[...document.querySelectorAll('[data-pipe-bind="ticket.id"]')].filter(node=>node.textContent?.trim()).length}));
  if(desktop.width>desktop.viewport||mobile.width>mobile.viewport||mobile.rows!==6)throw new Error(`T7 follow-up responsive check failed: ${JSON.stringify({desktop,mobile})}`);
  if(await supportPage.getByText('Support overview',{exact:true}).count()===0||await supportPage.getByText('Resolved today',{exact:true}).count()===0)throw new Error('T7 follow-up title or summary content is missing');
  if(supportRequests.length!==1||supportRequests[0]!=='/tickets')throw new Error(`T7 follow-up expected one declared GET request, got ${supportRequests.join(', ')}`);
  const supportBrowser=readFileSync(join(supportGenerated,supportRelease.artifacts.browser),'utf8');
  if(supportBrowser.includes('listTickets'))throw new Error('T7 follow-up browser artifact exposes its server handler');
  const supportEvidence={schemaVersion:'bmec.t7-page-state-followup.v1',classification:'post-feature engineering revalidation; not a fresh AI cold-start trial',platform:`${process.platform} ${process.arch}`,node:process.version,browser:`Chromium ${browser.version()}`,historicalTrialIncluded:false,declaredSource:'GET /tickets',rowsRendered:6,subjectFilter:'PASS',requesterFilter:'PASS',clearRestoresRows:'PASS',emptyState:{visible:true,role:'status'},focusOutline,desktop,mobile,requests:supportRequests,serverHandlerInBrowser:supportBrowser.includes('listTickets')};
  writeFileSync(join(process.cwd(),'output','evidence','bmec-0.7-t7-page-state-followup.json'),`${JSON.stringify(supportEvidence,null,2)}\n`);
  console.log('T7_PAGE_STATE_FOLLOWUP PASS — six typed tickets hydrated by GET; subject/requester filtering, clear, empty, focus, and desktop/mobile checks passed');

  const storeSource=`app PaperHarbor
model Product { name text required category text required price money required description text required stock integer required searchable text required }
api /products from Product
component StoreIntro { text "Paper Harbor" text "Thoughtful tools for the pages you make." }
component ProductCard { show product name show product category show product description show product price show product stock }
page Catalog { use style StoreStyle use StoreIntro state products list<Product> from GET "/products" for each product in products show ProductCard filter by searchable label "Search products and categories" empty "No products are available yet." }
style named StoreStyle { layout is grid columns is 3 gap is 16 padding is 24 on small screens { columns is 1 } }`;
  const storeProject=compile(storeSource,'paper-harbor-catalog-followup.pipe');
  if(storeProject.diagnostics.length)throw new Error(`T9 catalog follow-up compile failed: ${storeProject.diagnostics.map(item=>`${item.code} ${item.message} at ${item.line}:${item.column}`).join('; ')}`);
  const storeGenerated=join(root,'store-generated');
  const storeRelease=buildRelease(storeProject.ir,storeGenerated,{packageName:'paper-harbor-catalog-followup',packageVersion:'0.7.0',languageVersion:'0.1'});
  storeDb=new Database(join(root,'store.sqlite'));
  storeDb.pragma('foreign_keys = ON');
  ensureSqliteSchema(storeDb,storeProject.ir.db);
  const insertProduct=storeDb.prepare('INSERT INTO "Product" (name,category,price,description,stock,searchable) VALUES (?,?,?,?,?,?)');
  for(const product of [
    ['Field Notes Set','Writing',2499,'Three pocket notebooks with durable covers.',18,'Field Notes Set Writing notebooks'],
    ['Linen Journal','Journals',3200,'Lay-flat pages wrapped in linen.',9,'Linen Journal Journals linen'],
    ['Brass Bookmark','Accessories',1200,'A slim engraved brass marker.',27,'Brass Bookmark Accessories marker'],
    ['Ink Bottle','Writing',1450,'Water-resistant blue-black fountain pen ink.',14,'Ink Bottle Writing fountain pen'],
    ['Reading Journal','Journals',2800,'A guided journal for keeping reading notes.',11,'Reading Journal Journals reading notes'],
    ['Desk Calendar','Accessories',1800,'A compact calendar for a writing desk.',7,'Desk Calendar Accessories desk'],
  ])insertProduct.run(...product);
  storeHandle=await startNodeHttpSource(storeProject.ir,{port:0,publicDirectory:storeGenerated,capabilityTokens:new Map([['database',issueCapability('database')]]),database:{adapter:sqliteAdapter(storeDb,storeProject.ir.db),schema:storeProject.ir.db}});
  const storePage=await browser.newPage({viewport:{width:1280,height:900}});
  const storeRequests=[];
  storePage.on('request',request=>{if(request.url().includes('/products'))storeRequests.push(new URL(request.url()).pathname)});
  await storePage.goto(`${storeHandle.url}/#pipe-page--catalog`,{waitUntil:'domcontentloaded'});
  const productList=storePage.locator('[data-pipe-list="products"]');
  await productList.locator('[data-pipe-bind="product.name"]').getByText('Field Notes Set').waitFor();
  if(await productList.locator('[data-pipe-bind="product.name"]').count()!==6)throw new Error('T9 catalog follow-up did not render all six SQLite-backed products');
  const productSearch=storePage.getByRole('searchbox',{name:'Search products and categories'});
  await productSearch.fill('Field Notes Set');
  await storePage.waitForFunction(()=>document.querySelectorAll('[data-pipe-bind="product.name"]').length===1);
  if((await productList.locator('[data-pipe-bind="product.name"]').textContent())!=='Field Notes Set')throw new Error('T9 catalog search did not select the expected product');
  await productSearch.fill('Writing');
  await storePage.waitForFunction(()=>document.querySelectorAll('[data-pipe-bind="product.name"]').length===2);
  await productSearch.fill('no matching product');
  await storePage.getByText('No matching items.',{exact:true}).waitFor();
  if(await storePage.getByText('No matching items.',{exact:true}).getAttribute('role')!=='status')throw new Error('T9 catalog empty-search state is not announced as a status');
  await productSearch.fill('');
  await storePage.waitForFunction(()=>document.querySelectorAll('[data-pipe-bind="product.name"]').length===6);
  await productSearch.focus();
  const storeFocus=await productSearch.evaluate(node=>getComputedStyle(node).outlineWidth);
  const storeDesktop=await storePage.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));
  await storePage.setViewportSize({width:390,height:844});
  const storeMobile=await storePage.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,products:[...document.querySelectorAll('[data-pipe-bind="product.name"]')].filter(node=>node.textContent?.trim()).length}));
  if(storeFocus!=='3px'||storeDesktop.width>storeDesktop.viewport||storeMobile.width>storeMobile.viewport||storeMobile.products!==6)throw new Error(`T9 catalog responsive/focus check failed: ${JSON.stringify({storeFocus,storeDesktop,storeMobile})}`);
  if(await storePage.getByText('Paper Harbor',{exact:true}).count()===0||await productList.locator('[data-pipe-bind="product.price"]').count()!==6)throw new Error('T9 catalog presentation is missing its title or prices');
  if(storeRequests.length!==1||storeRequests[0]!=='/products')throw new Error(`T9 catalog expected one declared GET request, got ${storeRequests.join(', ')}`);
  const storeBrowser=readFileSync(join(storeGenerated,storeRelease.artifacts.browser),'utf8');
  if(storeBrowser.includes('sqliteAdapter')||storeBrowser.includes('pipe_Product'))throw new Error('T9 catalog browser artifact exposes server/database implementation details');
  const storeEvidence={schemaVersion:'bmec.t9-page-state-catalog-followup.v1',classification:'post-feature engineering revalidation; not a fresh AI cold-start trial',platform:`${process.platform} ${process.arch}`,node:process.version,browser:`Chromium ${browser.version()}`,historicalTrialIncluded:false,database:'SQLite',declaredSource:'GET /products',productsRendered:6,nameFilter:'PASS',categoryFilter:'PASS',clearRestoresProducts:'PASS',emptyState:{visible:true,role:'status'},focusOutline:storeFocus,desktop:storeDesktop,mobile:storeMobile,requests:storeRequests,serverImplementationInBrowser:false,cartCheckoutTransactionsVerified:false};
  writeFileSync(join(process.cwd(),'output','evidence','bmec-0.7-t9-page-state-catalog-followup.json'),`${JSON.stringify(storeEvidence,null,2)}\n`);
  console.log('T9_CATALOG_FOLLOWUP PASS — six SQLite products hydrated and filtered; empty, focus, and desktop/mobile checks passed (cart/checkout/transactions not covered)');
} catch (error) {
  console.error('DATA_EXPLORER_UI FAIL', error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await handle?.close();
  await supportHandle?.close();
  await storeHandle?.close();
  storeDb?.close?.();
  db?.close?.();
  try { rmSync(root, {recursive: true, force: true, maxRetries: 10, retryDelay: 500}); } catch {}
  try { rmSync(playwrightDir, {recursive: true, force: true, maxRetries: 10, retryDelay: 500}); } catch {}
}
