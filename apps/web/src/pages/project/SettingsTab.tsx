import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Save, Trash2 } from 'lucide-react';
import type { ProjectSummary } from '@pulse/shared';
import { CATEGORIES, DEFAULT_EXCLUDES, LIFECYCLES, LIFECYCLE_LABELS } from '@pulse/shared';
import { api } from '../../services/api';
import { Button, Card, Field, Input, Select, Textarea, Toggle, useAction } from '../../components/ui';
import { CATEGORY_LABEL } from '../../lib/format';

export function ProjectSettingsTab({ p }: { p: ProjectSummary }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { busy, run } = useAction();
  const init = () => ({
    name: p.name, description: p.description, category: p.category, lifecycle: p.lifecycle, technologies: p.technologies.join(', '), tags: p.tags.join(', '),
    genre: p.genre ?? '', version: p.version ?? '', repoUrl: p.repoUrl ?? '', devUrl: p.devUrl ?? '', devPort: p.devPort ? String(p.devPort) : '', importance: p.importance,
    monitoringEnabled: p.monitoringEnabled, gitEnabled: p.gitEnabled, deploymentMonitoring: p.deploymentMonitoring,
    provider: p.deployment?.provider ?? 'none', firebaseProjectId: p.deployment?.firebaseProjectId ?? '', hostingSiteId: p.deployment?.hostingSiteId ?? '', remotePath: p.deployment?.remotePath ?? '/',
    publicUrl: p.deployment?.publicUrl ?? '', deployDirectory: p.deployment?.deployDirectory ?? '.',
    commands: Object.entries(p.commands).map(([k, v]) => ({ k, v: v ?? '' })), ignoreRules: p.ignoreRules.join('\n'), thumbnailPath: p.thumbnailPath ?? '',
  });
  const [f, setF] = useState(init);
  useEffect(() => setF(init()), [p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (x: Partial<ReturnType<typeof init>>) => setF((o) => ({ ...o, ...x }));
  const list = (s: string) => s.split(',').map((t) => t.trim()).filter(Boolean);
  const cmds = f.commands.some((c) => c.k === 'dev') ? f.commands : [{ k: 'dev', v: '' }, ...f.commands];
  const allCmds = ['build', 'deploy'].reduce((acc, k) => (acc.some((c) => c.k === k) ? acc : [...acc, { k, v: '' }]), cmds);

  const save = () => run('save', async () => {
    await api.patch(`/api/projects/${p.id}`, {
      name: f.name, description: f.description, category: f.category, lifecycle: f.lifecycle, technologies: list(f.technologies), tags: list(f.tags), genre: f.genre, version: f.version,
      repoUrl: f.repoUrl, devUrl: f.devUrl, devPort: f.devPort ? Number(f.devPort) : null, importance: f.importance,
      monitoringEnabled: f.monitoringEnabled, gitEnabled: f.gitEnabled, deploymentMonitoring: f.deploymentMonitoring,
      deployment: { provider: f.provider, firebaseProjectId: f.firebaseProjectId, hostingSiteId: f.hostingSiteId, remotePath: f.remotePath, publicUrl: f.publicUrl, deployDirectory: f.deployDirectory },
      commands: Object.fromEntries(allCmds.filter((c) => c.k.trim()).map((c) => [c.k.trim(), c.v])), ignoreRules: f.ignoreRules.split('\n').map((x) => x.trim()).filter(Boolean),
    });
    qc.invalidateQueries();
  }, 'Project settings saved');
  const upload = (file: File) => {
    const r = new FileReader();
    r.onload = () => run('thumb', async () => { await api.post(`/api/projects/${p.id}/thumbnail`, { dataUrl: r.result }); qc.invalidateQueries({ queryKey: ['projects'] }); }, 'Thumbnail updated');
    r.readAsDataURL(file);
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Project metadata">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Name"><Input value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Category"><Select value={f.category} onChange={(e) => set({ category: e.target.value as typeof f.category })} className="w-full">{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select></Field>
            <Field label="Lifecycle"><Select value={f.lifecycle} onChange={(e) => set({ lifecycle: e.target.value as typeof f.lifecycle })} className="w-full">{LIFECYCLES.map((l) => <option key={l} value={l}>{LIFECYCLE_LABELS[l]}</option>)}</Select></Field>
            <Field label="Importance" hint="Used by the deployment priority score"><Select value={f.importance} onChange={(e) => set({ importance: e.target.value as typeof f.importance })} className="w-full">{['low', 'medium', 'high', 'critical'].map((i) => <option key={i} value={i}>{i}</option>)}</Select></Field>
            <Field label="Genre"><Input value={f.genre} onChange={(e) => set({ genre: e.target.value })} placeholder="Action RPG" /></Field>
            <Field label="Version"><Input value={f.version} onChange={(e) => set({ version: e.target.value })} placeholder="1.2.0" /></Field>
            <Field label="Technologies" hint="Comma separated"><Input value={f.technologies} onChange={(e) => set({ technologies: e.target.value })} /></Field>
            <Field label="Tags" hint="First tag is used as the portfolio category"><Input value={f.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="Sports, Multiplayer" /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea rows={3} value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
            <Field label="Repository URL"><Input value={f.repoUrl} onChange={(e) => set({ repoUrl: e.target.value })} placeholder="https://github.com/…" /></Field>
            <Field label="Local dev URL / port" hint="Port is checked for conflicts before start"><div className="flex gap-2"><Input value={f.devUrl} onChange={(e) => set({ devUrl: e.target.value })} placeholder="http://localhost:8080" /><Input value={f.devPort} onChange={(e) => set({ devPort: e.target.value })} className="w-24" placeholder="8080" /></div></Field>
          </div>
        </Card>
        <Card title="Deployment target" subtitle="Per-project path mapping for shared Firebase Hosting sites">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Provider"><Select value={f.provider} onChange={(e) => set({ provider: e.target.value as 'firebase' | 'none' })} className="w-full"><option value="none">None (local only)</option><option value="firebase">Firebase Hosting</option></Select></Field>
            <Field label="Firebase project ID"><Input value={f.firebaseProjectId} onChange={(e) => set({ firebaseProjectId: e.target.value })} disabled={f.provider === 'none'} /></Field>
            <Field label="Hosting site ID"><Input value={f.hostingSiteId} onChange={(e) => set({ hostingSiteId: e.target.value })} disabled={f.provider === 'none'} /></Field>
            <Field label="Remote path" hint="e.g. /games/tka/"><Input value={f.remotePath} onChange={(e) => set({ remotePath: e.target.value })} className="mono" disabled={f.provider === 'none'} /></Field>
            <Field label="Local deploy directory" hint="Relative to the project root"><Input value={f.deployDirectory} onChange={(e) => set({ deployDirectory: e.target.value })} className="mono" disabled={f.provider === 'none'} /></Field>
            <Field label="Public URL" hint="Used for health checks and 'Open website'"><Input value={f.publicUrl} onChange={(e) => set({ publicUrl: e.target.value })} disabled={f.provider === 'none'} /></Field>
          </div>
        </Card>
        <Card title="Commands" subtitle="Only these commands can be executed by the dashboard. Leave build empty for vanilla games. @static runs the built-in static server.">
          <div className="space-y-2 p-4">
            {allCmds.map((c, i) => (
              <div key={i} className="flex gap-2">
                <Input value={c.k} onChange={(e) => set({ commands: allCmds.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)) })} className="mono w-32" />
                <Input value={c.v} onChange={(e) => set({ commands: allCmds.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)) })} className="mono" placeholder={c.k === 'deploy' ? 'firebase deploy --only hosting' : c.k === 'build' ? 'npm run build' : 'npm run dev'} />
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => set({ commands: [...allCmds, { k: 'custom', v: '' }] })}>+ Add custom command</Button>
          </div>
        </Card>
        <Card title="Monitoring">
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap gap-5">
              <Toggle checked={f.monitoringEnabled} onChange={(v) => set({ monitoringEnabled: v })} label="Real-time file monitoring" />
              <Toggle checked={f.gitEnabled} onChange={(v) => set({ gitEnabled: v })} label="Git monitoring" />
              <Toggle checked={f.deploymentMonitoring} onChange={(v) => set({ deploymentMonitoring: v })} label="Deployment monitoring" />
            </div>
            <Field label="Additional ignore rules" hint={<>One per line (gitignore-style). Defaults: <code>{DEFAULT_EXCLUDES.join(' ')}</code></>}>
              <Textarea rows={4} value={f.ignoreRules} onChange={(e) => set({ ignoreRules: e.target.value })} className="mono" placeholder={'assets/raw/\n*.psd'} />
            </Field>
            <div className="flex items-center gap-3">
              <label className="inline-flex"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                <span className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 text-sm"><ImagePlus className="size-4" />Upload thumbnail</span></label>
              <Input value={f.thumbnailPath.startsWith('data:') ? '' : f.thumbnailPath} onChange={(e) => set({ thumbnailPath: e.target.value })} placeholder="or a path in the project, e.g. assets/cover.png" className="mono" />
              <Button size="sm" disabled={!f.thumbnailPath || f.thumbnailPath.startsWith('data:')} onClick={() => run('tp', async () => { await api.post(`/api/projects/${p.id}/thumbnail`, { path: f.thumbnailPath }); qc.invalidateQueries({ queryKey: ['projects'] }); }, 'Thumbnail set')}>Use</Button>
            </div>
          </div>
        </Card>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="success" loading={busy === 'save'} onClick={save}><Save className="size-4" />Save changes</Button>
        <Button variant="danger" className="ml-auto" loading={busy === 'del'} onClick={() => confirm(`Unregister "${p.name}"? Only dashboard data is removed — ${p.rootPath} is NOT touched.`) && run('del', async () => { await api.del(`/api/projects/${p.id}`); qc.invalidateQueries(); nav('/projects'); }, 'Project unregistered')}>
          <Trash2 className="size-4" />Unregister project
        </Button>
      </div>
    </div>
  );
}
