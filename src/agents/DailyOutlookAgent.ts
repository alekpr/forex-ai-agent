import { env } from '../config/env';
import { CandleService } from '../services/CandleService';
import { IndicatorService } from '../services/IndicatorService';
import { ClaudeAiService } from '../services/ClaudeAiService';
import { NotificationService } from '../services/NotificationService';
import { DailyOutlookRepository, CreateDailyOutlookInput } from '../repositories/DailyOutlookRepository';
import { formatDailyOutlook } from '../telegram/formatters';
import {
  Timeframe,
  OHLCCandle,
  MultiTimeframeIndicators,
  TrendDirection,
  PullbackZone,
  DailyOutlookData,
} from '../types/market';

const OUTLOOK_TIMEFRAMES: Timeframe[] = ['1h', '4h', '1d'];

/**
 * Max age of D1 candle before it is considered stale.
 * 96h covers Friday close → Monday 7AM Bangkok (≈63h gap).
 */
const D1_STALE_THRESHOLD_MS = 96 * 60 * 60 * 1000;

export class DailyOutlookAgent {
  private readonly candleSvc: CandleService;
  private readonly indicatorSvc: IndicatorService;
  private readonly claudeSvc: ClaudeAiService;
  private readonly notificationSvc: NotificationService;
  private readonly outlookRepo: DailyOutlookRepository;

  constructor() {
    this.candleSvc = new CandleService();
    this.indicatorSvc = new IndicatorService();
    this.claudeSvc = new ClaudeAiService();
    this.notificationSvc = new NotificationService();
    this.outlookRepo = new DailyOutlookRepository();
  }

  /**
   * Generate (or replay cached) daily outlook for each symbol and broadcast to Telegram.
   * Safe to call multiple times per day — returns cached result on repeat calls.
   */
  async generateOutlook(
    userId: string,
    symbols: string[],
    riskLevel = 'medium'
  ): Promise<DailyOutlookData[]> {
    const results: DailyOutlookData[] = [];

    for (const symbol of symbols) {
      try {
        const result = await this.processSymbol(userId, symbol, riskLevel);
        results.push(result);
      } catch (err) {
        console.error(`[DailyOutlookAgent] Failed for ${symbol}:`, err);
      }
    }

    return results;
  }

  // ─── Per-symbol pipeline ──────────────────────────────────────────────────

  private async processSymbol(
    userId: string,
    symbol: string,
    riskLevel: string
  ): Promise<DailyOutlookData> {
    // Check daily cache — avoids duplicate Claude calls if server restarts
    const cached = await this.outlookRepo.findToday(userId, symbol);
    if (cached?.is_sent && cached.telegram_message_text) {
      console.log(`[DailyOutlookAgent] ${symbol}: using cached outlook from today`);
      await this.notificationSvc.broadcastDailyOutlook(cached.telegram_message_text);
      return this.rowToData(cached);
    }

    // Fetch candles for 1h, 4h, 1d
    const { candlesByTf } = await this.candleSvc.getMultiTimeframeCandles(
      symbol,
      OUTLOOK_TIMEFRAMES,
      250,
      undefined,
      false  // don't force-refresh; use DB if fresh enough
    );

    // Validate D1 freshness
    const d1Candles = candlesByTf['1d'] ?? [];
    if (d1Candles.length > 0) {
      const newestD1Age = Date.now() - new Date(d1Candles[d1Candles.length - 1].time).getTime();
      if (newestD1Age > D1_STALE_THRESHOLD_MS) {
        console.warn(`[DailyOutlookAgent] ${symbol}: D1 candle is ${Math.floor(newestD1Age / 3600000)}h old — skipping`);
        throw new Error(`D1 candle stale for ${symbol}`);
      }
      if (newestD1Age > 26 * 3600000) {
        console.log(`[DailyOutlookAgent] ${symbol}: D1 within weekend gap (${Math.floor(newestD1Age / 3600000)}h old) — using`);
      }
    }

    const indicators: MultiTimeframeIndicators = this.indicatorSvc.computeMultiTimeframe(candlesByTf);

    // Determine current price from 4H > 1H > 1D candle close
    const currentPrice =
      this.lastClose(candlesByTf['4h']) ??
      this.lastClose(candlesByTf['1h']) ??
      this.lastClose(candlesByTf['1d']) ??
      0;

    if (currentPrice === 0) throw new Error(`No candle price available for ${symbol}`);

    // Trend directions
    const macroTrend: TrendDirection = indicators['1d']
      ? this.indicatorSvc.getTrendDirection(currentPrice, indicators['1d'])
      : 'mixed';
    const primaryTrend: TrendDirection = indicators['4h']
      ? this.indicatorSvc.getTrendDirection(currentPrice, indicators['4h'])
      : 'mixed';

    // Pullback zones from 4H EMA ± ATR
    const snap4h = indicators['4h'];
    const atr4h = snap4h?.atr_14 ?? null;
    const { primaryZone, secondaryZone } = this.computePullbackZones(currentPrice, snap4h ?? null, atr4h);

    // S/R from D1 candles (macro pivots and swings)
    const srContext = d1Candles.length >= 10
      ? this.indicatorSvc.computeSupportResistance(d1Candles, currentPrice, symbol)
      : { pivotPoint: null, pivotResistances: [null, null, null] as [null, null, null], pivotSupports: [null, null, null] as [null, null, null], swingHighs: [], swingLows: [], roundLevels: [], keyLevels: [] };

    const adxValue = snap4h?.adx_14 ?? null;

    // Claude synthesis
    const claudeResult = await this.claudeSvc.generateDailyOutlook(
      symbol,
      currentPrice,
      indicators,
      srContext,
      { primaryZone, secondaryZone },
      riskLevel
    );

    // Nearest key resistance/support for DB storage
    const nearestR = srContext.keyLevels.find(l => l.type === 'resistance' && l.price > currentPrice);
    const nearestS = srContext.keyLevels.find(l => l.type === 'support' && l.price < currentPrice);

    const outlookData: DailyOutlookData = {
      symbol,
      currentPrice,
      macroTrend,
      primaryTrend,
      primaryZone,
      secondaryZone,
      srContext,
      adxValue,
      indicators,
      bias: claudeResult.bias,
      aiAnalysis: claudeResult.analysis,
      tradingPlan: claudeResult.tradingPlan,
    };

    // Format the Telegram message before saving (so we can cache it)
    const telegramText = formatDailyOutlook([outlookData]);

    // Persist
    const dbInput: CreateDailyOutlookInput = {
      symbol,
      analysisDate: new Date(),
      macroTrend,
      primaryTrend,
      currentPrice,
      primaryZoneLow: primaryZone?.priceLow ?? null,
      primaryZoneHigh: primaryZone?.priceHigh ?? null,
      secondaryZoneLow: secondaryZone?.priceLow ?? null,
      secondaryZoneHigh: secondaryZone?.priceHigh ?? null,
      keyResistance: nearestR?.price ?? null,
      keySupport: nearestS?.price ?? null,
      adxValue,
      bias: claudeResult.bias,
      aiAnalysis: claudeResult.analysis,
      tradingPlan: claudeResult.tradingPlan,
    };

    const id = await this.outlookRepo.create(userId, dbInput);
    await this.outlookRepo.markSent(id, telegramText);

    // Broadcast
    await this.notificationSvc.broadcastDailyOutlook(telegramText);

    return { ...outlookData, telegramMessageText: telegramText };
  }

  // ─── Pullback zone computation ────────────────────────────────────────────

  /**
   * Compute EMA-based pullback zones on the 4H chart.
   * Primary zone  = EMA14 ± 0.5×ATR  (shallower, more frequent pullbacks)
   * Secondary zone = EMA60 ± 1.0×ATR  (deeper, stronger conviction entry)
   */
  private computePullbackZones(
    _price: number,
    snap4h: import('../types/market').IndicatorSnapshot | null,
    atr: number | null
  ): { primaryZone: PullbackZone | null; secondaryZone: PullbackZone | null } {
    if (!snap4h || atr === null || atr === 0) {
      return { primaryZone: null, secondaryZone: null };
    }

    const { ema_14, ema_60 } = snap4h;

    const primaryZone: PullbackZone | null = ema_14 !== null
      ? {
          level: 'primary',
          ema: 'ema14',
          priceLow:  parseFloat((ema_14 - atr * 0.5).toFixed(5)),
          priceHigh: parseFloat((ema_14 + atr * 0.5).toFixed(5)),
        }
      : null;

    const secondaryZone: PullbackZone | null = ema_60 !== null
      ? {
          level: 'secondary',
          ema: 'ema60',
          priceLow:  parseFloat((ema_60 - atr * 1.0).toFixed(5)),
          priceHigh: parseFloat((ema_60 + atr * 1.0).toFixed(5)),
        }
      : null;

    return { primaryZone, secondaryZone };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private lastClose(candles?: OHLCCandle[]): number | null {
    if (!candles || candles.length === 0) return null;
    return candles[candles.length - 1].close;
  }

  /** Convert a DB row back to DailyOutlookData shape (minimal — for cache replay). */
  private rowToData(row: import('../repositories/DailyOutlookRepository').DailyOutlookRow): DailyOutlookData {
    return {
      symbol: row.symbol,
      currentPrice: parseFloat(row.current_price ?? '0'),
      macroTrend: (row.macro_trend ?? 'mixed') as TrendDirection,
      primaryTrend: (row.primary_trend ?? 'mixed') as TrendDirection,
      primaryZone: row.primary_zone_low && row.primary_zone_high
        ? { level: 'primary', ema: 'ema14', priceLow: parseFloat(row.primary_zone_low), priceHigh: parseFloat(row.primary_zone_high) }
        : null,
      secondaryZone: row.secondary_zone_low && row.secondary_zone_high
        ? { level: 'secondary', ema: 'ema60', priceLow: parseFloat(row.secondary_zone_low), priceHigh: parseFloat(row.secondary_zone_high) }
        : null,
      srContext: { pivotPoint: null, pivotResistances: [null, null, null], pivotSupports: [null, null, null], swingHighs: [], swingLows: [], roundLevels: [], keyLevels: [] },
      adxValue: row.adx_value ? parseFloat(row.adx_value) : null,
      indicators: {},
      bias: (row.bias ?? 'NEUTRAL') as 'BUY' | 'SELL' | 'NEUTRAL',
      aiAnalysis: row.ai_analysis ?? undefined,
      tradingPlan: row.trading_plan ?? undefined,
      telegramMessageText: row.telegram_message_text ?? undefined,
    };
  }
}
