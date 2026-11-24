import crypto from 'node:crypto';
import type { DeployPreflight, DeploymentState } from '@pulse/shared';
import { db, json, now } from '../../database/db.js';
import { broadcast } from '../../websocket/hub.js';
import { audit } from '../../security/audit.js';
import { getProject, HttpError, listProjects, normaliseRemotePath } from '../projects.js';
import { scanProject, scopeFor } from '../filesystem/scanner.js';
import { runToCompletion } from '../process-manager/processes.js';
import { listReleases } from '../firebase/hosting.js';
import { notify } from '../notifications/notifications.js';
import { computeDeploymentState, deploying, getSiteInfo, localDeployFiles, recordBaseline, refreshSite } from './state.js';
import { sleep } from '../../util.js';
import { currentWs } from '../../workspace/context.js';

interface Pending { projectId: string; ws: string; exp: number }
const tokens = new Map<string, Pending>();

export function buildStatus(projectId: string): DeployPreflight['buildStatus'] {
  const p = getProject(projectId);
  if (!p.commands.build) return 'none';
  const last = json<{ ok: boolean; at: string } | undefined>(db().meta('build:' + projectId), undefined);
  if (last && !last.ok) return 'failed';
  const scope = scopeFor(p);
  if (scope.deployIsBuild) {
    const builtAt = db().get<{ t: string }>(`SELECT MAX(detected_at) AS t FROM file_events WHERE project_id = ? AND event_type = 'build_completed'`, projectId)?.t ?? last?.at;
    if (!builtAt) return 'unknown';
    if (p.lastLocalUpdate && p.lastLocalUpdate > builtAt) return 'stale';
  }
  return last ? 'ok' : 'unknown';
}

export function setBuildResult(projectId: string, ok: boolean) { db().setMeta('build:' + projectId, JSON.stringify({ ok, at: now() })); }

export async function preflight(projectId: string): Promise<DeployPreflight> {
  const p = getProject(projectId);
  const cmp = await computeDeploymentState(projectId);
  const d = p.deployment;
  const warnings: string[] = [];
  const shared = d?.hostingSiteId
    ? listProjects().filter((o) => o.id !== p.id && o.deployment?.hostingSiteId === d.hostingSiteId).map((o) => ({
      id: o.id, name: o.name, remotePath: normaliseRemotePath(o.deployment!.remotePath),
      status: (json<DeploymentState | undefined>(db().get<{ deploy_state: string }>('SELECT deploy_state FROM projects WHERE id = ?', o.id)?.deploy_state, undefined)?.status ?? 'unverified'),
    }))
    : [];
  if (shared.length) {
    warnings.push(`Hosting site "${d!.hostingSiteId}" is shared with ${shared.length} other project(s). A site-level "firebase deploy" publishes the whole hosting directory and creates one release for the entire site.`);
    const pendingOthers = shared.filter((s) => s.status === 'needs_deployment');
    if (pendingOthers.length) warnings.push(`These projects on the same site also have pending changes and may be published by this deployment: ${pendingOthers.map((s) => s.name).join(', ')}.`);
  }
  const bs = buildStatus(projectId);
  if (bs === 'failed') warnings.push('The last build failed. Deployment is blocked until a build succeeds.');
  if (bs === 'stale') warnings.push('Build output is older than the source files — the build will run first.');
  if (!p.commands.deploy) warnings.push('No deploy command is configured for this project (Settings → Commands).');
  if (deploying.has(projectId)) warnings.push('A deployment is already running.');
  const blocked = !p.commands.deploy || deploying.has(projectId) || (bs === 'failed' && !p.commands.build);
  const confirmToken = crypto.randomBytes(16).toString('hex');
  tokens.set(confirmToken, { projectId, ws: currentWs(), exp: Date.now() + 10 * 60_000 });
  return {
    projectId, site: d?.hostingSiteId, firebaseProjectId: d?.firebaseProjectId, remotePath: d ? normaliseRemotePath(d.remotePath) : undefined, deployDirectory: d?.deployDirectory,
    changes: cmp?.changes ?? [], buildCommand: p.commands.build, deployCommand: p.commands.deploy, buildStatus: bs, sharedSiteProjects: shared, warnings, blocked, confirmToken,
  };
}

/** Execute an explicitly confirmed deployment: build → deploy → verify. Progress is streamed over WebSocket. */
export async function startDeployment(projectId: string, confirmToken: string, skipBuild = false) {
  const t = tokens.get(confirmToken);
  if (!t || t.projectId !== projectId || t.ws !== currentWs() || t.exp < Date.now()) throw new HttpError(403, 'Deployment confirmation expired — review the preflight again');
  tokens.delete(confirmToken);
  const p = getProject(projectId);
  if (!p.commands.deploy) throw new HttpError(400, 'No deploy command configured');
  if (deploying.has(projectId)) throw new HttpError(409, 'Deployment already running');
  deploying.add(projectId);
  audit('deployment.start', projectId, { site: p.deployment?.hostingSiteId, command: p.commands.deploy, build: !skipBuild && !!p.commands.build });
  broadcast('deployment.started', projectId, { at: now() });
  await computeDeploymentState(projectId);
  void run(projectId, skipBuild).finally(async () => { deploying.delete(projectId); await computeDeploymentState(projectId); broadcast('project.updated', projectId); });
  return { started: true };
}

async function fail(projectId: string, message: string) {
  recordBaseline(projectId, 'dashboard', { status: 'failed', message });
  audit('deployment.failed', projectId, message);
  notify(projectId, 'deployment_failed', `${getProject(projectId).name}: ${message}`);
  broadcast('deployment.failed', projectId, { message });
}

async function run(projectId: string, skipBuild: boolean) {
  const p = getProject(projectId);
  const startedAt = new Date();
  try {
    if (p.commands.build && !skipBuild) {
      const b = await runToCompletion(projectId, 'build');
      setBuildResult(projectId, b.code === 0);
      if (b.code !== 0) return fail(projectId, `Build failed (exit code ${b.code})`);
    }
    await scanProject(projectId); // pick up fresh build output
    const before = localDeployFiles(getProject(projectId)).map((f) => `${f.remote}:${f.hash}`).sort().join('|');
    const d = await runToCompletion(projectId, 'deploy');
    if (d.code !== 0) return fail(projectId, `Deploy command failed (exit code ${d.code})`);
    await scanProject(projectId);
    const after = localDeployFiles(getProject(projectId)).map((f) => `${f.remote}:${f.hash}`).sort().join('|');
    const site = p.deployment?.provider === 'firebase' ? p.deployment.hostingSiteId : '';
    if (!site) {
      recordBaseline(projectId, 'dashboard', { message: 'Deploy command succeeded (no Firebase site to verify against)' });
      audit('deployment.completed', projectId, 'unverified-local');
      broadcast('deployment.completed', projectId, { verified: false });
      return;
    }
    // Verification: wait for the new release to appear
    let release;
    for (let i = 0; i < 24 && !release; i++) {
      try {
        const rs = await listReleases(site, 3);
        release = rs.find((r) => Date.parse(r.releaseTime) >= startedAt.getTime() - 120_000 && r.version?.name && r.version.name !== getSiteInfo(site)?.latestVersion) ?? (Date.parse(rs[0]?.releaseTime ?? '') >= startedAt.getTime() - 5_000 ? rs[0] : undefined);
      } catch (e) { if (i > 3) return fail(projectId, 'Deployed, but verification failed: ' + (e as Error).message); }
      if (!release) await sleep(5000);
    }
    if (!release?.version) return fail(projectId, 'Deploy command succeeded but no new Firebase release was found — status left unverified');
    await refreshSite(site, { force: true });
    if (before === after) {
      // Local files did not change during the deploy, so the new version was produced from exactly this manifest.
      recordBaseline(projectId, 'dashboard', { versionId: release.version.name, releaseId: release.name.split('/').pop(), deployedAt: release.releaseTime, message: 'Deployed and verified from Project Pulse' });
    }
    const st = await computeDeploymentState(projectId);
    if (st && st.state.pendingCount === 0 && st.state.unverifiedFiles === 0) {
      audit('deployment.completed', projectId, { release: release.name });
      notify(projectId, 'deployment_completed', `${p.name} deployed and verified (${site})`);
      broadcast('deployment.completed', projectId, { verified: true });
    } else {
      fail(projectId, `Deployment finished but verification found ${st?.state.pendingCount ?? '?'} differing and ${st?.state.unverifiedFiles ?? '?'} unverified file(s)`);
    }
  } catch (e) {
    await fail(projectId, (e as Error).message);
  }
}
