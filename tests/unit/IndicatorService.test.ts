import { IndicatorService } from '../../src/services/IndicatorService';
import { OHLCCandle } from '../../src/types/market';

function generateCandles(count: number, basePrice = 1.27000): OHLCCandle[] {
  return Array.from({ length: count }, (_, i) => ({
    time: new Date(Date.now() - (count - i) * 60000),
    symbol: 'GBPUSD',
    timeframe: '15m' as const,
    open: basePrice + i * 0.00001,
    high: basePrice + i * 0.00001 + 0.0005,
    low: basePrice + i * 0.00001 - 0.0003,
    close: basePrice + i * 0.00001 + 0.0002,
    volume: 1000,
  }));
}

describe('IndicatorService', () => {
  const svc = new IndicatorService();

  describe('computeIndicators', () => {
    it('returns null values when insufficient candles', () => {
      const candles = generateCandles(10);
      const result = svc.computeIndicators(candles);
      // EMA 14 needs 14 candles minimum; 10 is insufficient
      expect(result.ema_14).toBeNull();
      expect(result.rsi_14).toBeNull();
    });

    it('computes EMA14 with sufficient candles', () => {
      const candles = generateCandles(50);
      const result = svc.computeIndicators(candles);
      expect(result.ema_14).not.toBeNull();
      expect(typeof result.ema_14).toBe('number');
    });

    it('computes EMA60 with 60+ candles', () => {
      const candles = generateCandles(80);
      const result = svc.computeIndicators(candles);
      expect(result.ema_60).not.toBeNull();
    });

    it('computes EMA200 with 200+ candles', () => {
      const candles = generateCandles(210);
      const result = svc.computeIndicators(candles);
      expect(result.ema_200).not.toBeNull();
    });

    it('computes RSI in valid range [0, 100]', () => {
      const candles = generateCandles(50);
      const result = svc.computeIndicators(candles);
      if (result.rsi_14 !== null) {
        expect(result.rsi_14).toBeGreaterThanOrEqual(0);
        expect(result.rsi_14).toBeLessThanOrEqual(100);
      }
    });

    it('computes Bollinger Bands with correct order', () => {
      const candles = generateCandles(50);
      const result = svc.computeIndicators(candles);
      if (result.bb_upper !== null && result.bb_lower !== null) {
        expect(result.bb_upper).toBeGreaterThan(result.bb_lower);
      }
    });
  });

  describe('computeMultiTimeframe', () => {
    it('handles empty input gracefully', () => {
      const result = svc.computeMultiTimeframe({});
      expect(result).toEqual({});
    });

    it('processes multiple timeframes in one call', () => {
      const candles = generateCandles(50);
      const result = svc.computeMultiTimeframe({ '15m': candles, '1h': candles });
      expect(result['15m']).toBeDefined();
      expect(result['1h']).toBeDefined();
    });
  });

  describe('getBBPosition', () => {
    const snap = {
      ema_14: null, ema_60: null, ema_200: null, sma_20: null,
      rsi_14: null, macd_line: null, macd_signal: null, macd_hist: null,
      stoch_k: null, stoch_d: null, adx_14: null,
      bb_upper: 1.2800, bb_middle: 1.2700, bb_lower: 1.2600, atr_14: null,
    };

    it('returns above_upper when price is above upper band', () => {
      expect(svc.getBBPosition(1.2850, snap)).toBe('above_upper');
    });

    it('returns below_lower when price is below lower band', () => {
      expect(svc.getBBPosition(1.2550, snap)).toBe('below_lower');
    });

    it('returns above_middle when price is between middle and upper', () => {
      expect(svc.getBBPosition(1.2750, snap)).toBe('above_middle');
    });

    it('returns below_middle when price is between lower and middle', () => {
      expect(svc.getBBPosition(1.2650, snap)).toBe('below_middle');
    });
  });
});
