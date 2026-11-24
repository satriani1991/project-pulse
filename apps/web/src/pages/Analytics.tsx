import { useState } from 'react';
import { Link } from 'react-router-dom';
import { intensityLabel } from '@pulse/shared';
import { useFrequency, useHeatmap, useIntensity, useMonthly, useOverview, useProjects } from '../hooks/queries';
import { FrequencyChart, Heatmap, MonthlyChart } from '../charts';
import { Card, Loading, Select, Stat } from '../components/ui';
import { DayPanel } from '../components/DayPanel';
import { CATEGORY_LABEL, cx, minutes, num } from '../lib/format';

export function AnalyticsPage() {
  const [filter, setFilter] = useState<{ projectId?: string; category?: string }>({});
  const [windowDays, setWindow] = useState(30);
  const [day, setDay] = useState<string>();
  const { data: projects } = useProjects();
  const { data: heat } = useHeatmap(filter);
  const { data: monthly } = useMonthly();
  const { data: intensity } = useIntensity(windowDays);
  const { data: freq } = useFrequency(12);
  const { data: ov } = useOverview();
  const mins12 = (monthly ?? []).reduce((a, m) => a + Number(m.minutes), 0);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-semibold">Developer analytics</h1>
        <Select value={filter.projectId ?? ''} onChange={(e) => setFilter({ ...filter, projectId: e.target.value || undefined })} aria-label="Project"><option value="">All projects</option>{projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Select value={filter.category ?? ''} onChange={(e) => setFilter({ ...filter, category: e.target.value || undefined })} aria-label="Category"><option value="">All categories</option>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Changes (52 weeks)" value={heat ? num(heat.total) : '—'} hint="Unique meaningful file changes per day, summed" />
        <Stat label="Changes (30 days)" value={ov ? num(ov.changes30d) : '—'} />
        <Stat label="Estimated dev time (7 days)" value={ov ? minutes(ov.estimatedMinutes7d) : '—'} hint="Estimated from file activity" />
        <Stat label="Estimated dev time (12 months)" value={minutes(mins12)} hint="Estimated — excludes thinking, testing & design time" />
      </div>
      <Card title="Contribution activity" subtitle={`${filter.projectId ? projects?.find((p) => p.id === filter.projectId)?.name : filter.category ? CATEGORY_LABEL[filter.category] + 's' : 'All projects'} · meaningful file changes in the last 52 weeks — select a day to inspect it`}>
        <div className="p-4">{heat ? <Heatmap days={heat.days} selected={day} onSelect={(d) => setDay(d === day ? undefined : d)} /> : <Loading />}
          {day && <div className="mt-4 border-t border-border pt-4"><DayPanel date={day} projectId={filter.projectId} /></div>}</div>
      </Card>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Monthly development activity" subtitle="Meaningful file changes by project category"><div className="p-4">{monthly ? <MonthlyChart data={monthly} /> : <Loading />}</div></Card>
        <Card title="Local update sessions vs deployments" subtitle="Weekly, last 12 weeks"><div className="p-4">{freq ? <FrequencyChart data={freq} /> : <Loading />}</div></Card>
      </div>
      <Card title="Project development intensity" subtitle="Weighted score: changes 30% · active days 25% · sessions 20% · commits 15% · assets 10% (configurable). Non-Git projects are not penalised."
        actions={<Select value={windowDays} onChange={(e) => setWindow(Number(e.target.value))} aria-label="Window">{[7, 30, 90, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}</Select>}>
        {!intensity ? <Loading /> : (
          <ul className="divide-y divide-border">{intensity.map((i) => (
            <li key={i.projectId} className="grid grid-cols-[minmax(140px,220px)_1fr_auto] items-center gap-4 px-4 py-2.5 text-sm">
              <Link to={`/projects/${i.projectId}`} className="truncate font-medium hover:text-primary">{i.name}</Link>
              <div className="group relative">
                <div className="h-2.5 overflow-hidden rounded-full bg-surface-2"><div className={cx('h-full rounded-full', i.score >= 60 ? 'bg-success' : i.score >= 20 ? 'bg-success/60' : 'bg-muted/50')} style={{ width: `${Math.max(i.score, 1)}%` }} /></div>
                <div className="mt-1 text-xs text-muted">{i.raw.changes} files · {i.raw.activeDays} active days · {i.raw.sessions} sessions · {i.components.commits === null ? 'no Git' : `${i.raw.commits} commits`} · {i.raw.assets} assets</div>
              </div>
              <div className="w-32 text-right"><b className="tabular-nums">{i.score}</b><span className="text-muted">/100</span><div className="text-xs text-muted">{intensityLabel(i.score)}</div></div>
            </li>))}</ul>
        )}
      </Card>
    </div>
  );
}
