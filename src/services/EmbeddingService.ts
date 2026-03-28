import OpenAI from 'openai';
import { env } from '../config/env';
import { TradeLog, CreateTradeLogInput } from '../types/trade';
import { MultiTimeframeIndicators, IndicatorSnapshot } from '../types/market';
import { IndicatorService } from './IndicatorService';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

export class EmbeddingService {
  private readonly client: OpenAI;
  private readonly indicatorService: IndicatorService;

  constructor() {
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    this.indicatorService = new IndicatorService();
  }

  /**
   * Build a descriptive text context for a trade entry.
   * This text is converted to a vector embedding for similarity search.
   */
  buildTradeContextText(
    trade: CreateTradeLogInput,
    indicators: MultiTimeframeIndicators
  ): string {
    const tf15m = indicators['15m'];
    const tf1h = indicators['1h'];
    const tf4h = indicators['4h'];

    const currentPrice = trade.entryPrice;

    const ema14Pos = tf4h?.ema_14
      ? `EMA14:${currentPrice > tf4h.ema_14 ? 'above' : 'below'}`
      : '';
    const ema60Pos = tf4h?.ema_60
      ? `EMA60:${currentPrice > tf4h.ema_60 ? 'above' : 'below'}`
      : '';
    const ema200Pos = tf4h?.ema_200
      ? `EMA200:${currentPrice > tf4h.ema_200 ? 'above' : 'below'}`
      : '';

    const rsi = tf15m?.rsi_14 ?? tf1h?.rsi_14;
    const macdHist = tf15m?.macd_hist ?? tf1h?.macd_hist;
    const adx = tf1h?.adx_14;
    const bbPos = tf15m
      ? this.indicatorService.getBBPosition(currentPrice, tf15m)
      : '';

    return [
      `${trade.symbol} ${trade.direction} ${trade.timeframe}`,
      `Entry:${trade.entryPrice} TP:${trade.tpPrice} SL:${trade.slPrice}`,
      rsi !== undefined && rsi !== null ? `RSI14:${rsi.toFixed(1)}` : '',
      macdHist !== undefined && macdHist !== null
        ? `MACD:${macdHist > 0 ? 'bullish' : 'bearish'}`
        : '',
      ema14Pos, ema60Pos, ema200Pos,
      adx !== undefined && adx !== null ? `ADX:${adx.toFixed(1)}` : '',
      bbPos ? `BB:${bbPos}` : '',
      `Reason:${trade.userReason}`,
      `Indicators:${trade.indicatorsUsed.join(',')}`,
    ]
      .filter(Boolean)
      .join(' | ');
  }

  /**
   * Create a vector embedding for a trade context.
   * Returns a number[] of dimension 1536.
   */
  async createTradeEmbedding(
    trade: CreateTradeLogInput,
    indicators: MultiTimeframeIndicators
  ): Promise<number[]> {
    const text = this.buildTradeContextText(trade, indicators);
    return this.embed(text);
  }

  /**
   * Create a vector embedding for a market analysis context (Agent #2).
   */
  async createMarketEmbedding(
    symbol: string,
    direction: string,
    timeframe: string,
    currentPrice: number,
    indicators: MultiTimeframeIndicators,
    userContext = ''
  ): Promise<number[]> {
    const snap15m = indicators['15m'];
    const snap1h = indicators['1h'];
    const snap4h = indicators['4h'];

    const parts: string[] = [
      `${symbol} ${direction} ${timeframe}`,
      `Price:${currentPrice}`,
    ];

    if (snap4h) {
      if (snap4h.ema_14) parts.push(`EMA14:${currentPrice > snap4h.ema_14 ? 'above' : 'below'}`);
      if (snap4h.ema_60) parts.push(`EMA60:${currentPrice > snap4h.ema_60 ? 'above' : 'below'}`);
      if (snap4h.ema_200) parts.push(`EMA200:${currentPrice > snap4h.ema_200 ? 'above' : 'below'}`);
    }
    const rsi = snap15m?.rsi_14 ?? snap1h?.rsi_14;
    if (rsi !== undefined && rsi !== null) parts.push(`RSI14:${rsi.toFixed(1)}`);
    const macdHist = snap15m?.macd_hist ?? snap1h?.macd_hist;
    if (macdHist !== undefined && macdHist !== null)
      parts.push(`MACD:${macdHist > 0 ? 'bullish' : 'bearish'}`);
    if (snap1h?.adx_14 !== undefined && snap1h?.adx_14 !== null)
      parts.push(`ADX:${snap1h.adx_14.toFixed(1)}`);
    if (userContext) parts.push(`Context:${userContext}`);

    return this.embed(parts.join(' | '));
  }

  private async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    });
    return response.data[0].embedding;
  }
}
