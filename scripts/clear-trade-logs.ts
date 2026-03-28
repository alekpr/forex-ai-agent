/**
 * scripts/clear-trade-logs.ts
 *
 * Safely delete trade_logs (and their associated trade_results) from the database.
 * Supports filtering by symbol, date range, status, and source.
 *
 * Usage:
 *   npm run clear:trades -- --symbol EURUSD
 *   npm run clear:trades -- --symbol XAUUSD --from 2024-01-01 --to 2024-03-31
 *   npm run clear:trades -- --from 2024-01-01 --to 2024-01-31 --source backtest
 *   npm run clear:trades -- --symbol GBPUSD --status open
 *   npm run clear:trades -- --all                          # ⚠️ clears ALL trades
 *
 * Options:
 *   --symbol    Currency pair to clear (e.g. EURUSD, XAUUSD). Omit for all symbols.
 *   --from      Start date inclusive (YYYY-MM-DD). Filters by entry_time.
 *   --to        End date inclusive (YYYY-MM-DD). Filters by entry_time.
 *   --status    Filter by status: open | closed. Omit for both.
 *   --source    Filter by source: live | backtest. Omit for both.
 *   --all       Required flag when no symbol/date filter is set (safety guard).
 *   --dry-run   Preview what would be deleted without actually deleting.
 *   --yes       Skip confirmation prompt (use in scripts/CI).
 */

import 'dotenv/config';
import * as readline from 'readline';
import { query } from '../src/db/connection';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClearOptions {
  symbol?: string;
  from?: Date;
  to?: Date;
  status?: 'open' | 'closed';
  source?: 'live' | 'backtest';
  all: boolean;
  dryRun: boolean;
  autoYes: boolean;
}

interface TradePreview {
  id: string;
  symbol: string;
  direction: string;
  timeframe: string;
  entry_time: Date;
  status: string;
  source: string;
  has_result: boolean;
}

// ─── CLI argument parsing ─────────────────────────────────────────────────────

function parseArgs(): ClearOptions {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };
  const has = (flag: string): boolean => args.includes(flag);

  const symbolRaw = get('--symbol');
  const fromRaw   = get('--from');
  const toRaw     = get('--to');
  const statusRaw = get('--status');
  const sourceRaw = get('--source');

  // Validate status
  if (statusRaw && statusRaw !== 'open' && statusRaw !== 'closed') {
    console.error(`❌ --status must be "open" or "closed", got: "${statusRaw}"`);
    process.exit(1);
  }

  // Validate source
  if (sourceRaw && sourceRaw !== 'live' && sourceRaw !== 'backtest') {
    console.error(`❌ --source must be "live" or "backtest", got: "${sourceRaw}"`);
    process.exit(1);
  }

  // Parse and validate dates
  let fromDate: Date | undefined;
  let toDate: Date | undefined;

  if (fromRaw) {
    fromDate = new Date(`${fromRaw}T00:00:00`);
    if (isNaN(fromDate.getTime())) {
      console.error(`❌ --from "${fromRaw}" is not a valid date. Use YYYY-MM-DD format.`);
      process.exit(1);
    }
  }
  if (toRaw) {
    toDate = new Date(`${toRaw}T23:59:59`);
    if (isNaN(toDate.getTime())) {
      console.error(`❌ --to "${toRaw}" is not a valid date. Use YYYY-MM-DD format.`);
      process.exit(1);
    }
  }
  if (fromDate && toDate && fromDate > toDate) {
    console.error(`❌ --from date must be before or equal to --to date.`);
    process.exit(1);
  }

  const all = has('--all');
  const hasFilter = symbolRaw || fromRaw || toRaw || statusRaw || sourceRaw;

  // Safety guard: require --all when no filter is specified
  if (!hasFilter && !all) {
    console.error(
      '❌ No filters specified. To clear ALL trades, use --all flag explicitly.\n' +
      '   Example: npm run clear:trades -- --all --dry-run'
    );
    process.exit(1);
  }

  return {
    symbol: symbolRaw?.toUpperCase(),
    from: fromDate,
    to: toDate,
    status: statusRaw as 'open' | 'closed' | undefined,
    source: sourceRaw as 'live' | 'backtest' | undefined,
    all,
    dryRun: has('--dry-run'),
    autoYes: has('--yes'),
  };
}

// ─── Build WHERE clause ───────────────────────────────────────────────────────

function buildWhereClause(opts: ClearOptions): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.symbol) {
    params.push(opts.symbol);
    conditions.push(`tl.symbol = $${params.length}`);
  }
  if (opts.from) {
    params.push(opts.from);
    conditions.push(`tl.entry_time >= $${params.length}`);
  }
  if (opts.to) {
    params.push(opts.to);
    conditions.push(`tl.entry_time <= $${params.length}`);
  }
  if (opts.status) {
    params.push(opts.status);
    conditions.push(`tl.status = $${params.length}`);
  }
  if (opts.source) {
    params.push(opts.source);
    conditions.push(`tl.source = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

// ─── Preview query ────────────────────────────────────────────────────────────

async function previewTrades(opts: ClearOptions): Promise<TradePreview[]> {
  const { where, params } = buildWhereClause(opts);

  const sql = `
    SELECT
      tl.id,
      tl.symbol,
      tl.direction,
      tl.timeframe,
      tl.entry_time,
      tl.status,
      COALESCE(tl.source, 'live') AS source,
      (tr.id IS NOT NULL) AS has_result
    FROM trade_logs tl
    LEFT JOIN trade_results tr ON tl.id = tr.trade_log_id
    ${where}
    ORDER BY tl.symbol, tl.entry_time DESC
  `;

  const result = await query<TradePreview>(sql, params);
  return result.rows;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function deleteTrades(opts: ClearOptions): Promise<number> {
  // Build sub-query to get IDs to delete
  const { where, params } = buildWhereClause(opts);

  // Delete trade_results first (FK constraint), then trade_logs
  const deleteResultsSql = `
    DELETE FROM trade_results
    WHERE trade_log_id IN (
      SELECT tl.id FROM trade_logs tl ${where}
    )
  `;
  await query(deleteResultsSql, params);

  const deleteLogsSql = `
    DELETE FROM trade_logs tl ${where}
  `;
  // PostgreSQL requires alias in DELETE with subquery — use CTE form
  const deleteLogsCteSql = `
    WITH to_delete AS (
      SELECT id FROM trade_logs tl ${where}
    )
    DELETE FROM trade_logs WHERE id IN (SELECT id FROM to_delete)
  `;
  const result = await query(deleteLogsCteSql, params);
  return result.rowCount ?? 0;
}

// ─── Confirmation prompt ──────────────────────────────────────────────────────

async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${message} [y/N] `, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ─── Summary table ────────────────────────────────────────────────────────────

function printSummaryTable(trades: TradePreview[]): void {
  if (trades.length === 0) return;

  // Group by symbol
  const bySymbol: Record<string, { win: number; loss: number; open: number; be: number; backtest: number; live: number }> = {};
  for (const t of trades) {
    if (!bySymbol[t.symbol]) {
      bySymbol[t.symbol] = { win: 0, loss: 0, open: 0, be: 0, backtest: 0, live: 0 };
    }
    if (t.status === 'open') bySymbol[t.symbol].open++;
    if (t.source === 'backtest') bySymbol[t.symbol].backtest++;
    else bySymbol[t.symbol].live++;
  }

  console.log('\n┌─────────────┬────────┬────────┬──────────┐');
  console.log('│ Symbol      │ Count  │ Status │ Source   │');
  console.log('├─────────────┼────────┼────────┼──────────┤');
  for (const [sym, counts] of Object.entries(bySymbol)) {
    const total = counts.live + counts.backtest;
    const statusStr = counts.open > 0 ? `${counts.open} open` : 'all closed';
    const sourceStr = counts.backtest > 0 && counts.live > 0
      ? 'mixed'
      : counts.backtest > 0 ? 'backtest' : 'live';
    console.log(`│ ${sym.padEnd(11)} │ ${String(total).padEnd(6)} │ ${statusStr.padEnd(6)} │ ${sourceStr.padEnd(8)} │`);
  }
  console.log('└─────────────┴────────┴────────┴──────────┘');

  const withResults  = trades.filter(t => t.has_result).length;
  const withoutResults = trades.length - withResults;
  console.log(`\n📊 Total: ${trades.length} trade_logs`);
  if (withResults > 0)    console.log(`   ├ With trade_results (will also be deleted): ${withResults}`);
  if (withoutResults > 0) console.log(`   └ Without trade_results (open trades): ${withoutResults}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();

  console.log('🗑️  Forex AI Agent — Clear Trade Logs');
  console.log('─'.repeat(50));
  console.log(`📌 Symbol:   ${opts.symbol ?? '(all symbols)'}`);
  console.log(`📅 From:     ${opts.from ? opts.from.toISOString().split('T')[0] : '(no limit)'}`);
  console.log(`📅 To:       ${opts.to   ? opts.to.toISOString().split('T')[0]   : '(no limit)'}`);
  console.log(`📁 Status:   ${opts.status ?? '(all)'}`);
  console.log(`🏷️  Source:   ${opts.source ?? '(all)'}`);
  console.log(`🏃 Dry run:  ${opts.dryRun ? 'YES (no DB changes)' : 'NO'}`);
  console.log('─'.repeat(50));

  // Preview matching trades
  console.log('\n🔍 Searching for matching trades...');
  const trades = await previewTrades(opts);

  if (trades.length === 0) {
    console.log('✅ No trades found matching the criteria. Nothing to delete.');
    process.exit(0);
  }

  printSummaryTable(trades);

  if (opts.dryRun) {
    // Show detailed list in dry-run mode
    console.log('\n📋 Trades that WOULD be deleted (first 20):');
    console.log('─'.repeat(75));
    trades.slice(0, 20).forEach((t, i) => {
      const date = new Date(t.entry_time).toISOString().split('T')[0];
      const resultMark = t.has_result ? '📋' : '  ';
      const source = t.source === 'backtest' ? '[BT]' : '[LV]';
      console.log(
        `${String(i + 1).padStart(3)}. ${resultMark} ${source} ${t.symbol.padEnd(8)} ` +
        `${t.direction.padEnd(5)} ${t.timeframe.padEnd(4)} ${date} ${t.status}`
      );
    });
    if (trades.length > 20) console.log(`   ... and ${trades.length - 20} more`);
    console.log('\n✅ Dry run complete. Remove --dry-run to actually delete.');
    process.exit(0);
  }

  // Confirm before delete
  if (!opts.autoYes) {
    console.log('\n⚠️  This will PERMANENTLY delete the trades listed above.');
    const ok = await confirm('Are you sure you want to proceed?');
    if (!ok) {
      console.log('❌ Cancelled.');
      process.exit(0);
    }
  }

  // Execute delete
  console.log('\n🗑️  Deleting...');
  const deleted = await deleteTrades(opts);
  console.log(`✅ Successfully deleted ${deleted} trade log(s) and their associated results.`);
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
