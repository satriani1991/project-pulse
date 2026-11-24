import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DATA_DIR } from '../config.js';
import { closeDb } from '../database/db.js';
import { createWorkspace, listWorkspaces, removeWorkspace, updateWorkspace, runInWorkspace } from '../workspace/context.js';
import { closeAll } from '../services/watcher/watcher.js';
import { stopAll } from '../services/process-manager/processes.js';
import { broadcast } from '../websocket/hub.js';
import { audit } from '../security/audit.js';
import { db } from '../database/db.js';

const theme = z.enum(['dark', 'light', 'system']);

/** Workspace registry (global — not scoped to the request's workspace). */
export function workspacesRoutes(app: FastifyInstance) {
  app.get('/api/workspaces', async () => listWorkspaces().map((w) => ({
    ...w,
    projectCount: runInWorkspace(w.id, () => db().get<{ n: number }>('SELECT COUNT(*) AS n FROM projects')!.n),
  })));

  app.post('/api/workspaces', async (req) => {
    const b = z.object({ name: z.string().min(1).max(60), color: z.string().optional(), theme: theme.optional() }).parse(req.body);
    const ws = createWorkspace(b);
    runInWorkspace(ws.id, () => { db(); audit('workspace.create', null, ws.name); });
    broadcast('workspaces.updated');
    return ws;
  });

  app.patch<{ Params: { id: string } }>('/api/workspaces/:id', async (req) => {
    const b = z.object({ name: z.string().min(1).max(60).optional(), color: z.string().optional(), theme: theme.optional() }).parse(req.body);
    const ws = updateWorkspace(req.params.id, b);
    broadcast('workspaces.updated');
    return ws;
  });

  /** Removes a workspace from Pulse. Project folders are never touched; ?purge=1 also deletes the workspace's dashboard data. */
  app.delete<{ Params: { id: string }; Querystring: { purge?: string } }>('/api/workspaces/:id', async (req) => {
    const id = req.params.id;
    await closeAll(id);
    await runInWorkspace(id, () => stopAll(id));
    closeDb(id);
    const { dataDir } = removeWorkspace(id);
    const root = path.resolve(DATA_DIR, 'workspaces');
    if (req.query.purge === '1' && path.resolve(dataDir).startsWith(root + path.sep) && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
    audit('workspace.delete', null, `${id}${req.query.purge === '1' ? ' (data purged)' : ''}`);
    broadcast('workspaces.updated');
    return { ok: true };
  });
}
