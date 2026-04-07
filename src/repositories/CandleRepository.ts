import { query } from '../db/connection';
import { OHLCCandle, Timeframe } from '../types/market';

export class CandleRepository {
  async upsertCandles(candles: OHLCCandle[]): Promise<void> {
    if (candles.length === 0) return;

    // Deduplicate by (time, symbol, timeframe) — keep last occurrence to avoid
    // "ON CONFLICT DO UPDATE command cannot affect row a second time" error.
    const seen = new Map<string, OHLCCandle>();
    for (const c of candles) {
      seen.set(`${c.time.getTime?.() ?? c.time}|${c.symbol}|${c.timeframe}`, c);
    }
    const unique = Array.from(seen.values());

    const values = unique
      .map(
        (_, i) =>
          `($${i * 8 + 1}, $${i * 8 + 2}, $${i * 8 + 3}, $${i * 8 + 4}, $${i * 8 + 5}, $${i * 8 + 6}, $${i * 8 + 7}, $${i * 8 + 8})`
      )
      .join(',');

    const params = unique.flatMap((c) => [
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

  async getLatestCandleTime(symbol: string, timeframe: Timeframe): Promise<Date | null> {
    const result = await query<{ time: Date }>(
      `SELECT time FROM forex_candles WHERE symbol = $1 AND timeframe = $2 ORDER BY time DESC LIMIT 1`,
      [symbol, timeframe]
    );
    return result.rows[0]?.time ?? null;
  }

  /**
   * Fetch up to `limit` candles ending at or before `beforeTime`, oldest→newest.
   * Used for backdated trade analysis.
   */
  async getCandlesUpTo(
    symbol: string,
    timeframe: Timeframe,
    beforeTime: Date,
    limit = 250
  ): Promise<OHLCCandle[]> {
    const result = await query<{
      time: Date; symbol: string; timeframe: string;
      open: string; high: string; low: string; close: string; volume: string;
    }>(
      `SELECT time, symbol, timeframe, open, high, low, close, volume
       FROM forex_candles
       WHERE symbol = $1 AND timeframe = $2 AND time <= $3
       ORDER BY time DESC
       LIMIT $4`,
      [symbol, timeframe, beforeTime, limit]
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

  async aggregateFromFiveMin(symbol: string, targetTf: Timeframe, sinceInterval: string): Promise<number> {
    const bucketMap: Partial<Record<Timeframe, string>> = {
      '15m': '15 minutes',
      '30m': '30 minutes',
      '1h': '1 hour',
      '4h': '4 hours',
      '1d': '1 day',
    };
    const bucket = bucketMap[targetTf];
    if (!bucket) throw new Error(`Cannot aggregate to timeframe: ${targetTf}`);

    const result = await query(
      `INSERT INTO forex_candles (time, symbol, timeframe, open, high, low, close, volume)
       SELECT
         time_bucket($1::interval, time) AS bucket_time,
         $2::text,
         $4::text,
         first(open, time),
         MAX(high),
         MIN(low),
         last(close, time),
         SUM(volume)
       FROM forex_candles
       WHERE symbol = $2::text AND timeframe = '5m' AND time >= NOW() - $3::interval
       GROUP BY bucket_time
       ON CONFLICT (time, symbol, timeframe) DO UPDATE SET
         open   = EXCLUDED.open,
         high   = EXCLUDED.high,
         low    = EXCLUDED.low,
         close  = EXCLUDED.close,
         volume = EXCLUDED.volume`,
      [bucket, symbol, sinceInterval, targetTf]
    );
    return (result as unknown as { rowCount: number }).rowCount ?? 0;
  }
}
