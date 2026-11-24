import { DatabaseSync, type StatementSync } from 'node:sqlite';
import path from 'node:path';
import { currentWs, wsDataDir } from '../workspace/context.js';

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  root_path TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  lifecycle TEXT NOT NULL DEFAULT 'development',
  thumbnail TEXT,
  technologies TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  favorite INTEGER NOT NULL DEFAULT 0,
  importance TEXT NOT NULL DEFAULT 'medium',
  genre TEXT, version TEXT, repo_url TEXT, dev_url TEXT, dev_port INTEGER,
  last_local_update TEXT, last_activity TEXT, last_deployment TEXT, last_scan_at TEXT,
  deploy_state TEXT, git TEXT, health TEXT, errors TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_settings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  ignore_rules TEXT NOT NULL DEFAULT '[]',
  commands TEXT NOT NULL DEFAULT '{}',
  monitoring_enabled INTEGER NOT NULL DEFAULT 1,
  git_enabled INTEGER NOT NULL DEFAULT 1,
  deployment_monitoring INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS file_index (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  hash TEXT,
  size INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  kind TEXT NOT NULL,
  deploy INTEGER NOT NULL DEFAULT 0,
  build INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, path)
);
CREATE INDEX IF NOT EXISTS ix_file_index_hash ON file_index(hash);
CREATE TABLE IF NOT EXISTS file_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  old_path TEXT,
  event_type TEXT NOT NULL,
  kind TEXT,
  size INTEGER, prev_size INTEGER,
  detail TEXT,
  detected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_events_project_time ON file_events(project_id, detected_at);
CREATE INDEX IF NOT EXISTS ix_events_time ON file_events(detected_at);
CREATE TABLE IF NOT EXISTS git_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch TEXT, commit_hash TEXT, dirty_count INTEGER, taken_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_git_snap ON git_snapshots(project_id, taken_at);
CREATE TABLE IF NOT EXISTS git_commits (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hash TEXT NOT NULL, message TEXT, author TEXT, committed_at TEXT NOT NULL, branch TEXT,
  PRIMARY KEY (project_id, hash)
);
CREATE INDEX IF NOT EXISTS ix_commits_time ON git_commits(committed_at);
CREATE TABLE IF NOT EXISTS hosting_targets (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'none',
  firebase_project TEXT NOT NULL DEFAULT '',
  site_id TEXT NOT NULL DEFAULT '',
  remote_path TEXT NOT NULL DEFAULT '/',
  public_url TEXT NOT NULL DEFAULT '',
  deploy_directory TEXT NOT NULL DEFAULT '.'
);
CREATE INDEX IF NOT EXISTS ix_hosting_site ON hosting_targets(site_id);
CREATE TABLE IF NOT EXISTS deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  release_id TEXT, version_id TEXT,
  deployed_at TEXT NOT NULL,
  deployed_by TEXT,
  status TEXT NOT NULL,
  message TEXT,
  affects_project INTEGER NOT NULL DEFAULT 1,
  file_count INTEGER,
  local_version TEXT,
  subtree_digest TEXT,
  UNIQUE (project_id, release_id)
);
CREATE INDEX IF NOT EXISTS ix_deploy_project_time ON deployments(project_id, deployed_at);
CREATE TABLE IF NOT EXISTS deployment_manifests (
  deployment_id INTEGER NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content_hash TEXT,
  local_hash TEXT,
  PRIMARY KEY (deployment_id, path)
);
CREATE TABLE IF NOT EXISTS hosting_versions (
  version_id TEXT PRIMARY KEY, site_id TEXT NOT NULL, fetched_at TEXT NOT NULL, file_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hosting_version_files (
  version_id TEXT NOT NULL REFERENCES hosting_versions(version_id) ON DELETE CASCADE,
  path TEXT NOT NULL, hash TEXT NOT NULL,
  PRIMARY KEY (version_id, path)
);
CREATE TABLE IF NOT EXISTS hash_pairs (local_hash TEXT NOT NULL, remote_hash TEXT NOT NULL, verified_at TEXT NOT NULL, method TEXT, PRIMARY KEY (local_hash, remote_hash));
CREATE TABLE IF NOT EXISTS gzip_hashes (local_hash TEXT PRIMARY KEY, gzip_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS development_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL, ended_at TEXT NOT NULL, events INTEGER NOT NULL, minutes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessions ON development_sessions(project_id, started_at);
CREATE TABLE IF NOT EXISTS daily_activity (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  changes INTEGER NOT NULL DEFAULT 0, commits INTEGER NOT NULL DEFAULT 0, sessions INTEGER NOT NULL DEFAULT 0,
  minutes INTEGER NOT NULL DEFAULT 0, assets INTEGER NOT NULL DEFAULT 0, deployments INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, date)
);
CREATE INDEX IF NOT EXISTS ix_daily_date ON daily_activity(date);
CREATE TABLE IF NOT EXISTS assets (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL, type TEXT NOT NULL, ext TEXT NOT NULL,
  width INTEGER, height INTEGER, size INTEGER NOT NULL, hash TEXT, modified_at TEXT NOT NULL,
  PRIMARY KEY (project_id, path)
);
CREATE INDEX IF NOT EXISTS ix_assets_hash ON assets(hash);
CREATE TABLE IF NOT EXISTS dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dependency_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version TEXT, source TEXT NOT NULL, detail TEXT,
  UNIQUE (project_id, dependency_id, source)
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'todo', priority TEXT NOT NULL DEFAULT 'medium', due_date TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL, message TEXT NOT NULL, dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL, read_at TEXT
);
CREATE TABLE IF NOT EXISTS project_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'note',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS processes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  command_key TEXT NOT NULL, command TEXT NOT NULL, port INTEGER, process_id INTEGER,
  status TEXT NOT NULL, exit_code INTEGER, started_at TEXT NOT NULL, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS health_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL, ok INTEGER NOT NULL, status INTEGER, latency_ms INTEGER, bytes INTEGER, error TEXT, checked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_health ON health_checks(project_id, checked_at);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL, project_id TEXT, detail TEXT, at TEXT NOT NULL
);
`;

export type Row = Record<string, any>;

class Db {
  readonly raw: DatabaseSync;
  private cache = new Map<string, StatementSync>();
  constructor(file: string) {
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.raw.exec(SCHEMA);
  }
  private stmt(sql: string) {
    let s = this.cache.get(sql);
    if (!s) { s = this.raw.prepare(sql); this.cache.set(sql, s); }
    return s;
  }
  all<T = Row>(sql: string, ...params: any[]): T[] { return this.stmt(sql).all(...params) as T[]; }
  get<T = Row>(sql: string, ...params: any[]): T | undefined { return this.stmt(sql).get(...params) as T | undefined; }
  run(sql: string, ...params: any[]) { return this.stmt(sql).run(...params); }
  exec(sql: string) { this.raw.exec(sql); }
  private depth = 0;
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth++;
    this.raw.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.raw.exec('COMMIT'); return r; }
    catch (e) { this.raw.exec('ROLLBACK'); throw e; }
    finally { this.depth--; }
  }
  meta(key: string): string | undefined { return this.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)?.value; }
  setMeta(key: string, value: string) { this.run('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value); }
  close() { this.raw.close(); }
}

const instances = new Map<string, Db>();
/** Database of the current workspace (see workspace/context.ts). */
export function db(ws = currentWs()): Db {
  let d = instances.get(ws);
  if (!d) {
    d = new Db(process.env.PULSE_DB === ':memory:' ? ':memory:' : path.join(wsDataDir(ws), 'project-pulse.db'));
    instances.set(ws, d);
  }
  return d;
}
export function closeDb(ws?: string) {
  for (const [k, d] of instances) if (!ws || k === ws) { try { d.close(); } catch { /* ignore */ } instances.delete(k); }
}
export function resetDbForTests() { closeDb(); }

export const now = () => new Date().toISOString();
export const json = <T>(s: string | null | undefined, fallback: T): T => { if (!s) return fallback; try { return JSON.parse(s) as T; } catch { return fallback; } };
