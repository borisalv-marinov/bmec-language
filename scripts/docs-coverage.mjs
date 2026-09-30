import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,extname,join,resolve,sep} from 'node:path';

const root=process.cwd();
const map=JSON.parse(readFileSync(join(root,'docs','capability-map.json'),'utf8'));
const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const cli=join(root,'dist','cli','index.js');
if(!existsSync(cli))throw new Error('Build BMEC before checking documentation coverage');
const run=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args,'--json'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','inherit']}));
const ai=run('ai-spec'),commands=JSON.parse(readFileSync(join(root,'ai','commands.json'),'utf8'));
const diagnostics=JSON.parse(readFileSync(join(root,'ai','diagnostics.json'),'utf8'));
const examples=run('examples').examples;
const capabilityRegistry=run('capabilities').capabilities;
const commandNames=new Set(commands.commands.map(command=>command.name));
const dynamicCommandNames=new Set(ai.commands);
const constructById=new Map(ai.constructs.map(item=>[item.id,item]));
const contractFunctions=new Set(ai.constructs.flatMap(construct=>[...construct.syntax.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map(match=>match[1])));
const exampleByName=new Map(examples.map(item=>[item.name,item]));
const registeredCapabilities=new Set(capabilityRegistry.map(item=>item.name));
const capabilityTopics={http:'http',database:'database',environment:'configuration-secrets',time:'email-time-random-base64-crypto',random:'email-time-random-base64-crypto',secureRandom:'email-time-random-base64-crypto',filesystem:'filesystem-path',email:'email-time-random-base64-crypto'};
const publicDocs=['README.md','docs/INSTALL.md','docs/GETTING_STARTED.md','docs/LANGUAGE_BASICS.md','docs/FULL_STACK_GUIDE.md','docs/CUSTOM_APP_READING_QUEUE.md','docs/STYLING_GUIDE.md','docs/AI_AGENT_GUIDE.md','docs/AI_WEBSITE.md','docs/CAPABILITIES.md','docs/NATIVE_BACKEND_COVERAGE.md','docs/DATABASE_PRODUCTION.md','docs/DEPLOYMENT.md','docs/CLI_REFERENCE.md','docs/STANDARD_LIBRARY.md','docs/CAPABILITY_COVERAGE.md','docs/SHOWCASE.md','spec/language.md','spec/types.md','spec/semantics.md','spec/invariants.md','spec/diagnostics.md','ai/ai-spec.md'];
const diagnosticsText=readFileSync(join(root,'spec','diagnostics.md'),'utf8');
const generatedDocs=new Set(['docs/CLI_REFERENCE.md','docs/STANDARD_LIBRARY.md','docs/CAPABILITY_COVERAGE.md']);
const errors=[];
const requireValue=(condition,message)=>{if(!condition)errors.push(message);};
requireValue([...commandNames].every(name=>dynamicCommandNames.has(name))&&[...dynamicCommandNames].every(name=>commandNames.has(name)),'Static CLI catalog and compiler AI specification command names disagree');
for(const catalog of [commands,diagnostics,run('examples')])requireValue(catalog.languageVersion===ai.languageVersion,`Human/AI documentation version mismatch in ${catalog.schemaVersion}`);
const diagnosticFamilies=new Set([...diagnosticsText.matchAll(/\b(PIPE-[A-Z]+)(?:-\d+)?\b/g)].map(match=>match[1]));
requireValue([...diagnosticFamilies].every(code=>Object.hasOwn(diagnostics.categories,code))&&Object.keys(diagnostics.categories).every(code=>diagnosticFamilies.has(code)), 'Human diagnostic reference and machine category catalog disagree');
const topicById=new Map(map.capabilities.map(topic=>[topic.id,topic]));
const citedConstructs=new Set();
for(const topic of map.capabilities){
  requireValue(topic.support==='supported'||topic.support==='limited'||topic.support==='unsupported',`${topic.id}: invalid support state`);
  requireValue(topic.title&&topic.human&&topic.spec&&topic.diagnostics?.length&&(topic.support==='unsupported'||topic.examples?.length),`${topic.id}: missing inventory fields`);
  for(const id of topic.constructs??[]){requireValue(constructById.has(id),`${topic.id}: unknown AI construct ${id}`);citedConstructs.add(id);}
  for(const name of topic.commands??[])requireValue(commandNames.has(name),`${topic.id}: unknown CLI command ${name}`);
  for(const code of topic.diagnostics??[])requireValue(diagnostics.categories[code]||new RegExp(`\\b${code}-[A-Z0-9]+\\b`).test(diagnosticsText),`${topic.id}: unknown diagnostic category/code ${code}`);
  for(const name of topic.examples??[])requireValue(existsSync(join(root,name)),`${topic.id}: missing example ${name}`);
  const humanPath=topic.human.split('#')[0],sourceHuman=humanPath.startsWith('../')?resolve(root,'docs',humanPath):resolve(root,'docs',humanPath);
  requireValue(existsSync(sourceHuman)||(process.argv.includes('--write')&&generatedDocs.has(sourceHuman.slice(root.length+1).replaceAll('\\','/'))),`${topic.id}: missing human document ${topic.human}`);
  if(topic.support==='unsupported')requireValue(typeof topic.note==='string'&&readFileSync(sourceHuman,'utf8').includes(topic.note),`${topic.id}: unsupported status is not explained in its human guide`);
  const specPath=resolve(root,'docs',topic.spec);
  requireValue(existsSync(specPath),`${topic.id}: missing canonical spec ${topic.spec}`);
}
for(const construct of ai.constructs)requireValue(citedConstructs.has(construct.id),`Public AI construct lacks a human capability mapping: ${construct.id}`);
for(const name of registeredCapabilities)requireValue(Boolean(topicById.get(capabilityTopics[name])),`Public capability lacks a human coverage mapping: ${name}`);

const symbolTopic=(contract)=>{
  const caps=contract.capabilities??[];
  if(caps.includes('database'))return topicById.get('database');
  if(caps.includes('filesystem'))return topicById.get('filesystem-path');
  if(caps.includes('environment'))return topicById.get('configuration-secrets');
  if(caps.includes('email'))return topicById.get('email-time-random-base64-crypto');
  if(caps.includes('secureRandom')||caps.includes('random')||caps.includes('time'))return topicById.get('email-time-random-base64-crypto');
  const name=contract.name.toLowerCase();
  if(name.includes('json'))return topicById.get('json');
  if(name.includes('path')||name.includes('file')||name.includes('directory')||name.includes('upload'))return topicById.get('filesystem-path');
  if(name.includes('money'))return topicById.get('money');
  if(name.includes('http')||name.includes('request'))return topicById.get('http');
  return topicById.get('syntax');
};
const publicCapabilities=topic=>capabilityRegistry.filter(cap=>capabilityTopics[cap.name]===topic.id).map(cap=>cap.name);
const stdlibRows=ai.stdlibContracts.map(contract=>({name:contract.name,topic:symbolTopic(contract)}));
for(const row of stdlibRows)requireValue(Boolean(row.topic),`Public standard-library symbol lacks a human mapping: ${row.name}`);
requireValue(new Set(stdlibRows.map(row=>row.name)).size===ai.stdlibContracts.length&&stdlibRows.length===ai.stdlibContracts.length,'One or more public standard-library symbols lack exactly one human mapping');
const mappedHostCapabilities=map.capabilities.flatMap(topic=>publicCapabilities(topic));
requireValue(new Set(mappedHostCapabilities).size===registeredCapabilities.size&&[...registeredCapabilities].every(name=>mappedHostCapabilities.includes(name)),'Host capability registry entries are missing or duplicated in the coverage map');

const temp=mkdtempSync(join(tmpdir(),'bmec-doc-examples-'));
const verifiedExamples=new Set();
try{
  const files=new Set(map.capabilities.flatMap(topic=>topic.examples??[]));
  for(const file of files){
    const result=execFileSync(process.execPath,[cli,'check',join(root,file)],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
    requireValue(result.includes('OK'),`Mapped example did not compile: ${file}`);verifiedExamples.add(file);
  }
  for(const construct of ai.constructs){
    const source=construct.example.startsWith('app ')?construct.example:`app Documentation${construct.id.replace(/[^A-Za-z0-9]/g,'')}\n${construct.example}`;
    const target=join(temp,`${construct.id}.bmec`);writeFileSync(target,source);
    try{execFileSync(process.execPath,[cli,'check',target],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});}
    catch(error){errors.push(`AI contract example ${construct.id} does not compile (${String(error.stderr??error.message).trim()})`);}
  }
  for(const example of examples){
    const target=join(temp,`${example.name}.bmec`);writeFileSync(target,example.source);
    try{execFileSync(process.execPath,[cli,'check',target],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});}
    catch(error){errors.push(`AI catalog example ${example.id} does not compile (${String(error.stderr??error.message).trim()})`);}
  }
for(const file of publicDocs.filter(file=>file.endsWith('.md')&&!(process.argv.includes('--write')&&['docs/CAPABILITY_COVERAGE.md','docs/CLI_REFERENCE.md','docs/STANDARD_LIBRARY.md'].includes(file))&&file!=='ai/ai-spec.md')){
    if(!existsSync(join(root,file)))continue;
    const content=readFileSync(join(root,file),'utf8');
    for(const [index,match] of [...content.matchAll(/```bmec\s*\n([\s\S]*?)```/g)].entries()){
      const source=match[1].trim();if(!source)continue;
      const sample=source.startsWith('app ')?source:`app DocumentationExample${index+1}\n${source}`;
      const target=join(temp,`${basename(file,'.md')}-${index+1}.bmec`);writeFileSync(target,sample);
      try{execFileSync(process.execPath,[cli,'check',target],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});}
      catch(error){errors.push(`${file}: BMEC code fence ${index+1} does not compile (${String(error.stderr??error.message).trim()})`);}
    }
  }
}finally{rmSync(temp,{recursive:true,force:true});}

const published=new Set([
  '/','/index.html','/styles.css','/app.js','/README.md','/SECURITY.md','/showcase.json','/version.json','/site-data.json',
  '/ai/ai-spec.md','/ai/ai-spec.json','/ai/index.json','/ai/index.schema.json','/ai/commands.json','/ai/capabilities.json','/ai/diagnostics.json','/ai/examples.json',
  ...publicDocs.map(file=>`/${file}`),
  ...['language.md','types.md','semantics.md','invariants.md','diagnostics.md'].map(file=>`/spec/${file}`),
  ...[...verifiedExamples].map(file=>`/${file}`),
  '/docs/capability-coverage.json','/docs/CAPABILITY_COVERAGE.md'
]);
const slug=heading=>heading.toLowerCase().replace(/<[^>]+>/g,'').replace(/[`*_~]/g,'').replace(/[^\p{L}\p{N}\s-]/gu,'').trim().replace(/\s+/g,'-');
for(const file of publicDocs.filter(file=>file.endsWith('.md')&&existsSync(join(root,file))&&!(process.argv.includes('--write')&&file==='docs/CAPABILITY_COVERAGE.md'))){
  const source=readFileSync(join(root,file),'utf8');
  const prose=source.replace(/```[\s\S]*?```/g,'');
  const documentedSymbols=new Set([...(ai.stdlib??[]),...contractFunctions,'ok','err','some','none','isOk','isErr','lambda','function','COUNT']);
  for(const [,name] of prose.matchAll(/`([A-Za-z_]\w*)\s*\(/g))requireValue(documentedSymbols.has(name),`${file}: referenced function is absent from the public symbol catalog: ${name}`);
  const anchors=new Set([...source.matchAll(/^#{1,6}\s+(.+)$/gm)].map(match=>slug(match[1])));
  for(const [,target] of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
    const href=target.trim().split(/\s+/)[0];if(!href||/^(?:https?:|mailto:|#)/i.test(href))continue;
    const [path,fragment]=href.split('#');
    if(path.startsWith('/')){
      requireValue(published.has(path),`${file}: website link is not a published asset: ${path}`);
      if(fragment){const targetFile=path==='/docs/CAPABILITIES.md'?'docs/CAPABILITIES.md':null;if(targetFile){const targetAnchors=new Set(readFileSync(join(root,targetFile),'utf8').matchAll(/^#{1,6}\s+(.+)$/gm));requireValue([...targetAnchors].some(match=>slug(match[1])===fragment),`${file}: missing website anchor ${href}`);}}
      continue;
    }
    const targetFile=resolve(root,dirname(file),path||basename(file));
    const relTarget=targetFile.slice(root.length+1).replaceAll('\\','/');
    requireValue(existsSync(targetFile)||(process.argv.includes('--write')&&generatedDocs.has(relTarget)),`${file}: broken internal link ${href}`);
    if(fragment&&targetFile.endsWith('.md')){const text=readFileSync(targetFile,'utf8'),targetAnchors=[...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map(match=>slug(match[1]));requireValue(targetAnchors.includes(fragment),`${file}: missing anchor ${href}`);}
  }
}

const specUrl=topic=>topic.spec.startsWith('../spec/')?`/spec/${topic.spec.slice('../spec/'.length)}`:topic.spec.startsWith('../ai/')?`/ai/${topic.spec.slice('../ai/'.length)}`:`/spec/${basename(topic.spec)}`;
const rows=map.capabilities.map(topic=>({
  id:topic.id,title:topic.title,support:topic.support,
  availability:{packageVersion:pkg.version,languageVersion:ai.languageVersion},
  canonical:{spec:topic.spec,specUrl:specUrl(topic),metadata:{constructCatalog:topic.constructs?.length?'/ai/ai-spec.json#/constructs':null,stdlibCatalog:stdlibRows.some(row=>row.topic===topic)?'/ai/ai-spec.json#/stdlibContracts':null,commandCatalog:topic.commands?.length?'/ai/commands.json':null,capabilityCatalog:publicCapabilities(topic).length?'/ai/capabilities.json':null,diagnosticCatalog:'/ai/diagnostics.json'},constructs:topic.constructs??[],stdlib:stdlibRows.filter(row=>row.topic===topic).map(row=>row.name),commands:topic.commands??[],capabilities:publicCapabilities(topic)},
  supportNote:topic.note??null,
  human:topic.human.startsWith('../spec/')?`/spec/${topic.human.slice('../spec/'.length)}`:`/docs/${topic.human.replace(/^docs\//,'')}`,
  ai:{href:'/ai/ai-spec.json',constructIds:topic.constructs??[],commandCatalog:'/ai/commands.json',commands:topic.commands??[],capabilityCatalog:'/ai/capabilities.json',capabilities:publicCapabilities(topic),stdlibCatalog:'/ai/ai-spec.json#/stdlibContracts',stdlib:stdlibRows.filter(row=>row.topic===topic).map(row=>row.name),diagnosticCatalog:'/ai/diagnostics.json'},
  examples:(topic.examples??[]).map(path=>({path:`/${path}`,verified:verifiedExamples.has(path)})),
  diagnostics:topic.diagnostics
}));
const inventory={schemaVersion:'bmec.documentation-coverage.v1',packageVersion:pkg.version,languageVersion:ai.languageVersion,capabilities:rows,registry:{constructs:ai.constructs.length,standardLibrarySymbols:ai.stdlibContracts.length,hostCapabilities:capabilityRegistry.length},checks:{mappedConstructs:citedConstructs.size,verifiedExamples:verifiedExamples.size,publicDocuments:publicDocs.filter(file=>existsSync(join(root,file))).length}};
const json=JSON.stringify(inventory,null,2)+'\n';
const cliReference=['# BMEC CLI reference','','Generated from the public CLI command catalog. Do not edit this command list by hand.','','Package version: **'+pkg.version+'**<br>','Language version: **'+ai.languageVersion+'**','','| Command | Usage |','|---|---|',...commands.commands.map(command=>`| \`bmec ${command.name}\` | \`${command.usage}\` |`),'','Use `bmec help` for the installed command summary. The AI agent guide describes a compiler-driven check and repair workflow.',''].join('\n');
const standardLibrary=['# BMEC standard-library reference','','Generated from `bmec ai-spec --json` standard-library contracts. Do not edit the function list by hand.','','Package version: **'+pkg.version+'**<br>','Language version: **'+ai.languageVersion+'**','','| Function | Arguments | Returns | Required capabilities |','|---|---|---|---|',...ai.stdlibContracts.map(item=>`| \`${item.name}\` | ${item.arguments.map(value=>`\`${value}\``).join(', ')||'none'} | \`${item.returns}\` | ${(item.capabilities??[]).map(value=>`\`${value}\``).join(', ')||'none'} |`),'','For usage constraints and examples, inspect the compiler contract with `bmec stdlib --json` or `bmec ai-spec --json`.',''].join('\n');
const metadataLinks=row=>[row.canonical.metadata.constructCatalog?`[AI constructs](${row.canonical.metadata.constructCatalog})`:null,row.canonical.metadata.stdlibCatalog?`[standard library](${row.canonical.metadata.stdlibCatalog})`:null,row.canonical.metadata.commandCatalog?`[CLI catalog](${row.canonical.metadata.commandCatalog})`:null,row.canonical.metadata.capabilityCatalog?`[host capabilities](${row.canonical.metadata.capabilityCatalog})`:null].filter(Boolean).join(' · ');
const table=['# BMEC public capability documentation coverage','','Generated from `docs/capability-map.json`, the compiler AI specification, CLI command catalog, capability registry, diagnostic catalog, package metadata, and checked example files. Do not edit this report by hand.','','Package version: **'+pkg.version+'**<br>','Language version: **'+ai.languageVersion+'**','','| Capability | Support | Canonical spec / metadata | Human guide | AI documentation | Verified examples | Diagnostics | Version |','|---|---|---|---|---|---|---|---|',...rows.map(row=>`| ${row.title} | ${row.support}${row.supportNote?` — ${row.supportNote}`:''} | [Spec](${row.canonical.specUrl})${metadataLinks(row)?` · ${metadataLinks(row)}`:''}; ${row.canonical.constructs.join(', ')||row.canonical.commands.join(', ')||'compiler/host contract'} | [Guide](${row.human}) | [AI spec](${row.ai.href})${row.ai.constructIds.length?` (${row.ai.constructIds.join(', ')})`:''} | ${row.examples.map(item=>`[${item.path}](${item.path}) ${item.verified?'✓':'✗'}`).join('<br>')||'— (not offered)'} | ${row.diagnostics.join(', ')} | package ${pkg.version}; language ${ai.languageVersion} |`),'',`Registry coverage: ${inventory.registry.constructs} compiler constructs, ${inventory.registry.standardLibrarySymbols} standard-library functions, ${inventory.registry.hostCapabilities} host capabilities. ${inventory.checks.verifiedExamples} distinct mapped example files compile.`,``,`Support states: **supported** is in the public surface; **limited** has a documented boundary; **unsupported** is not offered by this release.`,''].join('\n');

const jsonPath=join(root,'docs','capability-coverage.json'),mdPath=join(root,'docs','CAPABILITY_COVERAGE.md'),cliPath=join(root,'docs','CLI_REFERENCE.md'),stdlibPath=join(root,'docs','STANDARD_LIBRARY.md');
if(process.argv.includes('--write')){writeFileSync(jsonPath,json);writeFileSync(mdPath,table);writeFileSync(cliPath,cliReference);writeFileSync(stdlibPath,standardLibrary);}
else{
  requireValue(readFileSync(jsonPath,'utf8')===json,'Generated JSON coverage report is stale; run npm run docs:coverage');
  requireValue(readFileSync(mdPath,'utf8')===table,'Generated Markdown coverage report is stale; run npm run docs:coverage');
  requireValue(readFileSync(cliPath,'utf8')===cliReference,'Generated CLI reference is stale; run npm run docs:coverage');
  requireValue(readFileSync(stdlibPath,'utf8')===standardLibrary,'Generated standard-library reference is stale; run npm run docs:coverage');
}
if(errors.length){console.error(`DOCUMENTATION COVERAGE FAIL (${errors.length})\n- ${errors.join('\n- ')}`);process.exit(1);}
console.log(`DOCUMENTATION COVERAGE PASS — ${rows.length} capability areas, ${inventory.registry.constructs} compiler constructs, ${inventory.registry.standardLibrarySymbols} standard-library symbols, ${inventory.registry.hostCapabilities} host capabilities, ${verifiedExamples.size} mapped examples`);
