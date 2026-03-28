import { TradeLoggerResponse } from '../types/agent';
import { AnalyzeResponse } from '../types/agent';
import { TradeLog } from '../types/trade';

// Telegram MarkdownV2 requires escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
function escape(text: string | number | null | undefined): string {
  if (text === null || text === undefined) return '—';
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function escapeRaw(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

// ─── Trade Logged ─────────────────────────────────────────────────────────────

export function formatTradeLogged(result: TradeLoggerResponse): string {
  const d = result.data;
  if (!d || !result.success) {
    return `❌ บันทึก trade ไม่สำเร็จ: ${escape(result.message)}`;
  }

  const indicators = d.indicators?.['1h'] ?? d.indicators?.['4h'] ?? d.indicators?.['5m'];
  const rsiLine = indicators?.rsi_14
    ? `\n📉 RSI\\(1h\\): *${escape(indicators.rsi_14.toFixed(1))}*`
    : '';

  return [
    `✅ *บันทึก Trade สำเร็จ*`,
    ``,
    `🆔 ID: \`${escape(d.tradeId)}\``,
    ``,
    `📊 *Market Comment:*`,
    escapeRaw(truncate(stripMarkdown(d.aiMarketComment ?? ''), 600)),
    rsiLine,
  ].join('\n');
}

// ─── Trade Closed ─────────────────────────────────────────────────────────────

export function formatTradeClosed(result: { success: boolean; message: string; data?: { aiLesson: string } }): string {
  if (!result.success) {
    return `❌ ปิด trade ไม่สำเร็จ: ${escape(result.message)}`;
  }
  const lesson = result.data?.aiLesson ?? '';
  return [
    `🏁 *ปิด Trade สำเร็จ*`,
    ``,
    `💡 *AI Lesson:*`,
    escapeRaw(truncate(stripMarkdown(lesson), 700)),
  ].join('\n');
}

// ─── Analysis ─────────────────────────────────────────────────────────────────

const RECOMMENDATION_EMOJI: Record<string, string> = {
  BUY: '🟢', SELL: '🔴', WAIT: '🟡', HOLD: '🔵',
};

export function formatAnalysis(response: AnalyzeResponse): string {
  if (!response.success || !response.data) {
    return `❌ วิเคราะห์ไม่สำเร็จ: ${escape(response.message)}`;
  }
  const d = response.data;
  const rec = d.recommendation ?? 'UNKNOWN';
  const emoji = RECOMMENDATION_EMOJI[rec] ?? '⚪';
  const confidencePct = Math.round((d.confidence ?? 0) * 100);
  const wins = d.winRate != null ? `${d.winRate}%` : '—';

  const similarSection = d.similarTrades?.length
    ? `\n\n🔁 *Similar Past Trades:* ${escape(d.similarTrades.length)} รายการ \\(win rate ${escape(wins)}\\)`
    : '';

  const tp = d.suggestedTp ? `TP: ${escape(d.suggestedTp)}` : null;
  const sl = d.suggestedSl ? `SL: ${escape(d.suggestedSl)}` : null;
  const levels = [tp, sl].filter(Boolean).join(' \\| ');
  const levelsLine = levels ? `\n🎯 ${levels}` : '';

  const analysis = escapeRaw(truncate(stripMarkdown(d.aiAnalysis ?? ''), 800));

  return [
    `${emoji} *${escape(d.symbol)} ${escape(d.timeframe)} — ${escape(rec)}*`,
    `📊 Confidence: *${escape(confidencePct)}%* \\| Risk Score: *${escape(d.riskScore)}*`,
    levelsLine,
    ``,
    `📝 *AI Analysis:*`,
    analysis,
    similarSection,
  ].filter(s => s !== null).join('\n');
}

// ─── Open Trades List (for inline keyboard captions) ────────────────────────

export function formatOpenTradeItem(trade: TradeLog, index: number): string {
  return `${index + 1}. ${trade.symbol} ${trade.direction} ${trade.timeframe} @ ${trade.entryPrice}`;
}

export function formatOpenTradesList(trades: TradeLog[]): string {
  if (!trades.length) return '📭 ไม่พบ open trade ที่ยังค้างอยู่';
  const lines = trades.map((t, i) => escape(formatOpenTradeItem(t, i)));
  return `📋 *เลือก trade ที่ต้องการปิด:*\n\n${lines.join('\n')}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

/** Strip markdown formatting characters from a string before re-escaping for MarkdownV2 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')  // bold
    .replace(/\*(.*?)\*/g, '$1')       // italic
    .replace(/`{1,3}([\s\S]*?)`{1,3}/g, '$1') // code
    .replace(/^#{1,6}\s+/gm, '')      // headings
    .replace(/^\s*[-*+]\s+/gm, '• ')  // bullets
    .trim();
}
