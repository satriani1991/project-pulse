import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { IS_WIN } from '../../config.js';
import { currentWs, wsSubdir } from '../../workspace/context.js';
import { db, now } from '../../database/db.js';
import { DEFAULT_EXCLUDES } from '@pulse/shared';
import { getProject } from '../projects.js';
import { audit } from '../../security/audit.js';
import { notify } from '../notifications/notifications.js';
import { localDate } from '../../util.js';

const dir = (name: string) => { const d = path.join(wsSubdir('backups'), name); fs.mkdirSync(d, { recursive: true }); return d; };

/** Consistent online SQLite backup (VACUUM INTO). Keeps the newest 14 copies. */
export function backupDatabase(): string {
  const DB_DIR = dir('database');
  const file = path.join(DB_DIR, `project-pulse-${localDate()}-${Date.now()}.db`);
  db().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const files = fs.readdirSync(DB_DIR).filter((f) => f.endsWith('.db')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 14))) fs.unlinkSync(path.join(DB_DIR, f)); // only our own backup files
  db().setMeta('last_db_backup', now());
  return file;
}

export function lastBackup(projectId: string): number | undefined {
  const PROJ_DIR = dir('projects');
  let best: number | undefined;
  for (const f of fs.readdirSync(PROJ_DIR)) if (f.startsWith(projectId + '__')) { const t = fs.statSync(path.join(PROJ_DIR, f)).mtimeMs; if (!best || t > best) best = t; }
  return best;
}
export function listBackups(projectId?: string) {
  const PROJ_DIR = dir('projects');
  return fs.readdirSync(PROJ_DIR).filter((f) => !projectId || f.startsWith(projectId + '__')).map((f) => { const st = fs.statSync(path.join(PROJ_DIR, f)); return { file: f, size: st.size, createdAt: st.mtime.toISOString(), path: path.join(PROJ_DIR, f) }; })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const running = new Set<string>();
/** Archive a project's source (excluding dependency / build / temp folders) into data/backups/projects using the system tar (bsdtar on Windows 10+). */
export function backupProject(projectId: string): Promise<string> {
  const p = getProject(projectId);
  const key = `${currentWs()}:${projectId}`;
  if (running.has(key)) return Promise.reject(new Error('Backup already running'));
  running.add(key);
  const PROJ_DIR = dir('projects');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(PROJ_DIR, `${p.id}__${stamp}.${IS_WIN ? 'zip' : 'tar.gz'}`);
  const excludes = DEFAULT_EXCLUDES.map((e) => e.replace(/\/$/, '')).flatMap((e) => ['--exclude', e]);
  const args = IS_WIN ? ['-a', '-c', '-f', out, ...excludes, '--exclude', '.env*', '-C', path.dirname(p.rootPath), path.basename(p.rootPath)]
    : ['-czf', out, ...excludes, '--exclude', '.env*', '-C', path.dirname(p.rootPath), path.basename(p.rootPath)];
  audit('backup.start', projectId, out);
  return new Promise((resolve, reject) => {
    execFile(IS_WIN ? 'tar.exe' : 'tar', args, { timeout: 30 * 60_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err) => {
      running.delete(key);
      if (err && !fs.existsSync(out)) { notify(projectId, 'backup_failed', `${p.name}: backup failed — ${err.message.split('\n')[0]}`); return reject(err); }
      notify(projectId, 'backup_completed', `${p.name}: backup saved (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
      resolve(out);
    });
  });
}
