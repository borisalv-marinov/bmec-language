import {describe,expect,it} from 'vitest';
import {compile} from '../src/compiler.js';
import {validateSerializedIR} from '../src/ir/validate.js';

describe('Job Booking Manager query surface',()=>{
  it('accepts typed variables in controlled-English filtered reads',()=>{
    const result=compile(`app Jobs
model Job { workerId integer required status text required scheduledDate date required }
async function listAssignedJobs(db capability < database >,workerId integer) -> task < list < Job > > {
  return wait for get jobs from Job where workerId is workerId ordered by scheduledDate ascending limited to 100 using db
}
http GET /worker-jobs/:workerId requires role worker, database -> listAssignedJobs
`,'job-booking-query.bmec');
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.http?.routes[0]).toMatchObject({path:'/worker-jobs/:workerId',policyId:'role:worker',capabilities:['database'],pathParams:[{name:'workerId'}]});
  });

  it('binds the worker list to the server Principal and a persisted team member',()=>{
    const result=compile(`app Jobs
type Principal { id text role text }
model User { authId text required unique }
model Job { worker User required scheduledDate date required }
async function listAssignedJobs(principal Principal,db capability < database >) -> task < list < Job > > {
  let authId = principal.id
  let users = wait for get users from User where authId is authId ordered by id ascending limited to 1 using db
  let noJobs list < Job > = []
  return match first(users) {
    some(assignedWorker) => wait for get jobs from Job where worker is assignedWorker ordered by scheduledDate ascending limited to 100 using db,
    none => noJobs
  }
}
serve GET / worker-jobs requiring role worker and database with listAssignedJobs
`,'job-booking-principal-query.bmec');
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.http?.routes[0]).toMatchObject({path:'/worker-jobs',policyId:'role:worker',capabilities:['database'],pathParams:[]});
    expect(result.ir?.functions.find(fn=>fn.name==='listAssignedJobs')?.parameters.map(parameter=>parameter.name)).toContain('principal');
    expect(validateSerializedIR(JSON.parse(JSON.stringify(result.ir))).valid).toBe(true);
  });
});
