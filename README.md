# Forex AI Agent 🤖📈

A Telegram-based AI trading assistant for Forex traders. Log trades via natural language, get AI-powered market analysis, track performance, and import historical backtest data — all through a Telegram bot.

## Features

- **Trade Logging via Telegram** — Send a message like "เปิด BUY EURUSD ที่ 1.0850 TF 1h" and the bot extracts all fields using Claude AI (tool_use), asking follow-up questions for any missing data
- **AI Market Analysis** — On each trade entry, Claude analyzes multi-timeframe indicators and provides commentary in Thai
- **AI Lesson Summary** — When closing a trade, Claude generates a personalized lesson based on entry/exit conditions
- **Backtest Import** — Import historical trades from MT4/MT5 CSV or manually-created CSV files, with AI lesson generation for each trade
- **Historical Candle Import** — Import OHLCV data from MT4/MT5 History Center CSV, with automatic aggregation to larger timeframes (5m → 15m, 30m, 1h, 4h, 1d)
- **Vector Similarity Search** — Trades are embedded with OpenAI embeddings (pgvector) for future pattern-matching features
- **Multi-timeframe Indicators** — EMA, RSI, MACD, Bollinger Bands, ATR, ADX computed via TwelveData API

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js + TypeScript (tsx) |
| Bot | Telegraf (Telegram Bot API) |
| AI | Anthropic Claude (`claude-sonnet-4-20250514`) |
| Embeddings | OpenAI `text-embedding-3-small` (1536-dim) |
| Database | PostgreSQL 17 + pgvector + TimescaleDB |
| Market Data | TwelveData / Finnhub |

## Prerequisites

- Node.js 20+
- PostgreSQL 17 with extensions: `pgvector`, `timescaledb`, `uuid-ossp`
- Telegram Bot Token ([@BotFather](https://t.me/BotFather))
- Anthropic API Key
- OpenAI API Key
- TwelveData or Finnhub API Key

## Setup

### 1. Clone & Install

```bash
git clone https://github.com/<your-username>/forex-ai-agent.git
cd forex-ai-agent
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys and database credentials
```

### 3. Database Migration

```bash
# Create the database first
psql -U postgres -c "CREATE DATABASE forex_agent;"

# Run all migrations
npm run migrate
```

### 4. Set Telegram Webhook

```bash
# Using ngrok for local development
ngrok http 3000
# Update TELEGRAM_WEBHOOK_URL in .env with the ngrok URL, then:
npm run telegram:set-webhook
```

### 5. Start

```bash
# Development (watch mode)
npm run dev

# Production
npm run build && npm start
```

## Telegram Bot Usage

The bot supports natural language in Thai and English:

| Action | Example Message |
|--------|----------------|
| Open trade | `BUY EURUSD 1.0850 TF 1h SL 1.0820 TP 1.0900` |
| Close trade | `/close` then select from inline keyboard |
| View open trades | `/trades` |
| Help | `/help` |

## Import Scripts

### Import Backtest Trades

```bash
# Manual CSV format
npm run import:backtest -- --file ./data/backtest-sample.csv --format manual --dry-run

# MT4/MT5 Account History CSV
npm run import:backtest -- --file ./data/mt4-history.csv --format mt4 --timeframe 1h
```

### Import Historical Candle Data

Supported input: MT4/MT5 History Center CSV (`DATE,TIME,OPEN,HIGH,LOW,CLOSE,TICKVOL` or `DATETIME,OPEN,...`)

```bash
# Import 15m candles and auto-aggregate to 30m, 1h, 4h, 1d
npm run import:candles -- --file ./data/EURUSD_M15.csv --symbol EURUSD --timeframe 15m --aggregate

# Import 1m candles, aggregate only (1m not stored directly)
npm run import:candles -- --file ./data/EURUSD_M1.csv --symbol EURUSD --timeframe 1m --targets 5m,15m,30m,1h,4h,1d

# Dry-run preview
npm run import:candles -- --file ./data/GBPUSD_H1.csv --symbol GBPUSD --timeframe 1h --dry-run
```

**Supported timeframes:** `1m` (aggregate-only), `5m`, `15m`, `30m`, `1h`, `4h`, `1d`

### Clear Trade Logs

```bash
# Preview trades to be deleted
npm run clear:trades -- --symbol EURUSD --source backtest --dry-run

# Delete with confirmation prompt
npm run clear:trades -- --symbol EURUSD --from 2024-01-01 --to 2024-03-31

# Delete all (requires --all flag)
npm run clear:trades -- --all --yes
```

## Manual Backtest CSV Format

```csv
symbol,direction,timeframe,entry_price,exit_price,entry_time,exit_time,result,reason,tp_price,sl_price,profit_usd,lot_size
EURUSD,BUY,1h,1.08500,1.09000,2024-01-02 10:00,2024-01-02 18:00,WIN,EMA cross + RSI oversold,1.09000,1.08200,50.00,0.1
```

See `data/backtest-sample.csv` for a full example with 15 trades.

## Project Structure

```
src/
├── agents/          # TradeLoggerAgent, MarketAnalyzerAgent
├── db/              # Connection, migrations (001-007)
├── importers/       # Mt4CsvParser, ManualBacktestParser, HistoricalIndicatorFetcher
├── repositories/    # CandleRepository, TradeRepository, ...
├── services/        # ClaudeAiService, EmbeddingService, CandleService, ...
│   └── market-data/ # TwelveDataAdapter, FinnhubAdapter
├── telegram/        # TelegramBotService, IntentRouter
└── types/           # market.ts, trade.ts, ...
scripts/
├── import-backtest.ts   # CLI: import backtest trades
├── import-candles.ts    # CLI: import historical candles
├── clear-trade-logs.ts  # CLI: delete trade logs with filters
└── set-telegram-webhook.ts
data/
├── backtest-sample.csv      # 15 sample manual backtest trades
└── EURUSD_M5_sample.csv     # 20 sample 5m candles
```

## License

MIT
