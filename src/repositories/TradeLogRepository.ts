import { query } from '../db/connection';
import { TradeLog, CreateTradeLogInput, TradeStatus, ClosedTradeWithResult } from '../types/trade';
import { MultiTimeframeIndicators, OHLCCandle } from '../types/market';

// Raw DB row (snake_case) returned by SELECT *
interface RawTradeLog {
  id: string;
  user_id: string;
  symbol: string;
  direction: string;
  timeframe: string;
  entry_price: string;
  tp_price: string;
  sl_price: string;
  entry_time: Date;
  user_reason: string;
  indicators_used: unknown;
  user_analysis: string | null;
  market_snapshot: unknown;
  indicators_snapshot: unknown;
  ai_market_comment: string | null;
  embedding: unknown;
  status: string;
  created_at: Date;
}

function mapRow(r: RawTradeLog): TradeLog {
  return {
    id: r.id,
    userId: r.user_id,
    symbol: r.symbol,
    direction: r.direction as TradeLog['direction'],
    timeframe: r.timeframe as TradeLog['timeframe'],
    entryPrice: parseFloat(r.entry_price),
    tpPrice: parseFloat(r.tp_price),
    slPrice: parseFloat(r.sl_price),
    entryTime: r.entry_time,
    userReason: r.user_reason,
    indicatorsUsed: (r.indicators_used as string[]) ?? [],
    userAnalysis: r.user_analysis,
    marketSnapshot: r.market_snapshot as TradeLog['marketSnapshot'],
    indicatorsSnapshot: r.indicators_snapshot as TradeLog['indicatorsSnapshot'],
    aiMarketComment: r.ai_market_comment,
    embedding: null,
    status: r.status as TradeLog['status'],
    createdAt: r.created_at,
  };
}

export class TradeLogRepository {
  async create(
    userId: string,
    input: CreateTradeLogInput,
    marketSnapshot: Record<string, OHLCCandle>,
    indicatorsSnapshot: MultiTimeframeIndicators,
    aiMarketComment: string,
    embedding: number[]
  ): Promise<TradeLog> {
    // pgvector expects the embedding as a formatted string '[x,y,z,...]'
    const embeddingStr = `[${embedding.join(',')}]`;

    const result = await query<TradeLog>(
      `INSERT INTO trade_logs
         (user_id, symbol, direction, timeframe,
          entry_price, tp_price, sl_price, entry_time,
          user_reason, indicators_used, user_analysis,
          market_snapshot, indicators_snapshot,
          ai_market_comment, embedding, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::vector,'open')
       RETURNING *`,
      [
        userId,
        input.symbol,
        input.direction,
        input.timeframe,
        input.entryPrice,
        input.tpPrice,
        input.slPrice,
        input.entryTime,
        input.userReason,
        JSON.stringify(input.indicatorsUsed),
        input.userAnalysis ?? null,
        JSON.stringify(marketSnapshot),
        JSON.stringify(indicatorsSnapshot),
        aiMarketComment,
        embeddingStr,
      ]
    );
    return result.rows[0];
  }

  async findById(id: string): Promise<TradeLog | null> {
    const result = await query<RawTradeLog>(
      `SELECT * FROM trade_logs WHERE id = $1`,
      [id]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async updateStatus(id: string, status: TradeStatus): Promise<void> {
    await query(
      `UPDATE trade_logs SET status = $1 WHERE id = $2`,
      [status, id]
    );
  }

  async findOpenTrades(userId: string): Promise<TradeLog[]> {
    const result = await query<RawTradeLog>(
      `SELECT * FROM trade_logs WHERE user_id = $1 AND status = 'open' ORDER BY entry_time DESC`,
      [userId]
    );
    return result.rows.map(mapRow);
  }

  async findClosedWithResults(userId: string, since: Date, until: Date): Promise<ClosedTradeWithResult[]> {
    interface RawRow {
      id: string; symbol: string; direction: string; timeframe: string;
      entry_price: string; tp_price: string; sl_price: string; entry_time: Date;
      user_reason: string; indicators_used: unknown; user_analysis: string | null;
      ai_market_comment: string | null; created_at: Date;
      result: string; exit_price: string; exit_time: Date;
      pips: string; profit_usd: string;
      user_exit_reason: string; user_lesson: string | null;
      ai_lesson: string | null; ai_pattern_tags: unknown;
    }
    const result = await query<RawRow>(
      `SELECT
         tl.id, tl.symbol, tl.direction, tl.timeframe,
         tl.entry_price, tl.tp_price, tl.sl_price, tl.entry_time,
         tl.user_reason, tl.indicators_used, tl.user_analysis,
         tl.ai_market_comment, tl.created_at,
         tr.result, tr.exit_price, tr.exit_time, tr.pips, tr.profit_usd,
         tr.user_exit_reason, tr.user_lesson, tr.ai_lesson, tr.ai_pattern_tags
       FROM trade_logs tl
       JOIN trade_results tr ON tr.trade_log_id = tl.id
       WHERE tl.user_id = $1
         AND tl.entry_time >= $2
         AND tl.entry_time < $3
       ORDER BY tl.entry_time DESC`,
      [userId, since, until]
    );
    return result.rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      direction: r.direction as ClosedTradeWithResult['direction'],
      timeframe: r.timeframe as ClosedTradeWithResult['timeframe'],
      entryPrice: parseFloat(r.entry_price),
      tpPrice: parseFloat(r.tp_price),
      slPrice: parseFloat(r.sl_price),
      entryTime: r.entry_time,
      userReason: r.user_reason,
      indicatorsUsed: (r.indicators_used as string[]) ?? [],
      userAnalysis: r.user_analysis,
      aiMarketComment: r.ai_market_comment,
      createdAt: r.created_at,
      result: r.result as ClosedTradeWithResult['result'],
      exitPrice: parseFloat(r.exit_price),
      exitTime: r.exit_time,
      pips: parseFloat(r.pips),
      profitUsd: parseFloat(r.profit_usd),
      userExitReason: r.user_exit_reason,
      userLesson: r.user_lesson,
      aiLesson: r.ai_lesson,
      aiPatternTags: (r.ai_pattern_tags as string[]) ?? [],
    }));
  }
}
