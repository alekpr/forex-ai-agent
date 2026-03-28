import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { MarketAnalyzerAgent } from '../agents/MarketAnalyzerAgent';
import { Timeframe } from '../types/market';

const router = Router();
const agent = new MarketAnalyzerAgent();

const analyzeSchema = z.object({
  symbol: z.string().min(3).max(20).toUpperCase(),
  timeframe: z.enum(['5m', '15m', '1h', '4h', '1d'] as [Timeframe, ...Timeframe[]]),
  riskLevel: z.enum(['low', 'medium', 'high']).default('medium'),
});

// POST /api/analyze
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = analyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
    return;
  }

  const result = await agent.analyze(parsed.data);
  res.status(result.success ? 200 : 500).json(result);
});

export default router;
