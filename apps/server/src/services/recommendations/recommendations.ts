import fs from 'node:fs';

import type { Recommendation, ProjectSummary } from '@pulse/shared';
import { deploymentPriority } from '@pulse/shared';
import { db } from '../../database/db.js';
import { listProjects, summarize } from '../projects.js';
import { getSettings } from '../settings.js';
import { buildStatus } from '../deployment/deployer.js';
import { dependents } from '../dependencies/dependencies.js';
import { assetReport } from '../assets/assets.js';
import { lastBackup } from '../backup/backup.js';
import { currentWs } from '../../workspace/context.js';

const caches = new Map<string, { at: number; data: Recommendation[] }>();

/** Rule-based recommendation engine (PRD §13). No AI API required. */
export function recommendations(fresh = false): Recommendation[] {
  const cache = caches.get(currentWs());
  if (!fresh && cache && Date.now() - cache.at < 5 * 60_000) return cache.data;
  const s = getSettings();
  const out: Recommendation[] = [];
  const projects = listProjects().map((p) => summarize(p));
  const byId = new Map(projects.map((p) => [p.id, p]));
  for (const p of projects) {
    const add = (r: Omit<Recommendation, 'id' | 'projectId' | 'projectName'>) => out.push({ id: `${r.rule}:${p.id}`, projectId: p.id, projectName: p.name, ...r });
    const ds = p.deploymentState;
    const archived = p.lifecycle === 'archived';
    const bs = p.commands.build ? buildStatus(p.id) : 'none';
    if (ds.status === 'deployment_failed') add({ rule: 'deploy_failed', severity: 'critical', title: 'Investigate failed deployment', detail: ds.message ?? 'The latest deployment attempt failed.', action: { label: 'View deployments', kind: 'view', target: 'deployments' } });
    if (ds.status === 'needs_deployment' && !archived) {
      const days = ds.pendingSince ? (Date.now() - Date.parse(ds.pendingSince)) / 86400_000 : 0;
      const pr = deploymentPriority({ daysPending: days, changedFiles: ds.pendingCount, importance: p.importance, buildHasErrors: bs === 'failed' });
      add({ rule: 'deploy', severity: pr.score >= 75 ? 'critical' : 'warning', title: pr.blocked ? 'Fix build before deploying' : 'Deploy latest changes',
        detail: `${ds.pendingCount} changed deployable file(s)${ds.method === 'timestamp' ? ' (timestamp hint)' : ''} · ${pr.recommendation}`, priority: pr.score,
        action: pr.blocked ? { label: 'Open build logs', kind: 'build' } : { label: 'Deploy', kind: 'deploy' } });
      if (days >= 7) add({ rule: 'deploy_overdue', severity: 'warning', title: 'Prioritize deployment', detail: `Changes have been pending for ${Math.floor(days)} days.`, priority: pr.score, action: { label: 'Deploy', kind: 'deploy' } });
    }
    if (ds.status === 'never_deployed' && ['released', 'maintenance', 'beta'].includes(p.lifecycle)) add({ rule: 'never_deployed', severity: 'warning', title: 'Publish this project', detail: `Lifecycle is ${p.lifecycle} but nothing is published at the configured remote path.` });
    const last = p.lastActivity ?? p.lastLocalUpdate;
    if (!archived && p.lifecycle !== 'on_hold' && (!last || Date.now() - Date.parse(last) > s.inactiveDays * 86400_000)) add({ rule: 'inactive', severity: 'info', title: 'Review inactive project', detail: `No development activity for ${s.inactiveDays}+ days. Consider "On hold" or "Archived".` });
    if (p.git?.isRepo && p.git.dirtyCount >= 20) add({ rule: 'commit', severity: 'warning', title: 'Create Git commit', detail: `${p.git.dirtyCount} uncommitted file(s) on ${p.git.branch}.`, action: { label: 'Open terminal', kind: 'commit' } });
    if (p.gitEnabled && p.git && !p.git.isRepo && !archived) add({ rule: 'no_git', severity: 'info', title: 'Initialize version control', detail: 'This project is not a Git repository.' });
    if (bs === 'stale') add({ rule: 'rebuild', severity: 'warning', title: 'Rebuild project', detail: 'Build output is older than the source files.', action: { label: 'Build', kind: 'build' } });
    if (bs === 'failed') add({ rule: 'build_failed', severity: 'critical', title: 'Build is failing', detail: 'The last build command exited with an error; deployment recommendations are blocked.', action: { label: 'Build', kind: 'build' } });
    if (!archived && !fs.readdirSync(p.rootPath, { withFileTypes: true }).some((e) => /^readme(\.|$)/i.test(e.name))) add({ rule: 'readme', severity: 'info', title: 'Add project documentation', detail: 'No README found in the project root.' });
    if (p.health && !p.health.ok) add({ rule: 'health', severity: 'critical', title: 'Published site unavailable', detail: `${p.health.url} — ${p.health.error ?? 'HTTP ' + p.health.status}` });
    // backups: only nag for active projects
    const lb = lastBackup(p.id);
    const active = last && Date.now() - Date.parse(last) < 14 * 86400_000;
    if (active && (!lb || Date.now() - lb > 30 * 86400_000)) add({ rule: 'backup', severity: 'info', title: 'Create project backup', detail: lb ? `Last backup ${Math.floor((Date.now() - lb) / 86400_000)} days ago.` : 'No backup recorded by Project Pulse.', action: { label: 'Back up now', kind: 'backup' } });
    // assets
    const dup = db().get<{ n: number; b: number }>(`SELECT COUNT(*) AS n, COALESCE(SUM(size * (c - 1)),0) AS b FROM (SELECT hash, MAX(size) AS size, COUNT(*) AS c FROM assets WHERE project_id = ? AND type != 'script' AND hash IS NOT NULL AND size > 0 GROUP BY hash HAVING COUNT(*) > 1)`, p.id)!;
    if (dup.n) add({ rule: 'duplicates', severity: 'info', title: 'Review duplicate files', detail: `${dup.n} asset(s) stored more than once (${(dup.b / 1048576).toFixed(2)} MB of redundant copies).`, action: { label: 'Open assets', kind: 'view', target: 'assets' } });
    const png = db().get<{ n: number; b: number }>(`SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS b FROM assets WHERE project_id = ? AND ext = 'png' AND size > ?`, p.id, s.largeAssetKB * 1024)!;
    if (png.n) add({ rule: 'webp', severity: 'info', title: 'Consider WEBP conversion', detail: `${png.n} PNG file(s) over ${s.largeAssetKB} KB (${(png.b / 1048576).toFixed(1)} MB total).`, action: { label: 'Open assets', kind: 'view', target: 'assets' } });
    if (p.category === 'game' && p.stats.totalFiles < 5000) {
      const broken = assetReport(p.id).broken;
      if (broken.length) add({ rule: 'broken_asset', severity: 'warning', title: 'Investigate broken resource', detail: `${broken.length} referenced asset(s) not found (e.g. ${broken[0].reference}).`, action: { label: 'Open assets', kind: 'view', target: 'assets' } });
    }
  }
  // shared library updated → dependents need testing
  for (const lib of projects.filter((p) => p.category === 'library')) {
    const deps = dependents(lib.id);
    if (!deps.length || !lib.lastLocalUpdate) continue;
    const stale = deps.map((d) => byId.get(d)).filter((d): d is ProjectSummary => !!d && (!d.lastDeployment || d.lastDeployment < lib.lastLocalUpdate!));
    if (stale.length && Date.now() - Date.parse(lib.lastLocalUpdate) < 30 * 86400_000) {
      out.push({ id: `library:${lib.id}`, projectId: lib.id, projectName: lib.name, rule: 'library_updated', severity: 'warning', title: 'Test dependent projects',
        detail: `${lib.name} changed after ${stale.length} dependent project(s) were last deployed: ${stale.map((x) => x.name).join(', ')}.`, action: { label: 'Dependency map', kind: 'view', target: 'dependencies' } });
    }
  }
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  out.sort((a, b) => rank[a.severity] - rank[b.severity] || (b.priority ?? 0) - (a.priority ?? 0));
  caches.set(currentWs(), { at: Date.now(), data: out });
  return out;
}
export const invalidateRecommendations = () => { caches.delete(currentWs()); };
