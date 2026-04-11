import express from 'express';
import { env } from './config/env';
import { closePool } from './db/connection';
import tradeRoutes from './routes/tradeRoutes';
import analyzeRoutes from './routes/analyzeRoutes';
import alertRoutes, { scheduler } from './routes/alertRoutes';
import { AlertRepository } from './repositories/AlertRepository';
import { TelegramBotService } from './telegram/TelegramBotService';
import { CandleRefreshService } from './services/CandleRefreshService';

const app = express();

app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/trades', tradeRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/alerts', alertRoutes);

// Telegram webhook (mounted before 404 handler)
let telegramBot: TelegramBotService | null = null;
if (env.TELEGRAM_BOT_TOKEN) {
  try {
    telegramBot = new TelegramBotService();
    app.use('/telegram/webhook', telegramBot.getMiddleware());
    console.log('🤖 Telegram bot webhook mounted at /telegram/webhook');
  } catch (err) {
    console.warn('⚠️  Telegram bot not started:', (err as Error).message);
  }
}

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

async function startServer(): Promise<void> {
  // Initial candle population on startup
  const symbols = env.CANDLE_SYMBOLS.split(',').map((s) => s.trim()).filter(Boolean);
  const candleRefresh = new CandleRefreshService();
  candleRefresh.refresh(symbols).catch((err) =>
    console.warn('⚠️  Initial candle refresh failed:', (err as Error).message)
  );

  // Auto-start schedulers independently based on their own settings
  const alertRepo = new AlertRepository();
  const settings = await alertRepo.getSettings(env.DEFAULT_USER_ID).catch(() => null);

  if (settings?.candleRefreshEnabled) {
    scheduler.startCandleRefresh(settings.candleRefreshIntervalMinutes);
  }
  if (settings?.alertEnabled) {
    scheduler.startAlerts(settings.alertIntervalMinutes);
  }

  const server = app.listen(env.PORT, () => {
    console.log(`🚀 Forex AI Agent API running on http://localhost:${env.PORT}`);
    console.log(`   Environment: ${env.NODE_ENV}`);
    console.log(`   Market data: ${env.MARKET_DATA_PROVIDER}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down gracefully...`);
    scheduler.stop();
    server.close(async () => {
      await closePool();
      console.log('Server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
