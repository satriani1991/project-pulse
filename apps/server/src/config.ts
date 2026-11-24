import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Walk up from this file to find the monorepo root (contains apps/ and package.json). */
function findRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'apps')) && fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export const ROOT_DIR = process.env.PULSE_ROOT ? path.resolve(process.env.PULSE_ROOT) : findRoot(here);
export const DATA_DIR = process.env.PULSE_DATA ? path.resolve(process.env.PULSE_DATA) : path.join(ROOT_DIR, 'data');
export const DB_PATH = path.join(DATA_DIR, 'project-pulse.db');
export const THUMB_DIR = path.join(DATA_DIR, 'thumbnails');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
export const MANIFEST_DIR = path.join(DATA_DIR, 'manifests');
export const WEB_DIST = path.join(ROOT_DIR, 'apps', 'web', 'dist');
/** Always loopback-only (PRD §21). */
export const HOST = '127.0.0.1';
export const PORT = Number(process.env.PULSE_PORT || 7700);
export const IS_WIN = process.platform === 'win32';
export const DISABLE_JOBS = process.env.PULSE_DISABLE_JOBS === '1';

for (const d of [DATA_DIR, THUMB_DIR, BACKUP_DIR, MANIFEST_DIR]) fs.mkdirSync(d, { recursive: true });
