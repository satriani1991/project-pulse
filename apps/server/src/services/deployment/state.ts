import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Deployment, DeploymentState, PendingChange, Project } from '@pulse/shared';
import { db, json, now, type Row } from '../../database/db.js';
import { broadcast } from '../../websocket/hub.js';
import { KeyedMutex, pool, localDate } from '../../util.js';
import { findProject, getProject, listProjects, normaliseRemotePath, setError, setProjectFields } from '../projects.js';
import { scopeFor } from '../filesystem/scanner.js';
import { getVersionFiles, listReleases, releaseId, type HostingRelease } from '../firebase/hosting.js';
import { compareManifests, compareWithBaseline, subsetForPath, subtreeDigest, type CompareResult, type LocalDeployFile } from './compare.js';
import { getSettings } from '../settings.js';
import { notify } from '../notifications/notifications.js';
import { currentWs } from '../../workspace/context.js';

const deployingSet = new Set<string>();
/** Projects with a running deployment (scoped to the current workspace). */
export const deploying = {
  has: (id: string) => deployingSet.has(`${currentWs()}:${id}`),
  add: (id: string) => deployingSet.add(`${currentWs()}:${id}`),
  delete: (id: string) => deployingSet.delete(`${currentWs()}:${id}`),
};
const HISTORY_DEPTH = 15;

interface SiteInfo { site: string; latestVersion?: string; releaseTime?: string; releaseId?: string; fetchedAt: string; error?: string }
const siteKey = (site: string) => `site:${site}`;
export const getSiteInfo = (site: string) => json<SiteInfo | undefined>(db().meta(siteKey(site)), undefined);

/** Local deployable files keyed by their remote (site-absolute) path. */
export function localDeployFiles(p: Project): LocalDeployFile[] {
  const scope = scopeFor(p);
  if (scope.deployRel === undefined) return [];
  const prefix = normaliseRemotePath(p.deployment?.remotePath);
  const dr = scope.deployRel;
  const rows = db().all<Row>('SELECT f.path, f.hash, f.size, f.mtime_ms, g.gzip_hash FROM file_index f LEFT JOIN gzip_hashes g ON g.local_hash = f.hash WHERE f.project_id = ? AND f.deploy = 1', p.id);
  return rows.map((r) => {
    const relToDeploy = dr ? r.path.slice(dr.length + 1) : r.path;
    return { remote: prefix + relToDeploy, rel: r.path, hash: r.hash, gzip: r.gzip_hash ?? undefined, size: r.size, mtimeMs: r.mtime_ms };
  });
}

/** SHA-256 of gzip(level 9) — the same transformation firebase-tools applies before upload. Cached by content hash. */
async function ensureGzipHashes(p: Project, files: LocalDeployFile[]) {
  const missing = files.filter((f) => f.hash && !f.gzip);
  const uniq = new Map<string, LocalDeployFile>();
  for (const f of missing) uniq.set(f.hash!, f);
  await pool([...uniq.values()], 4, async (f) => {
    try {
      const h = crypto.createHash('sha256');
      await pipeline(fs.createReadStream(path.join(p.rootPath, f.rel)), zlib.createGzip({ level: 9 }), async function* (src) { for await (const c of src) h.update(c); });
      const gz = h.digest('hex');
      db().run('INSERT OR REPLACE INTO gzip_hashes(local_hash, gzip_hash) VALUES (?, ?)', f.hash, gz);
      for (const x of files) if (x.hash === f.hash) x.gzip = gz;
    } catch { /* unreadable */ }
  });
}

function otherPrefixesOnSite(p: Project): string[] {
  if (!p.deployment?.hostingSiteId) return [];
  return db().all<{ remote_path: string }>('SELECT remote_path FROM hosting_targets WHERE site_id = ? AND project_id != ?', p.deployment.hostingSiteId, p.id).map((r) => r.remote_path);
}

const isPaired = (l: string, r: string) => !!db().get('SELECT 1 FROM hash_pairs WHERE local_hash = ? AND remote_hash = ?', l, r);
const contentOf = (r: string) => { const rows = db().all<{ local_hash: string }>('SELECT local_hash FROM hash_pairs WHERE remote_hash = ?', r); return rows.length ? rows.map((x) => x.local_hash) : undefined; };

function lastDashboardDeployment(projectId: string) {
  return db().get<Row>(`SELECT * FROM deployments WHERE project_id = ? AND source IN ('dashboard','manual') ORDER BY deployed_at DESC LIMIT 1`, projectId);
}
function baselineFor(projectId: string): { id: number; files: Map<string, string | null>; versionId?: string } | undefined {
  const d = db().get<Row>(`SELECT id, version_id FROM deployments WHERE project_id = ? AND source IN ('dashboard','manual') AND status = 'success' ORDER BY deployed_at DESC LIMIT 1`, projectId);
  if (!d) return undefined;
  const files = new Map(db().all<{ path: string; local_hash: string | null }>('SELECT path, local_hash FROM deployment_manifests WHERE deployment_id = ?', d.id).map((r) => [r.path, r.local_hash]));
  return { id: d.id, files, versionId: d.version_id ?? undefined };
}

export interface FullComparison { state: DeploymentState; changes: PendingChange[] }

const mutex = new KeyedMutex();

/** Compute and persist a project's deployment state using the best available method. */
export function computeDeploymentState(projectId: string): Promise<FullComparison | undefined> {
  return mutex.run('state:' + projectId, async () => {
    const p = findProject(projectId);
    if (!p) return undefined;
    const r = await compute(p);
    const prev = json<DeploymentState | undefined>(db().get<{ deploy_state: string }>('SELECT deploy_state FROM projects WHERE id = ?', p.id)?.deploy_state, undefined);
    // pendingSince is sticky until the project becomes up to date again
    if (r.state.pendingCount > 0) r.state.pendingSince = prev?.pendingSince && prev.pendingCount > 0 ? prev.pendingSince : r.state.pendingSince ?? now();
    else delete r.state.pendingSince;
    setProjectFields(p.id, { deploy_state: r.state });
    if (!prev || prev.status !== r.state.status || prev.pendingCount !== r.state.pendingCount) broadcast('project.updated', p.id);
    return r;
  });
}

async function compute(p: Project): Promise<FullComparison> {
  const base: DeploymentState = { status: 'unverified', method: 'none', confidence: 'none', pendingCount: 0, added: 0, modified: 0, deleted: 0, unverifiedFiles: 0, checkedAt: now() };
  if (!p.deployment || p.deployment.provider === 'none') return { state: { ...base, status: 'local_only' }, changes: [] };
  const local = localDeployFiles(p);
  const site = p.deployment.hostingSiteId;
  const info = site && p.deploymentMonitoring ? getSiteInfo(site) : undefined;
  let result: CompareResult | undefined;
  let state: DeploymentState = { ...base };
  if (info?.latestVersion) {
    state.siteReleaseTime = info.releaseTime; state.releaseId = info.releaseId; state.versionId = info.latestVersion;
    if (info.error) state.error = info.error;
    const all = await getVersionFiles(info.latestVersion, site).catch(() => undefined);
    if (all) {
      const remote = subsetForPath(all, normaliseRemotePath(p.deployment.remotePath), otherPrefixesOnSite(p));
      if (!remote.size) {
        state = { ...state, status: 'never_deployed', method: 'manifest', confidence: 'verified', pendingCount: local.length, added: local.length, message: `Nothing is published under ${p.deployment.remotePath} on ${site}` };
        return { state, changes: local.map((f) => ({ path: f.rel, change: 'added', size: f.size, modifiedAt: new Date(f.mtimeMs).toISOString() })) };
      }
      await ensureGzipHashes(p, local);
      result = compareManifests(local, remote, isPaired, contentOf);
      state.method = 'manifest';
      state.confidence = result.unverified.length ? (result.matched || result.added.length || result.modified.length ? 'partial' : 'none') : 'verified';
    }
  } else if (info?.error) state.error = info.error;

  if (!result) {
    const bl = baselineFor(p.id);
    if (bl) { result = compareWithBaseline(local, bl.files); state.method = 'baseline'; state.confidence = 'verified'; }
  }

  if (!result) {
    // Method A — timestamp hint only
    const lastDeploy = p.lastDeployment ?? state.siteReleaseTime;
    state.method = 'timestamp'; state.confidence = 'hint';
    if (!lastDeploy) { state.status = site ? 'unverified' : 'never_deployed'; state.message = site ? 'Deployment information unavailable — connect Firebase credentials or confirm a baseline' : 'No deployment recorded'; }
    else if (p.lastLocalUpdate && p.lastLocalUpdate > lastDeploy) { state.status = 'needs_deployment'; state.message = 'Possibly outdated (local files changed after the last known deployment; timestamp comparison only)'; }
    else { state.status = 'unverified'; state.message = 'No local changes since the last known deployment (timestamp comparison only)'; }
    return finalize(p, state, []);
  }

  const changes = [...result.added, ...result.modified, ...result.deleted, ...result.unverified];
  state.added = result.added.length; state.modified = result.modified.length; state.deleted = result.deleted.length; state.unverifiedFiles = result.unverified.length;
  state.pendingCount = state.added + state.modified + state.deleted;
  if (state.pendingCount > 0) state.status = 'needs_deployment';
  else if (state.unverifiedFiles > 0) { state.status = 'unverified'; state.message = `${state.unverifiedFiles} file(s) could not be matched to production hashes — run "Verify via HTTP" or confirm a baseline`; }
  else state.status = 'up_to_date';
  const changedTimes = [...result.added, ...result.modified].map((c) => c.modifiedAt!).filter(Boolean).sort();
  if (changedTimes.length) state.pendingSince = changedTimes[0];
  return finalize(p, state, changes);
}

function finalize(p: Project, state: DeploymentState, changes: PendingChange[]): FullComparison {
  const last = lastDashboardDeployment(p.id);
  if (deploying.has(p.id)) state.status = 'deploying';
  else if (last?.status === 'failed') {
    const lastOk = db().get<{ t: string }>(`SELECT MAX(deployed_at) AS t FROM deployments WHERE project_id = ? AND status = 'success'`, p.id)?.t;
    if (!lastOk || last.deployed_at > lastOk) { state.status = 'deployment_failed'; state.message = last.message ?? 'The latest deployment attempt failed'; }
  }
  return { state, changes };
}

export async function pendingChanges(projectId: string): Promise<PendingChange[]> {
  return (await computeDeploymentState(projectId))?.changes ?? [];
}

/**
 * Poll Firebase for one hosting site: release list + per-project history (which releases actually changed each
 * project's subtree). Releases are site-wide, so a project's "last deployment" is the newest release whose subtree digest differs from the previous one.
 */
export async function refreshSite(site: string, opts: { force?: boolean } = {}) {
  const projects = listProjects().filter((p) => p.deployment?.provider === 'firebase' && p.deployment.hostingSiteId === site && p.deploymentMonitoring);
  if (!projects.length) return;
  let releases: HostingRelease[];
  try {
    releases = await listReleases(site, HISTORY_DEPTH + 1);
  } catch (e) {
    const msg = (e as Error).message;
    const prev = getSiteInfo(site);
    db().setMeta(siteKey(site), JSON.stringify({ ...(prev ?? { site }), fetchedAt: now(), error: msg }));
    for (const p of projects) { setError(p.id, 'firebase', msg); await computeDeploymentState(p.id); }
    return;
  }
  const deploys = releases.filter((r) => r.version?.name && r.type !== 'SITE_DISABLE');
  const latest = deploys[0];
  const prev = getSiteInfo(site);
  db().setMeta(siteKey(site), JSON.stringify({ site, latestVersion: latest?.version?.name, releaseTime: latest?.releaseTime, releaseId: latest ? releaseId(latest) : undefined, fetchedAt: now() } satisfies SiteInfo));
  const changed = prev?.latestVersion !== latest?.version?.name;
  if (changed || opts.force) {
    // Fetch file lists (cached forever per version)
    const versionFiles = new Map<string, Map<string, string>>();
    for (const r of deploys) {
      try { versionFiles.set(r.version!.name, await getVersionFiles(r.version!.name, site)); } catch (e) { console.error('[firebase] version files', (e as Error).message); break; }
    }
    for (const p of projects) {
      const prefix = normaliseRemotePath(p.deployment!.remotePath);
      const others = otherPrefixesOnSite(p);
      const digests = deploys.map((r) => { const f = versionFiles.get(r.version!.name); return f ? subtreeDigest(subsetForPath(f, prefix, others)) : undefined; });
      let lastAffecting: string | undefined;
      db().tx(() => {
        deploys.forEach((r, i) => {
          const d = digests[i];
          if (d === undefined) return;
          const older = digests[i + 1];
          // The oldest release in the window counts as affecting when the subtree exists in it.
          const affects = d !== 'empty' && (older === undefined ? i === deploys.length - 1 : older !== d);
          if (affects && !lastAffecting) lastAffecting = r.releaseTime;
          const files = versionFiles.get(r.version!.name)!;
          db().run(`INSERT INTO deployments(project_id, source, release_id, version_id, deployed_at, deployed_by, status, message, affects_project, file_count, subtree_digest)
            VALUES (?, 'firebase', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id, release_id) DO UPDATE SET affects_project = excluded.affects_project, subtree_digest = excluded.subtree_digest, file_count = excluded.file_count`,
            p.id, releaseId(r), r.version!.name, r.releaseTime, r.releaseUser?.email ?? null, r.version?.status === 'FINALIZED' || !r.version?.status ? 'success' : 'unknown',
            r.message ?? null, affects ? 1 : 0, subsetForPath(files, prefix, others).size, d);
        });
      });
      if (lastAffecting && lastAffecting !== p.lastDeployment) setProjectFields(p.id, { last_deployment: lastAffecting });
      if (changed && prev?.latestVersion && digests[0] !== undefined && digests[0] !== 'empty' && digests[0] === digests[1]) {
        // Site-level release that did not touch this project — the classic shared-site trap (§6.4)
        db().run(`INSERT INTO file_events(project_id, path, event_type, detail, detected_at) VALUES (?, ?, 'deployment', ?, ?)`, p.id, site,
          `Site ${site} released without changes to ${prefix}`, latest!.releaseTime);
      } else if (changed && digests[0] !== undefined && digests[0] !== 'empty') {
        db().run(`INSERT INTO file_events(project_id, path, event_type, detail, detected_at) VALUES (?, ?, 'deployment', ?, ?)`, p.id, site,
          `Production deployment completed · Firebase Hosting (${site})`, latest!.releaseTime);
        broadcast('deployment.completed', p.id, { releaseId: releaseId(latest!) });
      }
    }
  }
  for (const p of projects) { setError(p.id, 'firebase', null); await computeDeploymentState(p.id); }
}

export async function refreshAllSites(opts: { force?: boolean } = {}) {
  const sites = new Set(listProjects().filter((p) => p.deployment?.provider === 'firebase' && p.deployment.hostingSiteId && p.deploymentMonitoring).map((p) => p.deployment!.hostingSiteId));
  for (const s of sites) await refreshSite(s, opts).catch((e) => console.error('[firebase]', s, (e as Error).message));
  // projects without a site still get a state (baseline / timestamp)
  for (const p of listProjects()) if (!p.deployment?.hostingSiteId) await computeDeploymentState(p.id);
}

/**
 * Record a verified baseline: the current local deployable files are what production serves.
 * source = 'manual' (user assertion) or 'dashboard' (deployment executed and verified by Pulse).
 */
export function recordBaseline(projectId: string, source: 'manual' | 'dashboard', opts: { versionId?: string; releaseId?: string; deployedAt?: string; message?: string; status?: 'success' | 'failed' } = {}): number {
  const p = getProject(projectId);
  const local = localDeployFiles(p);
  const status = opts.status ?? 'success';
  let id = 0;
  db().tx(() => {
    const r = db().run(`INSERT INTO deployments(project_id, source, release_id, version_id, deployed_at, deployed_by, status, message, affects_project, file_count, local_version)
      VALUES (?, ?, ?, ?, ?, 'Project Pulse', ?, ?, 1, ?, ?)`, p.id, source, opts.releaseId ? `${source}:${opts.releaseId}` : `${source}:${Date.now()}`, opts.versionId ?? null,
      opts.deployedAt ?? now(), status, opts.message ?? null, local.length, p.version ?? null);
    id = Number(r.lastInsertRowid);
    if (status !== 'success') return;
    for (const f of local) db().run('INSERT OR REPLACE INTO deployment_manifests(deployment_id, path, content_hash, local_hash) VALUES (?, ?, NULL, ?)', id, f.remote, f.hash);
    if (opts.versionId) {
      const files = db().all<{ path: string; hash: string }>('SELECT path, hash FROM hosting_version_files WHERE version_id = ?', opts.versionId);
      const remote = new Map(files.map((f) => [f.path, f.hash]));
      for (const f of local) {
        const rh = remote.get(f.remote);
        if (rh && f.hash) {
          db().run('INSERT OR IGNORE INTO hash_pairs(local_hash, remote_hash, verified_at, method) VALUES (?, ?, ?, ?)', f.hash, rh, now(), source);
          db().run('UPDATE deployment_manifests SET content_hash = ? WHERE deployment_id = ? AND path = ?', rh, id, f.remote);
        }
      }
    }
    setProjectFields(p.id, { last_deployment: opts.deployedAt ?? now() });
  });
  return id;
}

/** Download unverified production files over HTTPS and hash their content to learn remote ↔ content equivalence. */
export async function verifyViaHttp(projectId: string) {
  const p = getProject(projectId);
  const site = p.deployment?.hostingSiteId;
  const info = site ? getSiteInfo(site) : undefined;
  if (!site || !info?.latestVersion) throw new Error('Remote manifest unavailable — refresh Firebase first');
  const all = await getVersionFiles(info.latestVersion, site);
  const remote = subsetForPath(all, normaliseRemotePath(p.deployment!.remotePath), otherPrefixesOnSite(p));
  const cmp = await computeDeploymentState(projectId);
  const targets = (cmp?.changes ?? []).filter((c) => c.change === 'unverified');
  const local = new Map(localDeployFiles(p).map((f) => [f.rel, f]));
  const origin = `https://${site}.web.app`;
  const budget = getSettings().remoteVerifyMaxMB * 1024 * 1024;
  let bytes = 0, verified = 0, differs = 0, failed = 0;
  await pool(targets, 4, async (t) => {
    const f = local.get(t.path);
    if (!f) return;
    const rh = remote.get(f.remote);
    if (!rh || bytes > budget) return;
    try {
      const r = await fetch(origin + encodeURI(f.remote), { signal: AbortSignal.timeout(60_000), headers: { 'Cache-Control': 'no-cache' } });
      if (!r.ok) { failed++; return; }
      const buf = Buffer.from(await r.arrayBuffer());
      bytes += buf.length;
      const h = crypto.createHash('sha256').update(buf).digest('hex');
      db().run('INSERT OR IGNORE INTO hash_pairs(local_hash, remote_hash, verified_at, method) VALUES (?, ?, ?, ?)', h, rh, now(), 'http');
      if (h === f.hash) verified++; else differs++;
    } catch { failed++; }
  });
  const after = await computeDeploymentState(projectId);
  return { checked: targets.length, verified, differs, failed, bytes, state: after?.state };
}

export function listDeployments(projectId: string): Deployment[] {
  return db().all<Row>('SELECT * FROM deployments WHERE project_id = ? ORDER BY deployed_at DESC LIMIT 200', projectId).map(rowToDeployment);
}
export function rowToDeployment(r: Row): Deployment {
  return { id: r.id, projectId: r.project_id, source: r.source, releaseId: r.release_id ?? undefined, versionId: r.version_id ?? undefined, deployedAt: r.deployed_at,
    deployedBy: r.deployed_by ?? undefined, status: r.status, message: r.message ?? undefined, affectsProject: !!r.affects_project, fileCount: r.file_count ?? undefined, localVersion: r.local_version ?? undefined };
}

/** Pending-deployment reminders (configurable age). */
export function checkReminders() {
  const days = getSettings().reminderDays;
  for (const p of listProjects()) {
    const s = json<DeploymentState | undefined>(db().get<{ deploy_state: string }>('SELECT deploy_state FROM projects WHERE id = ?', p.id)?.deploy_state, undefined);
    if (!s || s.status !== 'needs_deployment' || !s.pendingSince) continue;
    const age = (Date.now() - Date.parse(s.pendingSince)) / 86400_000;
    if (age >= days) notify(p.id, 'deployment_reminder', `${p.name}: ${s.pendingCount} change(s) undeployed for ${Math.floor(age)} day(s)`, `reminder:${p.id}:${days}:${localDate(s.pendingSince)}`);
  }
}
