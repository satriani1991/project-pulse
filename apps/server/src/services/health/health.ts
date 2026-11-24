import type { HealthCheck } from '@pulse/shared';
import { db, json, now } from '../../database/db.js';
import { listProjects, setProjectFields } from '../projects.js';
import { notify } from '../notifications/notifications.js';
import { broadcast } from '../../websocket/hub.js';
import { pool } from '../../util.js';

/** Website availability + load-time check for each published project (PRD §15 health check / performance). */
export async function checkHealth(projectId?: string) {
  const projects = listProjects().filter((p) => p.deployment?.publicUrl && /^https?:\/\//.test(p.deployment.publicUrl) && (!projectId || p.id === projectId));
  await pool(projects, 4, async (p) => {
    const url = p.deployment!.publicUrl;
    const t0 = performance.now();
    let h: HealthCheck;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'follow', headers: { 'User-Agent': 'ProjectPulse/2 health-check' } });
      const body = await r.arrayBuffer();
      h = { url, ok: r.ok, status: r.status, latencyMs: Math.round(performance.now() - t0), checkedAt: now(), bytes: body.byteLength };
    } catch (e) {
      h = { url, ok: false, latencyMs: Math.round(performance.now() - t0), checkedAt: now(), error: (e as Error).message };
    }
    const prev = json<HealthCheck | undefined>(db().get<{ health: string }>('SELECT health FROM projects WHERE id = ?', p.id)?.health, undefined);
    setProjectFields(p.id, { health: h });
    db().run('INSERT INTO health_checks(project_id, url, ok, status, latency_ms, bytes, error, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', p.id, url, h.ok ? 1 : 0, h.status ?? null, h.latencyMs ?? null, h.bytes ?? null, h.error ?? null, h.checkedAt);
    if (prev?.ok !== false && !h.ok) notify(p.id, 'site_down', `${p.name} is unavailable: ${url} (${h.error ?? 'HTTP ' + h.status})`, `down:${p.id}:${h.checkedAt.slice(0, 13)}`);
    if (prev && !prev.ok && h.ok) notify(p.id, 'site_up', `${p.name} is reachable again`);
    broadcast('project.updated', p.id);
  });
  db().run(`DELETE FROM health_checks WHERE checked_at < ?`, new Date(Date.now() - 90 * 86400_000).toISOString());
}
export function healthHistory(projectId: string) {
  return db().all('SELECT ok, status, latency_ms AS latencyMs, bytes, error, checked_at AS checkedAt FROM health_checks WHERE project_id = ? ORDER BY checked_at DESC LIMIT 200', projectId);
}
