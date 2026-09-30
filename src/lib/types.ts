// Shapes of the snapshot the site renders. Produced by scripts/snapshot.ts from CMC API responses.

export type AssetType =
  | 'stock'
  | 'commodity'
  | 'currency'
  | 'government_security'
  | 'etf'
  | 'real_estate';

/** One on-chain wrapper of a real-world asset, e.g. NVDAX (Backed) or NVDAon (Ondo) for NVDA. */
export interface Wrapper {
  cryptoId: number;
  symbol: string;
  name: string;
  issuerId: string;
  issuerName: string;
  price: number | null;
  marketCap: number | null;
  volume24h: number | null;
}

export interface RwaAsset {
  rwaId: number;
  name: string;
  symbol: string;
  slug: string;
  assetType: AssetType;
  rank: number;
  /** CMC's own aggregate across wrappers. */
  avgTokenizedPrice: number | null;
  tokenizedMarketCap: number | null;
  tokenizedVolume24h: number | null;
  lastUpdated: string;
  description: string | null;
  industry: string | null;
  website: string | null;
  primaryExchange: string | null;
  wrappers: Wrapper[];
  tradfiMarkets: { exchange: string; ticker: string; url: string }[];
}

export interface Issuer {
  issuerId: string;
  name: string;
  website: string | null;
  logo: string | null;
  numTokens: number;
}

export interface TokenMeta {
  logo: string | null;
  /** Primary chain the token is issued on. */
  platform: string | null;
  /** Every chain CMC lists a contract for. */
  chains: string[];
}

export interface ApiCall {
  endpoint: string;
  query: string;
  credits: number;
  errorCode: number;
  errorMessage: string | null;
  elapsedMs: number;
  at: string;
}

export interface ApiIssue {
  id: string;
  title: string;
  detail: string;
  endpoint: string;
  /** How the issue was observed, e.g. a live error code. */
  evidence: string;
}

export interface Snapshot {
  generatedAt: string;
  universe: {
    totalAssets: number;
    byType: Partial<Record<AssetType, number>>;
    issuers: number;
  };
  global: {
    totalCryptoMarketCap: number;
    stablecoinMarketCap: number;
    btcDominance: number;
  };
  assets: RwaAsset[];
  issuers: Issuer[];
  tokenMeta: Record<string, TokenMeta>;
  calls: ApiCall[];
  apiIssues: ApiIssue[];
  /** Summary of the one-off historical backfill (scripts/backfill.ts), if it has run. */
  backfill?: BackfillMeta;
}

export interface BackfillMeta {
  generatedAt: string;
  assets: number;
  calls: number;
  credits: number;
}

/** Hourly wrapper prices for one asset, from /v2/cryptocurrency/quotes/historical. */
export interface AssetHistory {
  rwaId: number;
  symbol: string;
  /** Unix seconds, hourly. */
  t: number[];
  wrappers: {
    cryptoId: number;
    symbol: string;
    issuerName: string;
    price: (number | null)[];
    volume24h: (number | null)[];
  }[];
}

/** Compact 30-day stats per backfilled asset, so the home page needn't load every history file. */
export interface HistorySummary {
  generatedAt: string;
  assets: {
    rwaId: number;
    symbol: string;
    hours: number;
    from: number;
    to: number;
    spreadP50: number | null;
    spreadP95: number | null;
    series: { symbol: string; issuerName: string; meanDevBps: number | null }[];
  }[];
}
