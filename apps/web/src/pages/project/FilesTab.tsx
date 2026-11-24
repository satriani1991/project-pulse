import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, File, Folder } from 'lucide-react';
import type { ProjectSummary } from '@pulse/shared';
import { api, qs, rawUrl } from '../../services/api';
import { Badge, Card, Empty, Input, Loading, Select } from '../../components/ui';
import { bytes, cx, dateTime, timeAgo } from '../../lib/format';

interface F { path: string; size: number; modifiedAt: string; kind: string; deploy: boolean; build: boolean }
interface Node { name: string; path: string; dirs: Map<string, Node>; files: F[]; size: number; count: number }

function buildTree(files: F[]): Node {
  const root: Node = { name: '', path: '', dirs: new Map(), files: [], size: 0, count: 0 };
  for (const f of files) {
    const parts = f.path.split('/');
    let n = root;
    n.size += f.size; n.count++;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts.slice(0, i + 1).join('/');
      if (!n.dirs.has(parts[i])) n.dirs.set(parts[i], { name: parts[i], path: p, dirs: new Map(), files: [], size: 0, count: 0 });
      n = n.dirs.get(parts[i])!; n.size += f.size; n.count++;
    }
    n.files.push(f);
  }
  return root;
}

function TreeNode({ node, depth, open, toggle, sel, onSel, recent }: { node: Node; depth: number; open: Set<string>; toggle: (p: string) => void; sel?: string; onSel: (f: F) => void; recent: Map<string, string> }) {
  return (
    <>
      {[...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name)).map((d) => (
        <div key={d.path}>
          <button onClick={() => toggle(d.path)} className="flex w-full items-center gap-1.5 px-2 py-0.5 text-left text-sm hover:bg-surface-2" style={{ paddingLeft: 8 + depth * 14 }}>
            {open.has(d.path) ? <ChevronDown className="size-3.5 text-muted" /> : <ChevronRight className="size-3.5 text-muted" />}<Folder className="size-3.5 text-primary" /><span className="flex-1 truncate">{d.name}</span><span className="text-xs text-muted">{d.count} · {bytes(d.size)}</span>
          </button>
          {open.has(d.path) && <TreeNode node={d} depth={depth + 1} open={open} toggle={toggle} sel={sel} onSel={onSel} recent={recent} />}
        </div>
      ))}
      {node.files.sort((a, b) => a.path.localeCompare(b.path)).map((f) => (
        <button key={f.path} onClick={() => onSel(f)} className={cx('flex w-full items-center gap-1.5 px-2 py-0.5 text-left text-sm hover:bg-surface-2', sel === f.path && 'bg-primary/10 text-primary')} style={{ paddingLeft: 26 + depth * 14 }}>
          <File className="size-3.5 shrink-0 text-muted" /><span className="flex-1 truncate">{f.path.split('/').pop()}</span>
          {recent.has(f.path) && <span className="size-1.5 rounded-full bg-warning" title={`Changed ${timeAgo(recent.get(f.path))}`} />}
          {f.build && <Badge className="!py-0 text-[10px]">build</Badge>}<span className="text-xs text-muted">{bytes(f.size)}</span>
        </button>
      ))}
    </>
  );
}

export function FilesTab({ p, initialFile }: { p: ProjectSummary; initialFile?: string }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [sel, setSel] = useState<string | undefined>(initialFile);
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialFile ? initialFile.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/')) : []));
  const { data } = useQuery({ queryKey: ['files', p.id, q, kind], queryFn: () => api.get<{ files: F[]; recent: { path: string; change: string; at: string }[] }>(`/api/projects/${p.id}/files` + qs({ q, kind })) });
  const tree = useMemo(() => buildTree(data?.files ?? []), [data]);
  const recent = useMemo(() => new Map((data?.recent ?? []).map((r) => [r.path, r.at])), [data]);
  const toggle = (path: string) => setOpen((s) => { const n = new Set(s); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  const file = data?.files.find((f) => f.path === sel);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(320px,440px)_1fr]">
      <Card>
        <div className="flex gap-2 border-b border-border p-2">
          <Input value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value) setOpen(new Set(['*'])); }} placeholder="Search files…" />
          <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind"><option value="">All</option><option value="source">Source</option><option value="asset">Assets</option><option value="doc">Docs</option><option value="config">Config</option><option value="build">Build output</option></Select>
        </div>
        <div className="max-h-[70vh] overflow-y-auto py-1">
          {!data ? <Loading /> : !data.files.length ? <Empty title="No files" /> :
            q ? data.files.slice(0, 500).map((f) => <button key={f.path} onClick={() => setSel(f.path)} className={cx('mono block w-full truncate px-3 py-0.5 text-left text-xs hover:bg-surface-2', sel === f.path && 'text-primary')}>{f.path}</button>)
              : <TreeNode node={tree} depth={0} open={open} toggle={toggle} sel={sel} onSel={(f) => setSel(f.path)} recent={recent} />}
        </div>
        <div className="border-t border-border px-3 py-1.5 text-xs text-muted">{data?.files.length.toLocaleString()} monitored files · excluded: node_modules, .git, dist/build (unless deployable), temp, logs, secrets</div>
      </Card>
      <Card title={sel ? <span className="mono text-sm">{sel}</span> : 'File viewer'} subtitle={file && `${bytes(file.size)} · modified ${dateTime(file.modifiedAt)} · ${file.kind}${file.deploy ? ' · deployable' : ''}`}>
        {sel ? <Viewer projectId={p.id} path={sel} kind={file?.kind} /> : <Empty title="Select a file">Browse the monitored file inventory on the left. Secrets such as <code>.env</code> are never shown.</Empty>}
      </Card>
    </div>
  );
}

function Viewer({ projectId, path, kind }: { projectId: string; path: string; kind?: string }) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'].includes(ext);
  const isAudio = ['mp3', 'wav', 'ogg', 'm4a'].includes(ext);
  const { data, error } = useQuery({ queryKey: ['file', projectId, path], enabled: !isImg && !isAudio && kind !== 'asset', queryFn: () => api.get<{ content: string; binary: boolean; truncated: boolean }>(`/api/projects/${projectId}/file` + qs({ path })) });
  if (isImg) return <div className="checker m-4 flex justify-center rounded-lg border border-border p-3"><img src={rawUrl(projectId, path)} alt={path} className="max-h-[65vh] max-w-full" /></div>;
  if (isAudio) return <div className="p-4"><audio controls src={rawUrl(projectId, path)} className="w-full" /></div>;
  if (kind === 'asset') return <p className="p-4 text-sm text-muted">Binary asset — open it in the Assets tab for a preview.</p>;
  if (error) return <p className="p-4 text-sm text-danger">{(error as Error).message}</p>;
  if (!data) return <Loading />;
  if (data.binary) return <p className="p-4 text-sm text-muted">Binary file — no preview.</p>;
  const lines = data.content.split('\n');
  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="mono w-full text-xs leading-5"><tbody>{lines.map((l, i) => <tr key={i}><td className="w-12 select-none pr-3 text-right align-top text-muted/60">{i + 1}</td><td className="pr-4 whitespace-pre">{l}</td></tr>)}</tbody></table>
      {data.truncated && <p className="p-3 text-xs text-muted">File truncated at 512 KB.</p>}
    </div>
  );
}
