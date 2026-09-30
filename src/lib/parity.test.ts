import { describe, expect, it } from 'vitest';
import {
  analyzeAsset,
  analyzeHistory,
  dividendStudy,
  analyzeIssuers,
  computeParity,
  detectUnit,
  findSpreads,
  gradeFor,
  integrityReport,
  median,
  volumeWeightedMean,
} from './parity.ts';
import type { RwaAsset, Wrapper } from './types.ts';

const wrapper = (symbol: string, issuerName: string, price: number | null, volume24h: number | null): Wrapper => ({
  cryptoId: symbol.length * 1000 + (price ?? 0),
  symbol,
  name: symbol,
  issuerId: issuerName.toLowerCase(),
  issuerName,
  price,
  marketCap: 1_000_000,
  volume24h,
});

const asset = (symbol: string, wrappers: Wrapper[], avgTokenizedPrice: number | null = null): RwaAsset => ({
  rwaId: symbol.length,
  name: symbol,
  symbol,
  slug: symbol.toLowerCase(),
  assetType: 'stock',
  rank: 1,
  avgTokenizedPrice,
  tokenizedMarketCap: 1,
  tokenizedVolume24h: 1,
  lastUpdated: '',
  description: null,
  industry: null,
  website: null,
  primaryExchange: null,
  wrappers,
  tradfiMarkets: [],
});

// Real prices from the 2026-09-30 snapshot: two gold wrappers are quoted per gram.
const gold = asset(
  'GOLD',
  [
    wrapper('PAXG', 'Paxos', 4176.73, 170_244_724),
    wrapper('XAUt', 'Tether', 4169.84, 212_470_713),
    wrapper('XAUM', 'Matrixdock', 4157.54, 550_089),
    wrapper('CGO', 'Comtech', 134.125, 882_885),
    wrapper('VNXAU', 'VNX', 135.134, 7_067),
  ],
  4175.89,
);

describe('median / volumeWeightedMean', () => {
  it('handles odd, even and empty inputs', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it('weights by volume and ignores zero total', () => {
    expect(volumeWeightedMean([{ value: 100, weight: 3 }, { value: 200, weight: 1 }])).toBe(125);
    expect(volumeWeightedMean([{ value: 100, weight: 0 }])).toBeNull();
  });
});

describe('detectUnit', () => {
  it('recognizes per-gram gold against a per-ounce reference', () => {
    expect(detectUnit(134.125, 4172)?.factor).toBeCloseTo(31.1035);
  });
  it('recognizes a wrapper quoted at 10× its peers', () => {
    expect(detectUnit(706.4, 70.7)?.label).toMatch(/10× peers/);
  });
  it('leaves normal premiums alone', () => {
    expect(detectUnit(101, 100)).toBeNull();
    expect(detectUnit(118, 100)).toBeNull();
  });
  it('does not invent a unit for unexplained ratios', () => {
    expect(detectUnit(100, 170)).toBeNull();
  });
});

describe('computeParity', () => {
  it('normalizes per-gram wrappers instead of reporting a -9,678 bps discount', () => {
    const { rows } = computeParity(gold.wrappers);
    const cgo = rows.find((r) => r.symbol === 'CGO')!;
    expect(cgo.unit?.factor).toBeCloseTo(31.1035);
    expect(Math.abs(cgo.deviationBps!)).toBeLessThan(20);
  });

  it('keeps illiquid and off-peg quotes out of the consensus', () => {
    const { consensus, rows } = computeParity([
      { price: 100, volume24h: 1_000_000 },
      { price: 100.2, volume24h: 1_000_000 },
      { price: 85, volume24h: 0 }, // stale, no volume
      { price: 130, volume24h: 5_000_000 }, // liquid but 30% away: a different instrument
    ]);
    expect(consensus).toBeCloseTo(100.1);
    expect(rows[2].status).toBe('no-volume');
    expect(rows[3].offPeg).toBe(true);
    expect(rows[3].eligible).toBe(false);
  });

  it('measures peer deviation against the other wrappers only', () => {
    const { rows } = computeParity([
      { price: 100, volume24h: 9_000_000 },
      { price: 101, volume24h: 100_000 },
    ]);
    // The dominant wrapper is ~0 bps from the consensus it mostly defines, but 99 bps from its peer.
    expect(Math.abs(rows[0].deviationBps!)).toBeLessThan(2);
    expect(rows[0].peerDeviationBps).toBeCloseTo(-99.0, 0);
  });

  it('falls back to a plain median when nothing is liquid', () => {
    const r = computeParity([
      { price: 10, volume24h: 10 },
      { price: 12, volume24h: 0 },
      { price: null, volume24h: null },
    ]);
    expect(r.method).toBe('median');
    expect(r.consensus).toBe(11);
    expect(r.rows[2].status).toBe('no-price');
  });
});

describe('analyzeAsset / findSpreads', () => {
  const spy = asset('SPY', [
    wrapper('SPYB', 'bStocks', 764.9, 3_355_000),
    wrapper('SPYX', 'Backed', 768.4, 14_026_000),
    wrapper('SPYon', 'Ondo', 773.3, 2_250_000),
    wrapper('SPY', 'Hyperliquid', 759.9, 0),
  ]);

  it('picks cheapest and richest among eligible wrappers', () => {
    const v = analyzeAsset(spy);
    expect(v.cheapest?.symbol).toBe('SPYB');
    expect(v.richest?.symbol).toBe('SPYon');
    expect(v.spreadBps).toBeCloseTo((773.3 / 764.9 - 1) * 10_000, 5);
    expect(v.mostLiquid?.symbol).toBe('SPYX');
  });

  it('ranks tradeable spreads', () => {
    const tight = asset('TIGHT', [wrapper('A', 'x', 100, 1e6), wrapper('B', 'y', 100.05, 1e6)]);
    const spreads = findSpreads([analyzeAsset(tight), analyzeAsset(spy)]);
    expect(spreads.map((v) => v.asset.symbol)).toEqual(['SPY']);
  });

  it('flags CMC averages distorted by unit mixing', () => {
    const now = asset(
      'NOW',
      [wrapper('NOWB', 'bStocks', 130, 2e6), wrapper('NOWX', 'Backed', 130.2, 1e6), wrapper('NOWon', 'Ondo', 650, 1e6)],
      650,
    );
    const report = integrityReport([analyzeAsset(now)]);
    expect(report.unitMismatches.map((d) => d.wrapper.symbol)).toEqual(['NOWon']);
    expect(report.aggregateGaps.map((v) => v.asset.symbol)).toEqual(['NOW']);
    // CMC's 650 matches the Ondo wrapper's own units, so it is traded somewhere.
    expect(report.aggregateGaps[0].cmcAverageUntraded).toBe(false);
  });

  it('detects an average that blends units into a price nobody trades at', () => {
    // Real KLAC quotes from the 2026-09-30 snapshot.
    const klac = analyzeAsset(
      asset(
        'KLAC',
        [wrapper('KLACx', 'Backed', 194.99, 1e6), wrapper('KLAC', 'Perp', 195.4, 1e6), wrapper('KLACon', 'Ondo', 1954.85, 1e6)],
        1721.19,
      ),
    );
    expect(klac.cmcAverageUntraded).toBe(true);
    expect(klac.consensus).toBeCloseTo(195.1, 0);
  });
});

describe('issuers', () => {
  it('grades on tracking error only with enough liquid wrappers', () => {
    expect(gradeFor(4, 10)).toBe('A');
    expect(gradeFor(30, 10)).toBe('D');
    expect(gradeFor(1, 2)).toBe('–');
  });

  it('reports a signed premium per issuer', () => {
    const views = ['AAA', 'BBBB', 'CCCCC'].map((s) =>
      analyzeAsset(asset(s, [wrapper(`${s}x`, 'Cheap', 100, 1e6), wrapper(`${s}on`, 'Rich', 101, 1e6)])),
    );
    const [a, b] = analyzeIssuers(views, []).sort((x, y) => x.name.localeCompare(y.name));
    expect(a.name).toBe('Cheap');
    expect(a.medianPremiumBps!).toBeLessThan(0);
    expect(b.medianPremiumBps!).toBeGreaterThan(0);
  });
});

describe('analyzeHistory', () => {
  it('replays parity at every point', () => {
    const h = analyzeHistory({
      rwaId: 1,
      symbol: 'X',
      t: [0, 3600],
      wrappers: [
        { cryptoId: 1, symbol: 'A', issuerName: 'a', price: [100, 100], volume24h: [1e6, 1e6] },
        { cryptoId: 2, symbol: 'B', issuerName: 'b', price: [101, 100.5], volume24h: [1e6, 1e6] },
      ],
    });
    expect(h.spreadBps[0]).toBeCloseTo(100);
    expect(h.spreadBps[1]).toBeCloseTo(50);
    expect(h.series[1].meanDevBps!).toBeGreaterThan(0);
  });
});

describe('reference (real listed instrument)', () => {
  const ref = (price: number) => ({
    price,
    dividendsTtm: 0,
    asOf: '2026-09-29T20:00:00.000Z',
    marketOpen: false,
    exchange: 'NasdaqGS',
    ticker: 'KLAC',
    source: 'test',
  });

  it('measures wrappers and CMC’s average against the real price', () => {
    const klac = analyzeAsset({
      ...asset(
        'KLAC',
        [wrapper('KLACx', 'Backed', 194.99, 1e6), wrapper('KLAC', 'Perp', 195.4, 1e6), wrapper('KLACon', 'Ondo', 1954.85, 1e6)],
        1716.85,
      ),
      reference: ref(196.53),
    });
    expect(klac.cmcVsReference).toBeCloseTo(8.74, 2);
    expect(klac.referenceGapBps!).toBeLessThan(0);
    const ondo = klac.wrappers.find((w) => w.symbol === 'KLACon')!;
    // The 10× unit is confirmed by the real price once normalized.
    expect(ondo.unitConfirmed).toBe(true);
    expect(Math.abs(ondo.vsReferenceBps!)).toBeLessThan(100);
  });

  it('leaves reference fields empty without a match', () => {
    const v = analyzeAsset(asset('X', [wrapper('A', 'a', 10, 1e6), wrapper('B', 'b', 10.1, 1e6)]));
    expect(v.reference).toBeNull();
    expect(v.referenceGapBps).toBeNull();
    expect(v.wrappers[0].vsReferenceBps).toBeNull();
  });
});

describe('dividendStudy', () => {
  it('separates a total-return issuer from price-return ones', () => {
    const views = Array.from({ length: 14 }, (_, i) => {
      const realPrice = 100;
      const yieldPct = i * 0.4; // 0% … 5.2%
      const a = analyzeAsset({
        ...asset(`S${'X'.repeat(i)}`, [
          wrapper(`T${i}on`, 'Ondo Assets', realPrice * (1 + (0.7 * yieldPct) / 100), 1e6),
          wrapper(`T${i}x`, 'Backed Assets', realPrice, 1e6),
        ]),
        reference: {
          price: realPrice,
          dividendsTtm: yieldPct,
          asOf: '',
          marketOpen: false,
          exchange: 'NYSE',
          ticker: `S${i}`,
          source: 'test',
        },
      });
      return a;
    });
    const { fits } = dividendStudy(views, 10);
    const ondo = fits.find((f) => f.issuerName === 'Ondo Assets')!;
    const backed = fits.find((f) => f.issuerName === 'Backed Assets')!;
    expect(ondo.slope!).toBeCloseTo(0.7, 1);
    expect(ondo.correlation!).toBeGreaterThan(0.99);
    expect(Math.abs(backed.slope!)).toBeLessThan(0.01);
  });
});
