import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, ChevronRight, Clock, Folder, FolderGit2, HardDrive, Home, Loader2, RefreshCw, Star } from 'lucide-react';
import { api, qs } from '../services/api';
import { Badge, Button, Input, Modal, Toggle } from './ui';
import { cx } from '../lib/format';

interface DirEntry { name: string; path: string; isProject: boolean; markers: string[]; registered: boolean }
interface DirListing { path: string; parent: string | null; entries: DirEntry[]; truncated: boolean; scannedAt: string; cached: boolean }
interface Place { label: string; path: string; kind: 'drive' | 'home' | 'recent' | 'project-parent' | 'place' }

const PLACE_ICON: Record<Place['kind'], React.ReactNode> = {
  drive: <HardDrive className="size-4" />, home: <Home className="size-4" />, place: <Folder className="size-4" />, recent: <Clock className="size-4" />, 'project-parent': <Star className="size-4" />,
};

function crumbs(p: string) {
  const win = /^[a-zA-Z]:/.test(p) || p.startsWith('\\\\');
  const sep = win ? '\\' : '/';
  const parts = p.split(/[\\/]/).filter(Boolean);
  const out: { label: string; path: string }[] = [];
  if (!win) out.push({ label: '/', path: '/' });
  let acc = win ? '' : '';
  parts.forEach((part, i) => {
    acc = win ? (i === 0 ? part + sep : acc + (acc.endsWith(sep) ? '' : sep) + part) : acc + '/' + part;
    out.push({ label: part, path: acc });
  });
  return out;
}

/**
 * In-app folder picker backed by the local server (fast, always in front, shows which folders are projects).
 * Listings come from the backend's SQLite cache and refresh in the background.
 */
export function FolderPicker({ open, initial, onClose, onSelect, title = 'Select folder' }: { open: boolean; initial?: string; onClose: () => void; onSelect: (p: string) => void; title?: string }) {
  const [cwd, setCwd] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [hidden, setHidden] = useState(false);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const { data: places } = useQuery({ queryKey: ['fs-roots'], queryFn: () => api.get<Place[]>('/api/fs/roots'), enabled: open, staleTime: 30_000 });
  useEffect(() => {
    if (!open) return;
    setSelected(null); setFilter('');
    const start = initial?.trim() || null;
    setCwd(start); setTyped(start ?? '');
  }, [open, initial]);
  useEffect(() => { if (open && !cwd && places?.length) { const p = places.find((x) => x.kind === 'project-parent') ?? places.find((x) => x.kind === 'recent') ?? places.find((x) => x.kind === 'drive') ?? places[0]; setCwd(p.path); setTyped(p.path); } }, [open, cwd, places]);
  const { data, error, isFetching } = useQuery({
    queryKey: ['fs-list', cwd, hidden], enabled: open && !!cwd,
    queryFn: ({ meta }) => api.get<DirListing>('/api/fs/list' + qs({ path: cwd!, hidden: hidden ? '1' : undefined, fresh: meta?.fresh ? '1' : undefined })),
    staleTime: 5_000, placeholderData: (prev) => prev,
  });
  // Cached listing is shown instantly; then fetch a fresh one from disk and swap it in.
  const qcl = useQueryClient();
  useEffect(() => {
    if (!data?.cached || !cwd) return;
    let alive = true;
    api.get<DirListing>('/api/fs/list' + qs({ path: cwd, hidden: hidden ? '1' : undefined, fresh: '1' })).then((fresh) => { if (alive) qcl.setQueryData(['fs-list', cwd, hidden], fresh); }, () => undefined);
    return () => { alive = false; };
  }, [data?.cached, cwd, hidden, qcl]);
  const go = (p: string) => { setCwd(p); setTyped(p); setSelected(null); setFilter(''); };
  const entries = useMemo(() => (data?.entries ?? []).filter((e) => !filter || e.name.toLowerCase().includes(filter.toLowerCase())), [data, filter]);
  const choose = (p: string) => { void api.post('/api/fs/recent', { path: p }).catch(() => undefined); onSelect(p); onClose(); };
  const target = selected ?? data?.path ?? cwd ?? '';

  return (
    <Modal open={open} onClose={onClose} title={title} wide
      footer={<>
        <span className="mr-auto min-w-0 truncate self-center text-xs text-muted">Selected: <code className="text-fg">{target || '—'}</code></span>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="success" disabled={!target} onClick={() => choose(target)}>Select folder</Button>
      </>}>
      <div className="grid h-[60vh] grid-cols-[200px_minmax(0,1fr)] gap-4">
        <nav className="space-y-3 overflow-y-auto text-sm" aria-label="Places">
          {(['project-parent', 'recent', 'home', 'place', 'drive'] as const).map((k) => {
            const items = places?.filter((p) => p.kind === k) ?? [];
            if (!items.length) return null;
            return (
              <div key={k}>
                <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{{ 'project-parent': 'Project folders', recent: 'Recent', home: 'This PC', place: 'Quick access', drive: 'Drives' }[k]}</div>
                {items.map((p) => (
                  <button key={k + p.path} onClick={() => go(p.path)} title={p.path}
                    className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-surface-2', cwd === p.path && 'bg-surface-2 text-fg')}>
                    <span className="text-muted">{PLACE_ICON[p.kind]}</span><span className="truncate">{k === 'recent' || k === 'project-parent' ? p.label.split(/[\\/]/).filter(Boolean).slice(-2).join(p.label.includes('\\') ? '\\' : '/') : p.label}</span>
                  </button>
                ))}
              </div>
            );
          })}
          {!places && <div className="flex items-center gap-2 text-muted"><Loader2 className="size-4 animate-spin" />Loading…</div>}
        </nav>
        <div className="flex min-h-0 flex-col gap-2">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) go(typed.trim()); }}>
            <Button type="button" size="icon" disabled={!data?.parent} onClick={() => data?.parent && go(data.parent)} aria-label="Up one level"><ArrowUp className="size-4" /></Button>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} className="mono flex-1" placeholder="Type or paste a path, e.g. C:\ProjectX, and press Enter" />
            <Button type="button" size="icon" onClick={() => cwd && api.get<DirListing>('/api/fs/list' + qs({ path: cwd, hidden: hidden ? '1' : undefined, fresh: '1' })).then((f) => qcl.setQueryData(['fs-list', cwd, hidden], f))} aria-label="Refresh">{isFetching ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}</Button>
          </form>
          <div className="flex flex-wrap items-center gap-0.5 text-sm">
            {cwd && crumbs(data?.path ?? cwd).map((c, i, a) => (
              <span key={c.path} className="flex items-center">
                <button onClick={() => go(c.path)} className={cx('rounded px-1.5 py-0.5 hover:bg-surface-2', i === a.length - 1 ? 'font-medium' : 'text-muted')}>{c.label}</button>
                {i < a.length - 1 && <ChevronRight className="size-3.5 text-muted" />}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter folders…" className="w-60" />
            <Toggle checked={hidden} onChange={setHidden} label={<span className="text-xs text-muted">Show hidden</span>} />
            <span className="ml-auto text-xs text-muted">{data ? `${data.entries.length} folders · ${data.entries.filter((e) => e.isProject).length} projects${data.cached ? ' · cached' : ''}` : ''}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
            {error ? <p className="p-4 text-sm text-danger">{(error as Error).message}</p>
              : !data ? <div className="flex items-center gap-2 p-4 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Opening folder…</div>
              : !entries.length ? <p className="p-4 text-sm text-muted">No subfolders here.</p>
              : (
                <ul role="listbox" aria-label="Folders">
                  {entries.map((e) => (
                    <li key={e.path}>
                      <button role="option" aria-selected={selected === e.path} onClick={() => setSelected(e.path)} onDoubleClick={() => go(e.path)}
                        className={cx('flex w-full items-center gap-2 border-b border-border px-3 py-1.5 text-left text-sm last:border-0 hover:bg-surface-2', selected === e.path && 'bg-primary/10')}>
                        {e.isProject ? <FolderGit2 className="size-4 shrink-0 text-success" /> : <Folder className="size-4 shrink-0 text-primary" />}
                        <span className="min-w-0 flex-1 truncate">{e.name}</span>
                        {e.registered && <Badge tone="success">Registered</Badge>}
                        {e.isProject && !e.registered && <span className="hidden text-xs text-muted md:inline">{e.markers.slice(0, 3).join(' · ')}</span>}
                        <span role="button" tabIndex={-1} onClick={(ev) => { ev.stopPropagation(); go(e.path); }} className="rounded p-0.5 text-muted hover:bg-surface hover:text-fg" aria-label={`Open ${e.name}`}><ChevronRight className="size-4" /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            {data?.truncated && <p className="p-2 text-center text-xs text-muted">Showing the first 1000 folders — use the filter.</p>}
          </div>
          <p className="text-xs text-muted">Click to select · double-click or › to open · green folders contain project files.</p>
        </div>
      </div>
    </Modal>
  );
}
