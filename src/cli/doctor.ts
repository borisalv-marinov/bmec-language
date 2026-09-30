import {existsSync,statSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {compileProject} from '../compiler.js';
import {findManifest,lockFileForManifest,readManifest,verifyLock,type PipeLock} from '../project/manifest.js';

type CheckStatus='pass'|'warn'|'fail';
interface DoctorCheck {name:string;status:CheckStatus;message:string;action?:string}

export async function runDoctor(target:string|undefined,json:boolean):Promise<number>{
 const requested=resolve(target??process.cwd());
 const requestedExists=existsSync(requested);
 const isDirectory=requestedExists&&statSync(requested).isDirectory();
 const root=isDirectory||target&&!requestedExists?requested:dirname(requested);
 const directSource=!isDirectory&&existsSync(requested)&&/\.(bmec|pipe)$/.test(requested)?requested:undefined;
 const checks:DoctorCheck[]=[];
 const check=(name:string,status:CheckStatus,message:string,action?:string)=>checks.push({name,status,message,...(action?{action}:{})});
 if(target&&!requestedExists)check('Selected path','fail',`The requested path does not exist: ${requested}.`,'Check the path and run bmec doctor again.');

 const nodeMajor=Number(process.versions.node.split('.')[0]);
 check('Node.js',nodeMajor>=22?'pass':'warn',`Node.js ${process.version} on ${process.platform}/${process.arch}`,nodeMajor>=22?undefined:'Node.js 22 or newer is recommended for BMEC.');

 try{
  const loaded=await import('better-sqlite3');
  const Database=loaded.default;
  const database=new Database(':memory:');
  const version=database.prepare('select sqlite_version() as version').get() as {version:string};
  database.close();
  check('SQLite runtime','pass',`Native SQLite opened an in-memory database (SQLite ${version.version}).`);
 }catch(error){
  check('SQLite runtime','fail',`The native SQLite runtime could not start: ${String(error).split('\n')[0]}`,'Rebuild better-sqlite3 in the BMEC installation; from a source checkout, run npm rebuild better-sqlite3.');
 }

 const manifestFile=requestedExists?findManifest(root):undefined;
 let entry=directSource;
 if(manifestFile){
  try{
   const manifest=readManifest(manifestFile);
   const manifestEntry=resolve(dirname(manifestFile),manifest.entry);
   entry=manifestEntry;
   check('Project manifest','pass',`${manifest.name} ${manifest.version} (language ${manifest.language}).`);
   if(existsSync(manifestEntry))check('Project entry','pass',manifest.entry);
   else {check('Project entry','fail',`The configured entry file is missing: ${manifest.entry}.`,'Create the file or correct the package entry in the project manifest.');entry=undefined;}

   const lockFile=lockFileForManifest(manifestFile);
   if(existsSync(lockFile)){
    try{
     const lock=JSON.parse(readFileSync(lockFile,'utf8')) as PipeLock;
     const issues=verifyLock(manifestFile,lock);
     check('Package lock',issues.length===0?'pass':'fail',issues.length===0?`${lockFile.split(/[\\/]/).at(-1)} matches the manifest.`:issues.join('; '),issues.length===0?undefined:'Run bmec lock <manifest-file> to refresh the local lockfile.');
    }catch(error){check('Package lock','fail',`The lockfile could not be read: ${String(error).split('\n')[0]}`,'Run bmec lock <manifest-file> to recreate it.');}
   }else if(manifest.dependencies.length>0)check('Package lock','warn','No lockfile is present.','Run bmec lock <manifest-file> before sharing this project.');
   else check('Package lock','pass','No dependencies are declared; a lockfile is optional.');
  }catch(error){
   check('Project manifest','fail',String(error).split('\n')[0],'Correct bmec.toml or pipe.toml, then run bmec doctor again.');
  }
 }else if(directSource){
  check('Project manifest','warn','No bmec.toml or pipe.toml was found; checking the requested source file directly.');
 }else{
  const conventional=['main.bmec','main.pipe'].map(name=>resolve(root,name)).find(candidate=>existsSync(candidate));
  entry=conventional;
  if(conventional)check('Project manifest','warn','No bmec.toml or pipe.toml was found; checking the conventional source file directly.');
 }

 if(entry&&existsSync(entry)){
  try{
   const result=compileProject(entry);
   check('Source project',result.diagnostics.length===0?'pass': 'fail',result.diagnostics.length===0?`Compiled ${entry.split(/[\\/]/).at(-1)} with no errors.`:`${result.diagnostics.length} compiler diagnostic(s): ${result.diagnostics.slice(0,3).map(diagnostic=>`${diagnostic.code} ${diagnostic.message}`).join('; ')}`,result.diagnostics.length===0?undefined:'Run bmec check on the project entry for full diagnostics.');
  }catch(error){check('Source project','fail',`The project could not be compiled: ${String(error).split('\n')[0]}`,'Run bmec check on the project entry for full diagnostics.');}
 }else if(!manifestFile&&requestedExists){
  check('Source project','warn','No BMEC project or source file was found in the selected directory.','Run bmec doctor <project-directory>, or create one with bmec new <directory>.');
 }

 const status:CheckStatus=checks.some(item=>item.status==='fail')?'fail':checks.some(item=>item.status==='warn')?'warn':'pass';
 if(json)console.log(JSON.stringify({schemaVersion:'bmec.doctor.v1',root,status,checks},null,2));
 else{
  console.log(`BMEC doctor — ${status==='pass'?'ready':status==='warn'?'check recommended':'action required'}`);
  for(const item of checks){console.log(`[${item.status.toUpperCase()}] ${item.name}: ${item.message}`);if(item.action)console.log(`  Next: ${item.action}`)}
 }
 return status==='fail'?1:0;
}
