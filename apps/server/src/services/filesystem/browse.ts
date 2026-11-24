import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROJECT_MARKERS } from '@pulse/shared';
import { db, json, now } from '../../database/db.js';
import { canonical } from '../../security/paths.js';
import { IS_WIN } from '../../config.js';
import { pool } from '../../util.js';
import { HttpError } from '../projects.js';

/**
 * In-app folder browser (replaces the slow native Windows dialog).
 * Directory names only — file contents are never read here. Listings are cached in SQLite (dir_cache)
 * so re-opening a folder is instant; a fresh read refreshes the cache in the background.
 */
export interface DirEntry { name: string; path: string; isProject: boolean; markers: string[]; registered: boolean }
export interface DirListing { path: string; parent: string | null; entries: DirEntry[]; truncated: boolean; scannedAt: string; cached: boolean }

const SKIP = /^(\$recycle\.bin|system volume information|\$windows\.~bt|\$windows\.~ws|config\.msi|recovery|msocache|node_modules|\.git|\.cache|\.npm|appdata)$/i;
const MARKERS_LOWER = PROJECT_MARKERS.map((m) => m.toLowerCase());
const MAX_ENTRIES = 1000;
const FRESH_MS = 15_000;

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
const norm = (s: string) => (IS_WIN ? s.toLowerCase() : s);

function registeredSet() {
  return new Set(db().all<{ root_path: string }>('SELECT root_path FROM projects').map((r) => norm(canonical(r.root_path))));
}

export function normalizeDir(p: string): string {
  let t = (p ?? '').trim().replace(/^"|"$/g, '');
  if (IS_WIN && /^[a-zA-Z]:$/.test(t)) t += '\\';
  if (!path.isAbsolute(t)) throw new HttpError(400, 'Use an absolute folder path');
  return path.resolve(t);
}

async function readListing(dir: string, hidden: boolean): Promise<DirListing> {
  let dirents: fs.Dirent[];
  try { dirents = await withTimeout(fs.promises.readdir(dir, { withFileTypes: true }), 8000, null as unknown as fs.Dirent[]); }
  catch (e) { throw new HttpError((e as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 403, `Cannot open folder: ${(e as Error).message}`); }
  if (!dirents) throw new HttpError(504, 'Folder took too long to open (network drive?)');
  const reg = registeredSet();
  const dirs = dirents.filter((d) => d.isDirectory() && !d.isSymbolicLink() && !SKIP.test(d.name) && (hidden || (!d.name.startsWith('.') && !d.name.startsWith('$'))))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const slice = dirs.slice(0, MAX_ENTRIES);
  const entries = await pool(slice, 24, async (d): Promise<DirEntry> => {
    const full = path.join(dir, d.name);
    let names: string[] = [];
    try { names = await withTimeout(fs.promises.readdir(full), 1500, []); } catch { /* no access */ }
    const lower = new Set(names.map((n) => n.toLowerCase()));
    const markers = PROJECT_MARKERS.filter((_, i) => lower.has(MARKERS_LOWER[i]));
    return { name: d.name, path: full, isProject: markers.length > 0, markers, registered: reg.has(norm(canonical(full))) };
  });
  const parent = path.dirname(dir);
  return { path: dir, parent: parent === dir ? null : parent, entries, truncated: dirs.length > MAX_ENTRIES, scannedAt: now(), cached: false };
}

const refreshing = new Set<string>();
export async function listDirectory(p: string, hidden = false, fresh = false): Promise<DirListing> {
  const dir = normalizeDir(p);
  const key = `${hidden ? 'h:' : ''}${norm(dir)}`;
  const cached = db().get<{ entries: string; scanned_at: string }>('SELECT entries, scanned_at FROM dir_cache WHERE path = ?', key);
  const store = (l: DirListing) => db().run('INSERT INTO dir_cache(path, entries, scanned_at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET entries = excluded.entries, scanned_at = excluded.scanned_at', key, JSON.stringify(l), l.scannedAt);
  if (cached && !fresh) {
    const l = json<DirListing | undefined>(cached.entries, undefined);
    if (l) {
      if (Date.now() - Date.parse(cached.scanned_at) > FRESH_MS && !refreshing.has(key)) {
        refreshing.add(key);
        void readListing(dir, hidden).then(store, () => db().run('DELETE FROM dir_cache WHERE path = ?', key)).finally(() => refreshing.delete(key));
      }
      // registration flags can change any time — recompute from the projects table
      const reg = registeredSet();
      return { ...l, cached: true, entries: l.entries.map((e) => ({ ...e, registered: reg.has(norm(canonical(e.path))) })) };
    }
  }
  const l = await readListing(dir, hidden);
  store(l);
  return l;
}

export interface Place { label: string; path: string; kind: 'drive' | 'home' | 'recent' | 'project-parent' | 'place' }
/** Drives, common folders, folders containing registered projects and recently used paths. */
export async function roots(): Promise<Place[]> {
  const out: Place[] = [];
  const home = os.homedir();
  for (const r of db().all<{ path: string }>('SELECT path FROM recent_paths ORDER BY used_at DESC LIMIT 8')) out.push({ label: r.path, path: r.path, kind: 'recent' });
  const parents = new Set<string>();
  for (const r of db().all<{ root_path: string }>('SELECT root_path FROM projects')) parents.add(path.dirname(r.root_path));
  for (const p of [...parents].slice(0, 8)) out.push({ label: p, path: p, kind: 'project-parent' });
  out.push({ label: 'Home', path: home, kind: 'home' });
  for (const [label, sub] of [['Desktop', 'Desktop'], ['Documents', 'Documents'], ['Downloads', 'Downloads']] as const) {
    const p = path.join(home, sub);
    if (await withTimeout(fs.promises.access(p).then(() => true, () => false), 800, false)) out.push({ label, path: p, kind: 'place' });
  }
  if (IS_WIN) {
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const ok = await Promise.all(letters.map((l) => withTimeout(fs.promises.access(`${l}:\\`).then(() => true, () => false), 1200, false)));
    letters.forEach((l, i) => { if (ok[i]) out.push({ label: `${l}:\\`, path: `${l}:\\`, kind: 'drive' }); });
  } else out.push({ label: '/', path: '/', kind: 'drive' });
  const seen = new Set<string>();
  return out.filter((p) => { const k = norm(p.path) + p.kind; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function rememberPath(p: string) {
  try {
    const dir = normalizeDir(p);
    db().run('INSERT INTO recent_paths(path, used_at) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET used_at = excluded.used_at', dir, now());
    db().run('DELETE FROM recent_paths WHERE path NOT IN (SELECT path FROM recent_paths ORDER BY used_at DESC LIMIT 20)');
  } catch { /* ignore invalid */ }
}
