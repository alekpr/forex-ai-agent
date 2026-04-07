import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { TradeLogRepository } from '../repositories/TradeLogRepository';
import { ClosedTradeWithResult } from '../types/trade';
import { TradeSummaryStats } from '../telegram/formatters';

export interface TradeSummaryResult {
  stats: TradeSummaryStats;
  aiSummary: string;
}

function getPeriodRange(period: string): { since: Date; until: Date } {
  const now = new Date();
  const until = new Date(now);
  until.setHours(23, 59, 59, 999);

  let since: Date;
  switch (period) {
    case 'today':
      since = new Date(now);
      since.setHours(0, 0, 0, 0);
      break;
    case 'week': {
      // Monday to now
      since = new Date(now);
      const day = since.getDay(); // 0 = Sun
      const diff = day === 0 ? 6 : day - 1;
      since.setDate(since.getDate() - diff);
      since.setHours(0, 0, 0, 0);
      break;
    }
    case 'month':
      since = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      break;
    case 'last30':
    default:
      since = new Date(now);
      since.setDate(since.getDate() - 30);
      since.setHours(0, 0, 0, 0);
      break;
  }

  return { since, until };
}

function computeStats(trades: ClosedTradeWithResult[]): TradeSummaryStats {
  const wins = trades.filter(t => t.result === 'WIN').length;
  const losses = trades.filter(t => t.result === 'LOSS').length;
  const breakevens = trades.filter(t => t.result === 'BREAKEVEN').length;
  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const totalPips = trades.reduce((s, t) => s + t.pips, 0);
  const totalProfitUsd = trades.reduce((s, t) => s + t.profitUsd, 0);
  const avgPipsPerTrade = totalTrades > 0 ? totalPips / totalTrades : 0;

  const pipValues = trades.map(t => t.pips);
  const bestTradePips = pipValues.length ? Math.max(...pipValues) : 0;
  const worstTradePips = pipValues.length ? Math.min(...pipValues) : 0;

  const techniqueSet = new Set<string>();
  for (const t of trades) {
    for (const ind of t.indicatorsUsed) {
      techniqueSet.add(ind);
    }
  }
  const techniquesUsed = [...techniqueSet];

  return {
    totalTrades, wins, losses, breakevens,
    winRate: Math.round(winRate * 10) / 10,
    totalPips: Math.round(totalPips * 10) / 10,
    totalProfitUsd: Math.round(totalProfitUsd * 100) / 100,
    avgPipsPerTrade: Math.round(avgPipsPerTrade * 10) / 10,
    bestTradePips: Math.round(bestTradePips * 10) / 10,
    worstTradePips: Math.round(worstTradePips * 10) / 10,
    techniquesUsed,
  };
}

function buildPrompt(periodLabel: string, stats: TradeSummaryStats, trades: ClosedTradeWithResult[]): string {
  const tradeLines = trades.slice(0, 20).map(t =>
    `- ${t.symbol} ${t.direction} ${t.timeframe}: ${t.result} ${t.pips >= 0 ? '+' : ''}${t.pips}p | เหตุผล: ${t.userReason} | เครื่องมือ: ${t.indicatorsUsed.join(',')} | บทเรียน: ${t.userLesson ?? '-'}`
  ).join('\n');

  return `คุณคือโค้ชเทรด Forex ที่ช่ำชอง วิเคราะห์ประวัติการเทรดช่วง ${periodLabel} ต่อไปนี้แล้วให้ข้อแนะนำเป็นภาษาไทย

สถิติรวม:
- จำนวน trade: ${stats.totalTrades} | Win: ${stats.wins} | Loss: ${stats.losses} | BE: ${stats.breakevens}
- Win Rate: ${stats.winRate}%
- Total Pips: ${stats.totalPips >= 0 ? '+' : ''}${stats.totalPips}
- Avg Pips/Trade: ${stats.avgPipsPerTrade >= 0 ? '+' : ''}${stats.avgPipsPerTrade}
- เครื่องมือที่ใช้: ${stats.techniquesUsed.join(', ') || 'ไม่ระบุ'}

รายการ trade:
${tradeLines || '(ไม่มีข้อมูล)'}

โปรดวิเคราะห์:
1. จุดแข็งในช่วงนี้คืออะไร?
2. จุดอ่อนหรือ pattern ที่ทำให้ขาดทุนคืออะไร?
3. คำแนะนำที่นำไปใช้ได้จริงสำหรับนักเทรดคนนี้

ตอบกระชับ ไม่เกิน 300 คำ ใช้ภาษาไทย`;
}

export class TradeSummaryAgent {
  private readonly tradeRepo: TradeLogRepository;
  private readonly client: Anthropic;

  constructor() {
    this.tradeRepo = new TradeLogRepository();
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }

  async summarize(userId: string, period: string, periodLabel: string): Promise<TradeSummaryResult> {
    const { since, until } = getPeriodRange(period);
    const trades = await this.tradeRepo.findClosedWithResults(userId, since, until);
    const stats = computeStats(trades);

    if (!stats.totalTrades) {
      return { stats, aiSummary: '' };
    }

    const prompt = buildPrompt(periodLabel, stats, trades);

    const message = await this.client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });

    const aiSummary = message.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('');

    return { stats, aiSummary };
  }
}
