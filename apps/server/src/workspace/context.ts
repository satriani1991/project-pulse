import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DATA_DIR } from '../config.js';

/**
 * Workspaces: fully isolated sets of projects (e.g. "Private" and "Office").
 * Each workspace has its own SQLite database, settings, thumbnails and backups.
 * The active workspace is chosen per request (X-Pulse-Workspace header or ?ws=) — so two browsers
 * (or two tabs) can work in different workspaces at the same time.
 * Background jobs run once per workspace inside runInWorkspace().
 */
export interface Workspace {
  id: string;
  name: string;
  color: string;
  theme: 'dark' | 'light' | 'system';
  createdAt: string;
}

export const DEFAULT_WS = 'default';
const REGISTRY = path.join(DATA_DIR, 'workspaces.json');
const als = new AsyncLocalStorage<{ ws: string }>();

let registry: Workspace[] | undefined;
function load(): Workspace[] {
  if (registry) return registry;
  try { registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) as Workspace[]; } catch { registry = []; }
  if (!registry.some((w) => w.id === DEFAULT_WS)) {
    registry.unshift({ id: DEFAULT_WS, name: 'Private', color: '#3fb950', theme: 'dark', createdAt: new Date().toISOString() });
    save();
  }
  return registry;
}
function save() {
  fs.writeFileSync(REGISTRY + '.tmp', JSON.stringify(registry, null, 2));
  fs.renameSync(REGISTRY + '.tmp', REGISTRY);
}

export const listWorkspaces = (): Workspace[] => [...load()];
export const getWorkspace = (id: string) => load().find((w) => w.id === id);
export const workspaceExists = (id: string) => load().some((w) => w.id === id);

export function currentWs(): string { return als.getStore()?.ws ?? DEFAULT_WS; }
export function runInWorkspace<T>(ws: string, fn: () => T): T { return als.run({ ws }, fn); }
/** Used by the HTTP layer: continue the request inside the workspace context. */
export function enterWorkspace(ws: string, next: () => void) { als.run({ ws }, next); }

/** Data directory of a workspace. The default workspace keeps the original data/ layout (backward compatible). */
export function wsDataDir(ws = currentWs()): string {
  const dir = ws === DEFAULT_WS ? DATA_DIR : path.join(DATA_DIR, 'workspaces', ws);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
export function wsSubdir(name: 'thumbnails' | 'backups' | 'manifests', ws = currentWs()) {
  const d = path.join(wsDataDir(ws), name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

const COLORS = ['#58a6ff', '#d29922', '#a371f7', '#db61a2', '#3fb9a8', '#f0883e'];
export function createWorkspace(input: { name: string; color?: string; theme?: Workspace['theme'] }): Workspace {
  const list = load();
  const name = input.name.trim().slice(0, 60);
  if (!name) throw Object.assign(new Error('Workspace name required'), { statusCode: 400 });
  if (list.some((w) => w.name.toLowerCase() === name.toLowerCase())) throw Object.assign(new Error('A workspace with this name already exists'), { statusCode: 409 });
  let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'ws';
  if (id === DEFAULT_WS || list.some((w) => w.id === id)) id = `${id}-${crypto.randomBytes(2).toString('hex')}`;
  const ws: Workspace = { id, name, color: validColor(input.color) ?? COLORS[list.length % COLORS.length], theme: input.theme ?? 'dark', createdAt: new Date().toISOString() };
  list.push(ws); save();
  wsDataDir(id);
  return ws;
}

export function updateWorkspace(id: string, patch: Partial<Pick<Workspace, 'name' | 'color' | 'theme'>>): Workspace {
  const ws = load().find((w) => w.id === id);
  if (!ws) throw Object.assign(new Error('Workspace not found'), { statusCode: 404 });
  if (patch.name !== undefined) {
    const n = patch.name.trim().slice(0, 60);
    if (!n) throw Object.assign(new Error('Workspace name required'), { statusCode: 400 });
    if (load().some((w) => w.id !== id && w.name.toLowerCase() === n.toLowerCase())) throw Object.assign(new Error('A workspace with this name already exists'), { statusCode: 409 });
    ws.name = n;
  }
  if (patch.color !== undefined) ws.color = validColor(patch.color) ?? ws.color;
  if (patch.theme !== undefined && ['dark', 'light', 'system'].includes(patch.theme)) ws.theme = patch.theme;
  save();
  return ws;
}

/** Removes the workspace from the registry. Its dashboard data folder is kept unless purge=true. Project folders are never touched. */
export function removeWorkspace(id: string): { dataDir: string } {
  if (id === DEFAULT_WS) throw Object.assign(new Error('The default workspace cannot be deleted'), { statusCode: 400 });
  const list = load();
  const i = list.findIndex((w) => w.id === id);
  if (i < 0) throw Object.assign(new Error('Workspace not found'), { statusCode: 404 });
  list.splice(i, 1); save();
  return { dataDir: path.join(DATA_DIR, 'workspaces', id) };
}

function validColor(c?: string) { return c && /^#[0-9a-f]{6}$/i.test(c) ? c : undefined; }
