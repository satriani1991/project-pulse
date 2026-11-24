import type { Notification } from '@pulse/shared';
import { db, now, type Row } from '../../database/db.js';
import { broadcast } from '../../websocket/hub.js';

/** Create a notification. A dedupeKey prevents the same reminder from being raised repeatedly. */
export function notify(projectId: string | null, type: string, message: string, dedupeKey?: string) {
  const r = db().run('INSERT OR IGNORE INTO notifications(project_id, type, message, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?)', projectId, type, message, dedupeKey ?? null, now());
  if (r.changes) broadcast('notification.created', projectId ?? undefined, { id: Number(r.lastInsertRowid), type, message });
}

export function listNotifications(limit = 100): Notification[] {
  return db().all<Row>('SELECT n.*, p.name AS project_name FROM notifications n LEFT JOIN projects p ON p.id = n.project_id ORDER BY n.id DESC LIMIT ?', limit).map((r) => ({
    id: r.id, projectId: r.project_id ?? undefined, projectName: r.project_name ?? undefined, type: r.type, message: r.message, createdAt: r.created_at, readAt: r.read_at ?? undefined,
  }));
}
export function markRead(id?: number) {
  if (id) db().run('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL', now(), id);
  else db().run('UPDATE notifications SET read_at = ? WHERE read_at IS NULL', now());
}
export const unreadCount = () => db().get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL')!.n;
