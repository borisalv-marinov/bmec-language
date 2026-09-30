#!/usr/bin/env node
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir,cpus} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {compile} from '../dist/compiler.js';
import {executeValue} from '../dist/core/interpreter.js';
import {lowerNativeC} from '../dist/native/codegen.js';
import {compileNativeSource,resolveNativeCompiler} from '../dist/native/build.js';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const size=Number(process.env.BMEC_NUMERIC_SORT_SIZE??128);
const samples=Number(process.env.BMEC_NUMERIC_SORT_SAMPLES??9);
const targetMs=Number(process.env.BMEC_NUMERIC_SORT_TARGET_MS??75);
const maxRuns=1_048_576;
const validationSeeds=512;
const numericSortAlgorithm=process.env.BMEC_NUMERIC_SORT_ALGORITHM??'intro';
const insertionThreshold=Number(process.env.BMEC_NUMERIC_SORT_INSERTION_THRESHOLD??16);
if(!['qsort','heap','intro'].includes(numericSortAlgorithm))throw new Error('BMEC_NUMERIC_SORT_ALGORITHM must be qsort, heap, or intro');
if(!Number.isSafeInteger(size)||size<1||size>4096)throw new Error('BMEC_NUMERIC_SORT_SIZE must be from 1 through 4096');
if(!Number.isSafeInteger(samples)||samples<3)throw new Error('BMEC_NUMERIC_SORT_SAMPLES must be at least 3');
if(!Number.isFinite(targetMs)||targetMs<10)throw new Error('BMEC_NUMERIC_SORT_TARGET_MS must be at least 10');
if(!Number.isSafeInteger(insertionThreshold)||insertionThreshold<4||insertionThreshold>64)throw new Error('BMEC_NUMERIC_SORT_INSERTION_THRESHOLD must be from 4 through 64');
const bases=Array.from({length:size},(_,index)=>(index*7919)%1009);
const values=bases.map(base=>`(seed * 0.25 + ${base}.0 * 0.25 - 126.0)`);
const source=`app NumericSortBench
function sortOnce(seed number) -> number {
  let values = [${values.join(', ')}]
  let sorted = sort(values)
  var checksum number = 0.0
  for value in sorted {
    checksum = (checksum * 33.0 + value) % 1000003.0
  }
  return checksum
}
function main() -> number {
  return sortOnce(0.0)
}`;
const compiled=compile(source);
if(compiled.diagnostics.length)throw new Error(`${JSON.stringify(compiled.diagnostics)}\n${source.split('\n').slice(7,10).join('\n')}`);
const ir=compiled.ir;
const reference=seed=>executeValue(ir.functions,'sortOnce',[seed],{maxSteps:100_000});
const nodeWork=seed=>{
 const input=bases.map(base=>seed*0.25+base*0.25-126.0);
 const sorted=input.slice().sort((a,b)=>a-b);
 let checksum=0;
 for(const value of sorted)checksum=(checksum*33+value)%1000003;
 return checksum;
};

let cSource=lowerNativeC(ir).replace('#include <stdlib.h>','#include <stdlib.h>\n#include <time.h>\n#ifdef _WIN32\n#include <windows.h>\nstatic double bmec_bench_seconds(void) { LARGE_INTEGER frequency, counter; QueryPerformanceFrequency(&frequency); QueryPerformanceCounter(&counter); return (double)counter.QuadPart/(double)frequency.QuadPart; }\n#else\nstatic double bmec_bench_seconds(void) { struct timespec value; clock_gettime(CLOCK_MONOTONIC,&value); return (double)value.tv_sec+(double)value.tv_nsec/1000000000.0; }\n#endif');
const introCall='bmec_number_intro_sort(items, input.length);';
if(!cSource.includes(introCall))throw new Error('Generated numeric introsort call was not found');
if(numericSortAlgorithm==='heap')cSource=cSource.replace(introCall,'bmec_number_heap_sort(items, input.length);');
else if(numericSortAlgorithm==='qsort')cSource=cSource.replace(introCall,'qsort(items, input.length, sizeof(double), bmec_number_qsort_compare);');
if(numericSortAlgorithm==='intro') {
 const defaultCutoff='hi - lo > 16';
 if(!cSource.includes(defaultCutoff))throw new Error('Generated numeric introsort insertion cutoff was not found');
 cSource=cSource.replace(defaultCutoff,`hi - lo > ${insertionThreshold}`);
}
const entry=ir.functions.find(fn=>fn.name==='sortOnce');
if(!entry||entry.parameters.length!==1||entry.returnTypeRef.kind!=='primitive'||entry.returnTypeRef.name!=='number')throw new Error('Unexpected numeric-sort benchmark entry ABI');
const entryC=`bmec_fn_${[...new TextEncoder().encode(String(entry.id))].map(byte=>byte.toString(16).padStart(2,'0')).join('')}`;
const nativeMain=`int main(int argc,char **argv) {
  if(argc!=3) return 2;
  const int64_t runs=strtoll(argv[1],NULL,10);
  const bool validate=strcmp(argv[2],"validate")==0;
  if(runs<1) return 2;
  if(validate) {
    for(int64_t i=0;i<runs;++i) { bmec_steps=0; bmec_depth=0; const double value=${entryC}(i%1024); printf("%.17g\\n",value); bmec_arena_release(); }
    return 0;
  }
  volatile double sink=0.0; const double start=bmec_bench_seconds(); double value=0.0;
  for(int64_t i=0;i<runs;++i) { bmec_steps=0; bmec_depth=0; value=${entryC}(i%1024); sink=value; bmec_arena_release(); }
  const double elapsed=bmec_bench_seconds()-start;
  printf("%.17g %.9f\\n",value,elapsed);
  return 0;
}
`;
const wrappedC=cSource.replace(/int main\(void\) \{[\s\S]*\n\}\n$/,nativeMain);
if(wrappedC===cSource)throw new Error('Could not replace the generated native entry point');
const cppSource=`#include <algorithm>
#include <array>
#include <cstdio>
#include <cstdlib>
#include <chrono>
#include <cmath>
#include <string>
#include <stdexcept>
constexpr int size=${size};
constexpr int bases[size]={${bases.join(',')}};
constexpr double base_values[size]={${bases.map(value=>`(${value}.0*0.25-126.0)`).join(',')}};
volatile double sink=0.0;
inline double bmec_number(double value) { if(!std::isfinite(value)) throw std::runtime_error("PIPE-RUNTIME-005: Invalid numeric value"); return value; }
inline double bmec_number_add(double a,double b) { return bmec_number(a+b); }
inline double bmec_number_mul(double a,double b) { return bmec_number(a*b); }
inline double bmec_number_mod(double a,double b) { if(b==0.0) throw std::runtime_error("PIPE-RUNTIME-003: Division by zero"); return bmec_number(std::fmod(a,b)); }
double work(long long seed) { std::array<double,size> input{}; const double scaledSeed=bmec_number_mul(static_cast<double>(seed),0.25); for(int i=0;i<size;i++) input[i]=bmec_number_add(scaledSeed,base_values[i]); auto sorted=input; std::sort(sorted.begin(),sorted.end()); double checksum=0.0; for(double value:sorted) checksum=bmec_number_mod(bmec_number_add(bmec_number_mul(checksum,33.0),value),1000003.0); return checksum; }
int main(int argc,char**argv) { if(argc!=3)return 2; const long long runs=std::strtoll(argv[1],nullptr,10); const bool validate=std::string(argv[2])=="validate"; if(runs<1)return 2; if(validate){for(long long i=0;i<runs;i++)std::printf("%.17g\\n",work(i%1024));return 0;} const auto start=std::chrono::steady_clock::now(); double value=0.0; for(long long i=0;i<runs;i++){value=work(i%1024);sink=value;} const double elapsed=std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count(); std::printf("%.17g %.9f\\n",value,elapsed);return 0; }
`;
const goSource=`package main
import("fmt";"math";"os";"sort";"strconv";"time")
const size=${size}
var bases=[size]float64{${bases.map(value=>`${value}.0`).join(',')}}
var baseValues=[size]float64{${bases.map(value=>`(${value}.0*0.25-126.0)`).join(',')}}
var sink float64
func bmecNumber(value float64)float64{if math.IsNaN(value)||math.IsInf(value,0){panic("PIPE-RUNTIME-005: Invalid numeric value")};return value}
func bmecNumberAdd(a,b float64)float64{return bmecNumber(a+b)}
func bmecNumberMul(a,b float64)float64{return bmecNumber(a*b)}
func bmecNumberMod(a,b float64)float64{if b==0{panic("PIPE-RUNTIME-003: Division by zero")};return bmecNumber(math.Mod(a,b))}
func work(seed int64)float64{input:=make([]float64,size);scaledSeed:=bmecNumberMul(float64(seed),0.25);for i:=range input{input[i]=bmecNumberAdd(scaledSeed,baseValues[i])};sorted:=append([]float64(nil),input...);sort.Float64s(sorted);var checksum float64;for _,value:=range sorted{checksum=bmecNumberMod(bmecNumberAdd(bmecNumberMul(checksum,33.0),value),1000003.0)};return checksum}
func main(){if len(os.Args)!=3{os.Exit(2)};runs,_:=strconv.ParseInt(os.Args[1],10,64);validate:=os.Args[2]=="validate";if runs<1{os.Exit(2)};if validate{for i:=int64(0);i<runs;i++{fmt.Printf("%.17g\\n",work(i%1024))};return};start:=time.Now();var value float64;for i:=int64(0);i<runs;i++{value=work(i%1024);sink=value};fmt.Printf("%.17g %.9f\\n",value,float64(time.Since(start).Nanoseconds())/1e9)}
`;

const work=mkdtempSync(join(tmpdir(),'bmec-numeric-sort-bench-'));
const nativeCompiler=resolveNativeCompiler();
const cPath=join(work,'bmec-numeric-sort.c');
const cExe=join(work,process.platform==='win32'?'bmec-numeric-sort.exe':'bmec-numeric-sort');
writeFileSync(cPath,wrappedC,'utf8');
const cFlags=compileNativeSource(nativeCompiler,cPath,cExe,'c');
const cppPath=join(work,process.platform==='win32'?'bmec-numeric-sort.cpp':'bmec-numeric-sort.cc');
const cppExe=join(work,process.platform==='win32'?'bmec-numeric-sort-cpp.exe':'bmec-numeric-sort-cpp');
writeFileSync(cppPath,cppSource,'utf8');
let cppCompiler,cppFlags;
if(process.platform==='win32'){cppCompiler=nativeCompiler;cppFlags=compileNativeSource(cppCompiler,cppPath,cppExe,'c++');}
else {const version=execFileSync('g++',['--version'],{encoding:'utf8'}).split(/\r?\n/,1)[0].trim();cppCompiler={path:'g++',version,kind:'gnu'};const build=spawnSync('g++',['-O3','-std=c++17',cppPath,'-o',cppExe],{encoding:'utf8'});if(build.error||build.status!==0)throw new Error(build.stderr||build.error?.message||'C++ benchmark build failed');cppFlags=['-O3','-std=c++17'];}
const goPath=join(work,'numeric-sort.go');
const goExe=join(work,process.platform==='win32'?'numeric-sort-go.exe':'numeric-sort-go');
let goCompiler;
try{goCompiler=execFileSync('go',['version'],{encoding:'utf8'}).trim();writeFileSync(goPath,goSource,'utf8');execFileSync('go',['build','-o',goExe,goPath],{cwd:work,encoding:'utf8'});}catch{goCompiler=undefined;}

function runExecutable(exe,runs,mode='benchmark'){
 const output=execFileSync(exe,[String(runs),mode],{encoding:'utf8',windowsHide:true}).trim();
 return mode==='benchmark'?output.split(/\s+/).filter(Boolean):output.split(/\r?\n/).filter(Boolean);
}
function compareValidation(label,values){
 if(values.length!==validationSeeds)throw new Error(`${label} returned ${values.length} validation results`);
 for(let seed=0;seed<validationSeeds;seed++){const actual=Number(values[seed]);const expected=Number(reference(seed));if(!Number.isFinite(actual)||actual!==expected)throw new Error(`${label} checksum mismatch at seed ${seed}: expected ${expected}, got ${values[seed]}`);}
}
compareValidation('Node',Array.from({length:validationSeeds},(_,seed)=>nodeWork(seed)));
compareValidation('native C',runExecutable(cExe,validationSeeds,'validate'));
compareValidation('C++',runExecutable(cppExe,validationSeeds,'validate'));
if(goCompiler)compareValidation('Go',runExecutable(goExe,validationSeeds,'validate'));
const checksum=values=>createHash('sha256').update(values.map(value=>String(value)).join('\n')).digest('hex');
const referenceDigest=checksum(Array.from({length:validationSeeds},(_,seed)=>reference(seed)));
for(const [label,values] of [
 ['Node',Array.from({length:validationSeeds},(_,seed)=>nodeWork(seed))],
 ['native C',runExecutable(cExe,validationSeeds,'validate')],
 ['C++',runExecutable(cppExe,validationSeeds,'validate')],
 ...(goCompiler?[['Go',runExecutable(goExe,validationSeeds,'validate')]]:[]),
])if(checksum(values.map(Number))!==referenceDigest)throw new Error(`${label} validation digest mismatch`);

function summarize(times,runs,operations){
 const sorted=[...times].sort((a,b)=>a-b),mean=times.reduce((a,b)=>a+b,0)/times.length;
 const variance=times.reduce((total,value)=>total+(value-mean)**2,0)/times.length;
 return {samples:times.length,warmups:2,targetSampleMs:targetMs,runsPerSample:runs,sortsPerSample:runs*operations,minMs:Number(sorted[0].toFixed(4)),medianMs:Number(sorted[Math.floor(sorted.length/2)].toFixed(4)),p95Ms:Number(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))].toFixed(4)),maxMs:Number(sorted.at(-1).toFixed(4)),coefficientOfVariation:Number((Math.sqrt(variance)/mean).toFixed(4)),nsPerSort:Number((sorted[Math.floor(sorted.length/2)]*1e6/(runs*operations)).toFixed(3))};
}
function measureJs(label,fn,operations){
 for(let i=0;i<2;i++)globalThis.__bmecNumericSortSink=fn(i);
 let runs=1,elapsed=0;
 while(true){const start=performance.now();for(let i=0;i<runs;i++)globalThis.__bmecNumericSortSink=fn(i%1024);elapsed=performance.now()-start;if(elapsed>=targetMs||runs>=maxRuns)break;runs=Math.min(runs*2,maxRuns);}
 if(elapsed<targetMs)throw new Error(`${label} could not reach sample target (${elapsed.toFixed(2)} ms)`);
 const times=[];let last;
 for(let sample=0;sample<samples;sample++){const start=performance.now();for(let i=0;i<runs;i++){last=fn(i%1024);globalThis.__bmecNumericSortSink=last;}times.push(performance.now()-start);}
 if(Number(last)!==Number(reference((runs-1)%1024)))throw new Error(`${label} timed checksum mismatch`);
 return {...summarize(times,runs,operations),timing:'monotonic wall time inside repeated in-process calls; each result is consumed'};
}
function measureNative(label,exe,operations){
 const invoke=runs=>{const parts=runExecutable(exe,runs);if(parts.length!==2)throw new Error(`${label} returned an invalid timing record`);return {value:Number(parts[0]),elapsedMs:Number(parts[1])*1000};};
 for(let i=0;i<3;i++)invoke(1);
 let runs=1,trial;
 while(true){trial=invoke(runs);if(trial.elapsedMs>=targetMs||runs>=maxRuns)break;runs=Math.min(runs*2,maxRuns);}
 if(trial.elapsedMs<targetMs)throw new Error(`${label} could not reach sample target (${trial.elapsedMs.toFixed(2)} ms)`);
 const times=[];let last;
 for(let sample=0;sample<samples;sample++){const result=invoke(runs);last=result.value;times.push(result.elapsedMs);}
 if(last!==Number(reference((runs-1)%1024)))throw new Error(`${label} timed checksum mismatch`);
 return {...summarize(times,runs,operations),timing:'monotonic wall time inside the repeated native benchmark loop; each result is consumed'};
}

const referenceMeasure=measureJs('BMEC reference',reference,1);
const nodeMeasure=measureJs('Node',nodeWork,1);
const nativeMeasure=measureNative('BMEC native C',cExe,1);
const cppMeasure=measureNative('C++',cppExe,1);
const goMeasure=goCompiler?measureNative('Go',goExe,1):{unavailable:'Go is not installed'};
const stableFlags=flags=>flags.filter(flag=>/^\/(?:nologo|O2|std:)/.test(flag)||/^-(?:O3|std=|lm$)/.test(flag));
const mediansNsPerSort={bmecReference:referenceMeasure.nsPerSort,node:nodeMeasure.nsPerSort,bmecNative:nativeMeasure.nsPerSort,cpp:cppMeasure.nsPerSort,...(goMeasure.nsPerSort?{go:goMeasure.nsPerSort}:{})};
const result={version:1,revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),platform:`${process.platform} ${process.arch}`,node:process.version,machine:{cpu:cpus()[0]?.model??'unknown'},samples,warmups:2,targetSampleMs:targetMs,validationSeeds,validatedOutputSha256:referenceDigest,dataset:{values:size,distribution:'deterministic seeded quarter-step values spanning -126 through 507; seed changes on every operation',operation:'copy input, sort ascending, and compute order-sensitive checksum over sorted values'},implementations:{bmecReference:referenceMeasure,node:nodeMeasure,bmecNative:{...nativeMeasure,algorithm:numericSortAlgorithm,...(numericSortAlgorithm==='intro'?{insertionThreshold}:{}),compiler:nativeCompiler.version,flags:stableFlags(cFlags)},cpp:{...cppMeasure,compiler:cppCompiler.version,flags:stableFlags(cppFlags)},go:goMeasure},ratios:{basis:'median nanoseconds per sort; sample durations are normalized by each implementation’s own calibrated operation count',nativeOverCpp:Number((nativeMeasure.nsPerSort/cppMeasure.nsPerSort).toFixed(3)),nativeOverNode:Number((nativeMeasure.nsPerSort/nodeMeasure.nsPerSort).toFixed(3)),nativeOverReference:Number((nativeMeasure.nsPerSort/referenceMeasure.nsPerSort).toFixed(3)),medianNsPerSort:mediansNsPerSort}};
const destination=process.env.BMEC_NUMERIC_SORT_OUTPUT??join(root,'docs','evidence',`bmec-0.5-native-numeric-sort-${process.platform}.json`);
if(destination)writeFileSync(resolve(destination),`${JSON.stringify(result,null,2)}\n`,'utf8');
console.log(JSON.stringify(result,null,2));
rmSync(work,{recursive:true,force:true});
