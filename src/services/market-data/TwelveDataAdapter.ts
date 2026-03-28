import axios from 'axios';
import { env } from '../../config/env';
import { OHLCCandle, Timeframe } from '../../types/market';
import { IMarketDataAdapter } from './IMarketDataAdapter';

// TwelveData interval mapping
const TF_MAP: Record<Timeframe, string> = {
  '5m': '5min',
  '15m': '15min',
  '1h': '1h',
  '4h': '4h',
  '1d': '1day',
};

interface TwelveDataCandle {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

interface TwelveDataResponse {
  values: TwelveDataCandle[];
  status: string;
}

export class TwelveDataAdapter implements IMarketDataAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    if (!env.TWELVEDATA_API_KEY) {
      throw new Error('TWELVEDATA_API_KEY is required for TwelveDataAdapter');
    }
    this.baseUrl = env.TWELVEDATA_BASE_URL;
    this.apiKey = env.TWELVEDATA_API_KEY;
  }

  async getOHLCCandles(
    symbol: string,
    timeframe: Timeframe,
    limit = 200
  ): Promise<OHLCCandle[]> {
    const interval = TF_MAP[timeframe];

    const response = await axios.get<TwelveDataResponse>(
      `${this.baseUrl}/time_series`,
      {
        params: {
          symbol,
          interval,
          outputsize: limit,
          apikey: this.apiKey,
        },
      }
    );

    const data = response.data;
    if (data.status !== 'ok' || !data.values) {
      return [];
    }

    return data.values
      .map((v) => ({
        time: new Date(v.datetime),
        symbol,
        timeframe,
        open: parseFloat(v.open),
        high: parseFloat(v.high),
        low: parseFloat(v.low),
        close: parseFloat(v.close),
        volume: parseInt(v.volume, 10),
      }))
      .reverse(); // TwelveData returns newest first
  }
}
