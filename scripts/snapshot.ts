// Pulls a fresh snapshot of the tokenized-RWA market from the CMC API into public/data/.
//   npm run snapshot
// Every endpoint used here is available on the free Basic tier, so the site can keep refreshing
// after the hackathon's upgraded access ends. Typical cost: 9 to 17 credits per run.

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CmcError, chunk, createClient, requireKey } from './cmc.ts';
import { HISTORY_META_FILES, writeHistorySummary } from './history-summary.ts';
import type {
  ApiIssue,
  AssetHistory,
  AssetType,
  Issuer,
  RwaAsset,
  Snapshot,
  TokenMeta,
} from '../src/lib/types.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA_DIR = join(ROOT, 'public/data');
const HISTORY_DIR = join(DATA_DIR, 'history');
const EVIDENCE_DIR = join(ROOT, 'evidence');
const ASSET_LIMIT = 250;
const ASSET_TYPES: AssetType[] = ['stock', 'etf', 'commodity', 'government_security', 'currency', 'real_estate'];
const HISTORY_WINDOW_S = 31 * 24 * 3600;

// --- Raw CMC response shapes (only the fields we read) ---
interface RawListAsset {
  rwa_id: number | null;
  name: string;
  symbol: string;
  slug: string;
  tokenized_market_cap: number | null;
}
interface RawToken {
  symbol: string;
  name: string;
  price: number | null;
  crypto_id: number;
  issuer_id: string | null;
  issuer_name: string | null;
  market_cap: number | null;
  volume_24h: number | null;
}
interface RawQuoteAsset {
  rwa_id: number;
  name: string;
  symbol: string;
  slug: string;
  asset_type: AssetType;
  rwa_rank: number;
  average_tokenized_price: number | null;
  tokenized_market_cap: number | null;
  tokenized_volume_24h: number | null;
  last_updated: string;
  tokens?: RawToken[];
  tradfi_markets?: { exchange: { name: string }; ticker: string; market_url: string }[];
}
interface RawInfoAsset {
  rwa_id: number;
  website: string | null;
  industry: string | null;
  primary_exchange: string | null;
  about?: { description?: string | null; website?: string | null };
}
interface RawIssuer {
  issuer_id: string;
  name: string;
  website: string | null;
  logo: string | null;
  num_tokens: number;
}
interface RawCryptoInfo {
  logo?: string;
  platform?: { name: string } | null;
  contract_address?: { platform: { name: string } }[];
}
interface RawGlobal {
  btc_dominance: number;
  stablecoin_market_cap?: number;
  quote: { USD: { total_market_cap: number; stablecoin_market_cap?: number } };
}

async function main() {
  const cmc = createClient(requireKey(), EVIDENCE_DIR);
  mkdirSync(DATA_DIR, { recursive: true });

  // 1. Top tokenized assets by tokenized market cap.
  const list = await cmc.get<{ rwa_assets: RawListAsset[]; total_size: number }>(
    '/v5/real-world-assets/assets/list',
    { limit: ASSET_LIMIT, sort: 'tokenized_market_cap', sort_dir: 'desc' },
    'rwa-assets-list',
  );
  const apiIssues: ApiIssue[] = [];
  const ids = list.rwa_assets.map((a) => a.rwa_id).filter((id): id is number => id != null);
  const idless = list.rwa_assets.filter((a) => a.rwa_id == null);
  console.log(`assets/list: ${ids.length} of ${list.total_size} (${idless.length} without rwa_id)`);
  if (idless.length) {
    apiIssues.push({
      id: 'null-rwa-id',
      title: 'Ranked assets with no rwa_id',
      detail:
        `${idless.map((a) => `${a.name} (${a.symbol})`).join(', ')} ${idless.length === 1 ? 'appears' : 'appear'} in the RWA list with a tokenized ` +
        'market cap but rwa_id: null and has_tokens: null, so they cannot be passed back into the ID-based ' +
        'endpoints the docs recommend. Passing the list IDs straight into quotes/latest fails with 4001.',
      endpoint: '/v5/real-world-assets/assets/list',
      evidence: idless
        .map((a) => `${a.symbol}: rwa_id=null, tokenized_market_cap=${Math.round(a.tokenized_market_cap ?? 0)}`)
        .join('; '),
    });
  }

  // 2. Per-wrapper prices for those assets, and 3. their static metadata. The endpoint caps a
  //    request at 100 IDs (undocumented; 101+ silently returns 100), so batch.
  const quotes = { rwa_assets: [] as RawQuoteAsset[] };
  for (const [i, batch] of chunk(ids, 100).entries()) {
    const page = await cmc.get<{ rwa_assets: RawQuoteAsset[] }>(
      '/v5/real-world-assets/quotes/latest',
      { rwa_id: batch.join(',') },
      i === 0 ? 'rwa-quotes-latest' : undefined,
    );
    quotes.rwa_assets.push(...page.rwa_assets);
  }
  // Try the ID-less assets by slug; so far CMC rejects those slugs too.
  if (idless.length) {
    try {
      const bySlug = await cmc.get<{ rwa_assets: RawQuoteAsset[] }>(
        '/v5/real-world-assets/quotes/latest',
        { rwa_slug: idless.map((a) => a.slug).join(','), skip_invalid: true },
        'rwa-quotes-latest-by-slug',
      );
      quotes.rwa_assets.push(...bySlug.rwa_assets.filter((a) => a.rwa_id != null));
    } catch (err) {
      if (!(err instanceof CmcError)) throw err;
      apiIssues[0].evidence += `; quotes/latest?rwa_slug=${idless.map((a) => a.slug).join(',')} → error_code ${err.code}`;
    }
  }
  const infoById = new Map<number, RawInfoAsset>();
  for (const [i, batch] of chunk(ids, 100).entries()) {
    const info = await cmc.get<{ rwa_assets: RawInfoAsset[] }>(
      '/v5/real-world-assets/info',
      { rwa_id: batch.join(','), skip_invalid: true },
      i === 0 ? 'rwa-info' : undefined,
    );
    for (const a of info.rwa_assets) infoById.set(a.rwa_id, a);
  }

  // 4. Issuers.
  const issuersRaw = await cmc.get<{ issuers: RawIssuer[]; total_size: number }>(
    '/v5/real-world-assets/issuers/list',
    { limit: 250 },
    'rwa-issuers-list',
  );

  // 5. Universe size per asset type (the ID map costs 0 credits).
  const byType: Partial<Record<AssetType, number>> = {};
  let totalAssets = 0;
  for (const type of ASSET_TYPES) {
    const m = await cmc.get<{ total_size: number }>(
      '/v5/real-world-assets/map',
      { asset_type: type, limit: 1 },
      type === 'stock' ? 'rwa-map' : undefined,
    );
    byType[type] = m.total_size;
    totalAssets += m.total_size;
  }

  // 6. Crypto market context.
  const global = await cmc.get<RawGlobal>('/v1/global-metrics/quotes/latest', {}, 'global-metrics');

  const assets: RwaAsset[] = quotes.rwa_assets
    .map((q) => toAsset(q, infoById.get(q.rwa_id)))
    .sort((a, b) => (b.tokenizedMarketCap ?? 0) - (a.tokenizedMarketCap ?? 0));

  // 7. Wrapper token metadata (logo + chains) via the regular crypto endpoint, joined on crypto_id.
  const tokenMeta = loadTokenMeta();
  const priced = assets.flatMap((a) => a.wrappers.filter((w) => w.price !== null).map((w) => w.cryptoId));
  const missing = [...new Set(priced)].filter((id) => !tokenMeta[id]);
  for (const [i, ids] of chunk(missing, 100).entries()) {
    const data = await cmc.get<Record<string, RawCryptoInfo>>(
      '/v2/cryptocurrency/info',
      { id: ids.join(','), skip_invalid: true, aux: 'logo,platform' },
      i === 0 ? 'crypto-info' : undefined,
    );
    for (const [id, c] of Object.entries(data)) {
      const chains = [...new Set((c.contract_address ?? []).map((x) => x.platform.name))];
      tokenMeta[id] = { logo: c.logo ?? null, platform: c.platform?.name ?? null, chains };
    }
  }

  // 8. Probe endpoints that the docs list for Basic but that reject our key, so the site can
  //    report what it saw instead of what it assumed.
  try {
    await cmc.get('/v5/real-world-assets/market-pairs/list', { symbol: 'NVDA', limit: 5 }, 'rwa-market-pairs');
  } catch (err) {
    if (!(err instanceof CmcError)) throw err;
    apiIssues.push({
      id: 'market-pairs-plan',
      title: 'Market Pairs rejects keys the docs say are allowed',
      detail:
        'The RWA reference lists /v5/real-world-assets/market-pairs/list for Basic through Enterprise, ' +
        'but it returns this error on our hackathon key. Without it there is no per-venue price, ' +
        'so Parity can only compare wrappers, not the exchanges they trade on.',
      endpoint: '/v5/real-world-assets/market-pairs/list',
      evidence: `error_code ${err.code}: ${err.message.split(': ').slice(1).join(': ')}`,
    });
  }

  const issuers: Issuer[] = issuersRaw.issuers.map((i) => ({
    issuerId: i.issuer_id,
    name: i.name,
    website: i.website,
    logo: i.logo,
    numTokens: i.num_tokens,
  }));

  const snapshot: Snapshot = {
    generatedAt: new Date().toISOString(),
    universe: { totalAssets, byType, issuers: issuersRaw.total_size },
    global: {
      totalCryptoMarketCap: global.quote.USD.total_market_cap,
      stablecoinMarketCap: global.stablecoin_market_cap ?? global.quote.USD.stablecoin_market_cap ?? 0,
      btcDominance: global.btc_dominance,
    },
    assets,
    issuers,
    tokenMeta,
    calls: cmc.calls,
    apiIssues,
    backfill: existsSync(join(DATA_DIR, 'backfill-meta.json'))
      ? JSON.parse(readFileSync(join(DATA_DIR, 'backfill-meta.json'), 'utf8'))
      : undefined,
  };

  writeFileSync(join(DATA_DIR, 'snapshot.json'), JSON.stringify(snapshot));
  writeFileSync(join(DATA_DIR, 'token-meta.json'), JSON.stringify(tokenMeta));
  const appended = appendHistory(assets);
  console.log(
    `snapshot: ${assets.length} assets, ${assets.reduce((n, a) => n + a.wrappers.length, 0)} wrappers, ` +
      `${Object.keys(tokenMeta).length} token metas, history +${appended}, ` +
      `${cmc.calls.length} calls, ${cmc.creditsUsed()} credits`,
  );
}

function toAsset(q: RawQuoteAsset, info: RawInfoAsset | undefined): RwaAsset {
  return {
    rwaId: q.rwa_id,
    name: q.name,
    symbol: q.symbol,
    slug: q.slug,
    assetType: q.asset_type,
    rank: q.rwa_rank,
    avgTokenizedPrice: q.average_tokenized_price,
    tokenizedMarketCap: q.tokenized_market_cap,
    tokenizedVolume24h: q.tokenized_volume_24h,
    lastUpdated: q.last_updated,
    description: info?.about?.description ?? null,
    industry: info?.industry ?? null,
    website: info?.website ?? info?.about?.website ?? null,
    primaryExchange: info?.primary_exchange ?? null,
    wrappers: (q.tokens ?? []).map((t) => ({
      cryptoId: t.crypto_id,
      symbol: t.symbol,
      name: t.name,
      issuerId: t.issuer_id ?? 'unknown',
      issuerName: t.issuer_name ?? 'Unknown issuer',
      price: t.price,
      marketCap: t.market_cap,
      volume24h: t.volume_24h,
    })),
    tradfiMarkets: (q.tradfi_markets ?? []).map((m) => ({
      exchange: m.exchange.name,
      ticker: m.ticker,
      url: m.market_url,
    })),
  };
}

function loadTokenMeta(): Record<string, TokenMeta> {
  const file = join(DATA_DIR, 'token-meta.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

// Extends each backfilled history file with the wrapper prices from this snapshot, so the
// charts keep moving forward on refreshes without re-buying historical data.
function appendHistory(assets: RwaAsset[]): number {
  if (!existsSync(HISTORY_DIR)) return 0;
  const byId = new Map(assets.map((a) => [a.rwaId, a]));
  const now = Math.floor(Date.now() / 1000);
  let appended = 0;
  for (const file of readdirSync(HISTORY_DIR).filter((f) => f.endsWith('.json') && !HISTORY_META_FILES.has(f))) {
    const path = join(HISTORY_DIR, file);
    const h = JSON.parse(readFileSync(path, 'utf8')) as AssetHistory;
    const asset = byId.get(h.rwaId);
    if (!asset || now - (h.t.at(-1) ?? 0) < 30 * 60) continue;
    h.t.push(now);
    for (const w of h.wrappers) {
      const live = asset.wrappers.find((x) => x.cryptoId === w.cryptoId);
      w.price.push(live?.price ?? null);
      w.volume24h.push(live?.volume24h ?? null);
    }
    const keepFrom = h.t.findIndex((t) => t >= now - HISTORY_WINDOW_S);
    if (keepFrom > 0) {
      h.t = h.t.slice(keepFrom);
      for (const w of h.wrappers) {
        w.price = w.price.slice(keepFrom);
        w.volume24h = w.volume24h.slice(keepFrom);
      }
    }
    writeFileSync(path, JSON.stringify(h));
    appended++;
  }
  if (appended) writeHistorySummary(HISTORY_DIR);
  return appended;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
