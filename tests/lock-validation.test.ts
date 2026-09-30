import {describe,expect,it} from 'vitest';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyLock} from '../src/project/manifest.js';

describe('lock validation',()=>{it('rejects duplicate locked dependency entries',()=>{const root=mkdtempSync(join(tmpdir(),'pipe-lock-duplicate-'));const file=join(root,'pipe.toml');writeFileSync(file,'[package]\nname = "demo"\nversion = "1"\nlanguage = "0.1-alpha"\nentry = "main.pipe"\n[dependencies]\nalpha = "1.0.0"\n');const lock={version:1 as const,package:'demo',dependencies:[{name:'alpha',path:'1.0.0',version:'1.0.0'},{name:'alpha',path:'1.0.0',version:'1.0.0'}]};expect(verifyLock(file,lock).map(x=>x.split(':')[0])).toContain('PIPE-PKG-010');});});
