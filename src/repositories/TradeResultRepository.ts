import { query } from '../db/connection';
import { TradeResultRecord, CloseTradeInput } from '../types/trade';
import { MultiTimeframeIndicators, OHLCCandle } from '../types/market';

export class TradeResultRepository {
  async create(
    tradeLogId: string,
    input: CloseTradeInput,
    exitMarketSnapshot: Record<string, OHLCCandle>,
    exitIndicatorsSnapshot: MultiTimeframeIndicators,
    aiLesson: string,
    aiPatternTags: string[]
  ): Promise<TradeResultRecord> {
    const result = await query<TradeResultRecord>(
      `INSERT INTO trade_results
         (trade_log_id, result, exit_price, exit_time, pips, profit_usd,
          exit_market_snapshot, exit_indicators_snapshot,
          user_exit_reason, user_lesson, ai_lesson, ai_pattern_tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        tradeLogId,
        input.result,
        input.exitPrice,
        input.exitTime,
        input.pips,
        input.profitUsd,
        JSON.stringify(exitMarketSnapshot),
        JSON.stringify(exitIndicatorsSnapshot),
        input.userExitReason,
        input.userLesson ?? null,
        aiLesson,
        JSON.stringify(aiPatternTags),
      ]
    );
    return result.rows[0];
  }

  async findByTradeLogId(tradeLogId: string): Promise<TradeResultRecord | null> {
    const result = await query<TradeResultRecord>(
      `SELECT * FROM trade_results WHERE trade_log_id = $1`,
      [tradeLogId]
    );
    return result.rows[0] ?? null;
  }
}
