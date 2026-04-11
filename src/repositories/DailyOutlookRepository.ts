import { query } from '../db/connection';

export interface DailyOutlookRow {
  id: string;
  user_id: string;
  symbol: string;
  analysis_date: Date;
  macro_trend: string | null;
  primary_trend: string | null;
  current_price: string | null;
  primary_zone_low: string | null;
  primary_zone_high: string | null;
  secondary_zone_low: string | null;
  secondary_zone_high: string | null;
  key_resistance: string | null;
  key_support: string | null;
  adx_value: string | null;
  bias: string | null;
  ai_analysis: string | null;
  trading_plan: string | null;
  telegram_message_text: string | null;
  is_sent: boolean;
  sent_at: Date | null;
  created_at: Date;
}

export interface CreateDailyOutlookInput {
  symbol: string;
  analysisDate: Date;
  macroTrend: string;
  primaryTrend: string;
  currentPrice: number;
  primaryZoneLow: number | null;
  primaryZoneHigh: number | null;
  secondaryZoneLow: number | null;
  secondaryZoneHigh: number | null;
  keyResistance: number | null;
  keySupport: number | null;
  adxValue: number | null;
  bias: string;
  aiAnalysis: string;
  tradingPlan: string;
}

export class DailyOutlookRepository {
  async create(userId: string, input: CreateDailyOutlookInput): Promise<string> {
    const result = await query<{ id: string }>(
      `INSERT INTO daily_outlook_logs
         (user_id, symbol, analysis_date, macro_trend, primary_trend, current_price,
          primary_zone_low, primary_zone_high, secondary_zone_low, secondary_zone_high,
          key_resistance, key_support, adx_value, bias, ai_analysis, trading_plan)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (user_id, symbol, analysis_date) DO UPDATE SET
         macro_trend = EXCLUDED.macro_trend,
         primary_trend = EXCLUDED.primary_trend,
         current_price = EXCLUDED.current_price,
         bias = EXCLUDED.bias,
         ai_analysis = EXCLUDED.ai_analysis,
         trading_plan = EXCLUDED.trading_plan
       RETURNING id`,
      [
        userId,
        input.symbol,
        input.analysisDate,
        input.macroTrend,
        input.primaryTrend,
        input.currentPrice,
        input.primaryZoneLow,
        input.primaryZoneHigh,
        input.secondaryZoneLow,
        input.secondaryZoneHigh,
        input.keyResistance,
        input.keySupport,
        input.adxValue,
        input.bias,
        input.aiAnalysis,
        input.tradingPlan,
      ]
    );
    return result.rows[0].id;
  }

  async markSent(id: string, telegramMessageText: string): Promise<void> {
    await query(
      `UPDATE daily_outlook_logs
       SET is_sent = true, sent_at = NOW(), telegram_message_text = $2
       WHERE id = $1`,
      [id, telegramMessageText]
    );
  }

  /** Returns today's record if it already exists (Bangkok local date). */
  async findToday(userId: string, symbol: string): Promise<DailyOutlookRow | null> {
    const bangkokDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD
    const result = await query<DailyOutlookRow>(
      `SELECT * FROM daily_outlook_logs
       WHERE user_id = $1 AND symbol = $2 AND analysis_date = $3
       LIMIT 1`,
      [userId, symbol, bangkokDate]
    );
    return result.rows[0] ?? null;
  }

  /** Returns the last N daily outlook records for a symbol (for history / review). */
  async findRecent(userId: string, symbol: string, limit = 7): Promise<DailyOutlookRow[]> {
    const result = await query<DailyOutlookRow>(
      `SELECT * FROM daily_outlook_logs
       WHERE user_id = $1 AND symbol = $2
       ORDER BY analysis_date DESC
       LIMIT $3`,
      [userId, symbol, limit]
    );
    return result.rows;
  }
}
