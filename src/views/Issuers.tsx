import { IssuerChip, SectionHead } from '../components/ui.tsx';
import { bps, int, pct, usd } from '../lib/format.ts';
import { analyzeIssuers, issuerTrends, type AssetView } from '../lib/parity.ts';
import type { HistorySummary, Snapshot } from '../lib/types.ts';

interface Props {
  views: AssetView[];
  snapshot: Snapshot;
  summary: HistorySummary | null;
}

export function Issuers({ views, snapshot, summary }: Props) {
  const issuers = analyzeIssuers(views, snapshot.issuers);
  const trends = new Map((summary ? issuerTrends(summary, 1) : []).map((t) => [t.issuerName, t]));
  const maxShare = Math.max(...issuers.map((i) => i.marketCapShare));

  return (
    <>
      <section className="hero" style={{ paddingBottom: 0 }}>
        <div className="eyebrow">Issuer league table</div>
        <h1 style={{ fontSize: 'clamp(30px, 4vw, 44px)' }}>Who issues it matters.</h1>
        <p className="lede">
          The same stock can be wrapped by Backed (xStocks), Ondo, bStocks, Robinhood, Reality and others. Each wrapper is scored against
          the <strong>other</strong> wrappers of the same asset, so a dominant issuer can't grade itself.
        </p>
      </section>

      <section className="section">
        <SectionHead title="Scorecard">
          Tracking error is the median distance from peer wrappers across an issuer's liquid wrappers. Grades need at least 3 liquid
          wrappers: A ≤ 5 bps, B ≤ 12, C ≤ 25, D ≤ 60, F beyond.
        </SectionHead>
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Issuer</th>
                <th className="r">Grade</th>
                <th className="r">Tracking error</th>
                <th className="r">Typical price vs peers</th>
                <th className="r">30-day avg vs consensus</th>
                <th>Share of tokenized value</th>
                <th className="r">Wrappers (liquid)</th>
                <th>Problems</th>
              </tr>
            </thead>
            <tbody>
              {issuers.map((i) => {
                const t = trends.get(i.name);
                return (
                  <tr key={i.issuerId}>
                    <td>
                      <IssuerChip name={i.name} />
                      {i.website && (
                        <div style={{ fontSize: 12 }}>
                          <a href={i.website} target="_blank" rel="noreferrer" className="muted">
                            {new URL(i.website).hostname.replace('www.', '')}
                          </a>
                        </div>
                      )}
                    </td>
                    <td className="r">
                      <span className="grade" title={i.grade === '–' ? 'Fewer than 3 liquid wrappers' : undefined}>
                        {i.grade}
                      </span>
                    </td>
                    <td className="r num">{i.medianAbsDevBps != null ? bps(i.medianAbsDevBps).replace('+', '') : '—'}</td>
                    <td className="r num">
                      {i.medianPremiumBps != null && (
                        <span
                          className="swatch"
                          style={{
                            display: 'inline-block',
                            marginRight: 6,
                            background: i.medianPremiumBps > 0 ? 'var(--div-pos)' : 'var(--div-neg)',
                          }}
                        />
                      )}
                      {bps(i.medianPremiumBps)}
                    </td>
                    <td className="r num secondary">{t ? `${bps(t.meanDevBps)} · ${t.assets} asset${t.assets === 1 ? '' : 's'}` : '—'}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 60, height: 8, background: 'var(--surface-2)', borderRadius: 4 }} title={usd(i.marketCap)}>
                          <div
                            style={{
                              width: `${Math.max(1, (i.marketCapShare / maxShare) * 100)}%`,
                              height: '100%',
                              background: 'var(--accent)',
                              borderRadius: 4,
                            }}
                          />
                        </div>
                        <span className="num secondary" style={{ fontSize: 13 }}>
                          {pct(i.marketCapShare, 1)}
                        </span>
                      </div>
                    </td>
                    <td className="r num" title={`${int(i.numTokens)} tokens issued in total (CMC num_tokens)`}>
                      {i.wrappers} <span className="muted">({i.liquid})</span>
                    </td>
                    <td>
                      <div className="chips">
                        {i.unitMismatches > 0 && <span className="badge warning">⚠ {i.unitMismatches} units</span>}
                        {i.offPeg > 0 && <span className="badge critical">✕ {i.offPeg} off-peg</span>}
                        {i.noPrice > 0 && <span className="badge critical">{i.noPrice} no price</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          Grades measure how tightly an issuer's wrappers track their peers on price, nothing about custody, solvency or product
          quality. Tracking error, typical price and wrapper counts cover every asset in the snapshot with at least two liquid
          wrappers; the 30-day column covers the {summary?.assets.length ?? 0} assets with hourly history. Hover a wrapper count for the
          issuer's total <code>num_tokens</code> from <code>/v5/real-world-assets/issuers/list</code>.
        </p>
      </section>
    </>
  );
}
