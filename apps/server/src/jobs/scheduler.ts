import { db, now } from '../database/db.js';
import { getSettings } from '../services/settings.js';
import { listProjects } from '../services/projects.js';
import { scanProject } from '../services/filesystem/scanner.js';
import { watchAll } from '../services/watcher/watcher.js';
import { refreshGit } from '../services/git/git.js';
import { checkReminders, refreshAllSites } from '../services/deployment/state.js';
import { aggregate, applyRetention } from '../services/analytics/analytics.js';
import { checkHealth } from '../services/health/health.js';
import { discoverDependencies } from '../services/dependencies/dependencies.js';
import { recommendations } from '../services/recommendations/recommendations.js';
import { backupDatabase } from '../services/backup/backup.js';
import { indexAssets } from '../services/assets/assets.js';
import { markStaleProcesses } from '../services/process-manager/processes.js';
import { markStaleDiscoveries } from '../services/filesystem/discovery-jobs.js';
import { DEFAULT_WS, listWorkspaces, runInWorkspace } from '../workspace/context.js';

const running = new Set<string>();
const status = new Map<string, { lastRun?: string; lastError?: string; durationMs?: number }>();

/** Run a job once for every workspace (each inside its own workspace context / database). */
async function job(name: string, fn: () => Promise<unknown> | unknown, only?: string) {
  if (running.has(name)) return;
  running.add(name);
  const t0 = Date.now();
  const errors: string[] = [];
  try {
    for (const w of listWorkspaces()) {
      if (only && w.id !== only) continue;
      try { await runInWorkspace(w.id, async () => { await fn(); }); }
      catch (e) { errors.push(`${w.name}: ${(e as Error).message}`); console.error(`[job:${name}:${w.id}]`, (e as Error).message); }
    }
    status.set(name, { lastRun: now(), durationMs: Date.now() - t0, ...(errors.length ? { lastError: errors.join('; ') } : {}) });
  } finally { running.delete(name); }
}
/** Interval settings are read from the default workspace. */
const fromDefault = <T,>(f: () => T): T => runInWorkspace(DEFAULT_WS, f);
export const jobStatus = () => Object.fromEntries(status);

const timers: NodeJS.Timeout[] = [];
function every(name: string, minutes: () => number, fn: () => Promise<unknown> | unknown) {
  const tick = () => { void job(name, fn); timers.push(setTimeout(tick, Math.max(0.25, fromDefault(minutes)) * 60_000)); };
  timers.push(setTimeout(tick, Math.max(0.25, fromDefault(minutes)) * 60_000));
}

export const reconcileAll = async () => { for (const p of listProjects()) await scanProject(p.id); discoverDependencies(); };
export const refreshAllGit = async () => { for (const p of listProjects()) await refreshGit(p.id); };

/**
 * Startup: recover changes missed while the backend was stopped (full reconciliation against the stored index),
 * then start real-time watchers and periodic jobs (PRD §16.2).
 */
export async function startBackground() {
  await job('startup-stale', () => { markStaleProcesses(); markStaleDiscoveries(); });
  await job('startup-reconcile', async () => {
    for (const p of listProjects()) { await scanProject(p.id); indexAssets(p.id); }
  });
  await job('watch', watchAll);
  void job('git', refreshAllGit);
  void job('firebase', async () => { await refreshAllSites(); checkReminders(); });
  void job('analytics', () => { aggregate(db().meta('aggregated_full') ? 3 : 400); db().setMeta('aggregated_full', now()); });
  void job('dependencies', discoverDependencies);
  void job('health', () => checkHealth());

  every('firebase', () => getSettings().firebaseCheckMinutes, async () => { await refreshAllSites(); checkReminders(); });
  every('git', () => getSettings().gitRefreshSeconds / 60, refreshAllGit);
  every('health', () => getSettings().healthCheckMinutes, () => checkHealth());
  every('reconcile', () => getSettings().reconcileMinutes, reconcileAll);
  every('analytics', () => getSettings().analyticsMinutes, () => { aggregate(2); recommendations(true); });
  every('maintenance', () => 60, () => {
    applyRetention();
    const last = db().meta('last_db_backup');
    if (!last || Date.now() - Date.parse(last) > getSettings().backupDays * 86400_000) backupDatabase();
  });
}

/** Bring a newly created workspace online (watchers + first jobs). */
export async function startWorkspace(ws: string) {
  await runInWorkspace(ws, async () => { await watchAll(); });
}
export function stopBackground() { for (const t of timers) clearTimeout(t); timers.length = 0; }
