import { env } from '../config/env';
import { CandleService } from '../services/CandleService';
import { IndicatorService } from '../services/IndicatorService';
import { EmbeddingService } from '../services/EmbeddingService';
import { ClaudeAiService } from '../services/ClaudeAiService';
import { VectorSearchService } from '../services/VectorSearchService';
import { IndicatorRepository } from '../repositories/IndicatorRepository';
import { AlertRepository } from '../repositories/AlertRepository';
import { AnalyzeRequest, AnalyzeResponse } from '../types/agent';
import {
  OHLCCandle,
  Timeframe,
  MultiTimeframeIndicators,
  TrendDirection,
  TrendConfluenceResult,
  SRContext,
} from '../types/market';

const TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h'];

/**
 * Timeframe hierarchy for multi-TF analysis:
 * - 5m:  macro=1h  (controls BUY/SELL direction) | primary=15m (confirms momentum) | entry=5m  (pullback)
 * - 15m: macro=4h  (controls BUY/SELL direction) | primary=1h  (confirms momentum) | entry=15m (pullback)
 * - 1h/4h: macro=4h / primary=4h / entry=requestedTF
 */
const TF_HIERARCHY: Record<string, { primary: Timeframe; macro: Timeframe; entry: Timeframe }> = {
  '5m':  { primary: '15m', macro: '1h',  entry: '5m'  },
  '15m': { primary: '1h',  macro: '4h',  entry: '15m' },
  '1h':  { primary: '4h',  macro: '4h',  entry: '1h'  },
  '4h':  { primary: '4h',  macro: '4h',  entry: '4h'  },
};

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

      // Step 1: Fetch candles (always fresh from API for live analysis) + build candle context from DB
      const [{ candlesByTf, sourcesByTf }, candleContext] = await Promise.all([
        this.candleSvc.getMultiTimeframeCandles(symbol, TIMEFRAMES, 250, undefined, true),
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

      // Step 2: Trend confluence analysis — derive macro-bias direction first so Claude
      // receives a meaningful confluenceSummary from the start (single-pass approach).
      // We pass the macro-trend direction as initial bias (BUY if bullish, SELL if bearish).
      const macroSnap = indicators[TF_HIERARCHY[timeframe as Timeframe]?.macro ?? '4h'];
      const macroBias = macroSnap
        ? this.indicatorSvc.getTrendDirection(currentPrice, macroSnap)
        : 'mixed';
      const initialDirection: 'BUY' | 'SELL' | null =
        macroBias === 'bullish' ? 'BUY' : macroBias === 'bearish' ? 'SELL' : null;

      const trendContext = this.analyzeTrendConfluence(currentPrice, indicators, initialDirection, timeframe as Timeframe);

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

      // Step 4: Claude AI synthesis (with trend context + DB candle context enrichment)
      // Compute S/R from the entry timeframe candles
      const entryCandlesForSR = candlesByTf[timeframe as Timeframe] ?? [];
      const srContext = entryCandlesForSR.length >= 10
        ? this.indicatorSvc.computeSupportResistance(entryCandlesForSR, currentPrice, symbol)
        : undefined;

      const aiResult = await this.claudeSvc.generateAnalysisRecommendation(
        symbol,
        timeframe,
        currentPrice,
        indicators,
        similarTrades,
        riskLevel,
        trendContext,
        candleContext,
        srContext
      );

      // Step 5: Re-evaluate confluence with the actual direction Claude returned.
      // If Claude agreed with macro bias, the summary is already correct; if Claude
      // deviated (e.g. chose counter-trend), recalculate to apply the counter-trend penalties.
      const claudeDirection = aiResult.recommendation as 'BUY' | 'SELL' | 'WAIT' | null;
      const finalTrendContext =
        claudeDirection === initialDirection || claudeDirection === 'WAIT'
          ? trendContext  // reuse — Claude followed the bias we already evaluated
          : this.analyzeTrendConfluence(currentPrice, indicators, claudeDirection, timeframe as Timeframe);

      // Apply confidence adjustment from confluence rules (cap 0–0.95)
      const adjustedConfidence = Math.max(
        0,
        Math.min(0.95, aiResult.confidence + finalTrendContext.confidenceAdjustment)
      );

      // Step 6a: ATR SL enforcement — SL must be 1–2× ATR away from entry
      const entrySnap = indicators[timeframe as Timeframe];
      const entryAtr = entrySnap?.atr_14 ?? null;
      const { finalSl, slAtrAdjusted } = this.enforceAtrSl(
        currentPrice,
        aiResult.suggestedSl,
        aiResult.recommendation as 'BUY' | 'SELL' | null,
        entryAtr
      );
      if (slAtrAdjusted) {
        console.log(
          `[MarketAnalyzerAgent] SL ATR-enforced for ${symbol}: ` +
          `${aiResult.suggestedSl} → ${finalSl} (ATR=${entryAtr})`
        );
      }

      // Step 6b: S/R SL/TP placement validation — snap SL behind nearest S/R;
      // cap or warn if TP is blocked by strong S/R.
      const recommendation = aiResult.recommendation as 'BUY' | 'SELL' | null;
      const { finalSl: srAdjustedSl, finalTp: srAdjustedTp, srWarning } = this.validateSRPlacement(
        currentPrice,
        aiResult.suggestedTp,
        finalSl,
        recommendation,
        srContext
      );
      if (srWarning) {
        console.log(`[MarketAnalyzerAgent] S/R warning for ${symbol}: ${srWarning}`);
      }

      // Step 6c: RR validation — enforce minimum RR per strategy rules
      const { adjustedTp, rrAdjusted, actualRR } = this.validateAndAdjustRR(
        currentPrice,
        srAdjustedTp,
        srAdjustedSl,
        finalTrendContext.minRR
      );

      if (rrAdjusted) {
        console.log(
          `[MarketAnalyzerAgent] TP adjusted for ${symbol}: RR was ${(actualRR ?? 0).toFixed(2)}, ` +
          `required ${finalTrendContext.minRR} (${finalTrendContext.isFollowTrend ? 'follow' : 'counter'} trend)`
        );
      }

      // Persist alert for audit trail
      await this.alertRepo.create(
        env.DEFAULT_USER_ID,
        symbol,
        timeframe,
        aiResult.recommendation,
        adjustedConfidence,
        aiResult.analysis,
        adjustedTp,
        srAdjustedSl,
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
          confidence: adjustedConfidence,
          suggestedTp: adjustedTp,
          suggestedSl: srAdjustedSl,
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

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Analyze Multi-TF trend confluence using H1 (primary) and H4 (supplementary).
   * Optionally evaluates whether a given entry direction follows or counters H1 trend.
   *
   * Rules:
   * - H4 conflicts H1 → confidenceAdjustment = −0.10
   * - Entry direction counters H1 trend → confidenceAdjustment −0.10 (cumulative)
   * - Follow trend → minRR = 1.5 | Counter trend → minRR = 1.0
   */
  private analyzeTrendConfluence(
    price: number,
    indicators: MultiTimeframeIndicators,
    entryDirection: 'BUY' | 'SELL' | null,
    requestedTimeframe: Timeframe
  ): TrendConfluenceResult {
    const { primary, macro, entry } = TF_HIERARCHY[requestedTimeframe] ?? TF_HIERARCHY['15m'];

    const primarySnap = indicators[primary];
    const macroSnap   = indicators[macro];
    const entrySnap   = indicators[entry];

    const primaryTrend: TrendDirection = primarySnap
      ? this.indicatorSvc.getTrendDirection(price, primarySnap)
      : 'mixed';
    const macroTrend: TrendDirection = macroSnap
      ? this.indicatorSvc.getTrendDirection(price, macroSnap)
      : 'mixed';

    const macroAlignsPrimary = macroTrend === primaryTrend || macroTrend === 'mixed';

    // Determine if the given direction follows the primary trend
    let isFollowTrend = true;
    if (entryDirection !== null && primaryTrend !== 'mixed') {
      isFollowTrend =
        (entryDirection === 'BUY' && primaryTrend === 'bullish') ||
        (entryDirection === 'SELL' && primaryTrend === 'bearish');
    }

    // Confidence adjustments
    let confidenceAdjustment = 0;
    if (!macroAlignsPrimary) confidenceAdjustment -= 0.10;
    if (entryDirection !== null && !isFollowTrend) confidenceAdjustment -= 0.10;

    // Minimum RR: follow-trend = 1.5, counter-trend = 1.0
    const minRR = isFollowTrend ? 1.5 : 1.0;

    // Entry setup quality on the entry timeframe (pullback to EMA)
    const emptySnap = { ema_14: null, ema_60: null, ema_200: null, sma_20: null, rsi_14: null, macd_line: null, macd_signal: null, macd_hist: null, stoch_k: null, stoch_d: null, adx_14: null, bb_upper: null, bb_middle: null, bb_lower: null, atr_14: null, ema_14_prev: null, ema_60_prev: null };
    const entrySetup = entrySnap
      ? this.indicatorSvc.detectPullbackEntry(price, entrySnap, entryDirection)
      : this.indicatorSvc.detectPullbackEntry(price, emptySnap, null);

    // Build summary string for Claude prompt
    const confluenceSummary = [
      `Macro TF (${macro.toUpperCase()}) — Overall Direction Bias: ${macroTrend.toUpperCase()}`,
      `Primary TF (${primary.toUpperCase()}) — Trend: ${primaryTrend.toUpperCase()} — ${macroAlignsPrimary ? '✅ Aligned with macro' : '⚠️ Conflicts macro (confidence −0.10)'}`,
      entryDirection
        ? `Trade Direction: ${entryDirection} — ${isFollowTrend ? '✅ Follows primary trend' : '⚠️ Counter trend (confidence −0.10, RR req 1:1.0)'}`
        : `Trade Direction: TBD — must align with macro (${macro.toUpperCase()}) direction`,
      `${entry.toUpperCase()} Entry Pullback Setup: Near ${entrySetup.nearestEMA === 'none' ? 'N/A (not near EMA — not_setup)' : entrySetup.nearestEMA.toUpperCase()} | Quality: ${entrySetup.entryQuality.toUpperCase()} | MACD: ${entrySetup.macdMomentum} | RSI safe: ${entrySetup.rsiNotExtreme}`,
      `Min Required RR: 1:${minRR} (${isFollowTrend ? 'follow trend' : 'counter trend'})`,
    ].join('\n');

    return {
      primaryTrend,
      macroTrend,
      macroAlignsPrimary,
      isFollowTrend,
      confidenceAdjustment,
      minRR,
      confluenceSummary,
      entrySetup,
    };
  }

  /**
   * Validate and adjust TP to meet minimum Risk/Reward ratio.
   * If Claude's suggested TP yields RR < minRR, recalculate TP to achieve exactly minRR.
   */
  private validateAndAdjustRR(
    price: number,
    suggestedTp: number | null,
    suggestedSl: number | null,
    minRR: number
  ): { adjustedTp: number | null; rrAdjusted: boolean; actualRR: number | null } {
    if (suggestedTp === null || suggestedSl === null || price === 0) {
      return { adjustedTp: suggestedTp, rrAdjusted: false, actualRR: null };
    }

    const risk = Math.abs(price - suggestedSl);
    if (risk === 0) return { adjustedTp: suggestedTp, rrAdjusted: false, actualRR: null };

    const reward = Math.abs(suggestedTp - price);
    const actualRR = reward / risk;

    if (actualRR >= minRR) {
      return { adjustedTp: suggestedTp, rrAdjusted: false, actualRR };
    }

    // Recalculate TP to meet minRR
    const requiredReward = risk * minRR;
    const adjustedTp = suggestedTp > price
      ? price + requiredReward   // BUY direction
      : price - requiredReward;  // SELL direction

    return { adjustedTp: parseFloat(adjustedTp.toFixed(5)), rrAdjusted: true, actualRR };
  }

  /**
   * Enforce ATR-based SL bounds.
   * - SL closer than 1.0× ATR → push out to exactly 1.0× ATR (too tight, gets stopped trivially)
   * - SL further than 2.5× ATR → log a warning (allowed, Claude may have structural reason)
   */
  private enforceAtrSl(
    price: number,
    suggestedSl: number | null,
    direction: 'BUY' | 'SELL' | null,
    atr: number | null
  ): { finalSl: number | null; slAtrAdjusted: boolean } {
    if (suggestedSl === null || atr === null || atr === 0 || direction === null || direction === 'WAIT' as string) {
      return { finalSl: suggestedSl, slAtrAdjusted: false };
    }

    const slDist = Math.abs(price - suggestedSl);
    const minDist = 1.0 * atr;
    const warnDist = 2.5 * atr;

    if (slDist >= minDist) {
      if (slDist > warnDist) {
        console.warn(
          `[MarketAnalyzerAgent] SL distance ${slDist.toFixed(5)} exceeds 2.5× ATR (${warnDist.toFixed(5)}) — wide SL accepted`
        );
      }
      return { finalSl: suggestedSl, slAtrAdjusted: false };
    }

    // Too tight — push SL out to 1.0× ATR
    const finalSl = direction === 'BUY'
      ? parseFloat((price - minDist).toFixed(5))
      : parseFloat((price + minDist).toFixed(5));
    return { finalSl, slAtrAdjusted: true };
  }

  /**
   * Validate SL/TP placement against S/R key levels.
   *
   * SL fix: for BUY, if there is a support level between price and SL,
   * push SL to just beyond that support (support - buffer).
   * For SELL, if there is a resistance between price and SL, push SL beyond it.
   *
   * TP warning: if a strong/moderate S/R level lies between price and TP within 50%
   * of the TP distance, warn (the S/R could block the move).
   */
  private validateSRPlacement(
    price: number,
    suggestedTp: number | null,
    suggestedSl: number | null,
    direction: 'BUY' | 'SELL' | null,
    srContext: SRContext | undefined
  ): { finalSl: number | null; finalTp: number | null; srWarning: string | null } {
    if (!srContext || !direction || direction === 'WAIT' as string || suggestedSl === null) {
      return { finalSl: suggestedSl, finalTp: suggestedTp, srWarning: null };
    }

    const buffer = 0.0001; // ~1 pip buffer beyond S/R for SL placement
    let finalSl = suggestedSl;
    let finalTp = suggestedTp;
    let srWarning: string | null = null;

    if (direction === 'BUY') {
      // Find support levels between price and SL (i.e., slPrice < supportPrice < price)
      const supportsBetween = srContext.keyLevels.filter(
        l => l.type === 'support' && l.price > finalSl && l.price < price
      );
      if (supportsBetween.length > 0) {
        // Take the nearest support to price (highest support between sl and price)
        const nearestSupport = supportsBetween.reduce((a, b) => a.price > b.price ? a : b);
        const adjustedSl = parseFloat((nearestSupport.price - buffer).toFixed(5));
        if (adjustedSl < finalSl || (adjustedSl > finalSl && adjustedSl < price)) {
          finalSl = adjustedSl;
          console.log(
            `[MarketAnalyzerAgent] SL snapped below support ${nearestSupport.price} → ${finalSl}`
          );
        }
      }

      // Check if TP is blocked by a strong/moderate resistance between price and TP
      if (finalTp !== null && finalTp > price) {
        const blockingResistances = srContext.keyLevels.filter(
          l => l.type === 'resistance' &&
          l.price > price &&
          l.price < finalTp! &&
          (l.strength === 'strong' || l.strength === 'moderate') &&
          (l.price - price) / (finalTp! - price) < 0.6  // within 60% of TP distance
        );
        if (blockingResistances.length > 0) {
          const nearest = blockingResistances.reduce((a, b) => a.price < b.price ? a : b);
          srWarning = `TP ${finalTp} may be blocked by ${nearest.strength} resistance at ${nearest.price} (${nearest.source})`;
        }
      }
    } else {
      // SELL: find resistance levels between SL and price (price < resistancePrice < slPrice)
      const resistancesBetween = srContext.keyLevels.filter(
        l => l.type === 'resistance' && l.price < finalSl && l.price > price
      );
      if (resistancesBetween.length > 0) {
        const nearestResistance = resistancesBetween.reduce((a, b) => a.price < b.price ? a : b);
        const adjustedSl = parseFloat((nearestResistance.price + buffer).toFixed(5));
        if (adjustedSl > finalSl || (adjustedSl < finalSl && adjustedSl > price)) {
          finalSl = adjustedSl;
          console.log(
            `[MarketAnalyzerAgent] SL snapped above resistance ${nearestResistance.price} → ${finalSl}`
          );
        }
      }

      // Check if TP is blocked by a strong/moderate support between price and TP
      if (finalTp !== null && finalTp < price) {
        const blockingSupports = srContext.keyLevels.filter(
          l => l.type === 'support' &&
          l.price < price &&
          l.price > finalTp! &&
          (l.strength === 'strong' || l.strength === 'moderate') &&
          (price - l.price) / (price - finalTp!) < 0.6
        );
        if (blockingSupports.length > 0) {
          const nearest = blockingSupports.reduce((a, b) => a.price > b.price ? a : b);
          srWarning = `TP ${finalTp} may be blocked by ${nearest.strength} support at ${nearest.price} (${nearest.source})`;
        }
      }
    }

    return { finalSl, finalTp, srWarning };
  }
}
