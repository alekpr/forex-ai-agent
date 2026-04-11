import { query } from '../db/connection';
import { AlertSettings } from '../types/agent';

interface AlertRow {
  id: string;
  user_id: string;
  symbol: string;
  timeframe: string;
  direction: string;
  confidence_score: string;
  ai_analysis: string;
  suggested_tp: string;
  suggested_sl: string;
  indicators_snapshot: unknown;
  is_sent: boolean;
  sent_at: Date | null;
  created_at: Date;
}

export class AlertRepository {
  async create(
    userId: string,
    symbol: string,
    timeframe: string,
    direction: string,
    confidenceScore: number,
    aiAnalysis: string,
    suggestedTp: number | null,
    suggestedSl: number | null,
    indicatorsSnapshot: unknown
  ): Promise<string> {
    const result = await query<{ id: string }>(
      `INSERT INTO ai_alerts
         (user_id, symbol, timeframe, direction, confidence_score,
          ai_analysis, suggested_tp, suggested_sl, indicators_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        userId, symbol, timeframe, direction, confidenceScore,
        aiAnalysis, suggestedTp, suggestedSl, JSON.stringify(indicatorsSnapshot),
      ]
    );
    return result.rows[0].id;
  }

  async findPending(userId: string): Promise<AlertRow[]> {
    const result = await query<AlertRow>(
      `SELECT * FROM ai_alerts
       WHERE user_id = $1 AND is_sent = false
       ORDER BY created_at DESC
       LIMIT 10`,
      [userId]
    );
    return result.rows;
  }

  async markSent(id: string): Promise<void> {
    await query(
      `UPDATE ai_alerts SET is_sent = true, sent_at = NOW() WHERE id = $1`,
      [id]
    );
  }

  async getSettings(userId: string): Promise<AlertSettings | null> {
    const result = await query<{
      alert_enabled: boolean;
      alert_interval_minutes: number;
      risk_level: string;
      confidence_threshold: string;
      candle_refresh_enabled: boolean;
      candle_refresh_interval_minutes: number;
      daily_outlook_enabled: boolean;
      daily_outlook_hour: number;
      daily_outlook_symbols: string;
    }>(
      `SELECT alert_enabled, alert_interval_minutes, risk_level, confidence_threshold,
              candle_refresh_enabled, candle_refresh_interval_minutes,
              daily_outlook_enabled, daily_outlook_hour, daily_outlook_symbols
       FROM users WHERE id = $1`,
      [userId]
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      alertEnabled: row.alert_enabled,
      alertIntervalMinutes: row.alert_interval_minutes,
      riskLevel: row.risk_level as 'low' | 'medium' | 'high',
      confidenceThreshold: parseFloat(row.confidence_threshold),
      candleRefreshEnabled: row.candle_refresh_enabled ?? true,
      candleRefreshIntervalMinutes: row.candle_refresh_interval_minutes ?? 15,
      dailyOutlookEnabled: row.daily_outlook_enabled ?? false,
      dailyOutlookHour: row.daily_outlook_hour ?? 7,
      dailyOutlookSymbols: row.daily_outlook_symbols ?? 'EURUSD,GBPUSD',
    };
  }

  async updateSettings(userId: string, settings: Partial<AlertSettings>): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (settings.alertEnabled !== undefined) {
      fields.push(`alert_enabled = $${idx++}`);
      values.push(settings.alertEnabled);
    }
    if (settings.alertIntervalMinutes !== undefined) {
      fields.push(`alert_interval_minutes = $${idx++}`);
      values.push(settings.alertIntervalMinutes);
    }
    if (settings.riskLevel !== undefined) {
      fields.push(`risk_level = $${idx++}`);
      values.push(settings.riskLevel);
    }
    if (settings.confidenceThreshold !== undefined) {
      fields.push(`confidence_threshold = $${idx++}`);
      values.push(settings.confidenceThreshold);
    }
    if (settings.candleRefreshEnabled !== undefined) {
      fields.push(`candle_refresh_enabled = $${idx++}`);
      values.push(settings.candleRefreshEnabled);
    }
    if (settings.candleRefreshIntervalMinutes !== undefined) {
      fields.push(`candle_refresh_interval_minutes = $${idx++}`);
      values.push(settings.candleRefreshIntervalMinutes);
    }
    if (settings.dailyOutlookEnabled !== undefined) {
      fields.push(`daily_outlook_enabled = $${idx++}`);
      values.push(settings.dailyOutlookEnabled);
    }
    if (settings.dailyOutlookHour !== undefined) {
      fields.push(`daily_outlook_hour = $${idx++}`);
      values.push(settings.dailyOutlookHour);
    }
    if (settings.dailyOutlookSymbols !== undefined) {
      fields.push(`daily_outlook_symbols = $${idx++}`);
      values.push(settings.dailyOutlookSymbols);
    }

    if (fields.length === 0) return;
    values.push(userId);

    await query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}`,
      values
    );
  }
}
