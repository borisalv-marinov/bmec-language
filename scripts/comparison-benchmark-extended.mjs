#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir,cpus} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {compile} from '../dist/compiler.js';
import {executeValue,ResultValue} from '../dist/core/interpreter.js';
import {issueCapability} from '../dist/runtime/capabilities.js';
import {lowerNativeC} from '../dist/native/codegen.js';
import {compileNativeSource,resolveNativeCompiler} from '../dist/native/build.js';

const samples=Number(process.env.BMEC_COMPARISON_SAMPLES??10);
const targetMs=Number(process.env.BMEC_COMPARISON_TARGET_MS??75);
const maximumRuns=1_048_576;
const unit=25000;
const gridSize=192;
const nestedLoopOperations=gridSize*gridSize;
const onlyWorkloads=process.env.BMEC_COMPARISON_ONLY?.split(',').map(name=>name.trim()).filter(Boolean);
if(process.env.BMEC_COMPARISON_NATIVE_C_OUTPUT&&onlyWorkloads?.length!==1)throw new Error('BMEC_COMPARISON_NATIVE_C_OUTPUT requires exactly one BMEC_COMPARISON_ONLY workload');
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const nativeCompiler=resolveNativeCompiler();
const benchmarkHaystack='BMEC benchmark '.repeat(32);
const benchmarkNeedle='mark';
const textScanLines=Array.from({length:128},(_,index)=>`2026-09-24T12:${String(Math.floor(index/60)).padStart(2,'0')}:${String(index%60).padStart(2,'0')}Z ${index%13===0?'ERROR':'INFO'} service=api request=${String(index).padStart(4,'0')} status=${index%13===0?503:200} duration=${(index*37)%900}ms`);
const textScanText=textScanLines.join('\n');
const base64Payload='BMEC base64 benchmark data 123456'.repeat(3);
const base64Encoded=Buffer.from(base64Payload,'utf8').toString('base64');
const source={
 integerLoop:`app Bench\nfunction main() -> integer { var total integer = 0 repeat ${unit} { total = (total * 33 + 1) % 1000003 } return total }`,
 functionCalls:`app Bench\nfunction mix(a integer, b integer) -> integer { return (a * 33 + b) % 1000003 }\nfunction main() -> integer { var total integer = 0 repeat ${unit} { total = mix(total, 1) } return total }`,
 numberLoop:`app Bench\nfunction main() -> number { var total number = 0.0 repeat ${unit} { total = (total * 3.0 + 1.0) % 1000003.0 } return total }`,
 stringSearch:`app Bench\nfunction main() -> integer { var total integer = 0 repeat ${unit} { if textContains(${JSON.stringify(benchmarkHaystack)}, ${JSON.stringify(benchmarkNeedle)}) { total = total + 1 } } return total }`,
 textScan:`app Bench\nfunction main() -> integer {\n let lines = split(${JSON.stringify(textScanText)}, "\\n")\n var errors integer = 0\n for line in lines { if textContains(line, " ERROR ") { errors = errors + 1 } }\n return errors\n}`,
 listIteration:`app Bench\nfunction main() -> integer { var total integer = 0 repeat ${unit} {\nlet values list<integer> = [1, 2, 3, 4]\nfor value in values { total = (total * 33 + value) % 1000003 }\n} return total }`,
 nestedLoops:`app Bench
function main() -> integer {
 var total integer = 0
 repeat ${gridSize} {
  repeat ${gridSize} {
   total = (total * 33 + 1) % 1000003
  }
 }
 return total
}`,
 primeCount:`app Bench\nfunction isPrime(value integer) -> boolean { if value < 2 { return false } var divisor integer = 2 while divisor * divisor <= value { if value % divisor == 0 { return false } divisor = divisor + 1 } return true }\nfunction main() -> integer { var count integer = 0 var value integer = 2 while value <= 1000 { if isPrime(value) { count = count + 1 } value = value + 1 } return count }`,
 recursiveCalls:`app Bench\nfunction fib(value integer) -> integer { if value < 2 { return value } return fib(value - 1) + fib(value - 2) }\nfunction main() -> integer { return fib(20) }`,
 enumConstructionMatching:`app Bench\nenum Event { Started Stopped ExitCode(integer) Enabled(boolean) }\nfunction isTarget(item Event) -> boolean { return match item { Started => false, Stopped => false, ExitCode(code) => code % 2 == 0, Enabled(flag) => flag } }\nfunction main() -> integer { var total integer = 0 var value integer = 0 repeat ${unit} { value = (value * 33 + 1) % 1000003 let event = Event.ExitCode(value) if isTarget(event) { total = total + 1 } } return total }`,
 optionalMatch:`app Bench\nfunction next(value integer) -> integer { return (value * 33 + 1) % 1000003 }\nfunction unwrap(value integer?) -> integer { return match value { some(item) => item, none => 0 } }\nfunction step(value integer) -> integer { let candidate = next(value) return (candidate + unwrap(some(candidate))) % 1000003 }\nfunction main() -> integer { var total integer = 0 repeat ${unit} { total = step(total) } return total }`,
 resultMatch:`app Bench\nfunction next(value integer) -> integer { return (value * 33 + 1) % 1000003 }\nfunction unwrap(value result<integer,integer>) -> integer { return match value { ok(item) => item, err(problem) => problem } }\nfunction step(value integer) -> integer { let candidate = next(value) return (candidate + unwrap(ok(candidate))) % 1000003 }\nfunction main() -> integer { var total integer = 0 repeat ${unit} { total = step(total) } return total }`,
 branchMutation:`app Bench\nfunction step(value integer) -> integer { var changed integer = value if changed % 2 == 0 { changed = changed / 2 + 3 } else { changed = (changed * 33 + 1) % 1000003 } return changed }\nfunction main() -> integer { var total integer = 0 repeat ${unit} { total = step(total) } return total }`,
 recordAccess:`app Bench\ntype Point { x integer y integer }\nfunction read(point Point) -> integer { return point.x + point.y }\nfunction step(value integer) -> integer { let point = Point { x: (value * 33 + 1) % 1000003, y: 1 } return read(point) }\nfunction main() -> integer { var total integer = 0 repeat ${unit} { total = step(total) } return total }`,
 filterTextList:`app Bench\nfunction main() -> integer {\n let lines = split("ERROR disk\\nINFO ready\\nERROR timeout\\nWARN low", "\\n")\n var total integer = 0\n repeat ${unit} {\n  total = total + length(filter(lines, lambda(line text) -> boolean { return textContains(line, "ERROR") }))\n }\n return total\n}`,
 foldTextList:`app Bench\nfunction main() -> integer {\n let lines = split("ERROR disk\\nINFO ready\\nERROR timeout\\nWARN low", "\\n")\n var total integer = 0\n repeat ${unit} {\n  total = total + fold(lines, 0, lambda(count integer, line text) -> integer { if textContains(line, "ERROR") { return count + 1 } else { return count } })\n }\n return total\n}`,
 textConcat:`app Bench\nfunction main() -> integer {\n let parts = split("BMEC native", " ")\n var total integer = 0\n repeat ${unit} {\n  var joined text = ""\n  for part in parts { if joined == "" { joined = part } else { joined = joined + " " + part } }\n  if joined == "BMEC native" { total = total + 1 }\n }\n return total\n}`,
 mapTextList:`app Bench\nfunction main() -> integer {\n let lines = split("ERROR disk\\nINFO ready\\nERROR timeout\\nWARN low", "\\n")\n var total integer = 0\n repeat ${unit} {\n  total = total + length(map(lines, lambda(line text) -> text { return line + "!" }))\n }\n return total\n}`,
 collatzSteps:readFileSync(join(root,'examples','native-compute-bench','main.bmec'),'utf8'),
 jsonEncode:`app Bench\nfunction main() -> integer { var total integer = 0 repeat ${unit} { total = (total + textLength(encodeJson(total))) % 1000003 } return total }`,
 base64Encode:`app Bench\nfunction main() -> integer { var total integer = 0 repeat ${unit} { if base64Encode(${JSON.stringify(base64Payload)}) == ${JSON.stringify(base64Encoded)} { total = total + 1 } } return total }`,
 base64Decode:`app Bench\nfunction main() -> integer { var total integer = 0 repeat ${unit} { let decoded result<text,text> = base64Decode("${base64Encoded}") if isOk(decoded) { if decoded.value == "${base64Payload}" { total = total + 1 } } } return total }`,
 filesystemRead:'app Bench\nfunction main(fs capability<filesystem>) -> result<text,text> { return readTextFile(fs, "fixture.txt") }',
};
const ops={integerLoop:unit,functionCalls:unit,numberLoop:unit,stringSearch:unit,textScan:textScanLines.length,listIteration:unit,nestedLoops:nestedLoopOperations,primeCount:999,recursiveCalls:1,enumConstructionMatching:unit,optionalMatch:unit,resultMatch:unit,branchMutation:unit,recordAccess:unit,filterTextList:unit*4,foldTextList:unit*4,textConcat:unit*2,mapTextList:unit*4,collatzSteps:1,jsonEncode:unit,base64Encode:unit,base64Decode:unit,filesystemRead:1};
const recursiveFibonacci=value=>value<2?value:recursiveFibonacci(value-1)+recursiveFibonacci(value-2);
const node={
 integerLoop(){let total=0;for(let i=0;i<unit;i++)total=(total*33+1)%1000003;return total},
 functionCalls(){const mix=(a,b)=>(a*33+b)%1000003;let total=0;for(let i=0;i<unit;i++)total=mix(total,1);return total},
 numberLoop(){let total=0;for(let i=0;i<unit;i++)total=(total*3+1)%1000003;return total},
 stringSearch(){let total=0;for(let i=0;i<unit;i++)if(args.stringSearch[0].includes(args.stringSearch[1]))total++;return total},
 textScan(){let errors=0;for(const line of textScanText.split('\n'))if(line.includes(' ERROR '))errors++;return errors},
 listIteration(){let total=0;for(let i=0;i<unit;i++)for(const value of [1,2,3,4])total=(total*33+value)%1000003;return total},
 nestedLoops(){let total=0;for(let row=0;row<gridSize;row++)for(let column=0;column<gridSize;column++)total=(total*33+1)%1000003;return total},
 primeCount(){let count=0;for(let value=2;value<=1000;value++){let prime=true;for(let divisor=2;divisor*divisor<=value;divisor++)if(value%divisor===0){prime=false;break}if(prime)count++}return count},
 recursiveCalls(){return recursiveFibonacci(20)},
 enumConstructionMatching(){let total=0,value=0;for(let i=0;i<unit;i++){value=(value*33+1)%1000003;const event={tag:2,value};if(event.tag===2&&event.value%2===0)total++;}return total},
 optionalMatch(){const next=value=>(value*33+1)%1000003,unwrap=item=>item.present?item.value:0,step=value=>{const candidate=next(value);return (candidate+unwrap({present:true,value:candidate}))%1000003};let total=0;for(let i=0;i<unit;i++)total=step(total);return total},
 resultMatch(){const next=value=>(value*33+1)%1000003,unwrap=item=>item.ok?item.value:item.error,step=value=>{const candidate=next(value);return (candidate+unwrap({ok:true,value:candidate,error:0}))%1000003};let total=0;for(let i=0;i<unit;i++)total=step(total);return total},
 branchMutation(){const step=value=>{let changed=value;if(changed%2===0)changed=Math.floor(changed/2)+3;else changed=(changed*33+1)%1000003;return changed};let total=0;for(let i=0;i<unit;i++)total=step(total);return total},
 recordAccess(){const read=point=>point.x+point.y,step=value=>read({x:(value*33+1)%1000003,y:1});let total=0;for(let i=0;i<unit;i++)total=step(total);return total},
 filterTextList(){const lines=['ERROR disk','INFO ready','ERROR timeout','WARN low'],retained=[];let total=0;for(let i=0;i<unit;i++){const filtered=lines.filter(line=>line.includes('ERROR'));retained.push(filtered);total+=filtered.length;}return total},
 foldTextList(){const lines=['ERROR disk','INFO ready','ERROR timeout','WARN low'];let total=0;for(let i=0;i<unit;i++)total+=lines.reduce((count,line)=>count+(line.includes('ERROR')?1:0),0);return total},
 textConcat(){const parts='BMEC native'.split(' ');let total=0;for(let i=0;i<unit;i++){let joined='';for(const part of parts){if(joined==='')joined=part;else joined=joined+' '+part}if(joined==='BMEC native')total++}return total},
 mapTextList(){const lines='ERROR disk\nINFO ready\nERROR timeout\nWARN low'.split('\n'),retained=[];let total=0;for(let i=0;i<unit;i++){const mapped=lines.map(line=>line+'!');retained.push(mapped);total+=mapped.length}return total},
 collatzSteps(initial=837799){let value=initial,steps=0;while(value>1){value=value%2===0?value/2:value*3+1;steps++}return steps},
 jsonEncode(){let total=0;for(let i=0;i<unit;i++)total=(total+JSON.stringify({version:1,kind:'integer',value:String(total)}).length)%1000003;return total},
 base64Encode(){let total=0;for(let i=0;i<unit;i++)if(Buffer.from(base64Payload,'utf8').toString('base64')===base64Encoded)total++;return total},
 base64Decode(){let total=0;for(let i=0;i<unit;i++)if(Buffer.from(base64Encoded,'base64').toString('utf8')===base64Payload)total++;return total},
 filesystemRead(){return readFileSync(fixturePath,'utf8').length},
};
function nativeBatchSource(ir,workFunction='main',takesInput=false,fuseEntryGuards=false){
 const entry=ir.functions.find(fn=>fn.name===workFunction);if(!entry)throw new Error('Native benchmark function not found');
 const name=`bmec_fn_${[...new TextEncoder().encode(String(entry.id))].map(byte=>byte.toString(16).padStart(2,'0')).join('')}`;
 let c='#define _POSIX_C_SOURCE 200809L\n'+lowerNativeC(ir).replace('#include <stdlib.h>','#include <stdlib.h>\n#if defined(_WIN32)\n#include <windows.h>\n#else\n#include <time.h>\n#endif\nstatic double bmec_benchmark_now(void) {\n#if defined(_WIN32)\n  static LARGE_INTEGER frequency; LARGE_INTEGER counter; if (!frequency.QuadPart) QueryPerformanceFrequency(&frequency); QueryPerformanceCounter(&counter); return (double)counter.QuadPart / (double)frequency.QuadPart;\n#else\n  struct timespec value; if (clock_gettime(CLOCK_MONOTONIC, &value) != 0) return 0.0; return (double)value.tv_sec + (double)value.tv_nsec / 1000000000.0;\n#endif\n}');
 if(workFunction!=='recursiveCalls')c=c.replaceAll('> 100000','> INT64_C(5000000)');
 if(fuseEntryGuards){const stepLimit=workFunction==='recursiveCalls'?'100000':'INT64_C(5000000)';const before=c;c=c.replace(new RegExp(`if \\(bmec_depth >= 128\\) bmec_fail\\("PIPE-RUNTIME-006: Maximum call depth exceeded"\\);\\s*if \\(\\+\\+bmec_steps > ${stepLimit==='100000'?'100000':'INT64_C\\(5000000\\)'}\\) bmec_fail\\("PIPE-RUNTIME-006: Maximum execution steps exceeded"\\);\\s*\\+\\+bmec_depth;`,'g'),`bool bmec_depth_failed = bmec_depth >= 128; bool bmec_steps_failed = ++bmec_steps > ${stepLimit}; if (bmec_depth_failed | bmec_steps_failed) bmec_fail(bmec_depth_failed ? "PIPE-RUNTIME-006: Maximum call depth exceeded" : "PIPE-RUNTIME-006: Maximum execution steps exceeded"); ++bmec_depth;`);if(c===before)throw new Error('Could not fuse native function-entry guards')}
 c=c.replace(/int main\(void\) \{[\s\S]*?\n\}\n$/,`int main(int argc, char **argv) {\n  if (argc != ${takesInput?3:2}) return 2;\n  int64_t runs = strtoll(argv[1], NULL, 10);\n  if (runs < 1) return 2;\n  ${takesInput?'int64_t input = strtoll(argv[2], NULL, 10);':''}\n  ${entry.returnTypeRef.kind==='primitive'&&entry.returnTypeRef.name==='integer'?'int64_t result = 0;':entry.returnTypeRef.kind==='primitive'&&entry.returnTypeRef.name==='number'?'double result = 0.0;':'bool result = false;'}\n  double start = bmec_benchmark_now();\n  for (int64_t i = 0; i < runs; ++i) { bmec_steps = 0; bmec_depth = 0; result = ${name}(${takesInput?'input':''}); bmec_arena_release(); }\n  double elapsed = bmec_benchmark_now() - start;\n  ${entry.returnTypeRef.kind==='primitive'&&entry.returnTypeRef.name==='integer'?'printf("%" PRId64 " %.9f\\n", result, elapsed);':entry.returnTypeRef.kind==='primitive'&&entry.returnTypeRef.name==='number'?'printf("%.17g %.9f\\n", result, elapsed);': 'printf("%s %.9f\\n", result ? "true" : "false", elapsed);'}\n  return 0;\n}\n`);
 return c;
}
function measureNative(ir,name,expected,operations,runtimeArgs=[],fuseEntryGuards=false){
 const cPath=join(fixtureRoot,`${name}.native.c`),exe=join(fixtureRoot,process.platform==='win32'?`${name}.native.exe`:`${name}.native`);
 const generatedC=nativeBatchSource(ir,name==='collatzSteps'?'collatzSteps':'main',runtimeArgs.length>0,fuseEntryGuards);
 if(process.env.BMEC_COMPARISON_NATIVE_C_OUTPUT)writeFileSync(resolve(process.env.BMEC_COMPARISON_NATIVE_C_OUTPUT),generatedC,'utf8');
 writeFileSync(cPath,generatedC,'utf8');
 try { compileNativeSource(nativeCompiler,cPath,exe,'c'); }
 catch(error) { throw new Error(`Native ${name} build failed: ${error instanceof Error?error.message:String(error)}`); }
 const invoke=runs=>{const out=execFileSync(exe,[String(runs),...runtimeArgs.map(String)],{cwd:root,encoding:'utf8',windowsHide:true}).trim().split(/\s+/);if(out[0]!==expected)throw new Error(`Native ${name} checksum mismatch: expected ${expected}, got ${out[0]}`);return Number(out[1])*1000;};
 const startup=[];for(let i=0;i<5;i++){const start=performance.now();invoke(1);startup.push(performance.now()-start);}
 let runs=1,elapsed=0;while(true){elapsed=invoke(runs);if(elapsed>=targetMs||runs===maximumRuns)break;runs=Math.min(runs*2,maximumRuns);}if(elapsed<targetMs)throw new Error(`Native ${name} could not reach the ${targetMs} ms sample target (last sample ${elapsed.toFixed(3)} ms)`);
 const times=[];for(let s=0;s<samples;s++)times.push(invoke(runs));
 return {...summarize(times),runsPerSample:runs,operationsPerSample:runs*operations,nsPerOperation:Number((percentile([...times].sort((a,b)=>a-b),.5)*1e6/(runs*operations)).toFixed(3)),checksum:expected,processStartupMedianMs:Number(percentile([...startup].sort((a,b)=>a-b),.5).toFixed(3)),timing:'monotonic wall time measured inside one process over repeated selected-function invocations; counters reset per invocation',compiler:nativeCompiler.version,flags:nativeCompiler.kind==='msvc'?'/O2 /std:c11':process.platform==='win32'?'-O3 -std=c11':'-O3 -std=c11 -lm'};
}
const percentile=(values,p)=>values[Math.min(values.length-1,Math.floor(values.length*p))];
const summarize=(values)=>{const sorted=[...values].sort((a,b)=>a-b),mean=values.reduce((a,b)=>a+b,0)/values.length;const variance=values.reduce((a,b)=>a+(b-mean)**2,0)/values.length;return {samples:values.length,warmup:2,targetSampleMs:targetMs,minMs:sorted[0],medianMs:percentile(sorted,.5),p95Ms:percentile(sorted,.95),maxMs:sorted.at(-1),coefficientOfVariation:Number((Math.sqrt(variance)/mean).toFixed(4))};};
function digest(value,name){if(name==='filesystemRead')return value instanceof ResultValue&&value.state==='ok'?String(value.payload.length):typeof value==='number'?String(value):'error';return String(value);}
function measure(fn,name,operations,runtimeArgs=[]){const work=()=>fn(...runtimeArgs);for(let i=0;i<2;i++)work();let runs=1,elapsed=0;while(true){const start=performance.now();for(let i=0;i<runs;i++)work();elapsed=performance.now()-start;if(elapsed>=targetMs||runs===maximumRuns)break;runs=Math.min(runs*2,maximumRuns);}if(elapsed<targetMs)throw new Error(`${name} could not reach the ${targetMs} ms sample target (last sample ${elapsed.toFixed(3)} ms)`);const check=digest(work(),name),times=[];for(let s=0;s<samples;s++){const start=performance.now();for(let i=0;i<runs;i++){if(digest(work(),name)!==check)throw new Error(`${name} returned an unstable result`)}times.push(performance.now()-start);}return {...summarize(times),runsPerSample:runs,operationsPerSample:runs*operations,nsPerOperation:Number((percentile([...times].sort((a,b)=>a-b),.5)*1e6/(runs*operations)).toFixed(3)),checksum:check};}
const fixtureRoot=mkdtempSync(join(tmpdir(),'bmec-comparison-'));const fixturePath=join(fixtureRoot,'fixture.txt');writeFileSync(fixturePath,'BMEC filesystem benchmark');const textScanPath=join(fixtureRoot,'text-scan.log');writeFileSync(textScanPath,textScanText);
const haystackPath=join(fixtureRoot,'haystack.txt'),needlePath=join(fixtureRoot,'needle.txt');writeFileSync(haystackPath,benchmarkHaystack);writeFileSync(needlePath,benchmarkNeedle);
const args={stringSearch:[readFileSync(haystackPath,'utf8'),readFileSync(needlePath,'utf8')]};
const result={version:10,benchmarkRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),methodology:{clock:'monotonic wall time: performance.now for reference/Node/Go, steady_clock for C++, QueryPerformanceCounter for Windows native C, and CLOCK_MONOTONIC for Linux native C',samples,warmup:2,targetSampleMs:targetMs,selectedWorkloads:onlyWorkloads??'all',operationsPerInvocation:ops,checksums:'returned value verified for every implementation; native batch result verified'},datasets:{textScan:{lineCount:textScanLines.length,utf8Bytes:Buffer.byteLength(textScanText),matchingLines:textScanLines.filter(line=>line.includes(' ERROR ')).length,matchPattern:' ERROR ',description:'deterministic timestamped service log rows'}},machine:{platform:`${process.platform} ${process.arch}`,cpu:cpus()[0]?.model??'unknown'},node:{version:process.version},workloads:{}};
try {
 for(const name of onlyWorkloads??Object.keys(source)){
  if(!Object.hasOwn(source,name))throw new Error(`Unknown BMEC_COMPARISON_ONLY workload: ${name}`);
  const compiled=compile(source[name]);if(compiled.diagnostics.length)throw new Error(`${name}: ${JSON.stringify(compiled.diagnostics)}`);
  const workloadFunction=name==='collatzSteps'?'collatzSteps':'main';
  const runtimeArgs=name==='filesystemRead'?[issueCapability('filesystem')]:name==='collatzSteps'?[837799]:[];
  const runtimeOptions={maxSteps:name==='recursiveCalls'?100_000:5_000_000,...(name==='filesystemRead'?{filesystemRoot:fixtureRoot}:{})};
  const ref=()=>executeValue(compiled.ir.functions,workloadFunction,runtimeArgs,runtimeOptions);
  const refMeasure=measure(ref,name,ops[name],runtimeArgs);
  const nodeMeasure=measure(node[name],name,ops[name],runtimeArgs);
  const refChecksum=refMeasure.checksum,nodeChecksum=nodeMeasure.checksum;
  if(refChecksum!==nodeChecksum)throw new Error(`${name} checksum mismatch: BMEC=${refChecksum}, Node=${nodeChecksum}`);
  result.workloads[name]={operationsPerInvocation:ops[name],bmecReference:refMeasure,node:nodeMeasure,validatedChecksum:refChecksum};
  if(name==='integerLoop'||name==='functionCalls'||name==='numberLoop'||name==='stringSearch'||name==='textScan'||name==='listIteration'||name==='nestedLoops'||name==='primeCount'||name==='recursiveCalls'||name==='enumConstructionMatching'||name==='optionalMatch'||name==='resultMatch'||name==='branchMutation'||name==='recordAccess'||name==='filterTextList'||name==='foldTextList'||name==='textConcat'||name==='mapTextList'||name==='collatzSteps'||name==='base64Encode'||name==='base64Decode')result.workloads[name].bmecNative=measureNative(compiled.ir,name,refChecksum,ops[name],runtimeArgs);
  if(name==='recursiveCalls')result.workloads[name].bmecNativeFusedEntryGuards=measureNative(compiled.ir,name,refChecksum,ops[name],runtimeArgs,true);
 }
} catch(error) { rmSync(fixtureRoot,{recursive:true,force:true}); throw error; }
let cppCompiler;
if(process.platform==='win32')cppCompiler=nativeCompiler;
else try { cppCompiler={path:'g++',version:execFileSync('g++',['--version'],{cwd:root,encoding:'utf8'}).split('\n')[0],kind:'gnu'}; }
catch { result.cpp={unavailable:'g++ is not installed'}; }
if(cppCompiler){
 const cppExe=join(fixtureRoot,process.platform==='win32'?'bmec-comparison-cpp.exe':'bmec-comparison-cpp');
 compileNativeSource(cppCompiler,resolve(root,'scripts/comparison-benchmark-extended.cpp'),cppExe,'c++');
 const native=JSON.parse(execFileSync(cppExe,[args.stringSearch[0],args.stringSearch[1],fixturePath,String(samples),String(targetMs),base64Encoded,base64Payload,'837799',onlyWorkloads?.length===1?onlyWorkloads[0]:'',textScanPath],{cwd:root,encoding:'utf8',windowsHide:true}));
 result.cpp={compiler:cppCompiler.version,flags:cppCompiler.kind==='msvc'?'/O2 /std:c++17':'-O3 -std=c++17',platform:`${process.platform} ${process.arch}`,workloads:native.workloads};
 for(const [name,data] of Object.entries(result.workloads)){const checksum=native.workloads[name]?.checksum;if(String(checksum)!==data.validatedChecksum)throw new Error(`${name} checksum mismatch: BMEC=${data.validatedChecksum}, C++=${checksum}`);data.cpp={...native.workloads[name],nsPerOperation:Number((native.workloads[name].medianMs*1e6/native.workloads[name].operationsPerSample).toFixed(3))};}
 if(result.workloads.foldTextList)result.workloads.foldTextList.cpp.semantics='Matches the 5000000 benchmark statement-step cap and 128 callback call-depth limit; the current 25000-repeat fixture consumes exactly 325005 steps in the BMEC reference.';
 if(result.workloads.collatzSteps)result.workloads.collatzSteps.cpp.semantics='Matches the 5000000 benchmark statement-step cap and 128 call-depth limit, with checked signed-int64 multiplication/addition; the current 837799 trajectory consumes exactly 1577 steps in the BMEC reference.';
 if(result.workloads.recursiveCalls){const guardedCpp=native.workloads.recursiveCallsWithBmecLimits;if(String(guardedCpp?.checksum)!==result.workloads.recursiveCalls.validatedChecksum)throw new Error('Recursive C++ BMEC-limit comparison checksum mismatch');result.workloads.recursiveCalls.cppWithBmecRuntimeLimits={...guardedCpp,nsPerOperation:Number((guardedCpp.medianMs*1e6/guardedCpp.operationsPerSample).toFixed(3)),semantics:'same 128 call-depth and 100000 execution-step bounds as BMEC'};}
}
let goAvailable=false;
try { execFileSync('go',['version'],{cwd:root,encoding:'utf8'}); goAvailable=true; }
catch { result.go={unavailable:'Go is not installed'}; }
if(goAvailable){const go=JSON.parse(execFileSync('go',['run','scripts/comparison-benchmark-extended.go',args.stringSearch[0],args.stringSearch[1],fixturePath,String(samples),String(targetMs),base64Encoded,base64Payload,'837799',textScanPath],{cwd:root,encoding:'utf8'}));result.go=go;for(const [name,data] of Object.entries(result.workloads)){const item=go.workloads?.[name];if(String(item?.checksum)!==data.validatedChecksum)throw new Error(`${name} checksum mismatch: BMEC=${data.validatedChecksum}, Go=${item?.checksum}`);data.go={...item,nsPerOperation:Number((item.medianMs*1e6/item.operationsPerSample).toFixed(3))};}}
rmSync(fixtureRoot,{recursive:true,force:true});
const output=JSON.stringify(result,null,2);
if(process.env.BMEC_COMPARISON_OUTPUT)writeFileSync(resolve(process.env.BMEC_COMPARISON_OUTPUT),`${output}\n`,'utf8');
console.log(output);
