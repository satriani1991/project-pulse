import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Columns3, FolderPlus, LayoutGrid, List, Rows3, Star } from 'lucide-react';
import type { Lifecycle, ProjectSummary } from '@pulse/shared';
import { DEPLOYMENT_STATUSES, DEPLOYMENT_STATUS_LABELS, LIFECYCLES, LIFECYCLE_LABELS } from '@pulse/shared';
import { useProjects } from '../hooks/queries';
import { api } from '../services/api';
import { Badge, Button, Card, Empty, Input, Loading, Select, useToast } from '../components/ui';
import { CATEGORY_ICON, IntensityBar, ProjectCard, ProjectThumb, StatusBadge, changesLine } from '../components/project';
import { setUi } from '../stores/ui';
import { CATEGORY_LABEL, bytes, cx, timeAgo } from '../lib/format';

type View = 'grid' | 'table' | 'list' | 'kanban';
const read = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };

export function ProjectsPage({ archive }: { archive?: boolean }) {
  const { category } = useParams();
  const { data, isLoading } = useProjects();
  const qc = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<View>(read('pulse-view', 'grid') as View);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [lifecycle, setLifecycle] = useState('');
  const [cat, setCat] = useState('');
  const [favOnly, setFavOnly] = useState(false);
  const [sort, setSort] = useState(read('pulse-sort', 'recent'));
  const changeView = (v: View) => { setView(v); try { localStorage.setItem('pulse-view', v); } catch { /* ignore */ } };

  const list = useMemo(() => {
    let l = data ?? [];
    const inactiveCutoff = Date.now() - 30 * 86400_000;
    if (archive) l = l.filter((p) => p.lifecycle === 'archived' || p.lifecycle === 'on_hold' || !p.lastLocalUpdate || Date.parse(p.lastActivity ?? p.lastLocalUpdate) < inactiveCutoff);
    else if (view !== 'kanban' && !lifecycle) l = l.filter((p) => p.lifecycle !== 'archived');
    const c = category ?? cat;
    if (c) l = l.filter((p) => p.category === c);
    if (q) { const lq = q.toLowerCase(); l = l.filter((p) => p.name.toLowerCase().includes(lq) || p.rootPath.toLowerCase().includes(lq) || p.tags.some((t) => t.toLowerCase().includes(lq)) || p.technologies.some((t) => t.toLowerCase().includes(lq))); }
    if (status) l = l.filter((p) => p.deploymentState.status === status);
    if (lifecycle) l = l.filter((p) => p.lifecycle === lifecycle);
    if (favOnly) l = l.filter((p) => p.favorite);
    const s = [...l];
    s.sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'intensity' ? b.intensity - a.intensity : sort === 'pending' ? b.deploymentState.pendingCount - a.deploymentState.pendingCount
      : sort === 'size' ? b.stats.totalSize - a.stats.totalSize : (b.lastLocalUpdate ?? '').localeCompare(a.lastLocalUpdate ?? ''));
    return s.sort((a, b) => Number(b.favorite) - Number(a.favorite));
  }, [data, category, cat, q, status, lifecycle, favOnly, sort, archive, view]);

  const patch = async (p: ProjectSummary, body: Partial<ProjectSummary>) => {
    try { await api.patch(`/api/projects/${p.id}`, body); qc.invalidateQueries({ queryKey: ['projects'] }); } catch (e) { toast('error', (e as Error).message); }
  };
  const title = archive ? 'Archive' : category ? `${CATEGORY_LABEL[category]} projects` : 'All projects';

  if (isLoading) return <Loading />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-semibold">{title} <span className="text-base font-normal text-muted">{list.length}</span></h1>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, path, tag, technology…" className="w-64" />
        {!category && <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Deployment status"><option value="">Any deployment status</option>{DEPLOYMENT_STATUSES.map((s) => <option key={s} value={s}>{DEPLOYMENT_STATUS_LABELS[s]}</option>)}</Select>
        <Select value={lifecycle} onChange={(e) => setLifecycle(e.target.value)} aria-label="Lifecycle"><option value="">Any lifecycle</option>{LIFECYCLES.map((s) => <option key={s} value={s}>{LIFECYCLE_LABELS[s]}</option>)}</Select>
        <Select value={sort} onChange={(e) => { setSort(e.target.value); try { localStorage.setItem('pulse-sort', e.target.value); } catch { /* ignore */ } }} aria-label="Sort">
          <option value="recent">Recently updated</option><option value="name">Name</option><option value="intensity">Development intensity</option><option value="pending">Pending changes</option><option value="size">Size</option>
        </Select>
        <Button variant={favOnly ? 'primary' : 'default'} onClick={() => setFavOnly(!favOnly)}><Star className="size-4" />Favorites</Button>
        <div className="ml-auto flex rounded-md border border-border">
          {([['grid', LayoutGrid], ['table', Rows3], ['list', List], ['kanban', Columns3]] as const).map(([v, Icon]) => (
            <button key={v} onClick={() => changeView(v)} aria-label={`${v} view`} title={`${v} view`} className={cx('px-2.5 py-1.5', view === v ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg')}><Icon className="size-4" /></button>
          ))}
        </div>
      </div>

      {!list.length && view !== 'kanban' ? (
        <Card><Empty icon={<FolderPlus className="size-8" />} title={data?.length ? 'No matching projects' : 'No projects registered'}>
          {!data?.length && <Button variant="success" className="mt-3" onClick={() => setUi({ addProject: true })}>Add Project</Button>}
        </Empty></Card>
      ) : view === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{list.map((p) => <ProjectCard key={p.id} p={p} onFavorite={(x) => patch(x, { favorite: !x.favorite })} />)}</div>
      ) : view === 'table' ? (
        <ProjectTable list={list} />
      ) : view === 'list' ? (
        <Card><ul className="divide-y divide-border">{list.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-2 text-sm">
            <span className="text-muted">{CATEGORY_ICON[p.category]}</span>
            <Link to={`/projects/${p.id}`} className="w-56 truncate font-medium hover:text-primary">{p.name}</Link>
            <StatusBadge state={p.deploymentState} />
            <span className="flex-1 truncate text-xs text-muted">{changesLine(p)}</span>
            <span className="w-28 text-right text-xs text-muted">{timeAgo(p.lastLocalUpdate)}</span>
          </li>))}</ul></Card>
      ) : (
        <Kanban list={(data ?? []).filter((p) => (!category || p.category === category))} onMove={(p, l) => patch(p, { lifecycle: l })} />
      )}
    </div>
  );
}

function ProjectTable({ list }: { list: ProjectSummary[] }) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs text-muted"><tr>
          {['Project', 'Category', 'Lifecycle', 'Deployment', 'Pending', 'Local update', 'Deployed', 'Git', 'Intensity', 'Size'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-border">{list.map((p) => (
          <tr key={p.id} className="hover:bg-surface-2/60">
            <td className="px-3 py-2"><Link to={`/projects/${p.id}`} className="flex items-center gap-2 font-medium hover:text-primary"><ProjectThumb p={p} className="size-7 shrink-0 rounded text-[10px]" /><span className="truncate">{p.name}</span>{p.favorite && <Star className="size-3 fill-warning text-warning" />}</Link></td>
            <td className="px-3 py-2 text-muted">{CATEGORY_LABEL[p.category]}</td>
            <td className="px-3 py-2"><Badge>{LIFECYCLE_LABELS[p.lifecycle]}</Badge></td>
            <td className="px-3 py-2"><StatusBadge state={p.deploymentState} /></td>
            <td className="px-3 py-2 tabular-nums">{p.deploymentState.status === 'local_only' ? '—' : p.deploymentState.pendingCount}</td>
            <td className="px-3 py-2 text-muted">{timeAgo(p.lastLocalUpdate)}</td>
            <td className="px-3 py-2 text-muted">{p.deploymentState.status === 'local_only' ? '—' : timeAgo(p.lastDeployment)}</td>
            <td className="px-3 py-2 text-xs text-muted">{p.git?.isRepo ? `${p.git.branch}${p.git.dirtyCount ? ` · ${p.git.dirtyCount}✎` : ''}` : '—'}</td>
            <td className="px-3 py-2"><IntensityBar score={p.intensity} /></td>
            <td className="px-3 py-2 text-right tabular-nums text-muted">{bytes(p.stats.totalSize)}</td>
          </tr>))}</tbody>
      </table>
    </Card>
  );
}

/** Lifecycle Kanban with native drag-and-drop between stages (PRD §12). */
export function Kanban({ list, onMove }: { list: ProjectSummary[]; onMove: (p: ProjectSummary, l: Lifecycle) => void }) {
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {LIFECYCLES.map((l) => {
        const items = list.filter((p) => p.lifecycle === l);
        return (
          <div key={l} onDragOver={(e) => { e.preventDefault(); setOver(l); }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/plain'); const p = list.find((x) => x.id === id); if (p && p.lifecycle !== l) onMove(p, l); }}
            className={cx('flex w-64 shrink-0 flex-col rounded-xl border bg-surface', over === l ? 'border-primary' : 'border-border')}>
            <div className="flex items-center justify-between border-b border-border px-3 py-2 text-sm font-semibold">{LIFECYCLE_LABELS[l]}<span className="rounded-full bg-surface-2 px-2 text-xs text-muted">{items.length}</span></div>
            <div className="min-h-24 flex-1 space-y-2 p-2">
              {items.map((p) => (
                <div key={p.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', p.id)} className="cursor-grab rounded-lg border border-border bg-surface-2 p-2.5 active:cursor-grabbing">
                  <Link to={`/projects/${p.id}`} className="block truncate text-sm font-medium hover:text-primary">{p.name}</Link>
                  <div className="mt-1 flex items-center justify-between gap-1 text-xs text-muted"><span className="flex items-center gap-1">{CATEGORY_ICON[p.category]}{CATEGORY_LABEL[p.category]}</span><StatusBadge state={p.deploymentState} /></div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
