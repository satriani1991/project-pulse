import { db, now } from '../../database/db.js';
import { getSettings } from '../settings.js';
import { getAccessToken } from './auth.js';

export interface HostingRelease {
  name: string; // sites/{site}/releases/{id}
  type?: string;
  releaseTime: string;
  message?: string;
  releaseUser?: { email?: string };
  version?: { name: string; status?: string; fileCount?: string | number; createTime?: string; finalizeTime?: string };
}

async function api<T>(urlPath: string): Promise<T> {
  const token = await getAccessToken();
  const base = getSettings().firebaseApiBase.replace(/\/+$/, '');
  const r = await fetch(`${base}/${urlPath}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    const msg = /"message":\s*"([^"]+)"/.exec(body)?.[1];
    throw new Error(`Firebase Hosting API ${r.status}${msg ? ': ' + msg : ''}`);
  }
  return r.json() as Promise<T>;
}

export async function listReleases(site: string, pageSize = 20): Promise<HostingRelease[]> {
  const j = await api<{ releases?: HostingRelease[] }>(`sites/${encodeURIComponent(site)}/releases?pageSize=${pageSize}`);
  return (j.releases ?? []).sort((a, b) => b.releaseTime.localeCompare(a.releaseTime));
}

/** All files of an (immutable) Hosting version; cached permanently in SQLite. */
export async function getVersionFiles(versionName: string, site: string): Promise<Map<string, string>> {
  const cached = db().get('SELECT 1 FROM hosting_versions WHERE version_id = ?', versionName);
  if (cached) {
    return new Map(db().all<{ path: string; hash: string }>('SELECT path, hash FROM hosting_version_files WHERE version_id = ?', versionName).map((r) => [r.path, r.hash]));
  }
  const files = new Map<string, string>();
  let token = '';
  for (let page = 0; page < 500; page++) {
    const j = await api<{ files?: { path: string; hash: string; status?: string }[]; nextPageToken?: string }>(
      `${versionName}/files?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
    for (const f of j.files ?? []) if (f.hash) files.set(f.path.startsWith('/') ? f.path : '/' + f.path, f.hash);
    token = j.nextPageToken ?? '';
    if (!token) break;
  }
  db().tx(() => {
    db().run('INSERT OR REPLACE INTO hosting_versions(version_id, site_id, fetched_at, file_count) VALUES (?, ?, ?, ?)', versionName, site, now(), files.size);
    for (const [p, h] of files) db().run('INSERT OR REPLACE INTO hosting_version_files(version_id, path, hash) VALUES (?, ?, ?)', versionName, p, h);
  });
  return files;
}

export const releaseId = (r: HostingRelease) => r.name.split('/').pop()!;
