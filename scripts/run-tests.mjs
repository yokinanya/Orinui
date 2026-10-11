import { spawn } from 'node:child_process';

const TEST_TIMEOUT_MS = 60_000;
const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
const timer = setTimeout(() => {
  console.error('测试超过 60 秒，已终止。');
  child.kill();
  process.exitCode = 1;
}, TEST_TIMEOUT_MS);
child.on('error', (error) => { clearTimeout(timer); console.error(error); process.exitCode = 1; });
child.on('exit', (code) => { clearTimeout(timer); process.exitCode = code ?? 1; });
