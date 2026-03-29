import {
  EMA,
  SMA,
  RSI,
  MACD,
  Stochastic,
  ADX,
  BollingerBands,
  ATR,
} from 'technicalindicators';
import {
  OHLCCandle,
  IndicatorSnapshot,
  MultiTimeframeIndicators,
  Timeframe,
  TrendDirection,
  EntrySetupQuality,
  MacdMomentum,
  EntryQuality,
} from '../types/market';

export class IndicatorService {
  /**
   * Compute all indicators for a given set of candles (single timeframe).
   * Candles must be sorted oldest → newest.
   */
  computeIndicators(candles: OHLCCandle[]): IndicatorSnapshot {
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    // --- Moving Averages ---
    const ema14 = EMA.calculate({ period: 14, values: closes });
    const ema60 = EMA.calculate({ period: 60, values: closes });
    const ema200 = EMA.calculate({ period: 200, values: closes });
    const sma20 = SMA.calculate({ period: 20, values: closes });

    // --- RSI ---
    const rsi = RSI.calculate({ period: 14, values: closes });

    // --- MACD ---
    const macdResult = MACD.calculate({
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      values: closes,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    // --- Stochastic ---
    const stoch = Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
      signalPeriod: 3,
    });

    // --- ADX ---
    const adx = ADX.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
    });

    // --- Bollinger Bands ---
    const bb = BollingerBands.calculate({
      period: 20,
      stdDev: 2,
      values: closes,
    });

    // --- ATR ---
    const atr = ATR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
    });

    const last = <T>(arr: T[]): T | null => (arr.length > 0 ? arr[arr.length - 1] : null);

    const macdLast = last(macdResult);
    const stochLast = last(stoch);
    const bbLast = last(bb);
    const adxLast = last(adx);

    return {
      ema_14: last(ema14) ?? null,
      ema_60: last(ema60) ?? null,
      ema_200: last(ema200) ?? null,
      sma_20: last(sma20) ?? null,
      rsi_14: last(rsi) ?? null,
      macd_line: macdLast?.MACD ?? null,
      macd_signal: macdLast?.signal ?? null,
      macd_hist: macdLast?.histogram ?? null,
      stoch_k: stochLast?.k ?? null,
      stoch_d: stochLast?.d ?? null,
      adx_14: adxLast?.adx ?? null,
      bb_upper: bbLast?.upper ?? null,
      bb_middle: bbLast?.middle ?? null,
      bb_lower: bbLast?.lower ?? null,
      atr_14: last(atr) ?? null,
    };
  }

  /**
   * Compute indicators for multiple timeframes at once.
   */
  computeMultiTimeframe(
    candlesByTf: Partial<Record<Timeframe, OHLCCandle[]>>
  ): MultiTimeframeIndicators {
    const result: MultiTimeframeIndicators = {};
    for (const [tf, candles] of Object.entries(candlesByTf) as [Timeframe, OHLCCandle[]][]) {
      if (candles && candles.length > 0) {
        result[tf] = this.computeIndicators(candles);
      }
    }
    return result;
  }

  /**
   * Returns a human-readable position label for price vs Bollinger Bands.
   */
  getBBPosition(price: number, snapshot: IndicatorSnapshot): string {
    if (!snapshot.bb_upper || !snapshot.bb_lower || !snapshot.bb_middle) return 'unknown';
    if (price >= snapshot.bb_upper) return 'above_upper';
    if (price <= snapshot.bb_lower) return 'below_lower';
    if (price > snapshot.bb_middle) return 'above_middle';
    return 'below_middle';
  }

  /**
   * Determine trend direction from EMA stack alignment.
   * Bullish  : EMA14 > EMA60 > EMA200
   * Bearish  : EMA14 < EMA60 < EMA200
   * Mixed    : EMAs are not clearly stacked (sideways / transition)
   */
  getTrendDirection(price: number, snap: IndicatorSnapshot): TrendDirection {
    const { ema_14, ema_60, ema_200 } = snap;
    if (ema_14 === null || ema_60 === null || ema_200 === null) return 'mixed';

    if (ema_14 > ema_60 && ema_60 > ema_200) return 'bullish';
    if (ema_14 < ema_60 && ema_60 < ema_200) return 'bearish';
    return 'mixed';
  }

  /**
   * Evaluate 15m entry-timing quality based on pullback-to-EMA strategy.
   * A valid setup requires price returning to EMA14 or EMA60 before resuming trend.
   *
   * @param price   Current close price (15m)
   * @param snap    15m IndicatorSnapshot
   * @param direction  Expected trade direction to validate MACD momentum
   */
  detectPullbackEntry(
    price: number,
    snap: IndicatorSnapshot,
    direction: 'BUY' | 'SELL' | null = null
  ): EntrySetupQuality {
    const { ema_14, ema_60, atr_14, macd_hist, rsi_14 } = snap;

    const atr = atr_14 ?? 0;

    // Distance from price to each EMA
    const distEma14 = ema_14 !== null ? Math.abs(price - ema_14) : null;
    const distEma60 = ema_60 !== null ? Math.abs(price - ema_60) : null;

    const isPullbackToEMA14 =
      distEma14 !== null && atr > 0 ? distEma14 <= atr * 0.5 : false;
    const isPullbackToEMA60 =
      distEma60 !== null && atr > 0 ? distEma60 <= atr * 1.0 : false;

    // Nearest EMA
    let nearestEMA: EntrySetupQuality['nearestEMA'] = 'none';
    let atrDistance: number | null = null;
    if (distEma14 !== null && distEma60 !== null) {
      if (distEma14 <= distEma60) {
        nearestEMA = 'ema14';
        atrDistance = atr > 0 ? parseFloat((distEma14 / atr).toFixed(2)) : null;
      } else {
        nearestEMA = 'ema60';
        atrDistance = atr > 0 ? parseFloat((distEma60 / atr).toFixed(2)) : null;
      }
    }

    // MACD momentum check
    let macdMomentum: MacdMomentum = 'neutral';
    if (macd_hist !== null && direction !== null) {
      if (direction === 'BUY' && macd_hist > 0) macdMomentum = 'confirming';
      else if (direction === 'SELL' && macd_hist < 0) macdMomentum = 'confirming';
      else if (macd_hist !== 0) macdMomentum = 'diverging';
    }

    // RSI extreme check (overbought/oversold at entry is risky)
    const rsiNotExtreme = rsi_14 !== null ? rsi_14 >= 30 && rsi_14 <= 70 : true;

    // Compute overall entry quality
    let score = 0;
    if (isPullbackToEMA14) score += 3;
    else if (isPullbackToEMA60) score += 2;
    if (macdMomentum === 'confirming') score += 2;
    if (rsiNotExtreme) score += 1;

    let entryQuality: EntryQuality;
    if (!isPullbackToEMA14 && !isPullbackToEMA60) {
      entryQuality = 'not_setup';
    } else if (score >= 5) {
      entryQuality = 'strong';
    } else if (score >= 3) {
      entryQuality = 'moderate';
    } else {
      entryQuality = 'weak';
    }

    return {
      isPullbackToEMA14,
      isPullbackToEMA60,
      nearestEMA,
      atrDistance,
      macdMomentum,
      rsiNotExtreme,
      entryQuality,
    };
  }
}
