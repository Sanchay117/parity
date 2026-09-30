import type { ReactNode } from 'react';
import { bps, usd } from '../lib/format.ts';
import { issuerColor, issuerLabel } from '../lib/issuers.ts';
import type { WrapperView } from '../lib/parity.ts';
import type { TokenMeta } from '../lib/types.ts';

/** Diverging bar: discount (left, blue) or premium (right, red), clipped at ±max. */
export function DevBar({ value, max = 150 }: { value: number | null; max?: number }) {
  if (value == null) return <div className="devbar" aria-hidden />;
  const clipped = Math.abs(value) > max;
  const width = `${Math.max(2, (Math.min(Math.abs(value), max) / max) * 100)}%`;
  return (
    <div className={`devbar${clipped ? ' clipped' : ''}`} aria-hidden>
      <div className="neg" style={{ width: value < 0 ? width : 0 }} />
      <div className="pos" style={{ width: value > 0 ? width : 0 }} />
    </div>
  );
}

export function DevCell({ value, max }: { value: number | null; max?: number }) {
  return (
    <div className="dev-cell">
      <DevBar value={value} max={max} />
      <span className="num">{bps(value)}</span>
    </div>
  );
}

export function IssuerChip({ name }: { name: string }) {
  return (
    <span className="issuer-chip">
      <span className="swatch" style={{ background: issuerColor(name) }} />
      {issuerLabel(name)}
    </span>
  );
}

export function WrapperCell({ w, meta }: { w: { symbol: string; name: string; cryptoId: number }; meta?: TokenMeta }) {
  return (
    <div className="wrapper-cell">
      {meta?.logo ? <img src={meta.logo} alt="" loading="lazy" /> : <span className="logo-fallback" />}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>
          <a href={`https://coinmarketcap.com/currencies/id/${w.cryptoId}/`} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
            {w.symbol}
          </a>
        </div>
        <div
          className="muted"
          title={meta?.chains.length ? `${w.name}\nChains: ${meta.chains.join(', ')}` : w.name}
          style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}
        >
          {meta?.chains.length
            ? `${meta.chains.slice(0, 2).join(', ')}${meta.chains.length > 2 ? ` +${meta.chains.length - 2}` : ''}`
            : w.name}
        </div>
      </div>
    </div>
  );
}

export function StatusBadges({ w }: { w: WrapperView }) {
  const out: ReactNode[] = [];
  if (w.unit) out.push(<span key="u" className="badge warning" title={w.unit.label}>⚠ units</span>);
  if (w.offPeg && !w.unit) out.push(<span key="o" className="badge critical">✕ off-peg</span>);
  if (w.status === 'no-price') out.push(<span key="p" className="badge critical">no price</span>);
  if (w.status === 'no-volume') out.push(<span key="v" className="badge">no volume</span>);
  if (w.status === 'illiquid') out.push(<span key="i" className="badge">thin</span>);
  return <div className="chips">{out}</div>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function SectionHead({ title, children, right }: { title: string; children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        {children && <p style={{ marginTop: 4 }}>{children}</p>}
      </div>
      {right}
    </div>
  );
}

/** Compact wrapper summary for dense tables: logo, symbol, issuer, deviation and volume. */
export function WrapperMini({ w, meta }: { w: WrapperView; meta?: TokenMeta }) {
  const tone = (w.deviationBps ?? 0) < 0 ? 'var(--div-neg)' : 'var(--div-pos)';
  return (
    <div className="wrapper-cell">
      {meta?.logo ? <img src={meta.logo} alt="" loading="lazy" /> : <span className="logo-fallback" />}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>{w.symbol}</b>
          <IssuerChip name={w.issuerName} />
        </div>
        <div className="num" style={{ fontSize: 12 }}>
          <span className="swatch" style={{ background: tone, display: 'inline-block', marginRight: 5, width: 7, height: 7 }} />
          <span className="secondary">{bps(w.deviationBps)}</span>
          <span className="muted"> · {usd(w.volume24h)} 24h</span>
        </div>
      </div>
    </div>
  );
}
