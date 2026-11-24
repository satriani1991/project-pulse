// Runs the backend (tsx watch) and the Vite dev server together. Open http://localhost:5173
import { spawn } from 'node:child_process';
const win = process.platform === 'win32';
const npm = win ? 'npm.cmd' : 'npm';
const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --no-warnings=ExperimentalWarning`.trim() };
const procs = [
  spawn(npm, ['run', 'dev', '-w', '@pulse/server'], { stdio: 'inherit', env, shell: win }),
  spawn(npm, ['run', 'dev', '-w', '@pulse/web'], { stdio: 'inherit', env, shell: win }),
];
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
