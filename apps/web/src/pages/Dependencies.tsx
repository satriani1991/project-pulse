import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Trash2 } from 'lucide-react';
import { useDependencies } from '../hooks/queries';
import { api } from '../services/api';
import { Badge, Button, Card, Empty, Loading, Select, useAction } from '../components/ui';
import { CATEGORY_SERIES, timeAgo } from '../lib/format';

const SOURCE_LABEL: Record<string, string> = { package: 'package.json', workspace: 'file:/link:', import: 'local import', copy: 'copied files', manual: 'manual' };

/** Layered dependency map: shared libraries on the left, projects that use them on the right. */
export function DependencyGraph({ nodes, edges, highlight, onSelect }: { nodes: { id: string; name: string; category: string }[]; edges: { projectId: string; dependencyId: string; source: string }[]; highlight?: string; onSelect?: (id: string) => void }) {
  const used = new Set(edges.flatMap((e) => [e.projectId, e.dependencyId]));
  const deps = nodes.filter((n) => edges.some((e) => e.dependencyId === n.id));
  const users = nodes.filter((n) => used.has(n.id) && !deps.includes(n));
  const rowH = 40, W = 760, colX = [40, W - 260];
  const H = Math.max(deps.length, users.length) * rowH + 30;
  const pos = new Map<string, { x: number; y: number }>();
  deps.forEach((n, i) => pos.set(n.id, { x: colX[0], y: 20 + i * rowH + ((users.length - deps.length) * rowH) / 2 * Number(users.length > deps.length) }));
  users.forEach((n, i) => pos.set(n.id, { x: colX[1], y: 20 + i * rowH + ((deps.length - users.length) * rowH) / 2 * Number(deps.length > users.length) }));
  if (!edges.length) return <Empty title="No dependencies detected">Relationships are discovered from package manifests, <code>file:</code> links, relative imports and copied library files — or add them manually below.</Empty>;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Project dependency map">
      {edges.map((e, i) => {
        const a = pos.get(e.dependencyId), b = pos.get(e.projectId);
        if (!a || !b) return null;
        const hot = highlight && (e.dependencyId === highlight || e.projectId === highlight);
        const x1 = a.x + 220, y1 = a.y + 14, x2 = b.x, y2 = b.y + 14;
        return <path key={i} d={`M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`} fill="none" stroke={hot ? 'var(--pp-primary)' : 'var(--pp-border)'} strokeWidth={hot ? 2 : 1.5} strokeDasharray={e.source === 'copy' ? '5 4' : e.source === 'manual' ? '2 3' : undefined} />;
      })}
      {[...deps, ...users].map((n) => {
        const p = pos.get(n.id)!;
        return (
          <g key={n.id} transform={`translate(${p.x},${p.y})`} className="cursor-pointer" onClick={() => onSelect?.(n.id)}>
            <rect width={220} height={28} rx={6} fill="var(--pp-surface-2)" stroke={highlight === n.id ? 'var(--pp-primary)' : 'var(--pp-border)'} />
            <rect width={4} height={28} rx={2} fill={CATEGORY_SERIES[n.category]} />
            <text x={12} y={18} fontSize={12} fill="var(--pp-text)">{n.name.length > 28 ? n.name.slice(0, 27) + '…' : n.name}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function DependenciesPage() {
  const { data, isLoading } = useDependencies();
  const qc = useQueryClient();
  const { busy, run } = useAction();
  const [sel, setSel] = useState<string>();
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const names = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);
  if (isLoading || !data) return <Loading />;
  const impacted = sel ? collect(sel, data.edges) : [];
  const libs = data.nodes.filter((n) => data.edges.some((e) => e.dependencyId === n.id));
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3"><h1 className="text-xl font-semibold">Shared library dependencies</h1>
        <Button className="ml-auto" loading={busy === 'scan'} onClick={() => run('scan', async () => { await api.post('/api/dependencies/rescan'); qc.invalidateQueries({ queryKey: ['dependencies'] }); }, 'Dependencies re-scanned')}><RefreshCw className="size-4" />Re-scan</Button></div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card title="Project dependency map" subtitle="Click a node to see impact. Solid: manifest/import · dashed: copied files · dotted: manual">
          <div className="p-4"><DependencyGraph nodes={data.nodes} edges={data.edges} highlight={sel} onSelect={setSel} /></div>
        </Card>
        <Card title="Impact analysis" subtitle={sel ? `If ${names.get(sel)?.name} changes…` : 'Select a library in the map'}>
          {!sel ? <div className="space-y-2 p-4 text-sm">{libs.map((l) => <button key={l.id} onClick={() => setSel(l.id)} className="block text-primary hover:underline">{l.name}</button>)}{!libs.length && <p className="text-muted">No shared libraries yet.</p>}</div> : (
            <div className="p-4 text-sm">
              {!impacted.length ? <p className="text-muted">No project depends on it.</p> : <>
                <p className="mb-2">Rebuild, test and redeploy <b>{impacted.length}</b> dependent project(s):</p>
                <ul className="space-y-1.5">{impacted.map((id) => { const n = names.get(id)!; const stale = n.lastDeployment && names.get(sel)?.lastLocalUpdate && n.lastDeployment < names.get(sel)!.lastLocalUpdate!;
                  return <li key={id} className="flex justify-between"><Link to={`/projects/${id}`} className="hover:text-primary">{n.name}</Link>{stale ? <Badge tone="warning">deployed before library change</Badge> : <span className="text-xs text-muted">deployed {timeAgo(n.lastDeployment)}</span>}</li>; })}</ul></>}
              <p className="mt-3 text-xs text-muted">Library last changed {timeAgo(names.get(sel)?.lastLocalUpdate)}.</p>
            </div>
          )}
        </Card>
      </div>
      <Card title="Relationships" actions={
        <div className="flex items-center gap-2">
          <Select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Project"><option value="">Project…</option>{data.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</Select>
          <span className="text-xs text-muted">depends on</span>
          <Select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Dependency"><option value="">Library…</option>{data.nodes.filter((n) => n.id !== from).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</Select>
          <Button size="sm" variant="primary" disabled={!from || !to} loading={busy === 'add'} onClick={() => run('add', async () => { await api.post(`/api/projects/${from}/dependencies`, { dependencyId: to }); qc.invalidateQueries({ queryKey: ['dependencies'] }); setFrom(''); setTo(''); }, 'Relationship added')}>Add</Button>
        </div>}>
        <table className="w-full text-sm"><thead className="border-b border-border text-left text-xs text-muted"><tr><th className="px-4 py-2">Project</th><th>Depends on</th><th>Source</th><th>Detail</th><th /></tr></thead>
          <tbody className="divide-y divide-border">{data.edges.map((e) => (
            <tr key={e.id}><td className="px-4 py-2"><Link to={`/projects/${e.projectId}`} className="hover:text-primary">{names.get(e.projectId)?.name}</Link></td><td><Link to={`/projects/${e.dependencyId}`} className="hover:text-primary">{names.get(e.dependencyId)?.name}</Link></td>
              <td><Badge>{SOURCE_LABEL[e.source]}</Badge></td><td className="mono max-w-md truncate text-xs text-muted">{e.version ?? e.detail}</td>
              <td className="pr-3 text-right">{e.source === 'manual' && <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => run('del', async () => { await api.del(`/api/dependencies/${e.id}`); qc.invalidateQueries({ queryKey: ['dependencies'] }); })}><Trash2 className="size-4" /></Button>}</td></tr>))}</tbody></table>
      </Card>
    </div>
  );
}

function collect(id: string, edges: { projectId: string; dependencyId: string }[]) {
  const out = new Set<string>(); const q = [id];
  while (q.length) { const c = q.shift()!; for (const e of edges) if (e.dependencyId === c && !out.has(e.projectId) && e.projectId !== id) { out.add(e.projectId); q.push(e.projectId); } }
  return [...out];
}
