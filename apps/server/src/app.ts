import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { HOST, PORT, WEB_DIST } from './config.js';
import { projectRoutes } from './routes/projects.js';
import { workspaceRoutes } from './routes/workspace.js';
import { addClient } from './websocket/hub.js';
import { PathError } from './security/paths.js';
import { redact } from './security/secrets.js';
import { DEFAULT_WS, enterWorkspace, workspaceExists } from './workspace/context.js';
import { workspacesRoutes } from './routes/workspaces.js';

const allowedHosts = (port: number) => new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, '127.0.0.1:5173', 'localhost:5173']);

/**
 * Builds the Fastify app.
 * Security (PRD §21): loopback bind, Host allow-list (DNS-rebinding), Origin check and a required
 * custom header on mutating requests (CSRF), WebSocket origin check, secrets redacted from errors.
 */
export async function buildApp(opts: { port?: number; logger?: boolean } = {}): Promise<FastifyInstance> {
  const port = opts.port ?? PORT;
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 2 * 1024 * 1024 });
  const hosts = allowedHosts(port);

  app.addHook('onRequest', async (req, reply) => {
    const host = (req.headers.host ?? '').toLowerCase();
    if (!hosts.has(host)) return reply.code(403).send({ error: 'Forbidden host' });
    const origin = req.headers.origin;
    if (origin) {
      let ok = false;
      try { ok = hosts.has(new URL(origin).host.toLowerCase()); } catch { ok = false; }
      if (!ok) return reply.code(403).send({ error: 'Cross-origin request rejected' });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.url.startsWith('/api/') && req.headers['x-pulse'] !== '1') {
      return reply.code(403).send({ error: 'Missing X-Pulse header' });
    }
  });
  // Workspace selection per request: X-Pulse-Workspace header, or ?ws= for <img>/<audio>/downloads/WebSocket.
  app.addHook('onRequest', (req, reply, done) => {
    const q = (req.query as Record<string, unknown> | undefined)?.ws;
    const ws = String(req.headers['x-pulse-workspace'] ?? (typeof q === 'string' ? q : '') ?? '') || DEFAULT_WS;
    if (!workspaceExists(ws)) {
      if (req.url.startsWith('/api/') && !req.url.startsWith('/api/workspaces')) { reply.code(404).send({ error: `Unknown workspace "${ws}"` }); return; }
      enterWorkspace(DEFAULT_WS, done); return;
    }
    enterWorkspace(ws, done);
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Frame-Options', 'DENY').header('Referrer-Policy', 'no-referrer');
    return payload;
  });

  app.setErrorHandler((err: Error, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') });
    const code = (err as { statusCode?: number }).statusCode ?? (err instanceof PathError ? 403 : (err as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500);
    if (code >= 500) console.error('[api]', err);
    return reply.code(code).send({ error: redact(err.message) });
  });

  await app.register(websocket);
  app.get('/ws', { websocket: true }, (socket, req) => {
    const origin = req.headers.origin;
    try { if (origin && !hosts.has(new URL(origin).host)) { socket.close(1008, 'origin'); return; } } catch { socket.close(1008, 'origin'); return; }
    const q = (req.query as Record<string, string>)?.ws;
    addClient(socket, q && workspaceExists(q) ? q : DEFAULT_WS);
    socket.send(JSON.stringify({ type: 'hello', at: new Date().toISOString() }));
  });

  workspacesRoutes(app);
  projectRoutes(app);
  workspaceRoutes(app);
  app.get('/api/health', async () => ({ ok: true }));

  if (fs.existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, { root: WEB_DIST, prefix: '/', wildcard: false, index: ['index.html'] });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') return reply.code(404).send({ error: 'Not found' });
      return reply.type('text/html').send(fs.createReadStream(path.join(WEB_DIST, 'index.html')));
    });
  } else {
    app.get('/', async (_req, reply) => reply.type('text/html').send('<h1>PROJECT PULSE</h1><p>Web UI not built. Run <code>npm run build</code>, or use <code>npm run dev</code> and open http://localhost:5173.</p>'));
  }
  void HOST;
  return app;
}
