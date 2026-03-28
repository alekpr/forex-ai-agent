import { query } from '../db/connection';
import { SimilarTrade } from '../types/trade';

export interface VectorSearchOptions {
  minSimilarity?: number;
  limit?: number;
  resultFilter?: 'WIN' | 'LOSS' | 'BREAKEVEN';
}

export class VectorSearchService {
  /**
   * Find similar trades using pgvector cosine distance.
   * Returns trades sorted by similarity descending.
   */
  async findSimilarTrades(
    embedding: number[],
    userId: string,
    options: VectorSearchOptions = {}
  ): Promise<SimilarTrade[]> {
    const { minSimilarity = 0.70, limit = 10, resultFilter } = options;
    const embeddingStr = `[${embedding.join(',')}]`;

    // Use parameterized query; resultFilter is an enum — safe to interpolate after whitelist check
    const resultCondition =
      resultFilter && ['WIN', 'LOSS', 'BREAKEVEN'].includes(resultFilter)
        ? `AND tr.result = '${resultFilter}'`
        : '';

    const result = await query<{
      id: string;
      symbol: string;
      direction: string;
      timeframe: string;
      entry_price: string;
      tp_price: string;
      sl_price: string;
      user_reason: string;
      indicators_snapshot: unknown;
      result: string;
      pips: string;
      profit_usd: string;
      user_exit_reason: string | null;
      ai_lesson: string | null;
      similarity_score: string;
    }>(
      `SELECT
         tl.id, tl.symbol, tl.direction, tl.timeframe,
         tl.entry_price, tl.tp_price, tl.sl_price,
         tl.user_reason, tl.indicators_snapshot,
         tr.result, tr.pips, tr.profit_usd,
         tr.user_exit_reason, tr.ai_lesson,
         1 - (tl.embedding <=> $1::vector) AS similarity_score
       FROM trade_logs tl
       JOIN trade_results tr ON tl.id = tr.trade_log_id
       WHERE tl.user_id = $2
         ${resultCondition}
         AND 1 - (tl.embedding <=> $1::vector) >= $3
       ORDER BY tl.embedding <=> $1::vector
       LIMIT $4`,
      [embeddingStr, userId, minSimilarity, limit]
    );

    return result.rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      direction: r.direction as SimilarTrade['direction'],
      timeframe: r.timeframe as SimilarTrade['timeframe'],
      entryPrice: parseFloat(r.entry_price),
      tpPrice: parseFloat(r.tp_price),
      slPrice: parseFloat(r.sl_price),
      userReason: r.user_reason,
      indicatorsSnapshot: r.indicators_snapshot as SimilarTrade['indicatorsSnapshot'],
      result: r.result as SimilarTrade['result'],
      pips: parseFloat(r.pips),
      profitUsd: parseFloat(r.profit_usd),
      userExitReason: r.user_exit_reason,
      aiLesson: r.ai_lesson,
      similarityScore: parseFloat(r.similarity_score),
    }));
  }

  /**
   * Calculate win rate from similar trades.
   */
  calcWinRate(trades: SimilarTrade[]): number | null {
    if (trades.length === 0) return null;
    const wins = trades.filter((t) => t.result === 'WIN').length;
    return parseFloat(((wins / trades.length) * 100).toFixed(1));
  }
}
