import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {describe,expect,it} from 'vitest';
import {createLanguageService} from '../src/lsp/service.js';

describe('typed style AI contracts',()=>{
  it('projects fontWeight through bmec project JSON',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-style-project-')),file=join(root,'main.bmec');
    writeFileSync(file,'app Demo\nstyle named Primary font weight is bold\n');
    const output=execFileSync(process.execPath,[join(process.cwd(),'dist','cli','index.js'),'project',file,'--json'],{encoding:'utf8'});
    const project=JSON.parse(output);
    expect(project.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'Primary',fontWeight:'bold'})]));
  });

  it('projects fontSize through bmec project JSON',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-style-font-size-project-')),file=join(root,'main.bmec');
    writeFileSync(file,'app Demo\nstyle named Heading font size is 24\n');
    const output=execFileSync(process.execPath,[join(process.cwd(),'dist','cli','index.js'),'project',file,'--json'],{encoding:'utf8'});
    const project=JSON.parse(output);
    expect(project.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'Heading',fontSize:24})]));
  });

  it('projects numeric radius through bmec styles JSON',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-style-radius-project-')),file=join(root,'main.bmec');
    writeFileSync(file,'app Demo\nstyle named Card radius is 8\n');
    const output=execFileSync(process.execPath,[join(process.cwd(),'dist','cli','index.js'),'styles',file,'--json'],{encoding:'utf8'});
    const styles=JSON.parse(output);
    expect(styles.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'Card',radius:8})]));
  });

  it('projects typed state text colors through bmec styles JSON',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-style-state-text-project-')),file=join(root,'main.bmec');
    writeFileSync(file,'app Demo\nstyle named Button { when hovered { text color is white } }\n');
    const output=execFileSync(process.execPath,[join(process.cwd(),'dist','cli','index.js'),'styles',file,'--json'],{encoding:'utf8'});
    const styles=JSON.parse(output);
    expect(styles.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'Button',states:[expect.objectContaining({state:'hovered',properties:[expect.objectContaining({name:'textColor',value:'white'})]})]})]));
  });

  it('projects alignment through bmec project JSON',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-style-alignment-project-')),file=join(root,'main.bmec');
    writeFileSync(file,'app Demo\nstyle named Dashboard alignment is center\n');
    const output=execFileSync(process.execPath,[join(process.cwd(),'dist','cli','index.js'),'project',file,'--json'],{encoding:'utf8'});
    const project=JSON.parse(output);
    expect(project.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'Dashboard',alignment:'center'})]));
  });

  it('projects brace-delimited style facts through bmec project JSON',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-style-block-project-')),file=join(root,'main.bmec');
    writeFileSync(file,'app Demo\nstyle named Card { layout is column alignment is center padding is 12 }\n');
    const output=execFileSync(process.execPath,[join(process.cwd(),'dist','cli','index.js'),'project',file,'--json'],{encoding:'utf8'});
    const project=JSON.parse(output);
    expect(project.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'Card',layout:'column',alignment:'center',padding:12})]));
  });

  it('projects responsive gap facts through bmec project JSON',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-style-responsive-gap-project-')),file=join(root,'main.bmec');
    writeFileSync(file,'app Demo\nstyle named Dashboard { on small screens { gap is 8 } }\n');
    const output=execFileSync(process.execPath,[join(process.cwd(),'dist','cli','index.js'),'project',file,'--json'],{encoding:'utf8'});
    const project=JSON.parse(output);
    expect(project.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'Dashboard',responsiveGap:8})]));
  });

  it('projects responsive padding facts through bmec project JSON',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-style-responsive-padding-project-')),file=join(root,'main.bmec');
    writeFileSync(file,'app Demo\nstyle named Dashboard { on small screens { padding is 8 } }\n');
    const output=execFileSync(process.execPath,[join(process.cwd(),'dist','cli','index.js'),'project',file,'--json'],{encoding:'utf8'});
    const project=JSON.parse(output);
    expect(project.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'Dashboard',responsivePadding:8})]));
  });

  it('projects responsive margin facts through bmec project JSON',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-style-responsive-margin-project-')),file=join(root,'main.bmec');
    writeFileSync(file,'app Demo\nstyle named Dashboard { on small screens { margin is 8 } }\n');
    const output=execFileSync(process.execPath,[join(process.cwd(),'dist','cli','index.js'),'project',file,'--json'],{encoding:'utf8'});
    const project=JSON.parse(output);
    expect(project.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'Dashboard',responsiveMargin:8})]));
  });

  it('projects responsive layout facts through bmec styles JSON',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-style-responsive-layout-project-')),file=join(root,'main.bmec');
    writeFileSync(file,'app Demo\nstyle named Mobile { on small screens { layout is column } }\n');
    const output=execFileSync(process.execPath,[join(process.cwd(),'dist','cli','index.js'),'styles',file,'--json'],{encoding:'utf8'});
    const styles=JSON.parse(output);
    expect(styles.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'Mobile',responsiveLayout:'column'})]));
  });

  it('projects responsive font-size facts through bmec styles JSON',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-style-responsive-font-size-project-')),file=join(root,'main.bmec');
    writeFileSync(file,'app Demo\nstyle named Dashboard { on small screens { font size is 14 } }\n');
    const output=execFileSync(process.execPath,[join(process.cwd(),'dist','cli','index.js'),'styles',file,'--json'],{encoding:'utf8'});
    const styles=JSON.parse(output);
    expect(styles.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'Dashboard',responsiveFontSize:14})]));
  });

  it('projects responsive line-height facts through bmec styles JSON',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-style-responsive-line-height-project-')),file=join(root,'main.bmec');
    writeFileSync(file,'app Demo\nstyle named Dashboard { on small screens { font line height is 1.4 } }\n');
    const output=execFileSync(process.execPath,[join(process.cwd(),'dist','cli','index.js'),'styles',file,'--json'],{encoding:'utf8'});
    const styles=JSON.parse(output);
    expect(styles.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'Dashboard',responsiveLineHeight:1.4})]));
  });

  it('projects opacity and disabled state facts through bmec project JSON',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-style-opacity-project-')),file=join(root,'main.bmec');
    writeFileSync(file,'app Demo\nstyle named Button { opacity is 80 percent when disabled { opacity is 50 percent } }\n');
    const output=execFileSync(process.execPath,[join(process.cwd(),'dist','cli','index.js'),'project',file,'--json'],{encoding:'utf8'});
    const project=JSON.parse(output);
    expect(project.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'Button',opacity:0.8,states:[expect.objectContaining({state:'disabled',properties:[expect.objectContaining({name:'opacity',value:0.5})]})]})]));
  });

  it('projects dark blue style facts through bmec project JSON',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-style-dark-blue-project-')),file=join(root,'main.bmec');
    writeFileSync(file,'app Demo\nstyle named Button { background is dark blue when hovered { background is dark blue } }\n');
    const output=execFileSync(process.execPath,[join(process.cwd(),'dist','cli','index.js'),'project',file,'--json'],{encoding:'utf8'});
    const project=JSON.parse(output);
    expect(project.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'Button',properties:[expect.objectContaining({name:'background',value:'dark-blue'})]})]));
  });

  it('projects typed transition facts through bmec styles JSON',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-style-transition-project-')),file=join(root,'main.bmec');
    writeFileSync(file,'app Demo\nstyle named Button { transition duration is 180 transition property is background transition easing is linear }\n');
    const output=execFileSync(process.execPath,[join(process.cwd(),'dist','cli','index.js'),'styles',file,'--json'],{encoding:'utf8'});
    const styles=JSON.parse(output);
    expect(styles.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'Button',transitionDuration:180,transitionProperty:'background',transitionEasing:'linear'})]));
  });

  it('projects typed text color facts through bmec project JSON',()=>{
    const root=mkdtempSync(join(tmpdir(),'bmec-style-text-color-project-')),file=join(root,'main.bmec');
    writeFileSync(file,'app Demo\nstyle named Button { text color is white }\n');
    const output=execFileSync(process.execPath,[join(process.cwd(),'dist','cli','index.js'),'project',file,'--json'],{encoding:'utf8'});
    const project=JSON.parse(output);
    expect(project.styles).toEqual(expect.arrayContaining([expect.objectContaining({name:'Button',textColor:'white'})]));
  });

  it('completes typed font-weight vocabulary in style context',()=>{
    const service=createLanguageService(),uri='file:///style.bmec',text='app Demo\nstyle named Primary font ';
    service.open({uri,file:join(tmpdir(),'style.bmec'),text});
    const labels=service.completion(uri,{line:1,character:text.split('\n')[1]!.length}).map(item=>item.label);
    expect(labels).toEqual(expect.arrayContaining(['font','weight','normal','bold']));
  });

  it('completes typed font-size vocabulary in style context',()=>{
    const service=createLanguageService(),uri='file:///font-size-style.bmec',text='app Demo\nstyle named Heading font ';
    service.open({uri,file:join(tmpdir(),'font-size-style.bmec'),text});
    const labels=service.completion(uri,{line:1,character:text.split('\n')[1]!.length}).map(item=>item.label);
    expect(labels).toEqual(expect.arrayContaining(['font','size','weight']));
  });

  it('completes typed alignment vocabulary in style context',()=>{
    const service=createLanguageService(),uri='file:///alignment-style.bmec',text='app Demo\nstyle named Dashboard alignment is ';
    service.open({uri,file:join(tmpdir(),'alignment-style.bmec'),text});
    const labels=service.completion(uri,{line:1,character:text.split('\n')[1]!.length}).map(item=>item.label);
    expect(labels).toEqual(expect.arrayContaining(['alignment','start','center','end','stretch']));
  });

  it('completes readable focus-ring vocabulary in style context',()=>{
    const service=createLanguageService(),uri='file:///focus-style.bmec',text='app Demo\nstyle named Card when focused { show ';
    service.open({uri,file:join(tmpdir(),'focus-style.bmec'),text});
    const labels=service.completion(uri,{line:1,character:text.split('\n')[1]!.length}).map(item=>item.label);
    expect(labels).toEqual(expect.arrayContaining(['focused','show','focus','ring']));
  });

  it('completes readable small-screen vocabulary in style context',()=>{
    const service=createLanguageService(),uri='file:///responsive-style.bmec',text='app Demo\nstyle named Grid { on small ';
    service.open({uri,file:join(tmpdir(),'responsive-style.bmec'),text});
    const labels=service.completion(uri,{line:1,character:text.split('\n')[1]!.length}).map(item=>item.label);
    expect(labels).toEqual(expect.arrayContaining(['on','small','screens','columns']));
  });
});
