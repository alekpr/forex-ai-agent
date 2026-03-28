import { env } from '../config/env';
import { CandleService } from '../services/CandleService';
import { IndicatorService } from '../services/IndicatorService';
import { EmbeddingService } from '../services/EmbeddingService';
import { ClaudeAiService } from '../services/ClaudeAiService';
import { IndicatorRepository } from '../repositories/IndicatorRepository';
import { TradeLogRepository } from '../repositories/TradeLogRepository';
import { TradeResultRepository } from '../repositories/TradeResultRepository';
import { CreateTradeLogInput, CloseTradeInput, TradeLog, TradeResultRecord } from '../types/trade';
import { OHLCCandle, Timeframe, MultiTimeframeIndicators } from '../types/market';
import { TradeLoggerResponse } from '../types/agent';

const TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h'];

export class TradeLoggerAgent {
  private readonly candleSvc: CandleService;
  private readonly indicatorSvc: IndicatorService;
  private readonly embeddingSvc: EmbeddingService;
  private readonly claudeSvc: ClaudeAiService;
  private readonly indicatorRepo: IndicatorRepository;
  private readonly tradeLogRepo: TradeLogRepository;
  private readonly tradeResultRepo: TradeResultRepository;

  constructor() {
    this.candleSvc = new CandleService();
    this.indicatorSvc = new IndicatorService();
    this.embeddingSvc = new EmbeddingService();
    this.claudeSvc = new ClaudeAiService();
    this.indicatorRepo = new IndicatorRepository();
    this.tradeLogRepo = new TradeLogRepository();
    this.tradeResultRepo = new TradeResultRepository();
  }

  /**
   * Steps 1-4: Accept trade input, fetch market data, compute indicators,
   * get AI analysis, create embedding, and save to DB.
   */
  async logTrade(input: CreateTradeLogInput): Promise<TradeLoggerResponse> {
    try {
      // Step 2: Fetch candles for all timeframes (DB first, API fallback)
      const { candlesByTf, sourcesByTf } = await this.candleSvc.getMultiTimeframeCandles(
        input.symbol,
        TIMEFRAMES,
        250
      );
      console.log(`[TradeLoggerAgent] Candle sources for ${input.symbol}:`, sourcesByTf);

      const marketSnapshot: Record<string, OHLCCandle> = {};
      for (const [tf, candles] of Object.entries(candlesByTf) as [Timeframe, OHLCCandle[]][]) {
        if (candles.length > 0) marketSnapshot[tf] = candles[candles.length - 1];
      }

      // Step 2 continued: Compute indicators for all timeframes
      const indicators: MultiTimeframeIndicators =
        this.indicatorSvc.computeMultiTimeframe(candlesByTf);

      // Persist indicators
      const now = new Date();
      await Promise.all(
        (Object.entries(indicators) as [Timeframe, typeof indicators[Timeframe]][])
          .filter(([, snap]) => snap !== undefined)
          .map(([tf, snap]) =>
            this.indicatorRepo.upsertIndicators(now, input.symbol, tf, snap!)
          )
      );

      // Step 3: AI market analysis
      const aiMarketComment = await this.claudeSvc.analyzeMarketAtEntry(input, indicators);

      // Step 4: Create vector embedding
      const embedding = await this.embeddingSvc.createTradeEmbedding(input, indicators);

      // Persist trade log
      const tradeLog = await this.tradeLogRepo.create(
        env.DEFAULT_USER_ID,
        input,
        marketSnapshot,
        indicators,
        aiMarketComment,
        embedding
      );

      return {
        success: true,
        message: 'Trade logged successfully',
        data: {
          tradeId: tradeLog.id,
          aiMarketComment,
          indicators,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message: 'Failed to log trade', error: message };
    }
  }

  /**
   * Step 5: Record trade result and generate AI lesson.
   */
  async closeTrade(
    tradeId: string,
    closeInput: CloseTradeInput
  ): Promise<{ success: boolean; message: string; error?: string; data?: { aiLesson: string } }> {
    try {
      const tradeLog = await this.tradeLogRepo.findById(tradeId);
      if (!tradeLog) {
        return { success: false, message: `Trade ${tradeId} not found` };
      }
      if (tradeLog.status === 'closed') {
        return { success: false, message: `Trade ${tradeId} is already closed` };
      }

      // Fetch exit market data (DB first, API fallback)
      const { candlesByTf, sourcesByTf: exitSources } = await this.candleSvc.getMultiTimeframeCandles(
        tradeLog.symbol,
        TIMEFRAMES,
        250
      );
      console.log(`[TradeLoggerAgent] Exit candle sources for ${tradeLog.symbol}:`, exitSources);

      const exitMarketSnapshot: Record<string, OHLCCandle> = {};
      for (const [tf, candles] of Object.entries(candlesByTf) as [Timeframe, OHLCCandle[]][]) {
        if (candles.length > 0) exitMarketSnapshot[tf] = candles[candles.length - 1];
      }

      const exitIndicators = this.indicatorSvc.computeMultiTimeframe(candlesByTf);

      // AI lesson
      const { lesson: aiLesson, patternTags } = await this.claudeSvc.summarizeLesson(
        tradeLog,
        closeInput,
        exitIndicators
      );

      // Persist result
      await this.tradeResultRepo.create(
        tradeId,
        closeInput,
        exitMarketSnapshot,
        exitIndicators,
        aiLesson,
        patternTags
      );

      // Mark trade as closed
      await this.tradeLogRepo.updateStatus(tradeId, 'closed');

      return {
        success: true,
        message: 'Trade closed successfully',
        data: { aiLesson },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message: 'Failed to close trade', error: message };
    }
  }
}
