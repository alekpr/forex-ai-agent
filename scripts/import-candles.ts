/**
 * scripts/import-candles.ts
 *
 * Import historical OHLCV candle data from MT4/MT5 History Center CSV export.
 *
 * Supported CSV formats:
 *   Format A (7+ cols): <DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<TICKVOL>
 *     e.g. 2024.01.02,00:00,1.10542,1.10601,1.10530,1.10578,312
 *   Format B (6 cols, combined datetime): 2024.01.02 00:00,1.10542,...
 *   Format C (6 cols, daily no-time): 2024.01.02,1.10542,...
 *   Delimiter: comma (,) or semicolon (;) — auto-detected
 *
 * Usage:
 *   npm run import:candles -- --file ./data/EURUSD_M5.csv --symbol EURUSD --timeframe 5m --dry-run
 *   npm run import:candles -- --file ./data/EURUSD_M5.csv --symbol EURUSD --timeframe 5m --aggregate
 *   npm run import:candles -- --file ./data/EURUSD_M5.csv --symbol EURUSD --timeframe 5m --targets 15m,1h,4h,1d
 *   npm run import:candles -- --file ./data/EURUSD_M1.csv --symbol EURUSD --timeframe 1m --targets 5m,15m,1h,4h,1d
 *
 * Options:
 *   --file        Path to CSV file (required)
 *   --symbol      Trading symbol e.g. EURUSD (required)
 *   --timeframe   Source timeframe: 1m|5m|15m|1h|4h|1d (required)
 *   --aggregate   Auto-aggregate to all larger storable timeframes
 *   --targets     Comma-separated target TFs to aggregate into e.g. 15m,1h,4h,1d
 *   --batch-size  Candles per upsert batch (default: 500)
 *   --dry-run     Preview without writing to DB
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { CandleRepository } from '../src/repositories/CandleRepository';
import { OHLCCandle, Timeframe } from '../src/types/market';

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_STORE_TIMEFRAMES: Timeframe[] = ['5m', '15m', '30m', '1h', '4h', '1d'];

const TF_MINUTES: Record<string, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
};

// ─── CLI argument parsing ─────────────────────────────────────────────────────

function parseArgs(): {
  file: string;
  symbol: string;
  timeframe: string;
  aggregate: boolean;
  targets: string | undefined;
  batchSize: number;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  const raw: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        raw[key] = true;
      } else {
        raw[key] = next;
        i++;
      }
    }
  }

  const file = raw['file'] as string;
  const symbol = (raw['symbol'] as string)?.toUpperCase();
  const timeframe = (raw['timeframe'] as string)?.toLowerCase();

  if (!file || !symbol || !timeframe) {
    console.error(
      'Usage: npm run import:candles -- --file <path> --symbol <SYMBOL> --timeframe <tf>\n' +
      '         [--aggregate] [--targets 15m,1h,4h,1d] [--batch-size 500] [--dry-run]'
    );
    process.exit(1);
  }

  if (!TF_MINUTES[timeframe]) {
    console.error(`Unknown timeframe: "${timeframe}". Valid: ${Object.keys(TF_MINUTES).join(', ')}`);
    process.exit(1);
  }

  if (!fs.existsSync(file)) {
    console.error(`File not found: ${path.resolve(file)}`);
    process.exit(1);
  }

  return {
    file,
    symbol,
    timeframe,
    aggregate: raw['aggregate'] === true,
    targets: raw['targets'] as string | undefined,
    batchSize: parseInt((raw['batch-size'] as string) || '500', 10),
    dryRun: raw['dry-run'] === true,
  };
}

// ─── CSV Parsing ──────────────────────────────────────────────────────────────

interface RawCandle {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function parseDateTime(datePart: string, timePart?: string): Date {
  // datePart may be "2024.01.02" or "2024-01-02" or "2024.01.02 00:00"
  const normalized = datePart.replace(/\./g, '-');
  const combined = timePart
    ? `${normalized}T${timePart.length === 5 ? timePart + ':00' : timePart}Z`
    : `${normalized}T00:00:00Z`;
  const d = new Date(combined);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: "${datePart}" "${timePart ?? ''}"`);
  return d;
}

function parseCandleCsv(filePath: string): RawCandle[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');

  // Auto-detect delimiter from first non-header line
  const firstData = lines.find(
    (l) => !l.startsWith('<') && !l.startsWith('#') && !/^(date|time)/i.test(l.trim())
  );
  if (!firstData) throw new Error('No data lines found in CSV');
  const delimiter = firstData.includes(';') ? ';' : ',';

  const candles: RawCandle[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip header/comment lines
    if (!trimmed || trimmed.startsWith('<') || trimmed.startsWith('#') || /^(date|time)/i.test(trimmed)) {
      continue;
    }

    const cols = trimmed.split(delimiter).map((c) => c.trim().replace(/^["'](.*)["']$/, '$1'));

    try {
      let time: Date;
      let open: number, high: number, low: number, close: number, volume: number;

      if (cols.length >= 7) {
        // Format A: DATE, TIME, OPEN, HIGH, LOW, CLOSE, TICKVOL
        time = parseDateTime(cols[0], cols[1]);
        open = parseFloat(cols[2]);
        high = parseFloat(cols[3]);
        low = parseFloat(cols[4]);
        close = parseFloat(cols[5]);
        volume = parseInt(cols[6], 10) || 0;
      } else if (cols.length === 6) {
        if (cols[0].includes(' ')) {
          // Format B: "DATE TIME", OPEN, HIGH, LOW, CLOSE, TICKVOL
          const [d, t] = cols[0].split(' ');
          time = parseDateTime(d, t);
        } else {
          // Format C: DATE (daily, no time), OPEN, HIGH, LOW, CLOSE, TICKVOL
          time = parseDateTime(cols[0]);
        }
        open = parseFloat(cols[1]);
        high = parseFloat(cols[2]);
        low = parseFloat(cols[3]);
        close = parseFloat(cols[4]);
        volume = parseInt(cols[5], 10) || 0;
      } else {
        continue; // skip unrecognised lines silently
      }

      if (isNaN(open) || isNaN(close)) continue;
      candles.push({ time, open, high, low, close, volume });
    } catch {
      // skip malformed lines
    }
  }

  return candles;
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

function aggregateCandles(
  candles: RawCandle[],
  symbol: string,
  targetTf: Timeframe
): OHLCCandle[] {
  const periodMs = TF_MINUTES[targetTf] * 60 * 1000;
  // Ordered map so buckets are in chronological order
  const buckets = new Map<number, OHLCCandle>();

  for (const c of candles) {
    const bucketTs = Math.floor(c.time.getTime() / periodMs) * periodMs;
    const existing = buckets.get(bucketTs);
    if (!existing) {
      buckets.set(bucketTs, {
        time: new Date(bucketTs),
        symbol,
        timeframe: targetTf,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      });
    } else {
      if (c.high > existing.high) existing.high = c.high;
      if (c.low < existing.low) existing.low = c.low;
      existing.close = c.close; // last candle in bucket = close
      existing.volume += c.volume;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.time.getTime() - b.time.getTime());
}

function toStorableCandles(candles: RawCandle[], symbol: string, timeframe: Timeframe): OHLCCandle[] {
  return candles.map((c) => ({
    time: c.time,
    symbol,
    timeframe,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

// ─── Batch Insert ─────────────────────────────────────────────────────────────

async function insertBatched(
  repo: CandleRepository,
  candles: OHLCCandle[],
  batchSize: number,
  label: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) {
    console.log(`  [dry-run] Would upsert ${candles.length} candles for ${label}`);
    return;
  }

  let inserted = 0;
  for (let i = 0; i < candles.length; i += batchSize) {
    const batch = candles.slice(i, i + batchSize);
    await repo.upsertCandles(batch);
    inserted += batch.length;
    process.stdout.write(`\r  ${label}: ${inserted}/${candles.length} candles...`);
  }
  console.log(`\r  ${label}: ${candles.length} candles upserted ✓              `);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { file, symbol, timeframe, aggregate, targets: targetsRaw, batchSize, dryRun } = parseArgs();

  const isStorableSource = VALID_STORE_TIMEFRAMES.includes(timeframe as Timeframe);

  // Resolve aggregation targets
  let aggregationTargets: Timeframe[] = [];
  if (targetsRaw) {
    const requested = targetsRaw.split(',').map((t) => t.trim() as Timeframe);
    const invalid = requested.filter((t) => !VALID_STORE_TIMEFRAMES.includes(t));
    if (invalid.length) {
      console.error(`Invalid target timeframes: ${invalid.join(', ')}. Valid: ${VALID_STORE_TIMEFRAMES.join(', ')}`);
      process.exit(1);
    }
    aggregationTargets = requested.filter((t) => TF_MINUTES[t] > TF_MINUTES[timeframe]);
    if (aggregationTargets.length < requested.length) {
      const skipped = requested.filter((t) => TF_MINUTES[t] <= TF_MINUTES[timeframe]);
      console.warn(`Warning: skipping target(s) not larger than source TF: ${skipped.join(', ')}`);
    }
  } else if (aggregate) {
    aggregationTargets = VALID_STORE_TIMEFRAMES.filter((tf) => TF_MINUTES[tf] > TF_MINUTES[timeframe]);
  }

  console.log('\n=== Candle Import ===');
  console.log(`File:       ${path.resolve(file)}`);
  console.log(`Symbol:     ${symbol}`);
  console.log(`Source TF:  ${timeframe}${isStorableSource ? '' : ' (aggregate-only, not stored directly)'}`);
  if (aggregationTargets.length > 0) console.log(`Aggregate → ${aggregationTargets.join(', ')}`);
  if (dryRun) console.log('Mode:       DRY-RUN (no DB writes)');
  console.log('');

  // Parse CSV
  console.log('Parsing CSV...');
  const rawCandles = parseCandleCsv(file);
  console.log(`Parsed ${rawCandles.length} raw candles`);

  if (rawCandles.length === 0) {
    console.log('No candles found — check the file format and try again.');
    process.exit(0);
  }

  const sortedTimes = rawCandles.map((c) => c.time).sort((a, b) => a.getTime() - b.getTime());
  console.log(
    `Date range: ${sortedTimes[0].toISOString().slice(0, 16)} UTC → ` +
    `${sortedTimes[sortedTimes.length - 1].toISOString().slice(0, 16)} UTC\n`
  );

  const repo = new CandleRepository();

  // Insert source candles (only if it's a storable timeframe)
  if (isStorableSource) {
    const storableCandles = toStorableCandles(rawCandles, symbol, timeframe as Timeframe);
    await insertBatched(repo, storableCandles, batchSize, `${symbol} ${timeframe}`, dryRun);
  }

  // Aggregate and insert each target timeframe
  for (const targetTf of aggregationTargets) {
    const aggregated = aggregateCandles(rawCandles, symbol, targetTf);
    await insertBatched(repo, aggregated, batchSize, `${symbol} ${targetTf}`, dryRun);
  }

  if (!isStorableSource && aggregationTargets.length === 0) {
    console.log(`Source TF '${timeframe}' is not a storable timeframe and no --aggregate / --targets specified.`);
    console.log(`Use --aggregate or --targets to aggregate into: ${VALID_STORE_TIMEFRAMES.join(', ')}`);
  }

  console.log('\nDone!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
