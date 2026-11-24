import fs from 'node:fs';
import path from 'node:path';
import type { Asset, AssetReport, AssetType } from '@pulse/shared';
import { ASSET_TYPES, IMAGE_EXT } from '@pulse/shared';
import { db, type Row } from '../../database/db.js';
import { extOf } from '../../util.js';
import { getProject, listProjects } from '../projects.js';
import { getSettings } from '../settings.js';
import { assetType, imageSize } from './image-info.js';
import { rowToEvent } from '../analytics/analytics.js';
import { currentWs } from '../../workspace/context.js';

/** Sync the assets table with the file index for one project (dimensions read from headers, only for changed files). */
export function indexAssets(projectId: string) {
  const p = getProject(projectId);
  const files = db().all<Row>(`SELECT path, hash, size, mtime_ms FROM file_index WHERE project_id = ? AND build = 0 AND kind IN ('asset', 'source')`, projectId);
  const existing = new Map(db().all<Row>('SELECT path, hash, width, height FROM assets WHERE project_id = ?', projectId).map((r) => [r.path, r]));
  const seen = new Set<string>();
  db().tx(() => {
    for (const f of files) {
      const ext = extOf(f.path);
      const type = assetType(f.path, ext);
      if (!type) continue;
      seen.add(f.path);
      const old = existing.get(f.path);
      let width = old?.width ?? null, height = old?.height ?? null;
      if ((!old || old.hash !== f.hash) && IMAGE_EXT.includes(ext)) {
        const s = imageSize(path.join(p.rootPath, f.path));
        width = s?.width ?? null; height = s?.height ?? null;
      }
      db().run(`INSERT INTO assets(project_id, path, type, ext, width, height, size, hash, modified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, path) DO UPDATE SET type = excluded.type, ext = excluded.ext, width = excluded.width, height = excluded.height, size = excluded.size, hash = excluded.hash, modified_at = excluded.modified_at`,
        projectId, f.path, type, ext, width, height, f.size, f.hash, new Date(f.mtime_ms).toISOString());
    }
    for (const k of existing.keys()) if (!seen.has(k)) db().run('DELETE FROM assets WHERE project_id = ? AND path = ?', projectId, k);
  });
  reportCache.delete(`${currentWs()}:${projectId}`); reportCache.delete(`${currentWs()}:*`);
}

export function listAssets(projectId: string, type?: string): Asset[] {
  return db().all<Row>(`SELECT * FROM assets WHERE project_id = ?${type ? ' AND type = ?' : ''} ORDER BY path`, projectId, ...(type ? [type] : []))
    .map((r) => ({ path: r.path, type: r.type, ext: r.ext, size: r.size, width: r.width ?? undefined, height: r.height ?? undefined, hash: r.hash ?? undefined, modifiedAt: r.modified_at }));
}

const REF_RE = /["'`(]([^"'`()\s<>{}]+?\.(?:png|jpe?g|gif|webp|avif|svg|bmp|mp3|wav|ogg|m4a|aac|glb|gltf|fbx|obj|mp4|webm|atlas|ttf|otf|woff2?))(?:\?[^"'`)]*)?["'`)]/gi;
const reportCache = new Map<string, { at: number; data: AssetReport }>();

/**
 * Asset analysis for one project or the whole workspace ('*').
 * Broken-reference and unused-asset detection are static heuristics over source text — advisory only,
 * because games often build asset paths dynamically at runtime.
 */
export function assetReport(projectId: string | '*'): AssetReport {
  const cacheKey = `${currentWs()}:${projectId}`;
  const c = reportCache.get(cacheKey);
  if (c && Date.now() - c.at < 60_000) return c.data;
  const projects = projectId === '*' ? listProjects() : [getProject(projectId)];
  const ids = projects.map((p) => p.id);
  const ph = ids.map(() => '?').join(',') || "''";
  const rows = db().all<Row>(`SELECT * FROM assets WHERE project_id IN (${ph})`, ...ids);
  const counts = Object.fromEntries(ASSET_TYPES.map((t) => [t, 0])) as Record<AssetType, number>;
  const sizes = Object.fromEntries(ASSET_TYPES.map((t) => [t, 0])) as Record<AssetType, number>;
  const formats = new Map<string, { count: number; size: number }>();
  for (const r of rows) {
    counts[r.type as AssetType]++; sizes[r.type as AssetType] += r.size;
    const f = formats.get(r.ext) ?? { count: 0, size: 0 }; f.count++; f.size += r.size; formats.set(r.ext, f);
  }
  const media = rows.filter((r) => r.type !== 'script');
  // Duplicates by content hash
  const byHash = new Map<string, Row[]>();
  for (const r of media) if (r.hash && r.size > 0) (byHash.get(r.hash) ?? byHash.set(r.hash, []).get(r.hash)!).push(r);
  const duplicates = [...byHash.entries()].filter(([, v]) => v.length > 1)
    .map(([hash, v]) => ({ hash, size: v[0].size, files: v.map((x) => ({ projectId: x.project_id, path: x.path })) }))
    .sort((a, b) => b.size * b.files.length - a.size * a.files.length).slice(0, 200);
  const largeBytes = getSettings().largeAssetKB * 1024;
  const large = media.filter((r) => r.size >= largeBytes).sort((a, b) => b.size - a.size).slice(0, 200)
    .map((r) => ({ projectId: r.project_id, path: r.path, type: r.type, ext: r.ext, size: r.size, width: r.width ?? undefined, height: r.height ?? undefined, hash: r.hash, modifiedAt: r.modified_at }));

  // Dimension consistency within sprite/animation folders
  const dimensionIssues: AssetReport['dimensionIssues'] = [];
  const byFolder = new Map<string, Row[]>();
  for (const r of media) if (r.width && (r.type === 'animation' || r.type === 'image')) { const k = r.project_id + '|' + path.posix.dirname(r.path); (byFolder.get(k) ?? byFolder.set(k, []).get(k)!).push(r); }
  for (const [k, v] of byFolder) {
    if (v.length < 3) continue;
    const dims = new Map<string, number>();
    for (const r of v) dims.set(`${r.width}×${r.height}`, (dims.get(`${r.width}×${r.height}`) ?? 0) + 1);
    if (dims.size > 1 && dims.size <= Math.max(2, v.length / 2) && /(sprite|anim|frame|sheet|char|enemy|tile|icon)/i.test(k)) {
      const [pid, folder] = k.split('|');
      dimensionIssues.push({ projectId: pid, folder, sizes: [...dims.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} ×${n}`), files: v.length });
    }
  }

  // Broken references & unused assets (static analysis of source text)
  const broken: AssetReport['broken'] = [];
  const unused: AssetReport['unused'] = [];
  for (const p of projects) {
    const all = db().all<{ path: string }>('SELECT path FROM file_index WHERE project_id = ?', p.id).map((r) => r.path);
    const exact = new Set(all);
    const lower = new Map(all.map((x) => [x.toLowerCase(), x]));
    const sources = db().all<{ path: string }>(`SELECT path FROM file_index WHERE project_id = ? AND build = 0 AND kind = 'source' AND size < 1500000 LIMIT 3000`, p.id).map((r) => r.path);
    let corpus = '';
    for (const src of sources) {
      let text: string;
      try { text = fs.readFileSync(path.join(p.rootPath, src), 'utf8'); } catch { continue; }
      corpus += text.toLowerCase() + '\n';
      for (const m of text.matchAll(REF_RE)) {
        const ref = m[1];
        if (/^(https?:|data:|blob:|\/\/)/i.test(ref) || ref.includes('${') || ref.includes('*')) continue;
        const clean = ref.replace(/^\.\//, '');
        const candidates = ref.startsWith('/')
          ? [clean.slice(1), 'public/' + clean.slice(1), (p.deployment?.deployDirectory && p.deployment.deployDirectory !== '.' ? p.deployment.deployDirectory + '/' : '') + clean.slice(1)]
          : [path.posix.normalize(path.posix.join(path.posix.dirname(src), clean)), clean, 'public/' + clean, 'src/' + clean];
        const found = candidates.some((x) => exact.has(x));
        if (found) continue;
        const ci = candidates.map((x) => lower.get(x.toLowerCase())).find(Boolean);
        if (broken.length < 500) broken.push({ projectId: p.id, source: src, reference: ci ? `${ref} (case mismatch with ${ci} — breaks on Firebase Hosting)` : ref });
      }
    }
    if (corpus) {
      for (const r of media.filter((x) => x.project_id === p.id && x.type !== 'font')) {
        const base = path.posix.basename(r.path).toLowerCase();
        const stem = base.replace(/\.[^.]+$/, '');
        if (!corpus.includes(base) && !(stem.length > 3 && corpus.includes(stem)) && unused.length < 1000) unused.push({ projectId: p.id, path: r.path, size: r.size });
      }
    }
  }
  const recent = db().all<Row>(`SELECT e.*, p.name AS project_name FROM file_events e JOIN projects p ON p.id = e.project_id WHERE e.kind = 'asset' AND e.project_id IN (${ph})
    AND COALESCE(e.detail,'') NOT LIKE 'seed:%' ORDER BY e.detected_at DESC LIMIT 100`, ...ids).map(rowToEvent);
  const data: AssetReport = {
    counts, sizes, total: rows.length, totalSize: rows.reduce((a, b) => a + b.size, 0), duplicates, large, broken, unused,
    formats: [...formats.entries()].map(([ext, v]) => ({ ext, ...v })).sort((a, b) => b.size - a.size), dimensionIssues, recent,
  };
  reportCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

export const invalidateAssetReport = (projectId?: string) => { if (projectId) reportCache.delete(`${currentWs()}:${projectId}`); reportCache.delete(`${currentWs()}:*`); };
