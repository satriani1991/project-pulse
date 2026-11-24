export function timeAgo(iso?: string | null): string {
  if (!iso) return 'Never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 0) return 'just now';
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) { const h = Math.round(s / 3600); return `${h} hour${h > 1 ? 's' : ''} ago`; }
  const d = Math.round(s / 86400);
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d} days ago`;
  if (d < 365) { const m = Math.round(d / 30); return `${m} month${m > 1 ? 's' : ''} ago`; }
  const y = Math.round(d / 365); return `${y} year${y > 1 ? 's' : ''} ago`;
}
export function bytes(n?: number | null): string {
  if (n === undefined || n === null) return '—';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB']; let i = -1; let v = n;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${u[i]}`;
}
export const dateTime = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');
export const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '');
export function minutes(m: number) { if (m < 60) return `${m} min`; const h = Math.floor(m / 60); return `${h}h ${m % 60 ? `${m % 60}m` : ''}`.trim(); }
export const num = (n: number) => n.toLocaleString();
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export const CATEGORY_LABEL: Record<string, string> = { game: 'Game', library: 'Library', application: 'Application', website: 'Website', tool: 'Tool' };
export const CATEGORY_SERIES: Record<string, string> = { game: 'var(--series-1)', library: 'var(--series-2)', application: 'var(--series-3)', website: 'var(--series-4)', tool: 'var(--series-5)' };
