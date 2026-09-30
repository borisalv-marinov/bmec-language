import {build} from 'esbuild';
import {readdirSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const extension=join(root,'vscode-extension');
const modules=join(extension,'node_modules');
const outfile=join(extension,'dist','extension.js');
const licenses=[];
const walk=directory=>{
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    if(!entry.isDirectory()||entry.name==='.bin')continue;
    const path=join(directory,entry.name);
    if(entry.name.startsWith('@')){walk(path);continue;}
    const manifest=join(path,'package.json');
    try{
      const pkg=JSON.parse(readFileSync(manifest,'utf8'));
      const candidates=['LICENSE','LICENSE.md','LICENSE.txt','license','license.md','COPYING'];
      let text='';
      for(const name of candidates){try{text=readFileSync(join(path,name),'utf8');break;}catch{}}
      licenses.push({name:pkg.name,version:pkg.version,license:typeof pkg.license==='string'?pkg.license:JSON.stringify(pkg.license??'SEE PACKAGE METADATA'),text});
    }catch{}
    const nested=join(path,'node_modules');
    try{walk(nested);}catch{}
  }
};
walk(modules);
licenses.sort((a,b)=>a.name.localeCompare(b.name)||a.version.localeCompare(b.version));
const unique=licenses.filter((item,index)=>index===0||item.name!==licenses[index-1].name||item.version!==licenses[index-1].version);
const notice=['# Third-party notices','','BMEC Language Support bundles the following npm packages. Their applicable license terms are included below.','',...unique.flatMap(item=>[`## ${item.name} ${item.version}`,`License: ${item.license}`,'',item.text.trim()||'The package declares the license identifier above; consult its packaged source for full terms.',''])].join('\n').trimEnd()+'\n';
writeFileSync(join(extension,'THIRD_PARTY_NOTICES.md'),notice);
mkdirSync(dirname(outfile),{recursive:true});
await build({entryPoints:[join(extension,'extension.js')],outfile,bundle:true,platform:'node',target:'node20',format:'cjs',external:['vscode'],legalComments:'none',minify:true,sourcemap:false,logLevel:'silent'});
console.log(`VS Code extension bundle built with notices for ${unique.length} dependencies.`);
