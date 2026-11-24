import crypto from 'node:crypto';
import fs from 'node:fs';
import { currentWs } from './workspace/context.js';

/** Local calendar date (YYYY-MM-DD) in the server's time zone. */
export function localDate(d: Date | string | number = new Date()): string {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
/** ISO timestamp for local midnight N days ago. */
export function daysAgoIso(n: number): string {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d.toISOString();
}
export const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');

export function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}
export function slugify(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'project';
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run async jobs with bounded concurrency. */
export async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

export function extOf(p: string) { const m = /\.([^./\\]+)$/.exec(p); return m ? m[1].toLowerCase() : ''; }

/** Serialise async work per key (e.g. one scan per project at a time). */
export class KeyedMutex {
  private chains = new Map<string, Promise<unknown>>();
  run<T>(rawKey: string, fn: () => Promise<T>): Promise<T> {
    const key = `${currentWs()}:${rawKey}`;
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.chains.set(key, next);
    next.finally(() => { if (this.chains.get(key) === next) this.chains.delete(key); }).catch(() => undefined);
    return next;
  }
}
