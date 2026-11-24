import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Calculator, Cloud, RefreshCw } from 'lucide-react';
import type { Importance, ProjectSummary } from '@pulse/shared';
import { REMINDER_DAY_OPTIONS, deploymentPriority } from '@pulse/shared';
import { useFrequency, useProjects, useSettings } from '../hooks/queries';
import { api } from '../services/api';
import { Badge, Button, Card, Empty, Loading, Select, Toggle, useAction } from '../components/ui';
import { StatusBadge } from '../components/project';
import { FrequencyChart } from '../charts';
import { setUi } from '../stores/ui';
import { cx, dateTime, timeAgo } from '../lib/format';

const daysPending = (p: ProjectSummary) => (p.deploymentState.pendingSince ? (Date.now() - Date.parse(p.deploymentState.pendingSince)) / 86400_000 : 0);

export function DeploymentsPage() {
  const { data, isLoading } = useProjects();
  const { data: settings } = useSettings();
  const { data: freq } = useFrequency(12);
  const { data: sys } = useQuery({ queryKey: ['system'], queryFn: () => api.get<{ firebaseAuth: { source?: string; valid: boolean; lastError: string; mode: string } }>('/api/system/status') });
  const qc = useQueryClient();
  const { busy, run } = useAction();
  const deployable = useMemo(() => (data ?? []).filter((p) => p.deployment && p.deployment.provider !== 'none'), [data]);
  const queue = useMemo(() => deployable.filter((p) => ['needs_deployment', 'deployment_failed'].includes(p.deploymentState.status))
    .map((p) => ({ p, pr: deploymentPriority({ daysPending: daysPending(p), changedFiles: p.deploymentState.pendingCount, importance: p.importance, buildHasErrors: false }) }))
    .sort((a, b) => b.pr.score - a.pr.score), [deployable]);
  const sites = useMemo(() => {
    const m = new Map<string, ProjectSummary[]>();
    for (const p of deployable) { const s = p.deployment!.hostingSiteId || '(no site)'; m.set(s, [...(m.get(s) ?? []), p]); }
    return [...m.entries()];
  }, [deployable]);
  const reminder = settings?.settings.reminderDays ?? 7;
  const refreshAll = () => run('all', async () => { await api.post('/api/system/firebase-refresh'); qc.invalidateQueries(); }, 'Firebase release information refreshed');
  if (isLoading) return <Loading />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Deployments</h1>
        <Badge tone={sys?.firebaseAuth.valid ? 'success' : sys?.firebaseAuth.lastError ? 'danger' : 'neutral'} icon={<Cloud className="size-3" />}>
          Firebase: {sys?.firebaseAuth.valid ? `connected (${sys.firebaseAuth.source})` : sys?.firebaseAuth.lastError ? 'not authenticated' : 'idle'}
        </Badge>
        <span className="flex items-center gap-2 text-sm text-muted"><BellRing className="size-4" />Remind after
          <Select value={reminder} onChange={(e) => run('rem', async () => { await api.patch('/api/settings', { reminderDays: Number(e.target.value) }); qc.invalidateQueries({ queryKey: ['settings'] }); }, 'Reminder updated')}>
            {REMINDER_DAY_OPTIONS.map((d) => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}
          </Select> undeployed</span>
        <Button className="ml-auto" loading={busy === 'all'} onClick={refreshAll}><RefreshCw className="size-4" />Check Firebase now</Button>
      </div>
      {sys?.firebaseAuth.lastError && !sys.firebaseAuth.valid && (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">Firebase credentials unavailable: {sys.firebaseAuth.lastError}. Run <code>firebase login</code> or <code>gcloud auth login</code>, or set a service-account key in Settings. Until then, status falls back to confirmed baselines and timestamps.</p>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card title="Deployment queue" subtitle="Ranked by the rule-based priority score (days pending, changed files, importance)">
          {!queue.length ? <Empty title="Nothing waiting">All deployable projects match production.</Empty> : (
            <ul className="divide-y divide-border">{queue.map(({ p, pr }) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className={cx('w-12 shrink-0 text-center text-lg font-semibold tabular-nums', pr.score >= 75 ? 'text-danger' : pr.score >= 50 ? 'text-warning' : 'text-muted')}>{pr.score}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><Link to={`/projects/${p.id}?tab=deployments`} className="truncate font-medium hover:text-primary">{p.name}</Link><StatusBadge state={p.deploymentState} /></div>
                  <div className="text-xs text-muted">{p.deploymentState.pendingCount} changed files ({p.deploymentState.added} added · {p.deploymentState.modified} modified · {p.deploymentState.deleted} deleted) · pending {Math.floor(daysPending(p))}d · last deployed {timeAgo(p.lastDeployment)} · {pr.recommendation}</div>
                </div>
                {p.commands.deploy ? <Button variant="primary" size="sm" onClick={() => setUi({ deployProjectId: p.id })}>Deploy</Button> : <span className="text-xs text-muted">No deploy command</span>}
              </li>))}</ul>
          )}
        </Card>
        <PrioritySimulator />
      </div>

      {sites.map(([site, projects]) => (
        <Card key={site} title={<span className="flex items-center gap-2"><Cloud className="size-4 text-primary" />{site}</span>}
          subtitle={projects.length > 1 ? `Shared hosting site · ${projects.length} projects tracked per path — site-wide releases are matched per project subtree` : 'Hosting site'}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-muted"><tr>{['Project', 'Remote path', 'Status', 'Method', 'Pending', 'Project last deployed', 'Site release', ''].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">{projects.map((p) => <SiteRow key={p.id} p={p} />)}</tbody>
            </table>
          </div>
        </Card>
      ))}
      {!deployable.length && <Card><Empty icon={<Cloud className="size-8" />} title="No deployment targets">Configure Firebase Hosting in a project's Settings tab to monitor its deployments.</Empty></Card>}

      <Card title="Development sessions vs deployments" subtitle="Weekly — highlights periods of heavy development without publishing">
        <div className="p-4">{freq ? <FrequencyChart data={freq} /> : <Loading />}</div>
      </Card>
    </div>
  );
}

function SiteRow({ p }: { p: ProjectSummary }) {
  const { busy, run } = useAction();
  const qc = useQueryClient();
  const s = p.deploymentState;
  const after = () => qc.invalidateQueries();
  return (
    <tr>
      <td className="px-3 py-2"><Link to={`/projects/${p.id}?tab=deployments`} className="font-medium hover:text-primary">{p.name}</Link></td>
      <td className="mono px-3 py-2 text-xs">{p.deployment?.remotePath} <span className="text-muted">← {p.deployment?.deployDirectory}</span></td>
      <td className="px-3 py-2"><StatusBadge state={s} /></td>
      <td className="px-3 py-2 text-xs text-muted" title={s.message}>{s.method} · {s.confidence}</td>
      <td className="px-3 py-2 tabular-nums">{s.pendingCount}{s.unverifiedFiles ? <span className="text-muted"> (+{s.unverifiedFiles}?)</span> : ''}</td>
      <td className="px-3 py-2 text-muted" title={dateTime(p.lastDeployment)}>{timeAgo(p.lastDeployment)}</td>
      <td className="px-3 py-2 text-muted" title={dateTime(s.siteReleaseTime)}>{timeAgo(s.siteReleaseTime)}</td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <Button size="sm" variant="ghost" loading={busy === 'r'} onClick={() => run('r', () => api.post(`/api/projects/${p.id}/firebase/refresh`).then(after), 'Refreshed')}>Refresh</Button>
        {s.unverifiedFiles > 0 && <Button size="sm" variant="ghost" loading={busy === 'v'} onClick={() => run('v', () => api.post<{ verified: number; differs: number }>(`/api/projects/${p.id}/verify-remote`).then((r) => { after(); return r; }), 'HTTP verification finished')}>Verify via HTTP</Button>}
        {p.commands.deploy && <Button size="sm" variant="primary" onClick={() => setUi({ deployProjectId: p.id })}>Deploy</Button>}
      </td>
    </tr>
  );
}

function PrioritySimulator() {
  const [days, setDays] = useState(5);
  const [files, setFiles] = useState(24);
  const [imp, setImp] = useState<Importance>('medium');
  const [err, setErr] = useState(false);
  const r = deploymentPriority({ daysPending: days, changedFiles: files, importance: imp, buildHasErrors: err });
  return (
    <Card title={<span className="flex items-center gap-2"><Calculator className="size-4" />Deployment priority simulator</span>} subtitle="Same rule-based engine used for recommendations">
      <div className="space-y-4 p-4 text-sm">
        <label className="block"><div className="flex justify-between"><span>Days with pending changes</span><b>{days} days</b></div><input type="range" min={0} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-full accent-[var(--pp-primary)]" /></label>
        <label className="block"><div className="flex justify-between"><span>Changed deployable files</span><b>{files}</b></div><input type="range" min={0} max={100} value={files} onChange={(e) => setFiles(Number(e.target.value))} className="w-full accent-[var(--pp-primary)]" /></label>
        <div><div className="mb-1">Project importance</div><div className="grid grid-cols-4 gap-1">{(['low', 'medium', 'high', 'critical'] as const).map((i) => <Button key={i} size="sm" variant={imp === i ? 'primary' : 'default'} onClick={() => setImp(i)} className="capitalize">{i}</Button>)}</div></div>
        <Toggle checked={err} onChange={setErr} label="Build has errors" />
        <div className="flex items-end justify-between border-t border-border pt-3">
          <div><div className="text-xs text-muted">Priority score</div><div className="text-3xl font-semibold tabular-nums">{r.score}<span className="text-base text-muted">/100</span></div></div>
          <div className="text-right"><div className="text-xs text-muted">Recommendation</div><div className={cx('font-semibold', r.blocked ? 'text-danger' : r.score >= 50 ? 'text-warning' : 'text-fg')}>{r.recommendation}</div>{r.blocked && <div className="text-xs text-muted">Deployment action blocked</div>}</div>
        </div>
      </div>
    </Card>
  );
}
