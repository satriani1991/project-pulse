import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Trash2 } from 'lucide-react';
import type { Note, ProjectSummary } from '@pulse/shared';
import { api, qs } from '../../services/api';
import { Badge, Button, Card, Empty, Input, Loading, Select, Textarea, useAction } from '../../components/ui';
import { cx, timeAgo } from '../../lib/format';

const KINDS: Note['kind'][] = ['note', 'idea', 'bug', 'tech', 'prd'];
const KIND_LABEL: Record<Note['kind'], string> = { note: 'Note', idea: 'Idea', bug: 'Bug', tech: 'Technical', prd: 'PRD' };

/** Ideas, bugs, technical notes and PRD documents (stored in Pulse) + read-only project docs found on disk. */
export function NotesTab({ p }: { p: ProjectSummary }) {
  const qc = useQueryClient();
  const { run, busy } = useAction();
  const { data: notes } = useQuery({ queryKey: ['notes', p.id], queryFn: () => api.get<Note[]>(`/api/projects/${p.id}/notes`) });
  const { data: docs } = useQuery({ queryKey: ['docs', p.id], queryFn: () => api.get<{ path: string; size: number; modifiedAt: string }[]>(`/api/projects/${p.id}/docs`) });
  const [sel, setSel] = useState<{ type: 'note'; id: number } | { type: 'doc'; path: string } | null>(null);
  const [draft, setDraft] = useState<{ title: string; content: string; kind: Note['kind'] } | null>(null);
  const [filter, setFilter] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['notes', p.id] });
  const current = sel?.type === 'note' ? notes?.find((n) => n.id === sel.id) : undefined;
  const { data: doc } = useQuery({ queryKey: ['file', p.id, sel?.type === 'doc' ? sel.path : ''], enabled: sel?.type === 'doc', queryFn: () => api.get<{ content: string }>(`/api/projects/${p.id}/file` + qs({ path: (sel as { path: string }).path })) });
  const open = (n: Note) => { setSel({ type: 'note', id: n.id }); setDraft({ title: n.title, content: n.content, kind: n.kind }); };
  const create = () => run('c', async () => { const r = await api.post<{ id: number }>(`/api/projects/${p.id}/notes`, { title: 'Untitled', content: '', kind: 'note' }); await refresh(); setSel({ type: 'note', id: r.id }); setDraft({ title: 'Untitled', content: '', kind: 'note' }); });
  const save = () => current && draft && run('s', async () => { await api.patch(`/api/notes/${current.id}`, draft); refresh(); }, 'Saved');
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="space-y-4">
        <Card title="Notes" actions={<Button size="sm" variant="success" onClick={create}><Plus className="size-3.5" />New</Button>}>
          <div className="border-b border-border p-2"><Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-full" aria-label="Kind"><option value="">All kinds</option>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select></div>
          {!notes ? <Loading /> : <ul className="max-h-96 divide-y divide-border overflow-y-auto">{notes.filter((n) => !filter || n.kind === filter).map((n) => (
            <li key={n.id}><button onClick={() => open(n)} className={cx('w-full px-3 py-2 text-left text-sm hover:bg-surface-2', current?.id === n.id && 'bg-surface-2')}>
              <div className="flex items-center gap-2"><Badge tone={n.kind === 'bug' ? 'danger' : n.kind === 'prd' ? 'library' : n.kind === 'idea' ? 'warning' : 'neutral'}>{KIND_LABEL[n.kind]}</Badge><span className="truncate font-medium">{n.title}</span></div>
              <div className="text-xs text-muted">{timeAgo(n.updatedAt)}</div></button></li>))}
            {!notes.length && <li className="px-3 py-6 text-center text-sm text-muted">No notes yet</li>}</ul>}
        </Card>
        <Card title="Project documents" subtitle="README, PRD and docs/*.md found in the project">
          <ul className="max-h-72 divide-y divide-border overflow-y-auto text-sm">{docs?.map((d) => (
            <li key={d.path}><button onClick={() => { setSel({ type: 'doc', path: d.path }); setDraft(null); }} className={cx('flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-2', sel?.type === 'doc' && sel.path === d.path && 'bg-surface-2')}><FileText className="size-3.5 text-muted" /><span className="mono truncate text-xs">{d.path}</span></button></li>))}
            {!docs?.length && <li className="px-3 py-4 text-center text-xs text-muted">No markdown documents found</li>}</ul>
        </Card>
      </div>
      <Card>
        {sel?.type === 'note' && draft && current ? (
          <div className="space-y-3 p-4">
            <div className="flex gap-2">
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="text-base font-semibold" />
              <Select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Note['kind'] })} aria-label="Kind">{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>
              <Button variant="success" loading={busy === 's'} onClick={save}>Save</Button>
              <Button variant="danger" size="icon" aria-label="Delete note" onClick={() => confirm('Delete this note?') && run('d', async () => { await api.del(`/api/notes/${current.id}`); setSel(null); setDraft(null); refresh(); })}><Trash2 className="size-4" /></Button>
            </div>
            <Textarea rows={24} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} className="mono text-[13px] leading-relaxed" placeholder={draft.kind === 'prd' ? '# Requirements\n\n## Goals\n\n## Mechanics\n\n## Acceptance criteria' : 'Write in Markdown…'}
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } }} />
            <p className="text-xs text-muted">Ctrl+S to save · stored in the Project Pulse database, not in your project folder.</p>
          </div>
        ) : sel?.type === 'doc' ? (
          <div><div className="mono border-b border-border px-4 py-2 text-sm">{sel.path} <span className="text-xs text-muted">(read-only)</span></div>
            {doc ? <pre className="max-h-[70vh] overflow-auto p-4 text-[13px] leading-relaxed whitespace-pre-wrap">{doc.content}</pre> : <Loading />}</div>
        ) : <Empty title="Select or create a note">Keep ideas, bugs, technical notes and each game's PRD next to the project.</Empty>}
      </Card>
    </div>
  );
}
