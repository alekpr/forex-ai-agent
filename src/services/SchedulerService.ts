import cron, { ScheduledTask } from 'node-cron';
import { AutoAlertAgent } from '../agents/AutoAlertAgent';
import { CandleRefreshService } from './CandleRefreshService';
import { DailyOutlookAgent } from '../agents/DailyOutlookAgent';
import { env } from '../config/env';

export class SchedulerService {
  private alertTask: ScheduledTask | null = null;
  private candleTask: ScheduledTask | null = null;
  private dailyOutlookTask: ScheduledTask | null = null;
  private readonly agent: AutoAlertAgent;
  private readonly candleRefresh: CandleRefreshService;
  private readonly outlookAgent: DailyOutlookAgent;
  private currentAlertInterval: number;
  private currentCandleInterval: number;

  constructor() {
    this.agent = new AutoAlertAgent();
    this.candleRefresh = new CandleRefreshService();
    this.outlookAgent = new DailyOutlookAgent();
    this.currentAlertInterval = 15;
    this.currentCandleInterval = 15;
  }

  // ─── Alert scheduler ───────────────────────────────────────────────────────

  startAlerts(intervalMinutes: number): void {
    this.stopAlerts();
    this.currentAlertInterval = intervalMinutes;
    const expression = `*/${intervalMinutes} * * * *`;
    if (!cron.validate(expression)) {
      throw new Error(`Invalid cron expression for alert interval ${intervalMinutes} minutes`);
    }
    this.alertTask = cron.schedule(expression, async () => {
      console.log(`[Scheduler] Running alert scan (every ${intervalMinutes}min)...`);
      await this.agent.runScan();
    });
    console.log(`[Scheduler] Alert scan started — every ${intervalMinutes} minutes`);
  }

  stopAlerts(): void {
    if (this.alertTask) {
      this.alertTask.stop();
      this.alertTask = null;
      console.log('[Scheduler] Alert scan stopped');
    }
  }

  isAlertRunning(): boolean {
    return this.alertTask !== null;
  }

  getAlertInterval(): number {
    return this.currentAlertInterval;
  }

  // ─── Candle refresh scheduler ──────────────────────────────────────────────

  startCandleRefresh(intervalMinutes: number): void {
    this.stopCandleRefresh();
    this.currentCandleInterval = intervalMinutes;
    const expression = `*/${intervalMinutes} * * * *`;
    if (!cron.validate(expression)) {
      throw new Error(`Invalid cron expression for candle interval ${intervalMinutes} minutes`);
    }
    const symbols = env.CANDLE_SYMBOLS.split(',').map((s) => s.trim()).filter(Boolean);
    this.candleTask = cron.schedule(expression, async () => {
      console.log(`[Scheduler] Running candle refresh (every ${intervalMinutes}min)...`);
      await this.candleRefresh.refresh(symbols);
    });
    console.log(`[Scheduler] Candle refresh started — every ${intervalMinutes} minutes`);
  }

  stopCandleRefresh(): void {
    if (this.candleTask) {
      this.candleTask.stop();
      this.candleTask = null;
      console.log('[Scheduler] Candle refresh stopped');
    }
  }

  isCandleRefreshRunning(): boolean {
    return this.candleTask !== null;
  }

  getCandleRefreshInterval(): number {
    return this.currentCandleInterval;
  }

  // ─── Daily outlook scheduler ───────────────────────────────────────────────

  /**
   * Schedule daily outlook at `hour:00` on weekdays (Mon–Fri) in Bangkok timezone.
   * @param hour  0–23 Bangkok time
   * @param symbols  array of symbol strings, e.g. ['EURUSD', 'GBPUSD']
   * @param userId  the user ID to run outlook for
   */
  startDailyOutlook(hour: number, symbols: string[], userId: string): void {
    this.stopDailyOutlook();
    const expression = `0 ${hour} * * 1-5`;
    if (!cron.validate(expression)) {
      throw new Error(`Invalid cron expression for daily outlook hour ${hour}`);
    }
    this.dailyOutlookTask = cron.schedule(
      expression,
      async () => {
        console.log(`[Scheduler] Running daily outlook for ${symbols.join(', ')}...`);
        try {
          await this.outlookAgent.generateOutlook(userId, symbols);
        } catch (err) {
          console.error('[Scheduler] Daily outlook error:', err);
        }
      },
      { timezone: 'Asia/Bangkok' }
    );
    console.log(`[Scheduler] Daily outlook started — ${hour}:00 weekdays (Bangkok) for ${symbols.join(', ')}`);
  }

  stopDailyOutlook(): void {
    if (this.dailyOutlookTask) {
      this.dailyOutlookTask.stop();
      this.dailyOutlookTask = null;
      console.log('[Scheduler] Daily outlook stopped');
    }
  }

  isDailyOutlookRunning(): boolean {
    return this.dailyOutlookTask !== null;
  }

  // ─── Legacy helpers (stop all) ─────────────────────────────────────────────

  stop(): void {
    this.stopAlerts();
    this.stopCandleRefresh();
    this.stopDailyOutlook();
  }

  isRunning(): boolean {
    return this.isAlertRunning() || this.isCandleRefreshRunning() || this.isDailyOutlookRunning();
  }

  /** @deprecated use getAlertInterval() */
  getInterval(): number {
    return this.currentAlertInterval;
  }

  getCandleRefreshService(): CandleRefreshService {
    return this.candleRefresh;
  }
}
