import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';

const root=process.cwd();
const cli=join(root,'dist','cli','index.js');
const examples=join(root,'examples');
function walk(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{const path=join(directory,entry.name);if(entry.isDirectory())return ['generated','release'].includes(entry.name)?[]:walk(path);return /\.(?:bmec|pipe)$/.test(entry.name)?[path]:[];});}
function check(file){execFileSync(process.execPath,[cli,'check',file],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}

const invalid=join(examples,'invalid','unknown-model.pipe');
let invalidOutput='';
try{check(invalid);throw new Error('Intentional invalid fixture unexpectedly compiled');}catch(error){invalidOutput=String(error.stdout??'')+String(error.stderr??'');if(!invalidOutput.includes('PIPE-REF-001'))throw error;}

const template=join(examples,'json-record-list-decode-bench','main.bmec');
const temporary=mkdtempSync(join(tmpdir(),'bmec-example-template-'));
try{
  const source=readFileSync(template,'utf8');
  if(!source.includes('__BMEC_RECORD_PAYLOAD__'))throw new Error('Benchmark template placeholder is missing');
  const runnable=join(temporary,'main.bmec');
  writeFileSync(runnable,source.replaceAll('__BMEC_RECORD_PAYLOAD__','"{\\"count\\":17,\\"values\\":[1,2,3,4,5,6,7,8]}"'));
  check(runnable);
}finally{rmSync(temporary,{recursive:true,force:true});}

const validFiles=walk(examples).filter(file=>!relative(examples,file).startsWith(`invalid${process.platform==='win32'?'\\':'/'}`)&&file!==template);
for(const file of validFiles)check(file);
console.log(`EXAMPLES PASS — ${validFiles.length} source files; intentional invalid fixture diagnostic verified; benchmark template checked with a representative payload`);
