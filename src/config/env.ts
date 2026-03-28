import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  MARKET_DATA_PROVIDER: z.enum(['finnhub', 'twelvedata']).default('finnhub'),
  FINNHUB_API_KEY: z.string().optional(),
  FINNHUB_BASE_URL: z.string().default('https://finnhub.io/api/v1'),
  TWELVEDATA_API_KEY: z.string().optional(),
  TWELVEDATA_BASE_URL: z.string().default('https://api.twelvedata.com'),
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-20250514'),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  DEFAULT_USER_ID: z.string().uuid().default('00000000-0000-0000-0000-000000000001'),
  LINE_NOTIFY_TOKEN: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  parsed.error.issues.forEach((issue) => {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  });
  process.exit(1);
}

export const env = parsed.data;
