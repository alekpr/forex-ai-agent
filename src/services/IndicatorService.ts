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
import { OHLCCandle, IndicatorSnapshot, MultiTimeframeIndicators, Timeframe } from '../types/market';

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
}
