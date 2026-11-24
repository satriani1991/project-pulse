import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { DayDetail } from '@pulse/shared';
import { api, qs } from '../services/api';
import { Loading } from './ui';
import { minutes, time } from '../lib/format';

/** Clicking a heatmap date: projects worked on, files, commits, deployments, sessions and asset changes. */
export function DayPanel({ date, projectId }: { date: string; projectId?: string }) {
  const { data } = useQuery({ queryKey: ['day', date, projectId], queryFn: () => api.get<DayDetail>('/api/analytics/day' + qs({ date, projectId })) });
  if (!data) return <Loading />;
  const label = new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <div>
        <div className="text-xs text-muted">Selected date</div>
        <div className="font-semibold">{label}</div>
        <div className="mt-3 text-xs text-muted">File changes</div><div className="text-3xl font-semibold tabular-nums">{data.totalChanges}</div>
        <div className="mt-2 text-xs text-muted">Estimated development time</div><div className="font-medium">{minutes(data.estimatedMinutes)}</div>
        <div className="mt-2 text-xs text-muted">Commits · Deployments</div><div className="font-medium">{data.commits.length} · {data.deployments.length}</div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="mb-1 text-xs font-semibold text-muted">Projects</h4>
          {!data.projects.length && <p className="text-sm text-muted">No recorded activity.</p>}
          <ul className="space-y-1 text-sm">{data.projects.map((p) => (
            <li key={p.projectId} className="flex justify-between gap-2"><Link to={`/projects/${p.projectId}`} className="truncate hover:text-primary">{p.name}</Link>
              <span className="shrink-0 text-xs text-muted">{p.changes} files · {p.assets} assets · {p.commits} commits · {p.sessions} sess · {minutes(p.minutes)}</span></li>))}</ul>
          {data.deployments.length > 0 && <><h4 className="mt-3 mb-1 text-xs font-semibold text-muted">Deployments</h4>
            <ul className="text-sm">{data.deployments.map((d) => <li key={d.id}>{time(d.deployedAt)} · {d.source} · {d.status}</li>)}</ul></>}
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold text-muted">Changed files & commits</h4>
          <ul className="mono max-h-48 space-y-0.5 overflow-y-auto text-xs">
            {data.commits.map((c) => <li key={c.id} className="truncate text-warning">⎇ {c.detail}</li>)}
            {data.files.slice(0, 200).map((f) => <li key={f.id} className="truncate"><span className="text-muted">{time(f.detectedAt)} {f.eventType.slice(0, 3)}</span> {f.projectName}/{f.path}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
