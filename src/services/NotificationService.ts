import axios from 'axios';
import { env } from '../config/env';

interface AlertPayload {
  symbol: string;
  timeframe: string;
  direction: string;
  confidence: number;
  suggestedTp: number | null;
  suggestedSl: number | null;
  analysis: string;
}

export class NotificationService {
  async sendAlert(payload: AlertPayload): Promise<void> {
    const message = this.formatMessage(payload);
    await Promise.allSettled([
      this.sendLine(message),
      this.sendTelegram(message),
    ]);
  }

  private formatMessage(payload: AlertPayload): string {
    const confidencePct = (payload.confidence * 100).toFixed(0);
    return [
      `🤖 Forex AI Alert`,
      `Symbol: ${payload.symbol} | TF: ${payload.timeframe}`,
      `Signal: ${payload.direction} (${confidencePct}% confidence)`,
      payload.suggestedTp ? `TP: ${payload.suggestedTp}` : '',
      payload.suggestedSl ? `SL: ${payload.suggestedSl}` : '',
      ``,
      payload.analysis,
    ]
      .filter((l) => l !== undefined)
      .join('\n');
  }

  private async sendLine(message: string): Promise<void> {
    if (!env.LINE_NOTIFY_TOKEN) return;
    await axios.post(
      'https://notify-api.line.me/api/notify',
      new URLSearchParams({ message }),
      {
        headers: {
          Authorization: `Bearer ${env.LINE_NOTIFY_TOKEN}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
  }

  private async sendTelegram(message: string): Promise<void> {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
    await axios.post(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
      }
    );
  }
}
