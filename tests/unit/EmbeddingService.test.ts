import { EmbeddingService } from '../../src/services/EmbeddingService';
import { CreateTradeLogInput } from '../../src/types/trade';
import { MultiTimeframeIndicators } from '../../src/types/market';

// Mock OpenAI client
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    embeddings: {
      create: jest.fn().mockResolvedValue({
        data: [{ embedding: Array.from({ length: 1536 }, (_, i) => i * 0.001) }],
      }),
    },
  }));
});

// Mock env
jest.mock('../../src/config/env', () => ({
  env: {
    OPENAI_API_KEY: 'sk-test',
    NODE_ENV: 'test',
  },
}));

const mockIndicators: MultiTimeframeIndicators = {
  '15m': {
    ema_14: 1.27010, ema_60: 1.26950, ema_200: 1.26500, sma_20: 1.27000,
    rsi_14: 55.0, macd_line: 0.0002, macd_signal: 0.0001, macd_hist: 0.0001,
    stoch_k: 60, stoch_d: 55, adx_14: 28,
    bb_upper: 1.27200, bb_middle: 1.27000, bb_lower: 1.26800, atr_14: 0.0015,
  },
  '4h': {
    ema_14: 1.26900, ema_60: 1.26700, ema_200: 1.25000, sma_20: 1.26800,
    rsi_14: 58, macd_line: 0.0005, macd_signal: 0.0003, macd_hist: 0.0002,
    stoch_k: 65, stoch_d: 60, adx_14: 30,
    bb_upper: 1.27500, bb_middle: 1.27000, bb_lower: 1.26500, atr_14: 0.004,
  },
};

const mockTradeInput: CreateTradeLogInput = {
  symbol: 'GBPUSD',
  direction: 'BUY',
  timeframe: '15m',
  entryPrice: 1.27050,
  tpPrice: 1.27300,
  slPrice: 1.26900,
  entryTime: new Date('2026-03-28T10:00:00Z'),
  userReason: 'Strong support bounce at 1.2700, EMA14 and EMA60 bullish alignment',
  indicatorsUsed: ['EMA14', 'EMA60', 'RSI', 'BB'],
};

describe('EmbeddingService', () => {
  let svc: EmbeddingService;

  beforeEach(() => {
    svc = new EmbeddingService();
  });

  describe('buildTradeContextText', () => {
    it('includes symbol, direction, timeframe', () => {
      const text = svc.buildTradeContextText(mockTradeInput, mockIndicators);
      expect(text).toContain('GBPUSD');
      expect(text).toContain('BUY');
      expect(text).toContain('15m');
    });

    it('includes EMA positions', () => {
      const text = svc.buildTradeContextText(mockTradeInput, mockIndicators);
      expect(text).toContain('EMA14:above');
      expect(text).toContain('EMA60:above');
      expect(text).toContain('EMA200:above');
    });

    it('includes RSI value', () => {
      const text = svc.buildTradeContextText(mockTradeInput, mockIndicators);
      expect(text).toContain('RSI14:');
    });

    it('includes user reason', () => {
      const text = svc.buildTradeContextText(mockTradeInput, mockIndicators);
      expect(text).toContain(mockTradeInput.userReason);
    });
  });

  describe('createTradeEmbedding', () => {
    it('returns array of 1536 numbers', async () => {
      const embedding = await svc.createTradeEmbedding(mockTradeInput, mockIndicators);
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding).toHaveLength(1536);
      expect(typeof embedding[0]).toBe('number');
    });
  });
});
