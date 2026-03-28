import { env } from '../config/env';
import { CandleService } from '../services/CandleService';
import { IndicatorService } from '../services/IndicatorService';
import { EmbeddingService } from '../services/EmbeddingService';
import { ClaudeAiService } from '../services/ClaudeAiService';
import { VectorSearchService } from '../services/VectorSearchService';
import { IndicatorRepository } from '../repositories/IndicatorRepository';
import { AlertRepository } from '../repositories/AlertRepository';
import { AnalyzeRequest, AnalyzeResponse } from '../types/agent';
import { OHLCCandle, Timeframe, MultiTimeframeIndicators } from '../types/market';

const TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h'];

export class MarketAnalyzerAgent {
  private readonly candleSvc: CandleService;
  private readonly indicatorSvc: IndicatorService;
  private readonly embeddingSvc: EmbeddingService;
  private readonly claudeSvc: ClaudeAiService;
  private readonly vectorSearch: VectorSearchService;
  private readonly indicatorRepo: IndicatorRepository;
  private readonly alertRepo: AlertRepository;

  constructor() {
    this.candleSvc = new CandleService();
    this.indicatorSvc = new IndicatorService();
    this.embeddingSvc = new EmbeddingService();
    this.claudeSvc = new ClaudeAiService();
    this.vectorSearch = new VectorSearchService();
    this.indicatorRepo = new IndicatorRepository();
    this.alertRepo = new AlertRepository();
  }

  /**
   * Steps 1-4: Fetch current market data, compute indicators, run vector search,
   * synthesize with Claude AI, return recommendation.
   */
  async analyze(request: AnalyzeRequest): Promise<AnalyzeResponse> {
    try {
      const { symbol, timeframe, riskLevel = 'medium' } = request;

      // Step 2: Fetch candles (DB first, API fallback) + build candle context from DB
      const [{ candlesByTf, sourcesByTf }, candleContext] = await Promise.all([
        this.candleSvc.getMultiTimeframeCandles(symbol, TIMEFRAMES, 250),
        this.candleSvc.buildCandleContext(symbol, timeframe, 50),
      ]);
      console.log(`[MarketAnalyzerAgent] Candle sources for ${symbol}:`, sourcesByTf);

      const marketSnapshot: Record<string, OHLCCandle> = {};
      for (const [tf, candles] of Object.entries(candlesByTf) as [Timeframe, OHLCCandle[]][]) {
        if (candles.length > 0) marketSnapshot[tf] = candles[candles.length - 1];
      }

      const indicators: MultiTimeframeIndicators =
        this.indicatorSvc.computeMultiTimeframe(candlesByTf);

      const currentPrice =
        marketSnapshot[timeframe]?.close ??
        marketSnapshot['15m']?.close ??
        marketSnapshot['1h']?.close ??
        0;

      // Step 3: Vector similarity search for historical trades
      const embedding = await this.embeddingSvc.createMarketEmbedding(
        symbol,
        'ANALYZE',
        timeframe,
        currentPrice,
        indicators
      );

      const similarTrades = await this.vectorSearch.findSimilarTrades(
        embedding,
        env.DEFAULT_USER_ID,
        { limit: 10 }
      );
      const winRate = this.vectorSearch.calcWinRate(similarTrades);

      // Step 4: Claude AI synthesis (with DB candle context enrichment)
      const aiResult = await this.claudeSvc.generateAnalysisRecommendation(
        symbol,
        timeframe,
        currentPrice,
        indicators,
        similarTrades,
        riskLevel,
        candleContext
      );

      // Persist alert for audit trail
      await this.alertRepo.create(
        env.DEFAULT_USER_ID,
        symbol,
        timeframe,
        aiResult.recommendation,
        aiResult.confidence,
        aiResult.analysis,
        aiResult.suggestedTp,
        aiResult.suggestedSl,
        indicators
      );

      return {
        success: true,
        message: 'Market analysis complete',
        data: {
          symbol,
          timeframe,
          recommendation: aiResult.recommendation as AnalyzeResponse['data'] extends undefined
            ? never
            : NonNullable<AnalyzeResponse['data']>['recommendation'],
          confidence: aiResult.confidence,
          suggestedTp: aiResult.suggestedTp,
          suggestedSl: aiResult.suggestedSl,
          riskScore: aiResult.riskScore,
          aiAnalysis: aiResult.analysis,
          similarTrades,
          winRate,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message: 'Market analysis failed', error: message };
    }
  }
}
