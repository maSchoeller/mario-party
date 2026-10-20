// Starts the Node server (lobby/signaling/relay/saves) and the Vite dev server together.
import { spawn } from 'node:child_process';

const procs = [
  spawn('npm', ['run', 'dev', '-w', '@wb/server'], { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' }),
  spawn('npm', ['run', 'dev', '-w', '@wb/web'], { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' }),
];
const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && stop());
