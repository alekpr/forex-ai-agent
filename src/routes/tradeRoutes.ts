import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { TradeLoggerAgent } from '../agents/TradeLoggerAgent';
import { Timeframe } from '../types/market';
import { TradeDirection, TradeResult } from '../types/trade';

const router = Router();
const agent = new TradeLoggerAgent();

const createTradeSchema = z.object({
  symbol: z.string().min(3).max(20).toUpperCase(),
  direction: z.enum(['BUY', 'SELL'] as [TradeDirection, TradeDirection]),
  timeframe: z.enum(['5m', '15m', '1h', '4h', '1d'] as [Timeframe, ...Timeframe[]]),
  entryPrice: z.number().positive(),
  tpPrice: z.number().positive(),
  slPrice: z.number().positive(),
  entryTime: z.string().datetime().transform((v) => new Date(v)),
  userReason: z.string().min(5).max(2000),
  indicatorsUsed: z.array(z.string()).default([]),
  userAnalysis: z.string().max(5000).optional(),
});

const closeTradeSchema = z.object({
  result: z.enum(['WIN', 'LOSS', 'BREAKEVEN'] as [TradeResult, TradeResult, TradeResult]),
  exitPrice: z.number().positive(),
  exitTime: z.string().datetime().transform((v) => new Date(v)),
  pips: z.number(),
  profitUsd: z.number(),
  userExitReason: z.string().min(3).max(2000),
  userLesson: z.string().max(2000).optional(),
});

// POST /api/trades
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = createTradeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
    return;
  }

  const result = await agent.logTrade(parsed.data);
  res.status(result.success ? 201 : 500).json(result);
});

// PUT /api/trades/:id/result
router.put('/:id/result', async (req: Request, res: Response): Promise<void> => {
  const id = req.params['id'] as string;
  const parsed = closeTradeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
    return;
  }

  const result = await agent.closeTrade(id, parsed.data);
  res.status(result.success ? 200 : (result.message.includes('not found') ? 404 : 500)).json(result);
});

export default router;
