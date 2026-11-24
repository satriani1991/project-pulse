import fs from 'node:fs';
import path from 'node:path';
import type { PortfolioEntry } from '@pulse/shared';
import { db } from '../../database/db.js';
import { listProjects } from '../projects.js';
import { getSettings } from '../settings.js';
import { audit } from '../../security/audit.js';

/** Build the public games catalog (games.json) — PROJECT PULSE as source of truth for the portfolio. */
export function portfolio(category = 'game'): PortfolioEntry[] {
  return listProjects().filter((p) => (category === 'all' || p.category === category) && p.lifecycle !== 'archived' && p.lifecycle !== 'concept').map((p) => {
    const firstRelease = db().get<{ t: string }>(`SELECT MIN(deployed_at) AS t FROM deployments WHERE project_id = ? AND affects_project = 1 AND status = 'success'`, p.id)?.t;
    const remote = p.deployment?.remotePath && p.deployment.remotePath !== '/' ? p.deployment.remotePath : undefined;
    const thumb = p.thumbnailPath && !p.thumbnailPath.startsWith('data:') ? (remote ? remote + p.thumbnailPath.replace(/^(public|dist)\//, '') : p.thumbnailPath) : undefined;
    return {
      id: p.id, title: p.name, category: p.category === 'game' ? (p.tags[0] ?? 'Game') : p.category, genre: p.genre, description: p.description || undefined, version: p.version,
      thumbnail: thumb, url: remote ? `${remote}index.html` : p.deployment?.publicUrl || undefined, status: p.lifecycle, releaseDate: firstRelease?.slice(0, 10), technologies: p.technologies,
    };
  });
}

export function writePortfolio(): { path: string; count: number } {
  const target = getSettings().portfolioExportPath;
  if (!target || !path.isAbsolute(target) || !target.toLowerCase().endsWith('.json')) throw new Error('Set an absolute portfolio export path ending in .json in Settings');
  const data = portfolio();
  fs.writeFileSync(target, JSON.stringify(data, null, 2));
  audit('portfolio.export', null, target);
  return { path: target, count: data.length };
}
