import fs from 'node:fs';
import path from 'node:path';
import type { DependencyEdge, Project } from '@pulse/shared';
import { db, type Row } from '../../database/db.js';
import { isInside } from '../../security/paths.js';
import { getProject, listProjects } from '../projects.js';
import { notify } from '../notifications/notifications.js';
import { localDate } from '../../util.js';

const readJson = (f: string): any => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return undefined; } };
const IMPORT_RE = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\s*\(\s*|<script[^>]+src\s*=\s*|@import\s+(?:url\()?)["']([^"']+)["']/g;

/**
 * Rebuild automatically discovered dependency edges:
 *  - package: package.json dependency names that match another registered project's package name
 *  - workspace: file:/link: specifiers resolving into another project
 *  - import: relative imports / <script src> that resolve into another project's directory
 *  - copy: library source files copied byte-for-byte into another project (hash comparison)
 * Manual edges are preserved.
 */
export function discoverDependencies() {
  const projects = listProjects();
  const pkgName = new Map<string, Project>();
  for (const p of projects) { const n = readJson(path.join(p.rootPath, 'package.json'))?.name; if (n) pkgName.set(n, p); }
  const owner = (abs: string) => projects.filter((p) => isInside(p.rootPath, abs)).sort((a, b) => b.rootPath.length - a.rootPath.length)[0];
  const edges: DependencyEdge[] = [];
  for (const p of projects) {
    const pkg = readJson(path.join(p.rootPath, 'package.json'));
    const deps: Record<string, string> = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}), ...(pkg?.peerDependencies ?? {}) };
    for (const [name, spec] of Object.entries(deps)) {
      const m = /^(file|link|portal):(.+)$/.exec(spec);
      if (m) { const t = owner(path.resolve(p.rootPath, m[2])); if (t && t.id !== p.id) edges.push({ projectId: p.id, dependencyId: t.id, version: spec, source: 'workspace' }); continue; }
      const t = pkgName.get(name);
      if (t && t.id !== p.id) edges.push({ projectId: p.id, dependencyId: t.id, version: spec, source: 'package', detail: name });
    }
    // relative imports leaving the project
    const sources = db().all<{ path: string }>(`SELECT path FROM file_index WHERE project_id = ? AND build = 0 AND kind = 'source' AND size < 800000 LIMIT 2000`, p.id);
    const seen = new Set<string>();
    for (const s of sources) {
      let text: string;
      try { text = fs.readFileSync(path.join(p.rootPath, s.path), 'utf8'); } catch { continue; }
      for (const m of text.matchAll(IMPORT_RE)) {
        const spec = m[1];
        if (!spec.startsWith('..')) continue;
        const abs = path.resolve(p.rootPath, path.dirname(s.path), spec);
        if (isInside(p.rootPath, abs)) continue;
        const t = owner(abs);
        if (t && t.id !== p.id && !seen.has(t.id)) { seen.add(t.id); edges.push({ projectId: p.id, dependencyId: t.id, source: 'import', detail: `${s.path} → ${spec}` }); }
      }
    }
  }
  // copied library files
  for (const lib of projects.filter((p) => p.category === 'library')) {
    const rows = db().all<Row>(`SELECT b.project_id AS pid, COUNT(*) AS n, SUM(a.size) AS bytes FROM file_index a JOIN file_index b ON a.hash = b.hash AND b.project_id != a.project_id
      WHERE a.project_id = ? AND a.kind = 'source' AND a.build = 0 AND a.size > 512 AND b.build = 0 GROUP BY b.project_id`, lib.id);
    for (const r of rows) if (r.n >= 2 || r.bytes > 4096) edges.push({ projectId: r.pid, dependencyId: lib.id, source: 'copy', detail: `${r.n} identical file(s) copied from ${lib.name}` });
  }
  db().tx(() => {
    db().run(`DELETE FROM dependencies WHERE source != 'manual'`);
    for (const e of edges) db().run('INSERT OR IGNORE INTO dependencies(project_id, dependency_id, version, source, detail) VALUES (?, ?, ?, ?, ?)', e.projectId, e.dependencyId, e.version ?? null, e.source, e.detail ?? null);
  });
}

export function listDependencies(projectId?: string): DependencyEdge[] {
  return db().all<Row>(`SELECT * FROM dependencies${projectId ? ' WHERE project_id = ? OR dependency_id = ?' : ''} ORDER BY project_id`, ...(projectId ? [projectId, projectId] : []))
    .map((r) => ({ id: r.id, projectId: r.project_id, dependencyId: r.dependency_id, version: r.version ?? undefined, source: r.source, detail: r.detail ?? undefined }));
}

export function addManualDependency(projectId: string, dependencyId: string, version?: string, detail?: string) {
  getProject(projectId); getProject(dependencyId);
  if (projectId === dependencyId) throw new Error('A project cannot depend on itself');
  db().run(`INSERT OR REPLACE INTO dependencies(project_id, dependency_id, version, source, detail) VALUES (?, ?, ?, 'manual', ?)`, projectId, dependencyId, version ?? null, detail ?? null);
}
export function removeDependency(id: number) { db().run(`DELETE FROM dependencies WHERE id = ?`, id); }

/** All projects that (transitively) depend on the given project. */
export function dependents(projectId: string): string[] {
  const out = new Set<string>();
  const queue = [projectId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const r of db().all<{ project_id: string }>('SELECT DISTINCT project_id FROM dependencies WHERE dependency_id = ?', cur)) {
      if (!out.has(r.project_id) && r.project_id !== projectId) { out.add(r.project_id); queue.push(r.project_id); }
    }
  }
  return [...out];
}

/** When a shared library changes, raise one notification per day listing affected projects. */
export function notifyLibraryChange(projectId: string) {
  const deps = dependents(projectId);
  if (!deps.length) return;
  const p = getProject(projectId);
  const names = deps.map((d) => { try { return getProject(d).name; } catch { return d; } });
  notify(projectId, 'library_updated', `${p.name} changed — rebuild, test and redeploy ${deps.length} dependent project(s): ${names.join(', ')}`, `lib:${projectId}:${localDate()}`);
}
