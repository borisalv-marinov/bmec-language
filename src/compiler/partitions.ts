export type CompilationPartition='server'|'browser'|'shared';
export type PartitionReferenceKind='database'|'secret'|'serverEnvironment'|'serverCapability'|'http'|'time'|'random'|'secureRandom'|'filesystem'|'sharedValue';
export interface PartitionReference {identity:string;kind:PartitionReferenceKind;partition?:CompilationPartition}
export interface PartitionDiagnostic {code:'PIPE-PART-001'|'PIPE-PART-002';identity:string;message:string}

/** Enforce the server/browser security boundary before lowering partitioned artifacts. */
export function validatePartition(partition:CompilationPartition,references:readonly PartitionReference[]):PartitionDiagnostic[]{
 const errors:PartitionDiagnostic[]=[];
 const kinds=new Set<PartitionReferenceKind>(['database','secret','serverEnvironment','serverCapability','http','time','random','secureRandom','filesystem','sharedValue']);
 const partitions=new Set<CompilationPartition>(['server','browser','shared']);
 for(const ref of references){
  if(!ref||typeof ref!=='object'){errors.push({code:'PIPE-PART-002',identity:'',message:'Partition reference must be an object'});continue;}
  if(typeof ref.identity!=='string'||!ref.identity)errors.push({code:'PIPE-PART-002',identity:'',message:'Partition reference identity is required'});
  if(!kinds.has(ref.kind))errors.push({code:'PIPE-PART-002',identity:typeof ref.identity==='string'?ref.identity:'',message:'Partition reference kind is invalid'});
  if(ref.partition!==undefined&&!partitions.has(ref.partition))errors.push({code:'PIPE-PART-002',identity:typeof ref.identity==='string'?ref.identity:'',message:'Partition reference partition is invalid'});
  if(partition==='browser'&&['database','secret','serverEnvironment','serverCapability'].includes(ref.kind))errors.push({code:'PIPE-PART-001',identity:ref.identity,message:`Browser code cannot reference ${ref.kind}`});
  if(ref.partition&&ref.partition!==partition&&ref.partition!=='shared')errors.push({code:'PIPE-PART-001',identity:ref.identity,message:`${partition} code cannot reference ${ref.partition} identity`});
 }
 return errors;
}
