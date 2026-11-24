import fs from 'node:fs';
import path from 'node:path';
import { EXT_KIND, type Project } from '@pulse/shared';
import { db, now } from '../../database/db.js';
import { compileIgnore, globToRe, type IgnoreMatcher } from '../../security/ignore.js';
import { isSecretFile } from '../../security/secrets.js';
import { toPosix } from '../../security/paths.js';
import { extOf, hashFile, KeyedMutex, pool } from '../../util.js';
import { deployDirOf, getProject, ignoreRulesFor, setError } from '../projects.js';
import { broadcast } from '../../websocket/hub.js';
import { runAfterScan, type ScanResult } from '../hooks.js';
import { assetType } from '../assets/image-info.js';

const MAX_HASH_BYTES = 1024 * 1024 * 1024; // files larger than 1 GB are compared by size + mtime only

export interface ScanScope {
  root: string;
  ignore: IgnoreMatcher;
  /** posix path of deploy dir relative to root ('' = root), undefined if not deployable */
  deployRel?: string;
  /** deploy dir is excluded from normal activity (e.g. dist/) and treated as build output */
  deployIsBuild: boolean;
  firebaseIgnore: RegExp[];
}

interface Stat { size: number; mtimeMs: number }
interface IndexRow { path: string; hash: string | null; size: number; mtime_ms: number; kind: string; deploy: number; build: number }

export function readFirebaseIgnore(root: string, deployRel: string | undefined): RegExp[] {
  let patterns = ['firebase.json', '**/.*', '**/node_modules/**'];
  try {
    const fj = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
    const hosting = Array.isArray(fj.hosting) ? fj.hosting.find((h: any) => toPosix(h.public ?? '') === deployRel) ?? fj.hosting[0] : fj.hosting;
    if (hosting && Array.isArray(hosting.ignore)) patterns = hosting.ignore;
  } catch { /* defaults */ }
  return patterns.map((p) => globToRe(p.replace(/^\/+/, '')));
}

export function scopeFor(p: Project): ScanScope {
  const ignore = compileIgnore(ignoreRulesFor(p));
  const dd = deployDirOf(p);
  const deployRel = dd === undefined ? undefined : toPosix(path.relative(p.rootPath, dd));
  let deployIsBuild = false;
  if (deployRel) {
    const parts = deployRel.split('/');
    deployIsBuild = parts.some((_, i) => ignore.dir(parts.slice(0, i + 1).join('/'), parts[i]));
  }
  return { root: p.rootPath, ignore, deployRel, deployIsBuild, firebaseIgnore: readFirebaseIgnore(p.rootPath, deployRel) };
}

/** Classify a relative path inside a scope. Returns undefined when it must not be indexed. */
export function classify(scope: ScanScope, rel: string): { deploy: boolean; build: boolean } | undefined {
  const name = rel.split('/').pop()!;
  if (isSecretFile(rel)) return undefined;
  const dr = scope.deployRel;
  const inDeploy = dr !== undefined && (dr === '' || rel === dr || rel.startsWith(dr + '/'));
  const relToDeploy = inDeploy ? (dr ? rel.slice(dr.length + 1) : rel) : '';
  // ignore rules (directories along the path + file rule)
  const parts = rel.split('/');
  let ignored = scope.ignore.file(rel, name);
  for (let i = 0; i < parts.length - 1 && !ignored; i++) ignored = scope.ignore.dir(parts.slice(0, i + 1).join('/'), parts[i]);
  if (inDeploy && scope.deployIsBuild) {
    // inside an excluded build directory: only skip hard exclusions
    if (/(^|\/)(node_modules|\.git)(\/|$)/.test(relToDeploy) || /\.(log|tmp)$/i.test(name)) return undefined;
    return { deploy: !scope.firebaseIgnore.some((r) => r.test(relToDeploy)), build: true };
  }
  if (ignored) return undefined;
  return { deploy: inDeploy && !scope.firebaseIgnore.some((r) => r.test(relToDeploy)), build: false };
}

/** Recursive walk honouring ignore rules; never follows symlinks/junctions. */
export async function walkScope(scope: ScanScope, subdir = ''): Promise<Map<string, Stat>> {
  const out = new Map<string, Stat>();
  const dr = scope.deployRel;
  const visit = async (relDir: string) => {
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(path.join(scope.root, relDir), { withFileTypes: true }); } catch { return; }
    const subdirs: string[] = [];
    await pool(entries, 16, async (e) => {
      if (e.isSymbolicLink()) return;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const towardsDeploy = dr !== undefined && dr !== '' && (dr === rel || dr.startsWith(rel + '/') || rel.startsWith(dr + '/'));
        if (!towardsDeploy && scope.ignore.dir(rel, e.name)) return;
        if (towardsDeploy && rel.startsWith(dr + '/') && /^(node_modules|\.git)$/.test(e.name)) return;
        if (!towardsDeploy && e.name === '.git') return;
        subdirs.push(rel);
      } else if (e.isFile()) {
        if (!classify(scope, rel)) return;
        try { const st = await fs.promises.stat(path.join(scope.root, rel)); out.set(rel, { size: st.size, mtimeMs: st.mtimeMs }); } catch { /* vanished */ }
      }
    });
    for (const d of subdirs) await visit(d);
  };
  await visit(subdir);
  return out;
}

const mutex = new KeyedMutex();
const kindOf = (rel: string) => EXT_KIND[extOf(rel)] ?? 'other';

/**
 * Full or partial reconciliation of a project's file index against disk.
 * Emits created / modified / deleted / renamed events with debounced, hash-verified semantics.
 * @param subset  relative paths (files or dirs) to check; undefined = full scan
 */
export function scanProject(projectId: string, subset?: string[]): Promise<ScanResult | undefined> {
  return mutex.run(projectId, async () => {
    let p: Project;
    try { p = getProject(projectId); } catch { return undefined; }
    try {
      const r = await doScan(p, subset);
      setError(p.id, 'scan', null);
      return r;
    } catch (e) {
      setError(p.id, 'scan', (e as Error).message);
      broadcast('project.updated', p.id);
      return undefined;
    }
  });
}

async function doScan(p: Project, subset?: string[]): Promise<ScanResult> {
  if (!fs.existsSync(p.rootPath)) throw new Error('Project directory is missing: ' + p.rootPath);
  const scope = scopeFor(p);
  const prevScan = p.lastScanAt ? Date.parse(p.lastScanAt) : 0;
  const initial = !p.lastScanAt;

  // 1. Collect current state for the requested scope
  let current: Map<string, Stat>;
  let prior: IndexRow[];
  if (!subset) {
    current = await walkScope(scope);
    prior = db().all<IndexRow>('SELECT path, hash, size, mtime_ms, kind, deploy, build FROM file_index WHERE project_id = ?', p.id);
  } else {
    current = new Map();
    const uniq = [...new Set(subset.map((s) => s.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')))];
    prior = [];
    for (const rel of uniq) {
      const abs = path.join(p.rootPath, rel);
      let st: fs.Stats | undefined;
      try { st = await fs.promises.lstat(abs); } catch { st = undefined; }
      if (st?.isDirectory()) { for (const [k, v] of await walkScope(scope, rel)) current.set(k, v); }
      else if (st?.isFile() && classify(scope, rel)) current.set(rel, { size: st.size, mtimeMs: st.mtimeMs });
      prior.push(...db().all<IndexRow>(`SELECT path, hash, size, mtime_ms, kind, deploy, build FROM file_index WHERE project_id = ? AND (path = ? OR path LIKE ? ESCAPE '\\')`,
        p.id, rel, rel.replace(/[%_\\]/g, '\\$&') + '/%'));
    }
  }
  const priorMap = new Map(prior.map((r) => [r.path, r]));

  // 2. Diff
  const toHash: string[] = [];
  for (const [rel, st] of current) {
    const old = priorMap.get(rel);
    if (!old || old.size !== st.size || Math.abs(old.mtime_ms - st.mtimeMs) > 1 || !old.hash) toHash.push(rel);
  }
  const hashes = new Map<string, string | null>();
  await pool(toHash, 8, async (rel) => {
    const st = current.get(rel)!;
    if (st.size > MAX_HASH_BYTES) { hashes.set(rel, null); return; }
    try { hashes.set(rel, await hashFile(path.join(p.rootPath, rel))); } catch { hashes.set(rel, null); }
  });

  const ts = now();
  const nowMs = Date.now();
  const created: string[] = [], modified: string[] = [], deleted: string[] = [];
  const renamed: { from: string; to: string }[] = [];
  const events: [string, string | null, string, string, number | null, number | null, string | null, string][] = [];
  const timeFor = (st: Stat) => (st.mtimeMs > prevScan && st.mtimeMs <= nowMs + 1000 ? new Date(Math.min(st.mtimeMs, nowMs)).toISOString() : ts);
  let deployChanged = false, buildChanged = false, assetChanged = false;
  let latestMeaningful = 0;

  const deletedRows = prior.filter((r) => !current.has(r.path));
  const deletedByHash = new Map<string, IndexRow[]>();
  for (const r of deletedRows) if (r.hash) (deletedByHash.get(r.hash) ?? deletedByHash.set(r.hash, []).get(r.hash)!).push(r);

  db().tx(() => {
    for (const rel of toHash) {
      const st = current.get(rel)!;
      const old = priorMap.get(rel);
      const hash = hashes.get(rel) ?? null;
      const cls = classify(scope, rel)!;
      const kind = cls.build ? 'build' : kindOf(rel);
      db().run(`INSERT INTO file_index(project_id, path, hash, size, mtime_ms, kind, deploy, build) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, path) DO UPDATE SET hash = excluded.hash, size = excluded.size, mtime_ms = excluded.mtime_ms, kind = excluded.kind, deploy = excluded.deploy, build = excluded.build`,
        p.id, rel, hash, st.size, st.mtimeMs, kind, cls.deploy ? 1 : 0, cls.build ? 1 : 0);
      if (initial) continue;
      const changed = !old || !old.hash || !hash || old.hash !== hash;
      if (!changed) continue; // touched but content identical: not meaningful
      if (cls.deploy) deployChanged = true;
      if (cls.build) buildChanged = true;
      if (kind === 'asset') assetChanged = true;
      const at = timeFor(st);
      if (!old) {
        const twin = hash ? deletedByHash.get(hash)?.shift() : undefined;
        if (twin) {
          renamed.push({ from: twin.path, to: rel });
          events.push([rel, twin.path, 'renamed', kind, st.size, twin.size, null, at]);
          deletedRows.splice(deletedRows.indexOf(twin), 1);
        } else { created.push(rel); events.push([rel, null, 'created', kind, st.size, null, null, at]); }
      } else { modified.push(rel); events.push([rel, null, 'modified', kind, st.size, old.size, null, at]); }
      if (!cls.build) latestMeaningful = Math.max(latestMeaningful, Date.parse(at));
    }
    // Reclassify rows whose deploy/build flags changed due to config edits (full scan only)
    if (!subset) {
      for (const [rel] of current) {
        const old = priorMap.get(rel);
        if (!old || hashes.has(rel)) continue;
        const cls = classify(scope, rel)!;
        if (old.deploy !== (cls.deploy ? 1 : 0) || old.build !== (cls.build ? 1 : 0)) {
          db().run('UPDATE file_index SET deploy = ?, build = ?, kind = ? WHERE project_id = ? AND path = ?', cls.deploy ? 1 : 0, cls.build ? 1 : 0, cls.build ? 'build' : kindOf(rel), p.id, rel);
          deployChanged = true;
        }
      }
    }
    for (const r of deletedRows) {
      db().run('DELETE FROM file_index WHERE project_id = ? AND path = ?', p.id, r.path);
      if (initial) continue;
      deleted.push(r.path);
      if (r.deploy) deployChanged = true;
      if (r.build) buildChanged = true;
      if (r.kind === 'asset') assetChanged = true;
      events.push([r.path, null, 'deleted', r.kind, null, r.size, null, ts]);
      if (!r.build) latestMeaningful = Math.max(latestMeaningful, nowMs);
    }
    if (buildChanged) {
      const n = events.filter((e) => e[3] === 'build').length;
      events.push([scope.deployRel || '.', null, 'build_completed', 'build', null, null, `${n} output file(s) updated`, ts]);
    }
    for (const e of events) {
      db().run('INSERT INTO file_events(project_id, path, old_path, event_type, kind, size, prev_size, detail, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', p.id, ...e);
    }

    // 3. Project timestamps
    const fields: Record<string, unknown> = { last_scan_at: ts };
    if (initial) {
      const m = db().get<{ m: number | null }>('SELECT MAX(mtime_ms) AS m FROM file_index WHERE project_id = ? AND build = 0', p.id)?.m;
      if (m) fields.last_local_update = new Date(Math.min(m, nowMs)).toISOString();
      if (!fs.existsSync(path.join(p.rootPath, '.git'))) seedFromMtimes(p.id);
    } else if (latestMeaningful) {
      const iso = new Date(latestMeaningful).toISOString();
      if (!p.lastLocalUpdate || iso > p.lastLocalUpdate) fields.last_local_update = iso;
      fields.last_activity = iso > (p.lastActivity ?? '') ? iso : p.lastActivity;
    }
    db().run(`UPDATE projects SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(fields), p.id);
  });

  const result: ScanResult = { projectId: p.id, initial, created, modified, deleted, renamed, deployChanged: deployChanged || initial, buildChanged, assetChanged: assetChanged || initial, gitDirty: events.length > 0 };
  if (events.length) {
    const sample = events.slice(0, 50).map((e) => ({ path: e[0], oldPath: e[1], type: e[2], kind: e[3] }));
    for (const t of ['created', 'modified', 'deleted', 'renamed'] as const) {
      const items = sample.filter((s) => s.type === t);
      if (items.length) broadcast(`file.${t}`, p.id, items);
    }
  }
  await runAfterScan(result);
  broadcast('project.updated', p.id);
  return result;
}

/**
 * For projects without Git, seed history with each file's last-modified time (real but lossy — one point per file).
 * Events are flagged detail='seed:mtime' so the UI can label them as imported.
 */
function seedFromMtimes(projectId: string) {
  const cutoff = Date.now() - 365 * 86400_000;
  const rows = db().all<{ path: string; mtime_ms: number; kind: string; size: number }>('SELECT path, mtime_ms, kind, size FROM file_index WHERE project_id = ? AND build = 0 AND mtime_ms > ?', projectId, cutoff);
  for (const r of rows) {
    db().run(`INSERT INTO file_events(project_id, path, event_type, kind, size, detail, detected_at) VALUES (?, ?, 'modified', ?, ?, 'seed:mtime', ?)`,
      projectId, r.path, r.kind, r.size, new Date(Math.min(r.mtime_ms, Date.now())).toISOString());
  }
}
