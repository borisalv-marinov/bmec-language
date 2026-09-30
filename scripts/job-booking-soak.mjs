import {spawn} from 'node:child_process';
import {Pool, TypeOverrides} from 'pg';

const connectionString = process.env.BMEC_POSTGRES_URL;
const durationMs = Number(process.env.BMEC_SOAK_MS ?? 1_800_000);
if (!connectionString) throw new Error('BMEC_POSTGRES_URL is required');
const types = new TypeOverrides(); types.setTypeParser(20, value => BigInt(value));
const pool = new Pool({connectionString, types});
const users = JSON.stringify([{id: 'admin', password: 'admin-pass-123', role: 'admin'}, {id: 'worker', password: 'worker-pass-123', role: 'worker'}]);
const waitForUrl = child => new Promise((resolve, reject) => { let output = ''; const onData = chunk => { output += chunk.toString(); const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) resolve(match[0]); }; child.stdout.on('data', onData); child.stderr.on('data', chunk => { output += chunk.toString(); }); child.once('error', reject); child.once('exit', code => { if (code && !output.includes('http://127.0.0.1:')) reject(new Error(`server exited with ${code}: ${output}`)); }); });
const stop = child => new Promise(resolve => { child.once('exit', resolve); child.kill('SIGINT'); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000); });
let child;
try {
  await pool.query('TRUNCATE "JobNote", "Job", "Customer" RESTART IDENTITY');
  await pool.query('INSERT INTO "Customer" ("name", "email", "phone") VALUES ($1, $2, $3)', ['Soak Customer', 'soak@example.test', '555-0300']);
  await pool.query('INSERT INTO "Job" ("customer", "worker", "workerAuthId", "title", "description", "price", "scheduledDate", "status") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [1, 2, 'worker', 'Soak job', 'Repeated Job Booking workflow', 1250, '2026-10-03', 'Pending']);
  child = spawn(process.execPath, ['dist/cli/index.js', 'run', 'examples/job-booking/main.bmec'], {env: {...process.env, BMEC_PORT: '0', BMEC_POSTGRES_URL: connectionString, BMEC_AUTH_USERS: users}, stdio: ['ignore', 'pipe', 'pipe']});
  const base = await waitForUrl(child);
  const login = async (id, password) => { const response = await fetch(`${base}/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({id, password})}); if (response.status !== 200) throw new Error(`${id} login ${response.status}`); return response.headers.getSetCookie?.()[0]?.split(';')[0] ?? response.headers.get('set-cookie')?.split(';')[0]; };
  const admin = await login('admin', 'admin-pass-123'); const worker = await login('worker', 'worker-pass-123');
  let iterations = 0; let failures = 0; const started = Date.now();
  while (Date.now() - started < durationMs) {
    try {
      const jobs = await fetch(`${base}/jobs`, {headers: {cookie: admin}}); if (jobs.status !== 200 || (await jobs.json()).length !== 1) throw new Error(`admin jobs ${jobs.status}`);
      const assignedRows = await assigned.json(); const assignedWorker = assignedRows[0]?.worker; if (assigned.status !== 200 || (assignedWorker?.id ?? assignedWorker) !== 2) throw new Error(`assigned jobs ${assigned.status}`);
      if (iterations % 10 === 0) { const patch = await fetch(`${base}/worker-jobs/1`, {method: 'PATCH', headers: {cookie: worker, 'content-type': 'application/json'}, body: JSON.stringify({status: 'InProgress'})}); if (patch.status !== 200) throw new Error(`status patch ${patch.status}`); }
      iterations++;
    } catch (error) { failures++; if (failures > 3) throw error; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  console.log(`JOB_BOOKING_SOAK PASS — ${Math.round((Date.now() - started) / 1000)}s, ${iterations} iterations, ${failures} transient failures`);
} finally { if (child) await stop(child); await pool.end(); }
