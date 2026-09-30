export class PipeTask<T>{readonly kind='task';private cancelled=false;private constructor(private readonly operation:Promise<T>){}static from<T>(operation:Promise<T>):PipeTask<T>{return new PipeTask(operation)}cancel():void{if(this.cancelled)throw new Error('PIPE-ASYNC-005: task is already cancelled');this.cancelled=true}isCancelled():boolean{return this.cancelled}async resolve():Promise<T>{if(this.cancelled)throw new Error('PIPE-ASYNC-004: task was cancelled');const result=await this.operation;if(this.cancelled)throw new Error('PIPE-ASYNC-004: task was cancelled');return result}}
export function task<T>(operation:()=>T|Promise<T>):PipeTask<T>{try{return PipeTask.from(Promise.resolve(operation()))}catch(error){return PipeTask.from(Promise.reject(error))}}
export async function awaitTask<T>(value:PipeTask<T>):Promise<T>{if(!(value instanceof PipeTask))throw new Error('PIPE-ASYNC-001: await requires a PIPE task');return value.resolve()}
export function mapTask<T,U>(value:PipeTask<T>,map:(value:T)=>U|Promise<U>):PipeTask<U>{if(!(value instanceof PipeTask))throw new Error('PIPE-ASYNC-001: map requires a PIPE task');return PipeTask.from(value.resolve().then(map))}
export function timeoutTask<T>(value:PipeTask<T>,milliseconds:number):PipeTask<T>{if(!(value instanceof PipeTask)||!Number.isFinite(milliseconds)||milliseconds<0)throw new Error('PIPE-ASYNC-002: invalid task timeout');const timer=new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('PIPE-ASYNC-003: task timed out')),milliseconds));return PipeTask.from(Promise.race([value.resolve(),timer]))}
export function allTasks<T>(values:readonly PipeTask<T>[]):PipeTask<T[]>{if(values.some(value=>!(value instanceof PipeTask)))throw new Error('PIPE-ASYNC-001: all requires PIPE tasks');return PipeTask.from(Promise.all(values.map(value=>value.resolve())))}
export function raceTasks<T>(values:readonly PipeTask<T>[]):PipeTask<T>{if(!values.length||values.some(value=>!(value instanceof PipeTask)))throw new Error('PIPE-ASYNC-001: race requires non-empty PIPE tasks');return PipeTask.from(Promise.race(values.map(value=>value.resolve())))}
/** Runtime scheduler boundary. Tasks remain PIPE-owned values; the host promise
 * is only observed at this explicit scheduler edge. */
export class TaskScheduler {
 private readonly pending=new Set<PipeTask<unknown>>();
 spawn<T>(operation:()=>T|Promise<T>):PipeTask<T>{const value=task(operation);this.pending.add(value as PipeTask<unknown>);void value.resolve().then(()=>this.pending.delete(value as PipeTask<unknown>),()=>this.pending.delete(value as PipeTask<unknown>));return value}
 cancel(value:PipeTask<unknown>):void{if(!this.pending.has(value))throw new Error('PIPE-ASYNC-005: task is not owned by scheduler');value.cancel()}
 async drain():Promise<void>{await Promise.allSettled([...this.pending].map(value=>value.resolve()));}
 get size():number{return this.pending.size}
}
