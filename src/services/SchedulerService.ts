import cron, { ScheduledTask } from 'node-cron';
import { AutoAlertAgent } from '../agents/AutoAlertAgent';
import { CandleRefreshService } from './CandleRefreshService';
import { env } from '../config/env';

export class SchedulerService {
  private task: ScheduledTask | null = null;
  private readonly agent: AutoAlertAgent;
  private readonly candleRefresh: CandleRefreshService;
  private currentInterval: number;

  constructor() {
    this.agent = new AutoAlertAgent();
    this.candleRefresh = new CandleRefreshService();
    this.currentInterval = 15; // default 15 minutes
  }

  start(intervalMinutes: number): void {
    this.stop(); // stop existing job if running
    this.currentInterval = intervalMinutes;

    // node-cron expression: every N minutes (supports 1,5,10,15,30,60 etc.)
    const expression = `*/${intervalMinutes} * * * *`;

    if (!cron.validate(expression)) {
      throw new Error(`Invalid cron expression for interval ${intervalMinutes} minutes`);
    }

    const symbols = env.CANDLE_SYMBOLS.split(',').map((s) => s.trim()).filter(Boolean);

    this.task = cron.schedule(expression, async () => {
      console.log(`[Scheduler] Running candle refresh + alert scan (every ${intervalMinutes}min)...`);
      // Refresh candles first so alert scan uses up-to-date data
      await this.candleRefresh.refresh(symbols);
      await this.agent.runScan();
    });

    console.log(`[Scheduler] Started — scanning every ${intervalMinutes} minutes`);
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log('[Scheduler] Stopped');
    }
  }

  isRunning(): boolean {
    return this.task !== null;
  }

  getInterval(): number {
    return this.currentInterval;
  }

  getCandleRefreshService(): CandleRefreshService {
    return this.candleRefresh;
  }
}
