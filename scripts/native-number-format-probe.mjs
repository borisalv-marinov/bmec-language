#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compile} from '../dist/compiler.js';
import {executeValue} from '../dist/core/interpreter.js';
import {buildNative} from '../dist/native/build.js';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
let state=0x5eed1234;
const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
const values=[0,-0,0.25,-0.25,0.75,-0.75,1.25,-1.25,1.75,-1.75,2**51,-(2**51),2**51+0.5,Number.MIN_VALUE,-Number.MIN_VALUE,Number.MAX_VALUE,-Number.MAX_VALUE,2.2250738585072014e-308,Number.MIN_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,1e-6,1e-7,1e20,1e21,1.2345678901234567,1.0000000000000002];
for(let i=0;i<100;i++){
 const sign=random()<0.5?-1:1;
 const exponent=Math.floor(random()*616)-308;
 const value=sign*(random()*9+1)*10**exponent;
 if(Number.isFinite(value))values.push(value);
}
function bmecNumber(value){
 let source=Math.abs(value).toString();
 const negative=value<0||Object.is(value,-0);
 const [mantissa,exponentText='0']=source.split('e');
 const [whole,fraction='']=mantissa.split('.');
 const digits=whole+fraction;
 const point=whole.length+Number(exponentText);
 let expanded=point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point);
 if(!expanded.includes('.'))expanded+='.0';
 return (negative?'-':'')+expanded;
}
const cases=values.map(value=>({value,literal:bmecNumber(value),wire:JSON.stringify({version:1,kind:'number',value})}));
const body=cases.map(({literal,wire})=>`encodeJson(${literal}) == ${JSON.stringify(wire)}`).join(' and\n');
const compiled=compile(`function main() -> boolean { return ${body} }`);
if(compiled.diagnostics.length)throw new Error(compiled.diagnostics.map(item=>item.message).join('; '));
const work=mkdtempSync(join(tmpdir(),'bmec-number-format-'));
let built;
let native;
let reference;
try{
 built=buildNative(compiled.ir,{outputDirectory:work});
 reference=executeValue(compiled.ir.functions,'main',[]);
 native=spawnSync(built.executable,[],{encoding:'utf8',windowsHide:true});
 if(native.error)throw native.error;
}finally{rmSync(work,{recursive:true,force:true});}
const passed=reference===true&&native.status===0&&native.stdout.trim()==='true';
const output={version:1,revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),platform:`${process.platform} ${process.arch}`,seed:'0x5eed1234',cases:cases.length,passed:passed?cases.length:0,reference,native:native.stdout.trim(),exitCode:native.status,compiler:built.compiler,compilerVersion:built.compilerVersion,flags:built.flags,values:cases.map(({value,literal,wire})=>({value,literal,wire})),stderr:native.stderr,success:passed};
const destination=process.env.BMEC_NATIVE_NUMBER_FORMAT_OUTPUT;
if(destination)writeFileSync(resolve(destination),`${JSON.stringify(output,null,2)}\n`,'utf8');
console.log(JSON.stringify(output,null,2));
if(!passed)process.exitCode=1;
