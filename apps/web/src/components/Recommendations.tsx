import { Link } from 'react-router-dom';
import { AlertOctagon, AlertTriangle, Info } from 'lucide-react';
import type { Recommendation } from '@pulse/shared';
import { Button, Empty } from './ui';
import { setUi } from '../stores/ui';

const ICON = { critical: <AlertOctagon className="size-4 text-danger" />, warning: <AlertTriangle className="size-4 text-warning" />, info: <Info className="size-4 text-primary" /> };

export function RecommendationList({ items }: { items: Recommendation[] }) {
  if (!items.length) return <Empty title="No recommendations">Everything looks healthy.</Empty>;
  return (
    <ul className="divide-y divide-border">
      {items.map((r) => (
        <li key={r.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
          <span className="mt-0.5" aria-label={r.severity}>{ICON[r.severity]}</span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{r.title}{r.projectName && <> · <Link to={`/projects/${r.projectId}`} className="text-primary hover:underline">{r.projectName}</Link></>}</div>
            <div className="text-xs text-muted">{r.detail}</div>
          </div>
          {r.priority !== undefined && <span className="shrink-0 text-xs tabular-nums text-muted">{r.priority}/100</span>}
          {r.action?.kind === 'deploy' && r.projectId && <Button size="sm" variant="primary" onClick={() => setUi({ deployProjectId: r.projectId! })}>Deploy</Button>}
          {r.action?.kind === 'view' && r.projectId && <Link to={r.action.target === 'dependencies' ? '/dependencies' : `/projects/${r.projectId}?tab=${r.action.target}`}><Button size="sm">{r.action.label}</Button></Link>}
        </li>
      ))}
    </ul>
  );
}
