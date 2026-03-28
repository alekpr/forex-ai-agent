import axios from 'axios';
import { env } from '../../config/env';
import { OHLCCandle, Timeframe } from '../../types/market';
import { IMarketDataAdapter } from './IMarketDataAdapter';

// Finnhub timeframe resolution mapping
const TF_MAP: Record<Timeframe, string> = {
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
};

interface FinnhubCandleResponse {
  c: number[];
  h: number[];
  l: number[];
  o: number[];
  t: number[];
  v: number[];
  s: string;
}

export class FinnhubAdapter implements IMarketDataAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    if (!env.FINNHUB_API_KEY) {
      throw new Error('FINNHUB_API_KEY is required for FinnhubAdapter');
    }
    this.baseUrl = env.FINNHUB_BASE_URL;
    this.apiKey = env.FINNHUB_API_KEY;
  }

  async getOHLCCandles(
    symbol: string,
    timeframe: Timeframe,
    limit = 200
  ): Promise<OHLCCandle[]> {
    const resolution = TF_MAP[timeframe];
    const toTs = Math.floor(Date.now() / 1000);
    // Rough back-calculation: get enough history for 'limit' candles
    const minutesPerCandle: Record<string, number> = {
      '5': 5, '15': 15, '60': 60, '240': 240, 'D': 1440,
    };
    const fromTs = toTs - minutesPerCandle[resolution] * 60 * limit * 2;

    const response = await axios.get<FinnhubCandleResponse>(
      `${this.baseUrl}/forex/candle`,
      {
        params: {
          symbol: `OANDA:${symbol}`,
          resolution,
          from: fromTs,
          to: toTs,
          token: this.apiKey,
        },
      }
    );

    const data = response.data;
    if (data.s !== 'ok' || !data.t) {
      return [];
    }

    return data.t.map((timestamp, i) => ({
      time: new Date(timestamp * 1000),
      symbol,
      timeframe,
      open: data.o[i],
      high: data.h[i],
      low: data.l[i],
      close: data.c[i],
      volume: data.v[i],
    }));
  }
}
