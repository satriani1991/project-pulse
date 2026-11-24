import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive as ArchiveIcon, CloudUpload, Code2, ExternalLink, FolderOpen, GitBranch, Hammer, HardDriveDownload, Play, RefreshCw, Square, Star, TerminalSquare, Flame, Globe } from 'lucide-react';
import type { FileEvent, Lifecycle, PendingChange, ProjectSummary } from '@pulse/shared';
import { LIFECYCLES, LIFECYCLE_LABELS, intensityLabel } from '@pulse/shared';
import { useDeployments, useHeatmap, useProcesses, useProject, useProjects, useRecommendations } from '../hooks/queries';
import { api } from '../services/api';
import { Badge, Button, Card, Empty, Loading, Select, Stat, Tabs, useAction } from '../components/ui';
import { CATEGORY_ICON, ProjectThumb, StatusBadge } from '../components/project';
import { RecommendationList } from '../components/Recommendations';
import { TimelineList } from '../components/Timeline';
import { AssetExplorer } from '../components/AssetExplorer';
import { TaskBoard } from '../components/TaskBoard';
import { DailyBars, FrequencyChart, Heatmap } from '../charts';
import { DayPanel } from '../components/DayPanel';
import { ProcessLogs } from './Servers';
import { FilesTab } from './project/FilesTab';
import { NotesTab } from './project/NotesTab';
import { ProjectSettingsTab } from './project/SettingsTab';
import { setUi } from '../stores/ui';
import { CATEGORY_LABEL, bytes, cx, date, dateTime, minutes, time, timeAgo } from '../lib/format';

type Tab = 'overview' | 'files' | 'activity' | 'git' | 'deployments' | 'assets' | 'dependencies' | 'tasks' | 'notes' | 'settings';

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) ?? 'overview';
  const setTab = (t: Tab) => setSp(t === 'overview' ? {} : { tab: t }, { replace: true });
  const { data: p, isLoading, error } = useProject(id);
  if (isLoading) return <Loading />;
  if (error || !p) return <Card><Empty title="Project not found"><Link to="/projects" className="text-primary">Back to projects</Link></Empty></Card>;
  return (
    <div className="space-y-4">
      <Header p={p} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Overview' }, { id: 'files', label: 'Files', count: p.stats.totalFiles }, { id: 'activity', label: 'Activity' }, { id: 'git', label: 'Git' },
        { id: 'deployments', label: 'Deployments', count: p.deploymentState.pendingCount || undefined }, { id: 'assets', label: 'Assets', count: p.stats.assetFiles }, { id: 'dependencies', label: 'Dependencies' },
        { id: 'tasks', label: 'Tasks' }, { id: 'notes', label: 'Notes' }, { id: 'settings', label: 'Settings' },
      ]} />
      {tab === 'overview' && <OverviewTab p={p} />}
      {tab === 'files' && <FilesTab p={p} initialFile={sp.get('file') ?? undefined} />}
      {tab === 'activity' && <ActivityTab p={p} />}
      {tab === 'git' && <GitTab p={p} />}
      {tab === 'deployments' && <DeploymentsTab p={p} />}
      {tab === 'assets' && <AssetExplorer projectId={p.id} />}
      {tab === 'dependencies' && <DependenciesTab p={p} />}
      {tab === 'tasks' && <TaskBoard projectId={p.id} />}
      {tab === 'notes' && <NotesTab p={p} />}
      {tab === 'settings' && <ProjectSettingsTab p={p} />}
    </div>
  );
}

function Header({ p }: { p: ProjectSummary }) {
  const qc = useQueryClient();
  const { busy, run } = useAction();
  const { data: procs } = useProcesses();
  const running = procs?.filter((x) => x.projectId === p.id && x.status === 'running') ?? [];
  const dev = running.find((x) => x.commandKey === 'dev' || x.commandKey === 'start');
  const s = p.deploymentState;
  const launch = (action: string, command?: string) => run(action + (command ?? ''), () => api.post(`/api/projects/${p.id}/launch`, { action, command }).then(() => qc.invalidateQueries({ queryKey: ['processes'] })));
  const patch = (body: object) => run('patch', async () => { await api.patch(`/api/projects/${p.id}`, body); qc.invalidateQueries({ queryKey: ['projects'] }); });
  const consoleUrl = p.deployment?.firebaseProjectId ? `https://console.firebase.google.com/project/${p.deployment.firebaseProjectId}/hosting/sites/${p.deployment.hostingSiteId || p.deployment.firebaseProjectId}` : undefined;
  return (
    <Card className="overflow-hidden">
      <div className="relative h-40 overflow-hidden bg-surface-2">
        <ProjectThumb p={p} className="size-full opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/50 to-transparent" />
        <div className="absolute right-4 bottom-3 left-4 flex flex-wrap items-end gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-bold">{p.name}
              <button onClick={() => patch({ favorite: !p.favorite })} aria-label="Favorite"><Star className={cx('size-5', p.favorite ? 'fill-warning text-warning' : 'text-muted hover:text-warning')} /></button></h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted"><span className="flex items-center gap-1">{CATEGORY_ICON[p.category]}{CATEGORY_LABEL[p.category]}</span>·<span>{p.genre || p.technologies.join(' · ') || 'No technologies set'}</span>{p.version && <>·<span>v{p.version}</span></>}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <StatusBadge state={s} />
            {p.intensity >= 20 && <Badge tone="success" icon={<Flame className="size-3" />}>{intensityLabel(p.intensity)} · {p.intensity}</Badge>}
            <Select value={p.lifecycle} onChange={(e) => patch({ lifecycle: e.target.value as Lifecycle })} aria-label="Lifecycle">{LIFECYCLES.map((l) => <option key={l} value={l}>{LIFECYCLE_LABELS[l]}</option>)}</Select>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px border-y border-border bg-border md:grid-cols-4">
        {[['Last local update', timeAgo(p.lastLocalUpdate), dateTime(p.lastLocalUpdate)], ['Last deployed', s.status === 'local_only' ? 'Local only' : timeAgo(p.lastDeployment), dateTime(p.lastDeployment)],
          ['Pending changes', s.status === 'local_only' ? '—' : `${s.pendingCount} files`, s.method !== 'none' ? `${s.method} comparison` : ''], ['Project size', bytes(p.stats.totalSize), `${p.stats.totalFiles.toLocaleString()} files`]].map(([l, v, t]) => (
          <div key={l} className="bg-surface px-4 py-3" title={t}><div className="text-xs text-muted">{l}</div><div className={cx('text-lg font-semibold', l === 'Pending changes' && s.pendingCount > 0 && 'text-warning')}>{v}</div></div>))}
      </div>
      {p.errors.length > 0 && <div className="border-b border-border bg-danger/10 px-4 py-2 text-sm text-danger">{p.errors.join(' · ')}</div>}
      <div className="flex flex-wrap gap-2 p-3">
        <Button onClick={() => launch('open_folder')}><FolderOpen className="size-4" />Open folder</Button>
        <Button onClick={() => launch('open_editor')}><Code2 className="size-4" />Open VS Code</Button>
        <Button onClick={() => launch('open_terminal')}><TerminalSquare className="size-4" />Open terminal</Button>
        {p.commands.dev && (dev ? <>
          {dev.url && <a href={dev.url} target="_blank" rel="noreferrer"><Button variant="primary"><Play className="size-4" />Play local :{dev.port}</Button></a>}
          <Button variant="danger" onClick={() => run('stop', () => api.post(`/api/processes/${dev.id}/stop`).then(() => qc.invalidateQueries({ queryKey: ['processes'] })))}><Square className="size-3.5" />Stop server</Button>
        </> : <Button loading={busy === 'rundev'} onClick={() => launch('run', 'dev')}><Play className="size-4" />Start dev server</Button>)}
        {p.deployment?.publicUrl && <a href={p.deployment.publicUrl} target="_blank" rel="noreferrer"><Button><Globe className="size-4" />Open website</Button></a>}
        {p.commands.build && <Button loading={busy === 'runbuild'} onClick={() => launch('run', 'build')}><Hammer className="size-4" />Build</Button>}
        {p.commands.deploy && <Button variant="success" onClick={() => setUi({ deployProjectId: p.id })}><CloudUpload className="size-4" />Build & Deploy</Button>}
        <span className="ml-auto flex flex-wrap gap-2">
          {p.repoUrl && <a href={p.repoUrl} target="_blank" rel="noreferrer"><Button variant="ghost"><GitBranch className="size-4" />Repository</Button></a>}
          {consoleUrl && <a href={consoleUrl} target="_blank" rel="noreferrer"><Button variant="ghost"><ExternalLink className="size-4" />Firebase Console</Button></a>}
          <Button variant="ghost" loading={busy === 'backup'} onClick={() => run('backup', () => api.post(`/api/projects/${p.id}/backup`), 'Backup started — you will be notified when it completes')}><HardDriveDownload className="size-4" />Backup</Button>
          <Button variant="ghost" loading={busy === 'scan'} onClick={() => run('scan', () => api.post(`/api/projects/${p.id}/scan`).then(() => qc.invalidateQueries()), 'Rescan complete')}><RefreshCw className="size-4" />Rescan</Button>
        </span>
      </div>
      {running.length > 0 && <div className="border-t border-border px-3 pb-3"><details><summary className="cursor-pointer py-2 text-xs text-muted">Process output ({running.map((r) => r.commandKey).join(', ')})</summary><ProcessLogs id={running[0].id} /></details></div>}
    </Card>
  );
}

function ChangeList({ changes, limit = 50 }: { changes: PendingChange[]; limit?: number }) {
  if (!changes.length) return <Empty title="No pending changes" />;
  return (
    <ul className="mono divide-y divide-border text-xs">
      {changes.slice(0, limit).map((c) => (
        <li key={c.path + c.change} className="flex items-center justify-between gap-3 px-4 py-1.5">
          <span className="truncate">{c.path}</span>
          <span className="flex shrink-0 items-center gap-3"><span className="text-muted">{c.modifiedAt && timeAgo(c.modifiedAt)}</span>
            <Badge tone={c.change === 'added' ? 'success' : c.change === 'deleted' ? 'danger' : c.change === 'modified' ? 'primary' : 'neutral'}>{c.change === 'added' ? 'Added' : c.change === 'deleted' ? 'Deleted' : c.change === 'modified' ? 'Modified' : 'Unverified'}</Badge></span>
        </li>))}
      {changes.length > limit && <li className="px-4 py-1.5 text-muted">…and {changes.length - limit} more</li>}
    </ul>
  );
}

function OverviewTab({ p }: { p: ProjectSummary }) {
  const { data: ch } = useQuery({ queryKey: ['changes', p.id], queryFn: () => api.get<{ changes: PendingChange[] }>(`/api/projects/${p.id}/changes`) });
  const { data: files } = useQuery({ queryKey: ['files', p.id, 'recent'], queryFn: () => api.get<{ recent: { path: string; change: string; at: string }[] }>(`/api/projects/${p.id}/files?limit=1`) });
  const { data: recs } = useRecommendations();
  const { data: deps } = useDeployments(p.id);
  const mine = recs?.filter((r) => r.projectId === p.id) ?? [];
  const lastDeployed = deps?.deployments.find((d) => d.status === 'success' && d.localVersion);
  const st = p.stats;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Files changed today" value={st.filesChangedToday} />
          <Stat label="Changed since deployment" value={st.filesChangedSinceDeployment ?? '—'} tone={st.filesChangedSinceDeployment ? 'warning' : undefined} />
          <Stat label="Sessions (30 days)" value={st.sessions30d} hint={`≈ ${minutes(st.estimatedMinutes30d)} estimated`} />
          <Stat label="Uncommitted files" value={p.git?.isRepo ? p.git.dirtyCount : '—'} hint={p.git?.isRepo ? `on ${p.git.branch}` : 'Not a Git repo'} />
        </div>
        <Card title="Pending deployment changes" subtitle={p.deploymentState.message}>{ch ? <ChangeList changes={ch.changes} limit={15} /> : <Loading />}</Card>
        <Card title="Recent file changes">
          <ul className="mono divide-y divide-border text-xs">{files?.recent.slice(0, 15).map((r, i) => (
            <li key={i} className="flex justify-between px-4 py-1.5"><span className="truncate">{r.path}</span><span className="flex shrink-0 gap-3"><span className="text-muted">{timeAgo(r.at)}</span><span className={cx(r.change === 'created' ? 'text-success' : r.change === 'deleted' ? 'text-danger' : 'text-primary')}>{r.change}</span></span></li>))}
            {!files?.recent.length && <li className="px-4 py-6 text-center text-muted">No changes recorded since registration.</li>}</ul>
        </Card>
      </div>
      <div className="space-y-4">
        <Card title="Project health">
          <dl className="grid grid-cols-[140px_1fr] gap-y-1.5 p-4 text-sm">
            <dt className="text-muted">Directory</dt><dd className="mono truncate text-xs" title={p.rootPath}>{p.rootPath}</dd>
            <dt className="text-muted">Source / assets</dt><dd>{bytes(st.sourceSize)} · {bytes(st.assetSize)}</dd>
            <dt className="text-muted">Monitoring</dt><dd>{p.monitoringEnabled ? 'Real-time' : 'Off'} · Git {p.gitEnabled ? 'on' : 'off'} · Deploy {p.deploymentMonitoring ? 'on' : 'off'}</dd>
            <dt className="text-muted">Last commit</dt><dd className="truncate">{p.git?.commitMessage ? `${p.git.commitMessage} · ${timeAgo(p.git.commitDate)}` : '—'}</dd>
            <dt className="text-muted">Versions</dt><dd>local {p.version ?? '—'} · published {lastDeployed?.localVersion ?? '—'}</dd>
            {p.deployment?.publicUrl && <><dt className="text-muted">Website</dt><dd>{p.health ? <span className={p.health.ok ? 'text-success' : 'text-danger'}>{p.health.ok ? `Online · ${p.health.latencyMs} ms · ${bytes(p.health.bytes)}` : `Down · ${p.health.error ?? p.health.status}`}</span> : 'Not checked'}</dd></>}
            <dt className="text-muted">Last scan</dt><dd>{timeAgo(p.lastScanAt)}</dd>
            <dt className="text-muted">Registered</dt><dd>{date(p.createdAt)}</dd>
          </dl>
          {p.description && <p className="border-t border-border px-4 py-3 text-sm text-muted">{p.description}</p>}
        </Card>
        <Card title="Recommendations">{recs ? <RecommendationList items={mine} /> : <Loading />}</Card>
      </div>
    </div>
  );
}

function ActivityTab({ p }: { p: ProjectSummary }) {
  const { data: heat } = useHeatmap({ projectId: p.id });
  const { data } = useQuery({ queryKey: ['projectActivity', p.id], queryFn: () => api.get<{ daily: Record<string, number | string>[]; events: FileEvent[]; sessions: { id: number; started_at: string; ended_at: string; events: number; minutes: number }[] }>(`/api/projects/${p.id}/activity?days=90`) });
  const [day, setDay] = useState<string>();
  return (
    <div className="space-y-4">
      <Card title="Contribution activity" subtitle={heat ? `${heat.total} meaningful file changes in the last 52 weeks` : undefined}>
        <div className="p-4">{heat ? <Heatmap days={heat.days} selected={day} onSelect={(d) => setDay(d === day ? undefined : d)} /> : <Loading />}{day && <div className="mt-4 border-t border-border pt-4"><DayPanel date={day} projectId={p.id} /></div>}</div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card title="Project timeline">{data ? <TimelineList events={data.events} /> : <Loading />}</Card>
        <div className="space-y-4">
          <Card title="Daily file changes (90 days)"><div className="p-3">{data ? <DailyBars data={data.daily} /> : <Loading />}</div></Card>
          <Card title="Development sessions" subtitle="Estimated development time — file activity only">
            <ul className="max-h-96 divide-y divide-border overflow-y-auto text-sm">{data?.sessions.map((s) => (
              <li key={s.id} className="flex justify-between px-4 py-1.5"><span>{date(s.started_at)} {time(s.started_at)}–{time(s.ended_at)}</span><span className="text-muted">{minutes(s.minutes)} · {s.events} events</span></li>))}
              {!data?.sessions.length && <li className="px-4 py-6 text-center text-muted">No sessions yet</li>}</ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function GitTab({ p }: { p: ProjectSummary }) {
  const { data } = useQuery({ queryKey: ['git', p.id], queryFn: () => api.get<{ snapshot?: ProjectSummary['git']; commits: { hash: string; message: string; author: string; committedAt: string; branch?: string }[] }>(`/api/projects/${p.id}/git`) });
  const { run, busy } = useAction();
  const qc = useQueryClient();
  const g = data?.snapshot;
  if (!data) return <Loading />;
  if (!g?.isRepo) return <Card><Empty icon={<GitBranch className="size-8" />} title={p.gitEnabled ? 'Not a Git repository' : 'Git monitoring is disabled'}>{g?.error ?? 'Run `git init` in the project folder to enable commit tracking.'}</Empty></Card>;
  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <div className="space-y-4">
        <Card title="Repository" actions={<Button size="sm" loading={busy === 'g'} onClick={() => run('g', () => api.post(`/api/projects/${p.id}/git/refresh`).then(() => qc.invalidateQueries()))}><RefreshCw className="size-3.5" />Refresh</Button>}>
          <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 p-4 text-sm">
            <dt className="text-muted">Branch</dt><dd className="mono">{g.branch}</dd>
            <dt className="text-muted">HEAD</dt><dd className="mono text-xs">{g.commitHash?.slice(0, 12)}</dd>
            <dt className="text-muted">Last commit</dt><dd>{g.commitMessage} <span className="text-muted">· {g.commitAuthor} · {timeAgo(g.commitDate)}</span></dd>
            <dt className="text-muted">Upstream</dt><dd>{g.ahead !== undefined ? `${g.ahead} ahead · ${g.behind} behind` : 'No upstream'}</dd>
            <dt className="text-muted">Remote</dt><dd className="truncate">{g.remoteUrl ? <a href={g.remoteUrl} target="_blank" rel="noreferrer" className="text-primary">{g.remoteUrl}</a> : '—'}</dd>
          </dl>
        </Card>
        <Card title="Working tree" subtitle={`${g.dirtyCount} uncommitted file(s)`}>
          <ul className="mono max-h-96 divide-y divide-border overflow-y-auto text-xs">{g.files?.map((f) => <li key={f.path} className="flex gap-3 px-4 py-1"><span className="w-6 text-warning">{f.status}</span><span className="truncate">{f.path}</span></li>)}
            {!g.dirtyCount && <li className="px-4 py-6 text-center text-muted">Working tree clean</li>}</ul>
        </Card>
      </div>
      <Card title="Commits" subtitle={`${data.commits.length} recorded`}>
        <ul className="divide-y divide-border text-sm">{data.commits.map((c) => (
          <li key={c.hash} className="flex gap-3 px-4 py-2"><code className="text-xs text-primary">{c.hash.slice(0, 8)}</code><span className="min-w-0 flex-1 truncate">{c.message}</span><span className="shrink-0 text-xs text-muted">{c.author} · {timeAgo(c.committedAt)}</span></li>))}</ul>
      </Card>
    </div>
  );
}

function DeploymentsTab({ p }: { p: ProjectSummary }) {
  const { data } = useDeployments(p.id);
  const { data: ch } = useQuery({ queryKey: ['changes', p.id], queryFn: () => api.get<{ changes: PendingChange[] }>(`/api/projects/${p.id}/changes`) });
  const { run, busy } = useAction();
  const qc = useQueryClient();
  const s = p.deploymentState;
  const after = () => qc.invalidateQueries();
  if (!p.deployment || p.deployment.provider === 'none') return <Card><Empty icon={<CloudUpload className="size-8" />} title="Local-only project">Configure Firebase Hosting in the Settings tab to monitor deployments.</Empty></Card>;
  return (
    <div className="space-y-4">
      <Card title="Deployment status" actions={<>
        <Button size="sm" loading={busy === 'r'} onClick={() => run('r', () => api.post(`/api/projects/${p.id}/firebase/refresh`).then(after), 'Firebase refreshed')}><RefreshCw className="size-3.5" />Refresh from Firebase</Button>
        {s.unverifiedFiles > 0 && <Button size="sm" loading={busy === 'v'} onClick={() => run('v', () => api.post(`/api/projects/${p.id}/verify-remote`).then(after), 'HTTP verification complete')}>Verify via HTTP</Button>}
        <Button size="sm" loading={busy === 'b'} onClick={() => { if (confirm('Only confirm if you have independently verified that the current local deployable files are exactly what production serves. This records a manual baseline.')) run('b', () => api.post(`/api/projects/${p.id}/baseline`, { confirm: true }).then(after), 'Baseline recorded'); }}>Confirm baseline</Button>
        {p.commands.deploy && <Button size="sm" variant="success" onClick={() => setUi({ deployProjectId: p.id })}><CloudUpload className="size-3.5" />Build & Deploy</Button>}
      </>}>
        <div className="grid gap-4 p-4 text-sm md:grid-cols-2">
          <dl className="grid grid-cols-[150px_1fr] gap-y-1.5">
            <dt className="text-muted">Status</dt><dd><StatusBadge state={s} /></dd>
            <dt className="text-muted">Comparison</dt><dd>{s.method} · confidence {s.confidence}</dd>
            <dt className="text-muted">Changes</dt><dd>{s.added} added · {s.modified} modified · {s.deleted} deleted{s.unverifiedFiles ? ` · ${s.unverifiedFiles} unverified` : ''}</dd>
            <dt className="text-muted">Pending since</dt><dd>{s.pendingSince ? `${dateTime(s.pendingSince)} (${timeAgo(s.pendingSince)})` : '—'}</dd>
            <dt className="text-muted">Checked</dt><dd>{timeAgo(s.checkedAt)}</dd>
          </dl>
          <dl className="grid grid-cols-[150px_1fr] gap-y-1.5">
            <dt className="text-muted">Firebase project / site</dt><dd>{p.deployment.firebaseProjectId || '—'} / {p.deployment.hostingSiteId || '—'}</dd>
            <dt className="text-muted">Remote path</dt><dd className="mono">{p.deployment.remotePath} ← {p.deployment.deployDirectory}</dd>
            <dt className="text-muted">Project last deployed</dt><dd>{dateTime(p.lastDeployment)}</dd>
            <dt className="text-muted">Latest site release</dt><dd>{dateTime(s.siteReleaseTime)} {s.releaseId && <code className="text-xs text-muted">{s.releaseId}</code>}</dd>
            {s.error && <><dt className="text-muted">Error</dt><dd className="text-danger">{s.error}</dd></>}
          </dl>
          {s.message && <p className="text-xs text-muted md:col-span-2">{s.message}</p>}
        </div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Pending changes" subtitle="Local deployable files vs production">{ch ? <ChangeList changes={ch.changes} limit={300} /> : <Loading />}</Card>
        <Card title="Deployment history" subtitle="Site releases that did not change this project's path are marked — they do not count as a deployment of this project">
          <ul className="divide-y divide-border text-sm">{data?.deployments.map((d) => (
            <li key={d.id} className={cx('flex items-center gap-3 px-4 py-2', !d.affectsProject && 'opacity-55')}>
              <Badge tone={d.status === 'success' ? (d.affectsProject ? 'success' : 'neutral') : d.status === 'failed' ? 'danger' : 'neutral'}>{d.status === 'failed' ? 'Failed' : d.affectsProject ? 'Deployed' : 'Site only'}</Badge>
              <div className="min-w-0 flex-1"><div className="truncate">{d.message ?? (d.affectsProject ? `Release ${d.releaseId}` : 'Site release without changes to this path')}</div>
                <div className="text-xs text-muted">{d.source} · {d.deployedBy ?? 'unknown'}{d.fileCount !== undefined ? ` · ${d.fileCount} files` : ''}{d.localVersion ? ` · v${d.localVersion}` : ''}</div></div>
              <span className="shrink-0 text-xs text-muted" title={dateTime(d.deployedAt)}>{timeAgo(d.deployedAt)}</span>
            </li>))}
            {!data?.deployments.length && <li className="px-4 py-6 text-center text-muted">No deployments recorded</li>}</ul>
        </Card>
      </div>
      {data && <Card title="Sessions vs deployments (this project)"><div className="p-4"><FrequencyChart data={data.frequency} /></div></Card>}
    </div>
  );
}

function DependenciesTab({ p }: { p: ProjectSummary }) {
  const { data } = useQuery({ queryKey: ['dependencies', p.id], queryFn: () => api.get<{ id: number; projectId: string; dependencyId: string; source: string; version?: string; detail?: string }[]>(`/api/projects/${p.id}/dependencies`) });
  const { data: projects } = useProjects();
  const names = useMemo(() => new Map((projects ?? []).map((x) => [x.id, x.name])), [projects]);
  const [dep, setDep] = useState('');
  const { run } = useAction();
  const qc = useQueryClient();
  const nav = useNavigate();
  if (!data) return <Loading />;
  const uses = data.filter((d) => d.projectId === p.id);
  const usedBy = data.filter((d) => d.dependencyId === p.id);
  const Row = ({ id, d }: { id: string; d: (typeof data)[number] }) => <li className="flex items-center justify-between gap-3 px-4 py-2 text-sm"><button className="hover:text-primary" onClick={() => nav(`/projects/${id}`)}>{names.get(id) ?? id}</button><span className="flex items-center gap-2"><span className="mono truncate text-xs text-muted">{d.version ?? d.detail}</span><Badge>{d.source}</Badge></span></li>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={`Uses (${uses.length})`} actions={<div className="flex gap-2"><Select value={dep} onChange={(e) => setDep(e.target.value)} aria-label="Library"><option value="">Add dependency…</option>{projects?.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
        <Button size="sm" disabled={!dep} onClick={() => run('a', async () => { await api.post(`/api/projects/${p.id}/dependencies`, { dependencyId: dep }); setDep(''); qc.invalidateQueries({ queryKey: ['dependencies'] }); })}>Add</Button></div>}>
        <ul className="divide-y divide-border">{uses.map((d) => <Row key={d.id} id={d.dependencyId} d={d} />)}{!uses.length && <li className="px-4 py-6 text-center text-sm text-muted">No dependencies detected</li>}</ul>
      </Card>
      <Card title={`Used by (${usedBy.length})`} subtitle={usedBy.length ? 'Changes here should be tested in these projects' : undefined}>
        <ul className="divide-y divide-border">{usedBy.map((d) => <Row key={d.id} id={d.projectId} d={d} />)}{!usedBy.length && <li className="px-4 py-6 text-center text-sm text-muted">No dependents</li>}</ul>
      </Card>
      <p className="text-xs text-muted lg:col-span-2"><ArchiveIcon className="mr-1 inline size-3" />Detected from package.json, file:/link: specifiers, relative imports leaving the project, and byte-identical copies of library source files. See the <Link to="/dependencies" className="text-primary">dependency map</Link>.</p>
    </div>
  );
}
