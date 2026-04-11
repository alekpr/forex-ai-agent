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
  candleRefreshEnabled: z.boolean().optional(),
  candleRefreshIntervalMinutes: z.number().int().min(5).max(1440).optional(),
  dailyOutlookEnabled: z.boolean().optional(),
  dailyOutlookHour: z.number().int().min(0).max(23).optional(),
  dailyOutlookSymbols: z.string().min(1).optional(),
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
    alertSchedulerRunning: scheduler.isAlertRunning(),
    alertCurrentInterval: scheduler.getAlertInterval(),
    candleRefreshSchedulerRunning: scheduler.isCandleRefreshRunning(),
    candleRefreshCurrentInterval: scheduler.getCandleRefreshInterval(),
    dailyOutlookSchedulerRunning: scheduler.isDailyOutlookRunning(),
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

  const { alertEnabled, alertIntervalMinutes, candleRefreshEnabled, candleRefreshIntervalMinutes,
          dailyOutlookEnabled, dailyOutlookHour, dailyOutlookSymbols } = parsed.data;

  // Alert scheduler
  if (alertEnabled === true) {
    scheduler.startAlerts(alertIntervalMinutes ?? scheduler.getAlertInterval());
  } else if (alertEnabled === false) {
    scheduler.stopAlerts();
  } else if (alertIntervalMinutes !== undefined && scheduler.isAlertRunning()) {
    scheduler.startAlerts(alertIntervalMinutes);
  }

  // Candle refresh scheduler
  if (candleRefreshEnabled === true) {
    scheduler.startCandleRefresh(candleRefreshIntervalMinutes ?? scheduler.getCandleRefreshInterval());
  } else if (candleRefreshEnabled === false) {
    scheduler.stopCandleRefresh();
  } else if (candleRefreshIntervalMinutes !== undefined && scheduler.isCandleRefreshRunning()) {
    scheduler.startCandleRefresh(candleRefreshIntervalMinutes);
  }

  // Daily outlook scheduler
  const updatedSettingsForOutlook = await alertRepo.getSettings(env.DEFAULT_USER_ID);
  if (dailyOutlookEnabled === true) {
    const hour = dailyOutlookHour ?? updatedSettingsForOutlook?.dailyOutlookHour ?? 7;
    const syms = (dailyOutlookSymbols ?? updatedSettingsForOutlook?.dailyOutlookSymbols ?? 'EURUSD,GBPUSD')
      .split(',').map((s) => s.trim()).filter(Boolean);
    scheduler.startDailyOutlook(hour, syms, env.DEFAULT_USER_ID);
  } else if (dailyOutlookEnabled === false) {
    scheduler.stopDailyOutlook();
  } else if ((dailyOutlookHour !== undefined || dailyOutlookSymbols !== undefined) && scheduler.isDailyOutlookRunning()) {
    const hour = dailyOutlookHour ?? updatedSettingsForOutlook?.dailyOutlookHour ?? 7;
    const syms = (dailyOutlookSymbols ?? updatedSettingsForOutlook?.dailyOutlookSymbols ?? 'EURUSD,GBPUSD')
      .split(',').map((s) => s.trim()).filter(Boolean);
    scheduler.startDailyOutlook(hour, syms, env.DEFAULT_USER_ID);
  }

  const updated = await alertRepo.getSettings(env.DEFAULT_USER_ID);
  res.json({
    success: true,
    settings: updated,
    alertSchedulerRunning: scheduler.isAlertRunning(),
    candleRefreshSchedulerRunning: scheduler.isCandleRefreshRunning(),
    dailyOutlookSchedulerRunning: scheduler.isDailyOutlookRunning(),
  });
});

export default router;
