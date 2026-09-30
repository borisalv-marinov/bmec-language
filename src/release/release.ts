import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {ProjectIR} from '../ir/ir.js';
import {generate} from '../generator/generate.js';
import {validatePartition,type PartitionReference} from '../compiler/partitions.js';
import {bundleBrowserArtifact} from './browser-bundle.js';
import {assertSerializedIR} from '../ir/validate.js';

export interface ReleaseMetadata {packageName:string;packageVersion:string;languageVersion:string;browserReferences?:readonly PartitionReference[]}
export interface ReleaseResult {directory:string;artifacts:{server:string;browser:string;manifest:string}}

/** Emit the deterministic V1 release layout. The server artifact is the
 * validated semantic IR; the browser artifact is direct-DOM HTML. */
export function buildRelease(ir:ProjectIR,outDir:string,metadata:ReleaseMetadata):ReleaseResult {
 assertSerializedIR(ir);
 mkdirSync(outDir,{recursive:true});
 // Source paths are diagnostics-only metadata and must not make artifacts
 // depend on the checkout location or host OS.
 const releaseIR:ProjectIR={...ir,modules:ir.modules?.map(module=>({...module,file:module.id}))};
 const partitionErrors=validatePartition('browser',metadata.browserReferences??[]);if(partitionErrors.length)throw new Error(`PIPE-PART-001: ${partitionErrors.map(error=>error.message).join('; ')}`);
 // Browser artifacts need model/page presentation metadata, never the server
 // database schema, functions, modules, or HTTP implementation details.
 const browserIR:ProjectIR={...releaseIR,db:undefined,functions:[],http:undefined,modules:undefined};
 generate(browserIR,outDir);
 bundleBrowserArtifact(outDir);
 const server='server-ir.json',browser='index.html',manifest='pipe-release.json';
 writeFileSync(join(outDir,server),JSON.stringify(releaseIR,null,2)+'\n');
 const release={version:1,package:metadata.packageName,packageVersion:metadata.packageVersion,languageVersion:metadata.languageVersion,irVersion:releaseIR.irVersion??2,entry:releaseIR.app.id,artifacts:{browser,manifest,server},runtime:{kind:'pipe-reference',capabilities:[]}};
 writeFileSync(join(outDir,manifest),JSON.stringify(release,null,2)+'\n');
 return {directory:outDir,artifacts:{server,browser,manifest}};
}
