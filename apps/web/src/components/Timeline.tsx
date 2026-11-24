import { Link } from 'react-router-dom';
import type { FileEvent } from '@pulse/shared';
import { EventIcon } from './project';
import { Empty } from './ui';
import { bytes, time, timeAgo } from '../lib/format';

interface Group { key: string; first: FileEvent; items: FileEvent[] }

/** Collapse bursts of similar events (same project/type/kind within 10 minutes) into one readable line. */
export function groupEvents(events: FileEvent[]): Group[] {
  const out: Group[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    const groupable = ['created', 'modified', 'deleted', 'renamed'].includes(e.eventType);
    if (last && groupable && last.first.projectId === e.projectId && last.first.eventType === e.eventType && (last.first.kind ?? '') === (e.kind ?? '')
      && Math.abs(Date.parse(last.items[last.items.length - 1].detectedAt) - Date.parse(e.detectedAt)) < 10 * 60_000) last.items.push(e);
    else out.push({ key: `${e.id}`, first: e, items: [e] });
  }
  return out;
}

const VERB: Record<string, string> = { created: 'Added', modified: 'Modified', deleted: 'Deleted', renamed: 'Renamed' };
function describe(g: Group) {
  const e = g.first;
  const n = g.items.length;
  switch (e.eventType) {
    case 'git_commit': return { title: <>Commit: {e.detail?.split(' · ')[0]}</>, sub: `Git · ${e.detail?.split(' · ').slice(1).join(' · ')} · ${e.path}` };
    case 'deployment': return { title: e.detail ?? 'Deployment', sub: 'Firebase Hosting' };
    case 'build_completed': return { title: 'Build completed', sub: `${e.path} · ${e.detail ?? ''}` };
    case 'registered': return { title: 'Project registered', sub: e.detail ?? 'Local workspace' };
    case 'dir_created': return { title: <>Created directory <code>{e.path}</code></>, sub: 'Filesystem' };
    default: {
      const kind = e.kind === 'asset' ? 'asset' : e.kind === 'source' ? 'source' : 'file';
      const size = g.items.reduce((a, b) => a + (b.size ?? 0), 0);
      const title = n === 1 ? <>{VERB[e.eventType]} <code className="text-[13px]">{e.eventType === 'renamed' ? `${e.oldPath} → ${e.path}` : e.path}</code></> : <>{VERB[e.eventType]} {n} {kind} files</>;
      const sub = kind === 'asset' && e.eventType === 'created' && size ? `+${bytes(size)} of assets` : kind === 'source' ? 'Source code update' : kind === 'asset' ? 'Asset update' : e.kind === 'build' ? 'Build output' : 'File change';
      return { title, sub: n > 1 ? `${sub} · ${g.items.slice(0, 3).map((x) => x.path.split('/').pop()).join(', ')}${n > 3 ? '…' : ''}` : sub };
    }
  }
}

export function TimelineList({ events, compact }: { events: FileEvent[]; compact?: boolean }) {
  const groups = groupEvents(events);
  if (!groups.length) return <Empty title="No activity yet">File changes, commits and deployments will appear here as they happen.</Empty>;
  let lastDay = '';
  return (
    <ol className="divide-y divide-border">
      {groups.map((g) => {
        const d = describe(g);
        const day = new Date(g.first.detectedAt).toDateString();
        const header = !compact && day !== lastDay ? (lastDay = day, <li key={'h' + g.key} className="bg-surface-2/50 px-4 py-1.5 text-xs font-semibold text-muted">{new Date(g.first.detectedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</li>) : null;
        return [header, (
          <li key={g.key} className="flex gap-3 px-4 py-2.5 text-sm">
            <EventIcon type={g.first.eventType} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2"><Link to={`/projects/${g.first.projectId}`} className="truncate font-medium hover:text-primary">{g.first.projectName}</Link>
                <span className="shrink-0 text-xs text-muted" title={new Date(g.first.detectedAt).toLocaleString()}>{compact ? timeAgo(g.first.detectedAt) : time(g.first.detectedAt)}</span></div>
              <div className="truncate">{d.title}</div>
              <div className="truncate text-xs text-muted">{d.sub}</div>
            </div>
          </li>
        )];
      })}
    </ol>
  );
}
