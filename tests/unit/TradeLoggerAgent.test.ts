import { TradeLoggerAgent } from '../../src/agents/TradeLoggerAgent';
import { CreateTradeLogInput } from '../../src/types/trade';

// Mock all dependencies
jest.mock('../../src/services/market-data/MarketDataService');
jest.mock('../../src/services/IndicatorService');
jest.mock('../../src/services/EmbeddingService');
jest.mock('../../src/services/ClaudeAiService');
jest.mock('../../src/repositories/CandleRepository');
jest.mock('../../src/repositories/IndicatorRepository');
jest.mock('../../src/repositories/TradeLogRepository');
jest.mock('../../src/repositories/TradeResultRepository');
jest.mock('../../src/config/env', () => ({
  env: { DEFAULT_USER_ID: 'user-1', NODE_ENV: 'test' },
}));

import { MarketDataService } from '../../src/services/market-data/MarketDataService';
import { IndicatorService } from '../../src/services/IndicatorService';
import { EmbeddingService } from '../../src/services/EmbeddingService';
import { ClaudeAiService } from '../../src/services/ClaudeAiService';
import { TradeLogRepository } from '../../src/repositories/TradeLogRepository';
import { TradeResultRepository } from '../../src/repositories/TradeResultRepository';

const mockCandles = [
  { time: new Date(), symbol: 'GBPUSD', timeframe: '15m' as const, open: 1.27, high: 1.275, low: 1.268, close: 1.272, volume: 1000 },
];
const mockIndicators = { '15m': { ema_14: 1.271, ema_60: 1.268, ema_200: 1.26, sma_20: 1.270, rsi_14: 52, macd_line: 0.0001, macd_signal: 0.00008, macd_hist: 0.00002, stoch_k: 60, stoch_d: 55, adx_14: 25, bb_upper: 1.275, bb_middle: 1.270, bb_lower: 1.265, atr_14: 0.0015 } };
const mockEmbedding = Array.from({ length: 1536 }, () => 0.1);
const mockTrade = { id: 'trade-abc', status: 'open', symbol: 'GBPUSD' } as any;

const mockInput: CreateTradeLogInput = {
  symbol: 'GBPUSD',
  direction: 'BUY',
  timeframe: '15m',
  entryPrice: 1.27050,
  tpPrice: 1.27300,
  slPrice: 1.26900,
  entryTime: new Date(),
  userReason: 'EMA alignment + support bounce',
  indicatorsUsed: ['EMA14', 'EMA60'],
};

describe('TradeLoggerAgent', () => {
  let agent: TradeLoggerAgent;

  beforeEach(() => {
    (MarketDataService as jest.Mock).mockImplementation(() => ({
      getOHLCCandles: jest.fn().mockResolvedValue(mockCandles),
    }));
    (IndicatorService as jest.Mock).mockImplementation(() => ({
      computeMultiTimeframe: jest.fn().mockReturnValue(mockIndicators),
    }));
    (EmbeddingService as jest.Mock).mockImplementation(() => ({
      createTradeEmbedding: jest.fn().mockResolvedValue(mockEmbedding),
    }));
    (ClaudeAiService as jest.Mock).mockImplementation(() => ({
      analyzeMarketAtEntry: jest.fn().mockResolvedValue('Bullish setup confirmed.'),
      summarizeLesson: jest.fn().mockResolvedValue({ lesson: 'Good trade.', patternTags: ['trend_following'] }),
    }));
    (TradeLogRepository as jest.Mock).mockImplementation(() => ({
      create: jest.fn().mockResolvedValue({ id: 'trade-abc' }),
      findById: jest.fn().mockResolvedValue(mockTrade),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    }));
    (TradeResultRepository as jest.Mock).mockImplementation(() => ({
      create: jest.fn().mockResolvedValue({ id: 'result-1' }),
    }));

    agent = new TradeLoggerAgent();
  });

  it('logTrade returns success with tradeId and aiMarketComment', async () => {
    const result = await agent.logTrade(mockInput);
    expect(result.success).toBe(true);
    expect(result.data?.tradeId).toBe('trade-abc');
    expect(result.data?.aiMarketComment).toBe('Bullish setup confirmed.');
  });

  it('closeTrade returns success with aiLesson', async () => {
    const result = await agent.closeTrade('trade-abc', {
      result: 'WIN',
      exitPrice: 1.27300,
      exitTime: new Date(),
      pips: 25,
      profitUsd: 25,
      userExitReason: 'Hit TP',
    });
    expect(result.success).toBe(true);
    expect(result.data?.aiLesson).toBe('Good trade.');
  });

  it('closeTrade returns 404-like message when trade not found', async () => {
    (TradeLogRepository as jest.Mock).mockImplementation(() => ({
      findById: jest.fn().mockResolvedValue(null),
    }));
    const freshAgent = new TradeLoggerAgent();
    const result = await freshAgent.closeTrade('nonexistent', {
      result: 'WIN',
      exitPrice: 1.27300,
      exitTime: new Date(),
      pips: 25,
      profitUsd: 25,
      userExitReason: 'Hit TP',
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });
});
