import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertOctagon, CheckCircle2, CircleDashed, CloudOff, CloudUpload, GitBranch, HelpCircle, Laptop, Loader2, Star, Gamepad2, Library, AppWindow, Globe, Wrench } from 'lucide-react';
import type { DeploymentState, DeploymentStatus, ProjectSummary } from '@pulse/shared';
import { DEPLOYMENT_STATUS_LABELS, LIFECYCLE_LABELS, intensityLabel } from '@pulse/shared';
import { Badge } from './ui';
import { CATEGORY_LABEL, bytes, cx, timeAgo } from '../lib/format';
import { wsUrl } from '../services/api';

const STATUS: Record<DeploymentStatus, { tone: 'success' | 'warning' | 'danger' | 'primary' | 'neutral'; icon: ReactNode }> = {
  up_to_date: { tone: 'success', icon: <CheckCircle2 className="size-3" /> },
  needs_deployment: { tone: 'warning', icon: <CloudUpload className="size-3" /> },
  deployment_failed: { tone: 'danger', icon: <AlertOctagon className="size-3" /> },
  deploying: { tone: 'primary', icon: <Loader2 className="size-3 animate-spin" /> },
  never_deployed: { tone: 'neutral', icon: <CloudOff className="size-3" /> },
  unverified: { tone: 'neutral', icon: <HelpCircle className="size-3" /> },
  local_only: { tone: 'neutral', icon: <Laptop className="size-3" /> },
};

export function StatusBadge({ state }: { state: DeploymentState }) {
  const s = STATUS[state.status];
  const label = state.status === 'needs_deployment' && state.method === 'timestamp' ? 'Possibly outdated' : DEPLOYMENT_STATUS_LABELS[state.status];
  return <Badge tone={s.tone} icon={s.icon}><span title={state.message ?? `${label} · method: ${state.method}, confidence: ${state.confidence}`}>{label}</span></Badge>;
}

export const CATEGORY_ICON: Record<string, ReactNode> = {
  game: <Gamepad2 className="size-3.5" />, library: <Library className="size-3.5" />, application: <AppWindow className="size-3.5" />, website: <Globe className="size-3.5" />, tool: <Wrench className="size-3.5" />,
};

/** Deterministic gradient placeholder when a project has no thumbnail. */
function gradientFor(id: string) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `linear-gradient(135deg, hsl(${h % 360} 45% 22%), hsl(${(h >> 8) % 360} 55% 12%))`;
}

export function ProjectThumb({ p, className }: { p: Pick<ProjectSummary, 'id' | 'name' | 'thumbnailPath' | 'updatedAt'>; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (p.thumbnailPath && !failed) {
    return <img src={wsUrl(`/api/projects/${p.id}/thumbnail?v=${encodeURIComponent(p.thumbnailPath)}`)} alt="" loading="lazy" onError={() => setFailed(true)} className={cx('object-cover', className)} />;
  }
  return <div className={cx('flex items-center justify-center text-2xl font-bold text-white/70', className)} style={{ background: gradientFor(p.id) }}>{p.name.slice(0, 2).toUpperCase()}</div>;
}

export function changesLine(p: ProjectSummary) {
  const s = p.deploymentState;
  if (s.status === 'local_only') return p.git?.isRepo ? (p.git.dirtyCount ? `${p.git.dirtyCount} uncommitted file(s)` : 'Working tree clean') : 'Local project';
  if (s.status === 'up_to_date') return 'No pending changes';
  if (s.status === 'needs_deployment') return s.method === 'timestamp' ? 'Changed since last deployment (estimate)' : `${s.pendingCount} changed file${s.pendingCount === 1 ? '' : 's'}`;
  if (s.status === 'unverified') return s.unverifiedFiles ? `${s.unverifiedFiles} file(s) unverified` : 'Deployment not verified';
  if (s.status === 'never_deployed') return `${s.pendingCount || p.stats.totalFiles} file(s) never published`;
  return s.message ?? '';
}

export function ProjectCard({ p, onFavorite }: { p: ProjectSummary; onFavorite?: (p: ProjectSummary) => void }) {
  const s = p.deploymentState;
  const uncommitted = p.git?.isRepo && p.git.dirtyCount > 0 && s.status === 'local_only';
  return (
    <article className="group overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-muted">
      <Link to={`/projects/${p.id}`} className="block">
        <div className="relative aspect-[16/7] overflow-hidden bg-surface-2">
          <ProjectThumb p={p} className="size-full transition-transform duration-300 group-hover:scale-[1.02]" />
          {p.intensity >= 60 && <span className="absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">● {intensityLabel(p.intensity)}</span>}
        </div>
      </Link>
      <div className="space-y-2 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link to={`/projects/${p.id}`} className="block truncate font-semibold hover:text-primary">{p.name}</Link>
            <div className="flex items-center gap-1 truncate text-xs text-muted">{CATEGORY_ICON[p.category]}{CATEGORY_LABEL[p.category]} · {p.technologies.slice(0, 2).join(', ') || LIFECYCLE_LABELS[p.lifecycle]}</div>
          </div>
          {onFavorite && (
            <button onClick={() => onFavorite(p)} aria-label={p.favorite ? 'Remove favorite' : 'Add favorite'} className="text-muted hover:text-warning">
              <Star className={cx('size-4', p.favorite && 'fill-warning text-warning')} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {uncommitted ? <Badge tone="primary" icon={<GitBranch className="size-3" />}>Uncommitted changes</Badge> : <StatusBadge state={s} />}
          {p.errors.length > 0 && <Badge tone="danger">{p.errors.length} issue{p.errors.length > 1 ? 's' : ''}</Badge>}
        </div>
        <dl className="grid grid-cols-2 gap-x-2 text-xs text-muted">
          <div><dt className="inline">Local update: </dt><dd className="inline text-fg">{timeAgo(p.lastLocalUpdate)}</dd></div>
          <div className="text-right"><dt className="inline">{p.category === 'library' ? 'Last release: ' : 'Deployed: '}</dt><dd className="inline text-fg">{s.status === 'local_only' ? '—' : timeAgo(p.lastDeployment)}</dd></div>
        </dl>
        <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-muted">
          <span className={cx(s.status === 'needs_deployment' && 'font-medium text-warning')}>{changesLine(p)}</span>
          <span>{bytes(p.stats.totalSize)}</span>
        </div>
      </div>
    </article>
  );
}

export function IntensityBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2" title={`${score}/100 · ${intensityLabel(score)}`}>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-success" style={{ width: `${score}%` }} /></div>
      <span className="w-12 text-xs tabular-nums text-muted">{score}/100</span>
    </div>
  );
}

export function EventIcon({ type }: { type: string }) {
  const c = { created: 'bg-success', modified: 'bg-primary', deleted: 'bg-danger', renamed: 'bg-library', git_commit: 'bg-warning', deployment: 'bg-success', build_completed: 'bg-library', registered: 'bg-muted', dir_created: 'bg-muted' }[type] ?? 'bg-muted';
  return <span className={cx('mt-1.5 inline-block size-2 shrink-0 rounded-full', c)} />;
}

export function emptyRing() { return <CircleDashed className="size-8" />; }
