import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, Save } from 'lucide-react';
import type { Settings } from '@pulse/shared';
import { DEFAULT_EXCLUDES, REMINDER_DAY_OPTIONS } from '@pulse/shared';
import { useSettings } from '../hooks/queries';
import { api, wsUrl } from '../services/api';
import { Badge, Button, Card, Field, Input, Loading, Select, Textarea, Toggle, useAction } from '../components/ui';
import { ThemeSwitcher } from '../components/Workspace';
import { WorkspaceManager } from '../components/WorkspaceManager';
import { dateTime, minutes } from '../lib/format';

interface SystemStatus { workspace?: { id: string; name: string }; version: string; node: string; platform: string; dataDir: string; uptime: number; memoryMB: number; watchers: number; dbSizeMB: number; events: number; indexedFiles: number;
  jobs: Record<string, { lastRun?: string; lastError?: string; durationMs?: number }>; firebaseAuth: { source?: string; valid: boolean; lastError: string; mode: string } }

export function SettingsPage() {
  const { data } = useSettings();
  const { data: sys } = useQuery({ queryKey: ['system'], queryFn: () => api.get<SystemStatus>('/api/system/status'), refetchInterval: 15_000 });
  const { data: audit } = useQuery({ queryKey: ['audit'], queryFn: () => api.get<{ id: number; action: string; project_name?: string; detail: string; at: string }[]>('/api/audit') });
  const [s, setS] = useState<Settings | null>(null);
  const qc = useQueryClient();
  const { busy, run } = useAction();
  useEffect(() => { if (data) setS(data.settings); }, [data]);
  if (!s || !data) return <Loading />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const n = (k: keyof Settings) => ({ type: 'number', value: String(s[k]), onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never) });
  const save = () => run('save', async () => { await api.patch('/api/settings', s); qc.invalidateQueries(); }, 'Settings saved');
  const weightSum = Object.values(s.intensityWeights).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3"><h1 className="text-xl font-semibold">Settings</h1><span className="text-sm text-muted">Settings below apply to the current workspace</span><Button className="ml-auto" variant="success" loading={busy === 'save'} onClick={save}><Save className="size-4" />Save settings</Button></div>
      <WorkspaceManager />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Monitoring">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="File event debounce (ms)" hint="2000–5000 recommended"><Input {...n('debounceMs')} min={500} max={30000} /></Field>
            <Field label="Session gap (minutes)" hint="A pause longer than this starts a new development session"><Input {...n('sessionGapMinutes')} /></Field>
            <Field label="Inactive after (days)"><Input {...n('inactiveDays')} /></Field>
            <Field label="Deployment reminder"><Select value={s.reminderDays} onChange={(e) => set('reminderDays', Number(e.target.value))} className="w-full">{REMINDER_DAY_OPTIONS.map((d) => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}</Select></Field>
            <Field label="Activity retention (days)" hint="Raw file events older than this are pruned; daily aggregates are kept"><Input {...n('activityRetentionDays')} /></Field>
            <Field label="Large asset threshold (KB)"><Input {...n('largeAssetKB')} /></Field>
            <Field label="Additional global excludes" className="sm:col-span-2" hint={<>One per line, gitignore-style. Always excluded: <code>{DEFAULT_EXCLUDES.join(' ')}</code></>}>
              <Textarea rows={3} value={s.globalExcludes.join('\n')} onChange={(e) => set('globalExcludes', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} className="mono" />
            </Field>
          </div>
        </Card>
        <Card title="Background service intervals">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Firebase release check (min)"><Input {...n('firebaseCheckMinutes')} /></Field>
            <Field label="Git status refresh (sec)"><Input {...n('gitRefreshSeconds')} /></Field>
            <Field label="Website health check (min)"><Input {...n('healthCheckMinutes')} /></Field>
            <Field label="Reconciliation scan (min)"><Input {...n('reconcileMinutes')} /></Field>
            <Field label="Analytics aggregation (min)"><Input {...n('analyticsMinutes')} /></Field>
            <Field label="Database backup every (days)"><Input {...n('backupDays')} /></Field>
          </div>
        </Card>
        <Card title="Firebase Hosting" subtitle="Read-only access to release history and version file manifests">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Authentication"><Select value={s.firebaseAuth} onChange={(e) => set('firebaseAuth', e.target.value as Settings['firebaseAuth'])} className="w-full">
              <option value="auto">Automatic (service account → Firebase CLI → gcloud)</option><option value="firebase_cli">Firebase CLI login (firebase login)</option><option value="gcloud">Google Cloud CLI (gcloud auth login)</option><option value="service_account">Service-account key file</option></Select></Field>
            <Field label="Status"><div className="flex h-8 items-center gap-2">{sys?.firebaseAuth.valid ? <Badge tone="success">Connected via {sys.firebaseAuth.source}</Badge> : <Badge tone={sys?.firebaseAuth.lastError ? 'danger' : 'neutral'}>{sys?.firebaseAuth.lastError ? 'Not authenticated' : 'Not checked yet'}</Badge>}
              <Button size="sm" loading={busy === 'fb'} onClick={() => run('fb', async () => { await api.post('/api/system/firebase-refresh'); qc.invalidateQueries(); }, 'Firebase checked')}><RefreshCw className="size-3.5" />Test</Button></div></Field>
            {sys?.firebaseAuth.lastError && <p className="text-xs text-danger sm:col-span-2">{sys.firebaseAuth.lastError}</p>}
            <Field label="Service-account key path" hint="Optional. Stored path only — the key never leaves this machine." className="sm:col-span-2"><Input value={s.serviceAccountPath} onChange={(e) => set('serviceAccountPath', e.target.value)} className="mono" placeholder="C:\keys\ps-action-readonly.json" /></Field>
            <Field label="HTTP verification budget (MB)" hint='Max download per "Verify via HTTP"'><Input {...n('remoteVerifyMaxMB')} /></Field>
            <Field label="API base URL" hint="Leave default unless testing"><Input value={s.firebaseApiBase} onChange={(e) => set('firebaseApiBase', e.target.value)} className="mono" /></Field>
          </div>
        </Card>
        <Card title="Development intensity score" subtitle={`Weights are normalised (current total ${weightSum}). Each component is capped at its threshold.`}>
          <div className="p-4">
            <table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th>Metric</th><th>Weight</th><th>Threshold (= 100%)</th></tr></thead>
              <tbody>{(Object.keys(s.intensityWeights) as (keyof Settings['intensityWeights'])[]).map((k) => (
                <tr key={k}><td className="py-1 capitalize">{k.replace(/([A-Z])/g, ' $1')}</td>
                  <td className="pr-2"><Input type="number" value={s.intensityWeights[k]} onChange={(e) => set('intensityWeights', { ...s.intensityWeights, [k]: Number(e.target.value) })} /></td>
                  <td><Input type="number" value={s.intensityThresholds[k]} onChange={(e) => set('intensityThresholds', { ...s.intensityThresholds, [k]: Number(e.target.value) })} /></td></tr>))}</tbody></table>
            <Field label="Scoring window (days)" className="mt-3 w-48"><Input {...n('intensityWindowDays')} /></Field>
          </div>
        </Card>
        <Card title="Launcher & appearance">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Editor command" hint="Launched with the project folder (code, cursor, webstorm…)"><Input value={s.editorCommand} onChange={(e) => set('editorCommand', e.target.value)} className="mono" /></Field>
            <Field label="Terminal"><Select value={s.terminalCommand} onChange={(e) => set('terminalCommand', e.target.value)} className="w-full"><option value="wt">Windows Terminal</option><option value="powershell">PowerShell</option><option value="cmd">Command Prompt</option></Select></Field>
            <Field label="Theme (this workspace)" hint="Dark, light, or follow Windows"><div className="flex h-8 items-center"><ThemeSwitcher withLabels /></div></Field>
          </div>
        </Card>
        <Card title="Portfolio synchronization" subtitle="Export games.json for your public game collection website">
          <div className="space-y-3 p-4">
            <Field label="Export path" hint="Absolute path ending in .json, e.g. C:\ProjectX\ps-action\public\games.json"><Input value={s.portfolioExportPath} onChange={(e) => set('portfolioExportPath', e.target.value)} className="mono" /></Field>
            <div className="flex gap-2">
              <a href={wsUrl('/api/portfolio/export?download=1')}><Button><Download className="size-4" />Download games.json</Button></a>
              <Button variant="primary" disabled={!s.portfolioExportPath} loading={busy === 'pf'} onClick={() => run('pf', async () => { await api.patch('/api/settings', { portfolioExportPath: s.portfolioExportPath }); const r = await api.post<{ path: string; count: number }>('/api/portfolio/write'); return r; }, 'games.json written')}>Write to export path</Button>
            </div>
          </div>
        </Card>
        <Card title="System" actions={<Button size="sm" loading={busy === 'db'} onClick={() => run('db', () => api.post('/api/system/backup-db'), 'Database backup created')}>Back up database now</Button>}>
          {sys ? (
            <div className="space-y-3 p-4 text-sm">
              <dl className="grid grid-cols-[160px_1fr] gap-y-1">
                <dt className="text-muted">Version</dt><dd>PROJECT PULSE {sys.version} · Node {sys.node} · {sys.platform}</dd>
                <dt className="text-muted">Workspace</dt><dd>{sys.workspace?.name} <code className="text-xs text-muted">{sys.workspace?.id}</code></dd>
                <dt className="text-muted">Data directory</dt><dd className="mono text-xs">{sys.dataDir}</dd>
                <dt className="text-muted">Uptime / memory</dt><dd>{minutes(Math.round(sys.uptime / 60))} · {sys.memoryMB} MB</dd>
                <dt className="text-muted">Watchers</dt><dd>{sys.watchers} active project watchers · {sys.indexedFiles.toLocaleString()} indexed files</dd>
                <dt className="text-muted">Database</dt><dd>{sys.dbSizeMB} MB · {sys.events.toLocaleString()} events</dd>
              </dl>
              <table className="w-full text-xs"><thead className="text-left text-muted"><tr><th>Job</th><th>Last run</th><th>Duration</th><th>Status</th></tr></thead>
                <tbody>{Object.entries(sys.jobs).map(([k, j]) => <tr key={k}><td className="py-0.5">{k}</td><td>{dateTime(j.lastRun)}</td><td>{j.durationMs} ms</td><td className={j.lastError ? 'text-danger' : 'text-success'}>{j.lastError ?? 'ok'}</td></tr>)}</tbody></table>
              <p className="text-xs text-muted">Keep monitoring when the browser is closed: the backend runs independently. Use <code>scripts\install-startup.ps1</code> to start it automatically at Windows logon (Task Scheduler).</p>
            </div>
          ) : <Loading />}
        </Card>
        <Card title="Audit history" subtitle="Deployments, commands, registrations and backups">
          <ul className="max-h-80 divide-y divide-border overflow-y-auto text-xs">{audit?.map((a) => <li key={a.id} className="flex gap-3 px-4 py-1.5"><span className="w-36 shrink-0 text-muted">{dateTime(a.at)}</span><span className="w-40 shrink-0 font-medium">{a.action}</span><span className="truncate text-muted">{a.project_name} {a.detail}</span></li>)}</ul>
        </Card>
      </div>
    </div>
  );
}
