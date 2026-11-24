import fs from 'node:fs';
import path from 'node:path';
import { IS_WIN } from '../config.js';
import { isSecretFile } from './secrets.js';

export class PathError extends Error { statusCode = 403; }

const norm = (p: string) => (IS_WIN ? p.toLowerCase() : p);

/** Canonical absolute path (resolves symlinks / junctions when the path exists). */
export function canonical(p: string): string {
  const abs = path.resolve(p);
  try { return fs.realpathSync.native(abs); } catch { return abs; }
}

export function isInside(root: string, target: string): boolean {
  const r = norm(canonical(root)), t = norm(canonical(target));
  if (t === r) return true;
  const rel = path.relative(r, t);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Resolve a user-supplied relative path inside an approved project root.
 * Rejects traversal, absolute paths, symlinks escaping the root and secret files.
 */
export function resolveInside(root: string, rel: string, opts: { allowSecrets?: boolean } = {}): string {
  if (typeof rel !== 'string' || rel.includes('\0')) throw new PathError('Invalid path');
  const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (path.isAbsolute(clean) || /^[a-zA-Z]:/.test(clean)) throw new PathError('Absolute paths are not allowed');
  const target = path.resolve(root, clean);
  if (!isInside(root, target)) throw new PathError('Path is outside the project root');
  if (!opts.allowSecrets && isSecretFile(clean)) throw new PathError('Access to secret files is blocked');
  return target;
}

/** Validate a directory a user wants to register / scan. */
export function validateProjectRoot(p: string): string {
  if (!p || typeof p !== 'string') throw new PathError('Path required');
  const trimmed = p.trim().replace(/^"|"$/g, '');
  if (!path.isAbsolute(trimmed)) throw new PathError('Use an absolute directory path');
  const abs = canonical(trimmed);
  let st: fs.Stats;
  try { st = fs.statSync(abs); } catch { throw new PathError('Directory does not exist: ' + trimmed); }
  if (!st.isDirectory()) throw new PathError('Not a directory: ' + trimmed);
  const parsed = path.parse(abs);
  if (abs === parsed.root) throw new PathError('Refusing to monitor a drive root');
  return abs;
}

export const toPosix = (p: string) => p.split(path.sep).join('/');
