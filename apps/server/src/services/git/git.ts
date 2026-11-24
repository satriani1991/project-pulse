import { execFile } from 'node:child_process';
import type { GitSnapshot, Project } from '@pulse/shared';
import { EXT_KIND } from '@pulse/shared';
import { db, json, now } from '../../database/db.js';
import { broadcast } from '../../websocket/hub.js';
import { extOf, KeyedMutex } from '../../util.js';
import { getProject, setProjectFields } from '../projects.js';

const SEP = '\x1f';
function git(cwd: string, args: string[], timeout = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=off', ...args], { cwd, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split('\n')[0])); else resolve(stdout);
    });
  });
}

let gitAvailable: boolean | undefined;
async function hasGit() {
  if (gitAvailable === undefined) gitAvailable = await git(process.cwd(), ['--version']).then(() => true, () => false);
  return gitAvailable;
}

/** Convert git remote URL (ssh or https) to a browsable https URL. */
export function remoteToWeb(url?: string): string | undefined {
  if (!url) return undefined;
  const ssh = /^git@([^:]+):(.+?)(\.git)?$/.exec(url);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const https = /^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(\.git)?$/.exec(url);
  if (https) return `https://${https[1]}/${https[2]}`;
  return undefined;
}

export async function readGit(p: Project): Promise<GitSnapshot> {
  if (!p.gitEnabled) return { isRepo: false, dirtyCount: 0 };
  if (!(await hasGit())) return { isRepo: false, dirtyCount: 0, error: 'git executable not found on PATH' };
  try { if ((await git(p.rootPath, ['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') return { isRepo: false, dirtyCount: 0 }; }
  catch { return { isRepo: false, dirtyCount: 0 }; }
  const snap: GitSnapshot = { isRepo: true, dirtyCount: 0, checkedAt: now() };
  try { snap.branch = (await git(p.rootPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(); } catch { snap.branch = '(no commits)'; }
  try {
    const [h, s, a, d] = (await git(p.rootPath, ['log', '-1', `--format=%H${SEP}%s${SEP}%an${SEP}%aI`])).trim().split(SEP);
    Object.assign(snap, { commitHash: h, commitMessage: s, commitAuthor: a, commitDate: d });
  } catch { /* empty repo */ }
  try {
    const out = await git(p.rootPath, ['status', '--porcelain=v1', '-uall', '--', '.']);
    const lines = out.split('\n').filter(Boolean);
    snap.dirtyCount = lines.length;
    snap.files = lines.slice(0, 500).map((l) => ({ status: l.slice(0, 2).trim() || '?', path: l.slice(3) }));
  } catch (e) { snap.error = (e as Error).message; }
  try { snap.remoteUrl = remoteToWeb((await git(p.rootPath, ['config', '--get', 'remote.origin.url'])).trim()); } catch { /* no remote */ }
  try {
    const [behind, ahead] = (await git(p.rootPath, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])).trim().split(/\s+/).map(Number);
    snap.ahead = ahead; snap.behind = behind;
  } catch { /* no upstream */ }
  return snap;
}

const mutex = new KeyedMutex();

/** Refresh git snapshot, ingest new commits, broadcast if anything changed. */
export function refreshGit(projectId: string, opts: { importHistory?: boolean } = {}) {
  return mutex.run(projectId, async () => {
    let p: Project;
    try { p = getProject(projectId); } catch { return; }
    const prev = json<GitSnapshot | undefined>(db().get<{ git: string }>('SELECT git FROM projects WHERE id = ?', p.id)?.git, undefined);
    const snap = await readGit(p);
    const prevKey = prev ? `${prev.branch}|${prev.commitHash}|${prev.dirtyCount}|${prev.ahead}|${prev.behind}` : '';
    const key = `${snap.branch}|${snap.commitHash}|${snap.dirtyCount}|${snap.ahead}|${snap.behind}`;
    setProjectFields(p.id, { git: snap, ...(snap.remoteUrl && !p.repoUrl ? { repo_url: snap.remoteUrl } : {}) });
    if (snap.isRepo && (prev?.commitHash !== snap.commitHash || opts.importHistory)) {
      const first = !db().get('SELECT 1 FROM git_commits WHERE project_id = ? LIMIT 1', p.id);
      await ingestCommits(p, snap.branch, first || !!opts.importHistory);
    }
    if (snap.isRepo && prevKey !== key) {
      db().run('INSERT INTO git_snapshots(project_id, branch, commit_hash, dirty_count, taken_at) VALUES (?, ?, ?, ?, ?)', p.id, snap.branch ?? null, snap.commitHash ?? null, snap.dirtyCount, now());
      broadcast('git.updated', p.id, { branch: snap.branch, dirtyCount: snap.dirtyCount, commitHash: snap.commitHash });
    }
    return snap;
  });
}

/**
 * Import commits. On first import, also seed historical file-change events from `git log --name-status`
 * (flagged detail='seed:git') so the contribution heatmap reflects real past work.
 */
async function ingestCommits(p: Project, branch: string | undefined, seed: boolean) {
  const last = db().get<{ t: string }>('SELECT MAX(committed_at) AS t FROM git_commits WHERE project_id = ?', p.id)?.t;
  const since = last ?? new Date(Date.now() - 365 * 86400_000).toISOString();
  let out: string;
  try {
    out = await git(p.rootPath, ['log', `--since=${since}`, '--max-count=5000', `--format=@@${SEP}%H${SEP}%s${SEP}%an${SEP}%aI`, ...(seed ? ['--name-status', '--no-renames'] : []), '--', '.'], 60_000);
  } catch { return; }
  const commits = out.split('@@' + SEP).filter((c) => c.trim());
  db().tx(() => {
    for (const c of commits) {
      const [head, ...rest] = c.split('\n');
      const [hash, subject, author, date] = head.split(SEP);
      if (!hash || !date) continue;
      const ins = db().run('INSERT OR IGNORE INTO git_commits(project_id, hash, message, author, committed_at, branch) VALUES (?, ?, ?, ?, ?, ?)', p.id, hash, subject, author, new Date(date).toISOString(), branch ?? null);
      if (!ins.changes) continue;
      const at = new Date(date).toISOString();
      db().run(`INSERT INTO file_events(project_id, path, event_type, detail, detected_at) VALUES (?, ?, 'git_commit', ?, ?)`, p.id, hash.slice(0, 10), `${subject} · ${author}${branch ? ' · ' + branch : ''}`, at);
      if (!seed) continue;
      for (const line of rest) {
        const m = /^([AMD])\t(.+)$/.exec(line.trim());
        if (!m) continue;
        const type = m[1] === 'A' ? 'created' : m[1] === 'D' ? 'deleted' : 'modified';
        db().run(`INSERT INTO file_events(project_id, path, event_type, kind, detail, detected_at) VALUES (?, ?, ?, ?, 'seed:git', ?)`, p.id, m[2], type, EXT_KIND[extOf(m[2])] ?? 'other', at);
      }
    }
  });
}

export function listCommits(projectId: string, limit = 100) {
  return db().all('SELECT hash, message, author, committed_at AS committedAt, branch FROM git_commits WHERE project_id = ? ORDER BY committed_at DESC LIMIT ?', projectId, limit);
}
