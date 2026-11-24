import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import type { DeploymentConfig, DeploymentState, GitSnapshot, HealthCheck, Project, ProjectStats, ProjectSummary } from '@pulse/shared';
import { DEFAULT_EXCLUDES, projectCreateSchema, projectUpdateSchema } from '@pulse/shared';
import type { z } from 'zod';
import { db, json, now, type Row } from '../database/db.js';
import { daysAgoIso, slugify } from '../util.js';
import { canonical, isInside, validateProjectRoot } from '../security/paths.js';
import { getSettings } from './settings.js';
import { wsSubdir } from '../workspace/context.js';

export class HttpError extends Error { constructor(public statusCode: number, msg: string) { super(msg); } }

const PROJECT_SQL = `SELECT p.*, s.ignore_rules, s.commands, s.monitoring_enabled, s.git_enabled, s.deployment_monitoring,
  h.provider, h.firebase_project, h.site_id, h.remote_path, h.public_url, h.deploy_directory
  FROM projects p LEFT JOIN project_settings s ON s.project_id = p.id LEFT JOIN hosting_targets h ON h.project_id = p.id`;

function rowToProject(r: Row): Project {
  const deployment: DeploymentConfig | undefined = r.provider
    ? { provider: r.provider, firebaseProjectId: r.firebase_project, hostingSiteId: r.site_id, remotePath: r.remote_path, publicUrl: r.public_url, deployDirectory: r.deploy_directory }
    : undefined;
  return {
    id: r.id, name: r.name, description: r.description, rootPath: r.root_path, thumbnailPath: r.thumbnail ?? undefined,
    category: r.category, lifecycle: r.lifecycle, technologies: json(r.technologies, []), tags: json(r.tags, []),
    monitoringEnabled: !!(r.monitoring_enabled ?? 1), gitEnabled: !!(r.git_enabled ?? 1), deploymentMonitoring: !!(r.deployment_monitoring ?? 1),
    favorite: !!r.favorite, importance: r.importance ?? 'medium', genre: r.genre ?? undefined, version: r.version ?? undefined,
    repoUrl: r.repo_url ?? undefined, devUrl: r.dev_url ?? undefined, devPort: r.dev_port ?? undefined,
    deployment, commands: json(r.commands, {}), ignoreRules: json(r.ignore_rules, []),
    lastLocalUpdate: r.last_local_update ?? undefined, lastActivity: r.last_activity ?? undefined,
    lastDeployment: r.last_deployment ?? undefined, lastScanAt: r.last_scan_at ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function listProjects(): Project[] { return db().all(PROJECT_SQL + ' ORDER BY p.name COLLATE NOCASE').map(rowToProject); }
export function getProject(id: string): Project {
  const r = db().get(PROJECT_SQL + ' WHERE p.id = ?', id);
  if (!r) throw new HttpError(404, 'Project not found');
  return rowToProject(r);
}
export function findProject(id: string): Project | undefined { const r = db().get(PROJECT_SQL + ' WHERE p.id = ?', id); return r ? rowToProject(r) : undefined; }

/** Effective ignore rules: defaults + global settings + per-project, minus the deploy directory (indexed separately). */
export function ignoreRulesFor(p: Project): string[] {
  return [...DEFAULT_EXCLUDES, ...getSettings().globalExcludes, ...p.ignoreRules];
}

/** Absolute deploy directory, validated to be inside the project root. */
export function deployDirOf(p: Project): string | undefined {
  if (!p.deployment || p.deployment.provider === 'none') return undefined;
  const d = path.resolve(p.rootPath, p.deployment.deployDirectory || '.');
  if (!isInside(p.rootPath, d)) throw new HttpError(400, 'Deploy directory must be inside the project root');
  return d;
}

export function normaliseRemotePath(p: string | undefined) {
  const t = (p || '/').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return t ? `/${t}/` : '/';
}

export function createProject(input: z.infer<typeof projectCreateSchema>): Project {
  const data = projectCreateSchema.parse(input);
  const root = validateProjectRoot(data.rootPath);
  const existing = db().all<{ id: string; root_path: string }>('SELECT id, root_path FROM projects');
  const cmp = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s);
  if (existing.some((e) => cmp(canonical(e.root_path)) === cmp(root))) throw new HttpError(409, 'This directory is already registered');
  const base = slugify(data.name || path.basename(root));
  let id = base, n = 2;
  while (db().get('SELECT 1 FROM projects WHERE id = ?', id)) id = `${base}-${n++}`;
  const ts = now();
  db().tx(() => {
    db().run(`INSERT INTO projects(id, name, description, root_path, category, lifecycle, thumbnail, technologies, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, data.name || path.basename(root), data.description ?? '', root, data.category ?? 'application', data.lifecycle ?? 'development',
      data.thumbnailPath ?? null, JSON.stringify(data.technologies ?? []), JSON.stringify(data.tags ?? []), ts, ts);
    db().run('INSERT INTO project_settings(project_id, commands, monitoring_enabled, git_enabled, deployment_monitoring) VALUES (?, ?, ?, ?, ?)',
      id, JSON.stringify(data.commands ?? {}), data.monitoringEnabled === false ? 0 : 1, data.gitEnabled === false ? 0 : 1, data.deploymentMonitoring === false ? 0 : 1);
    const d = data.deployment;
    db().run('INSERT INTO hosting_targets(project_id, provider, firebase_project, site_id, remote_path, public_url, deploy_directory) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, d?.provider ?? (d?.hostingSiteId ? 'firebase' : 'none'), d?.firebaseProjectId ?? '', d?.hostingSiteId ?? '', normaliseRemotePath(d?.remotePath), d?.publicUrl ?? '', d?.deployDirectory || '.');
    db().run(`INSERT INTO file_events(project_id, path, event_type, detail, detected_at) VALUES (?, '', 'registered', ?, ?)`, id, root, ts);
  });
  const p = getProject(id);
  if (p.deployment) deployDirOf(p); // validates
  return p;
}

export function updateProject(id: string, input: z.infer<typeof projectUpdateSchema>): Project {
  const p = getProject(id);
  const d = projectUpdateSchema.parse(input);
  db().tx(() => {
    const cols: [string, unknown][] = [];
    if (d.name !== undefined) cols.push(['name', d.name]);
    if (d.description !== undefined) cols.push(['description', d.description]);
    if (d.category !== undefined) cols.push(['category', d.category]);
    if (d.lifecycle !== undefined) cols.push(['lifecycle', d.lifecycle]);
    if (d.technologies !== undefined) cols.push(['technologies', JSON.stringify(d.technologies)]);
    if (d.tags !== undefined) cols.push(['tags', JSON.stringify(d.tags)]);
    if (d.favorite !== undefined) cols.push(['favorite', d.favorite ? 1 : 0]);
    if (d.importance !== undefined) cols.push(['importance', d.importance]);
    if (d.genre !== undefined) cols.push(['genre', d.genre]);
    if (d.version !== undefined) cols.push(['version', d.version]);
    if (d.repoUrl !== undefined) cols.push(['repo_url', d.repoUrl]);
    if (d.devUrl !== undefined) cols.push(['dev_url', d.devUrl]);
    if (d.devPort !== undefined) cols.push(['dev_port', d.devPort]);
    if (d.thumbnailPath !== undefined) cols.push(['thumbnail', d.thumbnailPath]);
    cols.push(['updated_at', now()]);
    db().run(`UPDATE projects SET ${cols.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map(([, v]) => v), id);
    const s: [string, unknown][] = [];
    if (d.ignoreRules !== undefined) s.push(['ignore_rules', JSON.stringify(d.ignoreRules)]);
    if (d.commands !== undefined) s.push(['commands', JSON.stringify(Object.fromEntries(Object.entries(d.commands).filter(([, v]) => v && v.trim())))]);
    if (d.monitoringEnabled !== undefined) s.push(['monitoring_enabled', d.monitoringEnabled ? 1 : 0]);
    if (d.gitEnabled !== undefined) s.push(['git_enabled', d.gitEnabled ? 1 : 0]);
    if (d.deploymentMonitoring !== undefined) s.push(['deployment_monitoring', d.deploymentMonitoring ? 1 : 0]);
    if (s.length) db().run(`UPDATE project_settings SET ${s.map(([c]) => `${c} = ?`).join(', ')} WHERE project_id = ?`, ...s.map(([, v]) => v), id);
    if (d.deployment) {
      const cur = p.deployment ?? { provider: 'none', firebaseProjectId: '', hostingSiteId: '', remotePath: '/', publicUrl: '', deployDirectory: '.' };
      const m = { ...cur, ...d.deployment };
      if (m.hostingSiteId && d.deployment.provider === undefined && cur.provider === 'none') m.provider = 'firebase';
      db().run(`INSERT INTO hosting_targets(project_id, provider, firebase_project, site_id, remote_path, public_url, deploy_directory) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET provider = excluded.provider, firebase_project = excluded.firebase_project, site_id = excluded.site_id,
        remote_path = excluded.remote_path, public_url = excluded.public_url, deploy_directory = excluded.deploy_directory`,
        id, m.provider, m.firebaseProjectId, m.hostingSiteId, normaliseRemotePath(m.remotePath), m.publicUrl, m.deployDirectory || '.');
    }
  });
  const updated = getProject(id);
  deployDirOf(updated);
  return updated;
}

/** Unregister: removes dashboard data only — never touches the project directory. */
export function deleteProject(id: string) {
  getProject(id);
  db().run('DELETE FROM projects WHERE id = ?', id);
}

export function setProjectFields(id: string, fields: Record<string, unknown>) {
  const entries = Object.entries(fields);
  if (!entries.length) return;
  db().run(`UPDATE projects SET ${entries.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`, ...entries.map(([, v]) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v)), id);
}

export function getDeploymentState(id: string): DeploymentState | undefined {
  return json<DeploymentState | undefined>(db().get<{ deploy_state: string }>('SELECT deploy_state FROM projects WHERE id = ?', id)?.deploy_state, undefined);
}

export function computeStats(p: Project): ProjectStats {
  const agg = db().get<Row>(`SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS total,
      COALESCE(SUM(CASE WHEN kind = 'source' THEN size END),0) AS src, COALESCE(SUM(CASE WHEN kind = 'source' THEN 1 END),0) AS srcn,
      COALESCE(SUM(CASE WHEN kind = 'asset' THEN size END),0) AS asset, COALESCE(SUM(CASE WHEN kind = 'asset' THEN 1 END),0) AS assetn
    FROM file_index WHERE project_id = ? AND build = 0`, p.id)!;
  const today = db().get<{ n: number }>(`SELECT COUNT(DISTINCT path) AS n FROM file_events WHERE project_id = ? AND detected_at >= ?
    AND event_type IN ('created','modified','deleted','renamed') AND COALESCE(kind,'') != 'build' AND COALESCE(detail,'') NOT LIKE 'seed:%'`, p.id, daysAgoIso(0))!.n;
  const sess = db().get<{ n: number; m: number }>('SELECT COUNT(*) AS n, COALESCE(SUM(minutes),0) AS m FROM development_sessions WHERE project_id = ? AND started_at >= ?', p.id, daysAgoIso(30))!;
  const ds = getDeploymentState(p.id);
  return {
    totalFiles: agg.n, totalSize: agg.total, sourceSize: agg.src, assetSize: agg.asset, sourceFiles: agg.srcn, assetFiles: agg.assetn,
    filesChangedToday: today, filesChangedSinceDeployment: ds && ds.status !== 'local_only' && ds.method !== 'none' ? ds.pendingCount : null,
    sessions30d: sess.n, estimatedMinutes30d: sess.m,
  };
}

export function defaultDeploymentState(p: Project): DeploymentState {
  const local = !p.deployment || p.deployment.provider === 'none';
  return { status: local ? 'local_only' : 'unverified', method: 'none', confidence: 'none', pendingCount: 0, added: 0, modified: 0, deleted: 0, unverifiedFiles: 0 };
}

export function summarize(p: Project, intensity = 0): ProjectSummary {
  const r = db().get<Row>('SELECT deploy_state, git, health, errors FROM projects WHERE id = ?', p.id)!;
  return {
    ...p,
    stats: computeStats(p),
    git: json<GitSnapshot | undefined>(r.git, undefined),
    deploymentState: json<DeploymentState | undefined>(r.deploy_state, undefined) ?? defaultDeploymentState(p),
    health: json<HealthCheck | undefined>(r.health, undefined),
    errors: json<string[]>(r.errors, []),
    intensity,
  };
}

export function setError(id: string, key: string, message: string | null) {
  const cur = json<string[]>(db().get<{ errors: string }>('SELECT errors FROM projects WHERE id = ?', id)?.errors, []).filter((e) => !e.startsWith(key + ':'));
  if (message) cur.push(`${key}: ${message}`);
  db().run('UPDATE projects SET errors = ? WHERE id = ?', JSON.stringify(cur), id);
}

/** Store an uploaded thumbnail (data URL) in data/thumbnails and return the stored file name. */
export function saveThumbnail(id: string, dataUrl: string): string {
  const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, 'Thumbnail must be a PNG, JPEG, WEBP or GIF data URL');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) throw new HttpError(413, 'Thumbnail too large (max 8 MB)');
  const name = `${id}-${crypto.randomBytes(4).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(wsSubdir('thumbnails'), name), buf);
  return `data:${name}`;
}
