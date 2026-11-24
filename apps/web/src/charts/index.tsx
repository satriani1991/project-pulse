import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { HeatmapDay } from '@pulse/shared';
import { CATEGORY_LABEL, CATEGORY_SERIES, cx } from '../lib/format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** GitHub-style contribution calendar (custom SVG). Columns = weeks (Mon-first), rows = weekdays. */
export function Heatmap({ days, selected, onSelect, unit = 'file changes' }: { days: HeatmapDay[]; selected?: string; onSelect?: (d: string) => void; unit?: string }) {
  const [hover, setHover] = useState<{ d: HeatmapDay; x: number; y: number } | null>(null);
  const cell = 11, gap = 3, left = 28, top = 18;
  const layout = useMemo(() => {
    if (!days.length) return { cells: [], months: [], weeks: 0 };
    const first = new Date(days[0].date + 'T00:00:00');
    const offset = (first.getDay() + 6) % 7; // Monday = 0
    const cells = days.map((d, i) => { const idx = i + offset; return { d, col: Math.floor(idx / 7), row: idx % 7 }; });
    const months: { label: string; col: number }[] = [];
    let last = -1;
    for (const c of cells) { const m = Number(c.d.date.slice(5, 7)) - 1; if (m !== last && c.row === 0) { const prev = months[months.length - 1]; if (prev && c.col - prev.col < 3) months.pop(); months.push({ label: MONTHS[m], col: c.col }); last = m; } }
    return { cells, months, weeks: cells[cells.length - 1].col + 1 };
  }, [days]);
  const width = left + layout.weeks * (cell + gap);
  const height = top + 7 * (cell + gap);
  return (
    <div className="relative">
      <div className="overflow-x-auto pb-1">
        <svg width={width} height={height} role="img" aria-label={`Contribution heatmap, ${days.length} days`} className="block">
          {layout.months.map((m, i) => <text key={i} x={left + m.col * (cell + gap)} y={10} fontSize={10} fill="var(--pp-muted)">{m.label}</text>)}
          {['Mon', 'Wed', 'Fri'].map((l, i) => <text key={l} x={0} y={top + (i * 2) * (cell + gap) + 9} fontSize={10} fill="var(--pp-muted)">{l}</text>)}
          {layout.cells.map(({ d, col, row }) => (
            <rect key={d.date} x={left + col * (cell + gap)} y={top + row * (cell + gap)} width={cell} height={cell} rx={2}
              fill={`var(--heat-${d.level})`} stroke={selected === d.date ? 'var(--pp-text)' : 'color-mix(in srgb, var(--pp-text) 6%, transparent)'} strokeWidth={selected === d.date ? 1.5 : 1}
              className="cursor-pointer" onClick={() => onSelect?.(d.date)}
              onMouseEnter={(e) => setHover({ d, x: (e.target as SVGRectElement).getBoundingClientRect().left, y: (e.target as SVGRectElement).getBoundingClientRect().top })}
              onMouseLeave={() => setHover(null)}>
              <title>{`${d.count} ${unit} on ${d.date}`}</title>
            </rect>
          ))}
        </svg>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-xs text-muted">
        Less {[0, 1, 2, 3, 4].map((l) => <span key={l} className="inline-block size-[11px] rounded-[2px]" style={{ background: `var(--heat-${l})` }} />)} More
      </div>
      {hover && (
        <div className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface-2 px-2 py-1 text-xs shadow-lg" style={{ left: hover.x + 6, top: hover.y - 6 }}>
          <b>{hover.d.count} {unit}</b> · {new Date(hover.d.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      )}
    </div>
  );
}

const tooltipStyle = { background: 'var(--pp-surface-2)', border: '1px solid var(--pp-border)', borderRadius: 8, fontSize: 12, color: 'var(--pp-text)' };
const axis = { stroke: 'var(--pp-muted)', fontSize: 11, tickLine: false, axisLine: false } as const;

export function MonthlyChart({ data }: { data: Record<string, number | string>[] }) {
  const cats = ['game', 'library', 'application'].filter((c) => data.some((d) => Number(d[c]) > 0));
  const extra = ['website', 'tool'].filter((c) => data.some((d) => Number(d[c]) > 0));
  const series = [...(cats.length ? cats : ['game', 'library', 'application']), ...extra];
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" {...axis} />
        <YAxis {...axis} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: 'var(--pp-muted)', strokeDasharray: '3 3' }} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: 'var(--pp-muted)' }} />
        {series.map((c) => <Line key={c} type="linear" dataKey={c} name={{ game: 'Games', library: 'Libraries', application: 'Applications', website: 'Websites', tool: 'Tools' }[c]} stroke={CATEGORY_SERIES[c]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--pp-surface)' }} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function FrequencyChart({ data }: { data: { label: string; sessions: number; deployments: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }} barGap={2} barCategoryGap="25%">
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
        <YAxis {...axis} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'color-mix(in srgb, var(--pp-text) 6%, transparent)' }} />
        <Legend iconType="square" wrapperStyle={{ fontSize: 12, color: 'var(--pp-muted)' }} />
        <Bar dataKey="sessions" name="Local update sessions" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="deployments" name="Deployments" fill="var(--series-2)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DailyBars({ data, dataKey = 'changes', name = 'File changes' }: { data: Record<string, number | string>[]; dataKey?: string; name?: string }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="date" {...axis} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
        <YAxis {...axis} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'color-mix(in srgb, var(--pp-text) 6%, transparent)' }} />
        <Bar dataKey={dataKey} name={name} fill="var(--series-1)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal share bars (storage distribution etc.) — labelled, never colour-alone. */
export function ShareBars({ items, format }: { items: { label: string; value: number; color?: string }[]; format: (v: number) => string }) {
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  return (
    <ul className="space-y-2.5">
      {items.map((it) => (
        <li key={it.label} className="text-sm">
          <div className="mb-1 flex justify-between"><span>{it.label}</span><span className="tabular-nums text-muted">{format(it.value)} · {Math.round((100 * it.value) / total)}%</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className={cx('h-full rounded-full')} style={{ width: `${(100 * it.value) / total}%`, background: it.color ?? 'var(--series-1)' }} /></div>
        </li>
      ))}
    </ul>
  );
}
