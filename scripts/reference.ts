// Last regular-session prices for the real stocks and ETFs behind tokenized wrappers.
// CoinMarketCap has no quote for the underlying instrument, so this uses Yahoo Finance's public
// chart endpoint as an external reference. Failures are non-fatal: the previous value is kept.

import { sleep } from './cmc.ts';
import type { ReferenceQuote, RwaAsset } from '../src/lib/types.ts';

const SOURCE = 'Yahoo Finance';
// Tickers that exist on CMC but have no plain US listing (private companies, foreign lines).
const SKIP = new Set(['SPCX', 'ANTHROPIC', 'OPENAI', 'GOLD', 'SILVER', 'CL', 'XPD']);
// A reference further than this from the wrappers' consensus is assumed to be a different
// instrument that happens to share the ticker, and is dropped.
const MAX_REFERENCE_GAP = 0.3;

interface ChartMeta {
  regularMarketPrice?: number;
  regularMarketTime?: number;
  fullExchangeName?: string;
  symbol?: string;
  currency?: string;
  currentTradingPeriod?: { regular?: { start: number; end: number } };
}

async function fetchQuote(ticker: string): Promise<ReferenceQuote | null> {
  // A year of monthly bars with dividend events: the meta block carries the latest price.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1mo&events=div`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (parity snapshot)' } });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    chart?: { result?: { meta: ChartMeta; events?: { dividends?: Record<string, { amount: number; date: number }> } }[] };
  };
  const result = body.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta?.regularMarketPrice || meta.currency !== 'USD' || !meta.regularMarketTime) return null;
  const now = Date.now() / 1000;
  const session = meta.currentTradingPeriod?.regular;
  const yearAgo = now - 365 * 24 * 3600;
  const dividends = Object.values(result?.events?.dividends ?? {}).filter((d) => d.date >= yearAgo);
  return {
    price: meta.regularMarketPrice,
    dividendsTtm: dividends.reduce((s, d) => s + d.amount, 0),
    asOf: new Date(meta.regularMarketTime * 1000).toISOString(),
    marketOpen: session ? now >= session.start && now < session.end : false,
    exchange: meta.fullExchangeName ?? '',
    ticker: meta.symbol ?? ticker,
    source: SOURCE,
  };
}

/**
 * Attaches `reference` to stock/ETF assets whose wrappers have a consensus to sanity-check it
 * against. `consensusOf` supplies the unit-normalized wrapper consensus for an asset.
 */
export async function attachReferences(
  assets: RwaAsset[],
  consensusOf: (a: RwaAsset) => number | null,
  previous: Map<number, ReferenceQuote>,
  limit = 300,
): Promise<{ fetched: number; kept: number; dropped: string[] }> {
  let fetched = 0;
  let kept = 0;
  const dropped: string[] = [];
  const candidates = assets
    .filter((a) => (a.assetType === 'stock' || a.assetType === 'etf') && !SKIP.has(a.symbol))
    .slice(0, limit);
  for (const asset of candidates) {
    const consensus = consensusOf(asset);
    if (consensus == null) continue;
    let quote: ReferenceQuote | null = null;
    try {
      quote = await fetchQuote(asset.symbol.replace('.', '-'));
    } catch {
      quote = null;
    }
    await sleep(120);
    if (quote && Math.abs(quote.price / consensus - 1) > MAX_REFERENCE_GAP) {
      dropped.push(`${asset.symbol} (${quote.price} vs ${consensus.toFixed(2)})`);
      continue;
    }
    if (quote) {
      asset.reference = quote;
      fetched++;
    } else if (previous.has(asset.rwaId)) {
      asset.reference = previous.get(asset.rwaId);
      kept++;
    }
  }
  return { fetched, kept, dropped };
}
