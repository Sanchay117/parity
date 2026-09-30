import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { bps } from '../lib/format.ts';
import { issuerColor, issuerLabel } from '../lib/issuers.ts';
import { analyzeHistory, percentile } from '../lib/parity.ts';
import type { AssetHistory } from '../lib/types.ts';

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const timeFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

interface TooltipProps {
  active?: boolean;
  label?: number;
  payload?: { dataKey: string; value: number | null; color: string }[];
  names: Record<string, string>;
}

function ChartTooltip({ active, label, payload, names }: TooltipProps) {
  if (!active || !payload?.length || label == null) return null;
  const rows = [...payload].filter((p) => p.value != null).sort((a, b) => (b.value as number) - (a.value as number));
  return (
    <div className="chart-tooltip">
      <div className="muted" style={{ marginBottom: 6 }}>
        {timeFmt.format(label * 1000)} UTC
      </div>
      {rows.map((p) => (
        <div className="row" key={p.dataKey}>
          <span>
            <span className="swatch" style={{ background: p.color }} />
            {names[p.dataKey]}
          </span>
          <span className="num">{bps(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Every wrapper's premium to consensus, hourly, with a toggleable legend. */
export function HistoryChart({ history }: { history: AssetHistory }) {
  const view = useMemo(() => analyzeHistory(history), [history]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [smooth, setSmooth] = useState(true);

  // Drop wrappers that were priced for less than a fifth of the window.
  const series = useMemo(
    () =>
      view.series
        .map((s) => ({ ...s, key: `w${s.cryptoId}` }))
        .filter((s) => s.devBps.filter((d) => d != null).length > view.t.length * 0.2),
    [view],
  );

  // Identity is never color alone: a second wrapper from the same issuer (NVDAX / WNVDAX) and the
  // gray "other" issuers each get their own dash pattern.
  const DASHES = [undefined, '5 4', '2 3', '8 3 2 3'];
  const seen = new Map<string, number>();
  const styled = series.map((s) => {
    const color = issuerColor(s.issuerName);
    const group = color === 'var(--series-other)' ? 'other' : s.issuerName;
    const n = seen.get(group) ?? 0;
    seen.set(group, n + 1);
    return { ...s, color, dash: DASHES[n % DASHES.length] };
  });

  const rows = useMemo(() => {
    const lines = series.map((s) => (smooth ? rollingMean(s.devBps, 24) : s.devBps));
    return view.t.map((t, i) => {
      const row: Record<string, number | null> = { t };
      series.forEach((s, j) => {
        const d = lines[j][i];
        row[s.key] = d == null ? null : Math.round(d * 10) / 10;
      });
      return row;
    });
  }, [view, series, smooth]);

  // Clip the y-range to the bulk of the data so a single bad print doesn't flatten everything.
  const all = rows.flatMap((r) => series.map((s) => r[s.key]).filter((d): d is number => d != null));
  const lo = Math.min(-10, percentile(all, 0.5) ?? -10);
  const hi = Math.max(10, percentile(all, 99.5) ?? 10);
  const ticks = niceTicks(lo - (hi - lo) * 0.06, hi + (hi - lo) * 0.06);
  const names = Object.fromEntries(styled.map((s) => [s.key, `${s.symbol} · ${issuerLabel(s.issuerName)}`]));

  const toggle = (key: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div>
      <label className="muted" style={{ fontSize: 13, display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
        <input type="checkbox" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} />
        Smooth to a trailing 24-hour average
      </label>
      <div className="legend">
        {styled.map((s) => (
          <button key={s.key} onClick={() => toggle(s.key)} aria-pressed={!hidden.has(s.key)}>
            <span
              className="line"
              style={{
                background: s.dash ? `repeating-linear-gradient(90deg, ${s.color} 0 5px, transparent 5px 8px)` : s.color,
              }}
            />
            {s.symbol} <span className="muted">· {issuerLabel(s.issuerName)}</span>
            <span className="num muted">avg {bps(s.meanDevBps, 0)}</span>
          </button>
        ))}
      </div>
      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(t: number) => dateFmt.format(t * 1000)}
              tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
              axisLine={{ stroke: 'var(--border)' }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={[ticks[0], ticks.at(-1)!]}
              ticks={ticks}
              allowDataOverflow
              tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}`}
              tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={48}
              label={{ value: 'bps vs consensus', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 12, dy: 50 }}
            />
            <ReferenceLine y={0} stroke="var(--text-muted)" strokeOpacity={0.7} />
            <Tooltip
              content={<ChartTooltip names={names} />}
              cursor={{ stroke: 'var(--text-muted)', strokeDasharray: '3 3' }}
            />
            {styled.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dash}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface-1)' }}
                isAnimationActive={false}
                connectNulls={false}
                hide={hidden.has(s.key)}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function rollingMean(values: (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const add = values[i];
    if (add != null) {
      sum += add;
      n++;
    }
    const drop = i >= window ? values[i - window] : null;
    if (drop != null) {
      sum -= drop;
      n--;
    }
    out.push(add == null || n === 0 ? null : sum / n);
  }
  return out;
}

/** Round tick values (…, -50, -25, 0, 25, 50, …) spanning [lo, hi], always including 0. */
function niceTicks(lo: number, hi: number): number[] {
  const raw = (hi - lo) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}
