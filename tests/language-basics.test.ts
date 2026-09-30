import {readFileSync} from 'node:fs';
import {compile} from '../src/compiler.js';
import {expect,it} from 'vitest';

it('keeps the beginner Result and capability example compiler-valid',()=>{
 const guide=readFileSync('docs/LANGUAGE_BASICS.md','utf8');
 const readme=readFileSync('README.md','utf8');
 const gettingStarted=readFileSync('docs/GETTING_STARTED.md','utf8');
 const section=guide.split('## Absence and expected failures')[1]??'';
 const example=section.match(/```bmec\r?\n([\s\S]*?)\r?\n```/)?.[1];
 const starter=gettingStarted.match(/```bmec\r?\n([\s\S]*?)\r?\n```/)?.[1];
 expect(readme).toContain('docs/GETTING_STARTED.md');
 expect(readme).toContain('docs/LANGUAGE_BASICS.md');
 expect(example).toBeDefined();
 expect(starter).toBeDefined();
 expect(compile(example??'').diagnostics).toEqual([]);
 expect(compile(starter??'').diagnostics).toEqual([]);
});
