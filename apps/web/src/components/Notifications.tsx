import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { BellOff, CheckCheck, X } from 'lucide-react';
import { useNotifications } from '../hooks/queries';
import { setUi, useUi } from '../stores/ui';
import { api } from '../services/api';
import { Button, Empty } from './ui';
import { cx, timeAgo } from '../lib/format';

const TONE: Record<string, string> = { deployment_failed: 'bg-danger', site_down: 'bg-danger', backup_failed: 'bg-danger', deployment_reminder: 'bg-warning', library_updated: 'bg-warning', deployment_completed: 'bg-success', site_up: 'bg-success', backup_completed: 'bg-success' };

export function NotificationsPanel() {
  const open = useUi((s) => s.notifications);
  const { data } = useNotifications();
  const qc = useQueryClient();
  const read = async (id?: number) => { await api.post('/api/notifications/read', id ? { id } : {}); qc.invalidateQueries({ queryKey: ['notifications'] }); };
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40" onClick={() => setUi({ notifications: false })}>
      <aside className="absolute top-0 right-0 flex h-full w-[400px] max-w-full flex-col border-l border-border bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold">Notifications</h2>
          <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => read()}><CheckCheck className="size-4" />Mark all read</Button><Button size="icon" variant="ghost" onClick={() => setUi({ notifications: false })} aria-label="Close"><X className="size-4" /></Button></div>
        </header>
        <ul className="flex-1 overflow-y-auto">
          {!data?.length && <Empty icon={<BellOff className="size-8" />} title="No notifications">Deployment reminders, failed builds, library updates and site outages appear here.</Empty>}
          {data?.map((n) => (
            <li key={n.id} className={cx('flex gap-3 border-b border-border px-4 py-3 text-sm', !n.readAt && 'bg-surface-2')} onMouseEnter={() => !n.readAt && read(n.id)}>
              <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', TONE[n.type] ?? 'bg-primary')} />
              <div className="min-w-0">
                <p>{n.message}</p>
                <p className="mt-0.5 text-xs text-muted">{n.projectId ? <Link className="hover:text-primary" to={`/projects/${n.projectId}`} onClick={() => setUi({ notifications: false })}>{n.projectName}</Link> : 'Workspace'} · {timeAgo(n.createdAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
