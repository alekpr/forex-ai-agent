import axios from 'axios';
import FormData from 'form-data';
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
      ...this.getAllowedChatIds().map(chatId => this.sendTelegramToChat(chatId, message)),
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

  private async sendTelegramToChat(chatId: number, message: string): Promise<void> {
    if (!env.TELEGRAM_BOT_TOKEN) return;
    await axios.post(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: String(chatId),
        text: message,
        parse_mode: 'HTML',
      }
    );
  }

  /**
   * Broadcast a daily outlook message to ALL allowed Telegram users.
   * If chartBuffer is provided, sends the chart as a photo first with the symbol+bias
   * as caption, then sends the full analysis text separately.
   * Splits text at newline boundaries if > 4096 chars. Falls back to plain text on parse error.
   */
  async broadcastDailyOutlook(markdownV2Text: string, chartBuffer?: Buffer, photoCaption?: string): Promise<void> {
    if (!env.TELEGRAM_BOT_TOKEN) {
      console.warn('[NotificationService] Telegram not configured — skipping daily outlook broadcast');
      return;
    }

    // Resolve all allowed chat IDs — use TELEGRAM_ALLOWED_USER_IDS if available,
    // otherwise fall back to the legacy single TELEGRAM_CHAT_ID.
    const chatIds = this.getAllowedChatIds();
    if (chatIds.length === 0) {
      console.warn('[NotificationService] No Telegram chat IDs configured — skipping daily outlook broadcast');
      return;
    }

    // Broadcast to every allowed user
    for (const chatId of chatIds) {
      await this.broadcastToChat(chatId, markdownV2Text, chartBuffer, photoCaption);
    }
  }

  /**
   * Parse TELEGRAM_ALLOWED_USER_IDS into an array of numeric chat IDs.
   * Falls back to TELEGRAM_CHAT_ID for backward compatibility.
   */
  private getAllowedChatIds(): number[] {
    const raw = env.TELEGRAM_ALLOWED_USER_IDS;
    if (raw && raw.trim()) {
      return raw.split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n));
    }
    if (env.TELEGRAM_CHAT_ID) {
      return [parseInt(env.TELEGRAM_CHAT_ID, 10)].filter(n => !isNaN(n));
    }
    return [];
  }

  /**
   * Send the daily outlook to a single chat ID.
   */
  private async broadcastToChat(
    chatId: number,
    markdownV2Text: string,
    chartBuffer?: Buffer,
    photoCaption?: string
  ): Promise<void> {
    // Send chart image first if provided
    if (chartBuffer) {
      try {
        const form = new FormData();
        form.append('chat_id', String(chatId));
        form.append('photo', chartBuffer, { filename: 'outlook.png', contentType: 'image/png' });
        if (photoCaption) {
          form.append('caption', photoCaption.slice(0, 1024)); // Telegram caption limit
        }
        await axios.post(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`,
          form,
          { headers: form.getHeaders() }
        );
      } catch (err) {
        console.error(`[NotificationService] Failed to send chart image to ${chatId}:`, (err as Error).message);
        // Continue to send text even if image fails
      }
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
          { chat_id: String(chatId), text: chunk, parse_mode: 'MarkdownV2' }
        );
      } catch {
        // Fallback: strip MarkdownV2 escapes and send plain text
        const plain = chunk.replace(/\\([_*[\]()~`>#+\-=|{}.!])/g, '$1');
        await axios.post(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          { chat_id: String(chatId), text: plain }
        );
      }
    }
  }
