import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DiscoveredProject } from '@pulse/shared';
import { DEFAULT_EXCLUDES } from '@pulse/shared';
import { db, json, now, type Row } from '../../database/db.js';
import { canonical, validateProjectRoot } from '../../security/paths.js';
import { compileIgnore } from '../../security/ignore.js';
import { broadcast } from '../../websocket/hub.js';
import { IS_WIN } from '../../config.js';
import { inspectDirectory } from './discover.js';
import { rememberPath } from './browse.js';

/**
 * Bulk discovery as a background job: the backend walks the folder tree asynchronously,
 * writes each detected project into SQLite (discovery_results) as soon as it is found and
 * reports progress; the UI simply reads the job from the database while it runs.
 */
export interface DiscoveryJob {
  id: string; rootPath: string; maxDepth: number; status: 'running' | 'done' | 'cancelled' | 'failed';
  dirsScanned: number; found: number; current?: string; error?: string; startedAt: string; finishedAt?: string;
  results: DiscoveredProject[];
}

const cancelled = new Set<string>();
const norm = (s: string) => (IS_WIN ? s.toLowerCase() : s);
const INNER = /^(public|src|assets|images|img|audio|sounds|sfx|music|css|js|lib|vendor|docs|test|tests|scripts|dist|build|out|node_modules)$/i;
const yieldLoop = () => new Promise<void>((r) => setImmediate(r));

export function startDiscovery(rootPath: string, maxDepth = 2): DiscoveryJob {
  const root = validateProjectRoot(rootPath);
  rememberPath(root);
  const id = crypto.randomUUID();
  db().run(`INSERT INTO discovery_jobs(id, root_path, max_depth, status, started_at) VALUES (?, ?, ?, 'running', ?)`, id, root, maxDepth, now());
  // keep only the 10 most recent jobs
  db().run(`DELETE FROM discovery_jobs WHERE id NOT IN (SELECT id FROM discovery_jobs ORDER BY started_at DESC LIMIT 10)`);
  void run(id, root, maxDepth);
  return getJob(id)!;
}

async function run(id: string, root: string, maxDepth: number) {
  const ignore = compileIgnore(DEFAULT_EXCLUDES);
  let scanned = 0, found = 0, seq = 0, lastReport = 0;
  const report = (current: string, force = false) => {
    if (!force && Date.now() - lastReport < 250) return;
    lastReport = Date.now();
    db().run('UPDATE discovery_jobs SET dirs_scanned = ?, found = ?, current = ? WHERE id = ?', scanned, found, current, id);
    broadcast('discovery.progress', undefined, { id, scanned, found, current });
  };
  const visit = async (dir: string, depth: number, insideProject: boolean): Promise<void> => {
    if (depth > maxDepth || cancelled.has(id)) return;
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (cancelled.has(id)) return;
      if (!e.isDirectory() || e.isSymbolicLink() || e.name.startsWith('.') || e.name.startsWith('$') || ignore.dir(e.name, e.name)) continue;
      if (insideProject && INNER.test(e.name)) continue;
      const full = path.join(dir, e.name);
      scanned++;
      const info = inspectDirectory(full);
      if (info) {
        found++;
        db().run('INSERT OR REPLACE INTO discovery_results(job_id, root_path, data, seq) VALUES (?, ?, ?, ?)', id, full, JSON.stringify({ ...info, nested: insideProject }), seq++);
        report(full, true);
      } else report(full);
      if (scanned % 25 === 0) await yieldLoop(); // keep the server responsive on huge trees
      await visit(full, depth + 1, insideProject || !!info);
    }
  };
  try {
    await visit(root, 1, false);
    const status = cancelled.has(id) ? 'cancelled' : 'done';
    db().run('UPDATE discovery_jobs SET status = ?, dirs_scanned = ?, found = ?, current = NULL, finished_at = ? WHERE id = ?', status, scanned, found, now(), id);
  } catch (e) {
    db().run(`UPDATE discovery_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`, (e as Error).message, now(), id);
  } finally {
    cancelled.delete(id);
    broadcast('discovery.progress', undefined, { id, done: true });
  }
}

export function cancelDiscovery(id: string) { cancelled.add(id); }

export function getJob(id: string): DiscoveryJob | undefined {
  const j = db().get<Row>('SELECT * FROM discovery_jobs WHERE id = ?', id);
  if (!j) return undefined;
  const registered = new Set(db().all<{ root_path: string }>('SELECT root_path FROM projects').map((r) => norm(canonical(r.root_path))));
  const results = db().all<{ root_path: string; data: string }>('SELECT root_path, data FROM discovery_results WHERE job_id = ? ORDER BY seq', id)
    .map((r) => ({ ...json<DiscoveredProject>(r.data, {} as DiscoveredProject), alreadyRegistered: registered.has(norm(canonical(r.root_path))) }));
  return { id: j.id, rootPath: j.root_path, maxDepth: j.max_depth, status: j.status, dirsScanned: j.dirs_scanned, found: j.found, current: j.current ?? undefined,
    error: j.error ?? undefined, startedAt: j.started_at, finishedAt: j.finished_at ?? undefined, results };
}

export function latestJob(): DiscoveryJob | undefined {
  const j = db().get<{ id: string }>('SELECT id FROM discovery_jobs ORDER BY started_at DESC LIMIT 1');
  return j ? getJob(j.id) : undefined;
}

/** Jobs interrupted by a server restart are marked as such. */
export function markStaleDiscoveries() {
  db().run(`UPDATE discovery_jobs SET status = 'cancelled', error = 'Interrupted by restart', finished_at = ? WHERE status = 'running'`, now());
}
