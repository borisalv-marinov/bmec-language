import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe, expect, it} from 'vitest';

describe('AI repair-loop workflow',()=>{
  it('exposes stable JSON diagnostics for API and CRUD forms',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-ai-api-diagnostics-'));
    const cli=join(process.cwd(),'dist','cli','index.js');
    const check=(source:string)=>{
      const file=join(root,'main.bmec');
      writeFileSync(file,source);
      try{
        execFileSync(process.execPath,[cli,'check',file,'--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
        throw new Error('invalid source unexpectedly passed');
      }catch(error){
        return JSON.parse(String((error as {stderr?:unknown}).stderr));
      }
    };
    expect(check('model Task {}\napi /tasks from Task\napi /tasks from Task')).toMatchObject({
      ok:false,
      diagnostics:[expect.objectContaining({code:'PIPE-API-001',file:join(root,'main.bmec'),line:3,kind:'duplicate_api_route',received:'/tasks'})],
    });
    const unknownApi=check('api /tasks from Missing');
    expect(unknownApi).toMatchObject({ok:false});
    expect(unknownApi.diagnostics).toHaveLength(2);
    expect(unknownApi.diagnostics.map((diagnostic:{code:string})=>diagnostic.code)).toEqual(['PIPE-MOD-010','PIPE-API-002']);
    expect(unknownApi.diagnostics[0]).toMatchObject({file:join(root,'main.bmec'),kind:'module_scope',received:'Missing'});
    expect(unknownApi.diagnostics[0].repair).toBeUndefined();
    expect(unknownApi.diagnostics[1]).toMatchObject({file:join(root,'main.bmec'),path:'api./tasks.model',kind:'unknown_reference',received:'Missing'});
    const unknownCrud=check('page Home { crud Missing }');
    expect(unknownCrud).toMatchObject({ok:false});
    expect(unknownCrud.diagnostics).toHaveLength(2);
    expect(unknownCrud.diagnostics.map((diagnostic:{code:string})=>diagnostic.code)).toEqual(['PIPE-MOD-010','PIPE-REF-001']);
    expect(unknownCrud.diagnostics[0]).toMatchObject({file:join(root,'main.bmec'),kind:'module_scope',received:'Missing'});
    expect(unknownCrud.diagnostics[0].repair).toBeUndefined();
    expect(unknownCrud.diagnostics[1]).toMatchObject({file:join(root,'main.bmec'),path:'page.Home.crud',kind:'unknown_reference',received:'Missing'});
    expect(check('crud Task')).toMatchObject({
      ok:false,
      diagnostics:[expect.objectContaining({code:'PIPE-SYN-005',file:join(root,'main.bmec'),line:1,kind:'syntax'})],
    });
    writeFileSync(join(root,'broken.bmec'),'crud Task');
    const imported=check('import { value } from "./broken.bmec"\napp Demo');
    expect(imported).toMatchObject({ok:false});
    expect(imported.diagnostics).toEqual([expect.objectContaining({code:'PIPE-SYN-005',file:join(root,'broken.bmec'),line:1,kind:'syntax'})]);
  });

  it('checks, repairs, formats, inspects, and builds without terminal scraping',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-ai-workflow-'));
    const file=join(root,'main.bmec');
    const cli=join(process.cwd(),'dist','cli','index.js');
    writeFileSync(file,'app Demo\nstyle Card\n');

    let diagnostics: unknown;
    try{
      execFileSync(process.execPath,[cli,'check',file,'--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
      throw new Error('invalid source unexpectedly passed');
    }catch(error){
      diagnostics=JSON.parse(String((error as {stderr?:unknown}).stderr));
    }
    expect(diagnostics).toMatchObject({ok:false,diagnostics:[expect.objectContaining({code:'PIPE-STYLE-001',file})]});

    const shared=join(root,'shared');
    mkdirSync(shared);
    writeFileSync(join(shared,'main.bmec'),'app Shared\npublic function bump(value integer) -> integer { return value + 1 }\n');
    writeFileSync(join(shared,'bmec.toml'),'[package]\nname = "shared"\nversion = "1.2.3"\nlanguage = "0.1"\nentry = "main.bmec"\n');
    writeFileSync(join(root,'bmec.toml'),'[package]\nname = "demo"\nversion = "0.2.0"\nlanguage = "0.1"\nentry = "main.bmec"\n\n[dependencies]\nshared = "./shared"\n');
    writeFileSync(file,'import { bump } from "shared/main.bmec"\napp Demo\nmodel Item { name text required }\napi /items from Item\nstyle named Card layout is column alignment is center\nstyle named CardPadding padding is 12\npage Main { input query text label "Query" placeholder "Find items" help "Search by name" disabled crud Item use style Card }\nfunction main() -> integer { return bump(1) }\nfunction encoded(value text) -> text { return base64Encode(value) }\n');
    execFileSync(process.execPath,[cli,'lock',join(root,'bmec.toml')],{encoding:'utf8'});
    execFileSync(process.execPath,[cli,'fmt',file,'--write'],{encoding:'utf8'});
    expect(execFileSync(process.execPath,[cli,'fmt',file,'--check'],{encoding:'utf8'})).toContain('Formatted');
    expect(JSON.parse(execFileSync(process.execPath,[cli,'check',file,'--json'],{encoding:'utf8'}))).toEqual({schemaVersion:'bmec.diagnostics.v1',languageVersion:'0.1',ok:true,diagnostics:[]});
    const aiSpec=JSON.parse(execFileSync(process.execPath,[cli,'ai-spec','--json'],{encoding:'utf8'}));
    expect(aiSpec.commands).toContain('repl');
    expect(aiSpec.commandUsage.repl).toBe('bmec repl');
    expect(JSON.parse(execFileSync(process.execPath,[cli,'capabilities','--json'],{encoding:'utf8'})).capabilities.map((capability:{name:string})=>capability.name)).toContain('database');
    expect(JSON.parse(execFileSync(process.execPath,[cli,'stdlib','--json'],{encoding:'utf8'})).functions).toEqual(expect.arrayContaining(['dateDifference','base64Encode','base64Decode']));
    const repl=execFileSync(process.execPath,[cli,'repl'],{cwd:process.cwd(),input:':help\nlet answer be 4\n:type answer\nanswer + 2\n:quit\n',encoding:'utf8'});
    expect(repl).toContain(':help - show commands');
    expect(repl).toContain(':type NAME - show a binding type');
    expect(repl).toContain('answer: integer');
    expect(repl).toContain('6n');

    const project=JSON.parse(execFileSync(process.execPath,[cli,'project',file,'--json'],{encoding:'utf8'}));
    expect(project).toMatchObject({app:{name:'Demo'},models:[{name:'Item'}],pages:[{name:'Main',style:'Card'}],components:[{name:'Main',style:'Card'}]});
    expect(project.pages[0].children).toEqual(expect.arrayContaining([expect.objectContaining({kind:'input',name:'query',placeholder:'Find items',help:'Search by name',disabled:true})]));
    expect(project.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'Card'}),expect.objectContaining({name:'CardPadding',padding:12})]));
    expect(project.modules.map((module:{id:string})=>module.id)).toEqual(['demo@0.2.0:main.bmec','shared@1.2.3:main.bmec']);
    expect(project.modules[0].imports).toEqual(['shared@1.2.3:main.bmec']);
    const expanded=JSON.parse(execFileSync(process.execPath,[cli,'expand',file,'--json'],{encoding:'utf8'}));
    expect(expanded).toMatchObject({schemaVersion:'bmec.expand.v1',languageVersion:'0.1',version:'bmec.expand.v1',irVersion:2,app:{name:'Demo'},graph:expect.any(Array),ir:{app:{name:'Demo'}}});
    expect(expanded.graph).toEqual(expect.arrayContaining([expect.objectContaining({kind:'model',name:'Item'})]));
    const graph=JSON.parse(execFileSync(process.execPath,[cli,'graph',file,'--json'],{encoding:'utf8'}));
    expect(graph).toMatchObject({schemaVersion:'bmec.graph.v1',languageVersion:'0.1'});
    expect(graph.nodes.map((node:{id:string})=>node.id)).toEqual(expect.arrayContaining(['APP-001','DB-001','UI-001','API-001']));
    const inspected=JSON.parse(execFileSync(process.execPath,[cli,'inspect','DB-001',file,'--json'],{encoding:'utf8'}));
    const inspectedStyle=JSON.parse(execFileSync(process.execPath,[cli,'inspect','STYLE-001',file,'--json'],{encoding:'utf8'}));
    expect(inspectedStyle).toMatchObject({schemaVersion:'bmec.inspect.v1',languageVersion:'0.1',id:'STYLE-001',kind:'style',facts:{layout:'column',alignment:'center',values:[],composes:[]}});
    expect(inspected).toMatchObject({id:'DB-001',kind:'model',name:'Item',children:['FIELD-001']});
    const affected=JSON.parse(execFileSync(process.execPath,[cli,'affected','DB-001',file,'--json'],{encoding:'utf8'}));
    expect(affected).toMatchObject({schemaVersion:'bmec.affected.v1',languageVersion:'0.1'});
    expect(affected.nodes.map((node:{id:string})=>node.id)).toEqual(['APP-001','UI-001','API-001']);
    const types=JSON.parse(execFileSync(process.execPath,[cli,'types',file,'--json'],{encoding:'utf8'}));
    expect(types).toMatchObject({schemaVersion:'bmec.types.v1',languageVersion:'0.1',types:expect.arrayContaining([expect.objectContaining({kind:'model',name:'Item'})])});
    const symbols=JSON.parse(execFileSync(process.execPath,[cli,'symbols',file,'--json'],{encoding:'utf8'}));
    expect(symbols).toMatchObject({schemaVersion:'bmec.symbols.v1',languageVersion:'0.1',symbols:expect.arrayContaining([expect.objectContaining({kind:'model',name:'Item'}),expect.objectContaining({kind:'function',name:'main'})])});
    const models=JSON.parse(execFileSync(process.execPath,[cli,'models',file,'--json'],{encoding:'utf8'}));
    expect(models).toMatchObject({schemaVersion:'bmec.models.v1',languageVersion:'0.1',models:expect.arrayContaining([expect.objectContaining({kind:'model',name:'Item',fields:[expect.objectContaining({name:'name',type:'text',required:true})]})])});
    const routes=JSON.parse(execFileSync(process.execPath,[cli,'routes',file,'--json'],{encoding:'utf8'}));
    expect(routes).toMatchObject({schemaVersion:'bmec.routes.v1',languageVersion:'0.1',routes:expect.arrayContaining([expect.objectContaining({method:'GET',path:'/items',responseType:'list<Item>',capabilities:['database']})])});
    const pages=JSON.parse(execFileSync(process.execPath,[cli,'pages',file,'--json'],{encoding:'utf8'}));
    expect(pages).toMatchObject({schemaVersion:'bmec.pages.v1',languageVersion:'0.1',pages:[expect.objectContaining({name:'Main',crud:['Item'],style:'Card'})]});
    const capabilities=JSON.parse(execFileSync(process.execPath,[cli,'capabilities',file,'--json'],{encoding:'utf8'}));
    expect(capabilities).toMatchObject({schemaVersion:'bmec.used-capabilities.v1',languageVersion:'0.1',capabilities:expect.arrayContaining(['database'])});
    expect(execFileSync(process.execPath,[cli,'build',file],{encoding:'utf8'})).toContain('Generated');
    expect(readFileSync(file,'utf8')).toContain('style named Card');
  }, 30_000);
});
