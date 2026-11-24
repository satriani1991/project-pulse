import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, FolderGit2, ListTodo, NotebookPen, CornerDownLeft } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../services/api';
import { setUi, useUi } from '../stores/ui';
import { useProjects } from '../hooks/queries';
import { cx } from '../lib/format';

type Hit = { key: string; label: string; sub?: string; icon: React.ReactNode; go: () => void };

export function CommandPalette() {
  const open = useUi((s) => s.palette);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const nav = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const { data: projects } = useProjects();
  const { data: res } = useQuery({ queryKey: ['search', q], enabled: open && q.length >= 2, queryFn: () => api.get<{ projects: unknown[]; files: { projectId: string; projectName: string; path: string }[]; tasks: { id: number; projectId: string; title: string }[]; notes: { id: number; projectId: string; title: string }[] }>('/api/search' + qs({ q })) });
  useEffect(() => { if (open) { setQ(''); setIdx(0); setTimeout(() => input.current?.focus(), 10); } }, [open]);
  const close = () => setUi({ palette: false });
  const hits = useMemo<Hit[]>(() => {
    const lq = q.toLowerCase();
    const pages = [['Overview', '/'], ['All Projects', '/projects'], ['Deployments', '/deployments'], ['Activity Timeline', '/activity'], ['Analytics', '/analytics'], ['Asset Manager', '/assets'], ['Dependencies', '/dependencies'], ['Tasks & Roadmap', '/tasks'], ['Dev Servers', '/servers'], ['Archive', '/archive'], ['Settings', '/settings']]
      .filter(([l]) => !q || l.toLowerCase().includes(lq)).map(([l, to]) => ({ key: 'page' + to, label: l, sub: 'Page', icon: <CornerDownLeft className="size-4" />, go: () => nav(to) }));
    const ps = (projects ?? []).filter((p) => !q || p.name.toLowerCase().includes(lq) || p.rootPath.toLowerCase().includes(lq)).slice(0, 8)
      .map((p) => ({ key: 'p' + p.id, label: p.name, sub: p.rootPath, icon: <FolderGit2 className="size-4" />, go: () => nav(`/projects/${p.id}`) }));
    const fs = (res?.files ?? []).slice(0, 10).map((f) => ({ key: 'f' + f.projectId + f.path, label: f.path, sub: f.projectName, icon: <FileText className="size-4" />, go: () => nav(`/projects/${f.projectId}?tab=files&file=${encodeURIComponent(f.path)}`) }));
    const ts = (res?.tasks ?? []).map((t) => ({ key: 't' + t.id, label: t.title, sub: 'Task', icon: <ListTodo className="size-4" />, go: () => nav(t.projectId ? `/projects/${t.projectId}?tab=tasks` : '/tasks') }));
    const ns = (res?.notes ?? []).map((n) => ({ key: 'n' + n.id, label: n.title, sub: 'Note', icon: <NotebookPen className="size-4" />, go: () => nav(`/projects/${n.projectId}?tab=notes`) }));
    return [...ps, ...fs, ...ts, ...ns, ...pages].slice(0, 30);
  }, [q, projects, res, nav]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[12vh]" onClick={close}>
      <div className="w-[640px] max-w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} placeholder="Search projects, files, tasks, notes, pages…"
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, hits.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
            if (e.key === 'Enter' && hits[idx]) { hits[idx].go(); close(); }
          }}
          className="h-12 w-full border-b border-border bg-transparent px-4 text-base outline-none" />
        <ul className="max-h-96 overflow-y-auto p-1">
          {hits.map((h, i) => (
            <li key={h.key}><button onMouseEnter={() => setIdx(i)} onClick={() => { h.go(); close(); }} className={cx('flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm', i === idx && 'bg-surface-2')}>
              <span className="text-muted">{h.icon}</span><span className="min-w-0 flex-1 truncate">{h.label}</span><span className="max-w-[45%] truncate text-xs text-muted">{h.sub}</span>
            </button></li>
          ))}
          {!hits.length && <li className="px-3 py-6 text-center text-sm text-muted">No results</li>}
        </ul>
      </div>
    </div>
  );
}
