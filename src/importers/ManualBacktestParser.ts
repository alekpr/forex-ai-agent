import * as fs from 'fs';
import { TradeDirection, TradeResult } from '../types/trade';
import { Timeframe } from '../types/market';
import { ParsedBacktestTrade } from './Mt4CsvParser';

// Re-export so scripts can use unified type
export type { ParsedBacktestTrade };

/**
 * Manual backtest CSV format — designed for trades you replay from chart history.
 *
 * Required columns:
 *   symbol, direction, timeframe, entry_price, exit_price, entry_time, exit_time, result, reason
 *
 * Optional columns:
 *   tp_price, sl_price, profit_usd, lot_size
 *
 * Example header:
 *   symbol,direction,timeframe,entry_price,exit_price,tp_price,sl_price,
 *   entry_time,exit_time,result,profit_usd,reason
 *
 * Date formats accepted:
 *   "2024-01-15 09:30", "2024-01-15T09:30:00", "2024-01-15"
 */

const VALID_TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];

// Pip calculation per symbol (same logic as Mt4CsvParser)
const PIP_MULTIPLIERS: Record<string, number> = {
  XAUUSD: 10,     // 1 pip = 0.10 (price), multiplier = 1/0.1 = 10
  XAGUSD: 50,     // 1 pip = 0.02
};

function getPipMultiplier(symbol: string): number {
  if (PIP_MULTIPLIERS[symbol]) return PIP_MULTIPLIERS[symbol];
  if (symbol.endsWith('JPY')) return 100;
  return 10000;
}

function calcPips(symbol: string, direction: TradeDirection, entryPrice: number, exitPrice: number): number {
  const multiplier = getPipMultiplier(symbol);
  const rawDiff = direction === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice;
  return Math.round(rawDiff * multiplier * 10) / 10;
}

function parseDate(raw: string): Date | null {
  if (!raw || !raw.trim()) return null;
  const normalized = raw.trim().replace(/\//g, '-');
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

function parseDirection(raw: string): TradeDirection | null {
  const upper = raw.trim().toUpperCase();
  if (upper === 'BUY') return 'BUY';
  if (upper === 'SELL') return 'SELL';
  return null;
}

function parseResult(raw: string): TradeResult | null {
  const upper = raw.trim().toUpperCase();
  if (upper === 'WIN') return 'WIN';
  if (upper === 'LOSS') return 'LOSS';
  if (upper === 'BREAKEVEN' || upper === 'BE') return 'BREAKEVEN';
  return null;
}

function parseTimeframe(raw: string): Timeframe | null {
  const lower = raw.trim().toLowerCase() as Timeframe;
  return VALID_TIMEFRAMES.includes(lower) ? lower : null;
}

export class ManualBacktestParser {
  /**
   * Parse a manually-created backtest CSV file.
   * Returns parsed trades and a list of row-level error messages.
   */
  parse(filePath: string): { trades: ParsedBacktestTrade[]; errors: string[] } {
    const trades: ParsedBacktestTrade[] = [];
    const errors: string[] = [];

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#'));

    if (lines.length < 2) {
      return { trades: [], errors: ['CSV must have a header row + at least one data row'] };
    }

    // Auto-detect delimiter: prefer comma, but tab is also supported
    const header = lines[0];
    const delimiter = header.includes('\t') ? '\t' : ',';

    // Parse header columns — lowercase and trim
    const headers = header.split(delimiter).map(h => h.toLowerCase().replace(/"/g, '').trim());

    const col = (names: string[]): number =>
      names.reduce((found, name) => (found !== -1 ? found : headers.indexOf(name)), -1);

    const idxSymbol      = col(['symbol', 'pair', 'instrument']);
    const idxDirection   = col(['direction', 'type', 'side']);
    const idxTimeframe   = col(['timeframe', 'tf', 'time_frame']);
    const idxEntryPrice  = col(['entry_price', 'entry price', 'open_price', 'open price']);
    const idxExitPrice   = col(['exit_price', 'exit price', 'close_price', 'close price']);
    const idxTpPrice     = col(['tp_price', 'tp price', 't/p', 'tp', 'take_profit']);
    const idxSlPrice     = col(['sl_price', 'sl price', 's/l', 'sl', 'stop_loss']);
    const idxEntryTime   = col(['entry_time', 'entry time', 'open_time', 'open time']);
    const idxExitTime    = col(['exit_time', 'exit time', 'close_time', 'close time']);
    const idxResult      = col(['result', 'outcome']);
    const idxProfitUsd   = col(['profit_usd', 'profit usd', 'profit', 'p&l', 'pnl', 'net_profit']);
    const idxReason      = col(['reason', 'user_reason', 'entry_reason', 'note', 'notes', 'comment']);

    // Validate required columns
    const missing: string[] = [];
    if (idxSymbol === -1)     missing.push('symbol');
    if (idxDirection === -1)  missing.push('direction');
    if (idxTimeframe === -1)  missing.push('timeframe');
    if (idxEntryPrice === -1) missing.push('entry_price');
    if (idxExitPrice === -1)  missing.push('exit_price');
    if (idxEntryTime === -1)  missing.push('entry_time');
    if (idxExitTime === -1)   missing.push('exit_time');
    if (idxResult === -1)     missing.push('result');
    if (idxReason === -1)     missing.push('reason');

    if (missing.length > 0) {
      return {
        trades: [],
        errors: [`Missing required column(s): ${missing.join(', ')}. Found: ${headers.join(', ')}`],
      };
    }

    // Parse data rows
    for (let i = 1; i < lines.length; i++) {
      const rowNum = i + 1; // 1-based for user display
      const raw = lines[i];

      // Handle quoted fields containing commas
      const cols = splitCsvLine(raw, delimiter);

      const get = (idx: number): string => (idx !== -1 && cols[idx] ? cols[idx].replace(/"/g, '').trim() : '');

      try {
        const symbolRaw    = get(idxSymbol).toUpperCase();
        const directionRaw = get(idxDirection);
        const timeframeRaw = get(idxTimeframe);
        const entryPriceRaw = get(idxEntryPrice);
        const exitPriceRaw  = get(idxExitPrice);
        const entryTimeRaw  = get(idxEntryTime);
        const exitTimeRaw   = get(idxExitTime);
        const resultRaw     = get(idxResult);
        const reasonRaw     = get(idxReason);

        // Required field validation
        if (!symbolRaw)    throw new Error('symbol is empty');

        const direction = parseDirection(directionRaw);
        if (!direction) throw new Error(`direction "${directionRaw}" must be BUY or SELL`);

        const timeframe = parseTimeframe(timeframeRaw);
        if (!timeframe) throw new Error(`timeframe "${timeframeRaw}" must be one of: ${VALID_TIMEFRAMES.join(', ')}`);

        const entryPrice = parseFloat(entryPriceRaw);
        if (isNaN(entryPrice)) throw new Error(`entry_price "${entryPriceRaw}" is not a number`);

        const exitPrice = parseFloat(exitPriceRaw);
        if (isNaN(exitPrice)) throw new Error(`exit_price "${exitPriceRaw}" is not a number`);

        const entryTime = parseDate(entryTimeRaw);
        if (!entryTime) throw new Error(`entry_time "${entryTimeRaw}" cannot be parsed`);

        const exitTime = parseDate(exitTimeRaw);
        if (!exitTime) throw new Error(`exit_time "${exitTimeRaw}" cannot be parsed`);

        const result = parseResult(resultRaw);
        if (!result) throw new Error(`result "${resultRaw}" must be WIN, LOSS, or BREAKEVEN`);

        if (!reasonRaw) throw new Error('reason is empty — please describe why you entered this trade');

        // Optional fields
        const tpPrice   = parseFloat(get(idxTpPrice))  || 0;
        const slPrice   = parseFloat(get(idxSlPrice))  || 0;
        const profitRaw = get(idxProfitUsd).replace(/,/g, '');
        const profitUsd = profitRaw ? (parseFloat(profitRaw) || 0) : 0;

        // Calculate pips from price difference
        const pips = calcPips(symbolRaw, direction, entryPrice, exitPrice);

        trades.push({
          symbol: symbolRaw,
          direction,
          timeframe,
          entryPrice,
          exitPrice,
          tpPrice,
          slPrice,
          entryTime,
          exitTime,
          result,
          pips,
          profitUsd,
          userReason: reasonRaw,
        });
      } catch (err) {
        errors.push(`Row ${rowNum}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { trades, errors };
  }
}

/**
 * Split a CSV line respecting quoted fields.
 * e.g. 'EURUSD,BUY,"EMA14 cross, RSI>50",1h' → ['EURUSD', 'BUY', 'EMA14 cross, RSI>50', '1h']
 */
function splitCsvLine(line: string, delimiter: string): string[] {
  if (delimiter === '\t') return line.split('\t');

  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
