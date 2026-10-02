import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync,cpSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {basename,join,relative,resolve} from 'node:path';
import {createKnowledgeIndex} from '../dist/cli/knowledge.js';
import {BMEC_DESIGN_TOKEN_CSS} from '../dist/style/design-tokens.js';
import {build as bundle} from 'esbuild';

const root=process.cwd(),website=resolve(root,'website'),output=resolve(website,'dist');
if(!output.startsWith(`${website}${process.platform==='win32'?'\\':'/'}`))throw new Error('Website output must stay inside website/');
if(existsSync(output))rmSync(output,{recursive:true,force:true});
mkdirSync(output,{recursive:true});
for(const file of ['index.html','styles.css','redesign.css','app.js','site.js','playground.js'])cpSync(join(website,file),join(output,file));
copyFileSync(join(website,'google05e64d7af06055a9.html'),join(output,'google05e64d7af06055a9.html'));
mkdirSync(join(output,'assets'),{recursive:true});
copyFileSync(join(website,'assets','bmec-mark.svg'),join(output,'assets','bmec-mark.svg'));
copyFileSync(join(website,'assets','bmec-mark.png'),join(output,'assets','bmec-mark.png'));
copyFileSync(join(website,'assets','bmec-social.png'),join(output,'assets','bmec-social.png'));
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
  ['/assets/tidehouse.png','website/assets/showcases/tidehouse.png'],
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
  ['HOW_BMEC_WORKS.md','How BMEC works','FOUNDATIONS','Follow source through parsing, type checks, typed IR, and supported runtimes.'],
  ['GETTING_STARTED.md','Getting started','START HERE','Create, check, build, and run your first BMEC app.'],
  ['LANGUAGE_BASICS.md','Language basics','LANGUAGE','Types, functions, models, and control flow.'],
  ['FULL_STACK_GUIDE.md','Full-stack guide','APPLICATIONS','Connect routes, database operations, and typed user interfaces.'],
  ['CUSTOM_APP_READING_QUEUE.md','Build your own reading queue','APPLICATIONS','Turn a generated BMEC project into a private, owner-scoped application.'],
  ['STYLING_GUIDE.md','Styling guide','UI','Compose named styles and responsive behavior.'],
  ['INSTALL.md','Installation','DOWNLOAD','Install the CLI and the VS Code extension.'],
  ['BMEC_EDITOR_SETUP.md','Editor setup','TOOLING','Configure VS Code support through the BMEC language server.'],
  ['language-completion.md','Editor and completion support','TOOLING','Review the advertised language-server features and completion trigger behavior.'],
  ['AI_AGENT_GUIDE.md','AI agent guide','TOOLING','Give coding agents a reliable BMEC workflow with compiler-owned context and checked changes.'],
  ['PLAYGROUND_GUIDE.md','Browser playground','TOOLING','Check and run a safe BMEC function, copy AI context, and continue in VS Code.'],
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
for(const project of showcase.projects){
  copy(project.source.slice(1),project.source.slice(1));
  if(project.id==='tidehouse')for(const file of ['AGENTS.md','main.bmec','bmec.toml','styles/site.css','assets/breakfast.jpg','assets/coast.jpg','assets/room.jpg'])copy(`examples/azores-retreat/${file}`,`examples/azores-retreat/${file}`);
}
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
const expectedArchive=`${pkg.name.replace(/^@/,'').replace('/','-')}-${pkg.version}.tgz`;
if(packageFile!==expectedArchive)throw new Error(`Expected reviewed archive ${expectedArchive}, received ${packageFile}`);
copyFileSync(packageArchive,join(output,'downloads',packageFile));
copyFileSync(vsixArchive,join(output,'downloads',vsixFile));
const artifact=(file,name)=>({file:name,sizeBytes:readFileSync(file).length,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')});
write('release-manifest.json',JSON.stringify({schemaVersion:'bmec.release-artifacts.v1',packageVersion:pkg.version,languageVersion:JSON.parse(readFileSync(join(root,'ai','examples.json'),'utf8')).languageVersion,artifacts:[artifact(packageArchive,packageFile),artifact(vsixArchive,vsixFile)]},null,2)+'\n');
const cliDownload=`/downloads/${packageFile}`;
const examples=catalog.examples.map(example=>{const filename=`${example.name}.bmec`;write(join('examples',filename),example.source);return {...example,sourcePath:`/examples/${filename}`,download:`/examples/${filename}`};});
const basics=readFileSync(join(root,'docs','LANGUAGE_BASICS.md'),'utf8');
const learning=[...basics.matchAll(/```bmec\s*\n([\s\S]*?)```/g)].slice(0,2).map((match,index)=>({title:index===0?'A typed expression':'A language boundary',source:match[1].trim()}));
const nodeRequirement=readFileSync(join(root,'docs','INSTALL.md'),'utf8').match(/Node\.js [^\n]+/)?.[0]??'See install guide for the supported Node.js version.';
const data={version:pkg.version,languageVersion:aiSpec.languageVersion,releaseStatus:`Developer beta · BMEC ${pkg.version}`,statusDetail:`Documentation and compiler metadata describe package ${pkg.version} and language ${aiSpec.languageVersion}.`,statusUrl:'/version.json',nodeRequirement,sourceUrl,cliDownload,vscodeDownload:`/downloads/${vsixFile}`,docs:docs.map(([file,title,type,description])=>({title,type,description,href:`/docs/${file.slice(0,-3).toLowerCase().replaceAll('_','-')}/`})),learning,examples,showcase:showcase.projects.map(project=>({...project,previewWidth:pngDimensions.get(project.preview.src).width,previewHeight:pngDimensions.get(project.preview.src).height})),commandCount:commands.commands?.length??0};
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
write('ai/index.html',`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>BMEC AI knowledge</title><body><main><h1>BMEC AI knowledge</h1><p>Use the CLI for a task-focused context pack:</p><pre>bmec knowledge "paginate orders" --json</pre><ul><li><a href="/ai/index.json">Machine-readable index</a></li><li><a href="/ai/knowledge-index.json">Searchable knowledge catalog</a></li><li><a href="/ai/ai-spec.json">Language and UI contract</a></li><li><a href="/ai/commands.json">CLI commands</a></li><li><a href="/ai/capabilities.json">Capabilities</a></li><li><a href="/ai/diagnostics.json">Diagnostics</a></li><li><a href="/ai/examples.json">Checked examples</a></li><li><a href="/docs/ai-agent-guide/">AI agent guide</a></li><li><a href="/llms.txt">llms.txt</a></li></ul></main></body></html>`);
if(aiIndexSchema.properties.schemaVersion.const!==aiIndex.schemaVersion)throw new Error('Website AI index schema is out of sync');
write('ai/index.schema.json',JSON.stringify(aiIndexSchema,null,2));
write('docs/index.html',`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>BMEC documentation</title><body><main><h1>BMEC documentation</h1><p><a href="/">Home</a> · <a href="${sourceUrl}">Source repository</a></p><ul>${[...docs.map(([file,title])=>[title,`/docs/${file}`]),['Language spec','/ai/ai-spec.md'],['AI machine index','/ai/index.json'],['Task knowledge index','/ai/knowledge-index.json'],['AI entry page','/ai/'],['llms.txt','/llms.txt'],['Language and UI JSON contract','/ai/ai-spec.json'],['CLI commands','/ai/commands.json'],['Diagnostics','/ai/diagnostics.json'],['Examples catalog','/ai/examples.json'],['Capability coverage inventory','/docs/CAPABILITY_COVERAGE.md'],['Built-with showcase','/showcase.json'],['Version and status','/version.json']].map(([title,href])=>`<li><a href="${href}">${title}</a></li>`).join('')}</ul></main></body></html>`);
const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const docSlug=file=>file.slice(0,-3).toLowerCase().replaceAll('_','-');
const inlineMarkdown=source=>{
  const saved=[];
  const hold=value=>{const key=`BMECINLINE${saved.length}TOKEN`;saved.push(value);return key;};
  let text=String(source).replace(/`([^`]+)`/g,(_all,code)=>hold(`<code>${escapeHtml(code)}</code>`));
  text=text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,(_all,label,target,title)=>{
    let href=target;
    if(!/^(?:https:\/\/|mailto:|\/|#)/i.test(href)){
      const resolved=resolve(root,'docs',href.replace(/^\.\//,''));
      const targetPath=relative(root,resolved).split('\\').join('/');
      if(targetPath.startsWith('../')||targetPath==='..')return hold(escapeHtml(label));
      const sourceDoc=targetPath.startsWith('docs/')&&targetPath.endsWith('.md')?targetPath.slice('docs/'.length):undefined;
      href=sourceDoc&&docs.some(([file])=>file===sourceDoc)?`/docs/${docSlug(sourceDoc)}/`:`/${targetPath}`;
    }
    if(/^(?:javascript:|data:)/i.test(href))return hold(escapeHtml(label));
    return hold(`<a href="${escapeHtml(href)}"${title?` title="${escapeHtml(title)}"`:''}>${escapeHtml(label)}</a>`);
  });
  text=escapeHtml(text).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>');
  return text.replace(/BMECINLINE(\d+)TOKEN/g,(_all,index)=>saved[Number(index)]);
};
const renderMarkdown=source=>{
  const lines=String(source).replace(/^\uFEFF/,'').replace(/^# .+\r?\n/,'').split(/\r?\n/);
  const out=[];let paragraph=[],listType='',listItems=[],codeLines=[],codeLanguage='',inCode=false,quote=[];
  const flushParagraph=()=>{if(paragraph.length){out.push(`<p>${paragraph.map(inlineMarkdown).join(' ')}</p>`);paragraph=[];}};
  const flushList=()=>{if(listType){out.push(`<${listType}>${listItems.map(item=>`<li>${inlineMarkdown(item)}</li>`).join('')}</${listType}>`);listItems=[];listType='';}};
  const flushQuote=()=>{if(quote.length){out.push(`<blockquote>${quote.map(item=>`<p>${inlineMarkdown(item)}</p>`).join('')}</blockquote>`);quote=[];}};
  const cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(cell=>cell.trim());
  for(let index=0;index<lines.length;index++){
    const line=lines[index];
    if(inCode){if(/^\s*```/.test(line)){out.push(`<pre class="guide-code"><code${codeLanguage?` class="language-${escapeHtml(codeLanguage)}"`:''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);codeLines=[];codeLanguage='';inCode=false;}else codeLines.push(line);continue;}
    const fence=line.match(/^\s*```\s*([\w+-]*)/);if(fence){flushParagraph();flushList();flushQuote();inCode=true;codeLanguage=fence[1]??'';continue;}
    if(!line.trim()){flushParagraph();flushList();flushQuote();continue;}
    const heading=line.match(/^(#{1,4})\s+(.+?)\s*#*$/);if(heading){flushParagraph();flushList();flushQuote();const level=Math.min(4,heading[1].length+1),label=heading[2].replace(/[`*_]/g,'');const id=label.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');out.push(`<h${level} id="${escapeHtml(id)}">${inlineMarkdown(heading[2])}</h${level}>`);continue;}
    if(line.includes('|')&&index+1<lines.length&&/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index+1])){flushParagraph();flushList();flushQuote();const headers=cells(line);index+=2;const rows=[];while(index<lines.length&&lines[index].includes('|')&&lines[index].trim()){rows.push(cells(lines[index]));index++;}index--;out.push(`<div class="guide-table-scroll"><table><thead><tr>${headers.map(cell=>`<th scope="col">${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${headers.map((_cell,column)=>`<td>${inlineMarkdown(row[column]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);continue;}
    if(/^\s*([-*_])\1\1+\s*$/.test(line)){flushParagraph();flushList();flushQuote();out.push('<hr>');continue;}
    const quoteLine=line.match(/^>\s?(.*)$/);if(quoteLine){flushParagraph();flushList();quote.push(quoteLine[1]);continue;}else flushQuote();
    const ordered=line.match(/^\s*\d+[.)]\s+(.+)$/),unordered=line.match(/^\s*[-*+]\s+(.+)$/);
    if(ordered||unordered){flushParagraph();const kind=ordered?'ol':'ul';if(listType&&listType!==kind)flushList();listType=kind;listItems.push((ordered??unordered)[1]);continue;}else flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();flushList();flushQuote();
  if(inCode)out.push(`<pre class="guide-code"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  return out.join('\n');
};
const socialMetadata=({title,description,path})=>`<link rel="canonical" href="${siteBaseUrl}${path}"><meta property="og:type" content="website"><meta property="og:site_name" content="BMEC"><meta property="og:title" content="${escapeHtml(title)} — BMEC"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${siteBaseUrl}${path}"><meta property="og:image" content="${siteBaseUrl}/assets/bmec-social.png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)} — BMEC"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${siteBaseUrl}/assets/bmec-social.png">`;
const structuredData=JSON.stringify({"@context":"https://schema.org","@graph":[{"@type":"Organization",name:'BMEC',url:siteBaseUrl,logo:`${siteBaseUrl}/assets/bmec-mark.png`},{"@type":"WebSite",name:'BMEC',url:`${siteBaseUrl}/`,inLanguage:'en',description:'A statically typed language for building full-stack applications.',publisher:{"@type":"Organization",name:'BMEC',url:siteBaseUrl}},{"@type":"SoftwareSourceCode",name:'BMEC',description:'A statically typed language and compiler for full-stack applications.',codeRepository:sourceUrl,programmingLanguage:'BMEC',runtimePlatform:'Node.js'}]});
writeFileSync(join(output,'index.html'),readFileSync(join(output,'index.html'),'utf8').replace('</head>',`${socialMetadata({title:'BMEC programming language for full-stack apps',description:'Learn BMEC, a statically typed programming language for full-stack apps. Check and run functions, explore clear guides, and connect the VS Code extension.',path:'/'})}<script type="application/ld+json">${structuredData}</script><link rel="icon" href="/assets/bmec-mark.png" type="image/png"></head>`));
const pageShell=({title,description,section,body,csp,path='/'})=>`<!doctype html>
<html lang="en" data-theme="dark">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#08090b"><meta name="description" content="${escapeHtml(description)}">${socialMetadata({title,description,path})}<link rel="icon" href="/assets/bmec-mark.png" type="image/png">${csp?`<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">`:''}<title>${escapeHtml(title)} — BMEC</title><link rel="stylesheet" href="/design-tokens.css"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/redesign.css"><script src="/site.js" defer></script></head>
<body><a class="skip-link" href="#main">Skip to content</a>
<header class="site-header page-header"><a class="brand" href="/" aria-label="BMEC home"><img class="brand-icon" src="/assets/bmec-mark.png" alt=""><span>BMEC</span></a><button class="nav-toggle" type="button" aria-label="Toggle navigation" aria-controls="site-nav" aria-expanded="false"><span aria-hidden="true">☰</span></button><nav id="site-nav" aria-label="Main navigation"><a href="/learn/">Learn</a><a href="/library/">Code library</a><a href="/docs/">Docs</a><a href="/playground/">Playground</a><a href="/ai/">For AI tools</a><a class="nav-download" href="/downloads/${vsixFile}" download>Download VS Code extension</a><a class="nav-github" href="${escapeHtml(sourceUrl)}">GitHub</a><button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch to light theme" title="Switch to light theme"><span aria-hidden="true">◐</span><span class="theme-toggle-label" data-theme-label>Light</span></button></nav></header>
<main id="main" class="route-wrap"><p class="route-kicker">${escapeHtml(section)}</p><h1>${escapeHtml(title)}</h1><p class="route-lede">${escapeHtml(description)}</p><div class="route-content">${body}</div></main>
<footer class="site-footer route-footer"><div class="section-wrap footer-inner"><a class="brand brand-footer" href="/" aria-label="BMEC home"><img class="brand-icon" src="/assets/bmec-mark.png" alt=""><span>BMEC</span></a><p>BMEC ${escapeHtml(pkg.version)} · Developer preview</p><div class="route-footer-links"><a href="/contact/">Contact</a><a href="/support/">Support</a><a href="${escapeHtml(sourceUrl)}">Source code</a></div></div></footer>
</body></html>`;
const page=(slug,title,description,section,body)=>write(`${slug}/index.html`,pageShell({title,description,section,body,path:`/${slug}/`,csp:slug==='playground'?"default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'":undefined}));
const docRows=[...docs.map(([file,title,type,description])=>({file,title,kind:type,description,slug:docSlug(file)})),{file:'ai-spec.md',title:'Language specification',kind:'REFERENCE',description:'Read the language, type, semantics, invariant, and diagnostic contracts.',href:'/ai/ai-spec.md',markdownHref:'/ai/ai-spec.md'}];
const docHref=item=>item.href??`/docs/${item.slug}/`;
const docCard=item=>`<article class="doc-entry" data-doc-entry data-search-text="${escapeHtml(`${item.title} ${item.kind} ${item.description}`.toLocaleLowerCase())}"><span class="doc-entry-kind">${escapeHtml(item.kind.toLocaleLowerCase().replaceAll('_',' '))}</span><h3><a href="${docHref(item)}">${escapeHtml(item.title)}</a></h3><p>${escapeHtml(item.description)}</p><div class="doc-card-actions"><a href="${docHref(item)}">Read guide</a><a href="${escapeHtml(item.markdownHref??`/docs/${item.file}`)}" download>Get .md</a></div></article>`;
const firstSteps=docRows.filter(item=>['learning-path','getting-started','install'].includes(item.slug));
const buildGuides=docRows.filter(item=>['FOUNDATIONS','LANGUAGE','APPLICATIONS','UI'].includes(item.kind));
const referenceGuides=docRows.filter(item=>['TOOLING','REFERENCE','COMMUNITY'].includes(item.kind));
const operationGuides=docRows.filter(item=>item.kind==='OPERATIONS');
const guideGroup=(id,title,description,items)=>`<section class="docs-group" aria-labelledby="${id}"><div class="docs-group-heading"><div><span>GUIDE COLLECTION</span><h2 id="${id}">${title}</h2></div><p>${description}</p></div><div class="docs-entry-grid">${items.map(docCard).join('')}</div></section>`;
const docsIntro=`<section class="docs-start"><div class="docs-start-copy"><p class="docs-kicker">Pick up where you are</p><h2>Find the next useful step.</h2><p>Start with a small working app, find an answer while you build, or check an operational detail before release.</p></div><div class="docs-shortcuts"><a href="/docs/getting-started/"><span>New to BMEC</span><strong>Build a first app</strong><small>Install, create, check, run</small></a><a href="/docs/custom-app-reading-queue/"><span>Building an app</span><strong>Follow a real example</strong><small>Models, routes, ownership, UI</small></a><a href="/docs/deployment/"><span>Preparing to run</span><strong>Plan the deployment</strong><small>Database, secrets, recovery</small></a></div></section><div class="docs-search-row"><label for="docs-search">Search the guides</label><input id="docs-search" type="search" data-doc-search placeholder="Try “database”, “types”, or “VS Code”" autocomplete="off"><span id="docs-count" role="status">${docRows.length} guides</span></div><p class="docs-no-results" id="docs-no-results" hidden>No guides match that phrase. Try a shorter search.</p>`;
page('docs','Guides for building with BMEC','Start quickly, find the right answer, and open the original Markdown whenever you need it.','Documentation',`${docsIntro}${guideGroup('docs-start-here','Start here','Install BMEC and move through the first checked steps.',firstSteps)}${guideGroup('docs-building','Build an application','Learn the language, connect app layers, and shape an interface.',buildGuides)}${guideGroup('docs-operating','Operate it safely','Review the controls and database and deployment work your host owns.',operationGuides)}${guideGroup('docs-reference','Look up a detail','Find compiler facts, editor support, capabilities, and project conventions.',referenceGuides)}<aside class="docs-ai-panel"><div><span class="docs-kicker">For coding tools</span><h2>Use the compiler’s current facts.</h2><p>The language specification, diagnostics, commands, and checked examples are available in versioned machine-readable files.</p></div><nav aria-label="AI and machine-readable BMEC references"><a href="/ai/">AI guide</a><a href="/ai/index.json">Source index</a><a href="/ai/ai-spec.json">Language contract</a><a href="/ai/knowledge-index.json">Knowledge catalog</a><a href="/llms.txt">llms.txt</a></nav></aside>`);
for(const item of docRows.filter(row=>row.slug)){
  const source=readFileSync(join(root,'docs',item.file),'utf8');
  const headingId=value=>value.toLocaleLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const headings=[...source.matchAll(/^##\s+(.+?)\s*#*\s*$/gm)].map(match=>({title:match[1].replace(/[`*_]/g,''),id:headingId(match[1].replace(/[`*_]/g,''))}));
  const contents=headings.length>3?`<details class="guide-contents"><summary>On this page <span>${headings.length} sections</span></summary><ol>${headings.map(heading=>`<li><a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.title)}</a></li>`).join('')}</ol></details>`:'';
  const body=`<nav class="guide-actions" aria-label="Document actions"><a class="button button-primary" href="/docs/${escapeHtml(item.file)}" download>Download Markdown</a><a class="text-link" href="/docs/${escapeHtml(item.file)}">View raw Markdown</a><a class="text-link" href="/docs/">All guides</a></nav>${contents}<article class="markdown-body">${renderMarkdown(source)}</article>`;
  const alternates=`<link rel="alternate" type="text/markdown" href="/docs/${escapeHtml(item.file)}"><meta name="author" content="BMEC maintainers">`;
  write(`docs/${item.slug}/index.html`,pageShell({title:item.title,description:item.description,section:item.kind,path:`/docs/${item.slug}/`,body:`<div class="guide-document">${body}</div>`}).replace('</head>',`${alternates}</head>`));
}
const exampleCards=examples.map(item=>`<article class="route-card"><span>CHECKED EXAMPLE</span><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.purpose)}</p><p class="route-tags">${escapeHtml(item.constructs.slice(0,4).join(' · '))}</p><p><a href="${escapeHtml(item.sourcePath)}">Read source</a> · <a href="${escapeHtml(item.download)}" download>Download source</a> · <a href="/playground/?example=${encodeURIComponent(item.id)}">Run example</a></p></article>`).join('');
page('examples','Examples','Small, checked programs for learning the language and seeing how its parts fit together.','BMEC source',`<section class="route-section"><div class="route-card-grid">${exampleCards}</div><p>Examples are checked from BMEC source in the repository. The catalog is also available as <a href="/ai/examples.json">JSON</a>.</p><p><a href="/library/">Open the searchable code library</a></p></section>`);
const libraryCards=examples.map((item,index)=>`<article class="library-entry" data-library-entry data-search-text="${escapeHtml(`${item.title} ${item.purpose} ${item.constructs.join(' ')}`.toLowerCase())}"><div class="library-entry-copy"><p class="library-kind">${escapeHtml(item.constructs.slice(0,4).join(' · '))}</p><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.purpose)}</p><details class="library-source"><summary>Read the code</summary><pre><code id="library-source-${index}">${escapeHtml(item.source)}</code></pre></details><div class="library-entry-actions"><button class="text-button" type="button" data-copy-code="library-source-${index}">Copy code</button><a href="${escapeHtml(item.download)}" download>Download .bmec</a><a href="/playground/?example=${encodeURIComponent(item.id)}">Open in playground</a></div></div></article>`).join('');
page('library','BMEC code library','Search checked examples, inspect how they work, and open any sample in the runnable playground.','Example library',`<section class="route-section"><div class="library-search-row"><label for="library-search">Find code by name or topic</label><input id="library-search" type="search" data-library-search placeholder="Try “function”, “database”, or “page”" autocomplete="off"><span id="library-count" role="status">${examples.length} examples</span></div><div class="library-grid">${libraryCards}</div><p id="library-empty" class="route-callout" hidden>No examples match that search. Try a shorter term.</p><p>Every program comes from the maintained BMEC example catalog. The compiler checks syntax; the playground runs only supported pure functions without device or network access.</p></section>`);
page('learning-paths','Choose a learning path','Choose the route that matches what you want to make. Each path uses real guides, checked examples, and the local compiler.','Guided learning',`<section class="route-section"><div class="learning-diagram" role="img" aria-label="Learning sequence from language basics to a custom, tested application"><div><span>Learn</span><strong>Types and functions</strong><small>Read and check small programs</small></div><b aria-hidden="true">→</b><div><span>Connect</span><strong>Data and routes</strong><small>Give your app a useful shape</small></div><b aria-hidden="true">→</b><div><span>Build</span><strong>Your interface</strong><small>Make an experience of your own</small></div></div><div class="pathway-grid"><article class="pathway"><p class="pathway-label">First app</p><h2>Start building</h2><p>Install the tools, write a function, and turn a generated project into a small app.</p><ol><li><a href="/docs/install/">Install BMEC</a></li><li><a href="/docs/getting-started/">Create your first app</a></li><li><a href="/playground/">Run a pure function</a></li></ol></article><article class="pathway"><p class="pathway-label">Language</p><h2>Understand the source</h2><p>Learn how types, results, collections, and errors express behavior.</p><ol><li><a href="/docs/language-basics/">Language basics</a></li><li><a href="/docs/capabilities/">Capabilities and limits</a></li><li><a href="/library/">Study checked examples</a></li></ol></article><article class="pathway"><p class="pathway-label">Application</p><h2>Connect the full stack</h2><p>Move from a data model to safe routes, database work, and a custom interface.</p><ol><li><a href="/docs/full-stack-guide/">Full-stack guide</a></li><li><a href="/docs/custom-app-reading-queue/">Build a reading queue</a></li><li><a href="/docs/security-model/">Understand security boundaries</a></li></ol></article><article class="pathway"><p class="pathway-label">Operations</p><h2>Prepare to run it</h2><p>Build an artifact, configure a database, and plan deployment and recovery.</p><ol><li><a href="/docs/cli-reference/">Use the CLI</a></li><li><a href="/docs/database-production/">Prepare the database</a></li><li><a href="/docs/deployment/">Plan deployment</a></li></ol></article></div><p class="route-callout">Prefer one complete sequence? <a href="/docs/learning-path/">Open the 15-step learning path</a> or <a href="/docs/LEARNING_PATH.md" download>download its Markdown</a>.</p></section>`);
const showcaseCards=showcase.projects.map(project=>{const size=pngDimensions.get(project.preview.src);return `<article class="route-showcase-card"><div class="route-showcase-image"><img src="${escapeHtml(project.preview.src)}" alt="${escapeHtml(project.preview.alt)}" width="${size.width}" height="${size.height}" loading="lazy"></div><div><span>${escapeHtml(project.category)} · ${escapeHtml(project.status)}</span><h2>${escapeHtml(project.name)}</h2><p class="route-project-tagline">${escapeHtml(project.tagline)}</p><p>${escapeHtml(project.description)}</p><ul class="route-tags">${project.builtWith.map(tag=>`<li>${escapeHtml(tag)}</li>`).join('')}</ul><p class="route-disclosure">${escapeHtml(project.disclosure)}</p><a href="${escapeHtml(project.source)}">Read project source and notes</a></div></article>`;}).join('');
page('showcase','Built with BMEC',`${showcase.projects.length} application examples, shown with genuine screenshots and clear notes about their limits.`,'Project showcase',`<section class="route-section route-showcase-list">${showcaseCards}</section>`);
const aiLinks=[
  ['How BMEC works','/docs/how-bmec-works/','Understand the compiler pipeline, typed IR, target boundaries, and capabilities.','Read the guide'],
  ['AI guide','/docs/ai-agent-guide/','A practical workflow for compiler context, focused source edits, diagnostics, and security boundaries.','Read the guide'],
  ['Browser playground','/docs/playground-guide/','Run a bounded function, copy compiler-generated context, and continue in VS Code.','Read the playground guide'],
  ['VS Code setup','/docs/bmec-editor-setup/','Install the extension and connect it to the local BMEC compiler and language server.','Connect the editor'],
  ['Machine-readable index','/ai/index.json','Lists BMEC’s authoritative catalogs and their schema versions.','Open JSON index'],
  ['Knowledge catalog','/ai/knowledge-index.json','Searchable entries for language facts, diagnostics, capabilities, and checked examples.','Open knowledge JSON'],
  ['Language contract','/ai/ai-spec.json','Compiler-generated language, type, syntax, UI, and style contracts for this package version.','Open language JSON'],
  ['CLI commands','/ai/commands.json','Command names, usage, output formats, and generated CLI projections.','Browse commands'],
  ['Capabilities','/ai/capabilities.json','The exact host capabilities and standard-library operations the package exposes.','Browse capabilities'],
  ['Diagnostics','/ai/diagnostics.json','Diagnostic codes, meanings, and repair suggestions.','Browse diagnostics'],
  ['Checked examples','/ai/examples.json','Example programs checked against the published language catalog.','Browse examples'],
  ['llms.txt','/llms.txt','A compact map of human and machine-readable BMEC sources.','Read llms.txt'],
];
const aiCards=aiLinks.map(([label,href,description,action])=>`<article class="ai-reference"><h3><a href="${href}">${label}</a></h3><p>${description}</p><a class="ai-reference-action" href="${href}">${action}</a></article>`).join('');
page('ai','Build with BMEC and coding tools','Give an agent compiler-owned facts, a checked example, and one clear task at a time.','For people and AI',`<section class="route-section ai-guide-intro"><div><h2>One reliable loop</h2><p>Discover the installed version, look up the smallest relevant fact, make a focused change, then check it with the compiler.</p><ol class="route-steps"><li><strong>Discover</strong><span>Read the package version and machine-readable index before assuming a feature exists.</span></li><li><strong>Look up</strong><span>Find syntax, capability rules, and diagnostic repair guidance for this exact task.</span></li><li><strong>Change</strong><span>Ask for one small, reviewable edit. Keep security policy and host operations explicit.</span></li><li><strong>Check</strong><span>Run the compiler and resolve each diagnostic before building the app.</span></li></ol></div><div class="ai-command-card"><p>Ask for task-specific context</p><pre class="route-terminal" tabindex="0" aria-label="BMEC knowledge command"><code>bmec knowledge "authenticated custom route" --json</code></pre><p>Then check the changed source</p><pre class="route-terminal" tabindex="0" aria-label="BMEC check command"><code>bmec check main.bmec --json</code></pre></div></div><section class="ai-references" aria-labelledby="ai-references-title"><div class="docs-group-heading"><div><span>VERSIONED SOURCES</span><h2 id="ai-references-title">Open the source of truth.</h2></div><p>These files are generated or checked from the compiler and maintained project documentation.</p></div><div class="ai-reference-grid">${aiCards}</div></section><p class="route-callout">The browser playground runs only bounded pure functions. It cannot read files or use a database, network, or host capability.</p></section>`);
for(const [slug,title,description,section] of [
  ['learn','Learn BMEC','Go from installation to a useful full-stack application with a clear, maintained learning path.','Learning path'],
  ['playground','BMEC playground','Write, check, and run supported pure functions in a local worker, with diagnostics and typed IR alongside your code.','Try BMEC'],
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
write('ai/index.html',pageShell({title:'Build with BMEC and coding tools',description:'Give an agent compiler-owned facts, a checked example, and one clear task at a time.',section:'For people and AI',path:'/ai/',body:`<section class="route-section"><div class="ai-guide-intro"><div><h2>One reliable loop</h2><p>Discover the installed version, look up the smallest relevant fact, make a focused change, then check it with the compiler.</p><ol class="route-steps"><li><strong>Discover</strong><span>Read the package version and machine-readable index before assuming a feature exists.</span></li><li><strong>Look up</strong><span>Find syntax, capability rules, and diagnostic repair guidance for this exact task.</span></li><li><strong>Change</strong><span>Ask for one small, reviewable edit. Keep security policy and host operations explicit.</span></li><li><strong>Check</strong><span>Run the compiler and resolve each diagnostic before building the app.</span></li></ol></div><div class="ai-command-card"><p>Ask for task-specific context</p><pre class="route-terminal" tabindex="0" aria-label="BMEC knowledge command"><code>bmec knowledge "authenticated custom route" --json</code></pre><p>Then check the changed source</p><pre class="route-terminal" tabindex="0" aria-label="BMEC check command"><code>bmec check main.bmec --json</code></pre></div></div><section class="ai-references" aria-labelledby="ai-references-title"><div class="docs-group-heading"><div><span>VERSIONED SOURCES</span><h2 id="ai-references-title">Open the source of truth.</h2></div><p>These files are generated or checked from the compiler and maintained project documentation.</p></div><div class="ai-reference-grid">${aiCards}</div></section><p class="route-callout">The browser playground runs bounded pure functions locally. It does not grant access to files, network, databases, or host capabilities.</p></section>`}));
write('favicon.svg','<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect x="1" y="1" width="54" height="54" rx="16" fill="#08090b"/><path d="M19 52V6l20 23L52 7v45" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity=".48"/><path fill="#fff" fill-rule="evenodd" d="M5 7h17c9 0 14 5 14 12 0 5-2 8-6 10 6 2 9 6 9 12 0 9-6 14-17 14H5V7Zm9 8v11h7c4 0 6-2 6-6 0-3-2-5-7-5h-6Zm0 18v14h7c5 0 8-2 8-7 0-4-3-7-8-7h-7Z"/></svg>');
write('examples/index.html',`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="canonical" href="${siteBaseUrl}/library/"><meta http-equiv="refresh" content="0;url=/library/"><title>BMEC code library</title></head><body><p>The checked BMEC programs have moved to the <a href="/library/">code library</a>.</p></body></html>`);
write('404.html',`<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found — BMEC</title><link rel="icon" href="/assets/bmec-mark.png" type="image/png"><link rel="stylesheet" href="/design-tokens.css"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/redesign.css"></head><body><a class="skip-link" href="#main">Skip to content</a><main id="main" class="route-wrap"><p class="route-kicker">404</p><h1>Page not found</h1><p class="route-lede">That BMEC page could not be found.</p><p><a href="/">Return to the BMEC homepage</a></p></main></body></html>`);
const sitemapRoutes=['/','/docs/','/learn/','/learning-paths/','/library/','/showcase/','/ai/','/playground/','/architecture/','/security/','/deploy/','/benchmarks/','/roadmap/','/support/','/contact/',...docRows.filter(row=>row.slug).map(row=>`/docs/${row.slug}/`)];
write('sitemap.xml',`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemapRoutes.map(path=>`<url><loc>${siteBaseUrl}${path}</loc></url>`).join('')}</urlset>`);
write('robots.txt',allowIndexing?`User-agent: *\nAllow: /\nSitemap: ${siteBaseUrl}/sitemap.xml\n`:`User-agent: *\nDisallow: /\n`);
console.log(`WEBSITE BUILD PASS — ${examples.length} examples; package ${pkg.version}; exact downloads ${packageFile} and ${vsixFile}`);
