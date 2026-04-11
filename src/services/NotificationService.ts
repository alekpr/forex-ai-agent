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

  /**
   * Broadcast a daily outlook message to the configured Telegram chat.
   * Accepts a pre-formatted MarkdownV2 string. Splits at newline boundaries
   * if longer than Telegram's 4096-char limit. Falls back to plain text on parse error.
   */
  async broadcastDailyOutlook(markdownV2Text: string): Promise<void> {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
      console.warn('[NotificationService] Telegram not configured — skipping daily outlook broadcast');
      return;
    }

    const LIMIT = 4096;
    const chunks: string[] = [];
    let remaining = markdownV2Text;
    while (remaining.length > LIMIT) {
      const slice = remaining.slice(0, LIMIT);
      const splitAt = slice.lastIndexOf('\n');
      const boundary = splitAt > 0 ? splitAt : LIMIT;
      chunks.push(remaining.slice(0, boundary));
      remaining = remaining.slice(boundary).replace(/^\n/, '');
    }
    if (remaining) chunks.push(remaining);

    for (const chunk of chunks) {
      try {
        await axios.post(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          { chat_id: env.TELEGRAM_CHAT_ID, text: chunk, parse_mode: 'MarkdownV2' }
        );
      } catch {
        // Fallback: strip MarkdownV2 escapes and send plain text
        const plain = chunk.replace(/\\([_*[\]()~`>#+\-=|{}.!])/g, '$1');
        await axios.post(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          { chat_id: env.TELEGRAM_CHAT_ID, text: plain }
        );
      }
    }
  }
}
