export type Timeframe = '5m' | '15m' | '1h' | '4h' | '1d';

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
  '1h'?: IndicatorSnapshot;
  '4h'?: IndicatorSnapshot;
  '1d'?: IndicatorSnapshot;
}
