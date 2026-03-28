import { CandleService } from '../services/CandleService';
import { IndicatorService } from '../services/IndicatorService';
import { MultiTimeframeIndicators, Timeframe } from '../types/market';

const TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h'];

export interface IndicatorFetchResult {
  indicators: MultiTimeframeIndicators;
  source: 'live' | 'skipped';
}

/**
 * Fetches and computes multi-timeframe indicators for a historical trade.
 *
 * Because historical candle data from TwelveData may not be available for
 * all past dates (especially on free tier), this service degrades gracefully:
 * - If `skipIndicators` is true → returns empty MultiTimeframeIndicators immediately
 * - If candle fetch fails for a timeframe → silently skips that timeframe
 * - If ALL timeframes fail → returns empty object (no error thrown)
 */
export class HistoricalIndicatorFetcher {
  private readonly candleSvc: CandleService;
  private readonly indicatorSvc: IndicatorService;

  constructor() {
    this.candleSvc = new CandleService();
    this.indicatorSvc = new IndicatorService();
  }

  async fetch(
    symbol: string,
    skipIndicators: boolean
  ): Promise<IndicatorFetchResult> {
    if (skipIndicators) {
      return { indicators: {}, source: 'skipped' };
    }

    try {
      const { candlesByTf } = await this.candleSvc.getMultiTimeframeCandles(
        symbol,
        TIMEFRAMES,
        250
      );

      // Filter out timeframes with insufficient candle data
      const validCandlesByTf: typeof candlesByTf = {};
      for (const [tf, candles] of Object.entries(candlesByTf) as [Timeframe, typeof candlesByTf[Timeframe]][]) {
        if (candles && candles.length >= 30) {
          validCandlesByTf[tf] = candles;
        }
      }

      const indicators = this.indicatorSvc.computeMultiTimeframe(validCandlesByTf);
      return { indicators, source: 'live' };
    } catch (err) {
      console.warn(
        `[HistoricalIndicatorFetcher] Failed to fetch indicators for ${symbol}, using empty:`,
        err instanceof Error ? err.message : String(err)
      );
      return { indicators: {}, source: 'skipped' };
    }
  }
}
