import { bps, price } from '../lib/format.ts';
import { issuerLabel } from '../lib/issuers.ts';
import type { AssetView, IntegrityReport } from '../lib/parity.ts';
import type { Snapshot } from '../lib/types.ts';
import { SectionHead } from '../components/ui.tsx';

interface Props {
  views: AssetView[];
  snapshot: Snapshot;
  integrity: IntegrityReport;
}

/** Data-quality problems found in the CMC responses, detected live on every snapshot. */
export function Findings({ snapshot, integrity }: Props) {
  const { unitMismatches, aggregateGaps, offPeg, noPrice } = integrity;
  const noPriceTotal = noPrice.reduce((s, x) => s + x.count, 0);

  return (
    <section className="section" id="findings">
      <SectionHead title="What the API gets wrong">
        Parity checks the RWA data on every snapshot, and these are found automatically rather than hand-picked. They're the
        reason the consensus normalizes units and ignores stale quotes.
      </SectionHead>
      <div className="grid cols-2">
        {unitMismatches.length > 0 && (
          <div className="card finding">
            <h3>
              <span className="badge warning">⚠ units</span> Mixed units under one asset
            </h3>
            <p>
              Wrappers of the same <code>rwa_id</code> are quoted in different units, but the API has no field that says so. Read raw,
              they look like 97% discounts or 900% premiums. Parity detects the ratio and normalizes before comparing.
            </p>
            <ul>
              {unitMismatches.map(({ view, wrapper }) => (
                <li key={wrapper.cryptoId}>
                  <a href={`#/asset/${view.asset.slug}`}>{view.asset.symbol}</a> · <b>{wrapper.symbol}</b> ({issuerLabel(wrapper.issuerName)})
                  at {price(wrapper.price)}: {wrapper.unit!.label}
                  {wrapper.unitConfirmed && (
                    <span className="muted"> ✓ matches the real {view.reference!.ticker} price once normalized</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {aggregateGaps.length > 0 && (
          <div className="card finding">
            <h3>
              <span className="badge critical">✕ aggregate</span> <code>average_tokenized_price</code> is distorted
            </h3>
            <p>
              CMC's headline tokenized price is averaged across wrappers quoted in different units, so it can land on a price no
              wrapper trades at. Parity's consensus normalizes units first.
            </p>
            <ul>
              {aggregateGaps.slice(0, 8).map((v) => (
                <li key={v.asset.rwaId}>
                  <a href={`#/asset/${v.asset.slug}`}>{v.asset.symbol}</a>: CMC {price(v.asset.avgTokenizedPrice)} vs consensus{' '}
                  {price(v.consensus)}
                  {v.reference ? `, real ${v.reference.ticker} ${price(v.reference.price)} (${v.cmcVsReference!.toFixed(1)}×)` : ` (${bps(v.cmcAverageGapBps, 0)})`}
                  {v.cmcAverageUntraded ? ', a price no wrapper trades at' : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
        {snapshot.apiIssues.map((issue) => (
          <div key={issue.id} className="card finding">
            <h3>
              <span className="badge critical">✕ API</span> {issue.title}
            </h3>
            <p>{issue.detail}</p>
            <div className="evidence">
              {issue.endpoint}
              {'\n'}
              {issue.evidence}
            </div>
          </div>
        ))}
        {noPriceTotal > 0 && (
          <div className="card finding">
            <h3>
              <span className="badge critical">no price</span> {noPriceTotal} wrappers return <code>price: null</code>
            </h3>
            <p>Listed under an asset, but with no price, market cap or volume. They're excluded from every calculation.</p>
            <ul>
              {noPrice.map((x) => (
                <li key={x.issuerName}>
                  {issuerLabel(x.issuerName)}: {x.count}
                </li>
              ))}
            </ul>
          </div>
        )}
        {offPeg.length > 0 && (
          <div className="card finding">
            <h3>
              <span className="badge critical">✕ off-peg</span> {offPeg.length} quotes ≥ 5% from their peers
            </h3>
            <p>
              Mostly wrappers with zero 24h volume whose last price never updated. Averaging them in would move the consensus, so
              Parity sets them aside.
            </p>
            <ul>
              {offPeg.slice(0, 6).map(({ view, wrapper }) => (
                <li key={wrapper.cryptoId}>
                  <a href={`#/asset/${view.asset.slug}`}>{view.asset.symbol}</a> · <b>{wrapper.symbol}</b> ({issuerLabel(wrapper.issuerName)}){' '}
                  {bps(wrapper.deviationBps, 0)}
                  {wrapper.status === 'no-volume' ? ', no volume' : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
