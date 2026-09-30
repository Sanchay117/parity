// One-off: 30 days of hourly prices for every liquid wrapper of a curated set of assets.
//   npm run backfill   (after npm run snapshot)
// Uses /v2/cryptocurrency/quotes/historical, which needs a paid tier (our hackathon key
// covers it). Afterwards, scripts/snapshot.ts appends new points on the free tier.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, requireKey } from './cmc.ts';
import { writeHistorySummary } from './history-summary.ts';
import { analyzeAsset } from '../src/lib/parity.ts';
import type { AssetHistory, BackfillMeta, Snapshot } from '../src/lib/types.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA_DIR = join(ROOT, 'public/data');
const HISTORY_DIR = join(DATA_DIR, 'history');
const HOURS = 720;
const MAX_ASSETS = 24;
const MAX_WRAPPERS = 8;
// Always include the assets the site's story leans on.
const PINNED = ['GOLD', 'SPY', 'NVDA', 'TSLA', 'QQQ', 'IBM', 'GME', 'QCOM', 'NOW', 'NFLX'];

interface RawHistorical {
  [id: string]: {
    id: number;
    symbol: string;
    quotes: { timestamp: string; quote: { USD: { price: number | null; volume_24h: number | null } } }[];
  };
}

async function main() {
  const snapshot = JSON.parse(readFileSync(join(DATA_DIR, 'snapshot.json'), 'utf8')) as Snapshot;
  const views = snapshot.assets.map(analyzeAsset).filter((v) => v.liquidCount >= 2);
  const pinned = views.filter((v) => PINNED.includes(v.asset.symbol));
  const rest = views
    .filter((v) => !PINNED.includes(v.asset.symbol))
    .sort((a, b) => (b.asset.tokenizedMarketCap ?? 0) - (a.asset.tokenizedMarketCap ?? 0));
  const chosen = [...pinned, ...rest].slice(0, MAX_ASSETS);

  const cmc = createClient(requireKey(), join(ROOT, 'evidence'));
  mkdirSync(HISTORY_DIR, { recursive: true });

  for (const [i, view] of chosen.entries()) {
    const wrappers = view.wrappers.filter((w) => w.price != null && (w.volume24h ?? 0) > 0).slice(0, MAX_WRAPPERS);
    const data = await cmc.get<RawHistorical>(
      '/v2/cryptocurrency/quotes/historical',
      { id: wrappers.map((w) => w.cryptoId).join(','), interval: 'hourly', count: HOURS },
      i === 0 ? 'crypto-quotes-historical' : undefined,
    );

    // Align every wrapper on one hourly grid; CMC timestamps can drift by seconds.
    const hour = (iso: string) => Math.round(Date.parse(iso) / 3_600_000) * 3600;
    const grid = [...new Set(Object.values(data).flatMap((d) => d.quotes.map((q) => hour(q.timestamp))))].sort(
      (a, b) => a - b,
    );
    const history: AssetHistory = {
      rwaId: view.asset.rwaId,
      symbol: view.asset.symbol,
      t: grid,
      wrappers: wrappers
        .filter((w) => data[w.cryptoId]?.quotes.length)
        .map((w) => {
          const byHour = new Map(data[w.cryptoId].quotes.map((q) => [hour(q.timestamp), q.quote.USD]));
          return {
            cryptoId: w.cryptoId,
            symbol: w.symbol,
            issuerName: w.issuerName,
            price: grid.map((t) => round(byHour.get(t)?.price)),
            volume24h: grid.map((t) => round(byHour.get(t)?.volume_24h, 0)),
          };
        }),
    };
    writeFileSync(join(HISTORY_DIR, `${view.asset.rwaId}.json`), JSON.stringify(history));
    console.log(`${view.asset.symbol}: ${history.wrappers.length} wrappers × ${grid.length} hours`);
  }

  writeFileSync(
    join(HISTORY_DIR, 'index.json'),
    JSON.stringify(chosen.map((v) => ({ rwaId: v.asset.rwaId, symbol: v.asset.symbol }))),
  );
  writeHistorySummary(HISTORY_DIR);
  const meta: BackfillMeta = {
    generatedAt: new Date().toISOString(),
    assets: chosen.length,
    calls: cmc.calls.length,
    credits: cmc.creditsUsed(),
  };
  writeFileSync(join(DATA_DIR, 'backfill-meta.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`backfill: ${chosen.length} assets, ${cmc.calls.length} calls, ${cmc.creditsUsed()} credits`);
}

function round(x: number | null | undefined, digits = 6): number | null {
  if (x == null) return null;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
