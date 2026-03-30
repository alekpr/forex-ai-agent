import { env } from '../../config/env';
import { OHLCCandle, Timeframe } from '../../types/market';
import { IMarketDataAdapter } from './IMarketDataAdapter';
import { FinnhubAdapter } from './FinnhubAdapter';
import { TwelveDataAdapter } from './TwelveDataAdapter';

export class MarketDataService implements IMarketDataAdapter {
  private readonly adapter: IMarketDataAdapter;

  constructor() {
    if (env.MARKET_DATA_PROVIDER === 'twelvedata') {
      this.adapter = new TwelveDataAdapter();
    } else {
      this.adapter = new FinnhubAdapter();
    }
    console.log(`MarketDataService: using ${env.MARKET_DATA_PROVIDER} adapter`);
  }

  getOHLCCandles(
    symbol: string,
    timeframe: Timeframe,
    limit = 200,
    beforeTime?: Date
  ): Promise<OHLCCandle[]> {
    return this.adapter.getOHLCCandles(symbol, timeframe, limit, beforeTime);
  }
}
