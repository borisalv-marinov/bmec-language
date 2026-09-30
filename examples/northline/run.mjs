import {dirname,join,resolve} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {compileProject} from '../../dist/compiler.js';
import {startRuntime} from '../../dist/runtime/server.js';

const here=dirname(fileURLToPath(import.meta.url));
const entry=join(here,'main.bmec');
const compiled=compileProject(entry);
if(compiled.diagnostics.length||!compiled.ir)throw new Error(compiled.diagnostics.map(item=>item.message).join('\n')||'Northline did not compile');
const dataDirectory=resolve(process.env.BMEC_DATA_DIR??join(here,'.pipe'));
const generatedDirectory=resolve(process.env.BMEC_GENERATED_DIR??join(here,'generated'));
mkdirSync(dataDirectory,{recursive:true});
const runtime=await startRuntime(compiled.ir,generatedDirectory,join(dataDirectory,'NorthlineGoods.db'),Number(process.env.BMEC_PORT??3000));
const appScriptPath=join(generatedDirectory,'app.js');
writeFileSync(appScriptPath,`${readFileSync(join(here,'cart-ui-adapter.js'),'utf8')}\n${readFileSync(appScriptPath,'utf8')}`);
const catalog=[
  {sku:'cup-01',name:'Morning ceramic cup',category:'table',price:'28.00',stock:12},
  {sku:'pour-over-01',name:'Northline pour-over set',category:'coffee',price:'64.00',stock:5},
  {sku:'linen-01',name:'Everyday linen towel',category:'home',price:'32.00',stock:20},
];
const existing=new Set(runtime.database.list('Product').map(product=>product.sku));
for(const product of catalog)if(!existing.has(product.sku))runtime.database.create('Product',product);
console.log(`Northline Goods is running at ${runtime.url}`);
const shutdown=()=>void runtime.close().then(()=>process.exit(0));
process.once('SIGINT',shutdown);
process.once('SIGTERM',shutdown);
