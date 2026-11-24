import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, FileCode2, Film, Image as ImageIcon, Music, Sparkles, Type } from 'lucide-react';
import type { Asset, AssetReport, AssetType } from '@pulse/shared';
import { useAssetReport, useProjects } from '../hooks/queries';
import { rawUrl } from '../services/api';
import { Card, Empty, Input, Loading, Select, Stat, Tabs } from './ui';
import { ShareBars } from '../charts';
import { AssetPreviewModal } from './AssetViewers';
import { TimelineList } from './Timeline';
import { bytes, timeAgo } from '../lib/format';

const ICONS: Record<string, React.ReactNode> = { image: <ImageIcon className="size-6" />, animation: <Film className="size-6" />, audio: <Music className="size-6" />, video: <Film className="size-6" />, model: <Box className="size-6" />, vfx: <Sparkles className="size-6" />, font: <Type className="size-6" />, script: <FileCode2 className="size-6" /> };
const LABEL: Record<AssetType, string> = { image: 'Images', animation: 'Animations', audio: 'Audio', video: 'Video', model: '3D models', vfx: 'VFX', font: 'Fonts', script: 'Scripts', other: 'Other' };
const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];

type Tab = 'browse' | 'duplicates' | 'large' | 'broken' | 'unused' | 'formats' | 'dimensions' | 'history';

export function AssetExplorer({ projectId }: { projectId?: string }) {
  const { data, isLoading } = useAssetReport(projectId);
  const { data: projects } = useProjects();
  const names = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p.name])), [projects]);
  const [tab, setTab] = useState<Tab>(projectId ? 'browse' : 'duplicates');
  const [type, setType] = useState<string>('');
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState<Asset | null>(null);
  if (isLoading || !data) return <Loading />;
  const r: AssetReport = data.report;
  const storage = (['image', 'animation', 'audio', 'model'] as AssetType[]).map((t, i) => ({ label: LABEL[t], value: r.sizes[t], color: SERIES[i] }));
  const other = r.totalSize - storage.reduce((a, b) => a + b.value, 0);
  const assets = data.assets.filter((a) => a.type !== 'script' || type === 'script').filter((a) => (!type || a.type === type) && (!q || a.path.toLowerCase().includes(q.toLowerCase())));
  const pname = (id: string) => (projectId ? null : <Link to={`/projects/${id}?tab=assets`} className="text-primary hover:underline">{names.get(id) ?? id}</Link>);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 lg:grid-cols-6">
        {(['image', 'animation', 'audio', 'model', 'vfx', 'script'] as AssetType[]).map((t) => <Stat key={t} label={LABEL[t]} value={r.counts[t].toLocaleString()} hint={bytes(r.sizes[t])} onClick={projectId ? () => { setType(t); setTab('browse'); } : undefined} />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <div className="px-3 pt-2"><Tabs<Tab> value={tab} onChange={setTab} tabs={[
            ...(projectId ? [{ id: 'browse' as Tab, label: 'Browse', count: data.assets.filter((a) => a.type !== 'script').length }] : []),
            { id: 'duplicates', label: 'Duplicates', count: r.duplicates.length }, { id: 'large', label: 'Large files', count: r.large.length },
            { id: 'broken', label: 'Broken references', count: r.broken.length }, { id: 'unused', label: 'Possibly unused', count: r.unused.length },
            { id: 'formats', label: 'Formats' }, { id: 'dimensions', label: 'Dimensions', count: r.dimensionIssues.length }, { id: 'history', label: 'History' }]} /></div>
          <div className="p-3">
            {tab === 'browse' && projectId && (
              <>
                <div className="mb-3 flex gap-2"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by path…" className="max-w-xs" />
                  <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type"><option value="">All media</option>{Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
                {!assets.length ? <Empty title="No assets match" /> : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
                    {assets.slice(0, 600).map((a) => (
                      <button key={a.path} onClick={() => setPreview(a)} className="group overflow-hidden rounded-lg border border-border bg-surface-2 text-left hover:border-primary">
                        <div className="checker flex aspect-square items-center justify-center overflow-hidden text-muted">
                          {['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'].includes(a.ext) ? <img src={rawUrl(projectId, a.path)} alt="" loading="lazy" className="max-h-full max-w-full object-contain" /> : ICONS[a.type]}
                        </div>
                        <div className="p-1.5"><div className="truncate text-xs" title={a.path}>{a.path.split('/').pop()}</div><div className="text-[11px] text-muted">{bytes(a.size)}{a.width ? ` · ${a.width}×${a.height}` : ''}</div></div>
                      </button>
                    ))}
                  </div>
                )}
                {assets.length > 600 && <p className="mt-2 text-xs text-muted">Showing 600 of {assets.length}. Narrow the filter to see more.</p>}
              </>
            )}
            {tab === 'duplicates' && (!r.duplicates.length ? <Empty title="No duplicate assets" /> : <ul className="divide-y divide-border text-sm">{r.duplicates.map((d) => (
              <li key={d.hash} className="py-2"><div className="flex justify-between"><span className="font-medium">{d.files.length} identical copies · {bytes(d.size)} each</span><span className="text-xs text-muted">{bytes(d.size * (d.files.length - 1))} reclaimable</span></div>
                <ul className="mono mt-1 text-xs text-muted">{d.files.map((f) => <li key={f.projectId + f.path}>{pname(f.projectId)} {f.path}</li>)}</ul></li>))}</ul>)}
            {tab === 'large' && (!r.large.length ? <Empty title="No oversized assets" /> : <table className="w-full text-sm"><tbody className="divide-y divide-border">{r.large.map((a) => (
              <tr key={a.projectId + a.path}><td className="mono py-1.5 text-xs">{pname(a.projectId)} {a.path}</td><td className="text-xs text-muted">{a.width ? `${a.width}×${a.height}` : ''}</td><td className="text-right tabular-nums">{bytes(a.size)}</td>
                <td className="pl-3 text-xs text-warning">{a.ext === 'png' ? 'Consider WEBP' : ['wav', 'flac'].includes(a.ext) ? 'Consider OGG/MP3' : ''}</td></tr>))}</tbody></table>)}
            {tab === 'broken' && <>
              <p className="mb-2 text-xs text-muted">Static scan of source files for asset paths that do not exist (case-sensitive, as on Firebase Hosting). Dynamically built paths cannot be checked.</p>
              {!r.broken.length ? <Empty title="No broken references found" /> : <ul className="mono divide-y divide-border text-xs">{r.broken.map((b, i) => <li key={i} className="py-1.5">{pname(b.projectId)} <span className="text-muted">{b.source}</span> → <span className="text-danger">{b.reference}</span></li>)}</ul>}
            </>}
            {tab === 'unused' && <>
              <p className="mb-2 text-xs text-warning">Advisory only — games often load assets dynamically at runtime. Verify before removing anything.</p>
              {!r.unused.length ? <Empty title="No unused candidates" /> : <ul className="mono divide-y divide-border text-xs">{r.unused.map((u) => <li key={u.projectId + u.path} className="flex justify-between py-1.5"><span>{pname(u.projectId)} {u.path}</span><span className="text-muted">{bytes(u.size)}</span></li>)}</ul>}
            </>}
            {tab === 'formats' && <table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th>Format</th><th className="text-right">Files</th><th className="text-right">Size</th><th className="text-right">Avg</th></tr></thead>
              <tbody className="divide-y divide-border">{r.formats.map((f) => <tr key={f.ext}><td className="py-1.5 font-medium uppercase">{f.ext}</td><td className="text-right tabular-nums">{f.count}</td><td className="text-right tabular-nums">{bytes(f.size)}</td><td className="text-right tabular-nums text-muted">{bytes(Math.round(f.size / f.count))}</td></tr>)}</tbody></table>}
            {tab === 'dimensions' && (!r.dimensionIssues.length ? <Empty title="No inconsistent sprite dimensions" /> : <ul className="divide-y divide-border text-sm">{r.dimensionIssues.map((d) => <li key={d.projectId + d.folder} className="py-2">{pname(d.projectId)} <code>{d.folder}/</code> — {d.files} files with mixed sizes: <span className="text-muted">{d.sizes.join(', ')}</span></li>)}</ul>)}
            {tab === 'history' && <TimelineList events={r.recent} compact />}
          </div>
        </Card>
        <Card title="Storage distribution" subtitle={`${r.total.toLocaleString()} files · ${bytes(r.totalSize)}`}>
          <div className="p-4"><ShareBars items={[...storage, { label: 'Other', value: Math.max(0, other), color: 'var(--series-5)' }]} format={bytes} /></div>
          {!projectId && <p className="px-4 pb-4 text-xs text-muted">Select a project to browse and preview its assets, or open a project's Assets tab. Last refreshed {timeAgo(new Date().toISOString())}.</p>}
        </Card>
      </div>
      {projectId && <AssetPreviewModal projectId={projectId} asset={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
