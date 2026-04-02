export type Timeframe = '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export interface OHLCCandle {
  time: Date;
  symbol: string;
  timeframe: Timeframe;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorSnapshot {
  // Moving Averages
  ema_14: number | null;
  ema_60: number | null;
  ema_200: number | null;
  sma_20: number | null;
  // Oscillators
  rsi_14: number | null;
  macd_line: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  stoch_k: number | null;
  stoch_d: number | null;
  adx_14: number | null;
  // Volatility
  bb_upper: number | null;
  bb_middle: number | null;
  bb_lower: number | null;
  atr_14: number | null;
}

export interface MultiTimeframeIndicators {
  '5m'?: IndicatorSnapshot;
  '15m'?: IndicatorSnapshot;
  '30m'?: IndicatorSnapshot;
  '1h'?: IndicatorSnapshot;
  '4h'?: IndicatorSnapshot;
  '1d'?: IndicatorSnapshot;
}

// ─── Trend Analysis Types ─────────────────────────────────────────────────────

export type TrendDirection = 'bullish' | 'bearish' | 'mixed';
export type MacdMomentum = 'confirming' | 'diverging' | 'neutral';
export type EntryQuality = 'strong' | 'moderate' | 'weak' | 'not_setup';

export interface EntrySetupQuality {
  /** Price is within 0.5 × ATR of EMA14 */
  isPullbackToEMA14: boolean;
  /** Price is within 1.0 × ATR of EMA60 */
  isPullbackToEMA60: boolean;
  /** Which EMA is nearest to price */
  nearestEMA: 'ema14' | 'ema60' | 'none';
  /** Distance in ATR units to nearest EMA */
  atrDistance: number | null;
  /** MACD histogram direction relative to expected trade direction */
  macdMomentum: MacdMomentum;
  /** RSI is in 30-70 zone (not extreme) */
  rsiNotExtreme: boolean;
  /** Overall entry quality rating */
  entryQuality: EntryQuality;
}

export interface TrendConfluenceResult {
  /** Primary TF trend direction — 1H for 15m analysis, 15M for 5m analysis */
  primaryTrend: TrendDirection;
  /** Macro TF trend direction — controls overall BUY/SELL bias (4H for 15m, 1H for 5m) */
  macroTrend: TrendDirection;
  /** Whether macro trend aligns with primary trend */
  macroAlignsPrimary: boolean;
  /** Whether recommended trade direction follows the primary trend */
  isFollowTrend: boolean;
  /** Confidence score adjustment (negative if macro/direction conflicts) */
  confidenceAdjustment: number;
  /** Minimum required Risk/Reward ratio (1.5 follow-trend, 1.0 counter-trend) */
  minRR: number;
  /** Human-readable summary injected into Claude prompt */
  confluenceSummary: string;
  /** Entry-timing analysis on the entry timeframe */
  entrySetup: EntrySetupQuality;
}
