import { CandleRepository } from '../repositories/CandleRepository';
import { MarketDataService } from './market-data/MarketDataService';
import { Timeframe } from '../types/market';

interface AggregateTarget {
  tf: Timeframe;
  since: string;
}

const AGGREGATE_TARGETS: AggregateTarget[] = [
  { tf: '15m', since: '2 hours' },
  { tf: '30m', since: '4 hours' },
  { tf: '1h',  since: '6 hours' },
  { tf: '4h',  since: '2 days' },
  { tf: '1d',  since: '3 days' },
];

export class CandleRefreshService {
  private readonly candleRepo = new CandleRepository();
  private readonly marketData = new MarketDataService();
  private readonly lastRefresh = new Map<string, Date>();

  async refresh(symbols: string[]): Promise<void> {
    console.log(`[CandleRefresh] Refreshing candles for: ${symbols.join(', ')}`);

    for (const symbol of symbols) {
      try {
        // One API call: fetch 300 × 5m candles (~25 hours of data)
        const candles = await this.marketData.getOHLCCandles(symbol, '5m', 300);
        if (candles.length === 0) {
          console.warn(`[CandleRefresh] No 5m candles returned for ${symbol}`);
          continue;
        }

        await this.candleRepo.upsertCandles(candles);
        console.log(`[CandleRefresh] ${symbol}: upserted ${candles.length} × 5m candles`);

        // Aggregate into larger timeframes inside the DB (no extra API calls)
        for (const { tf, since } of AGGREGATE_TARGETS) {
          const rows = await this.candleRepo.aggregateFromFiveMin(symbol, tf, since);
          console.log(`[CandleRefresh] ${symbol}: aggregated ${rows} × ${tf} candles`);
        }

        this.lastRefresh.set(symbol, new Date());
      } catch (err) {
        console.error(`[CandleRefresh] Error refreshing ${symbol}:`, (err as Error).message);
      }

      // Small delay between symbols to avoid API rate limits
      await new Promise((r) => setTimeout(r, 500));
    }

    console.log('[CandleRefresh] Done');
  }

  getStatus(): Record<string, string> {
    const status: Record<string, string> = {};
    for (const [symbol, date] of this.lastRefresh) {
      status[symbol] = date.toISOString();
    }
    return status;
  }
}
