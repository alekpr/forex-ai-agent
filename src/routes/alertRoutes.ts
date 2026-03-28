import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { AlertRepository } from '../repositories/AlertRepository';
import { SchedulerService } from '../services/SchedulerService';
import { env } from '../config/env';

const router = Router();
const alertRepo = new AlertRepository();
export const scheduler = new SchedulerService();

const updateSettingsSchema = z.object({
  alertEnabled: z.boolean().optional(),
  alertIntervalMinutes: z.number().int().min(5).max(1440).optional(),
  riskLevel: z.enum(['low', 'medium', 'high']).optional(),
  confidenceThreshold: z.number().min(0.5).max(1.0).optional(),
});

// GET /api/alerts/settings
router.get('/settings', async (_req: Request, res: Response): Promise<void> => {
  const settings = await alertRepo.getSettings(env.DEFAULT_USER_ID);
  if (!settings) {
    res.status(404).json({ error: 'Settings not found' });
    return;
  }
  res.json({
    ...settings,
    schedulerRunning: scheduler.isRunning(),
    currentInterval: scheduler.getInterval(),
  });
});

// PUT /api/alerts/settings
router.put('/settings', async (req: Request, res: Response): Promise<void> => {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
    return;
  }

  await alertRepo.updateSettings(env.DEFAULT_USER_ID, parsed.data);

  // Start/stop scheduler based on alertEnabled flag
  const { alertEnabled, alertIntervalMinutes } = parsed.data;
  if (alertEnabled === true) {
    const interval = alertIntervalMinutes ?? scheduler.getInterval();
    scheduler.start(interval);
  } else if (alertEnabled === false) {
    scheduler.stop();
  } else if (alertIntervalMinutes !== undefined && scheduler.isRunning()) {
    scheduler.start(alertIntervalMinutes);
  }

  const updated = await alertRepo.getSettings(env.DEFAULT_USER_ID);
  res.json({ success: true, settings: updated, schedulerRunning: scheduler.isRunning() });
});

export default router;
