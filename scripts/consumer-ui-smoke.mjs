import {execFileSync} from 'node:child_process';
import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

let url = process.env.BMEC_URL;
let server;
const output = process.env.BMEC_CONSUMER_EVIDENCE_DIR ?? join(process.cwd(), 'docs', 'evidence', 'northline');
mkdirSync(output, {recursive: true});
const dependencyDir = mkdtempSync(join(tmpdir(), 'bmec-northline-playwright-'));
const runtimeDirectory = mkdtempSync(join(tmpdir(), 'bmec-northline-runtime-'));
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--prefix', dependencyDir, '--no-save', '--ignore-scripts', 'playwright@1.63.0', 'axe-core@4.10.3'], {stdio: 'inherit', shell: process.platform === 'win32'});
const playwright = await import(pathToFileURL(join(dependencyDir, 'node_modules', 'playwright', 'index.js')).href);
const {chromium} = playwright.default ?? playwright;
const axePath = join(dependencyDir, 'node_modules', 'axe-core', 'axe.min.js');
const browser = await chromium.launch({headless: true});
try {
  if (!url) {
    server = spawn(process.execPath, ['examples/northline/run.mjs'], {env: {...process.env, BMEC_PORT: '0', BMEC_DATA_DIR: runtimeDirectory, BMEC_GENERATED_DIR: join(runtimeDirectory, 'generated')}, stdio: ['ignore', 'pipe', 'pipe']});
    url = await new Promise((resolve, reject) => {
      let output = '';
      const onData = chunk => { output += chunk.toString(); const match = output.match(/http:\/\/localhost:\d+/); if (match) resolve(match[0]); };
      server.stdout.on('data', onData);
      server.stderr.on('data', chunk => { output += chunk.toString(); process.stderr.write(chunk); });
      server.once('error', reject);
      server.once('exit', code => { if (code && !output.includes('http://localhost:')) reject(new Error(`Northline server exited with ${code}: ${output}`)); });
    });
  }
  for (const [name, width, height] of [['mobile', 360, 800], ['tablet', 768, 900], ['desktop', 1440, 900]]) {
    const page = await browser.newPage({viewport: {width, height}, reducedMotion: 'reduce'});
    const pageErrors = [], consoleErrors = [], cartResponses = [], httpErrors = [];
    let cartCatalog;
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('response', response => { const pathname = new URL(response.url()).pathname; if (pathname === '/api/Product') { cartResponses.push(response.status()); void response.json().then(value => { cartCatalog = value; }); } if (response.status() >= 400) httpErrors.push(`${response.request().method()} ${pathname} ${response.status()}`); });
    await page.goto(url, {waitUntil: 'networkidle'});
    const title = await page.locator('body').innerText();
    if (!title.includes('NORTHLINE / EVERYDAY OBJECTS') || !title.includes('Morning ceramic cup') || !title.includes('Northline pour-over set') || !title.includes('Everyday linen towel')) throw new Error(`${name}: storefront content missing`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw new Error(`${name}: horizontal page overflow`);
    for (const product of ['Morning ceramic cup', 'Northline pour-over set', 'Everyday linen towel']) {
      const card = page.locator('[data-pipe-style="ProductCard"]').filter({hasText: product});
      await card.getByRole('button', {name: 'View details'}).click();
      const dialog = page.getByRole('dialog', {name: product});
      await dialog.waitFor({state: 'visible'});
      await page.keyboard.press('Escape');
      await dialog.waitFor({state: 'hidden'});
    }
    if (name === 'mobile') {
      const cupQuantity = page.locator('input[name="cupQuantity"]');
      const pourOverQuantity = page.locator('input[name="pourOverQuantity"]');
      const linenQuantity = page.locator('input[name="linenQuantity"]');
      const subtotal = page.locator('[data-pipe-style="CartSummaryTotal"] [data-pipe-text]');
      await page.getByRole('button', {name: 'Add cup to cart'}).click();
      await page.getByRole('button', {name: 'Add cup to cart'}).click();
      await page.getByRole('button', {name: 'Add pour-over to cart'}).click();
      const subtotalUpdated = await page.waitForFunction(() => document.querySelector('[data-pipe-style="CartSummaryTotal"] [data-pipe-text]')?.textContent === '$120.00', {timeout: 5000}).then(() => true).catch(() => false);
      if (!subtotalUpdated) {
        const debug = await page.evaluate(() => ({quantities: [...document.querySelectorAll('input[name$="Quantity"]')].map(input => [input.name, input.value]), subtotal: document.querySelector('[data-pipe-style="CartSummaryTotal"] [data-pipe-text]')?.textContent, scripts: [...document.scripts].map(script => script.src), events: Object.keys(globalThis.PIPE_UI_EVENTS ?? {})}));
        throw new Error(`mobile: cart subtotal did not update; state=${JSON.stringify(debug)} productResponses=${JSON.stringify(cartResponses)} catalog=${JSON.stringify(cartCatalog)} httpErrors=${JSON.stringify(httpErrors)} pageErrors=${JSON.stringify(pageErrors)} consoleErrors=${JSON.stringify(consoleErrors)}`);
      }
      if (await cupQuantity.inputValue() !== '2' || await pourOverQuantity.inputValue() !== '1' || await linenQuantity.inputValue() !== '0') throw new Error('mobile: add-to-cart did not update the typed line quantities');
      await page.getByRole('button', {name: 'Remove cup from cart'}).click();
      await page.waitForFunction(() => document.querySelector('[data-pipe-style="CartSummaryTotal"] [data-pipe-text]')?.textContent === '$64.00');
      if (await cupQuantity.inputValue() !== '0') throw new Error('mobile: remove-from-cart did not zero the product line');
      await page.getByRole('button', {name: 'Add cup to cart'}).click();
      await page.getByRole('button', {name: 'Add cup to cart'}).click();
      await page.waitForFunction(() => document.querySelector('[data-pipe-style="CartSummaryTotal"] [data-pipe-text]')?.textContent === '$120.00');
      await page.reload({waitUntil: 'networkidle'});
      await page.waitForFunction(() => document.querySelector('[data-pipe-style="CartSummaryTotal"] [data-pipe-text]')?.textContent === '$120.00');
      if (await cupQuantity.inputValue() !== '2' || await pourOverQuantity.inputValue() !== '1') throw new Error('mobile: cart quantities did not persist after reload');
      const status = page.locator('[data-pipe-action-status="placeOrder"]');
      const orderResponses = [];
      page.on('response', response => { if (new URL(response.url()).pathname === '/orders') orderResponses.push(response.status()); });
      await page.getByRole('button', {name: 'Place pending order'}).click();
      await page.waitForFunction(() => { const message = document.querySelector('[data-pipe-action-status="placeOrder"]')?.textContent?.trim(); return Boolean(message && message !== 'Submitting...'); }, {timeout: 15000}).catch(() => {});
      const orderStatus = await status.textContent();
      if (orderStatus !== 'Submitted.' || orderResponses[0] !== 200) {
        const buttonError = await page.locator('button[data-pipe-event="placeOrder"]').getAttribute('data-pipe-error');
        throw new Error(`mobile: multi-item checkout failed; status=${JSON.stringify(orderStatus)} buttonError=${JSON.stringify(buttonError)} responses=${JSON.stringify(orderResponses)}`);
      }
      await pourOverQuantity.fill('6');
      await page.getByRole('button', {name: 'Place pending order'}).click();
      await page.waitForFunction(() => document.querySelector('[data-pipe-action-status="placeOrder"]')?.textContent === 'There is not enough stock for one or more cart items.', {timeout: 5000});
      if (await status.textContent() !== 'There is not enough stock for one or more cart items.') throw new Error('mobile: out-of-stock cart request was not announced');
      if (orderResponses.length !== 2 || orderResponses[0] !== 200 || orderResponses[1] !== 400) throw new Error(`mobile: expected HTTP 200 success followed by HTTP 400 typed error, received ${JSON.stringify(orderResponses)}`);
      await page.reload({waitUntil: 'networkidle'});
      await page.waitForFunction(() => document.querySelector('[data-pipe-style="CartSummaryTotal"] [data-pipe-text]')?.textContent === '$440.00');
      if (await cupQuantity.inputValue() !== '2' || await pourOverQuantity.inputValue() !== '6') throw new Error('mobile: cart did not retain the out-of-stock quantities after reload');
    }
    await page.addScriptTag({path: axePath});
    const axe = await page.evaluate(async () => window.axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']}}));
    if (axe.violations.length) throw new Error(`${name}: axe violations: ${axe.violations.map(v => `${v.id} (${v.impact})`).join(', ')}`);
    await page.screenshot({path: join(output, `${name}.png`), fullPage: true});
    console.log(`NORTHLINE_CONSUMER PASS — ${name} ${width}x${height}; three detail dialogs; no horizontal overflow; axe 0 violations${name === 'mobile' ? '; persistent multi-item cart, checkout, and out-of-stock response' : ''}`);
    await page.close();
  }
} finally {
  await browser.close();
  server?.kill('SIGTERM');
  if (server && server.exitCode === null) await new Promise(resolve => server.once('exit', resolve));
  rmSync(runtimeDirectory, {recursive: true, force: true});
  rmSync(dependencyDir, {recursive: true, force: true});
}
