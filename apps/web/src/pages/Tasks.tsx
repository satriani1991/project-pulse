import { useQueryClient } from '@tanstack/react-query';
import { useProjects } from '../hooks/queries';
import { api } from '../services/api';
import { Card, Loading, useToast } from '../components/ui';
import { TaskBoard } from '../components/TaskBoard';
import { Kanban } from './Projects';

export function TasksPage() {
  const { data } = useProjects();
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Tasks & roadmap</h1>
      <Card title="Development checklist" subtitle="Drag tasks between columns"><div className="p-4"><TaskBoard /></div></Card>
      <Card title="Project lifecycle roadmap" subtitle="Drag projects between lifecycle stages — independent of deployment status">
        <div className="p-4">{data ? <Kanban list={data} onMove={async (p, l) => { try { await api.patch(`/api/projects/${p.id}`, { lifecycle: l }); qc.invalidateQueries({ queryKey: ['projects'] }); } catch (e) { toast('error', (e as Error).message); } }} /> : <Loading />}</div>
      </Card>
    </div>
  );
}
