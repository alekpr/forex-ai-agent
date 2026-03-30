import { query } from '../db/connection';
import { TradeLog, CreateTradeLogInput, TradeStatus } from '../types/trade';
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
}
