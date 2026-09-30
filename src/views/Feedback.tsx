import type { ReactNode } from 'react';
import { SectionHead } from '../components/ui.tsx';
import { REPO_URL } from '../lib/config.ts';
import { int, price } from '../lib/format.ts';
import { integrityReport, type AssetView } from '../lib/parity.ts';
import type { Snapshot } from '../lib/types.ts';

const API = 'https://pro-api.coinmarketcap.com';

interface Issue {
  title: string;
  impact: 'High' | 'Medium' | 'Low';
  what: ReactNode;
  repro: string;
  actual: ReactNode;
  fix: ReactNode;
  evidence?: string;
}

function curl(path: string) {
  return `curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" \\\n  "${API}${path}"`;
}

/** Every API problem we hit, written for the CMC product team: reproducible, with a proposed fix. */
export function Feedback({ snapshot, views }: { snapshot: Snapshot; views: AssetView[] }) {
  const integrity = integrityReport(views);
  const klac = views.find((v) => v.asset.symbol === 'KLAC');
  const klacOndo = klac?.wrappers.find((w) => w.unit);
  const klacOther = klac?.wrappers.find((w) => !w.unit && w.price != null);
  const noPriceTotal = integrity.noPrice.reduce((s, x) => s + x.count, 0);
  const idless = snapshot.apiIssues.find((i) => i.id === 'null-rwa-id');
  const pairs = snapshot.apiIssues.find((i) => i.id === 'market-pairs-plan');

  const issues: Issue[] = [
    {
      title: 'Wrappers under one rwa_id use different units, and nothing says so',
      impact: 'High',
      what: (
        <>
          Gold wrappers mix per-gram (Comtech CGO, VNX VNXAU) and per-ounce (PAXG, XAUt) prices. Some stock wrappers stand for several
          shares per token (Ondo's KLACon, NFLXon, NOWon, CRWDon). Any consumer that compares or averages the <code>tokens[]</code>{' '}
          prices gets nonsense.
        </>
      ),
      repro: curl('/v5/real-world-assets/quotes/latest?symbol=KLAC'),
      actual: klac ? (
        <>
          {klacOndo?.symbol} at {price(klacOndo?.price)} next to {klacOther?.symbol} at {price(klacOther?.price)}; the real KLA share
          last traded at {price(klac.reference?.price)}. Parity currently detects {integrity.unitMismatches.length} such wrappers.
        </>
      ) : (
        `${integrity.unitMismatches.length} wrappers detected.`
      ),
      fix: (
        <>
          Add <code>units_per_share</code> (or <code>unit</code>: <code>share | gram | troy_ounce | kilogram</code>) to each token, and a
          normalized <code>price_per_underlying_unit</code>.
        </>
      ),
    },
    {
      title: 'average_tokenized_price averages across those units',
      impact: 'High',
      what: <>The headline tokenized price for an asset is computed over wrappers in different units, so it can land on a price nobody trades at.</>,
      repro: curl('/v5/real-world-assets/assets/list?symbol=KLAC,NOW'),
      actual: (
        <>
          {integrity.aggregateGaps
            .filter((v) => v.cmcVsReference != null && Math.abs(v.cmcVsReference - 1) >= 0.05)
            .map((v) => `${v.asset.symbol}: ${price(v.asset.avgTokenizedPrice)}, ${v.cmcVsReference!.toFixed(1)}× the real ${v.reference!.ticker} price of ${price(v.reference!.price)}`)
            .join('. ')}
          .
        </>
      ),
      fix: <>Normalize units before averaging (and weight by liquidity), or drop wrappers whose unit is unknown from the aggregate.</>,
    },
    {
      title: 'market-pairs/list rejects a key the docs say is allowed',
      impact: 'Medium',
      what: (
        <>
          The RWA reference lists <code>/v5/real-world-assets/market-pairs/list</code> for every plan from Basic up. Our hackathon key
          gets 1006. Without it there is no per-venue price, so "where should I buy" stops at the wrapper level.
        </>
      ),
      repro: curl('/v5/real-world-assets/market-pairs/list?symbol=NVDA'),
      actual: <>{pairs?.evidence ?? 'error_code 1006'}</>,
      fix: <>Align the plan table in the docs with the gating, and name the minimum plan in the 1006 message.</>,
    },
    {
      title: 'Ranked assets with rwa_id: null',
      impact: 'Medium',
      what: (
        <>
          <code>assets/list</code> returns assets with a tokenized market cap but <code>rwa_id: null</code> and{' '}
          <code>has_tokens: null</code>. Feeding the list's IDs back into <code>quotes/latest</code> (as the docs recommend) fails the
          whole request with 4001, and the slug lookup fails too.
        </>
      ),
      repro: curl('/v5/real-world-assets/quotes/latest?rwa_slug=honeywell'),
      actual: <>{idless?.evidence ?? 'rwa_id: null'}</>,
      fix: <>Give every listed asset an ID, or exclude ID-less rows from list responses.</>,
    },
    {
      title: 'Wrappers returned with price: null',
      impact: 'Low',
      what: <>Tokens appear under an asset with no price, market cap or volume, and some have <code>issuer_name: null</code>.</>,
      repro: curl('/v5/real-world-assets/quotes/latest?symbol=SPY'),
      actual: (
        <>
          {int(noPriceTotal)} of {int(integrity.wrappers)} wrappers in the top 250 assets:{' '}
          {integrity.noPrice.map((x) => `${x.issuerName} ${x.count}`).join(', ')}.
        </>
      ),
      fix: <>Omit unpriced tokens by default, or add a <code>status</code> / <code>last_traded</code> field so clients can tell dead from new.</>,
    },
    {
      title: 'No history or underlying price for RWAs',
      impact: 'Medium',
      what: (
        <>
          There is no <code>/v5/real-world-assets/quotes/historical</code>, so history has to be rebuilt per wrapper from{' '}
          <code>/v2/cryptocurrency/quotes/historical</code> (not on the free tier). And <code>tradfi_markets</code> gives links but no
          price for the listed instrument, so premium-to-underlying needs an outside source. Parity uses Yahoo Finance for it.
        </>
      ),
      repro: curl('/v5/real-world-assets/quotes/latest?symbol=NVDA'),
      actual: <>tradfi_markets: [{'{'} exchange, ticker, market_url {'}'}], with no price field.</>,
      fix: (
        <>
          Add <code>underlying_price</code> (last regular-session price, with timestamp and market status) to <code>quotes/latest</code>,
          and an RWA historical endpoint.
        </>
      ),
    },
    {
      title: 'Symbol lookups collide',
      impact: 'Low',
      what: <>Symbols aren't unique across memecoins and metals, so symbol-based joins are unsafe.</>,
      repro: curl('/v2/tools/price-conversion?amount=1&symbol=XAU&convert=USD'),
      actual: <>Returns "XAU9999 Meme" and "Xaucoin" alongside "Gold (Derivatives)".</>,
      fix: <>Rank exact asset-class matches first, or return a disambiguation error. We join on crypto_id instead.</>,
    },
  ];

  return (
    <>
      <section className="hero" style={{ paddingBottom: 0 }}>
        <div className="eyebrow">API feedback for the CMC team</div>
        <h1 style={{ fontSize: 'clamp(30px, 4vw, 44px)' }}>Where the API got in the way</h1>
        <p className="lede">
          Everything we hit while building Parity, each with a command you can run, what came back, and a suggested fix. Numbers on this
          page come from the latest snapshot, so they stay current.
        </p>
      </section>

      <section className="section">
        <SectionHead title={`${issues.length} issues`}>
          Set <code>CMC_API_KEY</code> and paste any command into a terminal. Raw responses are saved in{' '}
          <a href={`${REPO_URL}/tree/main/evidence`}>/evidence</a>.
        </SectionHead>
        <div className="grid" style={{ gap: 14 }}>
          {issues.map((issue, i) => (
            <div key={issue.title} className="card finding">
              <h3>
                <span className={`badge ${issue.impact === 'High' ? 'critical' : issue.impact === 'Medium' ? 'warning' : ''}`}>
                  {issue.impact}
                </span>
                {i + 1}. {issue.title}
              </h3>
              <p>{issue.what}</p>
              <div className="evidence">{issue.repro}</div>
              <p>
                <strong>Got:</strong> {issue.actual}
              </p>
              <p>
                <strong>Suggested fix:</strong> {issue.fix}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="section prose">
        <h3>What worked well</h3>
        <p>
          <code>quotes/latest</code> already groups every wrapper under its underlying asset and names the issuer: that's the hard part of
          this problem, done. Each wrapper's <code>crypto_id</code> joins cleanly into the regular crypto endpoints for logos, chains and
          hourly history. All seven RWA endpoints being on the free tier is what lets Parity keep refreshing after the hackathon.
        </p>
      </section>
    </>
  );
}
