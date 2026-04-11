# Forex AI Agent 🤖📈

A Telegram-based AI trading assistant for Forex traders. Log trades via natural language, get AI-powered market analysis, track performance, and import historical backtest data — all through a Telegram bot.

## Features

- **Trade Logging via Telegram** — Send a message like "เปิด BUY EURUSD ที่ 1.0850 TF 1h" and the bot extracts all fields using Claude AI (tool_use), asking follow-up questions for any missing data
- **AI Market Analysis** — On each trade entry, Claude analyzes multi-timeframe indicators and provides commentary in Thai
- **Daily Outlook (`/outlook`)** — Morning briefing that analyzes D1 → 4H → 1H trends, computes EMA pullback zones, identifies key S/R levels, and produces a Thai-language daily trading plan via Claude AI
- **Configurable Alerts (`/settings`)** — Inline keyboard to set daily outlook time (6–9 AM Bangkok), symbols (EURUSD / GBPUSD / USDJPY / XAUUSD), and enable/disable automatic scheduling
- **Trade Summary (`/summary`)** — AI-powered summary of closed trades for today, this week, this month, or last 30 days
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

| Command / Action | Description |
|-----------------|-------------|
| `BUY EURUSD 1.0850 TF 1h SL 1.0820 TP 1.0900` | Open (log) a new trade |
| `ปิด trade` or `close` | Close an existing trade via inline keyboard |
| `/summary` | AI summary of closed trades (today / week / month / last 30 days) |
| `/outlook` | Generate a Daily Outlook for configured symbols right now |
| `/settings` | Configure daily outlook: time, symbols, enable/disable auto-schedule |
| `/cancel` | Cancel the current multi-turn conversation |

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

## Daily Outlook Logic

When `/outlook` is called (or the scheduled cron fires), `DailyOutlookAgent` runs the following pipeline per symbol:

### Step 1 — Cache Check
If a record for today already exists in `daily_outlook_logs` and has been sent, the cached Telegram message is re-broadcast immediately without re-calling Claude.

### Step 2 — Multi-Timeframe Candle Fetch
Fetches up to 250 candles for `1h`, `4h`, and `1d` from the database (no force-refresh on scheduled runs).

### Step 3 — D1 Freshness Validation

| D1 candle age | Behaviour |
|---------------|----------|
| ≤ 26 h | Fresh — proceed normally |
| 26 h – 96 h | Weekend gap — proceed with log warning |
| > 96 h | Stale — skip symbol with error |

The 96-hour window covers the Friday close → Monday 7 AM Bangkok gap (~63 h).

### Step 4 — Trend Direction
Computed on D1 (macro trend) and 4H (primary trend) using the same EMA-stack + slope logic as `MarketAnalyzerAgent`.

### Step 5 — Pullback Zone Computation

| Zone | Formula | Meaning |
|------|---------|--------|
| **Primary** | EMA14 (4H) ± 0.5 × ATR14 | Frequent, shallower pullbacks |
| **Secondary** | EMA60 (4H) ± 1.0 × ATR14 | Deeper, higher-conviction entries |

### Step 6 — S/R from D1 Candles
Calls `IndicatorService.computeSupportResistance()` on the full D1 candle series to produce macro pivot points, swing highs/lows, and round levels.

### Step 7 — Claude AI Synthesis
`ClaudeAiService.generateDailyOutlook()` receives the full multi-TF indicator snapshot, S/R context, pullback zones, and risk level. It returns:

| Field | Description |
|-------|-------------|
| `bias` | `BUY` / `SELL` / `NEUTRAL` |
| `keyResistance` | Nearest resistance price |
| `keySupport` | Nearest support price |
| `analysis` | Narrative analysis in Thai |
| `tradingPlan` | Where to wait for pullback and entry trigger |

### Step 8 — Persist & Broadcast
The result is upserted into `daily_outlook_logs` (UNIQUE by `user_id + symbol + analysis_date`), then broadcast as MarkdownV2 via `NotificationService.broadcastDailyOutlook()` — which splits messages at 4096-char boundaries and falls back to plain text on parse errors.

---

## Project Structure

```
src/
├── agents/
│   ├── AutoAlertAgent.ts
│   ├── DailyOutlookAgent.ts   # Daily Outlook pipeline
│   ├── MarketAnalyzerAgent.ts
│   ├── TradeLoggerAgent.ts
│   └── TradeSummaryAgent.ts
├── db/
│   ├── migrations/            # 001–009 (009 adds daily_outlook_logs)
│   └── migrate.ts
├── importers/                 # Mt4CsvParser, ManualBacktestParser, HistoricalIndicatorFetcher
├── repositories/
│   ├── AlertRepository.ts
│   ├── CandleRepository.ts
│   ├── DailyOutlookRepository.ts  # create, markSent, findToday, findRecent
│   ├── IndicatorRepository.ts
│   ├── TradeLogRepository.ts
│   └── TradeResultRepository.ts
├── services/
│   ├── ClaudeAiService.ts     # generateAnalysisRecommendation + generateDailyOutlook
│   ├── NotificationService.ts # sendAlert + broadcastDailyOutlook
│   ├── SchedulerService.ts    # alert + candle + dailyOutlook cron tasks
│   └── market-data/           # TwelveDataAdapter, FinnhubAdapter
├── telegram/
│   ├── TelegramBotService.ts  # /outlook, /settings, /summary, trade commands
│   └── formatters.ts          # formatAnalysis, formatDailyOutlook, ...
└── types/                     # market.ts (PullbackZone, DailyOutlookData), trade.ts, agent.ts
scripts/
├── import-backtest.ts
├── import-candles.ts
├── clear-trade-logs.ts
└── set-telegram-webhook.ts
data/
├── backtest-sample.csv
└── EURUSD_M5_sample.csv
```

## License

MIT
