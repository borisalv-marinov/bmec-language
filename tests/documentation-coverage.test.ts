import {describe,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';

const root=process.cwd();
const inventory=JSON.parse(readFileSync(join(root,'docs','capability-coverage.json'),'utf8'));

describe('public documentation coverage',()=>{
  it('maps every compiler construct, standard-library symbol, and host capability to a human guide',()=>{
    const cli=join(root,'dist','cli','index.js');
    const ai=JSON.parse(execFileSync(process.execPath,[cli,'ai-spec','--json'],{encoding:'utf8'}));
    const capabilities=JSON.parse(execFileSync(process.execPath,[cli,'capabilities','--json'],{encoding:'utf8'}));
    const constructs=new Set(inventory.capabilities.flatMap((item:{canonical:{constructs:string[]}})=>item.canonical.constructs));
    const docs=inventory.capabilities.map((item:{human:string})=>item.human);
    expect(inventory.schemaVersion).toBe('bmec.documentation-coverage.v1');
    expect(inventory.languageVersion).toBe(ai.languageVersion);
    expect(constructs.size).toBe(ai.constructs.length);
    expect(ai.constructs.every((item:{id:string})=>constructs.has(item.id))).toBe(true);
    expect(inventory.registry.standardLibrarySymbols).toBe(ai.stdlibContracts.length);
    expect(inventory.capabilities.reduce((sum:number,item:{canonical:{stdlib:string[]}})=>sum+item.canonical.stdlib.length,0)).toBe(ai.stdlibContracts.length);
    expect(inventory.registry.hostCapabilities).toBe(capabilities.capabilities.length);
    expect(new Set(inventory.capabilities.flatMap((item:{canonical:{capabilities:string[]}})=>item.canonical.capabilities)).size).toBe(capabilities.capabilities.length);
    expect(inventory.capabilities.every((item:{availability:{packageVersion:string;languageVersion:string}})=>item.availability.packageVersion===inventory.packageVersion&&item.availability.languageVersion===inventory.languageVersion)).toBe(true);
    expect(docs.every((path:string)=>path.startsWith('/docs/')||path.startsWith('/spec/'))).toBe(true);
  });

  it('publishes the coverage index and omits private execution and historical evidence files',()=>{
    const site=join(root,'website','dist');
    expect(existsSync(join(site,'docs','CAPABILITY_COVERAGE.md'))).toBe(true);
    expect(existsSync(join(site,'docs','LEARNING_PATH.md'))).toBe(true);
    expect(existsSync(join(site,'docs','capability-coverage.json'))).toBe(true);
    expect(existsSync(join(site,'docs','CLI_REFERENCE.md'))).toBe(true);
    expect(existsSync(join(site,'docs','STANDARD_LIBRARY.md'))).toBe(true);
    expect(existsSync(join(site,'spec','diagnostics.md'))).toBe(true);
    for(const path of [
      'docs/AI_EXECUTION_STATE.md','docs/BMEC_0_6_PLAN.md','docs/BMEC_0_7_FINAL_REPORT.md',
      'docs/internal/private-report.md','output/internal-artifacts'
    ])expect(existsSync(join(site,path))).toBe(false);
    const data=JSON.parse(readFileSync(join(site,'site-data.json'),'utf8'));
    expect(data.version).toBe(inventory.packageVersion);
    expect(data.languageVersion).toBe(inventory.languageVersion);
    expect(data.phase).toBeUndefined();
    expect(data.phaseUrl).toBeUndefined();
    const index=JSON.parse(readFileSync(join(site,'ai','index.json'),'utf8'));
    expect(index.catalogs).toContainEqual(expect.objectContaining({id:'capability-coverage',href:'/docs/capability-coverage.json',schemaVersion:inventory.schemaVersion}));
    const hostCatalog=JSON.parse(readFileSync(join(site,'ai','capabilities.json'),'utf8'));
    expect(hostCatalog.schemaVersion).toBe('bmec.capabilities.v1');
    expect(hostCatalog.capabilities).toHaveLength(inventory.registry.hostCapabilities);
    expect(index.catalogs).toContainEqual(expect.objectContaining({id:'capabilities',href:'/ai/capabilities.json',schemaVersion:'bmec.capabilities.v1'}));
    const siteAi=JSON.parse(readFileSync(join(site,'ai','ai-spec.json'),'utf8'));
    const siteCommands=JSON.parse(readFileSync(join(site,'ai','commands.json'),'utf8'));
    const stdlibReference=readFileSync(join(site,'docs','STANDARD_LIBRARY.md'),'utf8');
    const cliReference=readFileSync(join(site,'docs','CLI_REFERENCE.md'),'utf8');
    const learningPath=readFileSync(join(site,'docs','LEARNING_PATH.md'),'utf8');
    const learnPage=readFileSync(join(site,'learn','index.html'),'utf8');
    expect(learnPage).toContain('/docs/LEARNING_PATH.md');
    for(const match of learningPath.matchAll(/\]\(([^)]+)\)/g)){
      const target=match[1].split('#')[0];
      if(!target||target.startsWith('http:')||target.startsWith('https:')||target.startsWith('/'))continue;
      expect(existsSync(join(site,'docs',target)),`learning path link ${match[1]}`).toBe(true);
    }
    for(const item of siteAi.stdlibContracts)expect(stdlibReference).toContain(`\`${item.name}\``);
    for(const item of siteCommands.commands)expect(cliReference).toContain(`bmec ${item.name}`);
    for(const row of inventory.capabilities){
      expect(existsSync(join(site,row.human.slice(1).split('#')[0]))).toBe(true);
      expect(existsSync(join(site,row.canonical.specUrl.slice(1)))).toBe(true);
      expect(existsSync(join(site,row.ai.href.slice(1)))).toBe(true);
      expect(existsSync(join(site,row.ai.capabilityCatalog.slice(1)))).toBe(true);
      expect(existsSync(join(site,row.ai.diagnosticCatalog.slice(1)))).toBe(true);
    }
    for(const item of inventory.capabilities.flatMap((row:{examples:Array<{path:string;verified:boolean}>})=>row.examples)){
      expect(item.verified).toBe(true);
      expect(existsSync(join(site,item.path.slice(1)))).toBe(true);
    }
  });

  it('keeps unsupported and limited platform claims explicit in public language',()=>{
    const guide=readFileSync(join(root,'docs','CAPABILITIES.md'),'utf8');
    expect(guide).toContain('## Known limitations');
    expect(guide).toContain('SQLite and PostgreSQL create them during startup migration');
    expect(readFileSync(join(root,'docs','DATABASE_PRODUCTION.md'),'utf8')).toContain('at most 10 connections');
    expect(guide).toContain('No WebSocket/realtime contract');
    expect(inventory.capabilities.filter((item:{support:string})=>item.support==='limited').length).toBeGreaterThan(0);
    expect(inventory.capabilities.filter((item:{support:string})=>item.support==='unsupported').map((item:{id:string})=>item.id)).toEqual(expect.arrayContaining(['realtime-websockets','binary-buffers']));
    expect(inventory.packageVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(inventory.languageVersion).toMatch(/^\d+\.\d+/);
  });

  it('keeps personal paths and internal evidence names out of the public site output',()=>{
    const site=join(root,'website','dist'),textFiles:string[]=[];
    const visit=(directory:string)=>{for(const item of readdirSync(directory,{withFileTypes:true})){const path=join(directory,item.name);if(item.isDirectory())visit(path);else if(['.md','.json','.html','.js','.css','.bmec'].includes(item.name.slice(item.name.lastIndexOf('.'))))textFiles.push(path);}};
    visit(site);
    const privateMarkers=[/\b[A-Z]:\\Users\\[^\\\s]+/i,/\/home\/[^/\s]+/i,/\.codex[\\/]/i,/AI_EXECUTION_STATE/i,/BMEC_0_7_FINAL_REPORT/i,/(?:docs|output)[\\/](?:private|internal)[\\/]/i,/private-review/i];
    for(const path of textFiles){
      const content=readFileSync(path,'utf8');
      for(const marker of privateMarkers)expect(content,`${path} contains ${marker}`).not.toMatch(marker);
    }
  });
});
