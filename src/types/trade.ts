import { MultiTimeframeIndicators, OHLCCandle, Timeframe } from './market';

export type TradeDirection = 'BUY' | 'SELL';
export type TradeStatus = 'open' | 'closed';
export type TradeResult = 'WIN' | 'LOSS' | 'BREAKEVEN';

export interface CreateTradeLogInput {
  symbol: string;
  direction: TradeDirection;
  timeframe: Timeframe;
  entryPrice: number;
  tpPrice: number;
  slPrice: number;
  entryTime: Date;
  userReason: string;
  indicatorsUsed: string[];
  userAnalysis?: string;
}

export interface TradeLog {
  id: string;
  userId: string;
  symbol: string;
  direction: TradeDirection;
  timeframe: Timeframe;
  entryPrice: number;
  tpPrice: number;
  slPrice: number;
  entryTime: Date;
  userReason: string;
  indicatorsUsed: string[];
  userAnalysis: string | null;
  marketSnapshot: Record<string, OHLCCandle> | null;
  indicatorsSnapshot: MultiTimeframeIndicators | null;
  aiMarketComment: string | null;
  embedding: number[] | null;
  status: TradeStatus;
  createdAt: Date;
}

export interface CloseTradeInput {
  result: TradeResult;
  exitPrice: number;
  exitTime: Date;
  pips: number;
  profitUsd: number;
  userExitReason: string;
  userLesson?: string;
}

export interface TradeResultRecord {
  id: string;
  tradeLogId: string;
  result: TradeResult;
  exitPrice: number;
  exitTime: Date;
  pips: number;
  profitUsd: number;
  exitMarketSnapshot: Record<string, OHLCCandle> | null;
  exitIndicatorsSnapshot: MultiTimeframeIndicators | null;
  userExitReason: string;
  userLesson: string | null;
  aiLesson: string | null;
  aiPatternTags: string[] | null;
  createdAt: Date;
}

export interface ClosedTradeWithResult {
  id: string;
  symbol: string;
  direction: TradeDirection;
  timeframe: Timeframe;
  entryPrice: number;
  tpPrice: number;
  slPrice: number;
  entryTime: Date;
  userReason: string;
  indicatorsUsed: string[];
  userAnalysis: string | null;
  aiMarketComment: string | null;
  createdAt: Date;
  // from trade_results
  result: TradeResult;
  exitPrice: number;
  exitTime: Date;
  pips: number;
  profitUsd: number;
  userExitReason: string;
  userLesson: string | null;
  aiLesson: string | null;
  aiPatternTags: string[];
}

export interface SimilarTrade {
  id: string;
  symbol: string;
  direction: TradeDirection;
  timeframe: Timeframe;
  entryPrice: number;
  tpPrice: number;
  slPrice: number;
  userReason: string;
  indicatorsSnapshot: MultiTimeframeIndicators | null;
  result: TradeResult;
  pips: number;
  profitUsd: number;
  userExitReason: string | null;
  aiLesson: string | null;
  similarityScore: number;
}
