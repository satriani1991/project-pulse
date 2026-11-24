import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Pause, Play, Grid3x3 } from 'lucide-react';
import type { Asset } from '@pulse/shared';
import { rawUrl } from '../services/api';
import { Button, Input, Loading, Modal, Toggle } from './ui';
import { bytes, cx, dateTime } from '../lib/format';

const ModelViewer = lazy(() => import('./ModelViewer'));

/** Sprite sheet inspector: configurable grid, playback with FPS control, frame strip, transparency check, frame-size validation. */
export function SpriteInspector({ src, width, height }: { src: string; width?: number; height?: number }) {
  const [cols, setCols] = useState(4);
  const [rows, setRows] = useState(3);
  const [fps, setFps] = useState(12);
  const [playing, setPlaying] = useState(true);
  const [frame, setFrame] = useState(0);
  const [checker, setChecker] = useState(true);
  const [grid, setGrid] = useState(true);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const i = new Image(); i.onload = () => setImg(i); i.src = src; }, [src]);
  const W = img?.naturalWidth ?? width ?? 0, H = img?.naturalHeight ?? height ?? 0;
  const total = cols * rows;
  const fw = W / cols, fh = H / rows;
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % total), 1000 / Math.max(1, fps));
    return () => clearInterval(t);
  }, [playing, fps, total]);
  useEffect(() => {
    const c = canvas.current; if (!c || !img) return;
    const scale = Math.min(1, 360 / Math.max(fw, fh));
    c.width = Math.max(1, Math.round(fw * scale)); c.height = Math.max(1, Math.round(fh * scale));
    const ctx = c.getContext('2d')!; ctx.clearRect(0, 0, c.width, c.height); ctx.imageSmoothingEnabled = scale < 1;
    const f = frame % total;
    ctx.drawImage(img, (f % cols) * fw, Math.floor(f / cols) * fh, fw, fh, 0, 0, c.width, c.height);
  }, [img, frame, cols, rows, fw, fh, total]);
  const integral = Number.isInteger(fw) && Number.isInteger(fh);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <div className="flex gap-1">{[[4, 3], [4, 4], [8, 1], [6, 6]].map(([c, r]) => <Button key={`${c}x${r}`} size="sm" variant={cols === c && rows === r ? 'primary' : 'default'} onClick={() => { setCols(c); setRows(r); setFrame(0); }}>{c} × {r}</Button>)}</div>
        <label className="w-20">Columns<Input type="number" min={1} max={64} value={cols} onChange={(e) => { setCols(Math.max(1, Number(e.target.value))); setFrame(0); }} /></label>
        <label className="w-20">Rows<Input type="number" min={1} max={64} value={rows} onChange={(e) => { setRows(Math.max(1, Number(e.target.value))); setFrame(0); }} /></label>
        <label className="w-48">FPS: {fps}<input type="range" min={1} max={60} value={fps} onChange={(e) => setFps(Number(e.target.value))} className="w-full accent-[var(--pp-primary)]" /></label>
        <Button size="sm" onClick={() => setPlaying(!playing)}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}{playing ? 'Pause' : 'Play'}</Button>
        <Toggle checked={checker} onChange={setChecker} label="Transparency grid" />
        <Toggle checked={grid} onChange={setGrid} label={<span className="flex items-center gap-1"><Grid3x3 className="size-3.5" />Grid overlay</span>} />
      </div>
      <p className="text-xs text-muted">
        <b className="text-fg">{cols} × {rows} sprite sheet</b> · {total} frames · {fw.toFixed(integral ? 0 : 2)} × {fh.toFixed(integral ? 0 : 2)} per frame · {W} × {H}
        {!integral && <span className="ml-2 text-warning">⚠ Sheet size is not divisible by the grid — frames will be misaligned</span>}
      </p>
      <div className="grid gap-4 md:grid-cols-[auto_1fr]">
        <div className={cx('flex min-h-40 min-w-40 items-center justify-center rounded-lg border border-border p-2', checker && 'checker')}><canvas ref={canvas} aria-label={`Frame ${frame + 1}`} /></div>
        <div className="relative overflow-auto rounded-lg border border-border">
          <div className={cx('relative inline-block', checker && 'checker')}>
            <img src={src} alt="sprite sheet" className="block max-h-80 max-w-full" />
            {grid && (
              <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
                {Array.from({ length: total }, (_, i) => <div key={i} className={cx('border border-primary/40', i === frame % total && 'bg-primary/20')} />)}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {Array.from({ length: Math.min(total, 64) }, (_, i) => (
          <button key={i} onClick={() => { setPlaying(false); setFrame(i); }} className={cx('shrink-0 rounded border px-2 py-1 text-xs tabular-nums', i === frame % total ? 'border-primary text-primary' : 'border-border text-muted')}>{i + 1}</button>
        ))}
      </div>
    </div>
  );
}

export function AssetPreviewModal({ projectId, asset, onClose }: { projectId: string; asset: Asset | null; onClose: () => void }) {
  const [mode, setMode] = useState<'preview' | 'sprite'>('preview');
  useEffect(() => { setMode(asset?.type === 'animation' && asset.ext !== 'gif' ? 'sprite' : 'preview'); }, [asset]);
  if (!asset) return null;
  const src = rawUrl(projectId, asset.path);
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico'].includes(asset.ext);
  return (
    <Modal open={!!asset} onClose={onClose} title={<span className="mono text-sm">{asset.path}</span>} wide>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>{asset.type}</span><span>{asset.ext.toUpperCase()}</span><span>{bytes(asset.size)}</span>{asset.width && <span>{asset.width} × {asset.height}</span>}<span>Modified {dateTime(asset.modifiedAt)}</span>
        {isImage && asset.ext !== 'svg' && <span className="ml-auto flex gap-1"><Button size="sm" variant={mode === 'preview' ? 'primary' : 'default'} onClick={() => setMode('preview')}>Image</Button><Button size="sm" variant={mode === 'sprite' ? 'primary' : 'default'} onClick={() => setMode('sprite')}>Sprite inspector</Button></span>}
      </div>
      {isImage && mode === 'sprite' && <SpriteInspector src={src} width={asset.width} height={asset.height} />}
      {isImage && mode === 'preview' && <div className="checker flex justify-center rounded-lg border border-border p-3"><img src={src} alt={asset.path} className="max-h-[60vh] max-w-full" /></div>}
      {asset.type === 'audio' && <audio controls src={src} className="w-full" />}
      {['mp4', 'webm', 'mov'].includes(asset.ext) && <video controls src={src} className="max-h-[60vh] w-full rounded-lg" />}
      {['glb', 'gltf'].includes(asset.ext) && <Suspense fallback={<Loading label="Loading 3D viewer…" />}><ModelViewer url={src} /></Suspense>}
      {['fbx', 'obj', 'blend'].includes(asset.ext) && <p className="text-sm text-muted">Preview is available for GLB/GLTF models. Convert {asset.ext.toUpperCase()} to GLB to inspect it here.</p>}
      {asset.type === 'script' && <p className="text-sm text-muted">Open this file from the Files tab to view its source.</p>}
    </Modal>
  );
}
