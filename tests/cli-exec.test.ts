import {describe,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

describe('BMEC public exec command',()=>{
  it('runs a typed filesystem function with explicit JSON arguments and root',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-exec-')),input=join(root,'input.log'),output=join(root,'summary.log');writeFileSync(input,'INFO ok\nERROR zed\nERROR alpha\n');
    const cli=join(process.cwd(),'dist','cli','index.js');const result=JSON.parse(execFileSync(process.execPath,[cli,'exec','examples/log-analyzer/main.bmec','summarize','--args',JSON.stringify(['input.log','summary.log']),'--filesystem-root',root,'--json'],{encoding:'utf8'}));
    expect(result).toEqual({ok:true,value:{state:'ok',value:true},stdout:'',stderr:'',exitCode:0});expect(readFileSync(output,'utf8')).toBe('ERROR alpha\nERROR zed');
  });
  it('does not allow an omitted filesystem root to become host access',()=>{
    const cli=join(process.cwd(),'dist','cli','index.js');let stderr='';try{execFileSync(process.execPath,[cli,'exec','examples/log-analyzer/main.bmec','summarize','--args','["input.log","summary.log"]','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});throw new Error('exec unexpectedly passed')}catch(error){stderr=String((error as {stderr?:unknown}).stderr??'')};expect(JSON.parse(stderr)).toMatchObject({ok:false,error:{code:'PIPE-FS-001'}});
  });
  it('passes an explicit JSON argv array to environment-capability functions',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-exec-')),source=join(root,'args.bmec');writeFileSync(source,'app Args\nfunction show(env capability<environment>) -> list<text> { return environmentArguments(env) }\n');
    const cli=join(process.cwd(),'dist','cli','index.js');const result=JSON.parse(execFileSync(process.execPath,[cli,'exec',source,'show','--argv','["--input","daily.log"]','--json'],{encoding:'utf8'}));
    expect(result).toEqual({ok:true,value:['--input','daily.log'],stdout:'',stderr:'',exitCode:0});
  });
  it('passes stdin only when explicitly requested',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-exec-')),source=join(root,'stdin.bmec');writeFileSync(source,'app Stdin\nasync function main(env capability<environment>) -> task<result<text,text>> { return await readStdin(env) }\n');
    const cli=join(process.cwd(),'dist','cli','index.js');const result=spawnSync(process.execPath,[cli,'exec',source,'main','--stdin','--json'],{encoding:'utf8',input:'from stdin\n'});
    expect(result.status).toBe(0);expect(result.stderr).toBe('');expect(JSON.parse(result.stdout)).toEqual({ok:true,value:{state:'ok',value:'from stdin\n'},stdout:'',stderr:'',exitCode:0});
  });
  it('captures typed stdout/stderr and honors a bounded exit code in JSON mode',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-exec-')),source=join(root,'io.bmec');writeFileSync(source,'app IO\nfunction main(env capability<environment>) -> result<boolean,text> { let out = writeStdout(env, "ready\\n") let err = writeStderr(env, "warning\\n") return setExitCode(env, 7) }\n');
    const cli=join(process.cwd(),'dist','cli','index.js');const result=spawnSync(process.execPath,[cli,'exec',source,'main','--json'],{encoding:'utf8'});
    expect(result.status).toBe(7);expect(result.stderr).toBe('');expect(JSON.parse(result.stdout)).toEqual({ok:true,value:{state:'ok',value:true},stdout:'ready\n',stderr:'warning\n',exitCode:7});
  });
});
