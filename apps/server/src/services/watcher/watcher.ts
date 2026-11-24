import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { db, now } from '../../database/db.js';
import { toPosix } from '../../security/paths.js';
import { getProject, listProjects } from '../projects.js';
import { getSettings } from '../settings.js';
import { scanProject, scopeFor, type ScanScope } from '../filesystem/scanner.js';
import { broadcast } from '../../websocket/hub.js';
import { currentWs, runInWorkspace } from '../../workspace/context.js';

interface WatchEntry { ws: string; watcher: FSWatcher; scope: ScanScope; pending: Set<string>; dirs: Set<string>; timer?: NodeJS.Timeout; firstAt?: number }
const watchers = new Map<string, WatchEntry>();

/**
 * Real-time monitoring: chokidar reports raw events, which are coalesced per project and debounced
 * (settings.debounceMs, default 3 s). Repeated saves of one file within the window collapse into one
 * hash-verified change, so activity is not inflated. A hard cap flushes long bursts after 30 s.
 */
export async function watchProject(projectId: string) {
  await unwatchProject(projectId);
  const p = getProject(projectId);
  if (!p.monitoringEnabled) return;
  const scope = scopeFor(p);
  const ignored = (abs: string, stats?: { isDirectory(): boolean; isFile(): boolean }) => {
    const rel = toPosix(path.relative(p.rootPath, abs));
    if (!rel || rel.startsWith('..')) return false;
    const name = rel.split('/').pop()!;
    const dr = scope.deployRel;
    const towardsDeploy = !!dr && (dr === rel || dr.startsWith(rel + '/') || rel.startsWith(dr + '/'));
    if (/(^|\/)(node_modules|\.git)(\/|$)/.test(rel)) return true;
    if (towardsDeploy) return false;
    if (stats?.isFile()) return scope.ignore.file(rel, name);
    return scope.ignore.dir(rel, name) || (!stats && scope.ignore.file(rel, name) && /\.[a-z0-9]+$/i.test(name));
  };
  const watcher = chokidar.watch(p.rootPath, {
    ignored, ignoreInitial: true, followSymlinks: false, persistent: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
    usePolling: process.env.PULSE_POLL === '1', interval: 1000,
  });
  const ws = currentWs();
  const entry: WatchEntry = { ws, watcher, scope, pending: new Set(), dirs: new Set() };
  const queue = (abs: string, isDir = false) => {
    const rel = toPosix(path.relative(p.rootPath, abs));
    if (!rel || rel.startsWith('..')) return;
    entry.pending.add(rel);
    if (isDir) entry.dirs.add(rel);
    schedule(projectId, entry);
  };
  watcher.on('add', (f) => queue(f)).on('change', (f) => queue(f)).on('unlink', (f) => queue(f))
    .on('addDir', (d) => queue(d, true)).on('unlinkDir', (d) => queue(d))
    .on('error', (e) => console.error(`[watch] ${p.name}:`, (e as Error).message));
  watchers.set(`${ws}:${projectId}`, entry);
}

function schedule(projectId: string, entry: WatchEntry) {
  const { debounceMs } = getSettings();
  entry.firstAt ??= Date.now();
  if (entry.timer) clearTimeout(entry.timer);
  const wait = Date.now() - entry.firstAt > 30_000 ? 0 : debounceMs;
  entry.timer = setTimeout(() => runInWorkspace(entry.ws, () => flush(projectId, entry)), wait);
}

async function flush(projectId: string, entry: WatchEntry) {
  const paths = [...entry.pending];
  const dirs = [...entry.dirs];
  entry.pending.clear(); entry.dirs.clear(); entry.timer = undefined; entry.firstAt = undefined;
  if (!paths.length) return;
  if (dirs.length) {
    const ts = now();
    db().tx(() => { for (const d of dirs.slice(0, 200)) db().run(`INSERT INTO file_events(project_id, path, event_type, detected_at) VALUES (?, ?, 'dir_created', ?)`, projectId, d, ts); });
  }
  // Large bursts (branch switch, unzip) are cheaper as a full reconciliation
  await scanProject(projectId, paths.length > 500 ? undefined : paths);
}

export async function unwatchProject(projectId: string, ws = currentWs()) {
  const key = `${ws}:${projectId}`;
  const e = watchers.get(key);
  if (!e) return;
  if (e.timer) clearTimeout(e.timer);
  watchers.delete(key);
  await e.watcher.close().catch(() => undefined);
}

export async function watchAll() {
  for (const p of listProjects()) {
    try { await watchProject(p.id); } catch (e) { console.error('[watch]', p.name, (e as Error).message); }
  }
  broadcast('analytics.updated');
}
export const watchedCount = (ws?: string) => [...watchers.values()].filter((e) => !ws || e.ws === ws).length;
export async function closeAll(ws?: string) {
  for (const [key, e] of [...watchers]) {
    if (ws && e.ws !== ws) continue;
    if (e.timer) clearTimeout(e.timer);
    watchers.delete(key);
    await e.watcher.close().catch(() => undefined);
  }
}
