import {existsSync,readFileSync,writeFileSync,statSync,realpathSync} from 'node:fs';
import {dirname,resolve,relative,isAbsolute,posix,basename} from 'node:path';
import {createHash} from 'node:crypto';

export interface PipeDependency {name:string;path:string;version?:string;integrity?:string}
export interface PipeManifest {name:string;version:string;language:string;entry:string;dependencies:PipeDependency[]}
export interface PipeLock {version:1;package:string;dependencies:PipeDependency[]}
export interface PackageGraphIssue {code:'PIPE-PKG-009'|'PIPE-PKG-011'|'PIPE-PKG-012'|'PIPE-PKG-013';message:string;manifestFile:string}
export interface PackageGraphNode {id:string;name:string;version:string;language:string;manifestFile:string;entry:string}
export interface PackageGraphEdge {from:string;to:string|null;name:string;path:string;version?:string;kind:'local'|'external'}
export interface PackageGraphSnapshot {nodes:PackageGraphNode[];edges:PackageGraphEdge[];issues:PackageGraphIssue[]}

const value=(line:string)=>{const raw=line.slice(line.indexOf('=')+1).trim();if(raw.startsWith('"')&&raw.endsWith('"'))return raw.slice(1,-1);return raw};
export const manifestNames=['bmec.toml','pipe.toml'] as const;
export const sourceExtensions=['.bmec','.pipe'] as const;
export const supportedLanguageVersions=['0.1','0.1-alpha'] as const;
export function findManifest(directory:string):string|undefined {for(const name of manifestNames){const candidate=resolve(directory,name);if(existsSync(candidate))return candidate;}return undefined}
export function lockFileForManifest(manifestFile:string):string {return resolve(dirname(manifestFile),basename(manifestFile)==='bmec.toml'?'bmec.lock':'pipe.lock')}
export function isSourceFile(file:string):boolean{return sourceExtensions.some(extension=>file.endsWith(extension))}
const canonicalRelative=(raw:string,kind:string)=>{const normalized=raw.replaceAll('\\','/');if(normalized.startsWith('/')||/^[A-Za-z]:\//.test(normalized))throw new Error(`PIPE-PKG-002: ${kind} must be relative: "${raw}"`);return normalized};
export function readManifest(file:string,options:{allowUnsupportedLanguage?:boolean}={}):PipeManifest {
 const source=readFileSync(file,'utf8'),root:{name?:string;version?:string;language?:string;entry?:string;dependencies:PipeDependency[]}={dependencies:[]};let section='';const dependencyNames=new Set<string>();
 for(const raw of source.split(/\r?\n/)){const line=raw.replace(/#.*/,'').trim();if(!line)continue;if(line.startsWith('[')){section=line.slice(1,-1);continue}if(!line.includes('='))continue;const key=line.slice(0,line.indexOf('=')).trim();const val=String(value(line));if(section==='package'&&key==='name')root.name=val;else if(section==='package'&&key==='version')root.version=val;else if(section==='package'&&key==='language')root.language=val;else if(section==='package'&&key==='entry')root.entry=val;else if(section==='dependencies'){if(!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key))throw new Error(`PIPE-PKG-002: invalid dependency name "${key}"`);if(dependencyNames.has(key))throw new Error(`PIPE-PKG-002: duplicate dependency "${key}"`);dependencyNames.add(key);const normalized=val.replaceAll('\\','/');if(normalized.startsWith('/')||/^[A-Za-z]:\//.test(normalized))throw new Error(`PIPE-PKG-002: dependency "${key}" must not use an absolute path`);const path=normalized.startsWith('./')||normalized.startsWith('../')?canonicalRelative(normalized,`dependency "${key}"`):'';root.dependencies.push({name:key,path:path||normalized,version:path?undefined:normalized});}}
 if(!root.name||!root.version||!root.language||!root.entry)throw new Error('PIPE-PKG-001: bmec.toml requires [package] name, version, language, and entry');
 root.entry=canonicalRelative(root.entry,'package entry');if(root.entry==='..'||root.entry.startsWith('../')||root.entry.includes('/../'))throw new Error(`PIPE-PKG-002: package entry escapes its package: "${root.entry}"`);
 if(!/^[A-Za-z][A-Za-z0-9_-]*$/.test(root.name))throw new Error(`PIPE-PKG-002: invalid package name "${root.name}"`);
 if(!options.allowUnsupportedLanguage&&!supportedLanguageVersions.includes(root.language as typeof supportedLanguageVersions[number]))throw new Error(`PIPE-PKG-014: unsupported language version "${root.language}"`);
 if(!isSourceFile(root.entry)||root.entry.startsWith('/')||root.entry.includes('..\\')||root.entry.includes('../'))throw new Error(`PIPE-PKG-002: invalid package entry "${root.entry}"`);
 return {name:root.name,version:root.version,language:root.language,entry:root.entry,dependencies:root.dependencies.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)};
}
export function resolveLock(manifestFile:string):PipeLock {const manifest=readManifest(manifestFile),root=dirname(resolve(manifestFile));return {version:1,package:manifest.name,dependencies:manifest.dependencies.map(d=>{const absolute=d.path?resolve(root,d.path):'';const candidate=absolute&&existsSync(absolute)?(statSync(absolute).isDirectory()?findManifest(absolute)??resolve(absolute,'pipe.toml'):absolute):'';const integrity=candidate&&existsSync(candidate)?`sha256-${createHash('sha256').update(readFileSync(candidate,'utf8').replace(/\r\n?/g,'\n')).digest('hex')}`:undefined;return {...d,path:d.path?relative(root,absolute).replaceAll('\\','/'):d.path,...(integrity?{integrity}:{})}})};}
export function writeLock(manifestFile:string,lockFile=lockFileForManifest(manifestFile)):PipeLock {const lock=resolveLock(manifestFile);writeFileSync(lockFile,JSON.stringify(lock,null,2)+'\n');return lock;}
const canonicalLockPath=(value:string|undefined)=>value===undefined?value:posix.normalize(value.replaceAll('\\','/'));
export function verifyLock(manifestFile:string,lock:PipeLock):string[]{const expected=resolveLock(manifestFile),errors:string[]=[];if(lock.version!==1)errors.push('PIPE-PKG-001: unsupported lockfile version');if(lock.package!==expected.package)errors.push('PIPE-PKG-002: lock package does not match manifest');const expectedNames=new Set(expected.dependencies.map(x=>x.name));const actualNames=new Set<string>();for(const dependency of lock.dependencies??[]){if(actualNames.has(dependency.name))errors.push(`PIPE-PKG-010: duplicate locked dependency "${dependency.name}"`);actualNames.add(dependency.name)}for(const dep of expected.dependencies){const actual=lock.dependencies?.find(x=>x.name===dep.name);if(!actual)errors.push(`PIPE-PKG-003: locked dependency missing "${dep.name}"`);else {if(canonicalLockPath(actual.path)!==canonicalLockPath(dep.path))errors.push(`PIPE-PKG-005: dependency path changed "${dep.name}"`);if(actual.version!==dep.version)errors.push(`PIPE-PKG-006: dependency version changed "${dep.name}"`);if(dep.integrity&&actual.integrity!==dep.integrity)errors.push(`PIPE-PKG-004: dependency integrity changed "${dep.name}"`)}}for(const name of actualNames)if(!expectedNames.has(name))errors.push(`PIPE-PKG-007: lock contains undeclared dependency "${name}"`);return errors;}
export function hasManifest(directory:string):boolean{return findManifest(directory)!==undefined;}

function dependencyManifestFile(manifestFile:string,dependency:PipeDependency):string|undefined {
 if(!dependency.path)return undefined;
 const target=resolve(dirname(manifestFile),dependency.path);
 if(!existsSync(target))return undefined;
 return statSync(target).isDirectory()?findManifest(target):target;
}
export function validatePackageGraph(rootManifest:string):PackageGraphIssue[]{
 const issues:PackageGraphIssue[]=[],visited=new Set<string>(),visiting:string[]=[],identities=new Map<string,string>();
 const visit=(manifestFile:string)=>{
  const canonical=realpathSync(manifestFile);
  const cycleAt=visiting.indexOf(canonical);
  if(cycleAt>=0){const cycle=[...visiting.slice(cycleAt),canonical].join(' -> ');issues.push({code:'PIPE-PKG-013',message:`Cyclic package dependency: ${cycle}`,manifestFile});return;}
  if(visited.has(canonical))return;
  visiting.push(canonical);
  let manifest:PipeManifest;
  try{manifest=readManifest(canonical,{allowUnsupportedLanguage:true});}catch(error){issues.push({code:'PIPE-PKG-012',message:`Incompatible package metadata in "${canonical}": ${error instanceof Error?error.message:String(error)}`,manifestFile:canonical});visiting.pop();return;}
  if(!supportedLanguageVersions.includes(manifest.language as typeof supportedLanguageVersions[number]))issues.push({code:'PIPE-PKG-012',message:`Unsupported language version "${manifest.language}" in "${canonical}"`,manifestFile:canonical});
  const identity=`${manifest.name}@${manifest.version}`,prior=identities.get(identity);if(prior&&prior!==canonical)issues.push({code:'PIPE-PKG-009',message:`Duplicate package identity "${identity}" is declared by multiple dependency roots`,manifestFile:canonical});else identities.set(identity,canonical);
  for(const dependency of manifest.dependencies){
   if(!dependency.path)continue;
   const dependencyManifest=dependencyManifestFile(canonical,dependency);
   if(!dependencyManifest){issues.push({code:'PIPE-PKG-011',message:`Missing local dependency "${dependency.name}" at "${dependency.path}"`,manifestFile:canonical});continue;}
   if(!existsSync(dependencyManifest)){issues.push({code:'PIPE-PKG-011',message:`Missing package metadata for dependency "${dependency.name}"`,manifestFile:canonical});continue;}
   try{const child=readManifest(dependencyManifest,{allowUnsupportedLanguage:true});if(child.language!==manifest.language||!supportedLanguageVersions.includes(child.language as typeof supportedLanguageVersions[number]))issues.push({code:'PIPE-PKG-012',message:`Incompatible language version for dependency "${dependency.name}": expected "${manifest.language}", received "${child.language}"`,manifestFile:dependencyManifest});}catch(error){issues.push({code:'PIPE-PKG-012',message:`Incompatible package metadata for dependency "${dependency.name}": ${error instanceof Error?error.message:String(error)}`,manifestFile:dependencyManifest});continue;}
   visit(dependencyManifest);
  }
  visiting.pop();visited.add(canonical);
 };
 if(existsSync(rootManifest))visit(rootManifest);
 return issues;
}

/** Read-only, deterministic package graph projection for tooling. Resolution
 * and validation remain owned by the existing manifest/compiler pipeline. */
export function inspectPackageGraph(rootManifest:string):PackageGraphSnapshot {
 const nodes:PackageGraphNode[]=[],edges:PackageGraphEdge[]=[],visited=new Set<string>();
 const visit=(manifestFile:string)=>{
  if(!existsSync(manifestFile))return;
  const canonical=realpathSync(manifestFile);if(visited.has(canonical))return;visited.add(canonical);
  let manifest:PipeManifest;try{manifest=readManifest(canonical,{allowUnsupportedLanguage:true});}catch{return}
  const id=`PKG-${manifest.name}@${manifest.version}`;nodes.push({id,name:manifest.name,version:manifest.version,language:manifest.language,manifestFile:canonical,entry:manifest.entry});
  for(const dependency of manifest.dependencies){
   if(!dependency.path){edges.push({from:id,to:null,name:dependency.name,path:dependency.path,version:dependency.version,kind:'external'});continue}
   const dependencyManifest=dependencyManifestFile(canonical,dependency),child=dependencyManifest&&existsSync(dependencyManifest)?dependencyManifest:undefined;
   let to:string|null=null;if(child){try{const childManifest=readManifest(child,{allowUnsupportedLanguage:true});to=`PKG-${childManifest.name}@${childManifest.version}`;}catch{}}
   edges.push({from:id,to,name:dependency.name,path:dependency.path,version:dependency.version,kind:'local'});if(child)visit(child);
  }
 };
 if(existsSync(rootManifest))visit(rootManifest);
 return {nodes:nodes.sort((a,b)=>a.id.localeCompare(b.id)),edges:edges.sort((a,b)=>`${a.from}:${a.name}`.localeCompare(`${b.from}:${b.name}`)),issues:validatePackageGraph(rootManifest)};
}

/** Resolve a package-qualified import from a declared local/path dependency. */
export function resolveDependencyImport(manifestFile:string,request:string):string|undefined {
 if(!existsSync(manifestFile))return undefined;
 let manifest:PipeManifest;try{manifest=readManifest(manifestFile);}catch{return undefined}const slash=request.indexOf('/');
 const name=slash<0?request:request.slice(0,slash),suffix=slash<0?'':request.slice(slash+1);
 const dependency=manifest.dependencies.find(item=>item.name===name&&item.path.startsWith('.'));
 if(!dependency)return undefined;
 const packagePath=resolve(dirname(manifestFile),dependency.path);
 const packageRoot=existsSync(packagePath)&&statSync(packagePath).isDirectory()?packagePath:dirname(packagePath);
 let target:string;
 if(suffix)target=resolve(packageRoot,suffix);
 else {
  const dependencyManifest=findManifest(packageRoot);
  if(!dependencyManifest||!existsSync(dependencyManifest))return undefined;
  let dependency:PipeManifest;try{dependency=readManifest(dependencyManifest);}catch{return undefined}target=resolve(packageRoot,dependency.entry);
 }
 const relativeTarget=relative(packageRoot,target);
 if(relativeTarget.startsWith('..')||relativeTarget.includes('..\\')||relativeTarget.includes('../')||isAbsolute(relativeTarget))return undefined;
 if(!isSourceFile(target)||!existsSync(target))return undefined;
 return realpathSync(target);
}
