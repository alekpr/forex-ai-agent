import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { ConversationIntent, LogTradeData, CloseTradeData, AnalyzeData } from './ConversationState';

export interface RouterResult {
  intent: ConversationIntent;
  data: LogTradeData | CloseTradeData | AnalyzeData;
}

export interface UnknownResult {
  intent: 'UNKNOWN';
  reply: string;
}

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'log_trade',
    description: 'User wants to log / record a new forex trade entry. Triggered by words like: บันทึก trade, เปิด trade, เข้า trade, log trade, จด trade, buy, sell, ซื้อ, ขาย, เปิดสถานะ',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol:      { type: 'string', description: 'Currency pair e.g. EURUSD, GBPUSD, XAUUSD' },
        direction:   { type: 'string', enum: ['BUY', 'SELL'], description: 'Trade direction. ซื้อ=BUY, ขาย=SELL' },
        timeframe:   { type: 'string', enum: ['5m', '15m', '1h', '4h', '1d'], description: 'Chart timeframe' },
        entryPrice:  { type: 'number', description: 'Entry price' },
        tpPrice:     { type: 'number', description: 'Take profit price' },
        slPrice:     { type: 'number', description: 'Stop loss price' },
        userReason:  { type: 'string', description: 'Reason for entering the trade' },
        userAnalysis:{ type: 'string', description: 'Optional extra market analysis from user' },
      },
      required: [],
    },
  },
  {
    name: 'close_trade',
    description: 'User wants to close / record the result of an existing open trade. Triggered by: ปิด trade, close trade, ปิดสถานะ, TP hit, SL hit, ผลการเทรด, กำไร, ขาดทุน, WIN, LOSS',
    input_schema: {
      type: 'object' as const,
      properties: {
        result:         { type: 'string', enum: ['WIN', 'LOSS', 'BREAKEVEN'], description: 'Trade result. กำไร/ได้กำไร=WIN, ขาดทุน/เสีย=LOSS' },
        exitPrice:      { type: 'number', description: 'Exit price' },
        pips:           { type: 'number', description: 'Pips gained (positive) or lost (negative)' },
        profitUsd:      { type: 'number', description: 'Profit or loss in USD (negative for loss)' },
        userExitReason: { type: 'string', description: 'Reason for closing the trade' },
        userLesson:     { type: 'string', description: 'Optional lesson learned' },
      },
      required: [],
    },
  },
  {
    name: 'analyze',
    description: 'User wants AI market analysis or recommendation for a forex pair. Triggered by: วิเคราะห์, analyze, ดู, แนวโน้ม, recommendation, เช็ค market, ควรเทรดไหม, สัญญาณ',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol:    { type: 'string', description: 'Currency pair e.g. EURUSD' },
        timeframe: { type: 'string', enum: ['5m', '15m', '1h', '4h', '1d'], description: 'Chart timeframe' },
        riskLevel: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Risk level, default medium' },
      },
      required: [],
    },
  },
];

const SYSTEM_PROMPT = `You are an intent classifier for a Forex trading assistant Telegram bot.
Your ONLY job is to determine what the user wants and extract any data they provided.

You MUST call exactly one of the three tools: log_trade, close_trade, or analyze.
- Extract ALL values the user mentioned (partial extraction is fine — missing fields will be asked later).
- Normalize: ซื้อ→BUY, ขาย→SELL, กำไร/TP hit→WIN, ขาดทุน/SL hit→LOSS, 1hour/1ชม→1h, 4hour/4ชม→4h
- If you CANNOT determine any of the 3 intents, still call analyze with empty fields as a fallback.
- NEVER respond with plain text. ALWAYS call a tool.`;

export async function routeMessage(userMessage: string): Promise<RouterResult | UnknownResult> {
  try {
    const response = await client.messages.create({
      model: env.CLAUDE_MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: userMessage }],
    });

    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!toolUse) {
      return { intent: 'UNKNOWN', reply: helpMessage() };
    }

    const input = toolUse.input as Record<string, unknown>;

    if (toolUse.name === 'log_trade') {
      // Determine if Claude really found evidence of a trade intent, or just fell back
      const hasMeaningfulData = input.symbol || input.direction || input.entryPrice;
      if (!hasMeaningfulData) {
        return { intent: 'UNKNOWN', reply: helpMessage() };
      }
      return { intent: 'LOG_TRADE', data: input as LogTradeData };
    }

    if (toolUse.name === 'close_trade') {
      return { intent: 'CLOSE_TRADE', data: input as CloseTradeData };
    }

    if (toolUse.name === 'analyze') {
      const hasMeaningfulData = input.symbol || input.timeframe;
      if (!hasMeaningfulData) {
        return { intent: 'UNKNOWN', reply: helpMessage() };
      }
      return { intent: 'ANALYZE', data: input as AnalyzeData };
    }

    return { intent: 'UNKNOWN', reply: helpMessage() };
  } catch (err) {
    console.error('[IntentRouter] Error:', err);
    return {
      intent: 'UNKNOWN',
      reply: '⚠️ เกิดข้อผิดพลาดในการวิเคราะห์คำสั่ง กรุณาลองใหม่อีกครั้ง',
    };
  }
}

function helpMessage(): string {
  return `👋 *Forex AI Bot* ช่วยได้ 3 อย่าง:\n\n` +
    `📝 *บันทึก trade* — พิมพ์เช่น:\n"บันทึก trade EURUSD BUY 1h"\n\n` +
    `🏁 *ปิด trade* — พิมพ์เช่น:\n"ปิด trade" หรือ "close trade"\n\n` +
    `📊 *วิเคราะห์ตลาด* — พิมพ์เช่น:\n"วิเคราะห์ EURUSD 1h"\n\n` +
    `พิมพ์ /cancel เพื่อยกเลิกการสนทนาปัจจุบัน`;
}
