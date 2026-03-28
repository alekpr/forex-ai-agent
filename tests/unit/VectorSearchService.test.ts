import { VectorSearchService } from '../../src/services/VectorSearchService';
import { SimilarTrade } from '../../src/types/trade';

// Mock the DB query function
jest.mock('../../src/db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../../src/config/env', () => ({
  env: { DATABASE_URL: 'postgresql://test', NODE_ENV: 'test' },
}));

import { query } from '../../src/db/connection';

const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());

const mockRows = [
  {
    id: 'trade-1',
    symbol: 'GBPUSD',
    direction: 'BUY',
    timeframe: '15m',
    entry_price: '1.27050',
    tp_price: '1.27300',
    sl_price: '1.26900',
    user_reason: 'EMA bounce',
    indicators_snapshot: null,
    result: 'WIN',
    pips: '25.00',
    profit_usd: '25.00',
    user_exit_reason: 'Hit TP',
    ai_lesson: 'Good setup',
    similarity_score: '0.87',
  },
  {
    id: 'trade-2',
    symbol: 'GBPUSD',
    direction: 'BUY',
    timeframe: '15m',
    entry_price: '1.26800',
    tp_price: '1.27000',
    sl_price: '1.26650',
    user_reason: 'RSI oversold',
    indicators_snapshot: null,
    result: 'LOSS',
    pips: '-15.00',
    profit_usd: '-15.00',
    user_exit_reason: 'Hit SL',
    ai_lesson: 'Entered early',
    similarity_score: '0.76',
  },
];

describe('VectorSearchService', () => {
  const svc = new VectorSearchService();

  beforeEach(() => {
    (query as jest.Mock).mockResolvedValue({ rows: mockRows });
  });

  afterEach(() => jest.clearAllMocks());

  describe('findSimilarTrades', () => {
    it('returns correctly mapped trade objects', async () => {
      const trades = await svc.findSimilarTrades(mockEmbedding, 'user-1');
      expect(trades).toHaveLength(2);
      expect(trades[0].id).toBe('trade-1');
      expect(trades[0].entryPrice).toBe(1.2705);
      expect(trades[0].similarityScore).toBe(0.87);
    });

    it('calls query with embedding string format', async () => {
      await svc.findSimilarTrades(mockEmbedding, 'user-1');
      const callArgs = (query as jest.Mock).mock.calls[0];
      expect(callArgs[1][0]).toMatch(/^\[[\d.,\-]+\]$/);
    });
  });

  describe('calcWinRate', () => {
    it('returns correct win rate percentage', () => {
      const trades = [
        { result: 'WIN' } as SimilarTrade,
        { result: 'WIN' } as SimilarTrade,
        { result: 'LOSS' } as SimilarTrade,
        { result: 'LOSS' } as SimilarTrade,
      ];
      expect(svc.calcWinRate(trades)).toBe(50);
    });

    it('returns null for empty array', () => {
      expect(svc.calcWinRate([])).toBeNull();
    });

    it('returns 100 when all trades are wins', () => {
      const trades = [{ result: 'WIN' } as SimilarTrade, { result: 'WIN' } as SimilarTrade];
      expect(svc.calcWinRate(trades)).toBe(100);
    });
  });
});
