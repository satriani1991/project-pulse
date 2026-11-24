import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribe } from '../services/socket';

/** Map WebSocket events to react-query invalidations (real-time dashboard refresh, throttled). */
export function useLiveUpdates() {
  const qc = useQueryClient();
  useEffect(() => {
    const pending = new Set<string>();
    let timer: number | undefined;
    const flush = () => { timer = undefined; for (const k of pending) qc.invalidateQueries({ queryKey: [k] }); pending.clear(); };
    const mark = (...keys: string[]) => { keys.forEach((k) => pending.add(k)); if (!timer) timer = window.setTimeout(flush, 400); };
    return subscribe((m) => {
      const t = m.type;
      if (t === 'process.output') return;
      if (t.startsWith('project.') || t.startsWith('file.') || t.startsWith('git.')) mark('projects', 'overview', 'activity', 'changes', 'files', 'git');
      if (t.startsWith('deployment.')) mark('projects', 'overview', 'deployments', 'activity', 'changes', 'notifications');
      if (t === 'analytics.updated') mark('heatmap', 'intensity', 'monthly', 'frequency', 'overview', 'day', 'projectActivity', 'recommendations');
      if (t === 'notification.created') mark('notifications', 'overview');
      if (t.startsWith('process.')) mark('processes', 'overview');
      if (t === 'workspaces.updated') mark('workspaces');
    });
  }, [qc]);
}
