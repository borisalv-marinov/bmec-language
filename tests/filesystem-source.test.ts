import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compile} from '../src/compiler.js';
import {executeValue,ResultValue} from '../src/core/interpreter.js';
import {issueCapability} from '../src/runtime/capabilities.js';
import {PUBLIC_STDLIB_CONTRACTS} from '../src/stdlib/stdlib.js';

describe('PIPE source filesystem capability',()=>{
  const roots:string[]=[];
  afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
  it('reads only within an explicit host-provided root and returns typed errors',()=>{
    const root=mkdtempSync(join(tmpdir(),'pipe-fs-'));roots.push(root);writeFileSync(join(root,'hello.txt'),'hello from pipe');
    const result=compile('app Files\nfunction read(fs capability<filesystem>, path text) -> result<text,text> { return readTextFile(fs, path) }');
    expect(result.diagnostics).toEqual([]);
    const fs=issueCapability('filesystem');
    expect(executeValue(result.ir!.functions,'read',[fs,'hello.txt'],{filesystemRoot:root})).toEqual(new ResultValue('ok','hello from pipe'));
    expect(executeValue(result.ir!.functions,'read',[fs,'missing.txt'],{filesystemRoot:root})).toEqual(new ResultValue('err','not_found'));
    expect(executeValue(result.ir!.functions,'read',[fs,'../escape.txt'],{filesystemRoot:root})).toEqual(new ResultValue('err','path_outside_root'));
    expect(() => executeValue(result.ir!.functions,'read',[issueCapability('environment'),'hello.txt'],{filesystemRoot:root})).toThrow('PIPE-EFFECT-002');
    expect(() => executeValue(result.ir!.functions,'read',[fs,'hello.txt'])).toThrow('PIPE-FS-001');
  });
  it('publishes the filesystem contract to AI-facing stdlib metadata',()=>{
    expect(PUBLIC_STDLIB_CONTRACTS).toEqual(expect.arrayContaining([expect.objectContaining({name:'readTextFile',arguments:['capability<filesystem>','text'],returns:'result<text,text>',capabilities:['filesystem']}),expect.objectContaining({name:'writeTextFile',arguments:['capability<filesystem>','text','text'],returns:'result<boolean,text>',capabilities:['filesystem']}),expect.objectContaining({name:'appendTextFile',arguments:['capability<filesystem>','text','text'],returns:'result<boolean,text>',capabilities:['filesystem']}),expect.objectContaining({name:'fileExists',arguments:['capability<filesystem>','text'],returns:'result<boolean,text>',capabilities:['filesystem']}),expect.objectContaining({name:'listDirectory',arguments:['capability<filesystem>','text'],returns:'result<list<text>,text>',capabilities:['filesystem']}),expect.objectContaining({name:'createDirectory',arguments:['capability<filesystem>','text'],returns:'result<boolean,text>',capabilities:['filesystem']}),expect.objectContaining({name:'copyTextFile',arguments:['capability<filesystem>','text','text'],returns:'result<boolean,text>',capabilities:['filesystem']}),expect.objectContaining({name:'moveTextFile',arguments:['capability<filesystem>','text','text'],returns:'result<boolean,text>',capabilities:['filesystem']}),expect.objectContaining({name:'removeTextFile',arguments:['capability<filesystem>','text'],returns:'result<boolean,text>',capabilities:['filesystem']})]));
  });
  it('rejects malformed UTF-8 and preserves a leading UTF-8 BOM as text',()=>{
    const root=mkdtempSync(join(tmpdir(),'pipe-fs-utf8-'));roots.push(root);writeFileSync(join(root,'invalid.txt'),Buffer.from([0x68,0x69,0xff]));writeFileSync(join(root,'bom.txt'),Buffer.from([0xef,0xbb,0xbf,0x68,0x69]));
    const result=compile('app Files\nfunction read(fs capability<filesystem>, path text) -> result<text,text> { return readTextFile(fs, path) }');expect(result.diagnostics).toEqual([]);const fs=issueCapability('filesystem');
    expect(executeValue(result.ir!.functions,'read',[fs,'invalid.txt'],{filesystemRoot:root})).toEqual(new ResultValue('err','invalid_utf8'));
    expect(executeValue(result.ir!.functions,'read',[fs,'bom.txt'],{filesystemRoot:root})).toEqual(new ResultValue('ok','\ufeffhi'));
  });
  it('creates only bounded directories and refuses traversal or implicit parents',()=>{
    const root=mkdtempSync(join(tmpdir(),'pipe-fs-mkdir-'));roots.push(root);const result=compile('app Files\nfunction create(fs capability<filesystem>, path text) -> result<boolean,text> { return createDirectory(fs, path) }');expect(result.diagnostics).toEqual([]);const fs=issueCapability('filesystem');
    expect(executeValue(result.ir!.functions,'create',[fs,'nested'],{filesystemRoot:root})).toEqual(new ResultValue('ok',true));expect(executeValue(result.ir!.functions,'create',[fs,'nested'],{filesystemRoot:root})).toEqual(new ResultValue('err','already_exists'));expect(executeValue(result.ir!.functions,'create',[fs,'nested/deeper'],{filesystemRoot:root})).toEqual(new ResultValue('ok',true));expect(executeValue(result.ir!.functions,'create',[fs,'missing/deeper'],{filesystemRoot:root})).toEqual(new ResultValue('err','not_found'));expect(executeValue(result.ir!.functions,'create',[fs,'../escape'],{filesystemRoot:root})).toEqual(new ResultValue('err','path_outside_root'));
  });
  it('writes only within the explicit root and refuses implicit parent creation',()=>{
    const root=mkdtempSync(join(tmpdir(),'pipe-fs-write-'));roots.push(root);const result=compile('app Files\nfunction write(fs capability<filesystem>, path text, contents text) -> result<boolean,text> { return writeTextFile(fs, path, contents) }');expect(result.diagnostics).toEqual([]);const fs=issueCapability('filesystem');
    expect(executeValue(result.ir!.functions,'write',[fs,'out.txt','written'],{filesystemRoot:root})).toEqual(new ResultValue('ok',true));expect(readFileSync(join(root,'out.txt'),'utf8')).toBe('written');
    expect(executeValue(result.ir!.functions,'write',[fs,'../escape.txt','bad'],{filesystemRoot:root})).toEqual(new ResultValue('err','path_outside_root'));expect(executeValue(result.ir!.functions,'write',[fs,'nested/out.txt','bad'],{filesystemRoot:root})).toEqual(new ResultValue('err','not_found'));
  });
  it('rejects symlink escapes for reads and writes',()=>{
    const root=mkdtempSync(join(tmpdir(),'pipe-fs-link-root-')),outside=mkdtempSync(join(tmpdir(),'pipe-fs-link-out-'));roots.push(root,outside);writeFileSync(join(outside,'secret.txt'),'outside secret');symlinkSync(outside,join(root,'leak'),process.platform==='win32'?'junction':'dir');
    const read=compile('app Files\nfunction read(fs capability<filesystem>, path text) -> result<text,text> { return readTextFile(fs, path) }'),write=compile('app Files\nfunction write(fs capability<filesystem>, path text, contents text) -> result<boolean,text> { return writeTextFile(fs, path, contents) }');expect(read.diagnostics).toEqual([]);expect(write.diagnostics).toEqual([]);const fs=issueCapability('filesystem');
    expect(executeValue(read.ir!.functions,'read',[fs,'leak/secret.txt'],{filesystemRoot:root})).toEqual(new ResultValue('err','path_outside_root'));
    expect(executeValue(write.ir!.functions,'write',[fs,'leak/secret.txt','overwritten'],{filesystemRoot:root})).toEqual(new ResultValue('err','path_outside_root'));expect(readFileSync(join(outside,'secret.txt'),'utf8')).toBe('outside secret');
  });
  it('appends only within the explicit root',()=>{
    const root=mkdtempSync(join(tmpdir(),'pipe-fs-append-'));roots.push(root);writeFileSync(join(root,'out.txt'),'first');const result=compile('app Files\nfunction append(fs capability<filesystem>, path text, contents text) -> result<boolean,text> { return appendTextFile(fs, path, contents) }');expect(result.diagnostics).toEqual([]);const fs=issueCapability('filesystem');
    expect(executeValue(result.ir!.functions,'append',[fs,'out.txt',' second'],{filesystemRoot:root})).toEqual(new ResultValue('ok',true));expect(readFileSync(join(root,'out.txt'),'utf8')).toBe('first second');expect(executeValue(result.ir!.functions,'append',[fs,'../escape.txt','bad'],{filesystemRoot:root})).toEqual(new ResultValue('err','path_outside_root'));
  });
  it('checks file existence only within the explicit root',()=>{
    const root=mkdtempSync(join(tmpdir(),'pipe-fs-exists-'));roots.push(root);writeFileSync(join(root,'present.txt'),'yes');const result=compile('app Files\nfunction exists(fs capability<filesystem>, path text) -> result<boolean,text> { return fileExists(fs, path) }');expect(result.diagnostics).toEqual([]);const fs=issueCapability('filesystem');
    expect(executeValue(result.ir!.functions,'exists',[fs,'present.txt'],{filesystemRoot:root})).toEqual(new ResultValue('ok',true));expect(executeValue(result.ir!.functions,'exists',[fs,'missing.txt'],{filesystemRoot:root})).toEqual(new ResultValue('ok',false));expect(executeValue(result.ir!.functions,'exists',[fs,'../escape.txt'],{filesystemRoot:root})).toEqual(new ResultValue('err','path_outside_root'));
  });
  it('lists immediate directory entries only within the explicit root',()=>{
    const root=mkdtempSync(join(tmpdir(),'pipe-fs-list-'));roots.push(root);writeFileSync(join(root,'b.txt'),'b');writeFileSync(join(root,'a.txt'),'a');const result=compile('app Files\nfunction list(fs capability<filesystem>, path text) -> result<list<text>,text> { return listDirectory(fs, path) }');expect(result.diagnostics).toEqual([]);const fs=issueCapability('filesystem');
    expect(executeValue(result.ir!.functions,'list',[fs,'.'],{filesystemRoot:root})).toEqual(new ResultValue('ok',expect.objectContaining({items:['a.txt','b.txt']})));expect(executeValue(result.ir!.functions,'list',[fs,'missing'],{filesystemRoot:root})).toEqual(new ResultValue('err','not_found'));expect(executeValue(result.ir!.functions,'list',[fs,'../escape'],{filesystemRoot:root})).toEqual(new ResultValue('err','path_outside_root'));
  });
  it('copies files only when both paths stay within the explicit root',()=>{
    const root=mkdtempSync(join(tmpdir(),'pipe-fs-copy-'));roots.push(root);writeFileSync(join(root,'source.txt'),'copy me');const result=compile('app Files\nfunction copy(fs capability<filesystem>, source text, destination text) -> result<boolean,text> { return copyTextFile(fs, source, destination) }');expect(result.diagnostics).toEqual([]);const fs=issueCapability('filesystem');
    expect(executeValue(result.ir!.functions,'copy',[fs,'source.txt','destination.txt'],{filesystemRoot:root})).toEqual(new ResultValue('ok',true));expect(readFileSync(join(root,'destination.txt'),'utf8')).toBe('copy me');expect(executeValue(result.ir!.functions,'copy',[fs,'missing.txt','destination.txt'],{filesystemRoot:root})).toEqual(new ResultValue('err','not_found'));expect(executeValue(result.ir!.functions,'copy',[fs,'source.txt','../escape.txt'],{filesystemRoot:root})).toEqual(new ResultValue('err','path_outside_root'));
  });
  it('moves files only when both paths stay within the explicit root',()=>{
    const root=mkdtempSync(join(tmpdir(),'pipe-fs-move-'));roots.push(root);writeFileSync(join(root,'source.txt'),'move me');const result=compile('app Files\nfunction move(fs capability<filesystem>, source text, destination text) -> result<boolean,text> { return moveTextFile(fs, source, destination) }');expect(result.diagnostics).toEqual([]);const fs=issueCapability('filesystem');
    expect(executeValue(result.ir!.functions,'move',[fs,'source.txt','destination.txt'],{filesystemRoot:root})).toEqual(new ResultValue('ok',true));expect(readFileSync(join(root,'destination.txt'),'utf8')).toBe('move me');expect(() => readFileSync(join(root,'source.txt'),'utf8')).toThrow();expect(executeValue(result.ir!.functions,'move',[fs,'destination.txt','destination.txt'],{filesystemRoot:root})).toEqual(new ResultValue('err','already_exists'));expect(executeValue(result.ir!.functions,'move',[fs,'../escape.txt','other.txt'],{filesystemRoot:root})).toEqual(new ResultValue('err','path_outside_root'));
  });
  it('removes files only within the explicit root',()=>{
    const root=mkdtempSync(join(tmpdir(),'pipe-fs-remove-'));roots.push(root);writeFileSync(join(root,'remove.txt'),'remove me');const result=compile('app Files\nfunction remove(fs capability<filesystem>, path text) -> result<boolean,text> { return removeTextFile(fs, path) }');expect(result.diagnostics).toEqual([]);const fs=issueCapability('filesystem');
    expect(executeValue(result.ir!.functions,'remove',[fs,'remove.txt'],{filesystemRoot:root})).toEqual(new ResultValue('ok',true));expect(() => readFileSync(join(root,'remove.txt'),'utf8')).toThrow();expect(executeValue(result.ir!.functions,'remove',[fs,'missing.txt'],{filesystemRoot:root})).toEqual(new ResultValue('err','not_found'));expect(executeValue(result.ir!.functions,'remove',[fs,'../escape.txt'],{filesystemRoot:root})).toEqual(new ResultValue('err','path_outside_root'));
  });
});
