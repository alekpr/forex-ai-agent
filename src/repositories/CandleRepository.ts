import { query } from '../db/connection';
import { OHLCCandle, Timeframe } from '../types/market';

export class CandleRepository {
  async upsertCandles(candles: OHLCCandle[]): Promise<void> {
    if (candles.length === 0) return;

    const values = candles
      .map(
        (_, i) =>
          `($${i * 8 + 1}, $${i * 8 + 2}, $${i * 8 + 3}, $${i * 8 + 4}, $${i * 8 + 5}, $${i * 8 + 6}, $${i * 8 + 7}, $${i * 8 + 8})`
      )
      .join(',');

    const params = candles.flatMap((c) => [
      c.time,
      c.symbol,
      c.timeframe,
      c.open,
      c.high,
      c.low,
      c.close,
      c.volume,
    ]);

    await query(
      `INSERT INTO forex_candles (time, symbol, timeframe, open, high, low, close, volume)
       VALUES ${values}
       ON CONFLICT (time, symbol, timeframe) DO UPDATE SET
         open = EXCLUDED.open,
         high = EXCLUDED.high,
         low = EXCLUDED.low,
         close = EXCLUDED.close,
         volume = EXCLUDED.volume`,
      params
    );
  }

  async getLatestCandles(
    symbol: string,
    timeframe: Timeframe,
    limit = 200
  ): Promise<OHLCCandle[]> {
    const result = await query<{
      time: Date;
      symbol: string;
      timeframe: string;
      open: string;
      high: string;
      low: string;
      close: string;
      volume: string;
    }>(
      `SELECT time, symbol, timeframe, open, high, low, close, volume
       FROM forex_candles
       WHERE symbol = $1 AND timeframe = $2
       ORDER BY time DESC
       LIMIT $3`,
      [symbol, timeframe, limit]
    );

    return result.rows
      .map((r) => ({
        time: r.time,
        symbol: r.symbol,
        timeframe: r.timeframe as Timeframe,
        open: parseFloat(r.open),
        high: parseFloat(r.high),
        low: parseFloat(r.low),
        close: parseFloat(r.close),
        volume: parseInt(r.volume, 10),
      }))
      .reverse(); // oldest → newest
  }
}
