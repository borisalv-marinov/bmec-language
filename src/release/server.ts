import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {ProjectIR} from '../ir/ir.js';
import {assertSerializedIR} from '../ir/validate.js';
import {startNodeHttpSource,type NodeHttpHandle,type NodeHttpOptions} from '../http/node-adapter.js';

export type ReleaseServerOptions=Omit<NodeHttpOptions,'publicDirectory'>;

/** Load the validated server artifact and expose it together with the
 * declared public artifacts through one narrow Node transport boundary. */
export async function startNodeRelease(directory:string,options:ReleaseServerOptions={}):Promise<NodeHttpHandle>{
 const root=resolve(directory),raw=JSON.parse(readFileSync(resolve(root,'server-ir.json'),'utf8')) as ProjectIR;
 assertSerializedIR(raw);
 return startNodeHttpSource(raw,{...options,publicDirectory:root});
}
