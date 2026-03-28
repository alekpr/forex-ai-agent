import { env } from '../config/env';
import { MarketDataService } from '../services/market-data/MarketDataService';
import { IndicatorService } from '../services/IndicatorService';
import { EmbeddingService } from '../services/EmbeddingService';
import { ClaudeAiService } from '../services/ClaudeAiService';
import { VectorSearchService } from '../services/VectorSearchService';
import { CandleRepository } from '../repositories/CandleRepository';
import { IndicatorRepository } from '../repositories/IndicatorRepository';
import { AlertRepository } from '../repositories/AlertRepository';
import { AnalyzeRequest, AnalyzeResponse } from '../types/agent';
import { OHLCCandle, Timeframe, MultiTimeframeIndicators } from '../types/market';

const TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h'];

export class MarketAnalyzerAgent {
  private readonly marketData: MarketDataService;
  private readonly indicatorSvc: IndicatorService;
  private readonly embeddingSvc: EmbeddingService;
  private readonly claudeSvc: ClaudeAiService;
  private readonly vectorSearch: VectorSearchService;
  private readonly candleRepo: CandleRepository;
  private readonly indicatorRepo: IndicatorRepository;
  private readonly alertRepo: AlertRepository;

  constructor() {
    this.marketData = new MarketDataService();
    this.indicatorSvc = new IndicatorService();
    this.embeddingSvc = new EmbeddingService();
    this.claudeSvc = new ClaudeAiService();
    this.vectorSearch = new VectorSearchService();
    this.candleRepo = new CandleRepository();
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

      // Step 2: Fetch current candles + compute indicators
      const candlesByTf: Partial<Record<Timeframe, OHLCCandle[]>> = {};
      const marketSnapshot: Record<string, OHLCCandle> = {};

      await Promise.all(
        TIMEFRAMES.map(async (tf) => {
          const candles = await this.marketData.getOHLCCandles(symbol, tf, 250);
          if (candles.length > 0) {
            candlesByTf[tf] = candles;
            marketSnapshot[tf] = candles[candles.length - 1];
            await this.candleRepo.upsertCandles(candles);
          }
        })
      );

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

      // Step 4: Claude AI synthesis
      const aiResult = await this.claudeSvc.generateAnalysisRecommendation(
        symbol,
        timeframe,
        currentPrice,
        indicators,
        similarTrades,
        riskLevel
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
