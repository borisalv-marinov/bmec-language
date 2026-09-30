import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname,join} from 'node:path';

const npmCli=process.platform==='win32'
  ? [process.env.npm_execpath,join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js')].find(path=>path&&existsSync(path))
  : 'npm';

if(!npmCli)throw new Error('Could not locate npm CLI JavaScript entry point');

export function execNpm(args,options={}){
  return process.platform==='win32'
    ? execFileSync(process.execPath,[npmCli,...args],options)
    : execFileSync(npmCli,args,options);
}
