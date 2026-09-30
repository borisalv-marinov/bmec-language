import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {compileFile,type ProjectCompile} from '../compiler.js';

interface CacheFile {
  version: 1;
  entry: string;
  files: {path:string;digest:string}[];
  result: ProjectCompile;
}

function digest(path:string){return existsSync(path)?createHash('sha256').update(readFileSync(path)).digest('hex'):'missing'}
function cachePath(entry:string){return resolve(dirname(entry),'.bmec','check-cache.json')}
function trackedFiles(entry:string,result?:ProjectCompile){
  const paths=new Set<string>([entry]);
  const sourceFiles=result?.modules.map(module=>module.file)??[];
  for(const file of sourceFiles) if(existsSync(file)) paths.add(resolve(file));
  for(const module of result?.modules??[])
    for(const request of module.imports)
      if(request.startsWith('./')||request.startsWith('../')) paths.add(resolve(dirname(module.file),request));
  const directories=new Set([dirname(entry),...sourceFiles.filter(file=>existsSync(file)).map(file=>dirname(resolve(file)))]);
  for(const directory of directories) for(const name of ['bmec.toml','bmec.lock']) paths.add(resolve(directory,name));
  return [...paths].sort().map(path=>({path,digest:digest(path)}));
}

export function compileFileCached(entry:string){
  const canonical=resolve(entry),path=cachePath(canonical);
  if(existsSync(path)){
    try{
      const cached=JSON.parse(readFileSync(path,'utf8')) as CacheFile;
      if(cached.version===1&&cached.entry===canonical&&cached.files.length>0&&cached.files.every(file=>digest(file.path)===file.digest))
        return {result:cached.result,hit:true};
    }catch{ /* malformed or stale cache is a cache miss */ }
  }
  const result=compileFile(canonical);
  const directory=dirname(path);mkdirSync(directory,{recursive:true});
  const value:CacheFile={version:1,entry:canonical,files:trackedFiles(canonical,result),result};
  const temporary=`${path}.tmp-${process.pid}`;
  writeFileSync(temporary,JSON.stringify(value));
  renameSync(temporary,path);
  return {result,hit:false};
}
