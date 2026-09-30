import { useState } from 'react';
import { issuerColor, issuerLabel } from '../lib/issuers.ts';
import type { DividendFit, DividendPoint } from '../lib/parity.ts';

// Three series at most on a scatter (every pair of colors sits side by side): the two
// total-return-looking issuers get their own colors, everyone else folds into one gray group.
const HIGHLIGHT = ['Ondo Assets', 'Backed Assets'];
const OTHER = 'Price-only issuers';

const W = 680;
const H = 360;
const M = { top: 16, right: 16, bottom: 44, left: 52 };
const Y_MIN = -3;
const Y_MAX = 6;

function niceMax(v: number) {
  return Math.max(2, Math.ceil(v));
}

export function DividendScatter({ points, fits }: { points: DividendPoint[]; fits: DividendFit[] }) {
  const [hover, setHover] = useState<DividendPoint | null>(null);
  const xMax = niceMax(Math.min(8, Math.max(...points.map((p) => p.yieldPct))));
  const x = (v: number) => M.left + (Math.min(v, xMax) / xMax) * (W - M.left - M.right);
  const y = (v: number) => M.top + ((Y_MAX - Math.max(Y_MIN, Math.min(Y_MAX, v))) / (Y_MAX - Y_MIN)) * (H - M.top - M.bottom);
  const group = (p: DividendPoint) => (HIGHLIGHT.includes(p.issuerName) ? p.issuerName : OTHER);
  const color = (g: string) => (g === OTHER ? 'var(--series-other)' : issuerColor(g));
  // Draw gray first so the highlighted issuers sit on top.
  const ordered = [...points].sort((a, b) => Number(group(a) !== OTHER) - Number(group(b) !== OTHER));
  const xTicks = Array.from({ length: xMax + 1 }, (_, i) => i);
  const yTicks = [-2, 0, 2, 4, 6];

  return (
    <div>
      <div className="legend" style={{ marginBottom: 6 }}>
        {[...HIGHLIGHT, OTHER].map((g) => (
          <span key={g} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className="swatch" style={{ background: color(g), borderRadius: '50%' }} />
            {g === OTHER ? 'bStocks, Robinhood, Reality & others' : issuerLabel(g)}
          </span>
        ))}
        <span className="muted">Dashed: least-squares fit</span>
      </div>
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Wrapper premium to the real price against dividend yield">
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={t === 0 ? 1.5 : 1} />
              <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--text-muted)">
                {t > 0 ? `+${t}` : t}%
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={`x${t}`} x={x(t)} y={H - M.bottom + 18} textAnchor="middle" fontSize="12" fill="var(--text-muted)">
              {t}%
            </text>
          ))}
          <text x={(M.left + W - M.right) / 2} y={H - 6} textAnchor="middle" fontSize="12" fill="var(--text-secondary)">
            Dividends paid over the last 12 months, % of share price
          </text>
          <text
            transform={`translate(14 ${(M.top + H - M.bottom) / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize="12"
            fill="var(--text-secondary)"
          >
            Wrapper price vs real stock
          </text>
          {fits
            .filter((f) => HIGHLIGHT.includes(f.issuerName) && f.slope != null)
            .map((f) => {
              const pts = points.filter((p) => p.issuerName === f.issuerName);
              const mx = pts.reduce((s, p) => s + p.yieldPct, 0) / pts.length;
              const my = pts.reduce((s, p) => s + p.premiumPct, 0) / pts.length;
              const at = (v: number) => my + (f.slope as number) * (v - mx);
              return (
                <line
                  key={f.issuerName}
                  x1={x(0)}
                  y1={y(at(0))}
                  x2={x(xMax)}
                  y2={y(at(xMax))}
                  stroke={color(f.issuerName)}
                  strokeWidth={2}
                  strokeDasharray="6 5"
                />
              );
            })}
          {ordered.map((p, i) => (
            <circle
              key={`${p.slug}-${p.issuerName}-${i}`}
              cx={x(p.yieldPct)}
              cy={y(p.premiumPct)}
              r={hover === p ? 6.5 : 4.5}
              fill={color(group(p))}
              stroke="var(--surface-1)"
              strokeWidth={2}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover(p)}
              onMouseLeave={() => setHover(null)}
              onClick={() => (window.location.hash = `#/asset/${p.slug}`)}
            />
          ))}
        </svg>
        {hover && (
          <div
            className="chart-tooltip"
            style={{
              position: 'absolute',
              pointerEvents: 'none',
              left: `${(x(hover.yieldPct) / W) * 100}%`,
              top: `${(y(hover.premiumPct) / H) * 100}%`,
              transform: 'translate(12px, -110%)',
              minWidth: 180,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {hover.symbol} · {hover.wrapper}
            </div>
            <div className="row">
              <span>{issuerLabel(hover.issuerName)}</span>
            </div>
            <div className="row">
              <span>Dividend yield</span>
              <span className="num">{hover.yieldPct.toFixed(2)}%</span>
            </div>
            <div className="row">
              <span>vs real stock</span>
              <span className="num">
                {hover.premiumPct > 0 ? '+' : ''}
                {hover.premiumPct.toFixed(2)}%
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
