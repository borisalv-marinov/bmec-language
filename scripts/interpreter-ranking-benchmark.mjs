#!/usr/bin/env node
import {performance} from 'node:perf_hooks';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {compile} from '../dist/compiler.js';
import {executeAsyncValue} from '../dist/core/interpreter.js';

const iterations=Number(process.env.BMEC_INTERPRETER_BENCH_ITERATIONS??200_000);
const samples=Number(process.env.BMEC_INTERPRETER_BENCH_SAMPLES??5);
if(!Number.isSafeInteger(iterations)||iterations<1||iterations>1_000_000||!Number.isSafeInteger(samples)||samples<3||samples>9)throw new Error('Benchmark bounds: iterations must be 1–1000000 and samples 3–9');
const baseline=JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','docs','interpreter-workload-baseline.json'),'utf8'));
if(baseline.schemaVersion!=='bmec.interpreter-benchmark-baseline.v1'||!baseline.workloads||typeof baseline.workloads!=='object')throw new Error('Interpreter benchmark baseline is malformed');
const workloads=[
  ['Counter',`function main() -> integer { var value = 0 while value < ${iterations} { value = value + 1 } return value }`,BigInt(iterations)],
  ['Checksum',`function main() -> integer { var index = 0 var sum = 0 while index < ${iterations} { sum = sum + index index = index + 1 } return sum }`,BigInt(iterations)*(BigInt(iterations)-1n)/2n],
  ['Function calls',`function increment(value integer) -> integer { return value + 1 } function main() -> integer { var index = 0 var value = 0 while index < ${iterations} { value = increment(value) index = index + 1 } return value }`,BigInt(iterations)],
  ['Collection',`function main() -> integer { var index = 0 var values list<integer> = [] while index < ${iterations} { values = [index, index + 1] index = index + 1 } return length(values) }`,2n],
];
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};
const results=[];
for(const [workload,source,expected] of workloads){
  const compiled=compile(`app InterpreterBenchmark\n${source}`);
  if(compiled.diagnostics.length||!compiled.ir)throw new Error(`${workload}: compile failed (${compiled.diagnostics.map(item=>item.code).join(', ')})`);
  const run=async()=>executeAsyncValue(compiled.ir.functions,'main',[],{signal:new AbortController().signal,maxSteps:Math.min(10_000_000,iterations*32+100)});
  const warmup=await run();
  if(warmup!==expected)throw new Error(`${workload}: warmup result ${String(warmup)} did not match ${String(expected)}`);
  const timings=[];
  for(let sample=0;sample<samples;sample++){const start=performance.now();const output=await run();timings.push(performance.now()-start);if(output!==expected)throw new Error(`${workload}: sample ${sample+1} returned ${String(output)}`);}
  results.push({workload,iterations,samples,medianMs:Number(median(timings).toFixed(3))});
}
const node=process.version,platform=`${process.platform}/${process.arch}`;
const comparable=node===baseline.node&&platform===baseline.platform&&iterations===baseline.iterations&&samples===baseline.samples;
const ranked=results.map(item=>({rank:0,...item,...(comparable&&Number.isFinite(baseline.workloads[item.workload])?{baselineMedianMs:baseline.workloads[item.workload],medianReductionPercent:Number(((1-item.medianMs/baseline.workloads[item.workload])*100).toFixed(1))}:{})}));
ranked.sort((left,right)=>(right.medianReductionPercent??-Infinity)-(left.medianReductionPercent??-Infinity));
ranked.forEach((item,index)=>item.rank=index+1);
console.log(JSON.stringify({node,platform,iterations,samples,baseline:{sourceCommit:baseline.sourceCommit,packageVersion:baseline.packageVersion,node:baseline.node,platform:baseline.platform,comparable},results:ranked},null,2));
