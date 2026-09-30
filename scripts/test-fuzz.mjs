import {spawnSync} from 'node:child_process';

const result = spawnSync('npx', ['vitest', 'run', 'tests/property.test.ts', '--reporter=dot'], {
  stdio: 'inherit',
  shell: true,
  env: {...process.env, PIPE_FUZZ_RUNS: '2000'},
});
process.exit(result.status ?? 1);
