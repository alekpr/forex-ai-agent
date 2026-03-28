/**
 * CandleService — DB-first candle fetching with API fallback.
 *
 * Strategy per timeframe:
 *   1. Query `forex_candles` DB for the latest N candles
 *   2. Check if the newest candle is "fresh enough" (within staleness threshold)
 *   3. If fresh AND count >= minCandles → return DB candles (saves API quota)
 *   4. Otherwise → fetch from API provider → upsert to DB → return API candles
 */
import { OHLCCandle, Timeframe } from '../types/market';
import { MarketDataService } from './market-data/MarketDataService';
import { CandleRepository } from '../repositories/CandleRepository';

/** Staleness threshold (ms) per timeframe — how old the newest candle can be */
const STALE_THRESHOLD_MS: Record<Timeframe, number> = {
  '5m':  10 * 60 * 1000,   // 10 minutes
  '15m': 30 * 60 * 1000,   // 30 minutes
  '1h':  2 * 60 * 60 * 1000,  // 2 hours
  '4h':  8 * 60 * 60 * 1000,  // 8 hours
  '1d':  26 * 60 * 60 * 1000, // 26 hours (covers weekend)
};

/** Minimum candles needed to compute all indicators reliably (EMA200 needs 200) */
const MIN_CANDLES = 210;

export class CandleService {
  private readonly marketData: MarketDataService;
  private readonly candleRepo: CandleRepository;

  constructor() {
    this.marketData = new MarketDataService();
    this.candleRepo = new CandleRepository();
  }

  /**
   * Get OHLC candles — DB first, API fallback.
   * Returns candles oldest→newest.
   */
  async getCandles(
    symbol: string,
    timeframe: Timeframe,
    limit = 250
  ): Promise<{ candles: OHLCCandle[]; source: 'db' | 'api' }> {
    // 1. Try DB first
    const dbCandles = await this.candleRepo.getLatestCandles(symbol, timeframe, limit);

    if (dbCandles.length >= MIN_CANDLES) {
      const newest = dbCandles[dbCandles.length - 1].time;
      const ageMs = Date.now() - newest.getTime();
      const threshold = STALE_THRESHOLD_MS[timeframe];

      if (ageMs <= threshold) {
        console.log(
          `[CandleService] ${symbol} ${timeframe}: DB hit (${dbCandles.length} candles, age: ${Math.round(ageMs / 60000)}min)`
        );
        return { candles: dbCandles, source: 'db' };
      }

      console.log(
        `[CandleService] ${symbol} ${timeframe}: DB stale (age: ${Math.round(ageMs / 60000)}min > threshold: ${threshold / 60000}min) → fetching API`
      );
    } else {
      console.log(
        `[CandleService] ${symbol} ${timeframe}: DB insufficient (${dbCandles.length}/${MIN_CANDLES}) → fetching API`
      );
    }

    // 2. Fallback to API
    const apiCandles = await this.marketData.getOHLCCandles(symbol, timeframe, limit);

    if (apiCandles.length > 0) {
      await this.candleRepo.upsertCandles(apiCandles);
    }

    return { candles: apiCandles, source: 'api' };
  }

  /**
   * Fetch all 4 timeframes concurrently — DB first per TF.
   * Returns map of TF → candles, and per-TF source info.
   */
  async getMultiTimeframeCandles(
    symbol: string,
    timeframes: Timeframe[],
    limit = 250
  ): Promise<{
    candlesByTf: Partial<Record<Timeframe, OHLCCandle[]>>;
    sourcesByTf: Partial<Record<Timeframe, 'db' | 'api'>>;
  }> {
    const results = await Promise.all(
      timeframes.map(async (tf) => {
        const { candles, source } = await this.getCandles(symbol, tf, limit);
        return { tf, candles, source };
      })
    );

    const candlesByTf: Partial<Record<Timeframe, OHLCCandle[]>> = {};
    const sourcesByTf: Partial<Record<Timeframe, 'db' | 'api'>> = {};

    for (const { tf, candles, source } of results) {
      if (candles.length > 0) {
        candlesByTf[tf] = candles;
        sourcesByTf[tf] = source;
      }
    }

    return { candlesByTf, sourcesByTf };
  }

  /**
   * Build a market context summary from DB candles for Claude prompt enrichment.
   * Provides historical price stats that go beyond just indicator snapshots.
   */
  async buildCandleContext(
    symbol: string,
    timeframe: Timeframe,
    lookback = 50
  ): Promise<CandleContext> {
    const candles = await this.candleRepo.getLatestCandles(symbol, timeframe, lookback);
    if (candles.length < 5) {
      return { available: false };
    }

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const newest = candles[candles.length - 1];
    const oldest = candles[0];

    const periodHigh = Math.max(...highs);
    const periodLow = Math.min(...lows);
    const priceRange = periodHigh - periodLow;
    const currentPrice = newest.close;

    // % position in range (0% = at period low, 100% = at period high)
    const rangePosition = priceRange > 0
      ? ((currentPrice - periodLow) / priceRange) * 100
      : 50;

    // Count bullish vs bearish candles
    const bullishCount = candles.filter((c) => c.close > c.open).length;
    const bearishCount = candles.length - bullishCount;

    // Recent momentum: last 5 candles vs prior 5
    const recent5Avg = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const prior5Avg = closes.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;
    const recentMomentum = prior5Avg > 0
      ? ((recent5Avg - prior5Avg) / prior5Avg) * 100
      : 0;

    // Swings: recent support/resistance levels
    const recentSwingHigh = Math.max(...highs.slice(-20));
    const recentSwingLow = Math.min(...lows.slice(-20));

    return {
      available: true,
      symbol,
      timeframe,
      lookbackCandles: candles.length,
      periodStart: oldest.time.toISOString(),
      periodEnd: newest.time.toISOString(),
      currentPrice,
      periodHigh,
      periodLow,
      priceRange: parseFloat(priceRange.toFixed(5)),
      rangePositionPct: parseFloat(rangePosition.toFixed(1)),
      bullishCandles: bullishCount,
      bearishCandles: bearishCount,
      recentMomentumPct: parseFloat(recentMomentum.toFixed(4)),
      recentSwingHigh: parseFloat(recentSwingHigh.toFixed(5)),
      recentSwingLow: parseFloat(recentSwingLow.toFixed(5)),
    };
  }
}

export interface CandleContext {
  available: boolean;
  symbol?: string;
  timeframe?: string;
  lookbackCandles?: number;
  periodStart?: string;
  periodEnd?: string;
  currentPrice?: number;
  periodHigh?: number;
  periodLow?: number;
  priceRange?: number;
  rangePositionPct?: number;
  bullishCandles?: number;
  bearishCandles?: number;
  recentMomentumPct?: number;
  recentSwingHigh?: number;
  recentSwingLow?: number;
}
