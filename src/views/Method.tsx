import { SectionHead } from '../components/ui.tsx';
import { REPO_URL } from '../lib/config.ts';
import { int, utc } from '../lib/format.ts';
import {
  DISLOCATION_BPS,
  LIQUID_VOLUME_USD,
  OFF_PEG_BPS,
  TRADEABLE_VOLUME_USD,
  type AssetView,
} from '../lib/parity.ts';
import type { Snapshot } from '../lib/types.ts';

const ENDPOINT_ROLE: Record<string, string> = {
  '/v5/real-world-assets/assets/list': 'Top 250 tokenized assets by tokenized market cap',
  '/v5/real-world-assets/quotes/latest': 'Every wrapper per asset: issuer, price, market cap, volume, crypto_id',
  '/v5/real-world-assets/info': 'Asset descriptions, industry, primary exchange',
  '/v5/real-world-assets/issuers/list': 'Issuer names, websites, token counts',
  '/v5/real-world-assets/map': 'Universe size per asset type (0 credits)',
  '/v5/real-world-assets/market-pairs/list': 'Probed each snapshot; returns 1006 on our key',
  '/v1/global-metrics/quotes/latest': 'Crypto market context',
  '/v2/cryptocurrency/info': 'Wrapper logos and chains, joined on crypto_id',
  '/v2/cryptocurrency/quotes/historical': '30 days of hourly wrapper prices (backfill)',
};

export function Method({ snapshot }: { snapshot: Snapshot; views: AssetView[] }) {
  const byEndpoint = new Map<string, { calls: number; credits: number; errors: number }>();
  for (const c of snapshot.calls) {
    const e = byEndpoint.get(c.endpoint) ?? { calls: 0, credits: 0, errors: 0 };
    e.calls++;
    e.credits += c.credits;
    if (c.errorCode !== 0) e.errors++;
    byEndpoint.set(c.endpoint, e);
  }
  const endpoints = [...byEndpoint.entries()];
  if (snapshot.backfill) {
    const { calls, credits } = snapshot.backfill;
    endpoints.push(['/v2/cryptocurrency/quotes/historical', { calls, credits, errors: 0 }]);
  }
  const credits = snapshot.calls.reduce((s, c) => s + c.credits, 0);

  return (
    <>
      <section className="hero" style={{ paddingBottom: 0 }}>
        <div className="eyebrow">Method & API</div>
        <h1 style={{ fontSize: 'clamp(30px, 4vw, 44px)' }}>How Parity works</h1>
      </section>

      <section className="section prose">
        <h3>1. One asset, many wrappers</h3>
        <p>
          <code>/v5/real-world-assets/quotes/latest</code> returns, for each real-world asset, every on-chain token that tracks it: NVDAX
          (Backed), NVDAon (Ondo), NVDAB (bStocks), rNVDA (Reality), Robinhood's NVDA, a perp, and so on. Each carries a price, market
          cap, 24h volume and a <code>crypto_id</code>, which is the join key into the regular crypto endpoints for logos, chains and
          historical prices.
        </p>
        <h3>2. Fix units before comparing</h3>
        <p>
          A robust median sets a reference. Any wrapper whose price is a known ratio away (31.1035× for grams of gold, 32.15× for
          kilograms, 2–100× for splits and fractional units) is flagged and normalized. That's how PAXG ($4,176/oz) and Comtech CGO
          ($134/g) end up on one scale.
        </p>
        <h3>3. Set aside what can't be trusted</h3>
        <p>
          Wrappers with no price, no 24h volume, or under ${int(LIQUID_VOLUME_USD)} of volume don't vote. Anything still ≥{' '}
          {OFF_PEG_BPS / 100}% from the median after unit fixes is marked off-peg (usually a stale last trade) and excluded.
        </p>
        <h3>4. Consensus and deviation</h3>
        <p>
          <strong>Consensus</strong> is the volume-weighted mean of the remaining wrappers. Each wrapper's premium or discount is shown in
          basis points against it. For issuer grading we use a <strong>leave-one-out</strong> consensus (the other wrappers only) so the
          biggest wrapper can't score itself as perfect.
        </p>
        <h3>5. Spreads worth looking at</h3>
        <p>
          The radar lists assets where the cheapest and richest liquid wrappers differ by ≥ {DISLOCATION_BPS} bps and both trade ≥ $
          {int(TRADEABLE_VOLUME_USD)} a day. That's a price map, not an arbitrage guarantee: wrappers differ in chain, KYC, redemption
          rights and trading hours.
        </p>
        <h3>6. History</h3>
        <p>
          <code>/v2/cryptocurrency/quotes/historical</code> backfilled 720 hourly points for every liquid wrapper of{' '}
          {snapshot.backfill?.assets ?? 24} assets. The same
          consensus is replayed at every hour, and each snapshot appends a new point, so charts keep moving on the free tier.
        </p>
      </section>

      <section className="section">
        <SectionHead title="Endpoints used">
          Last snapshot {utc(snapshot.generatedAt)}: {snapshot.calls.length} calls, {credits} credits. Every RWA endpoint is on the free
          Basic tier, so the site can keep refreshing after the event.
        </SectionHead>
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Used for</th>
                <th className="r">Calls</th>
                <th className="r">Credits</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map(([endpoint, e]) => (
                <tr key={endpoint}>
                  <td>
                    <code>{endpoint}</code>
                  </td>
                  <td className="secondary">{ENDPOINT_ROLE[endpoint] ?? ''}</td>
                  <td className="r num">
                    {e.calls}
                    {e.errors > 0 && <span className="badge critical" style={{ marginLeft: 6 }}>{e.errors} err</span>}
                  </td>
                  <td className="r num">{e.credits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          Raw request/response evidence for every endpoint (key redacted) is in{' '}
          <a href={`${REPO_URL}/tree/main/evidence`}>/evidence</a> in the repo.
        </p>
      </section>

      <section className="section prose">
        <h3>What the API made possible</h3>
        <p>
          The RWA endpoints make this a one-call problem. <code>quotes/latest</code> already groups every wrapper under its underlying and
          names the issuer, which would otherwise take a hand-maintained mapping of hundreds of tickers. Because each wrapper also has a{' '}
          <code>crypto_id</code>, the rest of the CMC API (logos, chains, hourly history) works on RWA wrappers with no extra glue.
        </p>
        <h3>Where it got in the way</h3>
        <ul>
          <li>
            <strong>Mixed units under one rwa_id</strong> (per-gram vs per-ounce gold, unapplied stock splits), and{' '}
            <code>average_tokenized_price</code> is computed over them, so it can be off by several multiples.
          </li>
          <li>
            <strong>market-pairs/list returns 1006</strong> on a key the docs say should have access. Without it there's no per-venue view.
          </li>
          <li>
            <strong>quotes/latest caps at 100 IDs</strong> without saying so in the docs; an ID list straight from{' '}
            <code>assets/list</code> can contain <code>null</code> and fail the whole request with 4001.
          </li>
          <li>
            <strong>Nulls</strong>: whole issuers' wrappers return <code>price: null</code>, and some ranked assets have no{' '}
            <code>rwa_id</code> and can't be fetched by slug either.
          </li>
          <li>
            <strong>No RWA history endpoint</strong>: history has to be rebuilt per wrapper from crypto historical quotes, which the free tier
            doesn't include.
          </li>
          <li>
            <strong>Symbol lookups collide</strong>: <code>/v2/tools/price-conversion?symbol=XAU</code> returns memecoins alongside gold, so
            IDs are the only safe join.
          </li>
        </ul>
      </section>
    </>
  );
}
