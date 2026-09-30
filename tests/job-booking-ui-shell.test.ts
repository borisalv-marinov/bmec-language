import {describe,expect,it} from 'vitest';
import {readFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compileProject} from '../src/compiler.js';
import {generate} from '../src/generator/generate.js';

describe('Job Booking Manager UI shell',()=>{
  it('generates navigation, login-first page separation, and responsive page targets',()=>{
    const entry=join(process.cwd(),'examples','job-booking','main.bmec');
    const compiled=compileProject(entry);
    expect(compiled.diagnostics).toEqual([]);
    const directory=mkdtempSync(join(tmpdir(),'bmec-job-booking-ui-shell-'));
    generate(compiled.ir!,directory);
    const html=readFileSync(join(directory,'index.html'),'utf8');
    expect(html).toContain('nav data-pipe-nav aria-label="Application navigation"');
    expect(html).toContain('data-pipe-nav-item');
    expect(html).toContain('aria-current');
    expect(html).toContain('Customers');
    expect(html).toContain('<h1>Job Booking Manager</h1>');
    expect(html).toContain('href="#pipe-page--customers"');
    expect(html).toContain('section[data-pipe-page]:target{display:block}');
    expect(html).toContain('body:not(:has(section[data-pipe-page]:target)) section[data-pipe-page]:first-of-type{display:block}');
    expect(html).toContain('data-pipe-style="MetricCard"');
    expect(html).toContain('data-pipe-style="StatusBadge"');
    expect(html).toContain('data-pipe-style="WorkerIntroStyle"');
    expect(html).toContain('aria-label="User ID"');
    expect(html).toContain('Customer');
    expect(html).toContain('data-pipe-control="select"');
    expect(html).toContain('Scheduled Date');
    expect(html).toContain('data-pipe-sort="scheduledDate">Scheduled Date</button></th>');
    expect(html).toContain('aria-label="Job records"');
    expect(html).toContain('data-pipe-state="loading"');
    expect(html).toContain('data-pipe-state="empty"');
    expect(html).toContain('data-pipe-state="error"');
    expect(html).toContain("Unable to load records.");
    expect(html).toContain("setState(fetched.length?'ready':'empty')");
  });
});
