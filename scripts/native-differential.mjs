#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {compileFile} from '../dist/compiler.js';
import {executeValue} from '../dist/core/interpreter.js';
import {buildNative} from '../dist/native/build.js';
import {PipeRuntimeError} from '../dist/core/interpreter.js';
import {injectFixtureWireLiterals} from './native-fixture-wire.mjs';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const fixtures=[
 {file:'minimal.bmec',expected:'0'},
 {file:'boolean.bmec',expected:'true'},
 {file:'list-iteration.bmec',expected:'10'},
 {file:'empty-list.bmec',expected:'42'},
 {file:'record-fields.bmec',expected:'17'},
 {file:'record-call.bmec',expected:'25'},
 {file:'nested-record-values.bmec',expected:'true'},
 {file:'optional-integer.bmec',expected:'12'},
 {file:'optional-number.bmec',expected:'1.5',numeric:true},
 {file:'optional-record.bmec',expected:'12'},
 {file:'result-success.bmec',expected:'4'},
 {file:'result-error.bmec',expected:'7'},
 {file:'result-record-ok.bmec',expected:'19'},
 {file:'result-record-error.bmec',expected:'23'},
 {file:'match-optional-result.bmec',expected:'20'},
 {file:'match-optional-result-lazy.bmec',expected:'18'},
 {file:'enum-scalars.bmec',expected:'true'},
 {file:'match-int64-boundaries.bmec',expected:'1'},
 {file:'result-asymmetric-payloads.bmec',expected:'38'},
 {file:'text-literals-search.bmec',expected:'1'},
 {file:'text-length.bmec',expected:'true'},
 {file:'text-index-of.bmec',expected:'true'},
 {file:'text-prefix-suffix.bmec',expected:'true'},
 {file:'text-substring.bmec',expected:'true'},
 {file:'text-substring-negative.bmec',error:'PIPE-RUNTIME-002'},
 {file:'text-substring-reversed.bmec',error:'PIPE-RUNTIME-002'},
 {file:'text-concat.bmec',expected:'true'},
 {file:'text-map-lambda.bmec',expected:'true'},
 {file:'primitive-map-cross-type.bmec',expected:'true'},
 {file:'text-split-join.bmec',expected:'1'},
 {file:'text-split-empty-separator.bmec',expected:'1'},
 {file:'text-split-allocation-error.bmec',expected:'1'},
 {file:'text-split-runtime-error.bmec',error:'PIPE-RUNTIME-003'},
 {file:'text-filter-lambda.bmec',expected:'2'},
 {file:'text-fold-lambda.bmec',expected:'2'},
 {file:'text-fold-empty.bmec',expected:'42'},
 {file:'text-sort.bmec',expected:'true'},
 {file:'json-encode-primitives.bmec',expected:'true'},
 {file:'json-encode-lists.bmec',expected:'true'},
 {file:'json-encode-record.bmec',expected:'true'},
 {file:'json-encode-record-optional.bmec',expected:'true'},
 {file:'json-encode-numbers.bmec',expected:'true'},
 {file:'numeric-sort.bmec',expected:'true'},
 {file:'json-decode-primitives.bmec',expected:'true'},
 {file:'json-decode-optional.bmec',expected:'true'},
 {file:'json-decode-result.bmec',expected:'true'},
 {file:'json-decode-text-list.bmec',expected:'true',recordWireFunctions:{'__BMEC_LONG_TEXT_LIST__':'longWire'}},
 {file:'json-decode-primitive-list.bmec',expected:'true'},
 {file:'json-decode-record-integer-list.bmec',expected:'true',recordWireFunctions:{'__BMEC_RECORD_LIST_WIRE__':'sampleWire','__BMEC_NONCANONICAL_RECORD_LIST_WIRE__':'nonCanonicalWire'}},
 {file:'json-decode-record-mixed-scalar-list.bmec',expected:'true',recordWireFunctions:{'__BMEC_MIXED_RECORD_WIRE__':'sampleWire','__BMEC_NONCANONICAL_MIXED_RECORD_WIRE__':'nonCanonicalWire','__BMEC_ESCAPED_TEXT_WIRE__':'escapedTextWire'}},
 {file:'json-decode-record.bmec',expected:'true',recordWireFunctions:{'__BMEC_PAYLOAD_WIRE__':'payloadWire','__BMEC_OTHER_WIRE__':'otherWire','__BMEC_ABSENT_SCORE_WIRE__':'absentScoreWire','__BMEC_NONCANONICAL_LIST_WIRE__':'nonCanonicalPayloadWire'}},
 {file:'base64-encode.bmec',expected:'true'},
 {file:'base64-decode.bmec',expected:'true'},
 {file:'number-arithmetic.bmec',expected:'3',numeric:true},
 {file:'number-constant-fold.bmec',expected:'1853.75',numeric:true},
 {file:'number-division-by-zero.bmec',error:'PIPE-RUNTIME-003'},
 {file:'number-overflow.bmec',error:'PIPE-RUNTIME-005'},
 {file:'checked-mul3-add1-boundaries.bmec',expected:'true'},
 {file:'checked-mod2-parity.bmec',expected:'true'},
 {file:'money-exact-arithmetic.bmec',expected:'42'},
 {file:'money-json-encode.bmec',expected:'true'},
 {file:'json-encode-record-money.bmec',expected:'true'},
 {file:'json-encode-record-money-overflow.bmec',error:'PIPE-CONTRACT-001'},
 {file:'money-json-encode-overflow-positive.bmec',error:'PIPE-CONTRACT-001'},
 {file:'money-json-encode-overflow-negative.bmec',error:'PIPE-CONTRACT-001'},
 {file:'money-division-by-zero.bmec',error:'PIPE-RUNTIME-003'},
 {file:'checked-mul3-add1-overflow-low.bmec',error:'PIPE-RUNTIME-004'},
 {file:'checked-mul3-add1-overflow-high.bmec',error:'PIPE-RUNTIME-004'},
 {file:'overflow.bmec',error:'PIPE-RUNTIME-004'},
 {file:'integer-multiply-overflow-positive.bmec',error:'PIPE-RUNTIME-004'},
 {file:'integer-multiply-overflow-negative.bmec',error:'PIPE-RUNTIME-004'},
 {file:'division-by-zero.bmec',error:'PIPE-RUNTIME-003'},
 {file:'recursion-depth.bmec',error:'PIPE-RUNTIME-006'},
 {file:'step-limit-safe-if.bmec',error:'PIPE-RUNTIME-006'},
 {file:'step-limit-textcontains.bmec',error:'PIPE-RUNTIME-006'},
];
const work=mkdtempSync(join(tmpdir(),'bmec-native-diff-'));
const results=[];
try {
 for(const fixture of fixtures){
  const sourcePath=join(root,'tests','native','fixtures',fixture.file);
  const compiled=compileFile(sourcePath);
  if(compiled.diagnostics.length)throw new Error(`${fixture.file}: ${compiled.diagnostics.map(item=>item.message).join('; ')}`);
  injectFixtureWireLiterals(compiled.ir,fixture.recordWireFunctions,executeValue);
  const outputDirectory=join(work,fixture.file.replace(/\.bmec$/,''));
  const built=buildNative(compiled.ir,{outputDirectory});
  let expected,referenceError;
  try { expected=String(executeValue(compiled.ir.functions,'main',[])); }
  catch(error){const code=/PIPE-[A-Z0-9-]+/.exec(error instanceof Error?error.message:String(error))?.[0];if(error instanceof PipeRuntimeError||code)referenceError=error instanceof PipeRuntimeError?error.code:code;else throw error;}
  const native=spawnSync(built.executable,[],{encoding:'utf8',windowsHide:true});
  if(native.error)throw native.error;
  const nativeOutput=native.stdout.trim();
  const nativeError=/PIPE-[A-Z0-9-]+/.exec(native.stderr)?.[0];
  const passed=fixture.error
    ? referenceError===fixture.error&&nativeError===fixture.error&&native.status===70
    : fixture.numeric
      ? referenceError===undefined&&native.status===0&&Number.isFinite(Number(nativeOutput))&&Number(nativeOutput)===Number(expected)
    : expected===fixture.expected&&native.status===0&&nativeOutput===fixture.expected;
  results.push({fixture:fixture.file,expected:fixture.expected??fixture.error,reference:referenceError??expected,native:nativeError??nativeOutput,nativeExitCode:native.status,compiler:built.compiler,compilerVersion:built.compilerVersion,flags:built.flags,passed});
  if(!passed)throw new Error(`${fixture.file}: differential mismatch ${JSON.stringify(results.at(-1))}`);
 }
} finally {rmSync(work,{recursive:true,force:true});}
const output={version:1,revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),platform:`${process.platform} ${process.arch}`,cases:results.length,passed:results.length,results};
const destination=process.env.BMEC_NATIVE_DIFF_OUTPUT;
if(destination)writeFileSync(resolve(destination),`${JSON.stringify(output,null,2)}\n`,'utf8');
console.log(JSON.stringify(output,null,2));
