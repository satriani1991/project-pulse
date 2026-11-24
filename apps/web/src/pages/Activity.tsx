import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FileEvent } from '@pulse/shared';
import { DEPLOYMENT_STATUSES, DEPLOYMENT_STATUS_LABELS } from '@pulse/shared';
import { useProjects } from '../hooks/queries';
import { api, qs } from '../services/api';
import { subscribe } from '../services/socket';
import { Button, Card, Input, Loading, Select, Toggle } from '../components/ui';
import { TimelineList } from '../components/Timeline';
import { CATEGORY_LABEL } from '../lib/format';

const TYPES = [['', 'All events'], ['created,modified,deleted,renamed', 'File changes'], ['git_commit', 'Git commits'], ['deployment', 'Deployments'], ['build_completed', 'Builds'], ['registered', 'Registrations'], ['dir_created', 'Directories']];

export function ActivityPage() {
  const [sp, setSp] = useSearchParams();
  const { data: projects } = useProjects();
  const f = Object.fromEntries(sp.entries()) as Record<string, string>;
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const [events, setEvents] = useState<FileEvent[] | null>(null);
  const [more, setMore] = useState(true);
  const [tick, setTick] = useState(0);
  const query = { projectId: f.projectId, category: f.category, types: f.types, from: f.from, to: f.to, git: f.git, deploymentStatus: f.status, q: f.q, seeded: f.seeded };
  const key = JSON.stringify(query);
  useEffect(() => {
    let alive = true;
    api.get<FileEvent[]>('/api/activity' + qs({ ...query, limit: 200 })).then((r) => { if (alive) { setEvents(r); setMore(r.length === 200); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  useEffect(() => subscribe((m) => { if (m.type.startsWith('file.') || m.type.startsWith('deployment.') || m.type === 'git.updated') setTick((t) => t + 1); }), []);
  const loadMore = async () => {
    if (!events?.length) return;
    const r = await api.get<FileEvent[]>('/api/activity' + qs({ ...query, limit: 200, before: events[events.length - 1].id }));
    setEvents([...events, ...r]); setMore(r.length === 200);
  };
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Activity timeline</h1>
      <Card>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <Select value={f.projectId ?? ''} onChange={(e) => set('projectId', e.target.value)} aria-label="Project"><option value="">All projects</option>{projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Select value={f.category ?? ''} onChange={(e) => set('category', e.target.value)} aria-label="Category"><option value="">All categories</option>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Select value={f.types ?? ''} onChange={(e) => set('types', e.target.value)} aria-label="Event type">{TYPES.map(([v, l]) => <option key={l} value={v}>{l}</option>)}</Select>
          <Select value={f.status ?? ''} onChange={(e) => set('status', e.target.value)} aria-label="Deployment status"><option value="">Any deployment status</option>{DEPLOYMENT_STATUSES.map((s) => <option key={s} value={s}>{DEPLOYMENT_STATUS_LABELS[s]}</option>)}</Select>
          <label className="flex items-center gap-1 text-xs text-muted">From <Input type="date" value={f.from ?? ''} onChange={(e) => set('from', e.target.value)} className="w-36" /></label>
          <label className="flex items-center gap-1 text-xs text-muted">To <Input type="date" value={f.to ?? ''} onChange={(e) => set('to', e.target.value)} className="w-36" /></label>
          <Input value={f.q ?? ''} onChange={(e) => set('q', e.target.value)} placeholder="Path or message contains…" className="w-52" />
          <Toggle checked={f.git === '1'} onChange={(v) => set('git', v ? '1' : '')} label="Git only" />
          <Toggle checked={f.seeded === '1'} onChange={(v) => set('seeded', v ? '1' : '')} label="Include imported history" />
          {sp.size > 0 && <Button variant="ghost" size="sm" onClick={() => setSp({})}>Clear</Button>}
        </div>
      </Card>
      <Card>
        {events ? <TimelineList events={events} /> : <Loading />}
        {more && events && events.length > 0 && <div className="border-t border-border p-3 text-center"><Button onClick={loadMore}>Load older events</Button></div>}
      </Card>
    </div>
  );
}
