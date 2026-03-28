import { env } from '../config/env';
import { MarketAnalyzerAgent } from './MarketAnalyzerAgent';
import { AlertRepository } from '../repositories/AlertRepository';
import { NotificationService } from '../services/NotificationService';
import { Timeframe } from '../types/market';

// Default symbols and timeframes to monitor
const WATCH_SYMBOLS: string[] = ['GBPUSD', 'EURUSD', 'USDJPY', 'XAUUSD'];
const WATCH_TIMEFRAME: Timeframe = '15m';

export class AutoAlertAgent {
  private readonly analyzerAgent: MarketAnalyzerAgent;
  private readonly alertRepo: AlertRepository;
  private readonly notificationSvc: NotificationService;

  constructor() {
    this.analyzerAgent = new MarketAnalyzerAgent();
    this.alertRepo = new AlertRepository();
    this.notificationSvc = new NotificationService();
  }

  /**
   * Run a full analysis for all watched symbols and send alerts if confidence meets threshold.
   */
  async runScan(): Promise<void> {
    const settings = await this.alertRepo.getSettings(env.DEFAULT_USER_ID);
    const threshold = settings?.confidenceThreshold ?? 0.7;
    const riskLevel = settings?.riskLevel ?? 'medium';

    for (const symbol of WATCH_SYMBOLS) {
      try {
        const result = await this.analyzerAgent.analyze({
          symbol,
          timeframe: WATCH_TIMEFRAME,
          riskLevel,
        });

        if (!result.success || !result.data) continue;
        const { recommendation, confidence, suggestedTp, suggestedSl, aiAnalysis } = result.data;

        if (recommendation === 'WAIT') continue;
        if (confidence < threshold) continue;

        await this.notificationSvc.sendAlert({
          symbol,
          timeframe: WATCH_TIMEFRAME,
          direction: recommendation,
          confidence,
          suggestedTp,
          suggestedSl,
          analysis: aiAnalysis,
        });

        // Mark alerts as sent
        const pending = await this.alertRepo.findPending(env.DEFAULT_USER_ID);
        for (const alert of pending) {
          if (alert.symbol === symbol) {
            await this.alertRepo.markSent(alert.id);
          }
        }
      } catch (err) {
        console.error(`AutoAlertAgent scan error for ${symbol}:`, err instanceof Error ? err.message : err);
      }
    }
  }
}
