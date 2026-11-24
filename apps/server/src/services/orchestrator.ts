import { onAfterScan } from './hooks.js';
import { computeDeploymentState, refreshSite } from './deployment/state.js';
import { indexAssets } from './assets/assets.js';
import { refreshGit } from './git/git.js';
import { dependents, discoverDependencies, notifyLibraryChange } from './dependencies/dependencies.js';
import { aggregate } from './analytics/analytics.js';
import { invalidateRecommendations } from './recommendations/recommendations.js';
import { scanProject } from './filesystem/scanner.js';
import { watchProject } from './watcher/watcher.js';
import { getProject } from './projects.js';
import { checkHealth } from './health/health.js';
import { currentWs } from '../workspace/context.js';

const timers = new Map<string, NodeJS.Timeout>();
function debounce(rawKey: string, ms: number, fn: () => unknown) {
  const key = `${currentWs()}:${rawKey}`;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { timers.delete(key); Promise.resolve(fn()).catch((e) => console.error(`[${key}]`, (e as Error).message)); }, ms));
}

/** Wire post-scan processing: deployment state, assets, git, library impact, analytics. */
export function registerHooks() {
  onAfterScan(async (r) => {
    const meaningful = r.created.length + r.modified.length + r.deleted.length + r.renamed.length > 0;
    if (r.deployChanged || r.initial) debounce('deploy:' + r.projectId, 500, () => computeDeploymentState(r.projectId));
    if (r.assetChanged || r.initial) debounce('assets:' + r.projectId, 1000, () => indexAssets(r.projectId));
    if (meaningful) {
      debounce('git:' + r.projectId, 4000, () => refreshGit(r.projectId));
      if (dependents(r.projectId).length) notifyLibraryChange(r.projectId);
      debounce('analytics', 10_000, () => aggregate(1));
      invalidateRecommendations();
    }
  });
}

/** Full pipeline for a newly registered project. */
export async function onboardProject(projectId: string) {
  await scanProject(projectId);
  await refreshGit(projectId, { importHistory: true });
  indexAssets(projectId);
  await watchProject(projectId);
  const p = getProject(projectId);
  if (p.deployment?.provider === 'firebase' && p.deployment.hostingSiteId) await refreshSite(p.deployment.hostingSiteId, { force: true }).catch(() => undefined);
  else await computeDeploymentState(projectId);
  discoverDependencies();
  aggregate(400);
  invalidateRecommendations();
  void checkHealth(projectId).catch(() => undefined);
}
