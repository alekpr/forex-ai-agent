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

## Market Analysis Logic

When a user requests an analysis (via Telegram or the `/analyze` API), `MarketAnalyzerAgent` runs the following pipeline:

### Step 1 — Multi-Timeframe Candle Fetch

Fetches 250 candles for **all four timeframes** (`5m`, `15m`, `1h`, `4h`) simultaneously from the market data API (TwelveData / Finnhub). Also pulls the last 50 DB-stored candles for Claude's candlestick context.

### Step 2 — Indicator Computation

For each timeframe, `IndicatorService.computeIndicators()` calculates:

| Indicator | Library | Notes |
|-----------|---------|-------|
| EMA 14 / 60 / 200 | `technicalindicators` | Includes `ema_14_prev` / `ema_60_prev` (value 3 bars ago) for slope detection |
| SMA 20 | `technicalindicators` | |
| RSI 14 | `technicalindicators` | |
| MACD (12/26/9) | `technicalindicators` | Line, signal, histogram |
| Stochastic (14/3/3) | `technicalindicators` | %K and %D |
| ADX 14 | `technicalindicators` | Trend strength |
| Bollinger Bands (20,2) | `technicalindicators` | Upper / middle / lower |
| ATR 14 | `technicalindicators` | Used for SL enforcement and proximity checks |

### Step 3 — Trend Direction (EMA Stack + Slope)

`getTrendDirection()` requires **both** stack alignment **and** slope confirmation:

```
Bullish  : EMA14 > EMA60 > EMA200  AND  EMA14 & EMA60 are rising (slope > 0)
Bearish  : EMA14 < EMA60 < EMA200  AND  EMA14 & EMA60 are falling (slope < 0)
Mixed    : Stack not aligned  OR  slopes conflict direction (flattening / transitioning)
```

> Slope is computed by comparing the current EMA value against the value **3 bars ago**. A bullish stack with both EMAs flattening is downgraded to `mixed` to avoid entering during momentum exhaustion.

### Step 4 — Timeframe Hierarchy & Confluence Rules

Each entry timeframe maps to a **macro TF** (overall bias) and a **primary TF** (momentum confirmation):

| Entry TF | Macro TF | Primary TF |
|----------|----------|------------|
| 5m | 1h | 15m |
| 15m | 4h | 1h |
| 1h | 4h | 4h |
| 4h | 4h | 4h |

`analyzeTrendConfluence()` applies the following rules to adjust Claude's raw confidence score:

| Condition | Confidence Adjustment | Min RR |
|-----------|----------------------|--------|
| Macro TF conflicts primary TF | −0.10 | — |
| Trade direction counters primary trend | −0.10 | 1:1.0 |
| Trade direction follows primary trend | — | 1:1.5 |

The initial direction bias is derived from the **macro TF trend** before calling Claude, so Claude receives a meaningful pre-evaluated confluence summary in its prompt instead of a placeholder.

### Step 5 — Support / Resistance Detection

`computeSupportResistance()` builds the S/R context from three sources:

1. **Pivot Points** — Classic PP / R1–R3 / S1–S3 derived from the most recent completed candle
2. **Swing High / Low** — Highest and lowest close within a ±5-bar window, applied across the last 100 candles
3. **Round Numbers** — Levels at the nearest 0.0005, 0.001, 0.005, 0.01, 0.1 increments above and below price

All levels within **ATR × 3** of the current price are retained, then de-duplicated and ranked by `strength` (`strong` / `moderate` / `weak`). The final `keyLevels` list is sent to Claude as positional context.

### Step 6 — Claude AI Synthesis

`ClaudeAiService.generateAnalysisRecommendation()` sends Claude a structured prompt containing:

- Multi-TF indicator snapshot
- Pre-evaluated confluence summary (macro trend, primary trend, entry quality, required RR)
- S/R key levels with source and strength
- Recent similar trades from the vector store (for win-rate context)
- Last 50 candles in text form (candlestick context)

Claude returns: `recommendation` (BUY / SELL / WAIT), `confidence` (0–1), `suggestedTp`, `suggestedSl`, `riskScore`, and `analysis` text.

### Step 7 — Post-Claude Corrections

After receiving Claude's recommendation, three validation passes are applied in sequence:

#### 7a — Confidence Re-evaluation
If Claude's recommendation disagrees with the initial macro-bias direction, `analyzeTrendConfluence()` is called again with Claude's actual direction to apply the correct penalty. The final confidence is capped at **0.95**.

#### 7b — ATR SL Enforcement
```
SL distance < 1.0 × ATR  →  push SL out to exactly 1.0 × ATR (too tight, trivially stopped)
SL distance > 2.5 × ATR  →  log warning (allowed — Claude may have structural reason)
```

#### 7c — S/R SL / TP Placement Validation
- **SL**: If a support (for BUY) or resistance (for SELL) level sits between the entry price and the suggested SL, the SL is snapped to just beyond that level (±1 pip buffer) so the position is not closed before the key level is actually broken.
- **TP**: If a strong or moderate S/R level lies within **60% of the TP distance**, a warning is logged — the level may act as a barrier and stall the move before TP is reached.

#### 7d — Minimum RR Enforcement
If the final TP / SL produce a reward:risk below `minRR` (1.5 follow-trend, 1.0 counter-trend), TP is recalculated to achieve exactly `minRR`:

```
requiredReward = |entry − finalSl| × minRR
adjustedTp    = entry ± requiredReward
```

### Analysis Output

| Field | Description |
|-------|-------------|
| `recommendation` | `BUY` / `SELL` / `WAIT` |
| `confidence` | 0–0.95, post-adjustments |
| `suggestedTp` | ATR+S/R+RR-validated take-profit |
| `suggestedSl` | ATR+S/R-validated stop-loss |
| `riskScore` | Claude's risk assessment (1–10) |
| `aiAnalysis` | Full Claude commentary (Thai/English) |
| `winRate` | Historical win rate from similar trades (vector search) |

---

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
