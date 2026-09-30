// Parity analytics: how far each tokenized wrapper of a real-world asset trades from the others.
// Pure functions over CMC data, shared by the site and the snapshot scripts.

import type { AssetHistory, HistorySummary, Issuer, ReferenceQuote, RwaAsset, Wrapper } from './types.ts';

/** A wrapper needs this much 24h volume to count toward the consensus price. */
export const LIQUID_VOLUME_USD = 50_000;
/** …and this much to appear on the radar as something you could actually trade. */
export const TRADEABLE_VOLUME_USD = 250_000;
/** Deviation from consensus worth flagging on the radar. */
export const DISLOCATION_BPS = 25;
/** Beyond this, an unexplained deviation means the wrapper is off-peg or its quote is stale. */
export const OFF_PEG_BPS = 500;

export interface UnitFactor {
  /** Multiply the wrapper's price by this to get the price of one unit of the underlying. */
  factor: number;
  label: string;
}

// Unit conventions seen (or plausible) across wrappers of the same asset. Gold wrappers from
// Comtech and VNX are priced per gram while PAXG/XAUt are per troy ounce, under one rwa_id.
export const UNIT_FACTORS: UnitFactor[] = [
  { factor: 31.1035, label: 'priced per gram (1 oz = 31.1035 g)' },
  { factor: 1 / 32.1507, label: 'priced per kilogram (1 kg = 32.15 oz)' },
  // Wrapper priced at N× its peers: one token stands for N shares, typically after an N-for-1 split.
  ...[2, 3, 4, 5, 10, 20, 100].map((n) => ({
    factor: 1 / n,
    label: `priced at ${n}× peers (different share ratio, e.g. after a ${n}-for-1 split)`,
  })),
  // Wrapper priced at 1/N of its peers: a fractional unit or a reverse split.
  ...[2, 3, 4, 5, 10, 20, 100, 1000].map((n) => ({
    factor: n,
    label: `priced at 1/${n} of peers (fractional unit or reverse split?)`,
  })),
];
const SAME_UNIT_TOLERANCE = 0.25;
const UNIT_MATCH_TOLERANCE = 0.03;

export type WrapperStatus = 'ok' | 'illiquid' | 'no-volume' | 'no-price';

interface Quote {
  price: number | null;
  volume24h: number | null;
}

export interface ParityFields {
  unit: UnitFactor | null;
  normalizedPrice: number | null;
  /** Premium (+) or discount (−) to the asset's consensus price, in basis points. */
  deviationBps: number | null;
  /** Same, but against a consensus of the *other* wrappers only, so a dominant wrapper can't grade itself. */
  peerDeviationBps: number | null;
  status: WrapperStatus;
  liquid: boolean;
  /** Unexplained by units and ≥ OFF_PEG_BPS from the median: a different instrument or a stale quote. */
  offPeg: boolean;
  /** Liquid and not off-peg: counts toward the consensus. */
  eligible: boolean;
}

export type ConsensusMethod = 'volume-weighted mean' | 'median' | 'none';

export interface ParityResult<T> {
  consensus: number | null;
  method: ConsensusMethod;
  rows: (T & ParityFields)[];
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Returns the unit convention that explains price ≈ reference / factor, or null if the units match. */
export function detectUnit(price: number, reference: number): UnitFactor | null {
  const ratio = reference / price;
  if (Math.abs(ratio - 1) <= SAME_UNIT_TOLERANCE) return null;
  return UNIT_FACTORS.find((u) => Math.abs(ratio / u.factor - 1) <= UNIT_MATCH_TOLERANCE) ?? null;
}

export function statusOf(q: Quote): WrapperStatus {
  if (q.price == null || q.price <= 0) return 'no-price';
  if (!q.volume24h) return 'no-volume';
  return q.volume24h >= LIQUID_VOLUME_USD ? 'ok' : 'illiquid';
}

export function volumeWeightedMean(points: { value: number; weight: number }[]): number | null {
  const total = points.reduce((s, p) => s + p.weight, 0);
  return total > 0 ? points.reduce((s, p) => s + p.value * p.weight, 0) / total : null;
}

/**
 * Normalizes units, sets aside off-peg quotes, then prices every quote against a consensus: the
 * volume-weighted mean of the remaining liquid wrappers (plain median when none are liquid).
 */
export function computeParity<T extends Quote>(quotes: T[]): ParityResult<T> {
  const priced = quotes.filter((q) => q.price != null && q.price > 0);
  const rawReference = median(priced.map((q) => q.price as number));

  const normalized = quotes.map((q) => {
    const status = statusOf(q);
    if (status === 'no-price' || rawReference == null) {
      return { ...q, unit: null, normalizedPrice: null, status, liquid: false };
    }
    const unit = detectUnit(q.price as number, rawReference);
    const normalizedPrice = (q.price as number) * (unit?.factor ?? 1);
    return { ...q, unit, normalizedPrice, status, liquid: status === 'ok' };
  });

  const reference = median(normalized.filter((r) => r.normalizedPrice != null).map((r) => r.normalizedPrice as number));
  const farFromReference = (r: (typeof normalized)[number]) =>
    reference != null && r.normalizedPrice != null && Math.abs(r.normalizedPrice / reference - 1) * 10_000 >= OFF_PEG_BPS;
  // If every quote is far from the median there is no peg to be off: the prices are just dispersed.
  const anyInBand = normalized.some((r) => r.normalizedPrice != null && !farFromReference(r));
  const flagged = normalized.map((r) => {
    const offPeg = anyInBand && farFromReference(r);
    return { ...r, offPeg, eligible: r.liquid && !offPeg };
  });

  const weighted = (rows: typeof flagged) =>
    volumeWeightedMean(rows.filter((r) => r.eligible).map((r) => ({ value: r.normalizedPrice as number, weight: r.volume24h as number })));

  let method: ConsensusMethod = 'volume-weighted mean';
  let consensus = weighted(flagged);
  if (consensus == null) {
    method = 'median';
    consensus = median(flagged.filter((r) => r.normalizedPrice != null && !r.offPeg).map((r) => r.normalizedPrice as number));
  }
  if (consensus == null) method = 'none';

  const bps = (price: number | null, ref: number | null) => (price != null && ref ? (price / ref - 1) * 10_000 : null);
  const rows = flagged.map((r, i) => ({
    ...r,
    deviationBps: bps(r.normalizedPrice, consensus),
    peerDeviationBps: bps(r.normalizedPrice, weighted(flagged.filter((_, j) => j !== i))),
  }));
  return { consensus, method, rows };
}

export type WrapperView = Wrapper &
  ParityFields & {
    volumeShare: number;
    /** Premium (+) or discount (−) of the unit-normalized price to the real listed instrument. */
    vsReferenceBps: number | null;
    /** A unit normalization that the real price confirms (within 5%). */
    unitConfirmed: boolean;
  };

export interface AssetView {
  asset: RwaAsset;
  consensus: number | null;
  method: ConsensusMethod;
  /** Sorted by 24h volume, largest first. */
  wrappers: WrapperView[];
  liquidCount: number;
  /** Richest vs cheapest eligible wrapper. */
  spreadBps: number | null;
  /** Same, restricted to wrappers with enough volume to act on. */
  tradeable: { cheap: WrapperView; rich: WrapperView; spreadBps: number } | null;
  cheapest: WrapperView | null;
  richest: WrapperView | null;
  /** Liquid wrapper with a meaningful share of volume that tracks consensus most tightly. */
  closest: WrapperView | null;
  mostLiquid: WrapperView | null;
  /** How far CMC's own average_tokenized_price sits from our consensus. */
  cmcAverageGapBps: number | null;
  /** True when no wrapper's raw price is within 5% of CMC's average: it blends units into a price nobody trades at. */
  cmcAverageUntraded: boolean;
  /** The real listed stock/ETF, when a reference quote matched. */
  reference: ReferenceQuote | null;
  /** Consensus of the wrappers vs the real instrument's last regular-session price. */
  referenceGapBps: number | null;
  /** CMC's average_tokenized_price as a multiple of the real price (1 = agrees). */
  cmcVsReference: number | null;
}

export function analyzeAsset(asset: RwaAsset): AssetView {
  const { consensus, method, rows } = computeParity(asset.wrappers);
  const reference = asset.reference ?? null;
  const vsRef = (p: number | null) => (p != null && reference ? (p / reference.price - 1) * 10_000 : null);
  const totalVolume = rows.reduce((s, r) => s + (r.volume24h ?? 0), 0);
  const wrappers: WrapperView[] = rows
    .map((r) => {
      const vsReferenceBps = vsRef(r.normalizedPrice);
      return {
        ...r,
        volumeShare: totalVolume ? (r.volume24h ?? 0) / totalVolume : 0,
        vsReferenceBps,
        unitConfirmed: r.unit != null && vsReferenceBps != null && Math.abs(vsReferenceBps) < 500,
      };
    })
    .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));

  const liquid = wrappers.filter((w) => w.eligible && w.deviationBps != null);
  const byDev = [...liquid].sort((a, b) => (a.deviationBps as number) - (b.deviationBps as number));
  const cheapest = byDev[0] ?? null;
  const richest = byDev.at(-1) ?? null;
  const pairSpread = (cheap: WrapperView, rich: WrapperView) =>
    ((rich.normalizedPrice as number) / (cheap.normalizedPrice as number) - 1) * 10_000;
  const deep = byDev.filter((w) => (w.volume24h ?? 0) >= TRADEABLE_VOLUME_USD);
  const contenders = liquid.filter((w) => w.volumeShare >= 0.05);
  const closest =
    [...(contenders.length ? contenders : liquid)].sort(
      (a, b) => Math.abs(a.deviationBps as number) - Math.abs(b.deviationBps as number),
    )[0] ?? null;

  return {
    asset,
    consensus,
    method,
    wrappers,
    liquidCount: liquid.length,
    spreadBps: liquid.length >= 2 ? pairSpread(cheapest!, richest!) : null,
    tradeable:
      deep.length >= 2 ? { cheap: deep[0], rich: deep.at(-1)!, spreadBps: pairSpread(deep[0], deep.at(-1)!) } : null,
    cheapest: liquid.length >= 2 ? cheapest : null,
    richest: liquid.length >= 2 ? richest : null,
    closest,
    mostLiquid: liquid[0] ?? null,
    cmcAverageGapBps:
      consensus && asset.avgTokenizedPrice ? (asset.avgTokenizedPrice / consensus - 1) * 10_000 : null,
    cmcAverageUntraded:
      asset.avgTokenizedPrice != null &&
      !wrappers.some((w) => w.price != null && Math.abs(w.price / asset.avgTokenizedPrice! - 1) < 0.05),
    reference,
    referenceGapBps: vsRef(consensus),
    cmcVsReference: reference && asset.avgTokenizedPrice != null ? asset.avgTokenizedPrice / reference.price : null,
  };
}

export interface Dislocation {
  view: AssetView;
  wrapper: WrapperView;
}

/** Assets whose deep-enough wrappers disagree by at least `minBps`, widest first. */
export function findSpreads(views: AssetView[], minBps = DISLOCATION_BPS): AssetView[] {
  return views
    .filter((v) => v.tradeable && v.tradeable.spreadBps >= minBps)
    .sort((a, b) => b.tradeable!.spreadBps - a.tradeable!.spreadBps);
}

/** CMC's average_tokenized_price this far from our consensus is treated as a distorted aggregate. */
export const AGGREGATE_GAP_BPS = 100;

/** Assets whose wrappers trade furthest from the real listed instrument, largest gap first. */
export function referenceGaps(views: AssetView[]): AssetView[] {
  return views
    .filter((v) => v.referenceGapBps != null && v.liquidCount >= 1)
    .sort((a, b) => Math.abs(b.referenceGapBps as number) - Math.abs(a.referenceGapBps as number));
}

export interface IntegrityReport {
  unitMismatches: Dislocation[];
  /** Assets where CMC's own average disagrees with the unit-normalized consensus. */
  aggregateGaps: AssetView[];
  offPeg: Dislocation[];
  noPrice: { issuerName: string; count: number }[];
  noVolume: number;
  wrappers: number;
}

/** Data-quality findings in the API response itself, as opposed to market dislocations. */
export function integrityReport(views: AssetView[]): IntegrityReport {
  const all = views.flatMap((view) => view.wrappers.map((wrapper) => ({ view, wrapper })));
  const noPriceByIssuer = new Map<string, number>();
  for (const { wrapper } of all) {
    if (wrapper.status === 'no-price') {
      noPriceByIssuer.set(wrapper.issuerName, (noPriceByIssuer.get(wrapper.issuerName) ?? 0) + 1);
    }
  }
  return {
    unitMismatches: all.filter((d) => d.wrapper.unit),
    aggregateGaps: views
      .filter((v) => v.liquidCount >= 1 && Math.abs(v.cmcAverageGapBps ?? 0) >= AGGREGATE_GAP_BPS)
      .sort((a, b) => Math.abs(b.cmcAverageGapBps as number) - Math.abs(a.cmcAverageGapBps as number)),
    offPeg: all
      .filter((d) => d.wrapper.offPeg && !d.wrapper.unit)
      .sort((a, b) => Math.abs(b.wrapper.deviationBps as number) - Math.abs(a.wrapper.deviationBps as number)),
    noPrice: [...noPriceByIssuer]
      .map(([issuerName, count]) => ({ issuerName, count }))
      .sort((a, b) => b.count - a.count),
    noVolume: all.filter((d) => d.wrapper.status === 'no-volume').length,
    wrappers: all.length,
  };
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F' | '–';

export interface IssuerView {
  issuerId: string;
  name: string;
  website: string | null;
  logo: string | null;
  numTokens: number;
  wrappers: number;
  liquid: number;
  marketCap: number;
  volume24h: number;
  marketCapShare: number;
  /** Tracking error: median |deviation from peer wrappers| across the issuer's liquid wrappers. */
  medianAbsDevBps: number | null;
  /** Signed median of the same: does this issuer's wrapper usually cost more (+) or less (−) than peers? */
  medianPremiumBps: number | null;
  noPrice: number;
  offPeg: number;
  unitMismatches: number;
  grade: Grade;
}

/** Tracking-error grade. Needs a few liquid wrappers to be meaningful. */
export function gradeFor(medianAbsDevBps: number | null, liquid: number): Grade {
  if (medianAbsDevBps == null || liquid < 3) return '–';
  if (medianAbsDevBps <= 5) return 'A';
  if (medianAbsDevBps <= 12) return 'B';
  if (medianAbsDevBps <= 25) return 'C';
  if (medianAbsDevBps <= 60) return 'D';
  return 'F';
}

export function analyzeIssuers(views: AssetView[], issuers: Issuer[]): IssuerView[] {
  const byId = new Map<string, WrapperView[]>();
  for (const v of views) {
    // Only score wrappers whose asset has a real consensus to deviate from.
    if (v.liquidCount < 2) continue;
    for (const w of v.wrappers) byId.set(w.issuerId, [...(byId.get(w.issuerId) ?? []), w]);
  }
  const meta = new Map(issuers.map((i) => [i.issuerId, i]));
  const totalCap = [...byId.values()].flat().reduce((s, w) => s + (w.marketCap ?? 0), 0);

  return [...byId]
    .map(([issuerId, ws]) => {
      const m = meta.get(issuerId);
      const liquid = ws.filter((w) => w.eligible && w.peerDeviationBps != null && !w.unit);
      const medianAbsDevBps = median(liquid.map((w) => Math.abs(w.peerDeviationBps as number)));
      const marketCap = ws.reduce((s, w) => s + (w.marketCap ?? 0), 0);
      return {
        issuerId,
        name: m?.name ?? ws[0].issuerName,
        website: m?.website ?? null,
        logo: m?.logo ?? null,
        numTokens: m?.numTokens ?? ws.length,
        wrappers: ws.length,
        liquid: liquid.length,
        marketCap,
        volume24h: ws.reduce((s, w) => s + (w.volume24h ?? 0), 0),
        marketCapShare: totalCap ? marketCap / totalCap : 0,
        medianAbsDevBps,
        medianPremiumBps: median(liquid.map((w) => w.peerDeviationBps as number)),
        noPrice: ws.filter((w) => w.status === 'no-price').length,
        offPeg: ws.filter((w) => w.offPeg && !w.unit).length,
        unitMismatches: ws.filter((w) => w.unit).length,
        grade: gradeFor(medianAbsDevBps, liquid.length),
      };
    })
    .sort((a, b) => b.marketCap - a.marketCap);
}

export interface HistorySeries {
  cryptoId: number;
  symbol: string;
  issuerName: string;
  devBps: (number | null)[];
  meanDevBps: number | null;
  p95AbsDevBps: number | null;
}

export interface HistoryView {
  t: number[];
  series: HistorySeries[];
  spreadBps: (number | null)[];
  spreadP50: number | null;
  spreadP95: number | null;
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/** Replays the parity calculation at every hourly point of a backfilled history. */
export function analyzeHistory(h: AssetHistory): HistoryView {
  const devs: (number | null)[][] = h.wrappers.map(() => []);
  const spreadBps: (number | null)[] = [];

  h.t.forEach((_, i) => {
    const quotes = h.wrappers.map((w) => ({ price: w.price[i], volume24h: w.volume24h[i] }));
    const { rows } = computeParity(quotes);
    rows.forEach((r, j) => devs[j].push(r.deviationBps));
    const prices = rows.filter((r) => r.eligible).map((r) => r.normalizedPrice as number);
    spreadBps.push(prices.length >= 2 ? (Math.max(...prices) / Math.min(...prices) - 1) * 10_000 : null);
  });

  const spreads = spreadBps.filter((s): s is number => s != null);
  return {
    t: h.t,
    series: h.wrappers.map((w, j) => {
      const d = devs[j].filter((x): x is number => x != null);
      return {
        cryptoId: w.cryptoId,
        symbol: w.symbol,
        issuerName: w.issuerName,
        devBps: devs[j],
        meanDevBps: d.length ? d.reduce((s, x) => s + x, 0) / d.length : null,
        p95AbsDevBps: percentile(d.map(Math.abs), 95),
      };
    }),
    spreadBps,
    spreadP50: percentile(spreads, 50),
    spreadP95: percentile(spreads, 95),
  };
}

export function summarizeHistory(h: AssetHistory): HistorySummary['assets'][number] {
  const v = analyzeHistory(h);
  return {
    rwaId: h.rwaId,
    symbol: h.symbol,
    hours: h.t.length,
    from: h.t[0] ?? 0,
    to: h.t.at(-1) ?? 0,
    spreadP50: v.spreadP50,
    spreadP95: v.spreadP95,
    series: v.series.map((s) => ({ symbol: s.symbol, issuerName: s.issuerName, meanDevBps: s.meanDevBps })),
  };
}

export interface IssuerTrend {
  issuerName: string;
  /** Mean over assets of the wrapper's 30-day average premium to consensus. */
  meanDevBps: number;
  assets: number;
  /** Share of assets where this issuer's wrapper averaged above consensus. */
  richShare: number;
}

/** Which issuers' wrappers persistently trade rich or cheap across the backfilled assets. */
export function issuerTrends(summary: HistorySummary, minAssets = 3): IssuerTrend[] {
  const by = new Map<string, number[]>();
  for (const a of summary.assets) {
    for (const s of a.series) if (s.meanDevBps != null) by.set(s.issuerName, [...(by.get(s.issuerName) ?? []), s.meanDevBps]);
  }
  return [...by]
    .filter(([, xs]) => xs.length >= minAssets)
    .map(([issuerName, xs]) => ({
      issuerName,
      meanDevBps: xs.reduce((s, x) => s + x, 0) / xs.length,
      assets: xs.length,
      richShare: xs.filter((x) => x > 0).length / xs.length,
    }))
    .sort((a, b) => b.meanDevBps - a.meanDevBps);
}

export interface DividendPoint {
  symbol: string;
  slug: string;
  wrapper: string;
  issuerName: string;
  /** Trailing 12-month dividends as % of the real price. */
  yieldPct: number;
  /** Wrapper's premium to the real price, in %. */
  premiumPct: number;
}

export interface DividendFit {
  issuerName: string;
  n: number;
  correlation: number | null;
  /** Least-squares slope of premium on yield: 1 means the full dividend shows up in the price. */
  slope: number | null;
  /** Median premium for assets yielding over 2%, and for non-payers (under 0.2%). */
  payersMedian: number | null;
  nonPayersMedian: number | null;
}

function fit(issuerName: string, pts: DividendPoint[]): DividendFit {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.yieldPct, 0) / n;
  const my = pts.reduce((s, p) => s + p.premiumPct, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of pts) {
    sxy += (p.yieldPct - mx) * (p.premiumPct - my);
    sxx += (p.yieldPct - mx) ** 2;
    syy += (p.premiumPct - my) ** 2;
  }
  return {
    issuerName,
    n,
    correlation: sxx && syy ? sxy / Math.sqrt(sxx * syy) : null,
    slope: sxx ? sxy / sxx : null,
    payersMedian: median(pts.filter((p) => p.yieldPct > 2).map((p) => p.premiumPct)),
    nonPayersMedian: median(pts.filter((p) => p.yieldPct < 0.2).map((p) => p.premiumPct)),
  };
}

/**
 * Does a wrapper's premium to the real stock grow with the stock's dividend yield? A total-return
 * wrapper (dividends reinvested) drifts above the share price by the dividends it has accrued; a
 * price-return wrapper doesn't. One point per issuer per asset (its most liquid eligible wrapper).
 */
export function dividendStudy(views: AssetView[], minAssets = 12): { points: DividendPoint[]; fits: DividendFit[] } {
  const points: DividendPoint[] = [];
  for (const v of views) {
    const ref = v.reference;
    if (!ref || ref.dividendsTtm == null) continue;
    const seen = new Set<string>();
    for (const w of v.wrappers) {
      if (!w.eligible || w.unit || w.vsReferenceBps == null || w.issuerName === 'NA (Derivatives)' || seen.has(w.issuerName)) continue;
      seen.add(w.issuerName);
      points.push({
        symbol: v.asset.symbol,
        slug: v.asset.slug,
        wrapper: w.symbol,
        issuerName: w.issuerName,
        yieldPct: (ref.dividendsTtm / ref.price) * 100,
        premiumPct: w.vsReferenceBps / 100,
      });
    }
  }
  const byIssuer = new Map<string, DividendPoint[]>();
  for (const p of points) byIssuer.set(p.issuerName, [...(byIssuer.get(p.issuerName) ?? []), p]);
  const fits = [...byIssuer]
    .filter(([, pts]) => pts.length >= minAssets)
    .map(([issuer, pts]) => fit(issuer, pts))
    .sort((a, b) => (b.slope ?? 0) - (a.slope ?? 0));
  return { points, fits };
}
