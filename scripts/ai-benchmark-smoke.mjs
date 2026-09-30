import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url))),scratch=mkdtempSync(join(tmpdir(),'bmec-ai-benchmark-check-')),cli=join(root,'dist','cli','index.js'),runner=join(root,'scripts','ai-benchmark.mjs');
const run=(script,args)=>spawnSync(process.execPath,[script,...args],{cwd:root,encoding:'utf8',windowsHide:true});
const write=(path,source)=>writeFileSync(path,source);
const trial=join(scratch,'valid-trial');
try{
  let result=run(runner,['prepare',trial]);if(result.status!==0)throw new Error(result.stderr||result.stdout);
  const cliProject=join(trial,'small-cli','greeting-cli');
  execFileSync(process.execPath,[cli,'new',cliProject],{cwd:root,stdio:'ignore'});
  write(join(trial,'hello-world','main.bmec'),'app HelloWorld\nfunction greeting() -> text { return "Hello, world!" }\n');
  write(join(cliProject,'main.bmec'),`${readFileSync(join(cliProject,'main.bmec'),'utf8')}\nfunction greet(name text) -> text { return "Hello, " + name + "!" }\n`);
  write(join(trial,'todo-database','main.bmec'),'app Todo\nmodel Task { title text required done boolean default false }\napi /tasks from Task\npage Home { crud Task }\n');
  write(join(trial,'notes-api','main.bmec'),'app Notes\nmodel Note { title text required body text? }\napi /notes from Note\npage Home { crud Note }\n');
  const exampleCatalog=JSON.parse(readFileSync(join(root,'ai','examples.json'),'utf8'));
  write(join(trial,'support-dashboard','main.bmec'),exampleCatalog.examples.find(example=>example.name==='controlled-english-dashboard').source);
  write(join(trial,'booking-business-app','main.bmec'),[
    'app BookingDesk',
    'model Customer { name text required email text required }',
    'model Appointment { customer Customer required date date required }',
    'api /appointments from Appointment',
    'component AppointmentForm form { input customer text label "Customer" validate nonempty input date text label "Date" validate nonempty button "Book" on SaveAppointment }',
    'page Dashboard { crud Appointment }',
    'style named ScheduleStyle { layout is grid columns is 2 gap is 16 on small screens { columns is 1 } }',
    'test "appointment model is ready" { expect(1).toEqual(1) }',
    ''
  ].join('\n'));
  for(const [task,type] of [['hello-world','task-start'],['hello-world','check-attempt'],['hello-world','invalid-syntax-attempt'],['hello-world','repair-iteration'],['hello-world','missing-discovery-failure'],['hello-world','test-attempt'],['hello-world','test-success'],['hello-world','manual-intervention'],['hello-world','task-finish']]){
    result=run(runner,['record',trial,task,type,'synthetic smoke event']);if(result.status!==0)throw new Error(result.stderr||result.stdout);
  }
  result=run(runner,['score',trial,'--elapsed-seconds','900','--steps','50']);
  if(result.status!==0)throw new Error(result.stderr||result.stdout);
  const report=JSON.parse(result.stdout);
  if(report.passed!==6||report.total!==6||report.metrics.requiredTestRuns!==2||report.metrics.requiredTestPasses!==2||report.metrics.invalidSyntaxAttempts!==1||report.metricsByTask['hello-world']['manual-intervention']!==1||report.taskElapsedSeconds['hello-world']===null)throw new Error('Synthetic complete trial did not produce the expected pass and telemetry metrics');
  const booking=join(trial,'booking-business-app','main.bmec');
  write(booking,readFileSync(booking,'utf8').replace('test "appointment model is ready" { expect(1).toEqual(1) }\n',''));
  result=run(runner,['score',trial,'--elapsed-seconds','900','--steps','50']);
  if(result.status===0)throw new Error('Scorer accepted a booking project without the required test');
  const negative=JSON.parse(readFileSync(join(trial,'score.json'),'utf8'));
  if(negative.passed!==5||negative.results.find(item=>item.id==='booking-business-app').passed||negative.metrics.requiredTestPasses!==1)throw new Error('Negative trial was not rejected for the missing BMEC test');
  console.log('AI_BENCHMARK_HARNESS PASS — six task tiers score; required BMEC test enforced; event metrics reported; negative case rejected');
}finally{
  const resolvedScratch=resolve(scratch),tempRoot=resolve(tmpdir());
  if(!resolvedScratch.startsWith(`${tempRoot}${sep}`))throw new Error('Refusing to remove benchmark scratch outside the temporary directory');
  rmSync(resolvedScratch,{recursive:true,force:true});
}
