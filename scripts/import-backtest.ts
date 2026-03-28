/**
 * scripts/import-backtest.ts
 *
 * Import backtest CSV trades into the forex-ai-agent database.
 *
 * Usage:
 *   npm run import:backtest -- --file ./data/backtest-sample.csv --format manual
 *   npm run import:backtest -- --file ./data/mt4.csv --format mt4 --timeframe 1h --strategy "EMA Cross"
 *
 * Options:
 *   --file            Path to CSV file (required)
 *   --format          CSV format: manual (default) | mt4
 *   --user-id         Target user UUID (defaults to env DEFAULT_USER_ID)
 *   --strategy        Strategy name prefix for MT4 format userReason (default: "Backtest")
 *   --timeframe       Fallback timeframe for MT4 format: 5m|15m|1h|4h|1d (default: 1h)
 *   --dry-run         Preview parsed trades without inserting into DB
 *   --skip-indicators Skip TwelveData indicator fetch (faster, no API calls)
 *   --batch-delay     Milliseconds to wait between trades (default: 300)
 */

import 'dotenv/config';
import * as path from 'path';
import { env } from '../src/config/env';
import { query } from '../src/db/connection';
import { Mt4CsvParser, ParsedBacktestTrade } from '../src/importers/Mt4CsvParser';
import { ManualBacktestParser } from '../src/importers/ManualBacktestParser';
import { HistoricalIndicatorFetcher } from '../src/importers/HistoricalIndicatorFetcher';
import { EmbeddingService } from '../src/services/EmbeddingService';
import { ClaudeAiService } from '../src/services/ClaudeAiService';
import { CreateTradeLogInput, CloseTradeInput, TradeLog } from '../src/types/trade';
import { Timeframe, MultiTimeframeIndicators } from '../src/types/market';

// ─── CLI argument parsing ─────────────────────────────────────────────────────

function parseArgs(): {
  file: string;
  format: 'manual' | 'mt4';
  userId: string;
  strategy: string;
  timeframe: Timeframe;
  dryRun: boolean;
  skipIndicators: boolean;
  batchDelay: number;
} {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };
  const has = (flag: string): boolean => args.includes(flag);

  const file = get('--file');
  if (!file) {
    console.error('❌ --file is required. Example: --file ./data/backtest.csv');
    process.exit(1);
  }

  const timeframeRaw = get('--timeframe') ?? '1h';
  const validTimeframes: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];
  if (!validTimeframes.includes(timeframeRaw as Timeframe)) {
    console.error(`❌ Invalid --timeframe "${timeframeRaw}". Valid: ${validTimeframes.join(', ')}`);
    process.exit(1);
  }

  const formatRaw = get('--format') ?? 'manual';
  if (formatRaw !== 'manual' && formatRaw !== 'mt4') {
    console.error(`❌ Invalid --format "${formatRaw}". Valid: manual, mt4`);
    process.exit(1);
  }

  return {
    file: path.resolve(file),
    format: formatRaw as 'manual' | 'mt4',
    userId: get('--user-id') ?? env.DEFAULT_USER_ID,
    strategy: get('--strategy') ?? 'Backtest',
    timeframe: timeframeRaw as Timeframe,
    dryRun: has('--dry-run'),
    skipIndicators: has('--skip-indicators'),
    batchDelay: parseInt(get('--batch-delay') ?? '300', 10),
  };
}

// ─── Duplicate check ──────────────────────────────────────────────────────────

async function isDuplicate(
  userId: string,
  symbol: string,
  direction: string,
  entryTime: Date
): Promise<boolean> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM trade_logs
     WHERE user_id = $1 AND symbol = $2 AND direction = $3
       AND entry_time = $4 AND source = 'backtest'`,
    [userId, symbol, direction, entryTime]
  );
  return parseInt(result.rows[0].count, 10) > 0;
}

// ─── Insert trade + result directly (status=closed, source=backtest) ──────────

async function insertBacktestTrade(
  userId: string,
  tradeInput: CreateTradeLogInput,
  indicators: MultiTimeframeIndicators,
  embedding: number[],
  trade: ParsedBacktestTrade
): Promise<string> {
  const embeddingStr = `[${embedding.join(',')}]`;

  const tradeResult = await query<{ id: string }>(
    `INSERT INTO trade_logs
       (user_id, symbol, direction, timeframe,
        entry_price, tp_price, sl_price, entry_time,
        user_reason, indicators_used, user_analysis,
        market_snapshot, indicators_snapshot,
        ai_market_comment, embedding, status, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::vector,'closed','backtest')
     RETURNING id`,
    [
      userId,
      tradeInput.symbol,
      tradeInput.direction,
      tradeInput.timeframe,
      tradeInput.entryPrice,
      trade.tpPrice || null,
      trade.slPrice || null,
      tradeInput.entryTime,
      tradeInput.userReason,
      JSON.stringify(tradeInput.indicatorsUsed),
      null,  // userAnalysis
      JSON.stringify({}),
      JSON.stringify(indicators),
      null,  // aiMarketComment (no real-time context for backtest)
      embeddingStr,
    ]
  );
  return tradeResult.rows[0].id;
}

async function insertBacktestResult(
  tradeLogId: string,
  trade: ParsedBacktestTrade,
  aiLesson: string,
  aiPatternTags: string[]
): Promise<void> {
  const closeInput: CloseTradeInput = {
    result: trade.result,
    exitPrice: trade.exitPrice,
    exitTime: trade.exitTime,
    pips: trade.pips,
    profitUsd: trade.profitUsd,
    userExitReason: `[backtest] ${trade.result} ${trade.pips > 0 ? '+' : ''}${trade.pips.toFixed(1)} pips`,
  };

  await query(
    `INSERT INTO trade_results
       (trade_log_id, result, exit_price, exit_time, pips, profit_usd,
        exit_market_snapshot, exit_indicators_snapshot,
        user_exit_reason, user_lesson, ai_lesson, ai_pattern_tags)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      tradeLogId,
      closeInput.result,
      closeInput.exitPrice,
      closeInput.exitTime,
      closeInput.pips,
      closeInput.profitUsd,
      JSON.stringify({}),
      JSON.stringify({}),
      closeInput.userExitReason,
      null,
      aiLesson,
      JSON.stringify(aiPatternTags),
    ]
  );
}

// ─── Build a minimal TradeLog for AI lesson generation ────────────────────────

function buildMockTradeLog(
  trade: ParsedBacktestTrade,
  indicators: MultiTimeframeIndicators
): TradeLog {
  return {
    id: 'backtest-mock',
    userId: '',
    symbol: trade.symbol,
    direction: trade.direction,
    timeframe: trade.timeframe,
    entryPrice: trade.entryPrice,
    tpPrice: trade.tpPrice,
    slPrice: trade.slPrice,
    entryTime: trade.entryTime,
    userReason: trade.userReason,
    indicatorsUsed: [],
    userAnalysis: null,
    marketSnapshot: null,
    indicatorsSnapshot: indicators,
    aiMarketComment: null,
    embedding: null,
    status: 'closed',
    createdAt: trade.entryTime,
  };
}

// ─── Progress display helpers ─────────────────────────────────────────────────

function printProgress(current: number, total: number, symbol: string, result: string): void {
  const pct = Math.round((current / total) * 100);
  const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
  const resultIcon = result === 'WIN' ? '✅' : result === 'LOSS' ? '❌' : '⚪';
  process.stdout.write(`\r[${bar}] ${pct}% (${current}/${total}) ${resultIcon} ${symbol}   `);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();

  console.log('🔄 Forex AI Agent — Backtest Import');
  console.log('─'.repeat(50));
  console.log(`📁 File:        ${opts.file}`);
  console.log(`� Format:      ${opts.format}`);
  console.log(`👤 User ID:     ${opts.userId}`);
  if (opts.format === 'mt4') {
    console.log(`📋 Strategy:    ${opts.strategy}`);
    console.log(`⏱  Timeframe:   ${opts.timeframe}`);
  }
  console.log(`🏃 Dry run:     ${opts.dryRun ? 'YES (no DB writes)' : 'NO'}`);
  console.log(`📊 Indicators:  ${opts.skipIndicators ? 'SKIPPED' : 'fetching from TwelveData'}`);
  console.log(`⏳ Batch delay: ${opts.batchDelay}ms`);
  console.log('─'.repeat(50));

  // 1. Parse CSV
  console.log('\n📂 Parsing CSV...');
  let trades: ParsedBacktestTrade[];
  let parseErrors: string[];

  if (opts.format === 'manual') {
    const parser = new ManualBacktestParser();
    ({ trades, errors: parseErrors } = parser.parse(opts.file));
  } else {
    const parser = new Mt4CsvParser({ timeframe: opts.timeframe, strategyName: opts.strategy });
    ({ trades, errors: parseErrors } = await parser.parse(opts.file));
  }

  if (parseErrors.length > 0) {
    console.warn(`\n⚠️  Parse warnings (${parseErrors.length}):`);
    parseErrors.forEach(e => console.warn(`   ${e}`));
  }

  if (trades.length === 0) {
    console.error('❌ No trades parsed from CSV. Check the file format.');
    process.exit(1);
  }

  console.log(`✅ Parsed ${trades.length} trades`);

  // 2. Dry run preview
  if (opts.dryRun) {
    console.log('\n📋 DRY RUN — Preview (first 10 trades):');
    console.log('─'.repeat(80));
    trades.slice(0, 10).forEach((t, i) => {
      const rr = t.slPrice
        ? `RR:${(Math.abs(t.tpPrice - t.entryPrice) / Math.abs(t.entryPrice - t.slPrice)).toFixed(2)}`
        : 'RR:N/A';
      console.log(
        `${String(i + 1).padStart(3)}. ${t.symbol} ${t.direction} @ ${t.entryPrice} ` +
        `→ ${t.exitPrice} | ${t.result} ${t.pips > 0 ? '+' : ''}${t.pips.toFixed(1)}p` +
        ` $${t.profitUsd.toFixed(2)} | ${t.timeframe} ${rr}`
      );
    });
    if (trades.length > 10) console.log(`   ... and ${trades.length - 10} more`);
    const wins = trades.filter(t => t.result === 'WIN').length;
    const losses = trades.filter(t => t.result === 'LOSS').length;
    console.log('─'.repeat(80));
    console.log(`📊 Win: ${wins} | Loss: ${losses} | Win Rate: ${((wins / trades.length) * 100).toFixed(1)}%`);
    console.log('\n✅ Dry run complete. Remove --dry-run to import into DB.');
    process.exit(0);
  }

  // 3. Initialize services
  const indicatorFetcher = new HistoricalIndicatorFetcher();
  const embeddingSvc = new EmbeddingService();
  const claudeSvc = new ClaudeAiService();

  // 4. Process each trade
  let imported = 0;
  let skippedDup = 0;
  let failed = 0;
  const failedDetails: string[] = [];

  console.log(`\n📥 Importing ${trades.length} trades...\n`);

  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i];
    printProgress(i, trades.length, trade.symbol, trade.result);

    try {
      // Duplicate check
      const dup = await isDuplicate(opts.userId, trade.symbol, trade.direction, trade.entryTime);
      if (dup) {
        skippedDup++;
        continue;
      }

      // Fetch indicators
      const { indicators } = await indicatorFetcher.fetch(trade.symbol, opts.skipIndicators);

      // Build CreateTradeLogInput for embedding
      const tradeInput: CreateTradeLogInput = {
        symbol: trade.symbol,
        direction: trade.direction,
        timeframe: trade.timeframe,
        entryPrice: trade.entryPrice,
        tpPrice: trade.tpPrice,
        slPrice: trade.slPrice,
        entryTime: trade.entryTime,
        userReason: trade.userReason,
        indicatorsUsed: [],
      };

      // Generate embedding
      const embedding = await embeddingSvc.createTradeEmbedding(tradeInput, indicators);

      // Generate AI lesson
      const mockTradeLog = buildMockTradeLog(trade, indicators);
      const closeInput: CloseTradeInput = {
        result: trade.result,
        exitPrice: trade.exitPrice,
        exitTime: trade.exitTime,
        pips: trade.pips,
        profitUsd: trade.profitUsd,
        userExitReason: `[backtest] ${trade.result}`,
      };
      const { lesson: aiLesson, patternTags } = await claudeSvc.summarizeLesson(
        mockTradeLog,
        closeInput,
        indicators
      );

      // Insert trade log + result
      const tradeLogId = await insertBacktestTrade(
        opts.userId, tradeInput, indicators, embedding, trade
      );
      await insertBacktestResult(tradeLogId, trade, aiLesson, patternTags);

      imported++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      failedDetails.push(`Trade ${i + 1} (${trade.symbol} ${trade.direction} ${trade.entryTime.toISOString()}): ${msg}`);
    }

    // Batch delay to avoid rate-limiting TwelveData / OpenAI / Claude
    if (opts.batchDelay > 0) await sleep(opts.batchDelay);
  }

  // 5. Summary
  printProgress(trades.length, trades.length, 'Done', 'WIN');
  console.log('\n\n' + '─'.repeat(50));
  console.log('📊 Import Summary');
  console.log('─'.repeat(50));
  console.log(`✅ Imported:        ${imported}`);
  console.log(`⏭  Skipped (dup):   ${skippedDup}`);
  console.log(`❌ Failed:          ${failed}`);
  console.log(`📁 Total in CSV:    ${trades.length}`);

  if (failedDetails.length > 0) {
    console.log('\n❌ Failed trades:');
    failedDetails.forEach(d => console.log(`   ${d}`));
  }

  if (imported > 0) {
    console.log(`\n✅ Done! ${imported} backtest trades are now available for similarity search.`);
    console.log('   Verify with: SELECT COUNT(*) FROM trade_logs WHERE source = \'backtest\';');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
