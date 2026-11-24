import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Play, RotateCw, Square, Terminal } from 'lucide-react';
import { useProcesses, useProjects } from '../hooks/queries';
import { api } from '../services/api';
import { subscribe } from '../services/socket';
import { Badge, Button, Card, Empty, Input, Loading, Select, useAction } from '../components/ui';
import { cx, timeAgo } from '../lib/format';

export function ProcessLogs({ id, projectId }: { id: string; projectId?: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => { api.get<{ lines: string[] }>(`/api/processes/${id}/logs`).then((r) => setLines(r.lines)); }, [id]);
  useEffect(() => subscribe((m) => { const d = m.data as { id?: string; lines?: string[] }; if (m.type === 'process.output' && d?.id === id && d.lines) setLines((l) => [...l, ...d.lines!].slice(-3000)); }), [id, projectId]);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [lines]);
  return <pre ref={ref} className="mono h-72 overflow-auto rounded-md border border-border bg-bg p-3 text-xs leading-relaxed">{lines.join('\n') || 'No output yet.'}</pre>;
}

export function ServersPage() {
  const { data, isLoading } = useProcesses();
  const { data: projects } = useProjects();
  const qc = useQueryClient();
  const { busy, run } = useAction();
  const [logs, setLogs] = useState<string | null>(null);
  const [pid, setPid] = useState('');
  const [cmd, setCmd] = useState('dev');
  const [port, setPort] = useState('');
  const [portFree, setPortFree] = useState<boolean | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['processes'] });
  const project = projects?.find((p) => p.id === pid);
  if (isLoading) return <Loading />;
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Development server manager</h1>
      <Card title="Start a configured command" subtitle="Only commands configured in each project's Settings can run. Deployments use the confirmation workflow.">
        <div className="flex flex-wrap items-center gap-2 p-4">
          <Select value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Project"><option value="">Select project…</option>{projects?.filter((p) => Object.keys(p.commands).length).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Select value={cmd} onChange={(e) => setCmd(e.target.value)} aria-label="Command">{Object.keys(project?.commands ?? { dev: '' }).filter((k) => k !== 'deploy').map((k) => <option key={k} value={k}>{k}</option>)}</Select>
          {project && <code className="rounded bg-bg px-2 py-1 text-xs">{project.commands[cmd] ?? 'not configured'}</code>}
          <Button variant="success" disabled={!project?.commands[cmd]} loading={busy === 'start'} onClick={() => run('start', async () => { await api.post(`/api/projects/${pid}/launch`, { action: 'run', command: cmd }); refresh(); }, 'Process started')}><Play className="size-4" />Start</Button>
          <span className="ml-auto flex items-center gap-2 text-sm text-muted">Port check
            <Input value={port} onChange={(e) => { setPort(e.target.value); setPortFree(null); }} placeholder="5173" className="w-24" />
            <Button size="sm" disabled={!port} onClick={async () => setPortFree((await api.get<{ free: boolean }>(`/api/ports/${port}`)).free)}>Check</Button>
            {portFree !== null && <Badge tone={portFree ? 'success' : 'danger'}>{portFree ? 'free' : 'in use — conflict'}</Badge>}</span>
        </div>
      </Card>
      <Card>
        {!data?.length ? <Empty title="No processes" /> : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted"><tr>{['Project', 'Command', 'Port', 'Status', 'Started', ''].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">{data.map((p) => (
              <tr key={p.id} className={cx(logs === p.id && 'bg-surface-2')}>
                <td className="px-4 py-2 font-medium">{p.projectId ? <Link to={`/projects/${p.projectId}`} className="hover:text-primary">{p.projectName}</Link> : p.projectName}</td>
                <td className="mono max-w-sm truncate px-4 text-xs text-muted" title={p.command}><Badge className="mr-1">{p.commandKey}</Badge>{p.command}</td>
                <td className="px-4 tabular-nums">{p.port ?? '—'}</td>
                <td className="px-4"><Badge tone={p.status === 'running' ? 'success' : p.status === 'failed' ? 'danger' : 'neutral'}>{p.status === 'running' && <span className="animate-pulse-dot">●</span>}{p.status === 'running' ? 'Running' : p.status === 'failed' ? `Failed (${p.exitCode})` : p.status === 'exited' ? 'Exited' : 'Stopped'}</Badge></td>
                <td className="px-4 text-muted">{timeAgo(p.startedAt)}</td>
                <td className="px-4 py-1.5 text-right whitespace-nowrap">
                  {p.url && p.status === 'running' && <a href={p.url} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><ExternalLink className="size-4" />Open</Button></a>}
                  {p.id !== 'pulse' && <Button size="sm" variant="ghost" onClick={() => setLogs(logs === p.id ? null : p.id)}><Terminal className="size-4" />Logs</Button>}
                  {p.id !== 'pulse' && p.status === 'running' && <Button size="sm" variant="ghost" onClick={() => run('re', async () => { await api.post(`/api/processes/${p.id}/restart`); refresh(); })}><RotateCw className="size-4" />Restart</Button>}
                  {p.id !== 'pulse' && p.status === 'running' && <Button size="sm" variant="danger" onClick={() => run('stop', async () => { await api.post(`/api/processes/${p.id}/stop`); refresh(); })}><Square className="size-3.5" />Stop</Button>}
                </td>
              </tr>))}</tbody>
          </table>
        )}
        {logs && <div className="border-t border-border p-4"><ProcessLogs id={logs} /></div>}
      </Card>
    </div>
  );
}
