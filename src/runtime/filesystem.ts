import {lstatSync,realpathSync} from 'node:fs';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';

/** Resolve an explicit capability path only when its current path components
 * stay inside the configured root and do not traverse symlinks/junctions. */
export function resolveFilesystemPath(root:string,input:string):string|undefined{
  if(isAbsolute(input)||input.split(/[\\/]/).includes('..'))return undefined;
  let base=resolve(root);
  try{base=realpathSync.native(base)}catch{}
  const target=resolve(base,input),rel=relative(base,target);
  if(isAbsolute(rel)||rel==='..'||rel.startsWith(`..${sep}`))return undefined;
  let current=base;
  for(const part of rel.split(sep).filter(Boolean)){
    current=join(current,part);
    try{if(lstatSync(current).isSymbolicLink())return undefined;}
    catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT')return target;return target;}
  }
  return target;
}
