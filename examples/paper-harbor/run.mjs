import {dirname, join, resolve} from 'node:path';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {compileProject} from '../../dist/compiler.js';
import {startRuntime} from '../../dist/runtime/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const compiled = compileProject(join(here, 'main.bmec'));
if (compiled.diagnostics.length || !compiled.ir) throw new Error(compiled.diagnostics.map(item => item.message).join('\n') || 'Paper Harbor did not compile');

const dataDirectory = resolve(process.env.BMEC_DATA_DIR ?? join(here, '.pipe'));
const generatedDirectory = resolve(process.env.BMEC_GENERATED_DIR ?? join(dataDirectory, 'generated'));
mkdirSync(dataDirectory, {recursive: true});
const runtime = await startRuntime(compiled.ir, generatedDirectory, join(dataDirectory, 'PaperHarbor.db'), Number(process.env.BMEC_PORT ?? 3000));

const catalog = [
  {sku: 'notebook-field', name: 'Field Notes Notebook', category: 'Notebooks', price: '12.00', description: 'A pocket-sized ruled notebook with a sturdy recycled cover.', searchable: 'Field Notes Notebook Notebooks pocket ruled recycled cover', stock: 18},
  {sku: 'notebook-cloth', name: 'Clothbound Journal', category: 'Notebooks', price: '24.00', description: 'Lay-flat cream pages wrapped in soft blue cloth.', searchable: 'Clothbound Journal Notebooks lay-flat cream pages soft blue cloth', stock: 9},
  {sku: 'notebook-grid', name: 'Grid Study Pad', category: 'Notebooks', price: '9.50', description: 'Tear-away grid sheets for sketches, sums, and plans.', searchable: 'Grid Study Pad Notebooks tear-away sheets sketches sums plans', stock: 14},
  {sku: 'pen-fountain', name: 'Harbor Fountain Pen', category: 'Pens', price: '38.00', description: 'A balanced brass fountain pen with a fine stainless nib.', searchable: 'Harbor Fountain Pen Pens brass fountain fine stainless nib', stock: 6},
  {sku: 'pen-gel', name: 'Everyday Gel Pen Set', category: 'Pens', price: '11.00', description: 'Three smooth black gel pens for notes and lists.', searchable: 'Everyday Gel Pen Set Pens smooth black notes lists', stock: 25},
  {sku: 'desk-tray', name: 'Maple Desk Tray', category: 'Desk', price: '32.00', description: 'A small solid-maple catchall for the tools you reach for.', searchable: 'Maple Desk Tray Desk solid maple catchall tools', stock: 7},
];
const knownSkus = new Set(runtime.database.list('Product').map(product => product.sku));
for (const product of catalog) if (!knownSkus.has(product.sku)) runtime.database.create('Product', product);

const generatedScript = join(generatedDirectory, 'app.js');
if (process.env.BMEC_PAPER_HARBOR_USE_CART_ADAPTER === '1') writeFileSync(generatedScript, `${readFileSync(join(here, 'cart-ui-adapter.js'), 'utf8')}\n${readFileSync(generatedScript, 'utf8')}`);
const generatedHtml = join(generatedDirectory, 'index.html');
const css = readFileSync(join(here, 'paper-harbor.css'), 'utf8');
writeFileSync(generatedHtml, readFileSync(generatedHtml, 'utf8').replace('</head>', `<style>${css}</style></head>`));

console.log(`Paper Harbor is running at ${runtime.url}`);
const shutdown = () => void runtime.close().then(() => process.exit(0));
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
