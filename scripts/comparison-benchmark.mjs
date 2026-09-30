#!/usr/bin/env node
import {performance} from 'node:perf_hooks';
import {compile} from '../dist/compiler.js';
import {executeValue} from '../dist/core/interpreter.js';

const samples=Number(process.env.BMEC_COMPARISON_SAMPLES??10);
const workloads={
 integerLoop:25000,
 functionCalls:25000,
 stringSearch:25000,
};
const sources={
 integerLoop:String.raw`app Bench
 function main() -> integer { var total integer = 0 repeat 25000 { total = total + 1 } return total }`,
 functionCalls:String.raw`app Bench
function add(a integer, b integer) -> integer { return a + b }
 function main() -> integer { var total integer = 0 repeat 25000 { total = total + add(20, 22) } return total }`,
 stringSearch:String.raw`app Bench
 function main() -> integer { var total integer = 0 repeat 25000 { if textContains("BMEC benchmark", "mark") { total = total + 1 } } return total }`,
};
const nodeWorkloads={
 integerLoop(){let total=0;for(let i=0;i<workloads.integerLoop;i++)total+=1;return total},
 functionCalls(){const add=(a,b)=>a+b;let total=0;for(let i=0;i<workloads.functionCalls;i++)total+=add(20,22);return total},
 stringSearch(){let total=0;for(let i=0;i<workloads.stringSearch;i++)if('BMEC benchmark'.includes('mark'))total+=1;return total},
};
const percentile=(values,p)=>values[Math.min(values.length-1,Math.floor(values.length*p))];
function measure(fn){for(let i=0;i<3;i++)fn();const values=[];for(let i=0;i<samples;i++){const start=performance.now();const result=fn();values.push(performance.now()-start);if(result===undefined)throw new Error('benchmark returned no result')}values.sort((a,b)=>a-b);return {samples,p50Ms:Number(percentile(values,.5).toFixed(3)),p95Ms:Number(percentile(values,.95).toFixed(3))};}
const result={version:1,node:process.version,platform:`${process.platform} ${process.arch}`,samples,workloads,comparisons:{}};
for(const name of Object.keys(sources)){const compiled=compile(sources[name]);if(compiled.diagnostics.length)throw new Error(`${name}: ${compiled.diagnostics.map(d=>d.message).join('; ')}`);result.comparisons[name]={bmec:measure(()=>executeValue(compiled.ir.functions,'main',[],{maxSteps:5_000_000})),node:measure(nodeWorkloads[name])};}
console.log(JSON.stringify(result,null,2));
