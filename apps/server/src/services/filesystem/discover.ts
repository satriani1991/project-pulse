import fs from 'node:fs';
import path from 'node:path';
import type { Category, DiscoveredProject, ProjectCommands } from '@pulse/shared';
import { DEFAULT_EXCLUDES, PROJECT_MARKERS } from '@pulse/shared';
import { db } from '../../database/db.js';
import { canonical, isInside, toPosix, validateProjectRoot } from '../../security/paths.js';
import { compileIgnore } from '../../security/ignore.js';

const readJson = (f: string): any => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return undefined; } };
const readText = (f: string, max = 200_000) => { try { const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(max); const n = fs.readSync(fd, b, 0, max, 0); fs.closeSync(fd); return b.toString('utf8', 0, n); } catch { return ''; } };

const TECH_DEPS: Record<string, string> = {
  react: 'React', vue: 'Vue', svelte: 'Svelte', phaser: 'Phaser', 'pixi.js': 'PixiJS', three: 'Three.js', babylonjs: 'Babylon.js', '@babylonjs/core': 'Babylon.js',
  kaboom: 'Kaboom', typescript: 'TypeScript', vite: 'Vite', webpack: 'Webpack', firebase: 'Firebase', electron: 'Electron', tailwindcss: 'Tailwind',
  next: 'Next.js', express: 'Express', fastify: 'Fastify', 'matter-js': 'Matter.js', 'planck-js': 'Planck', howler: 'Howler', 'cannon-es': 'Cannon',
};
const GAME_DEPS = ['phaser', 'pixi.js', 'three', 'babylonjs', '@babylonjs/core', 'kaboom', 'matter-js', 'howler', 'cannon-es', 'excalibur', 'melonjs'];

/** Inspect one directory and infer project metadata. Returns undefined when no marker is present. */
export function inspectDirectory(dir: string): Omit<DiscoveredProject, 'alreadyRegistered' | 'nested'> | undefined {
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return undefined; }
  const lower = new Set(names.map((n) => n.toLowerCase()));
  const markers = PROJECT_MARKERS.filter((m) => lower.has(m.toLowerCase()));
  if (!markers.length) return undefined;

  const pkg = readJson(path.join(dir, 'package.json'));
  const pulse = readJson(path.join(dir, 'pulse.json')) ?? readJson(path.join(dir, '.pulse.json'));
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const html = lower.has('index.html') ? readText(path.join(dir, 'index.html'), 100_000) : '';
  const techs = new Set<string>();
  for (const [d, t] of Object.entries(TECH_DEPS)) if (deps[d]) techs.add(t);
  if (/<canvas/i.test(html) || /getContext\(['"]2d/.test(html)) techs.add('HTML5 Canvas');
  if (lower.has('tsconfig.json')) techs.add('TypeScript');
  if (lower.has('go.mod')) techs.add('Go');
  if (lower.has('firebase.json')) techs.add('Firebase');
  if (pkg || html || names.some((n) => /\.(m?js)$/i.test(n))) techs.add('JavaScript');
  if (lower.has('vite.config.js') || lower.has('vite.config.ts')) techs.add('Vite');

  // Category
  let category: Category = 'application';
  const parentName = path.basename(path.dirname(dir)).toLowerCase();
  const nameLower = path.basename(dir).toLowerCase();
  const isGame = Object.keys(deps).some((d) => GAME_DEPS.includes(d)) || /<canvas/i.test(html) || /game/.test(nameLower) || /\bgame\b/i.test(pkg?.keywords?.join(' ') ?? '');
  const isLibrary = /^(libraries|libs?|packages|engines?)$/.test(parentName) || (!!pkg && (pkg.main || pkg.exports || pkg.module) && !html && !pkg.private) || /(engine|library|lib|manager|utils?)$/.test(nameLower);
  if (isLibrary && !/<canvas/i.test(html)) category = 'library';
  else if (isGame) category = 'game';
  else if (lower.has('go.mod') || pkg?.bin) category = 'tool';
  else if (html && !pkg) category = 'website';
  if (pulse?.category) category = pulse.category;

  // Firebase
  let deployment: DiscoveredProject['deployment'];
  const fb = findFirebaseConfig(dir);
  if (fb) deployment = fb;

  // Commands
  const commands: ProjectCommands = {};
  const scripts = pkg?.scripts ?? {};
  if (scripts.dev) commands.dev = 'npm run dev'; else if (scripts.start) commands.dev = 'npm start'; else if (html) commands.dev = '@static';
  if (scripts.build) commands.build = 'npm run build';
  if (scripts.deploy) commands.deploy = 'npm run deploy';
  else if (fb?.hostingSiteId && fb.configRoot === toPosix(dir)) commands.deploy = fb.target ? `firebase deploy --only hosting:${fb.target}` : 'firebase deploy --only hosting';
  if (scripts.test) commands.test = 'npm test';
  if (pulse?.commands) Object.assign(commands, pulse.commands);

  // Description
  let description = pkg?.description ?? pulse?.description ?? '';
  if (!description && lower.has('readme.md')) {
    const md = readText(path.join(dir, names.find((n) => n.toLowerCase() === 'readme.md')!), 20_000);
    description = md.split(/\r?\n\r?\n/).map((s) => s.trim()).find((s) => s && !s.startsWith('#') && !s.startsWith('!') && !s.startsWith('[')) ?? '';
    description = description.slice(0, 300);
  }
  let name = pulse?.name ?? (pkg?.displayName || '');
  if (!name) {
    const title = /<title>([^<]{2,80})<\/title>/i.exec(html)?.[1]?.trim();
    name = title && !/^(document|index|vite app)$/i.test(title) ? title : path.basename(dir);
  }
  return {
    rootPath: dir, name, category, technologies: [...techs], markers, deployment, commands, description,
    version: pkg?.version ?? pulse?.version, thumbnailPath: findThumbnail(dir),
  };
}

const THUMB_NAMES = /^(thumbnail|thumb|cover|screenshot|preview|banner|og-image|og|splash|title|key-?art|icon|logo)(@\dx)?\.(png|jpe?g|webp|gif|svg)$/i;
export function findThumbnail(dir: string): string | undefined {
  for (const sub of ['', 'assets', 'images', 'img', 'public', 'media', 'assets/images', 'assets/img', 'docs', 'screenshots']) {
    let names: string[] = [];
    try { names = fs.readdirSync(path.join(dir, sub)); } catch { continue; }
    const hits = names.filter((n) => THUMB_NAMES.test(n)).sort((a, b) => rank(a) - rank(b));
    if (hits.length) return toPosix(path.join(sub, hits[0]));
  }
  return undefined;
}
const rank = (n: string) => { const i = ['thumbnail', 'thumb', 'cover', 'screenshot', 'preview', 'banner', 'og', 'splash', 'title', 'key', 'icon', 'logo'].findIndex((k) => n.toLowerCase().startsWith(k)); return i < 0 ? 99 : i; };

/**
 * Find firebase.json in this directory or an ancestor whose hosting "public" directory contains this project
 * (shared hosting site layout, e.g. ps-action/public/games/tka). Computes remotePath accordingly.
 */
export function findFirebaseConfig(dir: string): (NonNullable<DiscoveredProject['deployment']> & { configRoot: string; target?: string }) | undefined {
  let cur = dir;
  for (let i = 0; i < 5; i++) {
    const fj = readJson(path.join(cur, 'firebase.json'));
    if (fj?.hosting) {
      const rc = readJson(path.join(cur, '.firebaserc'));
      const projectId: string = rc?.projects?.default ?? Object.values(rc?.projects ?? {})[0] ?? '';
      const hostings: any[] = Array.isArray(fj.hosting) ? fj.hosting : [fj.hosting];
      for (const h of hostings) {
        const pub = path.resolve(cur, h.public ?? 'public');
        const inside = cur === dir ? true : isInside(pub, dir);
        if (!inside) continue;
        let site: string = h.site ?? '';
        if (!site && h.target) site = rc?.targets?.[projectId]?.hosting?.[h.target]?.[0] ?? '';
        if (!site) site = projectId;
        const deployDirectory = cur === dir ? toPosix(path.relative(dir, pub)) || '.' : '.';
        const remotePath = cur === dir ? '/' : '/' + toPosix(path.relative(pub, dir)) + '/';
        return {
          provider: 'firebase', firebaseProjectId: projectId, hostingSiteId: site, remotePath, deployDirectory,
          publicUrl: site ? `https://${site}.web.app${remotePath}` : '', configRoot: toPosix(cur), target: h.target,
        };
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return undefined;
}

/** Scan a parent directory for candidate projects (nested projects are reported separately). */
export function discover(rootPath: string, maxDepth = 2): DiscoveredProject[] {
  const root = validateProjectRoot(rootPath);
  const ignore = compileIgnore(DEFAULT_EXCLUDES);
  const registered = db().all<{ root_path: string }>('SELECT root_path FROM projects').map((r) => norm(canonical(r.root_path)));
  const out: DiscoveredProject[] = [];
  const visit = (dir: string, depth: number, insideProject: boolean) => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink() || e.name.startsWith('.') || ignore.dir(e.name, e.name)) continue;
      if (/^(public|src|assets|images|img|audio|sounds|css|js|lib|vendor|docs|test|tests|scripts|dist|build|out)$/i.test(e.name) && insideProject) continue;
      const full = path.join(dir, e.name);
      const info = inspectDirectory(full);
      if (info) out.push({ ...info, alreadyRegistered: registered.includes(norm(canonical(full))), nested: insideProject });
      visit(full, depth + 1, insideProject || !!info);
    }
  };
  visit(root, 1, false);
  return out;
}
const norm = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s);
