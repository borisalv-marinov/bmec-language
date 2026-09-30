import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {compile} from '../src/compiler.ts';
import {jobWire} from '../scripts/job-booking-wire.mjs';

describe('Job Booking PostgreSQL wire fixture',()=>{
  it('matches the current Job and relationship field symbols',()=>{
    const source=readFileSync(join(process.cwd(),'examples/job-booking/main.bmec'),'utf8');
    const compiled=compile(source,'examples/job-booking/main.bmec');
    expect(compiled.diagnostics).toEqual([]);
    const ir=compiled.ir;
    expect(ir).toBeDefined();
    const job=ir.models.find(model=>model.name==='Job');
    const customer=ir.models.find(model=>model.name==='Customer');
    const user=ir.models.find(model=>model.name==='User');
    expect(job).toBeDefined();
    expect(customer).toBeDefined();
    expect(user).toBeDefined();
    const wire=jobWire('InProgress');
    expect(wire.type.symbol.endsWith(job.typeRef?.symbol.split(':').slice(-2).join(':'))).toBe(true);
    expect(wire.fields.customer.type.symbol.endsWith(customer.typeRef?.symbol.split(':').slice(-2).join(':'))).toBe(true);
    expect(wire.fields.worker.type.symbol.endsWith(user.typeRef?.symbol.split(':').slice(-2).join(':'))).toBe(true);
    expect(Object.keys(wire.fields)).toEqual(job.fields.map(field=>field.name));
    expect(wire.fields.status.value).toBe('InProgress');
  });
});
