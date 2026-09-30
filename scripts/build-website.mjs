import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync,cpSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {createKnowledgeIndex} from '../dist/cli/knowledge.js';
import {BMEC_DESIGN_TOKEN_CSS} from '../dist/style/design-tokens.js';
import {build as bundle} from 'esbuild';

const root=process.cwd(),website=resolve(root,'website'),output=resolve(website,'dist');
if(!output.startsWith(`${website}${process.platform==='win32'?'\\':'/'}`))throw new Error('Website output must stay inside website/');
if(existsSync(output))rmSync(output,{recursive:true,force:true});
mkdirSync(output,{recursive:true});
for(const file of ['index.html','styles.css','app.js','playground.js'])cpSync(join(website,file),join(output,file));
writeFileSync(join(output,'design-tokens.css'),BMEC_DESIGN_TOKEN_CSS);
const write=(path,value)=>{const target=join(output,path);mkdirSync(resolve(target,'..'),{recursive:true});writeFileSync(target,value);};
const copy=(source,path)=>{const target=join(output,path);mkdirSync(resolve(target,'..'),{recursive:true});cpSync(join(root,source),target);};
const workerBuild=await bundle({entryPoints:[join(root,'src','compiler','browser-worker.ts')],bundle:true,platform:'browser',target:'es2022',format:'iife',minify:true,write:false,logLevel:'silent'});
const workerSource=workerBuild.outputFiles[0].text;
if(/\bnode:(?:fs|path|crypto|child_process)\b|\b(?:process\.env|child_process|readFileSync|writeFileSync)\b|\b(?:fetch|XMLHttpRequest|WebSocket|importScripts)\b|\beval\s*\(|new Function\s*\(/.test(workerSource))throw new Error('Browser checker bundle contains a host, network, or code-execution capability');
write('playground-worker.js',workerSource);
const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const siteBaseUrl=(process.env.BMEC_SITE_BASE_URL??'').replace(/\/$/,'');
if(!siteBaseUrl)throw new Error('Set BMEC_SITE_BASE_URL to the confirmed production HTTPS origin');
if(!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(siteBaseUrl))throw new Error('BMEC_SITE_BASE_URL must be an HTTPS origin');
const allowIndexing=process.env.BMEC_ALLOW_INDEXING==='1';
const catalog=JSON.parse(readFileSync(join(root,'ai','examples.json'),'utf8'));
const commands=JSON.parse(readFileSync(join(root,'ai','commands.json'),'utf8'));
const diagnostics=JSON.parse(readFileSync(join(root,'ai','diagnostics.json'),'utf8'));
const knowledgeIndex=createKnowledgeIndex({examples:catalog,diagnostics},pkg.version);
const knowledgeJson=JSON.stringify(knowledgeIndex,null,2)+'\n';
writeFileSync(join(root,'ai','knowledge-index.json'),knowledgeJson);
const coverage=JSON.parse(readFileSync(join(root,'docs','capability-coverage.json'),'utf8'));
const showcase=JSON.parse(readFileSync(join(website,'showcase.json'),'utf8'));
const showcaseSchema=JSON.parse(readFileSync(join(website,'showcase.schema.json'),'utf8'));
const aiIndexSchema=JSON.parse(readFileSync(join(website,'ai-index.schema.json'),'utf8'));
const showcaseImages=new Map([
  ['/assets/northline-desktop.png','website/assets/showcases/northline-desktop.png'],
  ['/assets/paper-harbor.png','website/assets/showcases/paper-harbor.png'],
  ['/assets/job-booking.png','website/assets/showcases/job-booking.png'],
  ['/assets/pulseboard.png','website/assets/showcases/pulseboard.png'],
  ['/assets/community-issues.png','website/assets/showcases/community-issues.png'],
]);
const pngDimensions=new Map([...showcaseImages].map(([url,source])=>{const bytes=readFileSync(join(root,source));if(bytes.toString('ascii',1,4)!=='PNG')throw new Error(`Invalid PNG showcase image: ${source}`);return[url,{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}];}));
if(showcase.schemaVersion!==showcaseSchema.properties.schemaVersion.const||!Array.isArray(showcase.projects)||Object.keys(showcase).some(key=>!['schemaVersion','projects'].includes(key)))throw new Error('Invalid showcase catalog header');
const projectIds=new Set();
for(const project of showcase.projects){
  const spec=showcaseSchema.$defs.project,required=spec.required;
  if(required.some(key=>project[key]===undefined))throw new Error(`Showcase project ${project.id??'(missing id)'} is missing required fields`);
  if(Object.keys(project).some(key=>!Object.hasOwn(spec.properties,key)))throw new Error(`Showcase project ${project.id} has an unknown field`);
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.id)||projectIds.has(project.id))throw new Error(`Invalid or duplicate showcase project id: ${project.id}`);
  projectIds.add(project.id);
  for(const [key,max] of [['name',80],['tagline',120],['description',500],['category',Infinity],['disclosure',500]])if(typeof project[key]!=='string'||!project[key].trim()||project[key].length>max)throw new Error(`Invalid showcase ${key} for ${project.id}`);
  if(!['Demo','Prototype','In use'].includes(project.status)||!Array.isArray(project.builtWith)||!project.builtWith.length||project.builtWith.some(item=>typeof item!=='string'||!item.trim())||new Set(project.builtWith).size!==project.builtWith.length)throw new Error(`Invalid showcase project metadata: ${project.id}`);
  if(Object.keys(project.preview).some(key=>!['src','alt'].includes(key))||typeof project.preview.src!=='string'||typeof project.preview.alt!=='string'||!project.preview.alt.trim())throw new Error(`Invalid showcase preview for ${project.id}`);
  for(const path of [project.source,project.preview.src])if(typeof path!=='string'||!path.startsWith('/')||path.split('/').includes('..'))throw new Error(`Invalid showcase path ${path} for ${project.id}`);
  const sourcePath=join(root,project.source.slice(1)),imagePath=showcaseImages.get(project.preview.src);
  if(!existsSync(sourcePath))throw new Error(`Missing showcase source ${project.source} for ${project.id}`);
  if(!imagePath||!existsSync(join(root,imagePath)))throw new Error(`Missing genuine showcase image ${project.preview.src} for ${project.id}`);
}
const configuredRepository=(process.env.BMEC_REPOSITORY_URL??pkg.repository?.url??'').replace(/^git\+/, '').replace(/\.git$/,'');
const sourceUrl=configuredRepository.replace(/^git@github\.com:/,'https://github.com/');
if(!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/i.test(sourceUrl))throw new Error('Set package.repository.url or BMEC_REPOSITORY_URL to the intended public GitHub repository');
const docs=[
  ['LEARNING_PATH.md','Learning path','START HERE','Follow 15 checked steps from installation to deployment.'],
  ['GETTING_STARTED.md','Getting started','START HERE','Create, check, build, and run your first BMEC app.'],
  ['LANGUAGE_BASICS.md','Language basics','LANGUAGE','Types, functions, models, and control flow.'],
  ['FULL_STACK_GUIDE.md','Full-stack guide','APPLICATIONS','Connect routes, database operations, and typed user interfaces.'],
  ['CUSTOM_APP_READING_QUEUE.md','Build your own reading queue','APPLICATIONS','Turn a generated BMEC project into a private, owner-scoped application.'],
  ['STYLING_GUIDE.md','Styling guide','UI','Compose named styles and responsive behavior.'],
  ['INSTALL.md','Installation','DOWNLOAD','Install the CLI and the VS Code extension.'],
  ['BMEC_EDITOR_SETUP.md','Editor setup','TOOLING','Configure VS Code support through the BMEC language server.'],
  ['language-completion.md','Editor and completion support','TOOLING','Review the advertised language-server features and completion trigger behavior.'],
  ['AI_AGENT_GUIDE.md','AI agent guide','TOOLING','Discover commands, diagnostics, and stable machine-readable facts.'],
  ['SECURITY_MODEL.md','Security model','OPERATIONS','Understand authentication, authorization, origins, and runtime boundaries.'],
  ['THREAT_MODEL.md','Threat model','OPERATIONS','Review trust boundaries, assets, and the risks BMEC documents.'],
  ['CLI_REFERENCE.md','CLI reference','REFERENCE','Browse every public BMEC command and its current usage.'],
  ['STANDARD_LIBRARY.md','Standard-library reference','REFERENCE','Browse compiler-generated standard-library signatures and required capabilities.'],
  ['CAPABILITY_COVERAGE.md','Capability coverage','REFERENCE','Find the public support boundary, documentation, examples, and diagnostics for each capability.'],
  ['CAPABILITIES.md','Capabilities and limitations','REFERENCE','Learn the supported language and platform surface and its operational boundaries.'],
  ['NATIVE_BACKEND_COVERAGE.md','Native compilation boundary','REFERENCE','Understand the supported native subset and how to check programs before using it.'],
  ['DATABASE_PRODUCTION.md','Database production','OPERATIONS','Plan safe schema changes, indexes, transactions, and database recovery.'],
  ['DEPLOYMENT.md','Deployment','OPERATIONS','Build and operate BMEC apps in a Linux container with PostgreSQL.'],
  ['SHOWCASE.md','Showcase listings','COMMUNITY','Prepare a project listing with clear maturity and limitation notes.'],
  ['AI_WEBSITE.md','Website machine index','TOOLING','Find stable machine-readable language, UI, examples, status, and showcase catalogs.'],
];
for(const [file] of docs)copy(join('docs',file),join('docs',file));
for(const file of ['AI_WEBSITE.md'])copy(join('docs',file),join('docs',file));
copy('docs/capability-coverage.json','docs/capability-coverage.json');
for(const file of ['language.md','types.md','semantics.md','invariants.md','diagnostics.md'])copy(join('spec',file),join('spec',file));
copy('README.md','README.md');
copy('LICENSE','LICENSE');
copy('NOTICE','NOTICE');
copy('llms.txt','llms.txt');
copy('SECURITY.md','SECURITY.md');
copy('website/showcase.schema.json','showcase.schema.json');
copy('docs/SHOWCASE.md','docs/SHOWCASE.md');
copy('examples/northline/README.md','examples/northline/README.md');
copy('examples/reading-queue/main.bmec','examples/reading-queue/main.bmec');
for(const project of showcase.projects)copy(project.source.slice(1),project.source.slice(1));
for(const file of ['ai-spec.md','commands.json','diagnostics.json','examples.json'])copy(join('ai',file),join('ai',file));
for(const path of new Set(coverage.capabilities.flatMap(item=>item.examples.map(example=>example.path.slice(1)))))copy(path,path);
const aiSpec=JSON.parse(execFileSync(process.execPath,[join(root,'dist','cli','index.js'),'ai-spec','--json'],{cwd:root,encoding:'utf8'}));
if(aiSpec.schemaVersion!=='bmec.ai-spec.v1'||aiSpec.languageVersion!==catalog.languageVersion)throw new Error('Generated AI specification contract is inconsistent');
write('ai/ai-spec.json',JSON.stringify(aiSpec,null,2));
const hostCapabilities=JSON.parse(execFileSync(process.execPath,[join(root,'dist','cli','index.js'),'capabilities','--json'],{cwd:root,encoding:'utf8'}));
hostCapabilities.schemaVersion=hostCapabilities.version;
write('ai/capabilities.json',JSON.stringify(hostCapabilities,null,2));
for(const [target,source] of showcaseImages)copy(source,target.slice(1));
for(const [name,source] of [['northline-mobile.png','website/assets/showcases/northline-mobile.png'],['northline-tablet.png','website/assets/showcases/northline-tablet.png']])copy(source,join('assets',name));
mkdirSync(join(output,'downloads'),{recursive:true});
const packageArchive=process.env.BMEC_PACKAGE_ARCHIVE,vsixArchive=process.env.BMEC_VSIX_ARCHIVE;
if(!packageArchive||!existsSync(packageArchive))throw new Error('Set BMEC_PACKAGE_ARCHIVE to the exact reviewed npm archive');
if(!vsixArchive||!existsSync(vsixArchive))throw new Error('Set BMEC_VSIX_ARCHIVE to the exact reviewed VSIX');
const packageFile=basename(packageArchive),vsixPackage=JSON.parse(readFileSync(join(root,'vscode-extension','package.json'),'utf8'));
if(vsixPackage.publisher!=='bmec')throw new Error(`Unexpected VS Code publisher: ${vsixPackage.publisher}`);
const vsixFile=`bmec-language-support-${vsixPackage.version}.vsix`;
if(packageFile!==`${pkg.name}-${pkg.version}.tgz`)throw new Error(`Expected reviewed archive ${pkg.name}-${pkg.version}.tgz, received ${packageFile}`);
copyFileSync(packageArchive,join(output,'downloads',packageFile));
copyFileSync(vsixArchive,join(output,'downloads',vsixFile));
const artifact=(file,name)=>({file:name,sizeBytes:readFileSync(file).length,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')});
write('release-manifest.json',JSON.stringify({schemaVersion:'bmec.release-artifacts.v1',packageVersion:pkg.version,languageVersion:JSON.parse(readFileSync(join(root,'ai','examples.json'),'utf8')).languageVersion,artifacts:[artifact(packageArchive,packageFile),artifact(vsixArchive,vsixFile)]},null,2)+'\n');
const cliDownload=`/downloads/${packageFile}`;
const examples=catalog.examples.map(example=>{const filename=`${example.name}.bmec`;write(join('examples',filename),example.source);return {...example,sourcePath:`/examples/${filename}`,download:`/examples/${filename}`};});
const basics=readFileSync(join(root,'docs','LANGUAGE_BASICS.md'),'utf8');
const learning=[...basics.matchAll(/```bmec\s*\n([\s\S]*?)```/g)].slice(0,2).map((match,index)=>({title:index===0?'A typed expression':'A language boundary',source:match[1].trim()}));
const nodeRequirement=readFileSync(join(root,'docs','INSTALL.md'),'utf8').match(/Node\.js [^\n]+/)?.[0]??'See install guide for the supported Node.js version.';
const data={version:pkg.version,languageVersion:aiSpec.languageVersion,releaseStatus:`Developer beta · BMEC ${pkg.version}`,statusDetail:`Documentation and compiler metadata describe package ${pkg.version} and language ${aiSpec.languageVersion}.`,statusUrl:'/version.json',nodeRequirement,sourceUrl,cliDownload,vscodeDownload:`/downloads/${vsixFile}`,docs:docs.map(([file,title,type,description])=>({title,type,description,href:`/docs/${file}`})),learning,examples,showcase:showcase.projects.map(project=>({...project,previewWidth:pngDimensions.get(project.preview.src).width,previewHeight:pngDimensions.get(project.preview.src).height})),commandCount:commands.commands?.length??0};
write('site-data.json',JSON.stringify(data,null,2));
write('showcase.json',JSON.stringify(showcase,null,2));
const version={schemaVersion:'bmec.version.v1',packageVersion:pkg.version,languageVersion:aiSpec.languageVersion,releaseStatus:data.releaseStatus};
write('version.json',JSON.stringify(version,null,2));
const aiIndex={schemaVersion:'bmec.website-index.v1',version:pkg.version,languageVersion:aiSpec.languageVersion,status:'/version.json',catalogs:[
  {id:'language',title:'Language and compiler contract',href:'/ai/ai-spec.json',schemaVersion:aiSpec.schemaVersion,jsonPointers:['/constructs','/syntax','/types','/operators','/stdlibContracts']},
  {id:'ui',title:'UI, styles, and page contracts',href:'/ai/ai-spec.json',schemaVersion:aiSpec.schemaVersion,jsonPointers:['/completionVocabulary/controlledEnglishUi','/completionVocabulary/controlledEnglishStyle','/projectionSchemas/pages','/projectionSchemas/styles']},
  {id:'commands',title:'CLI commands and projection schemas',href:'/ai/commands.json',schemaVersion:commands.schemaVersion},
  {id:'capabilities',title:'Host capabilities and required standard-library functions',href:'/ai/capabilities.json',schemaVersion:hostCapabilities.schemaVersion},
  {id:'diagnostics',title:'Compiler diagnostics',href:'/ai/diagnostics.json',schemaVersion:diagnostics.schemaVersion},
  {id:'examples',title:'Checked BMEC examples',href:'/ai/examples.json',schemaVersion:catalog.schemaVersion},
  {id:'knowledge',title:'Searchable BMEC knowledge index',href:'/ai/knowledge-index.json',schemaVersion:knowledgeIndex.schemaVersion},
  {id:'showcase',title:'Built-with-BMEC projects',href:'/showcase.json',schemaVersion:showcase.schemaVersion},
  {id:'capability-coverage',title:'Public capability documentation coverage',href:'/docs/capability-coverage.json',schemaVersion:'bmec.documentation-coverage.v1'}
]};
const aiIndexIds=new Set();
for(const entry of aiIndex.catalogs){
  if(aiIndexIds.has(entry.id))throw new Error(`Duplicate AI catalog id: ${entry.id}`);
  aiIndexIds.add(entry.id);
  const data=entry.href==='/ai/ai-spec.json'?aiSpec:entry.href==='/ai/commands.json'?commands:entry.href==='/ai/capabilities.json'?hostCapabilities:entry.href==='/ai/diagnostics.json'?diagnostics:entry.href==='/ai/examples.json'?catalog:entry.href==='/ai/knowledge-index.json'?knowledgeIndex:entry.href==='/showcase.json'?showcase:entry.href==='/docs/capability-coverage.json'?JSON.parse(readFileSync(join(root,'docs','capability-coverage.json'),'utf8')):null;
  if(!data||data.schemaVersion!==entry.schemaVersion)throw new Error(`AI index schema version mismatch: ${entry.id}`);
  for(const pointer of entry.jsonPointers??[]){let value=data;for(const key of pointer.slice(1).split('/').map(part=>part.replaceAll('~1','/').replaceAll('~0','~')))value=value?.[key];if(value===undefined)throw new Error(`Invalid AI index JSON pointer ${pointer}`);}
}
write('ai/index.json',JSON.stringify(aiIndex,null,2));
write('ai/knowledge-index.json',knowledgeJson);
write('ai/index.html',`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>BMEC AI knowledge</title><body><main><h1>BMEC AI knowledge</h1><p>Use the CLI for a task-focused context pack:</p><pre>bmec knowledge "paginate orders" --json</pre><ul><li><a href="/ai/index.json">Machine-readable index</a></li><li><a href="/ai/knowledge-index.json">Searchable knowledge catalog</a></li><li><a href="/ai/ai-spec.json">Language and UI contract</a></li><li><a href="/ai/commands.json">CLI commands</a></li><li><a href="/ai/capabilities.json">Capabilities</a></li><li><a href="/ai/diagnostics.json">Diagnostics</a></li><li><a href="/ai/examples.json">Checked examples</a></li><li><a href="/docs/AI_AGENT_GUIDE.md">AI agent guide</a></li><li><a href="/llms.txt">llms.txt</a></li></ul></main></body></html>`);
if(aiIndexSchema.properties.schemaVersion.const!==aiIndex.schemaVersion)throw new Error('Website AI index schema is out of sync');
write('ai/index.schema.json',JSON.stringify(aiIndexSchema,null,2));
write('docs/index.html',`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>BMEC documentation</title><body><main><h1>BMEC documentation</h1><p><a href="/">Home</a> · <a href="${sourceUrl}">Source repository</a></p><ul>${[...docs.map(([file,title])=>[title,`/docs/${file}`]),['Language spec','/ai/ai-spec.md'],['AI machine index','/ai/index.json'],['Task knowledge index','/ai/knowledge-index.json'],['AI entry page','/ai/'],['llms.txt','/llms.txt'],['Language and UI JSON contract','/ai/ai-spec.json'],['CLI commands','/ai/commands.json'],['Diagnostics','/ai/diagnostics.json'],['Examples catalog','/ai/examples.json'],['Capability coverage inventory','/docs/CAPABILITY_COVERAGE.md'],['Built-with showcase','/showcase.json'],['Version and status','/version.json']].map(([title,href])=>`<li><a href="${href}">${title}</a></li>`).join('')}</ul></main></body></html>`);
const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const socialMetadata=({title,description,path})=>`<link rel="canonical" href="${siteBaseUrl}${path}"><meta property="og:type" content="website"><meta property="og:site_name" content="BMEC"><meta property="og:title" content="${escapeHtml(title)} — BMEC"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${siteBaseUrl}${path}"><meta property="og:image" content="${siteBaseUrl}/assets/northline-desktop.png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)} — BMEC"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${siteBaseUrl}/assets/northline-desktop.png">`;
writeFileSync(join(output,'index.html'),readFileSync(join(output,'index.html'),'utf8').replace('</head>',`${socialMetadata({title:'Build full-stack software with humans and AI',description:'Build full-stack software with humans and AI using BMEC, a statically typed language with checked data, routes, and user interfaces.',path:'/'})}<link rel="icon" href="/favicon.svg" type="image/svg+xml"></head>`));
const pageShell=({title,description,section,body,csp,path='/'})=>`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f4f5f0"><meta name="description" content="${escapeHtml(description)}">${socialMetadata({title,description,path})}<link rel="icon" href="/favicon.svg" type="image/svg+xml">${csp?`<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">`:''}<title>${escapeHtml(title)} — BMEC</title><link rel="stylesheet" href="/design-tokens.css"><link rel="stylesheet" href="/styles.css"></head>
<body><a class="skip-link" href="#main">Skip to content</a>
<header class="site-header page-header"><a class="brand" href="/" aria-label="BMEC home"><span class="brand-mark" aria-hidden="true">B</span><span>BMEC</span></a><nav aria-label="Main navigation"><a href="/docs/">Docs</a><a href="/learn/">Learn</a><a href="/examples/">Examples</a><a href="/showcase/">Projects</a><a href="/playground/">Playground</a><a href="/ai/">AI</a><a href="/security/">Security</a><a href="/deploy/">Deploy</a></nav></header>
<main id="main" class="route-wrap"><p class="route-kicker">${escapeHtml(section)}</p><h1>${escapeHtml(title)}</h1><p class="route-lede">${escapeHtml(description)}</p><div class="route-content">${body}</div></main>
<footer class="site-footer route-footer"><div class="section-wrap footer-inner"><a class="brand brand-footer" href="/"><span class="brand-mark" aria-hidden="true">B</span><span>BMEC</span></a><p>BMEC ${escapeHtml(pkg.version)} · Developer preview</p><div class="route-footer-links"><a href="/contact/">Contact</a><a href="/support/">Support</a><a href="${escapeHtml(sourceUrl)}">Source code</a></div></div></footer>
</body></html>`;
const page=(slug,title,description,section,body)=>write(`${slug}/index.html`,pageShell({title,description,section,body,path:`/${slug}/`,csp:slug==='playground'?"default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'":undefined}));
const docRows=[...docs.map(([file,title,type,description])=>({title,kind:type,description,href:`/docs/${file}`})),{title:'Language specification',kind:'REFERENCE',description:'Read the language, type, semantics, invariant, and diagnostic contracts.',href:'/ai/ai-spec.md'},{title:'Deployment guide',kind:'OPERATIONS',description:'Build and operate the Linux/PostgreSQL reference deployment.',href:'/docs/DEPLOYMENT.md'}];
const docCards=docRows.map(item=>`<a class="route-card" href="${escapeHtml(item.href)}"><span>${escapeHtml(item.kind)}</span><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.description)}</p><b>Read guide</b></a>`).join('');
page('docs','Documentation','Find installation, language, application, operations, and reference guides.','Start here',`<section class="route-section"><div class="route-card-grid">${docCards}</div><p><a href="/ai/">Browse machine-readable BMEC knowledge</a> · <a href="/llms.txt">Open llms.txt</a></p></section>`);
const exampleCards=examples.map(item=>`<article class="route-card"><span>CHECKED EXAMPLE</span><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.purpose)}</p><p class="route-tags">${escapeHtml(item.constructs.slice(0,4).join(' · '))}</p><p><a href="${escapeHtml(item.sourcePath)}">Read source</a> · <a href="${escapeHtml(item.download)}">Download</a></p></article>`).join('');
page('examples','Examples','Open real BMEC programs, each maintained with the project example catalog.','Source to study',`<section class="route-section"><div class="route-card-grid">${exampleCards}</div><p>Examples are checked from BMEC source in the repository. The checked catalog is also available as <a href="/ai/examples.json">JSON</a>.</p></section>`);
const showcaseCards=showcase.projects.map(project=>{const size=pngDimensions.get(project.preview.src);return `<article class="route-showcase-card"><div class="route-showcase-image"><img src="${escapeHtml(project.preview.src)}" alt="${escapeHtml(project.preview.alt)}" width="${size.width}" height="${size.height}" loading="lazy"></div><div><span>${escapeHtml(project.category)} · ${escapeHtml(project.status)}</span><h2>${escapeHtml(project.name)}</h2><p>${escapeHtml(project.description)}</p><ul class="route-tags">${project.builtWith.map(tag=>`<li>${escapeHtml(tag)}</li>`).join('')}</ul><p class="route-disclosure">${escapeHtml(project.disclosure)}</p><a href="${escapeHtml(project.source)}">Read project source and notes</a></div></article>`;}).join('');
page('showcase','Built with BMEC','Four application examples, shown with genuine screenshots and clear notes about their limits.','Project showcase',`<section class="route-section route-showcase-list">${showcaseCards}</section>`);
const aiLinks=[['Machine-readable index','/ai/index.json'],['Searchable knowledge','/ai/knowledge-index.json'],['Language and UI contract','/ai/ai-spec.json'],['CLI commands','/ai/commands.json'],['Capabilities','/ai/capabilities.json'],['Diagnostics','/ai/diagnostics.json'],['Checked examples','/ai/examples.json'],['Agent guide','/docs/AI_AGENT_GUIDE.md'],['llms.txt','/llms.txt']];
const aiCards=aiLinks.map(([label,href])=>`<a class="route-card" href="${href}"><h2>${label}</h2><p>Open the current BMEC catalog.</p><b>View resource</b></a>`).join('');
page('ai','AI knowledge','Use stable language facts, diagnostics, examples, and task-focused context packs to guide an AI coding agent.','Structured discovery',`<section class="route-section"><p>Ask the CLI for a small, relevant context pack:</p><pre class="route-terminal" tabindex="0" aria-label="BMEC command example"><code>bmec knowledge "paginate orders" --json</code></pre><div class="route-card-grid">${aiCards}</div></section>`);
for(const [slug,title,description,section] of [
  ['learn','Learn BMEC','Go from installation to a useful full-stack application with a clear, maintained learning path.','Learning path'],
  ['playground','BMEC playground','Check BMEC source in your browser with real compiler diagnostics, typed IR, and an AI context pack.','Try BMEC'],
  ['architecture','How BMEC works','Follow BMEC source through the compiler, typed intermediate representation, runtimes, and backends.','Architecture'],
  ['security','Security and trust boundaries','Review authentication, authorization, origin checks, runtime capabilities, and current security limits.','Security'],
  ['deploy','Deployment and operations','Run BMEC with PostgreSQL in a Linux container, then plan upgrades, backup, and recovery.','Deployment'],
  ['benchmarks','Benchmarking BMEC','Use repeatable workloads and describe local measurements with the machine and runtime that produced them.','Measurement'],
  ['roadmap','Project status','See what the developer preview includes and what remains under development.','Roadmap'],
  ['support','Support BMEC','Find the verified PayPal handle for optional support of the independent BMEC project.','Optional support'],
  ['contact','Contact','Send the maintainer a language, documentation, or project question.','Maintainer contact'],
]){
  const body=readFileSync(join(website,'pages',`${slug}.html`),'utf8');
  page(slug,title,description,section,body);
}
write('ai/index.html',pageShell({title:'AI knowledge',description:'Give coding agents verified BMEC language facts and task context, then use the compiler to check every change.',section:'Structured discovery',path:'/ai/',body:`<section class="route-section ai-steps"><h2>Use the compiler as the source of truth</h2><ol class="route-steps"><li><strong>Discover the installed language.</strong><span>Read <code>bmec ai-spec --json</code> and <code>bmec capabilities --json</code> for versioned contracts.</span></li><li><strong>Find facts for the task.</strong><span>Search syntax, constraints, diagnostics, and checked examples with the knowledge command.</span></li><li><strong>Write and check a small change.</strong><span>Run <code>bmec check main.bmec</code>; use the diagnostic code and repair suggestion, then check again.</span></li><li><strong>Build the user application.</strong><span>Keep ownership, route authorization, secrets, and deployment policy explicit in application code and operations.</span></li></ol><pre class="route-terminal" tabindex="0" aria-label="BMEC command examples"><code>bmec knowledge "authenticated custom route" --json&#10;bmec check main.bmec --json</code></pre><p>The browser playground checks source locally and does not execute an app. The catalogs describe language support; they do not replace application authorization or host security review.</p><div class="route-card-grid">${aiCards}</div></section>`}));
write('favicon.svg','<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#18221f"/><path d="M43 18H31a14 14 0 1 0 0 28h12v-9H31a5 5 0 1 1 0-10h12z" fill="#d6f36a"/><path d="M28 18h9v28h-9z" fill="#d6f36a"/></svg>');
write('404.html',`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found — BMEC</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/design-tokens.css"><link rel="stylesheet" href="/styles.css"></head><body><a class="skip-link" href="#main">Skip to content</a><main id="main" class="route-wrap"><p class="route-kicker">404</p><h1>Page not found</h1><p class="route-lede">That BMEC page could not be found.</p><p><a href="/">Return to the BMEC homepage</a></p></main></body></html>`);
const sitemapRoutes=['/','/docs/','/learn/','/examples/','/showcase/','/ai/','/playground/','/architecture/','/security/','/deploy/','/benchmarks/','/roadmap/','/support/','/contact/'];
write('sitemap.xml',`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemapRoutes.map(path=>`<url><loc>${siteBaseUrl}${path}</loc></url>`).join('')}</urlset>`);
write('robots.txt',allowIndexing?`User-agent: *\nAllow: /\nSitemap: ${siteBaseUrl}/sitemap.xml\n`:`User-agent: *\nDisallow: /\n`);
console.log(`WEBSITE BUILD PASS — ${examples.length} examples; package ${pkg.version}; exact downloads ${packageFile} and ${vsixFile}`);
