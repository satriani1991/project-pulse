import { spawn, execFile, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ManagedProcess, Project } from '@pulse/shared';
import { db, now, type Row } from '../../database/db.js';
import { broadcast } from '../../websocket/hub.js';
import { audit } from '../../security/audit.js';
import { redact } from '../../security/secrets.js';
import { IS_WIN, PORT, ROOT_DIR } from '../../config.js';
import { deployDirOf, getProject, HttpError } from '../projects.js';
import { currentWs, runInWorkspace } from '../../workspace/context.js';

interface Live { ws: string; proc: ManagedProcess; child: ChildProcess; logs: string[]; lineBuf: string; flushTimer?: NodeJS.Timeout; pendingOut: string[] }
const live = new Map<string, Live>();
const MAX_LOG_LINES = 3000;

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}
async function freePort(start: number) { for (let p = start; p < start + 200; p++) if (await isPortFree(p)) return p; throw new HttpError(409, 'No free port found'); }

/** Resolve a configured command. Only commands stored in the project's configuration can be executed. */
export function resolveCommand(p: Project, key: string): string {
  const cmd = p.commands[key];
  if (!cmd || !cmd.trim()) throw new HttpError(400, `Command "${key}" is not configured for ${p.name}`);
  return cmd.trim();
}

function spawnShell(command: string, cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  if (IS_WIN) return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${command}"`], { cwd, env, windowsHide: true, windowsVerbatimArguments: true });
  return spawn('/bin/sh', ['-c', command], { cwd, env, detached: true });
}

export function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (IS_WIN) execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    else { try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } } setTimeout(resolve, 300); }
  });
}

const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/i;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

export interface StartOptions { onLine?: (line: string) => void; long?: boolean }

/** Start a configured project command as a dashboard-managed process. */
export async function startProcess(projectId: string, key: string, opts: StartOptions = {}): Promise<ManagedProcess> {
  const p = getProject(projectId);
  const ws = currentWs();
  const existing = [...live.values()].find((l) => l.ws === ws && l.proc.projectId === projectId && l.proc.commandKey === key && l.proc.status === 'running');
  if (existing) throw new HttpError(409, `${key} is already running for ${p.name}`);
  let command = resolveCommand(p, key);
  const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '0', BROWSER: 'none' };
  let port: number | undefined = p.devPort ?? undefined;
  let cwd = p.rootPath;
  if (command === '@static' || command.startsWith('@static ')) {
    const dir = deployDirOf(p) ?? p.rootPath;
    port = port ?? (await freePort(8080));
    command = `"${process.execPath}" "${path.join(ROOT_DIR, 'scripts', 'static-server.mjs')}" "${dir}" ${port}`;
    cwd = dir;
  }
  if (port && (key === 'dev' || key === 'start') && !(await isPortFree(port))) throw new HttpError(409, `Port conflict: ${port} is already in use`);
  if (port) env.PORT = String(port);
  const child = spawnShell(command, cwd, env);
  const proc: ManagedProcess = { id: crypto.randomUUID(), projectId, projectName: p.name, command: redact(command), commandKey: key, port, pid: child.pid, status: 'running', startedAt: now(),
    url: port ? `http://localhost:${port}/` : undefined };
  const entry: Live = { ws, proc, child, logs: [], lineBuf: '', pendingOut: [] };
  live.set(proc.id, entry);
  db().run('INSERT INTO processes(id, project_id, command_key, command, port, process_id, status, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', proc.id, projectId, key, proc.command, port ?? null, child.pid ?? null, 'running', proc.startedAt);
  audit('process.start', projectId, { key, command: proc.command });
  const onData = (chunk: Buffer) => runInWorkspace(ws, () => {
    entry.lineBuf += chunk.toString('utf8');
    const lines = entry.lineBuf.split(/\r?\n/);
    entry.lineBuf = lines.pop() ?? '';
    for (const raw of lines) {
      const line = redact(raw.replace(ANSI_RE, ''));
      entry.logs.push(line);
      if (entry.logs.length > MAX_LOG_LINES) entry.logs.splice(0, entry.logs.length - MAX_LOG_LINES);
      entry.pendingOut.push(line);
      opts.onLine?.(line);
      const m = URL_RE.exec(line);
      if (m && !proc.port) { proc.port = Number(m[1]); proc.url = `http://localhost:${proc.port}/`; db().run('UPDATE processes SET port = ? WHERE id = ?', proc.port, proc.id); broadcast('process.started', projectId, proc); }
    }
    if (!entry.flushTimer) entry.flushTimer = setTimeout(() => runInWorkspace(ws, () => { entry.flushTimer = undefined; const out = entry.pendingOut.splice(0); if (out.length) broadcast('process.output', projectId, { id: proc.id, lines: out }); }), 250);
  });
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('error', (e) => { entry.logs.push(`[pulse] failed to start: ${e.message}`); });
  child.on('exit', (code) => runInWorkspace(ws, () => {
    if (entry.lineBuf) { entry.logs.push(redact(entry.lineBuf)); opts.onLine?.(entry.lineBuf); entry.lineBuf = ''; }
    proc.status = proc.status === 'stopped' ? 'stopped' : code === 0 ? 'exited' : 'failed';
    proc.exitCode = code; proc.endedAt = now();
    db().run('UPDATE processes SET status = ?, exit_code = ?, ended_at = ? WHERE id = ?', proc.status, code, proc.endedAt, proc.id);
    broadcast('process.stopped', projectId, proc);
    // keep finished process (and its logs) visible for a while
    setTimeout(() => { if (live.get(proc.id)?.proc.status !== 'running') live.delete(proc.id); }, 30 * 60_000);
  }));
  broadcast('process.started', projectId, proc);
  return proc;
}

/** Run a configured command to completion (build / deploy) and resolve with its exit code. */
export function runToCompletion(projectId: string, key: string, onLine?: (l: string) => void): Promise<{ code: number | null; id: string }> {
  return new Promise((resolve, reject) => {
    startProcess(projectId, key, { onLine }).then((proc) => {
      const e = live.get(proc.id)!;
      e.child.on('exit', (code) => resolve({ code, id: proc.id }));
      e.child.on('error', (err) => reject(err));
    }, reject);
  });
}

const mine = (id: string) => { const e = live.get(id); return e && e.ws === currentWs() ? e : undefined; };

export async function stopProcess(id: string) {
  const e = mine(id);
  if (!e || e.proc.status !== 'running') throw new HttpError(404, 'Process is not running');
  e.proc.status = 'stopped';
  if (e.child.pid) await killTree(e.child.pid);
  audit('process.stop', e.proc.projectId, { key: e.proc.commandKey });
}

export async function restartProcess(id: string) {
  const e = mine(id);
  if (!e) throw new HttpError(404, 'Unknown process');
  if (e.proc.status === 'running') { await stopProcess(id); await new Promise((r) => setTimeout(r, 500)); }
  return startProcess(e.proc.projectId, e.proc.commandKey);
}

export function listProcesses(): ManagedProcess[] {
  const self: ManagedProcess = { id: 'pulse', projectId: '', projectName: 'PROJECT PULSE', command: 'dashboard backend', commandKey: 'server', port: PORT, pid: process.pid, status: 'running', startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(), url: `http://127.0.0.1:${PORT}/` };
  const history = db().all<Row>(`SELECT p.*, pr.name FROM processes p JOIN projects pr ON pr.id = p.project_id ORDER BY started_at DESC LIMIT 30`)
    .filter((r) => !live.has(r.id))
    .map((r) => ({ id: r.id, projectId: r.project_id, projectName: r.name, command: r.command, commandKey: r.command_key, port: r.port ?? undefined, pid: r.process_id ?? undefined, status: r.status === 'running' ? 'stopped' : r.status, exitCode: r.exit_code, startedAt: r.started_at, endedAt: r.ended_at ?? undefined }) as ManagedProcess);
  return [self, ...[...live.values()].filter((l) => l.ws === currentWs()).map((l) => l.proc), ...history];
}
export function processLogs(id: string) { return mine(id)?.logs ?? []; }
export const runningCount = () => [...live.values()].filter((l) => l.ws === currentWs() && l.proc.status === 'running').length;

/** On startup, processes from a previous run cannot be re-attached. */
export function markStaleProcesses() { db().run(`UPDATE processes SET status = 'stopped', ended_at = COALESCE(ended_at, ?) WHERE status = 'running'`, now()); }
export async function stopAll(ws?: string) { for (const e of live.values()) if ((!ws || e.ws === ws) && e.proc.status === 'running' && e.child.pid) { e.proc.status = 'stopped'; await killTree(e.child.pid); } }

/** Open folder / editor / terminal on the local desktop (fire-and-forget, fixed argument lists). */
export function openLocal(kind: 'folder' | 'editor' | 'terminal', dir: string, editorCmd: string, terminalCmd: string) {
  const detach = (cmd: string, args: string[], shell = false, fallback?: () => void) => {
    const c = spawn(cmd, args, { cwd: dir, detached: true, stdio: 'ignore', windowsHide: false, shell });
    c.on('error', () => fallback?.()); c.unref();
  };
  const cmdTerminal = () => detach(process.env.ComSpec || 'cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', `cd /d "${dir}"`]);
  if (kind === 'folder') {
    if (IS_WIN) detach('explorer.exe', [dir]); else if (process.platform === 'darwin') detach('open', [dir]); else detach('xdg-open', [dir]);
  } else if (kind === 'editor') {
    detach(editorCmd || 'code', [dir], IS_WIN); // `code` is a .cmd shim on Windows
  } else {
    if (IS_WIN) {
      if ((terminalCmd || 'wt') === 'wt') detach('wt.exe', ['-d', dir], false, cmdTerminal);
      else if (terminalCmd === 'powershell') detach(process.env.ComSpec || 'cmd.exe', ['/c', 'start', '', 'powershell.exe', '-NoExit', '-Command', `Set-Location -LiteralPath '${dir.replace(/'/g, "''")}'`]);
      else cmdTerminal();
    } else if (process.platform === 'darwin') detach('open', ['-a', 'Terminal', dir]);
    else detach(terminalCmd || 'x-terminal-emulator', [], false);
  }
}
