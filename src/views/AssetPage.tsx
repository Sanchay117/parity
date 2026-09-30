import { lazy, Suspense } from 'react';
import { DevCell, IssuerChip, SectionHead, Stat, StatusBadges, WrapperCell } from '../components/ui.tsx';
import { useHistory } from '../lib/data.ts';
import { bps, pct, price, referenceWhen, shortDescription, usd } from '../lib/format.ts';
import { issuerLabel } from '../lib/issuers.ts';
import type { AssetView, WrapperView } from '../lib/parity.ts';
import type { HistorySummary, Snapshot } from '../lib/types.ts';

// Recharts is only needed here; keep it out of the initial bundle.
const HistoryChart = lazy(() => import('../components/HistoryChart.tsx').then((m) => ({ default: m.HistoryChart })));

interface Props {
  slug: string;
  views: AssetView[];
  snapshot: Snapshot;
  summary: HistorySummary | null;
}

const TYPE_LABEL: Record<string, string> = {
  stock: 'Stock',
  etf: 'ETF',
  commodity: 'Commodity',
  government_security: 'Government security',
  currency: 'Currency',
  real_estate: 'Real estate',
};

function Pick({ kicker, w, why, meta }: { kicker: string; w: WrapperView | null; why: string; meta: Snapshot['tokenMeta'] }) {
  return (
    <div className="card pick">
      <span className="kicker">{kicker}</span>
      {w ? (
        <>
          <span className="name">
            {meta[w.cryptoId]?.logo && <img src={meta[w.cryptoId]!.logo!} alt="" width={26} height={26} style={{ borderRadius: '50%' }} />}
            {w.symbol}
          </span>
          <IssuerChip name={w.issuerName} />
          <span className="why">{why}</span>
        </>
      ) : (
        <span className="why">Not enough liquid wrappers to say.</span>
      )}
    </div>
  );
}

export function AssetPage({ slug, views, snapshot, summary }: Props) {
  const view = views.find((v) => v.asset.slug === slug) ?? views.find((v) => v.asset.symbol === 'SPY') ?? views[0];
  const { asset } = view;
  const ref = view.reference;
  const historyAvailable = summary?.assets.some((a) => a.rwaId === asset.rwaId) ?? false;
  const history = useHistory(historyAvailable ? asset.rwaId : null);
  const hSummary = summary?.assets.find((a) => a.rwaId === asset.rwaId);

  const options = [...views]
    .filter((v) => v.wrappers.some((w) => w.price != null))
    .sort((a, b) => (b.asset.tokenizedMarketCap ?? 0) - (a.asset.tokenizedMarketCap ?? 0));
  const maxDev = Math.max(50, ...view.wrappers.filter((w) => w.eligible).map((w) => Math.abs(w.deviationBps ?? 0)));

  return (
    <>
      <div className="asset-head">
        <div>
          <div className="eyebrow">
            Best way to buy · {TYPE_LABEL[asset.assetType] ?? asset.assetType}
            {asset.primaryExchange ? ` · ${asset.primaryExchange}` : ''}
            {` · ${usd(asset.tokenizedMarketCap)} tokenized`}
          </div>
          <h1 style={{ marginTop: 8 }}>
            {asset.symbol} <span className="muted" style={{ fontWeight: 500 }}>{asset.name}</span>
          </h1>
          {asset.description && <p className="desc">{shortDescription(asset.description)}</p>}
        </div>
        <label className="picker">
          <span className="muted" style={{ fontSize: 13 }}>
            Asset
          </span>
          <select value={asset.slug} onChange={(e) => (window.location.hash = `#/asset/${e.target.value}`)}>
            {options.map((v) => (
              <option key={v.asset.rwaId} value={v.asset.slug}>
                {v.asset.symbol} · {v.asset.name} ({v.wrappers.length})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid cols-4 section" style={{ marginTop: 20 }}>
        <Stat label="Consensus price" value={price(view.consensus)} sub={`${view.method} of ${view.liquidCount} liquid wrapper${view.liquidCount === 1 ? '' : 's'}`} />
        {ref ? (
          <Stat
            label={`Real ${ref.ticker} · ${ref.exchange}`}
            value={price(ref.price)}
            sub={`${referenceWhen(ref)} · wrappers ${bps(view.referenceGapBps, 0)} vs it`}
          />
        ) : (
          <Stat label="Tokenized market cap" value={usd(asset.tokenizedMarketCap)} sub={`${usd(asset.tokenizedVolume24h)} traded in 24h`} />
        )}
        <Stat
          label="CMC average_tokenized_price"
          value={price(asset.avgTokenizedPrice)}
          sub={
            view.cmcVsReference != null && Math.abs(view.cmcVsReference - 1) >= 0.05 ? (
              <span style={{ color: 'var(--critical)' }}>✕ {view.cmcVsReference.toFixed(1)}× the real price</span>
            ) : view.cmcAverageGapBps != null && Math.abs(view.cmcAverageGapBps) >= 100 ? (
              <span style={{ color: 'var(--critical)' }}>
                ✕ {bps(view.cmcAverageGapBps, 0)} vs consensus{view.cmcAverageUntraded ? ', no wrapper trades here' : ''}
              </span>
            ) : (
              `${bps(view.cmcAverageGapBps)} vs consensus`
            )
          }
        />
        <Stat
          label="Spread now"
          value={view.spreadBps != null ? bps(view.spreadBps, 0).replace('+', '') : '—'}
          sub={hSummary?.spreadP50 != null ? `30-day median ${bps(hSummary.spreadP50, 0).replace('+', '')}` : 'cheapest vs richest liquid wrapper'}
        />
      </div>

      <div className="grid cols-3 section" style={{ marginTop: 16 }}>
        <Pick
          kicker="Tracks closest"
          w={view.closest}
          meta={snapshot.tokenMeta}
          why={
            view.closest
              ? `${bps(view.closest.deviationBps)} from consensus with ${pct(view.closest.volumeShare)} of wrapper volume. Closest to where the wrappers collectively trade.`
              : ''
          }
        />
        <Pick
          kicker="Cheapest liquid"
          w={view.cheapest}
          meta={snapshot.tokenMeta}
          why={
            view.cheapest
              ? `${bps(view.cheapest.deviationBps)} vs consensus${view.cheapest.vsReferenceBps != null ? ` (${bps(view.cheapest.vsReferenceBps)} vs the real stock)` : ''}, ${usd(view.cheapest.volume24h)} 24h volume. Cheapest entry, if you can use ${issuerLabel(view.cheapest.issuerName)}.`
              : ''
          }
        />
        <Pick
          kicker="Most liquid"
          w={view.mostLiquid}
          meta={snapshot.tokenMeta}
          why={
            view.mostLiquid
              ? `${pct(view.mostLiquid.volumeShare)} of all wrapper volume (${usd(view.mostLiquid.volume24h)}). Easiest to size in and out of.`
              : ''
          }
        />
      </div>

      <section className="section">
        <SectionHead title="Every wrapper">
          Premium (red) or discount (blue) to the consensus price. Prices shown as quoted by CMC; wrappers in different units are
          normalized before comparing.
          {ref && !ref.marketOpen && ` The ${ref.ticker} market is closed, so the “vs real” column compares 24/7 wrappers with the last close.`}
        </SectionHead>
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Wrapper · chains</th>
                <th>Issuer</th>
                <th className="r">Price</th>
                <th className="r">vs consensus</th>
                {ref && <th className="r">vs real {ref.ticker}</th>}
                <th className="r">24h volume</th>
                <th className="r">Market cap</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {view.wrappers.map((w) => {
                const meta = snapshot.tokenMeta[w.cryptoId];
                return (
                  <tr key={`${w.cryptoId}-${w.issuerId}`} style={{ opacity: w.eligible ? 1 : 0.62 }}>
                    <td>
                      <WrapperCell w={w} meta={meta} />
                    </td>
                    <td>
                      <IssuerChip name={w.issuerName} />
                    </td>
                    <td className="r num">
                      {price(w.price)}
                      {w.unit && (
                        <div className="muted" style={{ fontSize: 12 }} title={w.unit.label}>
                          = {price(w.normalizedPrice)} normalized
                        </div>
                      )}
                    </td>
                    <td className="r">
                      <DevCell value={w.deviationBps} max={maxDev} />
                    </td>
                    {ref && <td className="r num secondary">{bps(w.vsReferenceBps)}</td>}
                    <td className="r num">{usd(w.volume24h)}</td>
                    <td className="r num">{usd(w.marketCap)}</td>
                    <td>
                      <StatusBadges w={w} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {asset.tradfiMarkets.length > 0 && (
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
            Also on TradFi venues:{' '}
            {asset.tradfiMarkets.map((m, i) => (
              <span key={m.url}>
                {i > 0 && ', '}
                <a href={m.url} target="_blank" rel="noreferrer">
                  {m.exchange} ({m.ticker})
                </a>
              </span>
            ))}
          </p>
        )}
      </section>

      <section className="section">
        <SectionHead title="30 days of parity">
          {historyAvailable
            ? 'Hourly premium of each wrapper to that hour’s consensus, replayed from CMC historical quotes. Click the legend to isolate wrappers.'
            : 'Hourly history is backfilled for the 24 most-traded multi-wrapper assets. Pick one of those to see it.'}
        </SectionHead>
        {historyAvailable && (
          <div className="card pad">
            <Suspense fallback={<div className="loading" style={{ padding: 80 }}>Loading chart…</div>}>
              {history ? <HistoryChart history={history} /> : <div className="loading" style={{ padding: 80 }}>Loading history…</div>}
            </Suspense>
          </div>
        )}
        {!historyAvailable && summary && (
          <div className="chips">
            {summary.assets.map((a) => {
              const v = views.find((x) => x.asset.rwaId === a.rwaId);
              return v ? (
                <a key={a.rwaId} className="badge" href={`#/asset/${v.asset.slug}`}>
                  {a.symbol}
                </a>
              ) : null;
            })}
          </div>
        )}
      </section>
    </>
  );
}
