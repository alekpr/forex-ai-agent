import * as fs from 'fs';
import * as readline from 'readline';
import { TradeDirection, TradeResult } from '../types/trade';
import { Timeframe } from '../types/market';

export interface ParsedBacktestTrade {
  symbol: string;
  direction: TradeDirection;
  timeframe: Timeframe;
  entryPrice: number;
  exitPrice: number;
  tpPrice: number;
  slPrice: number;
  entryTime: Date;
  exitTime: Date;
  pips: number;
  profitUsd: number;
  result: TradeResult;
  userReason: string;
}

export interface ParseOptions {
  timeframe: Timeframe;
  strategyName: string;
}

// Pip multipliers per symbol type
const PIP_MULTIPLIERS: Record<string, number> = {
  XAUUSD: 10,     // 1 pip = 0.10 (price), multiplier = 1/0.1 = 10
  XAGUSD: 50,     // 1 pip = 0.02
  DEFAULT_JPY: 100,  // JPY pairs: 1 pip = 0.01
  DEFAULT: 10000,    // Standard pairs (EURUSD, GBPUSD etc): 1 pip = 0.0001
};

function getPipMultiplier(symbol: string): number {
  if (symbol === 'XAUUSD') return PIP_MULTIPLIERS.XAUUSD;
  if (symbol === 'XAGUSD') return PIP_MULTIPLIERS.XAGUSD;
  if (symbol.endsWith('JPY')) return PIP_MULTIPLIERS.DEFAULT_JPY;
  return PIP_MULTIPLIERS.DEFAULT;
}

function calcPips(symbol: string, direction: TradeDirection, entryPrice: number, exitPrice: number): number {
  const multiplier = getPipMultiplier(symbol);
  const rawDiff = direction === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice;
  return Math.round(rawDiff * multiplier * 10) / 10;
}

function parseDirection(raw: string): TradeDirection | null {
  const lower = raw.toLowerCase().trim();
  if (lower === 'buy') return 'BUY';
  if (lower === 'sell') return 'SELL';
  return null;
}

function parseResult(profitUsd: number): TradeResult {
  if (profitUsd > 0) return 'WIN';
  if (profitUsd < 0) return 'LOSS';
  return 'BREAKEVEN';
}

/**
 * Parse MT4/MT5 date string: "2024.01.15 09:30" or "2024.01.15 09:30:00"
 */
function parseMt4Date(raw: string): Date | null {
  const trimmed = raw.trim();
  // Replace the dot separators in the date part: "2024.01.15" -> "2024-01-15"
  const normalized = trimmed.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, '$1-$2-$3');
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * MT4/MT5 Account History CSV columns (tab or comma separated):
 * #, Open Time, Type, Volume, Symbol, Price, S/L, T/P, Close Time, Price (close), Commission, Swap, Profit
 *
 * Also handles TradingView-style CSVs with headers as column names.
 */
export class Mt4CsvParser {
  private readonly options: ParseOptions;

  constructor(options: ParseOptions) {
    this.options = options;
  }

  async parse(filePath: string): Promise<{ trades: ParsedBacktestTrade[]; errors: string[] }> {
    const trades: ParsedBacktestTrade[] = [];
    const errors: string[] = [];

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length < 2) {
      return { trades: [], errors: ['CSV file is empty or has no data rows'] };
    }

    // Auto-detect delimiter
    const firstLine = lines[0];
    const delimiter = firstLine.includes('\t') ? '\t' : ',';

    // Parse header row — normalise to lowercase
    const headers = firstLine.split(delimiter).map(h => h.toLowerCase().replace(/"/g, '').trim());

    // Determine column index strategy
    const isHeaderRow = headers.some(h =>
      h.includes('type') || h.includes('open time') || h.includes('symbol') || h.includes('open_time')
    );

    if (isHeaderRow) {
      await this.parseWithHeaders(lines, delimiter, headers, trades, errors);
    } else {
      // Fallback: positional (standard MT4 format without custom headers)
      await this.parsePositional(lines, delimiter, trades, errors);
    }

    return { trades, errors };
  }

  private async parseWithHeaders(
    lines: string[],
    delimiter: string,
    headers: string[],
    trades: ParsedBacktestTrade[],
    errors: string[]
  ): Promise<void> {
    // Flexible header name aliases
    const col = (aliases: string[]): number =>
      aliases.reduce((found, alias) => (found !== -1 ? found : headers.findIndex(h => h.includes(alias))), -1);

    const idxOpenTime  = col(['open time', 'open_time', 'entry time', 'entry_time', 'opentimestamp']);
    const idxType      = col(['type', 'direction', 'side', 'cmd']);
    const idxSymbol    = col(['symbol', 'pair', 'instrument']);
    const idxOpenPrice = col(['open price', 'open_price', 'price', 'entry price', 'entry_price']);
    const idxSl        = col(['s/l', 'sl', 'stop loss', 'stoploss']);
    const idxTp        = col(['t/p', 'tp', 'take profit', 'takeprofit']);
    const idxCloseTime = col(['close time', 'close_time', 'exit time', 'exit_time', 'closetimestamp']);
    const idxClosePrice = col(['close price', 'close_price', 'exit price', 'exit_price',
                                // second 'price' column — handled below
                                ]);
    const idxProfit    = col(['profit', 'p&l', 'pnl', 'net profit', 'net_profit']);

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.startsWith('#')) continue;

      const cols = line.split(delimiter).map(c => c.replace(/"/g, '').trim());

      try {
        const openTimeRaw  = idxOpenTime !== -1  ? cols[idxOpenTime]  : '';
        const typeRaw      = idxType !== -1      ? cols[idxType]      : '';
        const symbolRaw    = idxSymbol !== -1    ? cols[idxSymbol]    : '';
        const openPriceRaw = idxOpenPrice !== -1 ? cols[idxOpenPrice] : '';
        const slRaw        = idxSl !== -1        ? cols[idxSl]        : '0';
        const tpRaw        = idxTp !== -1        ? cols[idxTp]        : '0';
        const closeTimeRaw = idxCloseTime !== -1 ? cols[idxCloseTime] : '';
        // Close price: prefer explicit close price column, otherwise next 'price' column after open
        const closePriceRaw = idxClosePrice !== -1
          ? cols[idxClosePrice]
          : cols[idxOpenPrice + 1] ?? '';
        const profitRaw    = idxProfit !== -1    ? cols[idxProfit]    : '';

        const trade = this.buildTrade(
          i, symbolRaw, typeRaw, openTimeRaw, openPriceRaw,
          slRaw, tpRaw, closeTimeRaw, closePriceRaw, profitRaw
        );
        if (trade) trades.push(trade);
      } catch (err) {
        errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * Standard MT4 Account History positional format (no header):
   * #, Open Time, Type, Volume, Symbol, Price, S/L, T/P, Close Time, Price, Commission, Swap, Profit
   * 0     1        2      3       4       5     6    7       8          9        10         11     12
   */
  private async parsePositional(
    lines: string[],
    delimiter: string,
    trades: ParsedBacktestTrade[],
    errors: string[]
  ): Promise<void> {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.startsWith('#') || line.startsWith('Ticket')) continue;

      const cols = line.split(delimiter).map(c => c.replace(/"/g, '').trim());
      if (cols.length < 13) continue;

      try {
        const trade = this.buildTrade(
          i,
          cols[4],  // symbol
          cols[2],  // type
          cols[1],  // open time
          cols[5],  // open price
          cols[6],  // S/L
          cols[7],  // T/P
          cols[8],  // close time
          cols[9],  // close price
          cols[12]  // profit
        );
        if (trade) trades.push(trade);
      } catch (err) {
        errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private buildTrade(
    rowNum: number,
    symbolRaw: string,
    typeRaw: string,
    openTimeRaw: string,
    openPriceRaw: string,
    slRaw: string,
    tpRaw: string,
    closeTimeRaw: string,
    closePriceRaw: string,
    profitRaw: string
  ): ParsedBacktestTrade | null {
    const direction = parseDirection(typeRaw);
    if (!direction) return null; // skip non-trade rows (balance, credit etc.)

    const symbol = symbolRaw.toUpperCase();
    if (!symbol) throw new Error('Missing symbol');

    const entryTime = parseMt4Date(openTimeRaw);
    if (!entryTime) throw new Error(`Invalid open time: "${openTimeRaw}"`);

    const exitTime = parseMt4Date(closeTimeRaw);
    if (!exitTime) throw new Error(`Invalid close time: "${closeTimeRaw}"`);

    const entryPrice = parseFloat(openPriceRaw);
    if (isNaN(entryPrice)) throw new Error(`Invalid open price: "${openPriceRaw}"`);

    const exitPrice = parseFloat(closePriceRaw);
    if (isNaN(exitPrice)) throw new Error(`Invalid close price: "${closePriceRaw}"`);

    const profitUsd = parseFloat(profitRaw.replace(/,/g, ''));
    if (isNaN(profitUsd)) throw new Error(`Invalid profit: "${profitRaw}"`);

    const slPrice = parseFloat(slRaw) || 0;
    const tpPrice = parseFloat(tpRaw) || 0;

    const pips = calcPips(symbol, direction, entryPrice, exitPrice);
    const result = parseResult(profitUsd);

    const userReason = `[${this.options.strategyName}] ${direction} ${symbol} ${this.options.timeframe}`;

    return {
      symbol,
      direction,
      timeframe: this.options.timeframe,
      entryPrice,
      exitPrice,
      tpPrice,
      slPrice,
      entryTime,
      exitTime,
      pips,
      profitUsd,
      result,
      userReason,
    };
  }
}
