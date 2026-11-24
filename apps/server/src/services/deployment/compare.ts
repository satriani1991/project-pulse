import type { PendingChange } from '@pulse/shared';

export interface LocalDeployFile { remote: string; rel: string; hash: string | null; gzip?: string; size: number; mtimeMs: number }

export interface CompareResult {
  added: PendingChange[];
  modified: PendingChange[];
  deleted: PendingChange[];
  unverified: PendingChange[];
  matched: number;
  /** true when at least one file matched by recomputed gzip hash, which validates hash equivalence for all files */
  gzipValidated: boolean;
}

/**
 * Compare a local deployable manifest with a remote Firebase Hosting file manifest (path → SHA-256 of gzip content).
 *
 * Matching strategies, in order:
 *  1. Recomputed gzip SHA-256 equals the remote hash (same compression as firebase-tools).
 *  2. A recorded verified pair (local content hash ↔ remote hash) from a dashboard deployment, a confirmed baseline or HTTP verification.
 *  3. Known content hash of the remote file (from HTTP verification) compared with the local content hash.
 * Files that cannot be decided are "unverified" unless strategy 1 succeeded for other files, in which case a mismatch is a real modification.
 */
export function compareManifests(
  local: LocalDeployFile[],
  remote: Map<string, string>,
  isPaired: (localHash: string, remoteHash: string) => boolean,
  contentOf: (remoteHash: string) => string[] | undefined,
): CompareResult {
  const res: CompareResult = { added: [], modified: [], deleted: [], unverified: [], matched: 0, gzipValidated: false };
  const candidates: PendingChange[] = [];
  const seen = new Set<string>();
  for (const f of local) {
    seen.add(f.remote);
    const rh = remote.get(f.remote);
    const entry: PendingChange = { path: f.rel, change: 'added', size: f.size, modifiedAt: new Date(f.mtimeMs).toISOString() };
    if (!rh) { res.added.push(entry); continue; }
    if (f.gzip && f.gzip === rh) { res.matched++; res.gzipValidated = true; continue; }
    if (f.hash && isPaired(f.hash, rh)) { res.matched++; continue; }
    const content = contentOf(rh);
    if (content && f.hash) {
      if (content.includes(f.hash)) res.matched++;
      else res.modified.push({ ...entry, change: 'modified' });
      continue;
    }
    candidates.push(entry);
  }
  for (const c of candidates) (res.gzipValidated ? res.modified : res.unverified).push({ ...c, change: res.gzipValidated ? 'modified' : 'unverified' });
  for (const [p] of remote) if (!seen.has(p)) res.deleted.push({ path: p, change: 'deleted' });
  return res;
}

/** Compare current local hashes with a recorded local baseline (exact, offline). */
export function compareWithBaseline(local: LocalDeployFile[], baseline: Map<string, string | null>): CompareResult {
  const res: CompareResult = { added: [], modified: [], deleted: [], unverified: [], matched: 0, gzipValidated: false };
  const seen = new Set<string>();
  for (const f of local) {
    seen.add(f.remote);
    const entry: PendingChange = { path: f.rel, change: 'added', size: f.size, modifiedAt: new Date(f.mtimeMs).toISOString() };
    if (!baseline.has(f.remote)) res.added.push(entry);
    else if (baseline.get(f.remote) !== f.hash) res.modified.push({ ...entry, change: 'modified' });
    else res.matched++;
  }
  for (const [p] of baseline) if (!seen.has(p)) res.deleted.push({ path: p, change: 'deleted' });
  return res;
}

/** Restrict a site-wide manifest to one project's remote path, excluding deeper paths owned by other projects. */
export function subsetForPath(files: Map<string, string>, remotePath: string, otherPrefixes: string[] = []): Map<string, string> {
  const prefix = remotePath.endsWith('/') ? remotePath : remotePath + '/';
  const excluded = otherPrefixes.filter((o) => o !== prefix && o.startsWith(prefix));
  const out = new Map<string, string>();
  for (const [p, h] of files) if (p.startsWith(prefix) && !excluded.some((e) => p.startsWith(e))) out.set(p, h);
  return out;
}

export function subtreeDigest(files: Map<string, string>): string {
  if (!files.size) return 'empty';
  // FNV-1a over sorted entries — cheap and adequate for change detection between versions
  let h = 0x811c9dc5;
  for (const k of [...files.keys()].sort()) {
    const s = k + '\0' + files.get(k) + '\n';
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  }
  return `${files.size}:${h.toString(16)}`;
}
