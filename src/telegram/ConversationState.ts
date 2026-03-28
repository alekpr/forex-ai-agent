import { TradeLog } from '../types/trade';

export type ConversationIntent = 'LOG_TRADE' | 'CLOSE_TRADE' | 'ANALYZE';

// Fields collected during a multi-turn conversation
export interface LogTradeData {
  symbol?: string;
  direction?: 'BUY' | 'SELL';
  timeframe?: string;
  entryPrice?: number;
  tpPrice?: number;
  slPrice?: number;
  entryTime?: string;
  userReason?: string;
  indicatorsUsed?: string[];
  userAnalysis?: string;
}

export interface CloseTradeData {
  tradeId?: string;   // resolved after user picks from inline keyboard
  result?: 'WIN' | 'LOSS' | 'BREAKEVEN';
  exitPrice?: number;
  pips?: number;
  profitUsd?: number;
  userExitReason?: string;
  userLesson?: string;
}

export interface AnalyzeData {
  symbol?: string;
  timeframe?: string;
  riskLevel?: 'low' | 'medium' | 'high';
}

export type CollectedData = LogTradeData | CloseTradeData | AnalyzeData;

export interface ConversationSession {
  intent: ConversationIntent;
  // Ordered list of field names still to be asked
  pendingFields: string[];
  // What has been filled so far
  collectedData: CollectedData;
  // Snapshot of open trades shown in inline keyboard (CLOSE_TRADE only)
  openTrades?: TradeLog[];
  lastActivity: number; // Date.now()
}

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

export class ConversationStateManager {
  private readonly sessions = new Map<number, ConversationSession>();

  constructor() {
    // Purge stale sessions every 5 minutes
    setInterval(() => this.purgeStale(), 5 * 60 * 1000);
  }

  get(userId: number): ConversationSession | undefined {
    const session = this.sessions.get(userId);
    if (!session) return undefined;
    if (Date.now() - session.lastActivity > SESSION_TTL_MS) {
      this.sessions.delete(userId);
      return undefined;
    }
    return session;
  }

  set(userId: number, session: ConversationSession): void {
    session.lastActivity = Date.now();
    this.sessions.set(userId, session);
  }

  update(userId: number, patch: Partial<ConversationSession>): ConversationSession | undefined {
    const session = this.get(userId);
    if (!session) return undefined;
    const updated = { ...session, ...patch, lastActivity: Date.now() };
    this.sessions.set(userId, updated);
    return updated;
  }

  clear(userId: number): void {
    this.sessions.delete(userId);
  }

  private purgeStale(): void {
    const now = Date.now();
    for (const [userId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        this.sessions.delete(userId);
      }
    }
  }
}

// ─── Field definitions ───────────────────────────────────────────────────────

export const LOG_TRADE_FIELDS: { key: keyof LogTradeData; question: string }[] = [
  { key: 'symbol',     question: '📌 *คู่เงินคืออะไร?*\nเช่น EURUSD, GBPUSD, XAUUSD' },
  { key: 'direction',  question: '📈 *ทิศทาง — BUY หรือ SELL?*' },
  { key: 'timeframe',  question: '⏱ *Timeframe ที่เทรด?*\nเลือก: 5m / 15m / 1h / 4h / 1d' },
  { key: 'entryPrice', question: '💰 *ราคาเปิด (Entry price)?*' },
  { key: 'tpPrice',    question: '🎯 *ราคา Take Profit (TP)?*' },
  { key: 'slPrice',    question: '🛑 *ราคา Stop Loss (SL)?*' },
  { key: 'userReason', question: '📝 *เหตุผลที่เข้า trade?\n*(เช่น EMA cross, RSI oversold, breakout pattern)*' },
];

export const CLOSE_TRADE_FIELDS: { key: keyof CloseTradeData; question: string }[] = [
  { key: 'result',        question: '🏁 *ผลการเทรด?*\nตอบ: WIN / LOSS / BREAKEVEN' },
  { key: 'exitPrice',     question: '💰 *ราคาปิด (Exit price)?*' },
  { key: 'pips',          question: '📊 *ได้/เสียกี่ pips?*\n(ใส่เลขติดลบถ้าขาดทุน เช่น -25)' },
  { key: 'profitUsd',     question: '💵 *กำไร/ขาดทุนเป็น USD?*\n(ใส่เลขติดลบถ้าขาดทุน)' },
  { key: 'userExitReason', question: '📝 *เหตุผลที่ปิด trade?*' },
];

export const ANALYZE_FIELDS: { key: keyof AnalyzeData; question: string }[] = [
  { key: 'symbol',    question: '📌 *คู่เงินที่ต้องการวิเคราะห์?*\nเช่น EURUSD, GBPUSD, XAUUSD' },
  { key: 'timeframe', question: '⏱ *Timeframe?*\nเลือก: 5m / 15m / 1h / 4h / 1d' },
];
