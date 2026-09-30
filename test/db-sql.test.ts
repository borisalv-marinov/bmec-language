import {describe,expect,it} from 'vitest';
import {compileSql} from '../src/db/sql.js';
import {primitive} from '../src/types/type-ref.js';
describe('parameterized database SQL',()=>{
 it('compiles select predicates without interpolating values',()=>{const q=compileSql({kind:'select',model:'users',fields:['id','name'],where:{kind:'compare',field:'id',operator:'=',value:primitive('id')}},['abc']);expect(q.text).toBe('SELECT "id", "name" FROM "users" WHERE "id" = $1');expect(q.parameters).toEqual(['abc']);});
 it('rejects unsafe identifiers',()=>expect(()=>compileSql({kind:'delete',model:'users;drop'})).toThrow('PIPE-DB-001'));
 it('rejects unknown operation kinds',()=>expect(()=>compileSql({kind:'merge' as any,model:'users'})).toThrow('PIPE-DB-004'));
 it('numbers nested predicate parameters deterministically',()=>{const q=compileSql({kind:'select',model:'users',where:{kind:'and',items:[{kind:'compare',field:'age',operator:'>=',value:primitive('integer')},{kind:'or',items:[{kind:'compare',field:'name',operator:'=',value:primitive('text')},{kind:'compare',field:'name',operator:'=',value:primitive('text')}]}]}},[18,'Ada','Bob']);expect(q.text).toBe('SELECT * FROM "users" WHERE ("age" >= $1 AND ("name" = $2 OR "name" = $3))');expect(q.parameters).toEqual([18,'Ada','Bob']);});
 it('rejects missing and extra runtime parameters',()=>{const op={kind:'select' as const,model:'users',where:{kind:'compare' as const,field:'id',operator:'=' as const,value:primitive('id')}};expect(()=>compileSql(op,[])).toThrow('PIPE-DB-003');expect(()=>compileSql(op,['u1','u2'])).toThrow('PIPE-DB-003');expect(()=>compileSql({kind:'delete',model:'users'},[1])).toThrow('PIPE-DB-003');});
});
