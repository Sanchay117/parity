import { bps, int, price, referenceWhen, usd } from '../lib/format.ts';
import { issuerLabel } from '../lib/issuers.ts';
import {
  analyzeIssuers,
  DISLOCATION_BPS,
  findSpreads,
  dividendStudy,
  integrityReport,
  pairedDividendFit,
  issuerTrends,
  median,
  referenceGaps,
  TRADEABLE_VOLUME_USD,
  type AssetView,
} from '../lib/parity.ts';
import type { HistorySummary, Snapshot } from '../lib/types.ts';
import { DevCell, IssuerChip, SectionHead, Stat, WrapperMini } from '../components/ui.tsx';
import { Findings } from './Findings.tsx';
import { DividendScatter } from '../components/DividendScatter.tsx';

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
  const findingCount = integrity.unitMismatches.length + integrity.aggregateGaps.length + snapshot.apiIssues.length;

  // Lead with the most recognizable persistent spread: the S&P 500 if we have it.
  const spyView = views.find((v) => v.asset.symbol === 'SPY');
  const spyHistory = spyView ? history.get(spyView.asset.rwaId) : undefined;
  const lead = spyHistory ?? summary?.assets[0];
  const leadView = lead ? views.find((v) => v.asset.rwaId === lead.rwaId) : undefined;
  const richest = trends[0];
  const cheapest = trends.at(-1);
  // Lead with the average furthest from the real stock; else one that blends units into a price no wrapper trades at.
  const worstAggregate =
    [...integrity.aggregateGaps].filter((v) => v.cmcVsReference != null).sort((a, b) => (b.cmcVsReference ?? 0) - (a.cmcVsReference ?? 0))[0] ??
    integrity.aggregateGaps.find((v) => v.cmcAverageUntraded) ??
    integrity.aggregateGaps[0];
  const unitWrapper = worstAggregate?.wrappers.find((w) => w.unit);
  const unitPhrase =
    unitWrapper && unitWrapper.unit!.factor < 1
      ? `${unitWrapper.symbol} is quoted per ${Math.round(1 / unitWrapper.unit!.factor)} shares`
      : 'its wrappers are quoted in different units';
  const gaps = referenceGaps(views);
  const dividends = dividendStudy(views);
  const ondoFit = dividends.fits.find((f) => f.issuerName === 'Ondo Assets');
  const ondoPaired = pairedDividendFit(views, 'Ondo Assets');
  const flatFits = dividends.fits.filter((f) => Math.abs(f.slope ?? 1) < 0.15);
  const medianGap = median(gaps.map((v) => v.referenceGapBps as number));
  const refClosed = gaps.some((v) => !v.reference?.marketOpen);
  const aggregatePrices = worstAggregate
    ? worstAggregate.wrappers.filter((w) => w.price != null && !w.offPeg).map((w) => w.price as number)
    : [];

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
        <Stat
          label="API data issues found"
          value={findingCount}
          sub={`${integrity.unitMismatches.length} unit mix-ups · ${integrity.aggregateGaps.length} bad averages · ${snapshot.apiIssues.length} API errors`}
        />
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
          <a className="card insight" href={ondoFit ? '#/dividends' : '#/issuers'} style={{ color: 'inherit', textDecoration: 'none' }}>
            <span className="kicker">{ondoFit ? 'Why Ondo trades rich' : 'Who charges you more'}</span>
            <span className="big">
              {issuerLabel(richest.issuerName)} {bps(richest.meanDevBps, 0)}
            </span>
            <p>
              Average 30-day premium to consensus across {richest.assets} assets
              {ondoFit && richest.issuerName === 'Ondo Assets' ? (
                <>
                  . Much of it tracks <strong>dividends</strong>: against a price-only wrapper of the same stock, Ondo's gap grows with
                  dividend yield{ondoPaired ? ` (R² ${ondoPaired.r2!.toFixed(2)} across ${ondoPaired.n} stocks)` : ''}.
                </>
              ) : (
                <>
                  . The same exposure via <strong>{issuerLabel(cheapest.issuerName)}</strong> averaged {bps(cheapest.meanDevBps, 0)}.
                </>
              )}
            </p>
          </a>
        )}
        {worstAggregate && (
          <a className="card insight" href={`#/asset/${worstAggregate.asset.slug}`} style={{ color: 'inherit', textDecoration: 'none' }}>
            <span className="kicker">CMC's own average is off</span>
            <span className="big">
              {worstAggregate.cmcVsReference != null
                ? `${worstAggregate.cmcVsReference.toFixed(1)}× the real price`
                : price(worstAggregate.asset.avgTokenizedPrice)}
            </span>
            {worstAggregate.reference ? (
              <p>
                CoinMarketCap's <code>average_tokenized_price</code> for <strong>{worstAggregate.asset.symbol}</strong> is{' '}
                {price(worstAggregate.asset.avgTokenizedPrice)}. The real stock last traded at {price(worstAggregate.reference.price)} on{' '}
                {worstAggregate.reference.exchange}. {unitPhrase[0].toUpperCase() + unitPhrase.slice(1)}, and the average blends them.
              </p>
            ) : (
              <p>
                CoinMarketCap's <code>average_tokenized_price</code> for <strong>{worstAggregate.asset.symbol}</strong>.
                {worstAggregate.cmcAverageUntraded ? ' No wrapper trades there: they' : ' Its wrappers'} trade at{' '}
                {price(Math.min(...aggregatePrices))} and {price(Math.max(...aggregatePrices))}, the same share in two different units.
              </p>
            )}
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

      {gaps.length > 0 && (
        <section className="section">
          <SectionHead title="Tokenized vs the real stock">
            Wrapper consensus against the listed stock or ETF itself, across {gaps.length} assets (median{' '}
            {bps(medianGap, 0)}).
            {refClosed
              ? ' US markets are closed right now: wrappers keep trading 24/7, so part of each gap is news since the close.'
              : ''}{' '}
            Big premiums on dividend payers are mostly reinvested dividends: see <a href="#/dividends">the dividend effect</a>.
          </SectionHead>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th className="r">Real price</th>
                  <th className="r">Wrapper consensus</th>
                  <th className="r">Gap</th>
                  <th>Closest-to-real wrapper</th>
                  <th className="r">CMC average</th>
                </tr>
              </thead>
              <tbody>
                {gaps.slice(0, 10).map((v) => {
                  const ref = v.reference!;
                  const best = [...v.wrappers]
                    .filter((w) => w.eligible && w.vsReferenceBps != null)
                    .sort((a, b) => Math.abs(a.vsReferenceBps as number) - Math.abs(b.vsReferenceBps as number))[0];
                  return (
                    <tr key={v.asset.rwaId} className="clickable" onClick={() => go(v.asset.slug)}>
                      <td>
                        <b>{v.asset.symbol}</b>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {ref.exchange} · {referenceWhen(ref)}
                        </div>
                      </td>
                      <td className="r num">{price(ref.price)}</td>
                      <td className="r num">{price(v.consensus)}</td>
                      <td className="r">
                        <DevCell value={v.referenceGapBps} max={150} />
                      </td>
                      <td>{best ? <WrapperMini w={{ ...best, deviationBps: best.vsReferenceBps }} meta={snapshot.tokenMeta[best.cryptoId]} /> : '—'}</td>
                      <td className="r num secondary">
                        {v.cmcVsReference != null && Math.abs(v.cmcVsReference - 1) >= 0.05 ? (
                          <span style={{ color: 'var(--critical)' }}>✕ {v.cmcVsReference.toFixed(1)}×</span>
                        ) : (
                          price(v.asset.avgTokenizedPrice)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Real prices are last regular-session quotes from {gaps[0].reference!.source}, an external reference: CoinMarketCap has
            no quote for the underlying listed instrument.
          </p>
        </section>
      )}

      {ondoFit && (
        <section className="section" id="dividends">
          <SectionHead title="The dividend effect">
            Why some issuers look expensive. Each dot is one wrapper, plotted by the real stock's dividend yield against the wrapper's
            premium to the real price.
          </SectionHead>
          <div className="grid cols-2-1">
            <div className="card pad">
              <DividendScatter points={dividends.points} fits={dividends.fits} />
            </div>
            <div className="grid">
              <div className="card insight">
                <span className="kicker">Ondo vs the real stock, {ondoFit.n} assets</span>
                <span className="big">{ondoFit.slope!.toFixed(2)}</span>
                <p>
                  Extra premium per 1% of dividend yield (R² {ondoFit.r2!.toFixed(2)}). Non-payers:{' '}
                  {ondoFit.nonPayersMedian! > 0 ? '+' : ''}
                  {ondoFit.nonPayersMedian!.toFixed(2)}%. Yield over 2%: <strong>+{ondoFit.payersMedian!.toFixed(2)}%</strong>.
                </p>
              </div>
              {ondoPaired && (
                <div className="card insight">
                  <span className="kicker">Same stock, Ondo vs price-only wrapper</span>
                  <span className="big">{ondoPaired.slope!.toFixed(2)}</span>
                  <p>
                    The stricter test: {ondoPaired.n} stocks where Ondo and bStocks, Robinhood or Reality both trade. Comparing inside one
                    stock cancels stock choice and after-hours moves; the gap still grows with yield (R² {ondoPaired.r2!.toFixed(2)}).
                  </p>
                </div>
              )}
              <div className="card insight">
                <span className="kicker">What it means</span>
                <p>
                  The pattern is consistent with Ondo's tokens reinvesting dividends (net of US withholding tax) while
                  {flatFits.length > 0 ? ` ${flatFits.map((f) => issuerLabel(f.issuerName)).join(', ')}` : ' price-only wrappers'} track the
                  share price alone. We infer this from prices, not from issuer documentation. Either way, a{' '}
                  <strong>dividend-paying</strong> stock's Ondo wrapper should be compared after adjusting for dividends, not read as overpriced.
                </p>
              </div>
            </div>
          </div>
          <div className="card table-wrap" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>Issuer</th>
                  <th className="r">Assets</th>
                  <th className="r">Slope (premium per 1% yield)</th>
                  <th className="r">R²</th>
                  <th className="r">Median vs real, yield over 2%</th>
                  <th className="r">Median vs real, non-payers</th>
                </tr>
              </thead>
              <tbody>
                {dividends.fits.map((f) => (
                  <tr key={f.issuerName}>
                    <td>
                      <IssuerChip name={f.issuerName} />
                    </td>
                    <td className="r num">{f.n}</td>
                    <td className="r num" style={{ fontWeight: 600 }}>
                      {f.slope?.toFixed(2)}
                    </td>
                    <td className="r num secondary">{f.r2?.toFixed(2)}</td>
                    <td className="r num secondary">{f.payersMedian != null ? `${f.payersMedian > 0 ? '+' : ''}${f.payersMedian.toFixed(2)}%` : '—'}</td>
                    <td className="r num secondary">
                      {f.nonPayersMedian != null ? `${f.nonPayersMedian > 0 ? '+' : ''}${f.nonPayersMedian.toFixed(2)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Dividends and real prices from {gaps[0]?.reference?.source ?? 'an external source'}. Different issuers wrap different stocks
            and tokens launched recently have accrued fewer dividends, which is why the same-stock comparison above is the one to
            trust. A low R² means yield explains little of that issuer's premium.
          </p>
        </section>
      )}

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
