import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, AppWindow, Archive, BarChart3, Bell, Boxes, CloudUpload, FolderKanban, Gamepad2, Image, LayoutDashboard, Library, ListTodo, PanelLeftClose, PanelLeftOpen, Plus, Search, Server, Settings, Network, Wifi, WifiOff } from 'lucide-react';
import { useLiveUpdates } from '../hooks/useLive';
import { useNotifications, useOverview } from '../hooks/queries';
import { setUi, useUi } from '../stores/ui';
import { onConnection } from '../services/socket';
import { Button } from '../components/ui';
import { AddProjectDialog, DiscoverDialog } from '../components/AddProject';
import { CommandPalette } from '../components/CommandPalette';
import { NotificationsPanel } from '../components/Notifications';
import { DeployDialog } from '../components/DeployDialog';
import { cx } from '../lib/format';
import { ThemeSwitcher, WorkspaceSwitcher, useCurrentWorkspace } from '../components/Workspace';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'All Projects', icon: FolderKanban, end: true },
  { to: '/projects/category/game', label: 'Game Projects', icon: Gamepad2 },
  { to: '/projects/category/library', label: 'Libraries', icon: Library },
  { to: '/projects/category/application', label: 'Applications', icon: AppWindow },
  { to: '/deployments', label: 'Deployments', icon: CloudUpload, badge: 'deploy' },
  { to: '/activity', label: 'Activity Timeline', icon: Activity },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/assets', label: 'Asset Manager', icon: Image },
  { to: '/dependencies', label: 'Dependencies', icon: Network },
  { to: '/tasks', label: 'Tasks & Roadmap', icon: ListTodo },
  { to: '/servers', label: 'Dev Servers', icon: Server, badge: 'proc' },
  { to: '/archive', label: 'Archive', icon: Archive },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppLayout() {
  useLiveUpdates();
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const ws = useCurrentWorkspace();
  const { data: ov } = useOverview();
  const { data: notes } = useNotifications();
  const unread = notes?.filter((n) => !n.readAt).length ?? 0;
  const [online, setOnline] = useState(true);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => onConnection(setOnline), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setUi({ palette: true }); }
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); setUi({ palette: true }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const title = NAV.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)))?.label ?? (loc.pathname.startsWith('/projects/') ? 'Project' : '');

  return (
    <div className="flex h-full">
      <aside className={cx('flex shrink-0 flex-col border-r border-border bg-surface transition-[width]', collapsed ? 'w-14' : 'w-60')}>
        <div className="flex h-14 items-center gap-2 border-b border-border px-3">
          <svg viewBox="0 0 32 32" className="size-7 shrink-0"><rect width="32" height="32" rx="7" fill="var(--pp-bg)" /><path d="M4 17h6l3-8 5 15 3-7h7" fill="none" stroke="var(--pp-success)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {!collapsed && <div className="leading-tight"><div className="text-sm font-bold tracking-wide">PROJECT PULSE</div><div className="text-[11px] text-muted">Local command center</div></div>}
        </div>
        <WorkspaceSwitcher collapsed={collapsed} />
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} title={collapsed ? n.label : undefined}
              className={({ isActive }) => cx('flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm', isActive ? 'bg-surface-2 font-medium text-fg shadow-[inset_2px_0_0_var(--pp-warning)]' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
              <n.icon className="size-4 shrink-0" />
              {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
              {!collapsed && n.badge === 'deploy' && !!ov?.needsDeployment && <span className="rounded-full bg-warning/15 px-1.5 text-xs text-warning">{ov.needsDeployment}</span>}
              {!collapsed && n.badge === 'proc' && !!ov?.runningProcesses && <span className="rounded-full bg-success/15 px-1.5 text-xs text-success">{ov.runningProcesses}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-1 border-t border-border p-2">
          <Button variant="ghost" size="icon" onClick={() => setUi({ sidebarCollapsed: !collapsed })} aria-label="Toggle sidebar">{collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</Button>
          {!collapsed && <span className={cx('ml-auto flex items-center gap-1 text-xs', online ? 'text-success' : 'text-danger')} title={online ? 'Live updates connected' : 'Backend unreachable — retrying'}>{online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}{online ? 'Live' : 'Offline'}</span>}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-5" style={{ boxShadow: ws ? `inset 0 3px 0 ${ws.color}` : undefined }}>
          <div className="truncate text-sm text-muted"><span style={{ color: ws?.color }} className="font-medium">{ws?.name ?? 'Workspace'}</span> / <span className="text-fg">{title || 'Overview'}</span></div>
          <button onClick={() => setUi({ palette: true })} className="ml-auto flex h-8 w-80 items-center gap-2 overflow-hidden rounded-md border border-border bg-bg px-2.5 text-sm whitespace-nowrap text-muted hover:border-muted">
            <Search className="size-4" /> Search projects, files, tasks… <kbd className="ml-auto rounded border border-border px-1 text-[10px]">Ctrl K</kbd>
          </button>
          <ThemeSwitcher />
          <Button variant="ghost" size="icon" className="relative" onClick={() => setUi({ notifications: true })} aria-label="Notifications">
            <Bell className="size-4" />{unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-danger px-1 text-[10px] leading-4 text-white">{unread > 99 ? '99+' : unread}</span>}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setUi({ discover: true })}><Boxes className="size-4" />Discover</Button>
          <Button variant="success" onClick={() => setUi({ addProject: true })}><Plus className="size-4" />Add Project</Button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-[1600px] p-5"><Outlet /></div></main>
      </div>

      <AddProjectDialog onCreated={(id) => nav(`/projects/${id}`)} />
      <DiscoverDialog />
      <CommandPalette />
      <NotificationsPanel />
      <DeployDialog />
    </div>
  );
}
