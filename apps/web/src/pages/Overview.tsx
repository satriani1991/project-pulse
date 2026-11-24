import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CloudUpload, FolderPlus, Lightbulb, Sparkles } from 'lucide-react';
import { useHeatmap, useOverview, useProjects, useRecommendations, useActivity } from '../hooks/queries';
import { Heatmap } from '../charts';
import { Button, Card, Empty, Loading, Stat } from '../components/ui';
import { ProjectCard } from '../components/project';
import { DayPanel } from '../components/DayPanel';
import { RecommendationList } from '../components/Recommendations';
import { TimelineList } from '../components/Timeline';
import { setUi } from '../stores/ui';
import { api } from '../services/api';
import { bytes, minutes, num, timeAgo } from '../lib/format';
import type { ProjectSummary } from '@pulse/shared';

export function OverviewPage() {
  const { data: ov } = useOverview();
  const { data: projects, isLoading } = useProjects();
  const { data: heat } = useHeatmap();
  const { data: recs } = useRecommendations();
  const { data: events } = useActivity({ limit: 12 });
  const [day, setDay] = useState<string | undefined>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const pending = useMemo(() => (projects ?? []).filter((p) => p.deploymentState.status === 'needs_deployment' || p.deploymentState.status === 'deployment_failed')
    .sort((a, b) => b.deploymentState.pendingCount - a.deploymentState.pendingCount), [projects]);
  const mine = useMemo(() => [...(projects ?? [])].filter((p) => p.lifecycle !== 'archived')
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || (b.lastLocalUpdate ?? '').localeCompare(a.lastLocalUpdate ?? '')).slice(0, 8), [projects]);
  const fav = async (p: ProjectSummary) => { await api.patch(`/api/projects/${p.id}`, { favorite: !p.favorite }); qc.invalidateQueries({ queryKey: ['projects'] }); };

  if (isLoading) return <Loading />;
  if (!projects?.length) return (
    <Card><Empty icon={<FolderPlus className="size-10" />} title="Register your first project">
      Add a single project folder or let PROJECT PULSE discover every game, library and app under a parent directory such as <code>C:\ProjectX</code>.
      <div className="mt-4 flex justify-center gap-2"><Button variant="success" onClick={() => setUi({ addProject: true })}>Add Project</Button><Button onClick={() => setUi({ discover: true })}>Discover projects</Button></div>
    </Empty></Card>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total projects" value={ov?.totalProjects ?? '—'} hint={ov && `${bytes(ov.totalSize)} monitored`} onClick={() => nav('/projects')} />
        <Stat label="Needs deployment" value={ov?.needsDeployment ?? '—'} tone="warning" hint={ov?.failed ? `${ov.failed} failed` : 'Pending changes'} onClick={() => nav('/deployments')} />
        <Stat label="Up to date" value={ov?.upToDate ?? '—'} tone="success" hint={ov?.neverDeployed ? `${ov.neverDeployed} never deployed` : 'Verified against production'} onClick={() => nav('/deployments')} />
        <Stat label="Inactive projects" value={ov?.inactive ?? '—'} hint="No activity in 30+ days" onClick={() => nav('/archive')} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card title="Development activity" subtitle={heat ? `${num(heat.total)} meaningful file changes in the last 12 months` : 'Last 12 months'}
          actions={<span className="text-xs text-muted">Today: {ov?.changesToday ?? 0} · 7d est. {minutes(ov?.estimatedMinutes7d ?? 0)}</span>}>
          <div className="p-4">
            {heat ? <Heatmap days={heat.days} selected={day} onSelect={(d) => setDay(d === day ? undefined : d)} /> : <Loading />}
            {day && <div className="mt-4 border-t border-border pt-4"><DayPanel date={day} /></div>}
          </div>
        </Card>
        <Card title={<span className="flex items-center gap-2"><CloudUpload className="size-4 text-warning" />Pending deployments</span>} actions={<span className="text-xs text-muted">{pending.length} pending</span>}>
          {!pending.length ? <Empty title="Everything is published">No project has undeployed changes.</Empty> : (
            <ul className="divide-y divide-border">
              {pending.slice(0, 7).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0"><Link to={`/projects/${p.id}`} className="block truncate font-medium hover:text-primary">{p.name}</Link>
                    <p className="text-xs text-muted">{p.deploymentState.status === 'deployment_failed' ? <span className="text-danger">Deployment failed</span> : `${p.deploymentState.pendingCount} changed files`} · Last deployed {timeAgo(p.lastDeployment)}</p></div>
                  {p.commands.deploy && <Button size="sm" variant="primary" onClick={() => setUi({ deployProjectId: p.id })}>Deploy</Button>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">My projects</h2><Link to="/projects" className="text-sm text-primary hover:underline">View all {projects.length}</Link></div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{mine.map((p) => <ProjectCard key={p.id} p={p} onFavorite={fav} />)}</div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><Lightbulb className="size-4 text-warning" />Recommendations</span>} actions={<Link to="/deployments" className="text-xs text-primary">Priorities</Link>}>
          {recs ? <RecommendationList items={recs.slice(0, 7)} /> : <Loading />}
        </Card>
        <Card title={<span className="flex items-center gap-2"><Sparkles className="size-4 text-primary" />Workspace activity</span>} actions={<Link to="/activity" className="text-xs text-primary">Full timeline</Link>}>
          {events ? <TimelineList events={events} compact /> : <Loading />}
        </Card>
      </div>
    </div>
  );
}
