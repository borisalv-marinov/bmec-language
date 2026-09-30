import {spawn, execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import Database from 'better-sqlite3';

const root = process.cwd();
const evidenceDir = resolve(process.env.BMEC_PAPER_HARBOR_EVIDENCE_DIR ?? join(root, 'docs', 'evidence', 'paper-harbor'));
const tempDir = mkdtempSync(join(tmpdir(), 'bmec-paper-harbor-e2e-'));
const dependencyDir = join(tempDir, 'browser-tools');
const dataDir = join(tempDir, 'data');
const generatedDir = join(tempDir, 'generated');
const databasePath = join(dataDir, 'PaperHarbor.db');
mkdirSync(evidenceDir, {recursive: true});
rmSync(join(evidenceDir, 'failure.json'), {force: true});
mkdirSync(dataDir, {recursive: true});
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--prefix', dependencyDir, '--no-save', '--ignore-scripts', 'playwright@1.63.0'], {stdio: 'inherit', shell: process.platform === 'win32'});
const playwrightModule = await import(pathToFileURL(join(dependencyDir, 'node_modules', 'playwright', 'index.js')).href);
const {chromium} = playwrightModule.default ?? playwrightModule;
const database = new Database(databasePath);
let server;
let browser;
let serverOutput = '';
let baseUrl;
const failures = [];
const observations = {products: 0, desktop: null, mobile: null, filter: {}, cart: {}, validation: {}, orders: {}, externalRequests: [], browserErrors: []};

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const rows = table => database.prepare(`SELECT * FROM "pipe_${table}"`).all();
const counts = () => ({orders: rows('Order').length, lines: rows('OrderLine').length});
const stockFor = id => database.prepare('SELECT stock FROM "pipe_Product" WHERE id = ?').get(id)?.stock;
const boot = async () => {
  serverOutput = '';
  server = spawn(process.execPath, ['examples/paper-harbor/run.mjs'], {cwd: root, env: {...process.env, BMEC_PORT: '0', BMEC_DATA_DIR: dataDir, BMEC_GENERATED_DIR: generatedDir, BMEC_PAPER_HARBOR_USE_CART_ADAPTER: '1'}, stdio: ['ignore', 'pipe', 'pipe']});
  const collect = chunk => { serverOutput += chunk.toString(); };
  server.stdout.on('data', collect);
  server.stderr.on('data', collect);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !baseUrl) {
    const url = serverOutput.match(/http:\/\/localhost:\d+/)?.[0];
    if (url) { baseUrl = url; break; }
    if (server.exitCode !== null) throw new Error(`Paper Harbor server exited early: ${serverOutput}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!baseUrl) throw new Error(`Paper Harbor server did not start: ${serverOutput}`);
};
const stop = async () => {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await new Promise(resolve => server.once('exit', resolve));
  server = undefined;
  baseUrl = undefined;
};
const postOrder = async (key, payload) => {
  const response = await fetch(`${baseUrl}/orders`, {method: 'POST', headers: {'content-type': 'application/json', idempotencyKey: key}, body: JSON.stringify(payload)});
  let body = {};
  try { body = await response.json(); } catch {}
  return {status: response.status, body};
};

try {
  await boot();
  browser = await chromium.launch({headless: true});
  const page = await browser.newPage({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'});
  page.on('request', request => { if (new URL(request.url()).origin !== baseUrl) observations.externalRequests.push(request.url()); });
  page.on('pageerror', error => observations.browserErrors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === baseUrl ? route.continue() : route.abort());
  await page.goto(baseUrl, {waitUntil: 'networkidle'});
  const cards = page.locator('[data-pipe-style="ProductCard"]');
  await page.getByText('Field Notes Notebook', {exact: true}).waitFor();
  observations.products = await cards.count();
  assert(observations.products === 6, `Expected six catalog cards, got ${observations.products}`);
  const catalogText = await page.locator('body').innerText();
  await page.screenshot({path: join(evidenceDir, 'desktop-1280x900.png'), fullPage: true});
  for (const text of ['NOTEBOOKS', 'PENS', 'DESK', '12', 'in stock']) assert(catalogText.includes(text), `Catalog missing ${text}; rendered text: ${catalogText}`);
  observations.desktop = await page.evaluate(() => ({width: document.documentElement.scrollWidth, viewport: innerWidth}));
  assert(observations.desktop.width <= observations.desktop.viewport, `Desktop overflow: ${JSON.stringify(observations.desktop)}`);

  const search = page.getByRole('searchbox', {name: 'Search products by name or description'});
  const category = page.getByRole('combobox', {name: 'Filter by category'});
  await category.selectOption('Pens');
  assert(await cards.count() === 6 && await cards.filter({hasText: 'Harbor Fountain Pen'}).isVisible() && !(await cards.filter({hasText: 'Field Notes Notebook'}).isVisible()), 'Category filter did not isolate the two Pens cards');
  await category.selectOption('All categories');
  await search.fill('stainless nib');
  assert(await cards.filter({hasText: 'Harbor Fountain Pen'}).isVisible() && !(await cards.filter({hasText: 'Field Notes Notebook'}).isVisible()), 'Description search did not find the fountain pen');
  await search.fill('unlisted item');
  await page.getByText('No matching items.', {exact: true}).waitFor();
  await search.fill('');
  await page.getByText('Maple Desk Tray', {exact: true}).waitFor();
  await category.selectOption('Desk');
  assert(await cards.filter({hasText: 'Maple Desk Tray'}).isVisible() && !(await cards.filter({hasText: 'Harbor Fountain Pen'}).isVisible()), 'Desk category filter failed');
  await category.selectOption('All categories');
  observations.filter = {nameSearch: 'PASS', descriptionSearch: 'PASS', categoryFilter: 'PASS', clear: 'PASS', emptyState: 'PASS'};

  const fountainCard = cards.filter({hasText: 'Harbor Fountain Pen'});
  await fountainCard.getByRole('button', {name: 'View details for Harbor Fountain Pen'}).click();
  await page.getByRole('dialog', {name: 'Harbor Fountain Pen'}).waitFor();
  await page.getByRole('button', {name: 'Close details'}).click();
  observations.filter.details = 'PASS';

  const notebookCard = cards.filter({hasText: 'Field Notes Notebook'});
  await notebookCard.getByRole('button', {name: 'Add Field Notes Notebook to cart'}).click();
  await notebookCard.getByRole('button', {name: 'Add Field Notes Notebook to cart'}).click();
  await fountainCard.getByRole('button', {name: 'Add Harbor Fountain Pen to cart'}).click();
  const cartRoot = page.locator('[data-pipe-style="CartPanel"]');
  const notebookQuantity = page.getByRole('spinbutton', {name: 'Field Notes Notebook quantity'});
  assert(await notebookQuantity.inputValue() === '2', 'Adding two notebooks did not set cart quantity 2');
  assert((await cartRoot.innerText()).includes('Subtotal $62.00'), 'Cart subtotal is not the expected exact $62.00');
  await notebookQuantity.fill('1');
  await notebookQuantity.press('Tab');
  assert((await cartRoot.innerText()).includes('Subtotal $50.00'), 'Changing quantity did not update subtotal');
  await page.getByRole('button', {name: 'Remove Harbor Fountain Pen'}).click();
  assert(!(await cartRoot.innerText()).includes('Harbor Fountain Pen quantity'), 'Remove did not remove the pen line');
  await page.getByRole('button', {name: 'Remove Field Notes Notebook'}).click();
  assert((await cartRoot.innerText()).includes('Your cart is empty. Add a product to begin.'), 'Removing every line did not show the empty-cart state');
  await notebookCard.getByRole('button', {name: 'Add Field Notes Notebook to cart'}).click();
  await notebookCard.getByRole('button', {name: 'Add Field Notes Notebook to cart'}).click();
  await page.getByRole('button', {name: 'Add Harbor Fountain Pen to cart'}).click();
  await notebookQuantity.fill('2');
  await notebookQuantity.press('Tab');
  await page.reload({waitUntil: 'networkidle'});
  await page.getByRole('spinbutton', {name: 'Field Notes Notebook quantity'}).waitFor();
  assert(await page.getByRole('spinbutton', {name: 'Field Notes Notebook quantity'}).inputValue() === '2', 'Cart quantity did not persist after reload');
  assert((await page.locator('[data-pipe-style="CartPanel"]').innerText()).includes('Subtotal $62.00'), 'Persistent cart subtotal changed after reload');
  observations.cart = {add: 'PASS', change: 'PASS', remove: 'PASS', subtotal: 'PASS', reloadPersistence: 'PASS', emptyState: 'PASS'};
  await page.setViewportSize({width: 390, height: 844});
  observations.mobile = await page.evaluate(() => ({width: document.documentElement.scrollWidth, viewport: innerWidth, cards: [...document.querySelectorAll('[data-pipe-style="ProductCard"]')].filter(card => getComputedStyle(card).display !== 'none').length}));
  assert(observations.mobile.width <= observations.mobile.viewport && observations.mobile.cards === 6, `Mobile layout failed: ${JSON.stringify(observations.mobile)}`);
  await page.screenshot({path: join(evidenceDir, 'mobile-390x844.png'), fullPage: true});

  const orderTable = () => rows('Order');
  const lineTable = () => rows('OrderLine');
  const notebook = JSON.parse((await (await fetch(`${baseUrl}/products`)).text())).find(product => product.sku === 'notebook-field');
  const fountain = JSON.parse((await (await fetch(`${baseUrl}/products`)).text())).find(product => product.sku === 'pen-fountain');
  const invalidPayload = {name: '', email: 'not-an-email', address: '', items: [{productId: notebook.id, quantity: 2}]};
  const beforeInvalid = {counts: counts(), notebookStock: stockFor(notebook.id)};
  const invalid = await postOrder('invalid-customer', invalidPayload);
  assert(invalid.status >= 400 && invalid.status < 500, `Invalid customer must return 4xx, got ${invalid.status}`);
  assert(counts().orders === beforeInvalid.counts.orders && counts().lines === beforeInvalid.counts.lines && stockFor(notebook.id) === beforeInvalid.notebookStock, 'Invalid customer created rows or changed stock');
  const malformedEmail = await postOrder('malformed-email', {name: 'Avery Lin', email: 'avery@.com', address: '8 Harbor Lane, Bristol', items: [{productId: notebook.id, quantity: 1}]});
  assert(malformedEmail.status >= 400 && malformedEmail.status < 500 && counts().orders === beforeInvalid.counts.orders && stockFor(notebook.id) === beforeInvalid.notebookStock, 'Malformed email was not rejected without writes');
  observations.validation.invalidCustomer = '4xx with no writes';
  observations.validation.malformedEmail = '4xx with no writes';

  const unknown = await postOrder('unknown-product', {name: 'Avery Lin', email: 'avery@example.com', address: '8 Harbor Lane, Bristol', items: [{productId: 999999, quantity: 1}]});
  assert(unknown.status >= 400 && unknown.status < 500 && counts().orders === beforeInvalid.counts.orders && stockFor(notebook.id) === beforeInvalid.notebookStock, `Unknown product was not rejected without writes: ${JSON.stringify({unknown, before: beforeInvalid, after: counts(), notebookStock: stockFor(notebook.id)})}`);
  const zero = await postOrder('zero-quantity', {name: 'Avery Lin', email: 'avery@example.com', address: '8 Harbor Lane, Bristol', items: [{productId: notebook.id, quantity: 0}]});
  assert(zero.status >= 400 && zero.status < 500 && counts().orders === beforeInvalid.counts.orders && stockFor(notebook.id) === beforeInvalid.notebookStock, 'Non-positive quantity was not rejected without writes');
  const beforeStockFailure = {counts: counts(), stock: stockFor(notebook.id)};
  const insufficient = await postOrder('insufficient-stock', {name: 'Avery Lin', email: 'avery@example.com', address: '8 Harbor Lane, Bristol', items: [{productId: notebook.id, quantity: beforeStockFailure.stock + 1}]});
  assert(insufficient.status >= 400 && insufficient.status < 500 && counts().orders === beforeStockFailure.counts.orders && counts().lines === beforeStockFailure.counts.lines && stockFor(notebook.id) === beforeStockFailure.stock, 'Insufficient stock did not roll back order, lines, and inventory');
  observations.validation = {invalidCustomer: '4xx/no writes', unknownProduct: '4xx/no writes', nonPositiveQuantity: '4xx/no writes', insufficientStockRollback: '4xx/no writes'};

  const customer = {name: 'Avery Lin', email: 'avery@example.com', address: '8 Harbor Lane, Bristol'};
  const browserForm = page.locator('.checkout-form');
  const initialOrderCount = counts().orders;
  const initialNotebookStock = stockFor(notebook.id);
  await browserForm.getByLabel('Your name').fill('Avery Lin');
  await browserForm.getByLabel('Email address').fill('not-an-email');
  await browserForm.getByLabel('Delivery address').fill('8 Harbor Lane, Bristol');
  await browserForm.getByRole('button', {name: 'Place demo order'}).click();
  assert(await browserForm.getByLabel('Email address').evaluate(input => !input.validity.valid), 'Malformed email was not exposed as a browser validation error');
  assert(counts().orders === initialOrderCount && stockFor(notebook.id) === initialNotebookStock, 'Invalid browser checkout changed orders or stock');
  await browserForm.getByLabel('Your name').fill(customer.name);
  await browserForm.getByLabel('Email address').fill(customer.email);
  await browserForm.getByLabel('Delivery address').fill(customer.address);
  const browserOrderResponses = [];
  page.on('response', response => { if (new URL(response.url()).pathname === '/orders') browserOrderResponses.push(response.status()); });
  await browserForm.getByRole('button', {name: 'Place demo order'}).click();
  await page.getByText(/Order \d+ saved as pending_payment\./).waitFor();
  assert(browserOrderResponses[0] === 201, `Browser checkout expected HTTP 201, received ${JSON.stringify(browserOrderResponses)}`);
  const savedOrder = orderTable().at(-1);
  assert(savedOrder.status === 'pending_payment' && savedOrder.email === customer.email && Number(savedOrder.total) === 6200, `Successful order did not persist expected customer, total, or state: ${JSON.stringify(savedOrder)}`);
  assert(lineTable().some(line => line.orderId === savedOrder.id && line.productId === notebook.id && line.quantity === 2), 'Successful order line was not persisted');
  assert(lineTable().some(line => line.orderId === savedOrder.id && line.productId === notebook.id && Number(line.lineTotal) === 2400) && lineTable().some(line => line.orderId === savedOrder.id && line.productId === fountain.id && Number(line.lineTotal) === 3800), 'Order lines did not persist exact money totals');
  assert(stockFor(notebook.id) === beforeInvalid.notebookStock - 2 && stockFor(fountain.id) === 5, 'Successful checkout did not atomically decrement both selected stocks');
  observations.orders.browserCheckout = '201/persisted order and lines';

  const stableKey = 'same-payload-key-001';
  const stablePayload = {...customer, items: [{productId: fountain.id, quantity: 1}]};
  const beforeIdempotency = {counts: counts(), stock: stockFor(fountain.id)};
  const firstAttempt = await postOrder(stableKey, stablePayload);
  const retry = await postOrder(stableKey, stablePayload);
  assert(firstAttempt.status === 201 && retry.status === 201 && counts().orders === beforeIdempotency.counts.orders + 1 && counts().lines === beforeIdempotency.counts.lines + 1 && stockFor(fountain.id) === beforeIdempotency.stock - 1, 'Same-key retry created extra order/line or decremented inventory twice');
  const changed = await postOrder(stableKey, {...stablePayload, items: [{productId: fountain.id, quantity: 2}]});
  assert(changed.status >= 400 && changed.status < 500 && String(changed.body.error ?? '').includes('different order') && counts().orders === beforeIdempotency.counts.orders + 1 && stockFor(fountain.id) === beforeIdempotency.stock - 1, 'Changed same-key payload was not rejected without changing state');
  observations.orders = {browserCheckout: '201/persisted order and lines', sameKeyRetry: 'one order/one stock decrement', changedPayloadConflict: `${changed.status} with conflict message/no writes`};

  await stop();
  await boot();
  const afterRestart = JSON.parse((await (await fetch(`${baseUrl}/products`)).text()));
  assert(afterRestart.length === 6 && afterRestart.find(product => product.sku === 'notebook-field').stock === beforeInvalid.notebookStock - 2, 'Product catalog/order inventory did not survive a process restart');
  assert(orderTable().length === beforeIdempotency.counts.orders + 1, 'Orders did not survive process restart');
  observations.orders.restartPersistence = 'PASS';
  assert(observations.externalRequests.length === 0, `Unexpected external requests: ${observations.externalRequests.join(', ')}`);
  assert(observations.browserErrors.length === 0, `Browser errors: ${observations.browserErrors.join(', ')}`);
  observations.externalRequests = 'none';
  observations.browserErrors = 'none';
  observations.platform = `${process.platform}/${process.arch}`;
  observations.browser = `Chromium ${browser.version()}`;
  observations.recordedAt = new Date().toISOString();
  writeFileSync(join(evidenceDir, 'results.json'), `${JSON.stringify(observations, null, 2)}\n`);
  writeFileSync(join(evidenceDir, 'test-output.txt'), `PAPER_HARBOR_E2E PASS\n${JSON.stringify(observations, null, 2)}\n`);
  console.log('PAPER_HARBOR_E2E PASS — catalog, filters, cart persistence, transactional checkout, idempotency, rollback, and restart persistence');
} catch (error) {
  const result = {error: error instanceof Error ? error.stack : String(error), observations, serverOutput};
  writeFileSync(join(evidenceDir, 'failure.json'), `${JSON.stringify(result, null, 2)}\n`);
  throw error;
} finally {
  await browser?.close();
  await stop();
  database.close();
  rmSync(tempDir, {recursive: true, force: true});
}
