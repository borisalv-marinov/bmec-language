import {spawn, execFileSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

const root = process.cwd();
const tempDir = mkdtempSync(join(tmpdir(), 'bmec-job-booking-design-'));
const projectDir = join(tempDir, 'project');
const browserTools = join(tempDir, 'browser-tools');
const evidenceDir = resolve(process.env.BMEC_JOB_BOOKING_EVIDENCE_DIR ?? join(root, 'docs', 'evidence', 'bmec-0.8-job-booking'));
mkdirSync(projectDir, {recursive: true});
mkdirSync(evidenceDir, {recursive: true});
for (const file of ['bmec.toml', 'bmec.lock', 'main.bmec']) cpSync(join(root, 'examples', 'job-booking', file), join(projectDir, file));
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--prefix', browserTools, '--no-save', '--ignore-scripts', 'playwright@1.63.0', '@axe-core/playwright@4.10.2'], {stdio: 'inherit', shell: process.platform === 'win32'});
const playwrightModule = await import(pathToFileURL(join(browserTools, 'node_modules', 'playwright', 'index.js')).href);
const {chromium} = playwrightModule.default ?? playwrightModule;
const axeModule = await import(pathToFileURL(join(browserTools, 'node_modules', '@axe-core', 'playwright', 'dist', 'index.mjs')).href);
const {AxeBuilder} = axeModule;
const authUsers = JSON.stringify([{id: 'admin', password: 'admin-pass-123', role: 'admin'}, {id: 'worker', password: 'worker-pass-123', role: 'worker'}]);
let server;
let browser;
let output = '';
let baseUrl;
const results = {status: 'PASS', viewports: [{width: 360, height: 800}, {width: 768, height: 900}, {width: 1440, height: 1000}], keyboardNavigation: 'pending', states: {}, pages: {}, apiResponses: [], externalRequests: [], browserErrors: []};
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  server = spawn(process.execPath, [join(root, 'dist', 'cli', 'index.js'), 'run', join(projectDir, 'main.bmec')], {cwd: projectDir, env: {...process.env, BMEC_PORT: '0', BMEC_AUTH_USERS: authUsers}, stdio: ['ignore', 'pipe', 'pipe']});
  server.stdout.on('data', chunk => { output += chunk.toString(); });
  server.stderr.on('data', chunk => { output += chunk.toString(); });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !baseUrl) {
    baseUrl = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0] ?? output.match(/http:\/\/localhost:\d+/)?.[0];
    if (baseUrl) break;
    if (server.exitCode !== null) throw new Error(`Job Booking server exited early: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(baseUrl, `Job Booking server did not start: ${output}`);
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  const page = await context.newPage();
  page.on('request', request => { if (new URL(request.url()).origin !== baseUrl) results.externalRequests.push(request.url()); });
  page.on('response', response => { const path = new URL(response.url()).pathname; if (['/customers', '/jobs', '/worker-jobs'].includes(path)) results.apiResponses.push({path, status: response.status()}); });
  page.on('pageerror', error => results.browserErrors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === baseUrl ? route.continue() : route.abort());
  const login = await fetch(`${baseUrl}/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({id: 'admin', password: 'admin-pass-123'})});
  assert(login.status === 200, `Admin login failed: HTTP ${login.status}`);
  const session = login.headers.get('set-cookie')?.split(';')[0];
  assert(session?.includes('='), 'Admin login did not return a session cookie');
  const [cookieName, cookieValue] = session.split('=', 2);
  await context.addCookies([{name: cookieName, value: cookieValue, url: baseUrl, httpOnly: true, sameSite: 'Lax'}]);
  await page.goto(baseUrl, {waitUntil: 'networkidle'});

  const seriousImpacts = ['serious', 'critical'];
  const auditPage = async name => {
    const audit = await new AxeBuilder({page}).analyze();
    const serious = audit.violations.filter(item => seriousImpacts.includes(item.impact));
    assert(serious.length === 0, `${name} serious/critical accessibility findings: ${JSON.stringify(serious)}`);
    return {serious: 0, critical: 0, moderate: audit.violations.filter(item => item.impact === 'moderate').length};
  };
  const capture = async (name, width, height) => {
    await page.setViewportSize({width, height});
    await page.waitForTimeout(100);
    const dimensions = await page.evaluate(() => ({width: document.documentElement.scrollWidth, viewport: innerWidth}));
    assert(dimensions.width <= dimensions.viewport, `${name} horizontal overflow at ${width}px: ${JSON.stringify(dimensions)}`);
    const accessibility = await auditPage(name);
    await page.screenshot({path: join(evidenceDir, `${name}-${width}x${height}.png`), fullPage: true});
    results.pages[name] ??= {viewports: {}};
    results.pages[name].viewports[`${width}x${height}`] = {...dimensions, accessibility};
  };

  await page.locator('h1').waitFor();
  for (const [width, height] of [[1440, 1000], [768, 900], [360, 800]]) await capture('login', width, height);
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto(`${baseUrl}#pipe-page--dashboard`, {waitUntil: 'networkidle'});
  for (const [name, hash] of [['dashboard', '#pipe-page--dashboard'], ['customers', '#pipe-page--customers'], ['jobs', '#pipe-page--jobs']]) {
    if (name !== 'dashboard') {
      const navigationLink = page.getByRole('link', {name: name === 'customers' ? 'Customers' : 'Jobs'});
      await navigationLink.focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(expected => location.hash === expected, hash);
      results.keyboardNavigation = 'PASS';
    }
    if (name === 'customers') {
      await page.getByText('No customers found.', {exact: true}).waitFor();
      results.states.customersEmpty = 'PASS';
    }
    if (name === 'jobs') {
      await page.getByText('No jobs found.', {exact: true}).waitFor();
      results.states.jobsEmpty = 'PASS';
    }
    const visible = await page.locator('section[data-pipe-page]:visible').allTextContents();
    assert(visible.length === 1, `${name}: expected exactly one visible page, got ${visible.length}`);
    for (const [width, height] of [[1440, 1000], [768, 900], [360, 800]]) await capture(name, width, height);
  }
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto(`${baseUrl}#pipe-page--workerdashboard`, {waitUntil: 'networkidle'});
  await page.locator('[data-pipe-list-error]:visible').first().waitFor();
  results.states.workerUnauthorizedError = 'PASS';
  const workerLogin = await fetch(`${baseUrl}/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({id: 'worker', password: 'worker-pass-123'})});
  assert(workerLogin.status === 200, `Worker login failed: HTTP ${workerLogin.status}`);
  const workerSession = workerLogin.headers.get('set-cookie')?.split(';')[0];
  assert(workerSession?.includes('='), 'Worker login did not return a session cookie');
  const [workerCookieName, workerCookieValue] = workerSession.split('=', 2);
  await context.addCookies([{name: workerCookieName, value: workerCookieValue, url: baseUrl, httpOnly: true, sameSite: 'Lax'}]);
  await page.setViewportSize({width: 1440, height: 1000});
  await page.reload({waitUntil: 'networkidle'});
  await page.getByText('No assigned jobs found.', {exact: true}).waitFor();
  results.states.workerEmptyAfterLogin = 'PASS';
  for (const [width, height] of [[1440, 1000], [768, 900], [360, 800]]) await capture('worker', width, height);
  assert(results.externalRequests.length === 0, `Unexpected external requests: ${JSON.stringify(results.externalRequests)}`);
  assert(results.browserErrors.length === 0, `Browser errors: ${JSON.stringify(results.browserErrors)}`);
  await import('node:fs').then(({writeFileSync}) => writeFileSync(join(evidenceDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`));
  console.log(`JOB_BOOKING_DESIGN_E2E PASS — ${JSON.stringify(results)}`);
} catch (error) {
  console.error(`JOB_BOOKING_DESIGN_E2E FAIL — ${error.message}`);
  console.error(`Server output: ${output}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  rmSync(tempDir, {recursive: true, force: true});
}
