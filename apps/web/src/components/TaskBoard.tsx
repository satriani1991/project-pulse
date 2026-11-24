import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import type { Task } from '@pulse/shared';
import { useProjects, useTasks } from '../hooks/queries';
import { api } from '../services/api';
import { Badge, Button, Input, Loading, Select, useAction } from './ui';
import { cx, date } from '../lib/format';

const COLS: { id: Task['status']; label: string }[] = [{ id: 'todo', label: 'To do' }, { id: 'doing', label: 'In progress' }, { id: 'done', label: 'Done' }];

/** Development checklist with drag-and-drop between columns. */
export function TaskBoard({ projectId }: { projectId?: string }) {
  const { data } = useTasks(projectId);
  const { data: projects } = useProjects();
  const qc = useQueryClient();
  const { run } = useAction();
  const [title, setTitle] = useState('');
  const [pid, setPid] = useState(projectId ?? '');
  const [prio, setPrio] = useState<Task['priority']>('medium');
  const [due, setDue] = useState('');
  const [over, setOver] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['tasks'] });
  const add = () => title.trim() && run('add', async () => { await api.post('/api/tasks', { title, projectId: pid || null, priority: prio, dueDate: due || null }); setTitle(''); setDue(''); refresh(); });
  const update = (id: number, body: Partial<Task>) => run('u', async () => { await api.patch(`/api/tasks/${id}`, body); refresh(); });
  if (!data) return <Loading />;
  return (
    <div className="space-y-3">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task — e.g. Finish boss AI, fix collision tunnelling…" className="min-w-64 flex-1" />
        {!projectId && <Select value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Project"><option value="">No project</option>{projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}
        <Select value={prio} onChange={(e) => setPrio(e.target.value as Task['priority'])} aria-label="Priority"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select>
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-36" aria-label="Due date" />
        <Button variant="success" type="submit"><Plus className="size-4" />Add</Button>
      </form>
      <div className="grid gap-3 md:grid-cols-3">
        {COLS.map((c) => {
          const items = data.filter((t) => t.status === c.id);
          return (
            <div key={c.id} onDragOver={(e) => { e.preventDefault(); setOver(c.id); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const id = Number(e.dataTransfer.getData('text/task')); if (id) update(id, { status: c.id }); }}
              className={cx('rounded-xl border bg-surface', over === c.id ? 'border-primary' : 'border-border')}>
              <div className="flex justify-between border-b border-border px-3 py-2 text-sm font-semibold">{c.label}<span className="text-xs text-muted">{items.length}</span></div>
              <ul className="min-h-24 space-y-2 p-2">
                {items.map((t) => (
                  <li key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/task', String(t.id))} className="group cursor-grab rounded-lg border border-border bg-surface-2 p-2.5 text-sm">
                    <div className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5 accent-[var(--pp-success)]" checked={t.status === 'done'} onChange={(e) => update(t.id, { status: e.target.checked ? 'done' : 'todo' })} aria-label="Done" />
                      <span className={cx('flex-1', t.status === 'done' && 'text-muted line-through')}>{t.title}</span>
                      <button className="text-muted opacity-0 group-hover:opacity-100 hover:text-danger" aria-label="Delete task" onClick={() => run('d', async () => { await api.del(`/api/tasks/${t.id}`); refresh(); })}><Trash2 className="size-3.5" /></button>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-5 text-xs">
                      <Badge tone={t.priority === 'high' ? 'danger' : t.priority === 'medium' ? 'warning' : 'neutral'}>{t.priority}</Badge>
                      {!projectId && t.projectId && <Link to={`/projects/${t.projectId}?tab=tasks`} className="text-primary hover:underline">{t.projectName}</Link>}
                      {t.dueDate && <span className={cx('text-muted', t.status !== 'done' && t.dueDate < new Date().toISOString().slice(0, 10) && 'text-danger')}>due {date(t.dueDate)}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
