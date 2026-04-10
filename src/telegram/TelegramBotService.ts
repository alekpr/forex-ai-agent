import { Telegraf, Context } from 'telegraf';
import { Update, InlineKeyboardButton } from 'telegraf/types';
import { RequestHandler } from 'express';
import { env } from '../config/env';
import { TradeLoggerAgent } from '../agents/TradeLoggerAgent';
import { MarketAnalyzerAgent } from '../agents/MarketAnalyzerAgent';
import { TradeLogRepository } from '../repositories/TradeLogRepository';
import { CreateTradeLogInput, CloseTradeInput, TradeResult, TradeDirection } from '../types/trade';
import { Timeframe } from '../types/market';
import {
  ConversationStateManager,
  LogTradeData, CloseTradeData, AnalyzeData, SummarizeData,
  LOG_TRADE_FIELDS, CLOSE_TRADE_FIELDS, ANALYZE_FIELDS,
} from './ConversationState';
import { routeMessage } from './IntentRouter';
import { formatTradeLogged, formatTradeClosed, formatAnalysis, formatOpenTradeItem, formatTradeSummary } from './formatters';
import { TradeSummaryAgent } from '../agents/TradeSummaryAgent';
import { parseEntryTime } from '../utils/dateParser';

export class TelegramBotService {
  private readonly bot: Telegraf<Context<Update>>;
  private readonly allowedUserIds: Set<number>;
  private readonly state: ConversationStateManager;
  private readonly tradeAgent: TradeLoggerAgent;
  private readonly analyzeAgent: MarketAnalyzerAgent;
  private readonly tradeRepo: TradeLogRepository;
  private readonly summaryAgent: TradeSummaryAgent;

  constructor() {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');

    this.bot = new Telegraf(token);
    this.allowedUserIds = this.parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS);
    this.state = new ConversationStateManager();
    this.tradeAgent = new TradeLoggerAgent();
    this.analyzeAgent = new MarketAnalyzerAgent();
    this.tradeRepo = new TradeLogRepository();
    this.summaryAgent = new TradeSummaryAgent();

    this.registerHandlers();
  }

  /** Returns Express-compatible middleware for the webhook route */
  getMiddleware(): RequestHandler {
    // Pass '/' because Express already strips the mount path prefix
    return this.bot.webhookCallback('/');
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  private registerHandlers(): void {
    this.bot.command('start', async (ctx) => {
      if (!this.isAllowed(ctx)) return;
      await ctx.reply(
        `👋 ยินดีต้อนรับสู่ Forex AI Trading Bot\n\n` +
        `บอทนี้ช่วยได้ 4 อย่าง:\n` +
        `📝 บันทึก trade — พิมพ์ เช่น "บันทึก trade EURUSD BUY 1h"\n` +
        `🏁 ปิด trade — พิมพ์ "ปิด trade"\n` +
        `📊 วิเคราะห์ตลาด — พิมพ์ เช่น "วิเคราะห์ EURUSD 1h"\n` +
        `📈 สรุปผลการเทรด — พิมพ์ "สรุปอาทิตย์นี้" หรือ /summary\n\n` +
        `พิมพ์ /cancel เพื่อยกเลิกคำสั่งปัจจุบัน`
      );
    });

    this.bot.command('summary', async (ctx) => {
      if (!this.isAllowed(ctx)) return;
      await ctx.reply('📈 เลือกช่วงเวลาที่ต้องการสรุป:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📅 วันนี้', callback_data: 'summary_period:today' }, { text: '📆 อาทิตย์นี้', callback_data: 'summary_period:week' }],
            [{ text: '🗓 เดือนนี้', callback_data: 'summary_period:month' }, { text: '📊 30 วันล่าสุด', callback_data: 'summary_period:last30' }],
          ],
        },
      });
    });

    this.bot.command('cancel', async (ctx) => {
      if (!this.isAllowed(ctx)) return;
      const userId = ctx.from!.id;
      if (this.state.get(userId)) {
        this.state.clear(userId);
        await ctx.reply('✅ ยกเลิกคำสั่งปัจจุบันแล้ว');
      } else {
        await ctx.reply('ไม่มีคำสั่งที่กำลังดำเนินอยู่');
      }
    });

    this.bot.on('text', async (ctx) => {
      if (!this.isAllowed(ctx)) return;
      await this.handleTextMessage(ctx);
    });

    this.bot.on('callback_query', async (ctx) => {
      if (!this.isAllowed(ctx)) return;
      await ctx.answerCbQuery();
      await this.handleCallbackQuery(ctx);
    });
  }

  // ─── Text message entry point ─────────────────────────────────────────────

  private async handleTextMessage(ctx: Context<Update>): Promise<void> {
    if (!ctx.from || !('text' in ctx.message!)) return;
    const userId = ctx.from.id;
    const text = (ctx.message as { text: string }).text.trim();

    const session = this.state.get(userId);

    if (session) {
      // Continuing an active multi-turn conversation
      switch (session.intent) {
        case 'LOG_TRADE':   return this.continueLogTrade(ctx, userId, text);
        case 'CLOSE_TRADE': return this.continueCloseTrade(ctx, userId, text);
        case 'ANALYZE':     return this.continueAnalyze(ctx, userId, text);
        case 'SUMMARIZE':   return this.executeSummary(ctx, session.collectedData as SummarizeData);
      }
    }

    // New message — classify intent
    await ctx.reply('⏳ กำลังวิเคราะห์...');
    const result = await routeMessage(text);

    if (result.intent === 'UNKNOWN') {
      await ctx.reply(result.reply, { parse_mode: 'Markdown' });
      return;
    }

    // Determine pendingFields = fields not yet extracted by Claude
    const pendingFields = this.computePendingFields(result.intent, result.data as Record<string, unknown>);

    // For CLOSE_TRADE: if Claude already extracted a tradeId, load snapshot now
    let tradeSnapshot = undefined;
    if (result.intent === 'CLOSE_TRADE' && (result.data as CloseTradeData).tradeId) {
      tradeSnapshot = await this.tradeRepo.findById((result.data as CloseTradeData).tradeId!).catch(() => null) ?? undefined;
    }

    this.state.set(userId, {
      intent: result.intent,
      collectedData: result.data,
      pendingFields,
      tradeSnapshot,
      lastActivity: Date.now(),
    });

    if (pendingFields.length === 0) {
      // All fields present — execute immediately
      await this.executeAction(ctx, userId);
    } else {
      await this.askNextField(ctx, userId);
    }
  }

  // ─── Multi-turn: LOG_TRADE ─────────────────────────────────────────────────

  private async continueLogTrade(ctx: Context<Update>, userId: number, text: string): Promise<void> {
    const session = this.state.get(userId)!;
    const data = session.collectedData as LogTradeData;
    const fieldKey = session.pendingFields[0] as keyof LogTradeData;

    const parsed = this.parseLogTradeField(fieldKey, text);
    if (parsed === null) {
      await ctx.reply(`❌ ค่าไม่ถูกต้อง กรุณากรอกใหม่`);
      return;
    }

    (data as Record<string, unknown>)[fieldKey] = parsed;
    const remaining = session.pendingFields.slice(1);

    this.state.update(userId, { collectedData: data, pendingFields: remaining });

    if (remaining.length === 0) {
      await this.executeAction(ctx, userId);
    } else {
      await this.askNextField(ctx, userId);
    }
  }

  // ─── Multi-turn: CLOSE_TRADE ───────────────────────────────────────────────

  private async continueCloseTrade(ctx: Context<Update>, userId: number, text: string): Promise<void> {
    const session = this.state.get(userId)!;
    const data = session.collectedData as CloseTradeData;

    if (!data.tradeId) {
      // tradeId not set yet — user should reply via inline keyboard
      await this.showOpenTradesKeyboard(ctx, userId);
      return;
    }

    const fieldKey = session.pendingFields[0] as keyof CloseTradeData;

    // Resolve "TP" / "SL" keywords to actual prices from the trade snapshot
    let resolvedText = text;
    if (fieldKey === 'exitPrice') {
      const snap = session.tradeSnapshot;
      const upper = text.trim().toUpperCase();
      if (upper === 'TP' && snap?.tpPrice) resolvedText = String(snap.tpPrice);
      else if (upper === 'SL' && snap?.slPrice) resolvedText = String(snap.slPrice);
    }

    const parsed = this.parseCloseTradeField(fieldKey, resolvedText);
    if (parsed === null) {
      await ctx.reply(`❌ ค่าไม่ถูกต้อง กรุณากรอกใหม่`);
      return;
    }

    (data as Record<string, unknown>)[fieldKey] = parsed;
    let remaining = session.pendingFields.slice(1);

    // After exitPrice is set, auto-calculate pips and profitUsd from the trade snapshot
    if (fieldKey === 'exitPrice') {
      const snap = session.tradeSnapshot;
      if (snap) {
        const exitPrice = parsed as number;
        const pipMultiplier = snap.symbol.includes('JPY') ? 100 : 10000;
        const rawPips = (exitPrice - snap.entryPrice) * pipMultiplier;
        const pips = snap.direction === 'BUY' ? rawPips : -rawPips;
        data.pips = Math.round(pips * 10) / 10;
        data.profitUsd = Math.round(pips * 1) / 10; // approximate; no lot size known
        await ctx.reply(`🧮 คำนวณอัตโนมัติ: ${pips >= 0 ? '+' : ''}${data.pips} pips`);
      }
    }

    this.state.update(userId, { collectedData: data, pendingFields: remaining });

    if (remaining.length === 0) {
      await this.executeAction(ctx, userId);
    } else {
      await this.askNextField(ctx, userId);
    }
  }

  // ─── Multi-turn: ANALYZE ───────────────────────────────────────────────────

  private async continueAnalyze(ctx: Context<Update>, userId: number, text: string): Promise<void> {
    const session = this.state.get(userId)!;
    const data = session.collectedData as AnalyzeData;
    const fieldKey = session.pendingFields[0] as keyof AnalyzeData;

    const parsed = this.parseAnalyzeField(fieldKey, text);
    if (parsed === null) {
      await ctx.reply(`❌ ค่าไม่ถูกต้อง กรุณากรอกใหม่`);
      return;
    }

    (data as Record<string, unknown>)[fieldKey] = parsed;
    const remaining = session.pendingFields.slice(1);
    this.state.update(userId, { collectedData: data, pendingFields: remaining });

    if (remaining.length === 0) {
      await this.executeAction(ctx, userId);
    } else {
      await this.askNextField(ctx, userId);
    }
  }

  // ─── Callback: Inline keyboard trade selection ────────────────────────────

  private async handleCallbackQuery(ctx: Context<Update>): Promise<void> {
    const cbQuery = ctx.callbackQuery;
    if (!cbQuery || !('data' in cbQuery)) return;

    const userId = cbQuery.from.id;
    const callbackData = cbQuery.data;

    if (callbackData.startsWith('close_result:')) {
      const tradeResult = callbackData.replace('close_result:', '') as 'WIN' | 'LOSS' | 'BREAKEVEN';
      const session = this.state.get(userId);
      if (!session || session.intent !== 'CLOSE_TRADE') return;

      const data = session.collectedData as CloseTradeData;
      data.result = tradeResult;
      const remaining = session.pendingFields.filter(f => f !== 'result');
      this.state.update(userId, { collectedData: data, pendingFields: remaining });

      if (remaining.length === 0) {
        await this.executeAction(ctx, userId);
      } else {
        await this.askNextField(ctx, userId);
      }
      return;
    }

    if (callbackData.startsWith('summary_period:')) {
      const period = callbackData.replace('summary_period:', '') as SummarizeData['period'];
      await this.executeSummary(ctx, { period });
      return;
    }

    if (!callbackData.startsWith('close_trade:')) return;

    const tradeId = callbackData.replace('close_trade:', '');
    const session = this.state.get(userId);
    if (!session || session.intent !== 'CLOSE_TRADE') return;

    const data = session.collectedData as CloseTradeData;
    data.tradeId = tradeId;

    // Load trade snapshot for TP/SL resolution and auto-calc
    const tradeSnapshot = await this.tradeRepo.findById(tradeId).catch(() => null);

    const pendingFields = CLOSE_TRADE_FIELDS.map(f => f.key as string);
    this.state.update(userId, { collectedData: data, pendingFields, tradeSnapshot: tradeSnapshot ?? undefined });

    await this.askNextField(ctx, userId);
  }

  // ─── Execute actions ──────────────────────────────────────────────────────

  private async executeAction(ctx: Context<Update>, userId: number): Promise<void> {
    const session = this.state.get(userId)!;
    this.state.clear(userId);

    try {
      switch (session.intent) {
        case 'LOG_TRADE':   return await this.executeLogTrade(ctx, session.collectedData as LogTradeData);
        case 'CLOSE_TRADE': return await this.executeCloseTrade(ctx, session.collectedData as CloseTradeData);
        case 'ANALYZE':     return await this.executeAnalyze(ctx, session.collectedData as AnalyzeData);
        case 'SUMMARIZE':   return await this.executeSummary(ctx, session.collectedData as SummarizeData);
      }
    } catch (err) {
      console.error('[TelegramBot] executeAction error:', err);
      await ctx.reply('⚠️ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
    }
  }

  private async executeLogTrade(ctx: Context<Update>, data: LogTradeData): Promise<void> {
    await ctx.reply('⏳ กำลังบันทึก trade และดึงข้อมูลตลาด...');

    const parsedEntryTime = parseEntryTime(data.entryTime) ?? new Date();
    const isBackdated = Date.now() - parsedEntryTime.getTime() > 10 * 60 * 1000;
    if (isBackdated) {
      await ctx.reply(
        `⏮️ บันทึก trade ย้อนหลัง: ${parsedEntryTime.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
⏳ กำลังดึง indicators ณ เวลานั้น...`
      );
    }

    const input: CreateTradeLogInput = {
      symbol: data.symbol!.toUpperCase(),
      direction: data.direction! as TradeDirection,
      timeframe: data.timeframe! as Timeframe,
      entryPrice: data.entryPrice!,
      tpPrice: data.tpPrice!,
      slPrice: data.slPrice!,
      entryTime: parsedEntryTime,
      userReason: data.userReason!,
      indicatorsUsed: data.indicatorsUsed ?? [],
      userAnalysis: data.userAnalysis,
    };

    const result = await this.tradeAgent.logTrade(input);
    const msg = formatTradeLogged(result);
    await this.replyMarkdownV2Safe(ctx, msg);
  }

  private async executeCloseTrade(ctx: Context<Update>, data: CloseTradeData): Promise<void> {
    await ctx.reply('⏳ กำลังปิด trade...');

    const input: CloseTradeInput = {
      result: data.result! as TradeResult,
      exitPrice: data.exitPrice!,
      exitTime: new Date(),
      pips: data.pips ?? 0,
      profitUsd: data.profitUsd ?? 0,
      userExitReason: data.userExitReason ?? '',
      userLesson: data.userLesson,
    };

    const result = await this.tradeAgent.closeTrade(data.tradeId!, input);
    const msg = formatTradeClosed(result);
    await this.replyMarkdownV2Safe(ctx, msg);
  }

  private async executeAnalyze(ctx: Context<Update>, data: AnalyzeData): Promise<void> {
    await ctx.reply('⏳ กำลังวิเคราะห์ตลาด อาจใช้เวลา 30-60 วินาที...');

    const result = await this.analyzeAgent.analyze({
      symbol: data.symbol!.toUpperCase(),
      timeframe: data.timeframe! as Timeframe,
      riskLevel: data.riskLevel ?? 'medium',
    });

    if (!result.success || !result.data) {
      console.error('[TelegramBot] executeAnalyze failed:', result.error);
      await ctx.reply(`❌ วิเคราะห์ไม่สำเร็จ: ${result.message}`);
      return;
    }

    const msg = formatAnalysis(result);
    await this.replyMarkdownV2Safe(ctx, msg);
  }

  private async executeSummary(ctx: Context<Update>, data: SummarizeData): Promise<void> {
    const period = data.period ?? 'week';
    const periodLabels: Record<string, string> = {
      today: 'วันนี้', week: 'อาทิตย์นี้', month: 'เดือนนี้', last30: '30 วันล่าสุด',
    };
    await ctx.reply(`⏳ กำลังสรุปผลการเทรด ${periodLabels[period]} อาจใช้เวลาสักครู…`);

    try {
      const result = await this.summaryAgent.summarize(env.DEFAULT_USER_ID, period, periodLabels[period]);

      if (!result.stats.totalTrades) {
        await ctx.reply(`📢 ไม่พบ trade ที่ปิดแล้วในช่วง ${periodLabels[period]}`);
        return;
      }

      const [statsMsg, aiMsg] = formatTradeSummary(periodLabels[period], result.stats, result.aiSummary);
      await this.replyMarkdownV2Safe(ctx, statsMsg);
      if (aiMsg) await this.replyMarkdownV2Safe(ctx, aiMsg);
    } catch (err) {
      console.error('[TelegramBot] executeSummary error:', err);
      await ctx.reply('⚠️ เกิดข้อผิดพลาดในการสรุป กรุณาลองใหม่');
    }
  }

  // ─── Field asking ─────────────────────────────────────────────────────────

  private async askNextField(ctx: Context<Update>, userId: number): Promise<void> {
    const session = this.state.get(userId)!;
    const fieldKey = session.pendingFields[0];

    let question: string | undefined;
    if (session.intent === 'LOG_TRADE') {
      question = LOG_TRADE_FIELDS.find(f => f.key === fieldKey)?.question;
    } else if (session.intent === 'CLOSE_TRADE') {
      if (!(session.collectedData as CloseTradeData).tradeId) {
        return this.showOpenTradesKeyboard(ctx, userId);
      }
      // Show inline keyboard for result field instead of free-text
      if (fieldKey === 'result') {
        return this.showTradeResultKeyboard(ctx);
      }
      question = CLOSE_TRADE_FIELDS.find(f => f.key === fieldKey)?.question;
    } else if (session.intent === 'ANALYZE') {
      question = ANALYZE_FIELDS.find(f => f.key === fieldKey)?.question;
    }

    if (question) {
      await ctx.reply(question, { parse_mode: 'Markdown' });
    }
  }

  private async showTradeResultKeyboard(ctx: Context<Update>): Promise<void> {
    await ctx.reply('🏆 ผลการเทรดเป็นอะไร?', {
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ WIN (กำไร)', callback_data: 'close_result:WIN' },
          { text: '❌ LOSS (ขาดทุน)', callback_data: 'close_result:LOSS' },
          { text: '➖ BREAKEVEN (เท่าทุน)', callback_data: 'close_result:BREAKEVEN' },
        ]],
      },
    });
  }

  // ─── Telegram message helpers ─────────────────────────────────────────────

  /**
   * Send a MarkdownV2 message, automatically splitting at newline boundaries
   * when the text exceeds Telegram's 4096-character per-message limit.
   */
  private async replyMarkdownV2Safe(ctx: Context<Update>, text: string): Promise<void> {
    const LIMIT = 4096;
    if (text.length <= LIMIT) {
      await ctx.replyWithMarkdownV2(text);
      return;
    }

    // Split into chunks at newline boundaries without exceeding the limit
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > LIMIT) {
      const slice = remaining.slice(0, LIMIT);
      const splitAt = slice.lastIndexOf('\n');
      const boundary = splitAt > 0 ? splitAt : LIMIT;
      chunks.push(remaining.slice(0, boundary));
      remaining = remaining.slice(boundary).replace(/^\n/, '');
    }
    if (remaining) chunks.push(remaining);

    for (const chunk of chunks) {
      await ctx.replyWithMarkdownV2(chunk);
    }
  }

  private async showOpenTradesKeyboard(ctx: Context<Update>, userId: number): Promise<void> {
    try {
      const trades = await this.tradeRepo.findOpenTrades(env.DEFAULT_USER_ID);
      if (!trades.length) {
        await ctx.reply('📭 ไม่พบ open trade ที่ยังค้างอยู่');
        this.state.clear(userId);
        return;
      }

      this.state.update(userId, { openTrades: trades });

      const buttons: InlineKeyboardButton[][] = trades.map((trade, i) => [{
        text: formatOpenTradeItem(trade, i),
        callback_data: `close_trade:${trade.id}`,
      }]);

      await ctx.reply('📋 เลือก trade ที่ต้องการปิด:', {
        reply_markup: { inline_keyboard: buttons },
      });
    } catch (err) {
      console.error('[TelegramBot] showOpenTradesKeyboard error:', err);
      await ctx.reply('⚠️ ไม่สามารถดึงรายการ trade ได้');
      this.state.clear(userId);
    }
  }

  // ─── Pending fields computation ───────────────────────────────────────────

  private computePendingFields(intent: string, data: Record<string, unknown>): string[] {
    if (intent === 'LOG_TRADE') {
      return LOG_TRADE_FIELDS
        .map(f => f.key)
        .filter(k => data[k] === undefined || data[k] === null || data[k] === '') as string[];
    }
    if (intent === 'CLOSE_TRADE') {
      // If tradeId not yet known, return a sentinel to trigger the inline keyboard
      if (!data['tradeId']) {
        return ['_select_trade'];
      }
      // tradeId is known — return any missing close fields
      return CLOSE_TRADE_FIELDS
        .map(f => f.key)
        .filter(k => data[k] === undefined || data[k] === null || data[k] === '') as string[];
    }
    if (intent === 'ANALYZE') {
      return ANALYZE_FIELDS
        .map(f => f.key)
        .filter(k => data[k] === undefined || data[k] === null || data[k] === '') as string[];
    }
    if (intent === 'SUMMARIZE') {
      return []; // execute immediately — no multi-turn needed
    }
    return [];
  }

  // ─── Field parsers ────────────────────────────────────────────────────────

  private parseLogTradeField(key: keyof LogTradeData, text: string): unknown {
    const t = text.trim();
    switch (key) {
      case 'symbol':     return t.toUpperCase();
      case 'direction': {
        const upper = t.toUpperCase();
        if (upper === 'BUY' || upper === 'ซื้อ' || upper === 'B') return 'BUY';
        if (upper === 'SELL' || upper === 'ขาย' || upper === 'S') return 'SELL';
        return null;
      }
      case 'timeframe': {
        const tfl = t.toLowerCase().replace(/\s/g, '');
        const valid = ['5m', '15m', '1h', '4h', '1d'];
        const aliases: Record<string, string> = {
          '1hour':'1h','1ชม':'1h','4hour':'4h','4ชม':'4h',
          '1day':'1d','1วัน':'1d','15min':'15m','5min':'5m',
        };
        return valid.includes(tfl) ? tfl : (aliases[tfl] ?? null);
      }
      case 'entryPrice':
      case 'tpPrice':
      case 'slPrice': {
        const n = parseFloat(t);
        return isNaN(n) ? null : n;
      }
      case 'entryTime': {
        const parsed = parseEntryTime(t);
        return parsed ? parsed.toISOString() : null;
      }
      case 'userReason':
      case 'userAnalysis':
        return t || null;
      default:
        return null;
    }
  }

  private parseCloseTradeField(key: keyof CloseTradeData, text: string): unknown {
    const t = text.trim();
    switch (key) {
      case 'result': {
        const upper = t.toUpperCase();
        if (upper === 'WIN' || upper === 'W' || upper === 'กำไร') return 'WIN';
        if (upper === 'LOSS' || upper === 'L' || upper.includes('ขาดทุน') || upper.includes('เสีย')) return 'LOSS';
        if (upper === 'BREAKEVEN' || upper === 'BE' || upper.includes('เท่าทุน')) return 'BREAKEVEN';
        return null;
      }
      case 'exitPrice':
      case 'pips':
      case 'profitUsd': {
        const n = parseFloat(t);
        return isNaN(n) ? null : n;
      }
      case 'userExitReason':
      case 'userLesson':
        return t || null;
      default:
        return null;
    }
  }

  private parseAnalyzeField(key: keyof AnalyzeData, text: string): unknown {
    const t = text.trim();
    switch (key) {
      case 'symbol':    return t.toUpperCase();
      case 'timeframe': return this.parseLogTradeField('timeframe', t);
      case 'riskLevel': {
        const lower = t.toLowerCase();
        if (['low', 'medium', 'high'].includes(lower)) return lower;
        return null;
      }
      default: return null;
    }
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  private isAllowed(ctx: Context<Update>): boolean {
    if (this.allowedUserIds.size === 0) return true; // no restriction configured
    const id = ctx.from?.id;
    return id !== undefined && this.allowedUserIds.has(id);
  }

  private parseAllowedUserIds(raw: string | undefined): Set<number> {
    if (!raw || !raw.trim()) return new Set();
    return new Set(
      raw.split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n))
    );
  }
}
