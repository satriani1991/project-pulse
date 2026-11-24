import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CloudUpload, Terminal } from 'lucide-react';
import type { DeployPreflight } from '@pulse/shared';
import { DEPLOYMENT_STATUS_LABELS } from '@pulse/shared';
import { api } from '../services/api';
import { subscribe } from '../services/socket';
import { setUi, useUi } from '../stores/ui';
import { Badge, Button, Loading, Modal, Toggle, useToast } from './ui';
import { cx } from '../lib/format';

/** Deployment workflow (PRD §19): preflight review → explicit confirmation → build → deploy → verification, streamed live. */
export function DeployDialog() {
  const projectId = useUi((s) => s.deployProjectId);
  const [pf, setPf] = useState<DeployPreflight | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [phase, setPhase] = useState<'review' | 'running' | 'done' | 'failed'>('review');
  const [log, setLog] = useState<string[]>([]);
  const [skipBuild, setSkipBuild] = useState(false);
  const [ack, setAck] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!projectId) return;
    setPf(null); setErr(null); setPhase('review'); setLog([]); setSkipBuild(false); setAck(false);
    api.post<DeployPreflight>(`/api/projects/${projectId}/deploy/preflight`).then(setPf, (e) => setErr(e.message));
  }, [projectId]);
  useEffect(() => {
    if (!projectId) return;
    return subscribe((m) => {
      if (m.projectId !== projectId) return;
      if (m.type === 'process.output') setLog((l) => [...l, ...((m.data as { lines: string[] }).lines)].slice(-2000));
      if (m.type === 'deployment.completed') { setPhase('done'); setLog((l) => [...l, '✔ Deployment verified']); qc.invalidateQueries(); }
      if (m.type === 'deployment.failed') { setPhase('failed'); setLog((l) => [...l, `✖ ${(m.data as { message: string }).message}`]); qc.invalidateQueries(); }
    });
  }, [projectId, qc]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [log]);
  const close = () => setUi({ deployProjectId: null });
  const start = async () => {
    if (!pf) return;
    try { await api.post(`/api/projects/${projectId}/deploy`, { confirmToken: pf.confirmToken, skipBuild }); setPhase('running'); setLog(['Deployment started…']); }
    catch (e) { toast('error', (e as Error).message); }
  };
  const shared = (pf?.sharedSiteProjects.length ?? 0) > 0;
  return (
    <Modal open={!!projectId} onClose={close} title={<span className="flex items-center gap-2"><CloudUpload className="size-4" />Build & Deploy</span>} wide
      footer={phase === 'review' ? <>
        <Button onClick={close}>Cancel</Button>
        <Button variant="success" disabled={!pf || pf.blocked || (shared && !ack)} onClick={start}>Confirm deployment</Button>
      </> : <Button onClick={close}>{phase === 'running' ? 'Run in background' : 'Close'}</Button>}>
      {err && <p className="text-danger">{err}</p>}
      {!pf && !err && <Loading label="Preparing preflight…" />}
      {pf && phase === 'review' && (
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-[160px_1fr] gap-y-1.5">
            <dt className="text-muted">Firebase site</dt><dd>{pf.site || '—'} {pf.firebaseProjectId && <span className="text-muted">({pf.firebaseProjectId})</span>}</dd>
            <dt className="text-muted">Affected path</dt><dd className="mono">{pf.remotePath ?? '—'} <span className="text-muted">← {pf.deployDirectory}</span></dd>
            <dt className="text-muted">Build</dt><dd><code>{pf.buildCommand || 'none (no build step)'}</code> <Badge tone={pf.buildStatus === 'failed' ? 'danger' : pf.buildStatus === 'stale' ? 'warning' : 'neutral'}>{pf.buildStatus}</Badge></dd>
            <dt className="text-muted">Deploy command</dt><dd><code className="rounded bg-bg px-1.5 py-0.5">{pf.deployCommand || 'not configured'}</code></dd>
            <dt className="text-muted">Changed files</dt><dd>{pf.changes.length}</dd>
          </dl>
          {pf.warnings.map((w) => <p key={w} className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-warning"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{w}</p>)}
          {shared && (
            <div className="rounded-md border border-border">
              <p className="border-b border-border px-3 py-2 text-xs font-semibold text-muted">Other projects on {pf.site}</p>
              {pf.sharedSiteProjects.map((s) => <div key={s.id} className="flex justify-between px-3 py-1.5 text-xs"><span>{s.name} <span className="mono text-muted">{s.remotePath}</span></span><span>{DEPLOYMENT_STATUS_LABELS[s.status]}</span></div>)}
              <div className="border-t border-border px-3 py-2"><Toggle checked={ack} onChange={setAck} label="I understand this site-level deployment may affect the projects above" /></div>
            </div>
          )}
          {pf.buildCommand && <Toggle checked={skipBuild} onChange={setSkipBuild} label="Skip build (deploy current output as-is)" />}
          <details className="rounded-md border border-border"><summary className="cursor-pointer px-3 py-2 text-xs text-muted">Changed files ({pf.changes.length})</summary>
            <ul className="mono max-h-56 overflow-y-auto px-3 pb-2 text-xs">{pf.changes.map((c) => <li key={c.path + c.change} className="flex justify-between gap-3 py-0.5"><span className="truncate">{c.path}</span><span className={cx(c.change === 'added' ? 'text-success' : c.change === 'deleted' ? 'text-danger' : c.change === 'modified' ? 'text-primary' : 'text-muted')}>{c.change}</span></li>)}</ul>
          </details>
          <p className="text-xs text-muted">The project is marked up to date only after Project Pulse finds the new Firebase release and verifies every deployable file against it.</p>
        </div>
      )}
      {phase !== 'review' && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm"><Terminal className="size-4" />{phase === 'running' ? 'Running…' : phase === 'done' ? <span className="text-success">Deployed and verified</span> : <span className="text-danger">Deployment failed</span>}</div>
          <pre ref={logRef} className="mono h-80 overflow-auto rounded-md border border-border bg-bg p-3 text-xs leading-relaxed">{log.join('\n')}</pre>
        </div>
      )}
    </Modal>
  );
}
