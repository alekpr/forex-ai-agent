import { OHLCCandle, Timeframe } from '../../types/market';

export interface IMarketDataAdapter {
  getOHLCCandles(
    symbol: string,
    timeframe: Timeframe,
    limit?: number,
    beforeTime?: Date
  ): Promise<OHLCCandle[]>;
}
