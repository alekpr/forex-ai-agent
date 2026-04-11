import { MultiTimeframeIndicators } from './market';
import { TradeDirection, SimilarTrade } from './trade';
import { Timeframe } from './market';

export interface AgentResponse {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
}

export interface TradeLoggerResponse extends AgentResponse {
  data?: {
    tradeId: string;
    aiMarketComment: string;
    indicators: MultiTimeframeIndicators;
  };
}

export interface AnalyzeRequest {
  symbol: string;
  timeframe: Timeframe;
  riskLevel?: 'low' | 'medium' | 'high';
}

export interface AnalyzeResponse extends AgentResponse {
  data?: {
    symbol: string;
    timeframe: Timeframe;
    recommendation: TradeDirection | 'WAIT';
    confidence: number;
    suggestedTp: number | null;
    suggestedSl: number | null;
    riskScore: number;
    aiAnalysis: string;
    similarTrades: SimilarTrade[];
    winRate: number | null;
  };
}

export interface AlertSettings {
  alertEnabled: boolean;
  alertIntervalMinutes: number;
  riskLevel: 'low' | 'medium' | 'high';
  confidenceThreshold: number;
  candleRefreshEnabled: boolean;
  candleRefreshIntervalMinutes: number;
}
