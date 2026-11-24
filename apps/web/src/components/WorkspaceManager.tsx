import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useWorkspaces, type WorkspaceInfo } from '../hooks/queries';
import { api } from '../services/api';
import { WORKSPACE_ID, openWorkspaceInNewTab, switchWorkspace } from '../stores/workspace';
import { Badge, Button, Card, Input, Loading, Select, useAction } from './ui';

/** Create, rename, recolour, theme and delete workspaces (Settings page). */
export function WorkspaceManager() {
  const { data } = useWorkspaces();
  const [name, setName] = useState('');
  const { busy, run } = useAction();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['workspaces'] });
  return (
    <Card title="Workspaces" subtitle="Separate project sets — e.g. Private and Office. Each browser or tab chooses its own workspace; open one in another browser to work in both at once.">
      <div id="workspaces" className="divide-y divide-border">
        {!data ? <Loading /> : data.map((w) => <Row key={w.id} w={w} onChange={refresh} />)}
      </div>
      <form className="flex gap-2 border-t border-border p-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) run('c', async () => { await api.post('/api/workspaces', { name }); setName(''); refresh(); }, 'Workspace created'); }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New workspace name (e.g. Office)" className="max-w-xs" />
        <Button type="submit" variant="success" loading={busy === 'c'} disabled={!name.trim()}><Plus className="size-4" />Create workspace</Button>
      </form>
      <p className="px-4 pb-4 text-xs text-muted">Tip: bookmark <code>http://127.0.0.1:7700/?ws=&lt;id&gt;</code> in each browser. Workspaces have their own projects, settings, activity, tasks, notifications and backups. Deleting a workspace never touches your project folders.</p>
    </Card>
  );
}

function Row({ w, onChange }: { w: WorkspaceInfo; onChange: () => void }) {
  const [name, setName] = useState(w.name);
  const { busy, run } = useAction();
  const patch = (body: Partial<WorkspaceInfo>) => run('p', async () => { await api.patch(`/api/workspaces/${w.id}`, body); onChange(); });
  const remove = () => {
    if (!confirm(`Remove workspace "${w.name}" from Project Pulse? Its ${w.projectCount} registered project(s) will no longer be monitored. Project folders are not touched.`)) return;
    const purge = confirm('Also delete this workspace\'s dashboard data (history, notes, tasks, backups)?\n\nOK = delete data · Cancel = keep the data folder');
    run('d', async () => { await api.del(`/api/workspaces/${w.id}${purge ? '?purge=1' : ''}`); if (w.id === WORKSPACE_ID) switchWorkspace('default'); else onChange(); }, 'Workspace removed');
  };
  const current = w.id === WORKSPACE_ID;
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <input type="color" value={w.color} onChange={(e) => patch({ color: e.target.value })} className="size-8 cursor-pointer rounded border border-border bg-transparent" aria-label={`${w.name} colour`} />
      <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== w.name && patch({ name })} className="w-48" aria-label="Workspace name" />
      <code className="text-xs text-muted">{w.id}</code>
      <span className="text-xs text-muted">{w.projectCount} project(s)</span>
      {current && <Badge tone="success">This tab</Badge>}
      <span className="ml-auto flex items-center gap-2">
        <Select value={w.theme} onChange={(e) => patch({ theme: e.target.value as WorkspaceInfo['theme'] })} aria-label="Default theme">
          <option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option>
        </Select>
        {!current && <Button size="sm" onClick={() => switchWorkspace(w.id)}>Switch</Button>}
        <Button size="sm" variant="ghost" onClick={() => openWorkspaceInNewTab(w.id)}><ExternalLink className="size-3.5" />New tab</Button>
        {w.id !== 'default' && <Button size="icon" variant="ghost" loading={busy === 'd'} onClick={remove} aria-label={`Delete ${w.name}`}><Trash2 className="size-4" /></Button>}
      </span>
    </div>
  );
}
