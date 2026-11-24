import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { bulkRegisterSchema, discoverSchema, launchSchema, deploySchema, noteSchema, projectCreateSchema, projectUpdateSchema, dependencySchema } from '@pulse/shared';
import { db, now, type Row } from '../database/db.js';
import { createProject, deleteProject, getProject, HttpError, listProjects, saveThumbnail, summarize, updateProject } from '../services/projects.js';
import { discover, inspectDirectory } from '../services/filesystem/discover.js';
import { listDirectory, rememberPath, roots } from '../services/filesystem/browse.js';
import { cancelDiscovery, getJob, latestJob, startDiscovery } from '../services/filesystem/discovery-jobs.js';
import { scanProject } from '../services/filesystem/scanner.js';
import { unwatchProject, watchProject } from '../services/watcher/watcher.js';
import { onboardProject } from '../services/orchestrator.js';
import { listCommits, refreshGit } from '../services/git/git.js';
import { assetReport, indexAssets, listAssets } from '../services/assets/assets.js';
import { computeDeploymentState, getSiteInfo, listDeployments, recordBaseline, refreshSite, verifyViaHttp } from '../services/deployment/state.js';
import { preflight, startDeployment } from '../services/deployment/deployer.js';
import { openLocal, restartProcess, startProcess, stopProcess } from '../services/process-manager/processes.js';
import { intensity, projectActivity, sessions, timeline, deploymentFrequency } from '../services/analytics/analytics.js';
import { addManualDependency, discoverDependencies, listDependencies } from '../services/dependencies/dependencies.js';
import { backupProject, listBackups } from '../services/backup/backup.js';
import { checkHealth, healthHistory } from '../services/health/health.js';
import { getSettings } from '../services/settings.js';
import { audit } from '../security/audit.js';
import { resolveInside, validateProjectRoot } from '../security/paths.js';
import { wsSubdir } from '../workspace/context.js';
import { invalidateRecommendations } from '../services/recommendations/recommendations.js';
import { broadcast } from '../websocket/hub.js';

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream', json: 'application/json', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8',
};

function intensityMap() { return new Map(intensity().map((i) => [i.projectId, i.score])); }

export function projectRoutes(app: FastifyInstance) {
  app.get('/api/projects', async () => { const im = intensityMap(); return listProjects().map((p) => summarize(p, im.get(p.id) ?? 0)); });

  app.post('/api/projects', async (req) => {
    const body = projectCreateSchema.parse(req.body);
    const p = createProject(body);
    rememberPath(path.dirname(p.rootPath));
    audit('project.register', p.id, p.rootPath);
    void onboardProject(p.id).catch((e) => console.error('[onboard]', e));
    broadcast('project.updated', p.id);
    return summarize(p);
  });

  app.post('/api/projects/bulk', async (req) => {
    const { projects } = bulkRegisterSchema.parse(req.body);
    const created: string[] = []; const errors: { rootPath: string; error: string }[] = [];
    for (const input of projects) {
      try { const p = createProject(input); created.push(p.id); audit('project.register', p.id, p.rootPath); }
      catch (e) { errors.push({ rootPath: input.rootPath, error: (e as Error).message }); }
    }
    void (async () => { for (const id of created) await onboardProject(id).catch((e) => console.error('[onboard]', e)); })();
    broadcast('project.updated');
    return { created, errors };
  });

  // In-app folder browser + background discovery (results stored in SQLite, UI reads them)
  app.get('/api/fs/roots', async () => roots());
  app.get<{ Querystring: { path: string; hidden?: string; fresh?: string } }>('/api/fs/list', async (req) => listDirectory(req.query.path, req.query.hidden === '1', req.query.fresh === '1'));
  app.post('/api/fs/recent', async (req) => { const { path: p } = z.object({ path: z.string().min(1).max(1000) }).parse(req.body); rememberPath(p); return { ok: true }; });
  app.post('/api/discovery', async (req) => { const b = discoverSchema.parse(req.body); return startDiscovery(b.rootPath, b.maxDepth ?? 2); });
  app.get('/api/discovery/latest', async () => latestJob() ?? null);
  app.get<{ Params: { id: string } }>('/api/discovery/:id', async (req) => { const j = getJob(req.params.id); if (!j) throw new HttpError(404, 'Discovery job not found'); return j; });
  app.post<{ Params: { id: string } }>('/api/discovery/:id/cancel', async (req) => { cancelDiscovery(req.params.id); return { ok: true }; });

  app.post('/api/projects/discover', async (req) => { const b = discoverSchema.parse(req.body); return discover(b.rootPath, b.maxDepth ?? 2); });
  app.post('/api/projects/inspect', async (req) => {
    const { rootPath } = z.object({ rootPath: z.string().min(1) }).parse(req.body);
    const dir = validateProjectRoot(rootPath);
    return inspectDirectory(dir) ?? { rootPath: dir, name: path.basename(dir), category: 'application', technologies: [], markers: [], commands: {} };
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req) => summarize(getProject(req.params.id), intensityMap().get(req.params.id) ?? 0));

  app.patch<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const body = projectUpdateSchema.parse(req.body);
    const p = updateProject(req.params.id, body);
    const structural = body.ignoreRules !== undefined || body.deployment !== undefined || body.monitoringEnabled !== undefined;
    if (structural) {
      void (async () => {
        await watchProject(p.id); await scanProject(p.id); indexAssets(p.id);
        const site = p.deployment?.hostingSiteId;
        if (p.deployment?.provider === 'firebase' && site) await refreshSite(site, { force: true }).catch(() => undefined);
        await computeDeploymentState(p.id);
      })();
    }
    if (body.gitEnabled !== undefined) void refreshGit(p.id);
    invalidateRecommendations();
    broadcast('project.updated', p.id);
    return summarize(p);
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const p = getProject(req.params.id);
    await unwatchProject(p.id);
    deleteProject(p.id); // dashboard registration only — the directory is never touched
    audit('project.unregister', null, `${p.name} (${p.rootPath})`);
    broadcast('project.removed', p.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/scan', async (req) => {
    const r = await scanProject(req.params.id);
    indexAssets(req.params.id);
    await refreshGit(req.params.id);
    await computeDeploymentState(req.params.id);
    return { ok: true, result: r };
  });

  app.get<{ Params: { id: string }; Querystring: { q?: string; limit?: string; kind?: string } }>('/api/projects/:id/files', async (req) => {
    getProject(req.params.id);
    const { q, kind } = req.query;
    const limit = Math.min(Number(req.query.limit ?? 20000), 50000);
    const where = ['project_id = ?']; const params: unknown[] = [req.params.id];
    if (q) { where.push('path LIKE ?'); params.push(`%${q}%`); }
    if (kind) { where.push('kind = ?'); params.push(kind); }
    const rows = db().all<Row>(`SELECT path, size, mtime_ms, kind, hash, deploy, build FROM file_index WHERE ${where.join(' AND ')} ORDER BY path LIMIT ?`, ...params, limit);
    const recent = db().all<Row>(`SELECT path, event_type AS change, detected_at AS at FROM file_events WHERE project_id = ? AND event_type IN ('created','modified','deleted','renamed') AND COALESCE(detail,'') NOT LIKE 'seed:%' ORDER BY detected_at DESC LIMIT 100`, req.params.id);
    return { files: rows.map((r) => ({ path: r.path, size: r.size, modifiedAt: new Date(r.mtime_ms).toISOString(), kind: r.kind, hash: r.hash, deploy: !!r.deploy, build: !!r.build })), recent };
  });

  app.get<{ Params: { id: string }; Querystring: { path: string } }>('/api/projects/:id/file', async (req) => {
    const p = getProject(req.params.id);
    const abs = resolveInside(p.rootPath, req.query.path);
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new HttpError(400, 'Not a file');
    const max = 512 * 1024;
    const fd = fs.openSync(abs, 'r'); const buf = Buffer.alloc(Math.min(st.size, max)); fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
    const binary = buf.subarray(0, 8000).includes(0);
    return { path: req.query.path, size: st.size, modifiedAt: st.mtime.toISOString(), truncated: st.size > max, binary, content: binary ? '' : buf.toString('utf8') };
  });

  app.get<{ Params: { id: string }; Querystring: { path: string } }>('/api/projects/:id/raw', async (req, reply) => {
    const p = getProject(req.params.id);
    const abs = resolveInside(p.rootPath, req.query.path);
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new HttpError(400, 'Not a file');
    const ext = path.extname(abs).slice(1).toLowerCase();
    reply.header('Content-Type', MIME[ext] ?? 'application/octet-stream').header('Content-Length', st.size).header('Cache-Control', 'private, max-age=60')
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox").header('X-Content-Type-Options', 'nosniff');
    return reply.send(fs.createReadStream(abs));
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/thumbnail', async (req, reply) => {
    const p = getProject(req.params.id);
    if (!p.thumbnailPath) throw new HttpError(404, 'No thumbnail');
    const abs = p.thumbnailPath.startsWith('data:') ? path.join(wsSubdir('thumbnails'), path.basename(p.thumbnailPath.slice(5))) : resolveInside(p.rootPath, p.thumbnailPath);
    if (!fs.existsSync(abs)) throw new HttpError(404, 'Thumbnail missing');
    const ext = path.extname(abs).slice(1).toLowerCase();
    reply.header('Content-Type', MIME[ext] ?? 'application/octet-stream').header('Cache-Control', 'private, max-age=300').header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    return reply.send(fs.createReadStream(abs));
  });
  app.post<{ Params: { id: string } }>('/api/projects/:id/thumbnail', { bodyLimit: 12 * 1024 * 1024 }, async (req) => {
    const b = z.object({ dataUrl: z.string().optional(), path: z.string().optional() }).parse(req.body);
    const p = getProject(req.params.id);
    let thumb: string | null = null;
    if (b.dataUrl) thumb = saveThumbnail(p.id, b.dataUrl);
    else if (b.path) { resolveInside(p.rootPath, b.path); thumb = b.path; }
    updateProject(p.id, { thumbnailPath: thumb });
    broadcast('project.updated', p.id);
    return { thumbnailPath: thumb };
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/changes', async (req) => {
    const r = await computeDeploymentState(req.params.id);
    return { state: r?.state, changes: r?.changes ?? [] };
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/git', async (req) => {
    const p = summarize(getProject(req.params.id));
    const snaps = db().all('SELECT branch, commit_hash AS commitHash, dirty_count AS dirtyCount, taken_at AS takenAt FROM git_snapshots WHERE project_id = ? ORDER BY taken_at DESC LIMIT 50', p.id);
    return { snapshot: p.git, commits: listCommits(p.id, 200), snapshots: snaps };
  });
  app.post<{ Params: { id: string } }>('/api/projects/:id/git/refresh', async (req) => refreshGit(req.params.id));

  app.get<{ Params: { id: string }; Querystring: { type?: string } }>('/api/projects/:id/assets', async (req) => {
    getProject(req.params.id);
    return { assets: listAssets(req.params.id, req.query.type), report: assetReport(req.params.id) };
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/deployments', async (req) => {
    const p = getProject(req.params.id);
    const site = p.deployment?.hostingSiteId;
    return { deployments: listDeployments(p.id), site: site ? getSiteInfo(site) : undefined, frequency: deploymentFrequency(12, p.id) };
  });
  app.post<{ Params: { id: string } }>('/api/projects/:id/firebase/refresh', async (req) => {
    const p = getProject(req.params.id);
    if (!p.deployment?.hostingSiteId) throw new HttpError(400, 'No Firebase Hosting site configured');
    await refreshSite(p.deployment.hostingSiteId, { force: true });
    return (await computeDeploymentState(p.id))?.state;
  });
  app.post<{ Params: { id: string } }>('/api/projects/:id/verify-remote', async (req) => verifyViaHttp(req.params.id));
  app.post<{ Params: { id: string } }>('/api/projects/:id/baseline', async (req) => {
    const { confirm } = z.object({ confirm: z.literal(true) }).parse(req.body);
    void confirm;
    const p = getProject(req.params.id);
    const info = p.deployment?.hostingSiteId ? getSiteInfo(p.deployment.hostingSiteId) : undefined;
    const id = recordBaseline(p.id, 'manual', { versionId: info?.latestVersion, message: 'Baseline confirmed manually by the user' });
    audit('deployment.baseline', p.id, { deployment: id, version: info?.latestVersion });
    return (await computeDeploymentState(p.id))?.state;
  });
  app.post<{ Params: { id: string } }>('/api/projects/:id/deploy/preflight', async (req) => preflight(req.params.id));
  app.post<{ Params: { id: string } }>('/api/projects/:id/deploy', async (req) => {
    const b = deploySchema.parse(req.body);
    return startDeployment(req.params.id, b.confirmToken, b.skipBuild);
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/launch', async (req) => {
    const b = launchSchema.parse(req.body);
    const p = getProject(req.params.id);
    const s = getSettings();
    audit('launch.' + b.action, p.id, b.command ?? b.processId ?? '');
    switch (b.action) {
      case 'open_folder': openLocal('folder', p.rootPath, s.editorCommand, s.terminalCommand); return { ok: true };
      case 'open_editor': openLocal('editor', p.rootPath, s.editorCommand, s.terminalCommand); return { ok: true };
      case 'open_terminal': openLocal('terminal', p.rootPath, s.editorCommand, s.terminalCommand); return { ok: true };
      case 'run': {
        if (!b.command) throw new HttpError(400, 'command required');
        if (b.command === 'deploy') throw new HttpError(400, 'Use the deployment workflow (preflight + confirmation) to deploy');
        return startProcess(p.id, b.command);
      }
      case 'stop': if (!b.processId) throw new HttpError(400, 'processId required'); await stopProcess(b.processId); return { ok: true };
      case 'restart': if (!b.processId) throw new HttpError(400, 'processId required'); return restartProcess(b.processId);
    }
  });

  app.get<{ Params: { id: string }; Querystring: { days?: string } }>('/api/projects/:id/activity', async (req) => {
    getProject(req.params.id);
    const days = Number(req.query.days ?? 90);
    return { daily: projectActivity(req.params.id, days), events: timeline({ projectId: req.params.id, limit: 300 }), sessions: sessions(req.params.id, days) };
  });

  // Notes (ideas, bugs, technical notes, PRDs)
  app.get<{ Params: { id: string } }>('/api/projects/:id/notes', async (req) => db().all('SELECT id, project_id AS projectId, title, content, kind, created_at AS createdAt, updated_at AS updatedAt FROM project_notes WHERE project_id = ? ORDER BY updated_at DESC', req.params.id));
  app.post<{ Params: { id: string } }>('/api/projects/:id/notes', async (req) => {
    getProject(req.params.id);
    const n = noteSchema.parse(req.body); const ts = now();
    const r = db().run('INSERT INTO project_notes(project_id, title, content, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', req.params.id, n.title, n.content, n.kind, ts, ts);
    return { id: Number(r.lastInsertRowid) };
  });
  app.patch<{ Params: { id: string } }>('/api/notes/:id', async (req) => {
    const n = noteSchema.partial().parse(req.body);
    const sets = Object.entries(n).filter(([, v]) => v !== undefined);
    if (sets.length) db().run(`UPDATE project_notes SET ${sets.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...sets.map(([, v]) => v), now(), Number(req.params.id));
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/api/notes/:id', async (req) => { db().run('DELETE FROM project_notes WHERE id = ?', Number(req.params.id)); return { ok: true }; });

  // Project documents (README / PRD / docs/*.md) — read only
  app.get<{ Params: { id: string } }>('/api/projects/:id/docs', async (req) => {
    const p = getProject(req.params.id);
    return db().all<Row>(`SELECT path, size, mtime_ms FROM file_index WHERE project_id = ? AND build = 0 AND (path LIKE '%.md' OR path LIKE '%.markdown' OR path LIKE '%.txt') AND size < 2000000 ORDER BY
      CASE WHEN lower(path) LIKE '%prd%' THEN 0 WHEN lower(path) LIKE 'readme%' THEN 1 WHEN path LIKE 'docs/%' THEN 2 ELSE 3 END, path LIMIT 200`, p.id)
      .map((r) => ({ path: r.path, size: r.size, modifiedAt: new Date(r.mtime_ms).toISOString() }));
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/dependencies', async (req) => listDependencies(req.params.id));
  app.post<{ Params: { id: string } }>('/api/projects/:id/dependencies', async (req) => {
    const b = dependencySchema.parse(req.body);
    addManualDependency(req.params.id, b.dependencyId, b.version, b.detail);
    invalidateRecommendations();
    return listDependencies(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/backup', async (req) => {
    getProject(req.params.id);
    void backupProject(req.params.id).catch(() => undefined);
    return { started: true };
  });
  app.get<{ Querystring: { projectId?: string } }>('/api/backups', async (req) => listBackups(req.query.projectId).map(({ path: _p, ...rest }) => rest));

  app.get<{ Params: { id: string } }>('/api/projects/:id/health', async (req) => ({ history: healthHistory(req.params.id) }));
  app.post<{ Params: { id: string } }>('/api/projects/:id/health', async (req) => { await checkHealth(req.params.id); return summarize(getProject(req.params.id)).health; });

  app.post('/api/dependencies/rescan', async () => { discoverDependencies(); return listDependencies(); });
}
