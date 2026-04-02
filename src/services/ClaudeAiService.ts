import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { MultiTimeframeIndicators, TrendConfluenceResult, Timeframe } from '../types/market';
import { CreateTradeLogInput, TradeLog, CloseTradeInput, TradeResultRecord, SimilarTrade } from '../types/trade';
import { CandleContext } from './CandleService';

/** Identify the current Forex trading session based on UTC clock */
function getTradingSession(): string {
  const h = new Date().getUTCHours();
  if (h >= 13 && h < 16) return 'London/New York Overlap (13:00–16:00 UTC) — peak volatility';
  if (h >= 8  && h < 16) return 'London Session (08:00–16:00 UTC) — high liquidity';
  if (h >= 16 && h < 21) return 'New York Session (16:00–21:00 UTC) — high volatility';
  return 'Asian/Off-peak Session (21:00–08:00 UTC) — low volatility';
}

export class ClaudeAiService {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor() {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    this.model = env.CLAUDE_MODEL;
  }

  /**
   * Analyze market conditions at trade entry time (Agent #1 Step 3).
   */
  async analyzeMarketAtEntry(
    tradeInput: CreateTradeLogInput,
    indicators: MultiTimeframeIndicators
  ): Promise<string> {
    const indicatorSummary = this.formatIndicatorsForPrompt(indicators);

    const prompt = `You are a professional Forex trading analyst. Analyze the market conditions at the time of this trade entry and provide a concise assessment. ตอบเป็นภาษาไทยทั้งหมด

**Trade Details:**
- Symbol: ${tradeInput.symbol}
- Direction: ${tradeInput.direction}
- Timeframe: ${tradeInput.timeframe}
- Entry Price: ${tradeInput.entryPrice}
- TP: ${tradeInput.tpPrice} | SL: ${tradeInput.slPrice}
- Risk/Reward: ${this.calcRR(tradeInput)}

**Trader's Reason:**
${tradeInput.userReason}

**Technical Indicators (Multi-timeframe):**
${indicatorSummary}

Provide a structured analysis (3-5 sentences) covering:
1. Trend alignment across timeframes (EMA 14/60/200)
2. Momentum confirmation (RSI, MACD, Stochastic)
3. Volatility context (Bollinger Bands, ATR, ADX)
4. Your assessment of signal quality (Strong/Moderate/Weak)

Be concise and technical.`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    return this.extractText(response);
  }

  /**
   * Summarize lessons learned from a closed trade (Agent #1 Step 5).
   */
  async summarizeLesson(
    trade: TradeLog,
    result: CloseTradeInput,
    exitIndicators: MultiTimeframeIndicators
  ): Promise<{ lesson: string; patternTags: string[] }> {
    const prompt = `You are a Forex trading coach. Analyze this completed trade and provide actionable lessons. ตอบเป็นภาษาไทยทั้งหมด (ยกเว้น pattern_tags ให้เป็นภาษาอังกฤษ)

**Trade Summary:**
- Symbol: ${trade.symbol} | Direction: ${trade.direction} | Timeframe: ${trade.timeframe}
- Entry: ${trade.entryPrice} | Exit: ${result.exitPrice}
- Result: **${result.result}** | Pips: ${result.pips > 0 ? '+' : ''}${result.pips} | P&L: $${result.profitUsd}
- Entry Reason: ${trade.userReason}
- Exit Reason: ${result.userExitReason}
${result.userLesson ? `- Trader's Reflection: ${result.userLesson}` : ''}

**Entry Indicators:** ${JSON.stringify(trade.indicatorsSnapshot ?? {}, null, 2)}

Respond in JSON format:
{
  "lesson": "2-3 sentence actionable lesson from this trade",
  "pattern_tags": ["tag1", "tag2"]
}

Pattern tags should be short descriptors like: trend_following, counter_trend, breakout, reversal, news_trade, overtraded, good_rr, poor_rr, early_exit, late_entry`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = this.extractText(response);
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { lesson: string; pattern_tags: string[] };
        return { lesson: parsed.lesson, patternTags: parsed.pattern_tags ?? [] };
      }
    } catch {
      // fallback: return raw text
    }
    return { lesson: text, patternTags: [] };
  }

  /**
   * Generate market analysis recommendation for Agent #2.
   */
  async generateAnalysisRecommendation(
    symbol: string,
    timeframe: string,
    currentPrice: number,
    indicators: MultiTimeframeIndicators,
    similarTrades: SimilarTrade[],
    riskLevel: string,
    trendContext: TrendConfluenceResult,
    candleContext?: CandleContext
  ): Promise<{
    recommendation: string;
    confidence: number;
    suggestedTp: number | null;
    suggestedSl: number | null;
    riskScore: number;
    analysis: string;
  }> {
    const indicatorSummary = this.formatIndicatorsForPrompt(indicators);
    const winTrades = similarTrades.filter((t) => t.result === 'WIN');
    const winRate =
      similarTrades.length > 0
        ? ((winTrades.length / similarTrades.length) * 100).toFixed(0)
        : 'N/A';

    const similarTradesSummary =
      similarTrades.length > 0
        ? similarTrades
            .slice(0, 5)
            .map(
              (t, i) =>
                `${i + 1}. ${t.direction} | Similarity: ${(t.similarityScore * 100).toFixed(0)}% | Result: ${t.result} | Pips: ${t.pips > 0 ? '+' : ''}${t.pips} | Lesson: ${t.aiLesson ?? t.userExitReason ?? 'N/A'}`
            )
            .join('\n')
        : 'No similar historical trades found yet.';

    // Build DB candle context section for prompt enrichment
    const candleContextSection = candleContext?.available
      ? `
**Historical Market Context (from DB — last ${candleContext.lookbackCandles} candles on ${candleContext.timeframe}):**
- Period: ${candleContext.periodStart} → ${candleContext.periodEnd}
- Period High: ${candleContext.periodHigh} | Period Low: ${candleContext.periodLow} | Range: ${candleContext.priceRange}
- Current Price Position in Range: ${candleContext.rangePositionPct}% (0%=at low, 100%=at high)
- Recent Swing High: ${candleContext.recentSwingHigh} | Recent Swing Low: ${candleContext.recentSwingLow}
- Candle Bias: ${candleContext.bullishCandles} bullish vs ${candleContext.bearishCandles} bearish
- Recent Momentum (last 5 vs prior 5 candles avg): ${candleContext.recentMomentumPct && candleContext.recentMomentumPct > 0 ? '+' : ''}${candleContext.recentMomentumPct}%`
      : '';

    // ATR-based SL guidance for the entry timeframe
    const entryTfAtr = (indicators as Record<string, { atr_14: number | null } | undefined>)[timeframe]?.atr_14;
    const atrSlRange = entryTfAtr
      ? `${(entryTfAtr * 1.0).toFixed(5)}–${(entryTfAtr * 1.5).toFixed(5)}`
      : 'N/A';
    // Bangkok datetime + trading session
    const bangkokNow = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok', hour12: false }).replace(' ', 'T') + '+07:00';
    const session = getTradingSession();

    const prompt = `You are an expert Forex AI advisor. Provide a trading recommendation based on current market conditions, historical DB data, and past trade performance. ตอบเป็นภาษาไทยทั้งหมดในส่วน analysis (ค่า recommendation/confidence/suggested_tp/suggested_sl/risk_score ให้คงรูปแบบเดิม)

**Symbol:** ${symbol} | **Timeframe:** ${timeframe} | **Current Price:** ${currentPrice}
**Risk Level:** ${riskLevel} | **Date/Time (Bangkok):** ${bangkokNow} | **Session:** ${session}

**━━ STRATEGY CONTEXT (Rule-Based Pre-Analysis) ━━**
${trendContext.confluenceSummary}

**Strategy Rules (MUST FOLLOW):**
1. TF Hierarchy: ${timeframe === '5m' ? '1H=macro direction | 15M=primary trend | 5M=PULLBACK entry' : timeframe === '15m' ? '4H=macro direction | 1H=primary trend | 15M=PULLBACK entry' : '4H=macro direction | 4H=primary trend | ' + timeframe.toUpperCase() + '=PULLBACK entry'}
2. **PULLBACK IS #1 PRIORITY**: Only enter when price has pulled back to EMA14 or EMA60 on the ${timeframe} chart. Do NOT chase breakouts. If entrySetup quality is 'not_setup' → recommend WAIT.
3. MACRO TF direction controls the BUY/SELL bias. Counter-trend (opposing macro) requires very strong reversal evidence; reduce confidence ≥0.10.
4. If macro and primary TF trends conflict → warn explicitly in analysis and reduce confidence.
5. suggested_tp MUST achieve ≥${trendContext.minRR}:1 RR from suggested_sl. This is a ${trendContext.isFollowTrend ? 'follow-trend (min RR 1:1.5)' : 'counter-trend (min RR 1:1.0)'} setup.
6. SL guidance: set SL at 1.0–1.5× ATR(14) from entry. ${timeframe.toUpperCase()} ATR-based SL range: ±${atrSlRange}.
7. Only recommend BUY/SELL when conviction is high (>0.65) after all checks above.

**Current Technical Indicators (Multi-timeframe):**
${indicatorSummary}
${candleContextSection}
**Similar Historical Trades (Vector Similarity Search):**
${similarTradesSummary}
Historical Win Rate from similar setups: ${winRate}%

Based on ALL the above data (strategy context + indicators + DB candle context + historical trades), provide a JSON response:
{
  "recommendation": "BUY" | "SELL" | "WAIT",
  "confidence": 0.0-1.0,
  "suggested_tp": number or null,
  "suggested_sl": number or null,
  "risk_score": 1-10,
  "analysis": "3-5 sentence analysis in Thai: cover macro/primary trend alignment, pullback entry quality on ${timeframe}, key indicator signals from the TF hierarchy, and why this recommendation was made"
}

Be conservative with confidence scores. Only recommend BUY/SELL if conviction is high (>0.65).`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = this.extractText(response);
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          recommendation: string;
          confidence: number;
          suggested_tp: number | null;
          suggested_sl: number | null;
          risk_score: number;
          analysis: string;
        };
        return {
          recommendation: parsed.recommendation,
          confidence: parsed.confidence,
          suggestedTp: parsed.suggested_tp,
          suggestedSl: parsed.suggested_sl,
          riskScore: parsed.risk_score,
          analysis: parsed.analysis,
        };
      }
    } catch {
      // fallback
    }
    return {
      recommendation: 'WAIT',
      confidence: 0,
      suggestedTp: null,
      suggestedSl: null,
      riskScore: 5,
      analysis: text,
    };
  }

  private formatIndicatorsForPrompt(indicators: MultiTimeframeIndicators): string {
    const lines: string[] = [];
    for (const [tf, snap] of Object.entries(indicators)) {
      if (!snap) continue;
      const { ema_14, ema_60, ema_200, rsi_14, macd_hist, adx_14, bb_lower, bb_upper, atr_14 } = snap;

      // EMA trend structure
      let trendLabel = 'MIXED';
      if (ema_14 !== null && ema_60 !== null && ema_200 !== null) {
        if (ema_14 > ema_60 && ema_60 > ema_200) trendLabel = 'BULLISH (14>60>200)';
        else if (ema_14 < ema_60 && ema_60 < ema_200) trendLabel = 'BEARISH (14<60<200)';
      }

      // RSI zone
      let rsiStr = rsi_14 !== null ? `RSI:${rsi_14.toFixed(1)}` : 'RSI:N/A';
      if (rsi_14 !== null) {
        if (rsi_14 < 30)              rsiStr += '(OVERSOLD⚠️)';
        else if (rsi_14 > 70)         rsiStr += '(OVERBOUGHT⚠️)';
        else if (rsi_14 >= 40 && rsi_14 <= 60) rsiStr += '(neutral)';
        else                          rsiStr += '(caution)';
      }

      // MACD momentum direction
      let macdStr = macd_hist !== null ? `MACD_H:${macd_hist > 0 ? '+' : ''}${macd_hist.toFixed(5)}` : 'MACD_H:N/A';
      if (macd_hist !== null) {
        if (macd_hist > 0.000005)      macdStr += '↑';
        else if (macd_hist < -0.000005) macdStr += '↓';
        else                           macdStr += '→';
      }

      // ADX trend strength
      let adxStr = adx_14 !== null ? `ADX:${adx_14.toFixed(1)}` : 'ADX:N/A';
      if (adx_14 !== null) {
        if (adx_14 >= 25)      adxStr += '(trending)';
        else if (adx_14 >= 20) adxStr += '(weak trend)';
        else                   adxStr += '(ranging⚠️)';
      }

      lines.push(
        `[${tf}] Trend:${trendLabel} | ${rsiStr} | ${macdStr} | ${adxStr} | ATR:${atr_14?.toFixed(5) ?? 'N/A'}` +
        `\n       EMA14:${ema_14?.toFixed(5) ?? 'N/A'} EMA60:${ema_60?.toFixed(5) ?? 'N/A'} EMA200:${ema_200?.toFixed(5) ?? 'N/A'} BB:[${bb_lower?.toFixed(5) ?? 'N/A'}–${bb_upper?.toFixed(5) ?? 'N/A'}]`
      );
    }
    return lines.join('\n');
  }

  private calcRR(trade: CreateTradeLogInput): string {
    const risk = Math.abs(trade.entryPrice - trade.slPrice);
    const reward = Math.abs(trade.tpPrice - trade.entryPrice);
    if (risk === 0) return 'N/A';
    return `1:${(reward / risk).toFixed(2)}`;
  }

  private extractText(response: Anthropic.Message): string {
    const block = response.content[0];
    return block.type === 'text' ? block.text : '';
  }
}
