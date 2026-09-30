import { bps, int, price, usd } from '../lib/format.ts';
import { issuerLabel } from '../lib/issuers.ts';
import {
  analyzeIssuers,
  DISLOCATION_BPS,
  findSpreads,
  integrityReport,
  issuerTrends,
  TRADEABLE_VOLUME_USD,
  type AssetView,
} from '../lib/parity.ts';
import type { HistorySummary, Snapshot } from '../lib/types.ts';
import { DevCell, IssuerChip, SectionHead, Stat, WrapperMini } from '../components/ui.tsx';
import { Findings } from './Findings.tsx';

interface Props {
  views: AssetView[];
  snapshot: Snapshot;
  summary: HistorySummary | null;
}

const go = (slug: string) => {
  window.location.hash = `#/asset/${slug}`;
};

export function Radar({ views, snapshot, summary }: Props) {
  const spreads = findSpreads(views);
  const integrity = integrityReport(views);
  const trends = summary ? issuerTrends(summary) : [];
  const issuerViews = analyzeIssuers(views, snapshot.issuers);
  const history = new Map(summary?.assets.map((a) => [a.rwaId, a]) ?? []);

  const tracked = views.reduce((s, v) => s + (v.asset.tokenizedMarketCap ?? 0), 0);
  const wrappers = views.reduce((s, v) => s + v.wrappers.length, 0);
  const priced = views.reduce((s, v) => s + v.wrappers.filter((w) => w.price != null).length, 0);
  const issuerCount = new Set(views.flatMap((v) => v.wrappers.map((w) => w.issuerId))).size;
  const findingCount =
    integrity.unitMismatches.length + integrity.aggregateGaps.length + snapshot.apiIssues.length + (integrity.noPrice.length ? 1 : 0);

  // Lead with the most recognizable persistent spread: the S&P 500 if we have it.
  const spyView = views.find((v) => v.asset.symbol === 'SPY');
  const spyHistory = spyView ? history.get(spyView.asset.rwaId) : undefined;
  const lead = spyHistory ?? summary?.assets[0];
  const leadView = lead ? views.find((v) => v.asset.rwaId === lead.rwaId) : undefined;
  const richest = trends[0];
  const cheapest = trends.at(-1);
  const worstAggregate = integrity.aggregateGaps[0];

  return (
    <>
      <section className="hero">
        <div className="eyebrow">Tokenized real-world asset parity radar</div>
        <h1>Same asset. Different price.</h1>
        <p className="lede">
          {leadView && lead?.spreadP50 != null ? (
            <>
              {leadView.asset.name} has <strong>{leadView.wrappers.length} tokenized wrappers</strong> on CoinMarketCap. Over the last 30
              days they traded a median <strong>{bps(lead.spreadP50, 0).replace('+', '')}</strong> apart.{' '}
            </>
          ) : null}
          Parity reads every wrapper of every tokenized stock, ETF and commodity, puts them on the same units, and shows which trade
          rich, which trade cheap, and which are simply broken.
        </p>
      </section>

      <div className="grid cols-4 section" style={{ marginTop: 28 }}>
        <Stat label="Tokenized value analysed" value={usd(tracked)} sub={`${views.length} assets of ${int(snapshot.universe.totalAssets)} listed`} />
        <Stat label="Wrappers compared" value={int(priced)} sub={`of ${int(wrappers)} listed, from ${issuerCount} issuers`} />
        <Stat label={`Spreads ≥ ${DISLOCATION_BPS} bps`} value={spreads.length} sub={`both sides ≥ ${usd(TRADEABLE_VOLUME_USD)} 24h volume`} />
        <Stat label="API data issues found" value={findingCount} sub="unit mix-ups, bad aggregates, errors" />
      </div>

      <div className="grid cols-3 section" style={{ marginTop: 16 }}>
        {lead && leadView && (
          <a className="card insight" href={`#/asset/${leadView.asset.slug}`} style={{ color: 'inherit', textDecoration: 'none' }}>
            <span className="kicker">Persistent, not a blip</span>
            <span className="big">{bps(lead.spreadP50, 0).replace('+', '')}</span>
            <p>
              Median gap between the cheapest and richest liquid <strong>{leadView.asset.symbol}</strong> wrapper, every hour for{' '}
              {Math.round(lead.hours / 24)} days. 95th percentile: {bps(lead.spreadP95, 0).replace('+', '')}.
            </p>
          </a>
        )}
        {richest && cheapest && (
          <a className="card insight" href="#/issuers" style={{ color: 'inherit', textDecoration: 'none' }}>
            <span className="kicker">Who charges you more</span>
            <span className="big">
              {issuerLabel(richest.issuerName)} {bps(richest.meanDevBps, 0)}
            </span>
            <p>
              Average 30-day premium to consensus across {richest.assets} assets. The same exposure via{' '}
              <strong>{issuerLabel(cheapest.issuerName)}</strong> averaged {bps(cheapest.meanDevBps, 0)}.
            </p>
          </a>
        )}
        {worstAggregate && (
          <a className="card insight" href={`#/asset/${worstAggregate.asset.slug}`} style={{ color: 'inherit', textDecoration: 'none' }}>
            <span className="kicker">CMC's own average is off</span>
            <span className="big">
              {(1 + (worstAggregate.cmcAverageGapBps as number) / 10_000).toFixed(1)}× too high
            </span>
            <p>
              CoinMarketCap reports tokenized <strong>{worstAggregate.asset.symbol}</strong> at {price(worstAggregate.asset.avgTokenizedPrice)}.
              Normalized for units, its wrappers agree on {price(worstAggregate.consensus)}.
            </p>
          </a>
        )}
      </div>

      <section className="section">
        <SectionHead
          title="Widest spreads right now"
          right={<span className="muted" style={{ fontSize: 13 }}>Click a row for the full wrapper breakdown</span>}
        >
          Liquid wrappers of the same underlying, cheapest vs richest. Both legs trade at least {usd(TRADEABLE_VOLUME_USD)} a day.
        </SectionHead>
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th className="r">Spread now</th>
                <th className="r">30-day median</th>
                <th>Cheapest wrapper</th>
                <th>Richest wrapper</th>
              </tr>
            </thead>
            <tbody>
              {spreads.slice(0, 15).map((v) => {
                const t = v.tradeable!;
                const h = history.get(v.asset.rwaId);
                return (
                  <tr key={v.asset.rwaId} className="clickable" onClick={() => go(v.asset.slug)}>
                    <td>
                      <b>{v.asset.symbol}</b>
                      <div className="muted" style={{ fontSize: 12, maxWidth: 180, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {v.asset.name}
                      </div>
                    </td>
                    <td className="r num" style={{ fontWeight: 600 }}>
                      {bps(t.spreadBps, 0).replace('+', '')}
                    </td>
                    <td className="r num secondary">{h?.spreadP50 != null ? bps(h.spreadP50, 0).replace('+', '') : '—'}</td>
                    <td>
                      <WrapperMini w={t.cheap} meta={snapshot.tokenMeta[t.cheap.cryptoId]} />
                    </td>
                    <td>
                      <WrapperMini w={t.rich} meta={snapshot.tokenMeta[t.rich.cryptoId]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <SectionHead title="Issuer premium">
          {trends.length
            ? 'Average premium (red) or discount (blue) of each issuer’s wrappers to consensus, over 30 days of hourly prices.'
            : 'Median premium of each issuer’s wrappers to the other wrappers of the same asset.'}
        </SectionHead>
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Issuer</th>
                <th className="r">{trends.length ? '30-day avg vs consensus' : 'Median vs peers'}</th>
                <th className="r">Above consensus in</th>
                <th className="r">Assets</th>
              </tr>
            </thead>
            <tbody>
              {(trends.length
                ? trends.map((t) => ({ name: t.issuerName, dev: t.meanDevBps, rich: t.richShare, n: t.assets }))
                : issuerViews
                    .filter((i) => i.medianPremiumBps != null && i.liquid >= 3)
                    .map((i) => ({ name: i.name, dev: i.medianPremiumBps as number, rich: null, n: i.liquid }))
              ).map((r) => (
                <tr key={r.name}>
                  <td>
                    <IssuerChip name={r.name} />
                  </td>
                  <td className="r">
                    <DevCell value={r.dev} max={40} />
                  </td>
                  <td className="r num secondary">{r.rich != null ? `${Math.round(r.rich * 100)}% of assets` : '—'}</td>
                  <td className="r num secondary">{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Findings views={views} snapshot={snapshot} integrity={integrity} />
    </>
  );
}
