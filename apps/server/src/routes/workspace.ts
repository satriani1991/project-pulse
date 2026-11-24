import os from 'node:os';
import { execFile } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { deploymentPriority, prioritySchema, taskSchema, DEFAULT_SETTINGS } from '@pulse/shared';
import { db, now, type Row } from '../database/db.js';
import { aggregate, dayDetail, deploymentFrequency, heatmap, intensity, monthly, overview, sessions, timeline } from '../services/analytics/analytics.js';
import { recommendations } from '../services/recommendations/recommendations.js';
import { listNotifications, markRead } from '../services/notifications/notifications.js';
import { isPortFree, listProcesses, processLogs, restartProcess, stopProcess } from '../services/process-manager/processes.js';
import { portfolio, writePortfolio } from '../services/portfolio/portfolio.js';
import { getSettings, updateSettings } from '../services/settings.js';
import { authStatus, clearTokenCache } from '../services/firebase/auth.js';
import { jobStatus, reconcileAll } from '../jobs/scheduler.js';
import { watchedCount, watchAll } from '../services/watcher/watcher.js';
import { listProjects } from '../services/projects.js';
import { listDependencies, removeDependency } from '../services/dependencies/dependencies.js';
import { assetReport } from '../services/assets/assets.js';
import { backupDatabase } from '../services/backup/backup.js';
import { auditLog } from '../security/audit.js';
import { refreshAllSites } from '../services/deployment/state.js';
import { IS_WIN } from '../config.js';
import { currentWs, getWorkspace, wsDataDir } from '../workspace/context.js';
import { HttpError } from '../services/projects.js';

const filterQ = z.object({ projectId: z.string().optional(), category: z.string().optional() });

export function workspaceRoutes(app: FastifyInstance) {
  app.get('/api/analytics/overview', async () => overview());
  app.get('/api/analytics/heatmap', async (req) => heatmap(filterQ.parse(req.query)));
  app.get('/api/analytics/day', async (req) => { const q = filterQ.extend({ date: z.string() }).parse(req.query); return dayDetail(q.date, q); });
  app.get('/api/analytics/intensity', async (req) => { const q = z.object({ days: z.coerce.number().int().min(1).max(365).optional() }).parse(req.query); return intensity(q.days, true); });
  app.get('/api/analytics/monthly', async () => monthly(12));
  app.get('/api/analytics/frequency', async (req) => { const q = z.object({ weeks: z.coerce.number().int().min(2).max(104).optional(), projectId: z.string().optional() }).parse(req.query); return deploymentFrequency(q.weeks ?? 12, q.projectId); });
  app.get('/api/analytics/sessions', async (req) => { const q = z.object({ projectId: z.string().optional(), days: z.coerce.number().optional() }).parse(req.query); return sessions(q.projectId, q.days ?? 30); });
  app.post('/api/analytics/rebuild', async () => { aggregate(400); return { ok: true }; });

  app.get('/api/activity', async (req) => {
    const q = z.object({
      projectId: z.string().optional(), category: z.string().optional(), types: z.string().optional(), from: z.string().optional(), to: z.string().optional(),
      before: z.coerce.number().optional(), limit: z.coerce.number().optional(), git: z.string().optional(), deploymentStatus: z.string().optional(), q: z.string().optional(), seeded: z.string().optional(),
    }).parse(req.query);
    return timeline({ ...q, types: q.types ? q.types.split(',') : undefined, gitOnly: q.git === '1', includeSeeded: q.seeded === '1' });
  });

  app.get('/api/recommendations', async (req) => recommendations((req.query as Record<string, string>).fresh === '1'));
  app.post('/api/recommendations/priority', async (req) => deploymentPriority(prioritySchema.parse(req.body)));

  app.get('/api/notifications', async () => listNotifications());
  app.post('/api/notifications/read', async (req) => { const b = z.object({ id: z.number().optional() }).parse(req.body ?? {}); markRead(b.id); return { ok: true }; });

  app.get('/api/processes', async () => listProcesses());
  app.get<{ Params: { id: string } }>('/api/processes/:id/logs', async (req) => ({ lines: processLogs(req.params.id) }));
  app.post<{ Params: { id: string } }>('/api/processes/:id/stop', async (req) => { await stopProcess(req.params.id); return { ok: true }; });
  app.post<{ Params: { id: string } }>('/api/processes/:id/restart', async (req) => restartProcess(req.params.id));
  app.get<{ Params: { port: string } }>('/api/ports/:port', async (req) => ({ port: Number(req.params.port), free: await isPortFree(Number(req.params.port)) }));

  // Tasks & roadmap
  app.get('/api/tasks', async (req) => {
    const q = z.object({ projectId: z.string().optional() }).parse(req.query);
    return db().all(`SELECT t.id, t.project_id AS projectId, p.name AS projectName, t.title, t.status, t.priority, t.due_date AS dueDate, t.created_at AS createdAt, t.updated_at AS updatedAt
      FROM tasks t LEFT JOIN projects p ON p.id = t.project_id ${q.projectId ? 'WHERE t.project_id = ?' : ''} ORDER BY CASE t.status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
      CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, t.id DESC`, ...(q.projectId ? [q.projectId] : []));
  });
  app.post('/api/tasks', async (req) => {
    const t = taskSchema.parse(req.body); const ts = now();
    const r = db().run('INSERT INTO tasks(project_id, title, status, priority, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', t.projectId ?? null, t.title, t.status ?? 'todo', t.priority ?? 'medium', t.dueDate ?? null, ts, ts);
    return { id: Number(r.lastInsertRowid) };
  });
  app.patch<{ Params: { id: string } }>('/api/tasks/:id', async (req) => {
    const t = taskSchema.partial().parse(req.body);
    const map: Record<string, string> = { projectId: 'project_id', title: 'title', status: 'status', priority: 'priority', dueDate: 'due_date' };
    const sets = Object.entries(t).filter(([, v]) => v !== undefined);
    if (sets.length) db().run(`UPDATE tasks SET ${sets.map(([k]) => `${map[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...sets.map(([, v]) => v), now(), Number(req.params.id));
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/api/tasks/:id', async (req) => { db().run('DELETE FROM tasks WHERE id = ?', Number(req.params.id)); return { ok: true }; });

  // Dependencies & assets (workspace)
  app.get('/api/dependencies', async () => ({ nodes: listProjects().map((p) => ({ id: p.id, name: p.name, category: p.category, lifecycle: p.lifecycle, lastLocalUpdate: p.lastLocalUpdate, lastDeployment: p.lastDeployment })), edges: listDependencies() }));
  app.delete<{ Params: { id: string } }>('/api/dependencies/:id', async (req) => { removeDependency(Number(req.params.id)); return { ok: true }; });
  app.get('/api/assets/report', async () => assetReport('*'));

  // Portfolio
  app.get('/api/portfolio/export', async (req, reply) => {
    const q = z.object({ category: z.string().optional(), download: z.string().optional() }).parse(req.query);
    const data = portfolio(q.category ?? 'game');
    if (q.download === '1') reply.header('Content-Disposition', 'attachment; filename="games.json"');
    return data;
  });
  app.post('/api/portfolio/write', async () => writePortfolio());

  // Settings & system
  app.get('/api/settings', async () => ({ settings: getSettings(), defaults: DEFAULT_SETTINGS }));
  app.patch('/api/settings', async (req) => {
    const s = updateSettings(z.record(z.unknown()).parse(req.body) as never);
    clearTokenCache();
    return s;
  });
  app.get('/api/system/status', async () => ({
    version: '2.1.0', node: process.version, platform: `${os.platform()} ${os.release()}`, dataDir: wsDataDir(), workspace: getWorkspace(currentWs()), uptime: process.uptime(),
    memoryMB: Math.round(process.memoryUsage().rss / 1048576), watchers: watchedCount(currentWs()), jobs: jobStatus(), firebaseAuth: authStatus(),
    dbSizeMB: Math.round((db().get<{ n: number }>('SELECT page_count * page_size AS n FROM pragma_page_count(), pragma_page_size()')?.n ?? 0) / 1048576 * 10) / 10,
    events: db().get<{ n: number }>('SELECT COUNT(*) AS n FROM file_events')!.n, indexedFiles: db().get<{ n: number }>('SELECT COUNT(*) AS n FROM file_index')!.n,
  }));
  app.post('/api/system/reconcile', async () => { await reconcileAll(); await watchAll(); return { ok: true }; });
  app.post('/api/system/firebase-refresh', async () => { clearTokenCache(); await refreshAllSites({ force: true }); return { ok: true, auth: authStatus() }; });
  app.post('/api/system/backup-db', async () => ({ file: backupDatabase() }));
  app.get('/api/audit', async () => auditLog());

  /** Native folder picker (Windows): shows a FolderBrowserDialog on the local desktop. */
  app.post('/api/system/pick-folder', async () => {
    if (!IS_WIN) throw new HttpError(501, 'Native folder picker is only available on Windows — paste the path instead');
    const script = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select a project folder for PROJECT PULSE'; $f.ShowNewFolderButton = $false; $owner = New-Object System.Windows.Forms.Form -Property @{TopMost=$true}; if ($f.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($f.SelectedPath) }`;
    const out = await new Promise<string>((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { timeout: 5 * 60_000 }, (e, so) => (e ? reject(e) : resolve(so.trim()))));
    return { path: out || null };
  });

  app.get('/api/search', async (req) => {
    const { q } = z.object({ q: z.string().min(1).max(200) }).parse(req.query);
    const like = `%${q}%`;
    const projects = db().all<Row>(`SELECT id, name, category, root_path AS rootPath FROM projects WHERE name LIKE ? OR root_path LIKE ? OR tags LIKE ? OR technologies LIKE ? LIMIT 20`, like, like, like, like);
    const files = db().all<Row>(`SELECT f.project_id AS projectId, p.name AS projectName, f.path FROM file_index f JOIN projects p ON p.id = f.project_id WHERE f.path LIKE ? AND f.build = 0 LIMIT 30`, like);
    const tasks = db().all<Row>(`SELECT id, project_id AS projectId, title, status FROM tasks WHERE title LIKE ? LIMIT 10`, like);
    const notes = db().all<Row>(`SELECT id, project_id AS projectId, title, kind FROM project_notes WHERE title LIKE ? OR content LIKE ? LIMIT 10`, like, like);
    return { projects, files, tasks, notes };
  });
}
