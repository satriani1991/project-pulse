import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, Search } from 'lucide-react';
import type { DiscoveredProject, ProjectSummary } from '@pulse/shared';
import { CATEGORIES } from '@pulse/shared';
import { api } from '../services/api';
import { setUi, useUi } from '../stores/ui';
import { Badge, Button, Field, Input, Modal, Select, Toggle, useAction, useToast } from './ui';
import { FolderPicker } from './FolderPicker';
import { subscribe } from '../services/socket';
import { CATEGORY_LABEL } from '../lib/format';

function PathInput({ value, onChange, onPicked, placeholder, title }: { value: string; onChange: (v: string) => void; onPicked?: (v: string) => void; placeholder?: string; title?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex gap-2">
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mono flex-1" />
      <Button type="button" onClick={() => setOpen(true)}><FolderOpen className="size-4" />Browse</Button>
      <FolderPicker open={open} initial={value} title={title} onClose={() => setOpen(false)} onSelect={(p) => { onChange(p); onPicked?.(p); }} />
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
            <div className="flex-1"><PathInput value={f.rootPath} onChange={(v) => set({ rootPath: v })} onPicked={(v) => inspect(v)} placeholder="C:\ProjectX\TKA" title="Select project folder" /></div>
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

interface DiscoveryJob { id: string; rootPath: string; maxDepth: number; status: 'running' | 'done' | 'cancelled' | 'failed'; dirsScanned: number; found: number; current?: string; error?: string; results: DiscoveredProject[] }

/** Bulk discovery runs as a backend job; results are stored in SQLite and streamed into this list. */
export function DiscoverDialog() {
  const open = useUi((s) => s.discover);
  const [root, setRoot] = useState('');
  const [depth, setDepth] = useState(2);
  const [jobId, setJobId] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState(false);
  const { busy, run } = useAction();
  const toast = useToast();
  const qc = useQueryClient();
  // Re-open: show the last discovery from the database instantly
  const { data: latest } = useQuery({ queryKey: ['discovery-latest'], enabled: open, queryFn: () => api.get<DiscoveryJob | null>('/api/discovery/latest'), staleTime: 0 });
  useEffect(() => { if (open && latest && !jobId) { setJobId(latest.id); setRoot((r) => r || latest.rootPath); setDepth(latest.maxDepth); } }, [open, latest, jobId]);
  useEffect(() => { if (!open) { setTouched(false); } }, [open]);
  const { data: job } = useQuery({
    queryKey: ['discovery', jobId], enabled: open && !!jobId,
    queryFn: () => api.get<DiscoveryJob>(`/api/discovery/${jobId}`),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 700 : false),
  });
  useEffect(() => open ? subscribe((m) => { if (m.type === 'discovery.progress' && (m.data as { id?: string })?.id === jobId) qc.invalidateQueries({ queryKey: ['discovery', jobId] }); }) : undefined, [open, jobId, qc]);
  // auto-select new, non-nested, unregistered results until the user edits the selection
  useEffect(() => {
    if (!job || touched) return;
    setSel(new Set(job.results.filter((x) => !x.alreadyRegistered && !x.nested).map((x) => x.rootPath)));
  }, [job, touched]);
  const scan = async (path = root) => {
    if (!path.trim()) return;
    const j = await run('scan', () => api.post<DiscoveryJob>('/api/discovery', { rootPath: path, maxDepth: depth }));
    if (j) { setJobId(j.id); setTouched(false); setSel(new Set()); }
  };
  const cancel = () => jobId && api.post(`/api/discovery/${jobId}/cancel`).then(() => qc.invalidateQueries({ queryKey: ['discovery', jobId] }));
  const register = async () => {
    const chosen = (job?.results ?? []).filter((i) => sel.has(i.rootPath));
    const r = await run('reg', () => api.post<{ created: string[]; errors: { rootPath: string; error: string }[] }>('/api/projects/bulk', {
      projects: chosen.map((c) => ({ rootPath: c.rootPath, name: c.name, category: c.category, technologies: c.technologies, commands: c.commands, description: c.description, thumbnailPath: c.thumbnailPath,
        deployment: c.deployment ? { provider: c.deployment.provider, firebaseProjectId: c.deployment.firebaseProjectId, hostingSiteId: c.deployment.hostingSiteId, remotePath: c.deployment.remotePath, publicUrl: c.deployment.publicUrl, deployDirectory: c.deployment.deployDirectory } : undefined })),
    }));
    if (r) {
      toast(r.errors.length ? 'error' : 'success', `Registered ${r.created.length} project(s)${r.errors.length ? `, ${r.errors.length} failed: ${r.errors[0].error}` : ''} — scanning files in the background`);
      qc.invalidateQueries(); setUi({ discover: false });
    }
  };
  const toggle = (p: string) => { setTouched(true); setSel((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; }); };
  const selectable = (job?.results ?? []).filter((r) => !r.alreadyRegistered);
  const running = job?.status === 'running';
  return (
    <Modal open={open} onClose={() => setUi({ discover: false })} title="Bulk project discovery" wide
      footer={<>
        {selectable.length > 0 && <Button variant="ghost" className="mr-auto" onClick={() => { setTouched(true); setSel(sel.size === selectable.length ? new Set() : new Set(selectable.map((r) => r.rootPath))); }}>{sel.size === selectable.length ? 'Select none' : 'Select all'}</Button>}
        <Button onClick={() => setUi({ discover: false })}>Close</Button>
        <Button variant="success" disabled={!sel.size} loading={busy === 'reg'} onClick={register}>Register {sel.size} project(s)</Button>
      </>}>
      <p className="mb-3 text-sm text-muted">Pick a parent directory. The server scans it in the background and saves what it finds — you can close this dialog and come back. Subfolders containing <code>package.json</code>, <code>index.html</code>, <code>firebase.json</code>, <code>.git</code>, <code>go.mod</code>, <code>README.md</code> or <code>pulse.json</code> are detected.</p>
      <div className="flex gap-2">
        <div className="flex-1"><PathInput value={root} onChange={setRoot} onPicked={(p) => scan(p)} placeholder="C:\ProjectX" title="Select parent folder to scan" /></div>
        <Select value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="Depth">{[1, 2, 3, 4].map((d) => <option key={d} value={d}>Depth {d}</option>)}</Select>
        {running ? <Button variant="danger" onClick={cancel}>Stop</Button> : <Button variant="primary" loading={busy === 'scan'} disabled={!root} onClick={() => scan()}><Search className="size-4" />Scan</Button>}
      </div>
      {job && (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted">
          {running && <span className="size-2 animate-pulse-dot rounded-full bg-primary" />}
          <span>{running ? 'Scanning' : job.status === 'done' ? 'Scan complete' : job.status === 'cancelled' ? 'Scan stopped' : 'Scan failed'} · <code>{job.rootPath}</code> · {job.dirsScanned} folders checked · {job.found} project(s) found</span>
          {running && job.current && <span className="mono truncate">— {job.current}</span>}
          {job.error && <span className="text-danger">{job.error}</span>}
        </div>
      )}
      {job && (
        <div className="mt-3 max-h-[45vh] overflow-y-auto rounded-lg border border-border">
          {job.results.length === 0 && <p className="p-4 text-sm text-muted">{running ? 'Looking for projects…' : 'No projects found. Try a deeper scan or another folder.'}</p>}
          {job.results.map((i) => (
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
