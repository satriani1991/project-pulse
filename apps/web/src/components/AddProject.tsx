import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FolderOpen, Search } from 'lucide-react';
import type { DiscoveredProject, ProjectSummary } from '@pulse/shared';
import { CATEGORIES } from '@pulse/shared';
import { api } from '../services/api';
import { setUi, useUi } from '../stores/ui';
import { Badge, Button, Field, Input, Modal, Select, Toggle, useAction, useToast } from './ui';
import { CATEGORY_LABEL } from '../lib/format';

async function pickFolder(): Promise<string | null> {
  const r = await api.post<{ path: string | null }>('/api/system/pick-folder');
  return r.path;
}

function PathInput({ value, onChange, onPicked, placeholder }: { value: string; onChange: (v: string) => void; onPicked?: (v: string) => void; placeholder?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex gap-2">
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mono" />
      <Button type="button" loading={busy} onClick={async () => {
        setBusy(true);
        try { const p = await pickFolder(); if (p) { onChange(p); onPicked?.(p); } } catch (e) { toast('info', (e as Error).message); } finally { setBusy(false); }
      }}><FolderOpen className="size-4" />Browse</Button>
    </div>
  );
}

interface Form {
  rootPath: string; name: string; category: string; technologies: string; provider: 'firebase' | 'none'; firebaseProjectId: string; hostingSiteId: string; remotePath: string; publicUrl: string; deployDirectory: string;
  monitoringEnabled: boolean; gitEnabled: boolean; deploymentMonitoring: boolean; dev: string; build: string; deploy: string; thumbnailPath?: string; description?: string;
}
const EMPTY: Form = { rootPath: '', name: '', category: 'game', technologies: '', provider: 'none', firebaseProjectId: '', hostingSiteId: '', remotePath: '/', publicUrl: '', deployDirectory: '.', monitoringEnabled: true, gitEnabled: true, deploymentMonitoring: true, dev: '', build: '', deploy: '' };

export function AddProjectDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const open = useUi((s) => s.addProject);
  const [f, setF] = useState<Form>(EMPTY);
  const [inspected, setInspected] = useState(false);
  const { busy, run } = useAction();
  const qc = useQueryClient();
  useEffect(() => { if (open) { setF(EMPTY); setInspected(false); } }, [open]);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const inspect = async (path = f.rootPath) => {
    if (!path.trim()) return;
    const d = await run('inspect', () => api.post<DiscoveredProject>('/api/projects/inspect', { rootPath: path }));
    if (!d) return;
    setInspected(true);
    set({
      rootPath: d.rootPath, name: d.name, category: d.category, technologies: d.technologies.join(', '), description: d.description, thumbnailPath: d.thumbnailPath,
      provider: d.deployment?.provider ?? 'none', firebaseProjectId: d.deployment?.firebaseProjectId ?? '', hostingSiteId: d.deployment?.hostingSiteId ?? '',
      remotePath: d.deployment?.remotePath ?? '/', publicUrl: d.deployment?.publicUrl ?? '', deployDirectory: d.deployment?.deployDirectory ?? '.',
      dev: d.commands.dev ?? '', build: d.commands.build ?? '', deploy: d.commands.deploy ?? '',
    });
  };
  const submit = async () => {
    const p = await run('create', () => api.post<ProjectSummary>('/api/projects', {
      rootPath: f.rootPath, name: f.name || undefined, category: f.category, description: f.description, thumbnailPath: f.thumbnailPath,
      technologies: f.technologies.split(',').map((t) => t.trim()).filter(Boolean),
      monitoringEnabled: f.monitoringEnabled, gitEnabled: f.gitEnabled, deploymentMonitoring: f.deploymentMonitoring,
      commands: { dev: f.dev || undefined, build: f.build || undefined, deploy: f.deploy || undefined },
      deployment: f.provider === 'firebase' ? { provider: 'firebase', firebaseProjectId: f.firebaseProjectId, hostingSiteId: f.hostingSiteId, remotePath: f.remotePath, publicUrl: f.publicUrl, deployDirectory: f.deployDirectory } : { provider: 'none' },
    }), 'Project registered — scanning files…');
    if (p) { setUi({ addProject: false }); qc.invalidateQueries(); onCreated(p.id); }
  };
  return (
    <Modal open={open} onClose={() => setUi({ addProject: false })} title="Add new project" wide
      footer={<><Button onClick={() => setUi({ addProject: false })}>Cancel</Button><Button variant="success" loading={busy === 'create'} disabled={!f.rootPath} onClick={submit}>Register Project</Button></>}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Local directory" className="md:col-span-2" hint="Absolute path, e.g. C:\ProjectX\TKA — metadata is detected automatically.">
          <div className="flex gap-2">
            <div className="flex-1"><PathInput value={f.rootPath} onChange={(v) => set({ rootPath: v })} onPicked={(v) => inspect(v)} placeholder="C:\ProjectX\TKA" /></div>
            <Button loading={busy === 'inspect'} onClick={() => inspect()}><Search className="size-4" />Detect</Button>
          </div>
        </Field>
        <Field label="Project name"><Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="The Knight Avatar" /></Field>
        <Field label="Project category"><Select value={f.category} onChange={(e) => set({ category: e.target.value })} className="w-full">{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select></Field>
        <Field label="Technology" className="md:col-span-2" hint="Comma separated"><Input value={f.technologies} onChange={(e) => set({ technologies: e.target.value })} placeholder="HTML5 Canvas, JavaScript, Firebase" /></Field>
      </div>
      <h3 className="mt-5 mb-2 text-sm font-semibold">Deployment configuration</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Deployment provider"><Select value={f.provider} onChange={(e) => set({ provider: e.target.value as Form['provider'] })} className="w-full"><option value="none">None (local only)</option><option value="firebase">Firebase Hosting</option></Select></Field>
        {f.provider === 'firebase' && <>
          <Field label="Firebase project ID"><Input value={f.firebaseProjectId} onChange={(e) => set({ firebaseProjectId: e.target.value })} placeholder="ps-action" /></Field>
          <Field label="Hosting site ID" hint="Usually the same as the project ID"><Input value={f.hostingSiteId} onChange={(e) => set({ hostingSiteId: e.target.value })} placeholder="ps-action" /></Field>
          <Field label="Remote path on the site" hint="Where this project's files live, e.g. /games/tka/"><Input value={f.remotePath} onChange={(e) => set({ remotePath: e.target.value })} className="mono" /></Field>
          <Field label="Local deploy directory" hint="Relative to the project root (. for vanilla games, dist for builds)"><Input value={f.deployDirectory} onChange={(e) => set({ deployDirectory: e.target.value })} className="mono" /></Field>
          <Field label="Hosting URL"><Input value={f.publicUrl} onChange={(e) => set({ publicUrl: e.target.value })} placeholder="https://ps-action.web.app/games/tka/" /></Field>
        </>}
      </div>
      <h3 className="mt-5 mb-2 text-sm font-semibold">Commands <span className="font-normal text-muted">— leave empty when not needed (vanilla games need no build)</span></h3>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Dev" hint="@static = built-in static server"><Input value={f.dev} onChange={(e) => set({ dev: e.target.value })} className="mono" placeholder="npm run dev" /></Field>
        <Field label="Build"><Input value={f.build} onChange={(e) => set({ build: e.target.value })} className="mono" placeholder="npm run build" /></Field>
        <Field label="Deploy"><Input value={f.deploy} onChange={(e) => set({ deploy: e.target.value })} className="mono" placeholder="firebase deploy --only hosting" /></Field>
      </div>
      <h3 className="mt-5 mb-2 text-sm font-semibold">Monitoring options</h3>
      <div className="flex flex-wrap gap-5">
        <Toggle checked={f.monitoringEnabled} onChange={(v) => set({ monitoringEnabled: v })} label="Real-time file monitoring" />
        <Toggle checked={f.gitEnabled} onChange={(v) => set({ gitEnabled: v })} label="Git monitoring" />
        <Toggle checked={f.deploymentMonitoring} onChange={(v) => set({ deploymentMonitoring: v })} label="Deployment monitoring" />
      </div>
      {inspected && f.thumbnailPath && <p className="mt-4 text-xs text-muted">Thumbnail detected: <code>{f.thumbnailPath}</code></p>}
    </Modal>
  );
}

export function DiscoverDialog() {
  const open = useUi((s) => s.discover);
  const [root, setRoot] = useState('');
  const [depth, setDepth] = useState(2);
  const [items, setItems] = useState<DiscoveredProject[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const { busy, run } = useAction();
  const toast = useToast();
  const qc = useQueryClient();
  useEffect(() => { if (open) { setItems(null); setSel(new Set()); } }, [open]);
  const scan = async (path = root) => {
    const r = await run('scan', () => api.post<DiscoveredProject[]>('/api/projects/discover', { rootPath: path, maxDepth: depth }));
    if (r) { setItems(r); setSel(new Set(r.filter((x) => !x.alreadyRegistered && !x.nested).map((x) => x.rootPath))); }
  };
  const register = async () => {
    const chosen = items!.filter((i) => sel.has(i.rootPath));
    const r = await run('reg', () => api.post<{ created: string[]; errors: { rootPath: string; error: string }[] }>('/api/projects/bulk', {
      projects: chosen.map((c) => ({ rootPath: c.rootPath, name: c.name, category: c.category, technologies: c.technologies, commands: c.commands, description: c.description, thumbnailPath: c.thumbnailPath,
        deployment: c.deployment ? { provider: c.deployment.provider, firebaseProjectId: c.deployment.firebaseProjectId, hostingSiteId: c.deployment.hostingSiteId, remotePath: c.deployment.remotePath, publicUrl: c.deployment.publicUrl, deployDirectory: c.deployment.deployDirectory } : undefined })),
    }));
    if (r) {
      toast(r.errors.length ? 'error' : 'success', `Registered ${r.created.length} project(s)${r.errors.length ? `, ${r.errors.length} failed: ${r.errors[0].error}` : ''}`);
      qc.invalidateQueries(); setUi({ discover: false });
    }
  };
  const toggle = (p: string) => setSel((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  return (
    <Modal open={open} onClose={() => setUi({ discover: false })} title="Bulk project discovery" wide
      footer={<><Button onClick={() => setUi({ discover: false })}>Cancel</Button><Button variant="success" disabled={!sel.size} loading={busy === 'reg'} onClick={register}>Register {sel.size} project(s)</Button></>}>
      <p className="mb-3 text-sm text-muted">Select a parent directory. Subfolders containing <code>package.json</code>, <code>index.html</code>, <code>firebase.json</code>, <code>.git</code>, <code>go.mod</code>, <code>README.md</code> or <code>pulse.json</code> are detected. Review before registering.</p>
      <div className="flex gap-2">
        <div className="flex-1"><PathInput value={root} onChange={setRoot} onPicked={(p) => scan(p)} placeholder="C:\ProjectX" /></div>
        <Select value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="Depth">{[1, 2, 3, 4].map((d) => <option key={d} value={d}>Depth {d}</option>)}</Select>
        <Button variant="primary" loading={busy === 'scan'} disabled={!root} onClick={() => scan()}><Search className="size-4" />Scan</Button>
      </div>
      {items && (
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          {items.length === 0 && <p className="p-4 text-sm text-muted">No projects found.</p>}
          {items.map((i) => (
            <label key={i.rootPath} className="flex cursor-pointer items-start gap-3 border-b border-border px-3 py-2.5 last:border-0 hover:bg-surface-2">
              <input type="checkbox" className="mt-1 accent-[var(--pp-success)]" disabled={i.alreadyRegistered} checked={sel.has(i.rootPath)} onChange={() => toggle(i.rootPath)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{i.name}</span><Badge>{CATEGORY_LABEL[i.category]}</Badge>
                  {i.nested && <Badge tone="library">Nested</Badge>}{i.alreadyRegistered && <Badge tone="success">Registered</Badge>}{i.deployment?.hostingSiteId && <Badge tone="primary">Firebase · {i.deployment.hostingSiteId}{i.deployment.remotePath !== '/' ? ` ${i.deployment.remotePath}` : ''}</Badge>}</div>
                <div className="mono truncate text-xs text-muted">{i.rootPath}</div>
                <div className="text-xs text-muted">{i.technologies.join(' · ')} {i.markers.length > 0 && `· markers: ${i.markers.join(', ')}`}</div>
              </div>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}
