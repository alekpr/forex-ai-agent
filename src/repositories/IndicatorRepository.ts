import { query } from '../db/connection';
import { IndicatorSnapshot, Timeframe } from '../types/market';

export class IndicatorRepository {
  async upsertIndicators(
    time: Date,
    symbol: string,
    timeframe: Timeframe,
    snap: IndicatorSnapshot
  ): Promise<void> {
    await query(
      `INSERT INTO forex_indicators
         (time, symbol, timeframe,
          ema_14, ema_60, ema_200, sma_20,
          rsi_14, macd_line, macd_signal, macd_hist,
          stoch_k, stoch_d, adx_14,
          bb_upper, bb_middle, bb_lower, atr_14)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (time, symbol, timeframe) DO UPDATE SET
         ema_14 = EXCLUDED.ema_14,
         ema_60 = EXCLUDED.ema_60,
         ema_200 = EXCLUDED.ema_200,
         sma_20 = EXCLUDED.sma_20,
         rsi_14 = EXCLUDED.rsi_14,
         macd_line = EXCLUDED.macd_line,
         macd_signal = EXCLUDED.macd_signal,
         macd_hist = EXCLUDED.macd_hist,
         stoch_k = EXCLUDED.stoch_k,
         stoch_d = EXCLUDED.stoch_d,
         adx_14 = EXCLUDED.adx_14,
         bb_upper = EXCLUDED.bb_upper,
         bb_middle = EXCLUDED.bb_middle,
         bb_lower = EXCLUDED.bb_lower,
         atr_14 = EXCLUDED.atr_14`,
      [
        time, symbol, timeframe,
        snap.ema_14, snap.ema_60, snap.ema_200, snap.sma_20,
        snap.rsi_14, snap.macd_line, snap.macd_signal, snap.macd_hist,
        snap.stoch_k, snap.stoch_d, snap.adx_14,
        snap.bb_upper, snap.bb_middle, snap.bb_lower, snap.atr_14,
      ]
    );
  }

  async getLatestIndicators(
    symbol: string,
    timeframe: Timeframe
  ): Promise<IndicatorSnapshot | null> {
    const result = await query<IndicatorSnapshot & { time: Date }>(
      `SELECT ema_14, ema_60, ema_200, sma_20,
              rsi_14, macd_line, macd_signal, macd_hist,
              stoch_k, stoch_d, adx_14,
              bb_upper, bb_middle, bb_lower, atr_14
       FROM forex_indicators
       WHERE symbol = $1 AND timeframe = $2
       ORDER BY time DESC
       LIMIT 1`,
      [symbol, timeframe]
    );
    return result.rows[0] ?? null;
  }
}
