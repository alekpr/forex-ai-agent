import { OHLCCandle, Timeframe } from '../../types/market';

export interface IMarketDataAdapter {
  getOHLCCandles(
    symbol: string,
    timeframe: Timeframe,
    limit?: number
  ): Promise<OHLCCandle[]>;
}
