import { DEFAULT_SETTINGS, type Settings } from '@pulse/shared';
import { db } from '../database/db.js';
import { currentWs } from '../workspace/context.js';

const cache = new Map<string, Settings>();

export function getSettings(): Settings {
  const hit = cache.get(currentWs());
  if (hit) return hit;
  const rows = db().all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const s: any = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) {
    if (!(r.key in s)) continue;
    try {
      const v = JSON.parse(r.value);
      s[r.key] = typeof s[r.key] === 'object' && !Array.isArray(s[r.key]) ? { ...s[r.key], ...v } : v;
    } catch { /* ignore corrupt values */ }
  }
  cache.set(currentWs(), s as Settings);
  return s as Settings;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const current = getSettings();
  db().tx(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in current) || v === undefined) continue;
      const def = (DEFAULT_SETTINGS as any)[k];
      if (typeof def !== typeof v && !(Array.isArray(def) && Array.isArray(v))) continue;
      db().run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v));
    }
  });
  cache.delete(currentWs());
  return getSettings();
}
