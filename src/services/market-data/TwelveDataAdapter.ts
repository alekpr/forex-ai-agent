import axios from 'axios';
import { env } from '../../config/env';
import { OHLCCandle, Timeframe } from '../../types/market';
import { IMarketDataAdapter } from './IMarketDataAdapter';

// TwelveData interval mapping
const TF_MAP: Record<Timeframe, string> = {
  '5m': '5min',
  '15m': '15min',
  '30m': '30min',
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

  /** Convert EURUSD → EUR/USD, XAUUSD → XAU/USD */
  private formatSymbol(symbol: string): string {
    const s = symbol.toUpperCase();
    if (s.includes('/')) return s;
    // 6-char forex pair e.g. EURUSD → EUR/USD
    if (s.length === 6) return `${s.slice(0, 3)}/${s.slice(3)}`;
    // 7-char commodity e.g. XAUUSD → XAU/USD
    if (s.length === 7) return `${s.slice(0, 3)}/${s.slice(3)}`;
    return s;
  }

  async getOHLCCandles(
    symbol: string,
    timeframe: Timeframe,
    limit = 200,
    beforeTime?: Date
  ): Promise<OHLCCandle[]> {
    const interval = TF_MAP[timeframe];
    const formattedSymbol = this.formatSymbol(symbol);

    const params: Record<string, string | number> = {
      symbol: formattedSymbol,
      interval,
      outputsize: limit,
      apikey: this.apiKey,
    };

    if (beforeTime) {
      // TwelveData expects "YYYY-MM-DD HH:MM:SS"
      params.end_date = beforeTime.toISOString().replace('T', ' ').slice(0, 19);
    }

    const response = await axios.get<TwelveDataResponse>(
      `${this.baseUrl}/time_series`,
      { params }
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
        volume: parseInt(v.volume, 10) || 0,
      }))
      .reverse(); // TwelveData returns newest first
  }
}
