import {execFileSync,spawnSync} from 'node:child_process';
import {appendFileSync,mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url))),cli=resolve(process.env.BMEC_BENCH_CLI||join(root,'dist','cli','index.js')),tasks=JSON.parse(readFileSync(join(root,'benchmarks','ai','tasks.json'),'utf8'));
const [command,target,...flags]=process.argv.slice(2);
const arg=(name,fallback)=>{const i=flags.indexOf(name);return i<0?fallback:flags[i+1];};
const run=(args,cwd)=>spawnSync(process.execPath,[cli,...args],{cwd,encoding:'utf8',windowsHide:true});
const save=(path,value)=>writeFileSync(path,`${JSON.stringify(value,null,2)}\n`);

if(command==='prepare'){
  if(!target)throw new Error('Usage: node scripts/ai-benchmark.mjs prepare TRIAL_DIRECTORY');
  const trial=resolve(target);if(existsSync(trial))throw new Error(`Trial directory already exists: ${trial}`);
  mkdirSync(trial,{recursive:true});
  const context=join(trial,'context');mkdirSync(context,{recursive:true});
  for(const file of ['GETTING_STARTED.md','AI_AGENT_GUIDE.md'])writeFileSync(join(context,file),readFileSync(join(root,'docs',file)));
  for(const file of ['ai-spec.md','commands.json','diagnostics.json','examples.json'])writeFileSync(join(context,file),readFileSync(join(root,'ai',file)));
  for(const task of tasks.tasks){const folder=join(trial,task.id);mkdirSync(folder);writeFileSync(join(folder,'TASK.md'),`# ${task.title}\n\n${task.prompt}\n`);const apps={'hello-world':'HelloWorld','todo-database':'Todo','notes-api':'Notes','support-dashboard':'SupportDesk','booking-business-app':'BookingDesk'};if(apps[task.id])writeFileSync(join(folder,'main.bmec'),`app ${apps[task.id]}\n`);}
  const packageVersion=process.env.BMEC_BENCH_VERSION||JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
  save(join(trial,'trial.json'),{schemaVersion:tasks.schemaVersion,trialId:trial.split(/[\\/]/).at(-1),preparedAt:new Date().toISOString(),packageVersion,cliEntrypoint:process.env.BMEC_BENCH_CLI?'configured package entrypoint':'workspace build',provenance:{agent:null,model:null,modelVersion:null,systemPrompt:null,toolSetup:null},tasks:tasks.tasks.map(({id,tier,title})=>({id,tier,title}))});
  console.log(JSON.stringify({ok:true,trial,tasks:tasks.tasks.length,context:'public docs and machine catalogs only'},null,2));
}else if(command==='record'){
  const trial=target,taskId=flags[0],type=flags[1],detail=flags.slice(2).join(' ');
  const types=['task-start','task-finish','check-attempt','invalid-syntax-attempt','repair-iteration','missing-discovery-failure','test-attempt','test-success','manual-intervention'];
  if(!trial||!tasks.tasks.some(task=>task.id===taskId)||!types.includes(type)||!existsSync(join(trial,'trial.json')))throw new Error(`Usage: node scripts/ai-benchmark.mjs record TRIAL_DIRECTORY TASK_ID ${types.join('|')} [detail]`);
  appendFileSync(join(trial,'events.jsonl'),`${JSON.stringify({timestamp:new Date().toISOString(),taskId,type,detail})}\n`);
  console.log(JSON.stringify({ok:true,taskId,type}));
}else if(command==='score'){
  if(!target)throw new Error('Usage: node scripts/ai-benchmark.mjs score TRIAL_DIRECTORY --elapsed-seconds N --steps N');
  const trial=resolve(target),elapsedSeconds=Number(arg('--elapsed-seconds',NaN)),steps=Number(arg('--steps',NaN));
  if(!existsSync(join(trial,'trial.json'))||!Number.isFinite(elapsedSeconds)||!Number.isFinite(steps)||elapsedSeconds<0||steps<0)throw new Error('Provide a prepared trial and non-negative --elapsed-seconds and --steps values');
  const results=[];let requiredTestAttempts=0,requiredTestPasses=0;
  const checkProject=(cwd,file='main.bmec')=>{const check=run(['check',file,'--json'],cwd);if(check.status!==0)return {ok:false,reason:'bmec check failed',output:check.stderr||check.stdout};const result=run(['project',file,'--json'],cwd);try{return {ok:result.status===0,project:JSON.parse(result.stdout),reason:result.status===0?'':'bmec project failed'};}catch{return {ok:false,reason:'bmec project output was not valid JSON'};}};
  for(const task of tasks.tasks){let cwd=join(trial,task.id),passed=false,reason='';
    if(task.id==='small-cli')cwd=join(cwd,'greeting-cli');
    const verified=checkProject(cwd);passed=verified.ok;reason=verified.reason;
    if(passed&&task.id==='hello-world'){
      const result=run(['exec','main.bmec','greeting','--json'],cwd);try{passed=result.status===0&&JSON.parse(result.stdout).value==='Hello, world!';}catch{passed=false;}if(!passed)reason='greeting() did not return Hello, world!';
    }
    if(passed&&task.id==='small-cli'){
        const build=run(['build','main.bmec','--release'],cwd),result=run(['exec','main.bmec','greet','--args','["Mira"]','--json'],cwd),test=run(['test','main.bmec','--json'],cwd);requiredTestAttempts++;let testPassed=false;try{const report=JSON.parse(test.stdout);testPassed=test.status===0&&report.ok===true&&report.tests.length>0;}catch{}if(testPassed)requiredTestPasses++;try{passed=build.status===0&&result.status===0&&JSON.parse(result.stdout).value==='Hello, Mira!'&&testPassed;}catch{passed=false;}if(!passed)reason='starter project did not pass its BMEC test/build or greet(Mira) returned the wrong value';
    }
    if(passed){const p=verified.project,hasModel=name=>p.models.some(model=>model.name===name),hasApi=(route,model)=>p.apis.some(api=>api.route===route&&(!model||api.model===model)),hasPage=name=>p.pages.some(page=>page.name===name),hasComponent=name=>p.components.some(component=>component.name===name),hasStyle=name=>p.styles.some(style=>style.name===name);
      if(task.id==='todo-database')passed=hasModel('Task')&&p.models.find(model=>model.name==='Task').fields?.some(field=>field.name==='title'&&field.required)&&p.models.find(model=>model.name==='Task').fields?.some(field=>field.name==='done')&&hasApi('/tasks','Task')&&hasPage('Home');
      if(task.id==='notes-api')passed=hasModel('Note')&&hasApi('/notes','Note')&&hasPage('Home');
      if(task.id==='support-dashboard')passed=['Task','User'].every(hasModel)&&hasApi('/tasks','Task')&&hasPage('Dashboard')&&['TaskRow','TaskForm'].every(hasComponent)&&hasStyle('DashboardStyle')&&['listTasks','createTask'].every(name=>p.functions.some(fn=>fn.name===name));
      if(task.id==='booking-business-app'){
        passed=['Customer','Appointment'].every(hasModel)&&hasApi('/appointments','Appointment')&&hasPage('Dashboard')&&hasComponent('AppointmentForm')&&hasStyle('ScheduleStyle');
        const test=run(['test','main.bmec','--json'],cwd);requiredTestAttempts++;let testPassed=false;try{const result=JSON.parse(test.stdout);testPassed=test.status===0&&result.ok===true&&result.tests.length>0;}catch{}if(testPassed)requiredTestPasses++;passed=passed&&testPassed;if(!passed)reason='booking project is missing required model/API/UI facts or a passing BMEC test';
      }
      if(!passed&&!reason)reason='compiler project facts did not match the task rubric';
    }
    results.push({id:task.id,tier:task.tier,passed,reason});
  }
  const metadata=JSON.parse(readFileSync(join(trial,'trial.json'),'utf8'));
  const events=existsSync(join(trial,'events.jsonl'))?readFileSync(join(trial,'events.jsonl'),'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)):[];
  const count=type=>events.filter(event=>event.type===type).length;
  const eventTypes=['task-start','task-finish','invalid-syntax-attempt','check-attempt','repair-iteration','missing-discovery-failure','test-attempt','test-success','manual-intervention'];
  const metricsByTask=Object.fromEntries(tasks.tasks.map(task=>[task.id,Object.fromEntries(eventTypes.map(type=>[type,events.filter(event=>event.taskId===task.id&&event.type===type).length]))]));
  const taskElapsedSeconds=Object.fromEntries(tasks.tasks.map(task=>{const taskEvents=events.filter(event=>event.taskId===task.id),started=taskEvents.find(event=>event.type==='task-start'),finished=[...taskEvents].reverse().find(event=>event.type==='task-finish');return [task.id,started&&finished?Math.max(0,(Date.parse(finished.timestamp)-Date.parse(started.timestamp))/1000):null];}));
  const report={schemaVersion:tasks.schemaVersion,trialId:metadata.trialId,packageVersion:metadata.packageVersion,cliEntrypoint:metadata.cliEntrypoint,provenance:metadata.provenance,completedAt:new Date().toISOString(),elapsedSeconds,steps,taskElapsedSeconds,passed:results.filter(item=>item.passed).length,total:results.length,results,metrics:{invalidSyntaxAttempts:count('invalid-syntax-attempt'),compileCheckAttempts:count('check-attempt'),repairIterations:count('repair-iteration'),missingDiscoveryFailures:count('missing-discovery-failure'),requiredTestRuns:requiredTestAttempts,requiredTestPasses,agentReportedTestAttempts:count('test-attempt'),agentReportedTestSuccesses:count('test-success'),manualInterventions:count('manual-intervention')},metricsByTask,limitations:'Event counts, task/total elapsed time, steps, provenance, and blinding are operator-reported. Completion checks and the required test use the configured BMEC CLI; the scorer does not measure model quality or verify trial blinding.'};
  save(join(trial,'score.json'),report);console.log(JSON.stringify(report,null,2));
  if(report.passed!==report.total)process.exitCode=1;
}else throw new Error('Usage: node scripts/ai-benchmark.mjs <prepare|score> ...');
