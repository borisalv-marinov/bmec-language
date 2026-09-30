import {describe,expect,it} from 'vitest';
import {validatePartition} from '../src/compiler/partitions.js';
import {compile} from '../src/compiler.js';
describe('compiler partitions',()=>{
 it('rejects server-only identities from browser artifacts',()=>{const errors=validatePartition('browser',[{identity:'db.main',kind:'database'},{identity:'env.SECRET',kind:'secret'},{identity:'env.server',kind:'serverEnvironment'},{identity:'cap.db',kind:'serverCapability'}]);expect(errors).toHaveLength(4);expect(errors.every(x=>x.code==='PIPE-PART-001')).toBe(true)});
 it('allows shared values and rejects cross-partition references',()=>{expect(validatePartition('browser',[{identity:'types.User',kind:'sharedValue',partition:'shared'}])).toEqual([]);expect(validatePartition('browser',[{identity:'server.load',kind:'http',partition:'server'}])).toHaveLength(1)});
 it('enforces the boundary through compile()',()=>{const result=compile('function main() -> text { return "ok" }','app.pipe',{partition:'browser',references:[{identity:'db.main',kind:'database'}]});expect(result.diagnostics.some(x=>x.code==='PIPE-PART-001')).toBe(true);});
 it('returns diagnostics for malformed partition references',()=>{const errors=validatePartition('browser',[null as any,{identity:'x',kind:'unknown' as any,partition:'mobile' as any}]);expect(errors.map(x=>x.code)).toEqual(['PIPE-PART-002','PIPE-PART-002','PIPE-PART-002','PIPE-PART-001']);});
});
