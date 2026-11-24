import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown, ExternalLink, Monitor, Moon, Plus, Settings2, Sun } from 'lucide-react';
import { useWorkspaces } from '../hooks/queries';
import { api } from '../services/api';
import { WORKSPACE_ID, forgetWorkspace, openWorkspaceInNewTab, switchWorkspace } from '../stores/workspace';
import { adoptWorkspaceTheme, setUi, useUi, type ThemeMode } from '../stores/ui';
import { Button, Input, useToast } from './ui';
import { cx } from '../lib/format';

export function useCurrentWorkspace() {
  const { data } = useWorkspaces();
  return data?.find((w) => w.id === WORKSPACE_ID);
}

/** Sidebar workspace switcher. Each browser/tab keeps its own active workspace. */
export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { data, isSuccess } = useWorkspaces();
  const current = data?.find((w) => w.id === WORKSPACE_ID);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  useEffect(() => { if (isSuccess && !current) forgetWorkspace(); }, [isSuccess, current]);
  useEffect(() => { if (current) { adoptWorkspaceTheme(current.theme); document.title = `PROJECT PULSE · ${current.name}`; } }, [current]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, []);
  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try { const ws = await api.post<{ id: string }>('/api/workspaces', { name }); qc.invalidateQueries({ queryKey: ['workspaces'] }); switchWorkspace(ws.id); }
    catch (e) { toast('error', (e as Error).message); setCreating(false); }
  };
  return (
    <div ref={ref} className="relative border-b border-border p-2">
      <button onClick={() => setOpen(!open)} title={collapsed ? `Workspace: ${current?.name ?? ''}` : undefined}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-bg px-2 text-left text-sm hover:border-muted" aria-haspopup="listbox" aria-expanded={open}>
        <span className="size-3 shrink-0 rounded-full" style={{ background: current?.color ?? 'var(--pp-muted)' }} />
        {!collapsed && <><span className="min-w-0 flex-1"><span className="block text-[10px] leading-3 text-muted uppercase">Workspace</span><span className="block truncate font-medium">{current?.name ?? '…'}</span></span><ChevronsUpDown className="size-4 text-muted" /></>}
      </button>
      {open && (
        <div className="absolute top-full left-2 z-50 mt-1 w-72 overflow-hidden rounded-lg border border-border bg-surface shadow-2xl">
          <ul className="max-h-72 overflow-y-auto py-1" role="listbox">
            {data?.map((w) => (
              <li key={w.id} className="group flex items-center gap-1 px-1">
                <button role="option" aria-selected={w.id === WORKSPACE_ID} onClick={() => (w.id === WORKSPACE_ID ? setOpen(false) : switchWorkspace(w.id))}
                  className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2">
                  <span className="size-3 shrink-0 rounded-full" style={{ background: w.color }} />
                  <span className="flex-1 truncate">{w.name}</span>
                  <span className="text-xs text-muted">{w.projectCount}</span>
                  {w.id === WORKSPACE_ID && <Check className="size-4 text-success" />}
                </button>
                <button onClick={() => openWorkspaceInNewTab(w.id)} className="rounded-md p-1.5 text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-fg" title="Open in a new tab" aria-label={`Open ${w.name} in a new tab`}><ExternalLink className="size-3.5" /></button>
              </li>
            ))}
          </ul>
          <form className="flex gap-1.5 border-t border-border p-2" onSubmit={(e) => { e.preventDefault(); create(); }}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New workspace, e.g. Office" />
            <Button type="submit" variant="success" size="icon" loading={creating} disabled={!name.trim()} aria-label="Create workspace"><Plus className="size-4" /></Button>
          </form>
          <button onClick={() => { setOpen(false); nav('/settings#workspaces'); }} className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-xs text-muted hover:bg-surface-2 hover:text-fg"><Settings2 className="size-3.5" />Manage workspaces</button>
        </div>
      )}
    </div>
  );
}

const MODES: { id: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { id: 'light', label: 'Light', icon: <Sun className="size-3.5" /> },
  { id: 'dark', label: 'Dark', icon: <Moon className="size-3.5" /> },
  { id: 'system', label: 'System', icon: <Monitor className="size-3.5" /> },
];

/** Dark / light / system theme changer. The choice is saved for the current workspace. */
export function ThemeSwitcher({ withLabels }: { withLabels?: boolean }) {
  const theme = useUi((s) => s.theme);
  const qc = useQueryClient();
  const set = (t: ThemeMode) => {
    setUi({ theme: t });
    api.patch(`/api/workspaces/${encodeURIComponent(WORKSPACE_ID)}`, { theme: t }).then(() => qc.invalidateQueries({ queryKey: ['workspaces'] }), () => undefined);
  };
  return (
    <div className="inline-flex rounded-md border border-border bg-bg p-0.5" role="radiogroup" aria-label="Theme">
      {MODES.map((m) => (
        <button key={m.id} role="radio" aria-checked={theme === m.id} title={`${m.label} theme`} onClick={() => set(m.id)}
          className={cx('flex h-7 items-center gap-1.5 rounded px-2 text-xs', theme === m.id ? 'bg-surface-2 text-fg shadow-sm' : 'text-muted hover:text-fg')}>
          {m.icon}{withLabels && m.label}
        </button>
      ))}
    </div>
  );
}
