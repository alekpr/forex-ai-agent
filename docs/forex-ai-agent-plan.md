# 📋 แผนการพัฒนา Forex AI Agent System

> **เวอร์ชันเอกสาร:** 1.2.0  
> **วันที่:** มีนาคม 2026  
> **Stack หลัก:** Node.js, PostgreSQL + pgvector + TimescaleDB, Claude AI API

---

## 1. ภาพรวมระบบ (System Overview)

Forex AI Agent System คือแพลตฟอร์มที่ช่วยให้นักเทรด Forex วิเคราะห์ตลาด บันทึก Trade Log และรับการแจ้งเตือนสัญญาณเทรดอัตโนมัติ โดยใช้ AI เป็นแกนกลางในการประมวลผลและให้คำแนะนำ

### 1.1 สถาปัตยกรรมระบบโดยรวม

```
┌─────────────────────────────────────────────────────────────┐
│                     User Interface (Frontend)                │
│              (Web App / LINE Bot / Telegram Bot)             │
└───────────────────────────┬─────────────────────────────────┘
                            │ REST API / WebSocket
┌───────────────────────────▼─────────────────────────────────┐
│                  Node.js Backend (API Server)                │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │  Agent #1    │  │  Agent #2    │  │   Agent #3      │   │
│  │ Trade Logger │  │ Market       │  │ Auto Alert      │   │
│  │              │  │ Analyzer     │  │ (Scheduler)     │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬────────┘   │
│         │                 │                    │            │
│  ┌──────▼─────────────────▼────────────────────▼────────┐   │
│  │              Claude AI API (Anthropic)               │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │    Market Data Provider (OHLC Candles)              │   │
│  │  Phase 1-2: Finnhub (Free)                          │   │
│  │  Phase 3+:  Twelve Data ($8/เดือน)                  │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                    Database Layer                            │
│           PostgreSQL (Single Instance, 3 Extensions)        │
│  ┌──────────────────┐  ┌─────────────────┐  ┌───────────┐  │
│  │  Core Tables     │  │  TimescaleDB    │  │ pgvector  │  │
│  │  (Users, Trades, │  │  (OHLC Candles, │  │ (Semantic │  │
│  │   Results, Alerts│  │   Indicators,   │  │  Search   │  │
│  │                  │  │   Time-series)  │  │  Embeddings│ │
│  └──────────────────┘  └─────────────────┘  └───────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. AI Agents ทั้ง 3 ตัว

### 🤖 Agent #1 — Trade Logger Agent

**หน้าที่หลัก:** รับข้อมูลการเข้าเทรดจากผู้ใช้ ดึงข้อมูลตลาดจริง คำนวณ Technical Indicators และเก็บผลการเทรด

**Workflow:**

```
Step 1: รับข้อมูลจากผู้ใช้
  → Symbol (เช่น GBPUSD)
  → Timeframe ที่ใช้ตัดสินใจ (5m, 15m, 1h ฯลฯ)
  → Direction (Buy / Sell)
  → เหตุผลในการเข้าเทรด
  → Indicators ที่ใช้ (RSI, MACD, BB ฯลฯ)
  → TP / SL ที่ตั้งไว้
  → เวลาที่เข้าเทรด (Entry Time)

Step 2: Agent ดึงข้อมูลตลาดจริง (Auto)
  → ดึง OHLC Candle จาก Finnhub (Phase 1-2) หรือ Twelve Data (Phase 3+) ณ เวลาที่เข้าเทรด
  → คำนวณ Technical Indicators หลายๆ Timeframe (5m, 15m, 1h, 4h) ด้วย Node.js
  → บันทึก Market Context (Trend, Volatility, Spread ฯลฯ)

Step 3: AI วิเคราะห์ตลาด ณ เวลานั้น
  → ส่งข้อมูล Indicators + เหตุผลของผู้ใช้ให้ Claude AI วิเคราะห์
  → บันทึก AI Market Comment ไว้เป็น Reference

Step 4: สร้าง Vector Embedding (Auto)
  → สร้าง Trade Context Text จาก Symbol, Direction, Indicators, User Reason
  → ส่ง Text เข้า Embedding API → ได้ Vector 1536 มิติ
  → บันทึก Vector ลง Column `embedding` ใน trade_logs (pgvector)

Step 5: บันทึกผลการเทรด (Post-Trade)
  → รับผลจากผู้ใช้: Win / Loss / Break Even
  → ราคา Exit จริง, กำไร/ขาดทุน (Pips / USD)
  → เหตุผลการออกจากเทรดของผู้ใช้
  → AI สรุปบทเรียนจากเทรดครั้งนี้
```

---

### 🤖 Agent #2 — Market Analyzer Agent

**หน้าที่หลัก:** วิเคราะห์ตลาดปัจจุบัน + ดึงข้อมูลประวัติจาก Agent #1 เพื่อให้คำแนะนำการเข้าเทรด

**Workflow:**

```
Step 1: รับ Input จากผู้ใช้
  → Symbol ที่สนใจ
  → Timeframe หลักที่ใช้
  → ระดับความเสี่ยงที่รับได้

Step 2: ดึงข้อมูลปัจจุบัน (Real-time)
  → OHLC Candle หลาย Timeframe
  → คำนวณ Technical Indicators ครบชุด
  → Market Trend / Momentum / Volatility

Step 3: ค้นหา Trade ในอดีตที่คล้ายกัน (Vector Similarity Search)
  → สร้าง Embedding จากสถานการณ์ตลาดปัจจุบัน
  → ค้นหา Trade Log เก่าที่ Vector ใกล้เคียงที่สุด (pgvector)
  → ดึง Win Rate, TP/SL จริง, บทเรียนจาก Trade เหล่านั้น

Step 4: Claude AI สังเคราะห์ทุกอย่าง
  → วิเคราะห์โอกาส Buy / Sell / Wait
  → แนะนำ TP / SL ที่เหมาะสม (อิงจาก Similar Trades ในอดีต)
  → ระบุระดับความเสี่ยง (Risk Score) พร้อม Win Rate อ้างอิง
  → สรุปเหตุผลที่ชัดเจนให้ผู้ใช้ตัดสินใจ
```

---

### 🤖 Agent #3 — Auto Alert Agent

**หน้าที่หลัก:** รันอัตโนมัติในพื้นหลัง ตรวจสอบสัญญาณตลาดตามรอบเวลา และแจ้งเตือนผู้ใช้หากพบสัญญาณน่าสนใจ

**Workflow:**

```
Step 1: Scheduler ทำงานทุก X นาที (ผู้ใช้ตั้งได้)
  → ค่า default แนะนำ: 15 นาที, 30 นาที, 1 ชั่วโมง

Step 2: ทำงานเหมือน Agent #2 แบบอัตโนมัติ
  → ดึง Candle + คำนวณ Indicators
  → ดึงประวัติ Win Rate จาก DB
  → Claude AI วิเคราะห์สัญญาณ

Step 3: ตรวจสอบเงื่อนไขการแจ้งเตือน
  → ถ้า AI Confidence Score >= threshold ที่ตั้ง
  → ถ้าเงื่อนไข Indicator ตรงตามที่ผู้ใช้กำหนด

Step 4: ส่ง Notification
  → LINE Notify / Telegram Bot / Email
  → สรุปสัญญาณ + เหตุผล + แนะนำ TP/SL
  → Link ให้กดเข้ามาดูรายละเอียด
```

> ⚠️ **หมายเหตุ:** Agent #3 ควรพัฒนาเป็น Phase สุดท้าย หลังจาก Agent #1 และ #2 มีข้อมูลสะสมเพียงพอ

---

## 3. Market Data Provider

### 3.1 การเลือก Provider และกลยุทธ์ประหยัดต้นทุน

เนื่องจากระบบนี้คำนวณ Technical Indicators เองใน Node.js จึงต้องการเพียง **OHLC Candle Data** อย่างเดียว ไม่จำเป็นต้องใช้ Provider ที่มี Indicators API (เช่น FCS API) ซึ่งมีราคาสูงกว่า

**การประมาณ API calls ต่อวัน** (ดึงทุก 15 นาที, 4 Timeframe):
```
4 timeframes × 96 รอบ/วัน = 384 requests/วัน
```

| Provider | Free Limit | เพียงพอไหม? | Paid Plan |
|---|---|---|---|
| **Finnhub** ✅ | 60 req/นาที | ✅ สบายมาก | ไม่จำเป็น |
| **Twelve Data** | 800 req/วัน | ✅ เหลืออีก 416 | $8/เดือน |
| FCS API | 500 req/เดือน | ❌ หมดใน 2 วัน | $9.99/เดือน |

### 3.2 แผนการใช้ Provider ตาม Phase

```
Phase 1–2 (MVP / ทดสอบระบบ)
  → Finnhub Free Tier
  → ค่าใช้จ่าย: $0/เดือน
  → ข้อดี: ไม่มี Monthly cap, WebSocket ฟรี, เริ่มได้ทันที

Phase 3+ (มี User จริง / หลาย Symbol)
  → Twelve Data ($8/เดือน)
  → ข้อดี: Historical data ลึกกว่า, Multi-symbol ใน 1 request,
           Documentation ดีที่สุด, คุณภาพข้อมูลระดับ institutional
```

### 3.3 Abstraction Layer (รองรับการเปลี่ยน Provider)

ออกแบบ Service ให้รองรับการเปลี่ยน Provider โดยไม่กระทบ Code ส่วนอื่น:

```javascript
// src/services/marketDataService.js
// Abstract interface — เปลี่ยน Provider แค่ที่นี่ที่เดียว

const provider = process.env.MARKET_DATA_PROVIDER; // 'finnhub' | 'twelvedata'

async function getOHLCCandles(symbol, timeframe, limit = 200) {
  if (provider === 'twelvedata') {
    return await twelveDataAdapter.getCandles(symbol, timeframe, limit);
  }
  return await finnhubAdapter.getCandles(symbol, timeframe, limit);
}
```

---

## 4. Database Design

### 3.1 การเลือก Database

ใช้ **PostgreSQL instance เดียว** ติดตั้ง 3 Extensions รวมกัน เพื่อลดความซับซ้อนของ Infrastructure

| Extension | หน้าที่ | เหตุผล |
|---|---|---|
| **TimescaleDB** | เก็บ OHLC Candle, Indicators (Time-series) | รองรับ time-series query เร็ว มี Continuous Aggregates |
| **pgvector** | Vector Embedding สำหรับ Semantic Search | ค้นหา Trade Log ที่ "สถานการณ์คล้ายกัน" โดยไม่ต้องกำหนด filter ตายตัว |
| **PostgreSQL Core** | Users, Trade Logs, Trade Results, Alerts | Relational data ที่ต้องการ JOIN ซับซ้อน |

```sql
-- ติดตั้ง Extensions ทั้งหมดใน Database เดียว
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### 3.2 Vector Search คืออะไร และทำไมต้องใช้

แทนที่จะค้นหา Trade เก่าด้วย Filter แบบตายตัว เช่น `WHERE symbol = 'GBPUSD' AND timeframe = '15m'` ซึ่งอาจพลาด Trade ที่มีสถานการณ์คล้ายกันแต่ต่าง Timeframe — Vector Search จะแปลง "บริบทการเทรด" ทั้งหมดให้เป็นตัวเลข แล้วค้นหาสิ่งที่ "ใกล้เคียงกันที่สุด" ในเชิงความหมาย

**ตัวอย่าง Trade Context ที่จะแปลงเป็น Vector:**
```
"GBPUSD BUY 15m | Entry: 1.27450 | RSI=42 oversold | MACD bullish cross |
 EMA200 below price (uptrend) | BB squeeze breakout | ADX=28 trending |
 User reason: strong support bounce at 1.2740, targeting previous high"
```

ข้อความนี้จะถูกส่งไปยัง Embedding API → ได้ Vector 1536 มิติ → เก็บใน pgvector

**ตอนค้นหา:** สร้าง Embedding จากสถานการณ์ปัจจุบัน → หา Vector ที่ใกล้เคียงที่สุด → ได้ Trade เก่าที่สถานการณ์คล้ายกัน พร้อม Win/Loss result

```sql
-- ตัวอย่าง Query: หา 10 Trade ที่คล้ายสถานการณ์ปัจจุบัน และเคย WIN
SELECT
  tl.symbol, tl.direction, tl.timeframe,
  tl.entry_price, tl.tp_price, tl.sl_price,
  tl.user_reason,
  tr.result, tr.pips,
  1 - (tl.embedding <=> $1) AS similarity_score
FROM trade_logs tl
JOIN trade_results tr ON tl.id = tr.trade_log_id
WHERE tr.result = 'WIN'
  AND tl.user_id = $2
ORDER BY tl.embedding <=> $1  -- cosine distance
LIMIT 10;
```

### 3.3 เปรียบเทียบ: pgvector vs Dedicated Vector DB

| | **PostgreSQL + pgvector** ✅ | **Qdrant / Weaviate** |
|---|---|---|
| Vector Search | ✅ รองรับ | ✅ Native (เร็วกว่าเล็กน้อย) |
| JOIN กับ Trade Logs | ✅ ทำได้ใน Query เดียว | ❌ ต้องดึงข้าม 2 ระบบ |
| Time-series (Candle) | ✅ TimescaleDB | ❌ ต้องมี DB แยก |
| Scale รองรับ (Vectors) | ดีถึง ~5M rows | ไม่จำกัด |
| ความซับซ้อน Infra | ต่ำ (1 instance) | สูง (หลาย services) |
| เหมาะกับ Project นี้ | ✅ **แนะนำ** | เกินความจำเป็นสำหรับ MVP |

> 💡 **Migration Path:** ถ้าในอนาคตระบบขยายเป็น Multi-user หลักพันและมี Trade Logs หลักล้าน ค้อยย้าย Vector ส่วนเดียวไป Qdrant ได้ โดยไม่กระทบ Schema ที่เหลือ

---

### 3.4 Schema ทั้งหมด

#### Table: `users`
```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(100) NOT NULL UNIQUE,
  email         VARCHAR(255) UNIQUE,
  alert_interval_minutes INT DEFAULT 15,     -- ตั้งเวลา Agent #3
  alert_enabled BOOLEAN DEFAULT false,
  risk_level    VARCHAR(20) DEFAULT 'medium', -- low / medium / high
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

#### Table: `forex_candles` (TimescaleDB Hypertable)
```sql
CREATE TABLE forex_candles (
  time        TIMESTAMPTZ NOT NULL,
  symbol      VARCHAR(20) NOT NULL,   -- เช่น GBPUSD
  timeframe   VARCHAR(10) NOT NULL,   -- 5m, 15m, 1h, 4h, 1d
  open        DECIMAL(10,5),
  high        DECIMAL(10,5),
  low         DECIMAL(10,5),
  close       DECIMAL(10,5),
  volume      BIGINT,
  PRIMARY KEY (time, symbol, timeframe)
);

-- แปลงเป็น Hypertable (TimescaleDB)
SELECT create_hypertable('forex_candles', 'time');
```

#### Table: `forex_indicators`
```sql
CREATE TABLE forex_indicators (
  time        TIMESTAMPTZ NOT NULL,
  symbol      VARCHAR(20) NOT NULL,
  timeframe   VARCHAR(10) NOT NULL,
  -- Moving Averages
  ema_14      DECIMAL(10,5),
  ema_60      DECIMAL(10,5),
  ema_200     DECIMAL(10,5),
  sma_20      DECIMAL(10,5),
  -- Oscillators
  rsi_14      DECIMAL(6,2),
  macd_line   DECIMAL(10,5),
  macd_signal DECIMAL(10,5),
  macd_hist   DECIMAL(10,5),
  stoch_k     DECIMAL(6,2),
  stoch_d     DECIMAL(6,2),
  adx_14      DECIMAL(6,2),
  -- Volatility
  bb_upper    DECIMAL(10,5),
  bb_middle   DECIMAL(10,5),
  bb_lower    DECIMAL(10,5),
  atr_14      DECIMAL(10,5),
  PRIMARY KEY (time, symbol, timeframe)
);

SELECT create_hypertable('forex_indicators', 'time');
```

#### Table: `trade_logs`
```sql
CREATE TABLE trade_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id),
  symbol          VARCHAR(20) NOT NULL,
  direction       VARCHAR(10) NOT NULL,    -- BUY / SELL
  timeframe       VARCHAR(10) NOT NULL,    -- Timeframe หลักที่ใช้วิเคราะห์
  entry_price     DECIMAL(10,5),
  tp_price        DECIMAL(10,5),
  sl_price        DECIMAL(10,5),
  entry_time      TIMESTAMPTZ NOT NULL,
  -- ข้อมูลจากผู้ใช้
  user_reason     TEXT,                   -- เหตุผลที่เข้าเทรด
  indicators_used JSONB,                  -- ["RSI","MACD","BB"] ที่ผู้ใช้ดู
  user_analysis   TEXT,                   -- วิเคราะห์ของผู้ใช้เอง
  -- ข้อมูลตลาดจริง ณ เวลานั้น (Auto ดึงโดย Agent #1)
  market_snapshot JSONB,                  -- Candle OHLC ทุก Timeframe
  indicators_snapshot JSONB,              -- Indicator values ทุก Timeframe
  ai_market_comment TEXT,                 -- AI วิเคราะห์ตลาด ณ เวลานั้น
  -- Vector Embedding (pgvector) — สำหรับ Semantic Search
  embedding       vector(1536),           -- Claude/OpenAI Embedding ของ Trade Context
  -- Status
  status          VARCHAR(20) DEFAULT 'open',  -- open / closed
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Index สำหรับ Vector Similarity Search (IVFFlat — เร็วกว่า Sequential Scan)
CREATE INDEX ON trade_logs USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);  -- ปรับ lists ตามจำนวน rows (rows / 1000)
```

#### Table: `trade_results`
```sql
CREATE TABLE trade_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_log_id    UUID REFERENCES trade_logs(id) UNIQUE,
  result          VARCHAR(20) NOT NULL,    -- WIN / LOSS / BREAKEVEN
  exit_price      DECIMAL(10,5),
  exit_time       TIMESTAMPTZ,
  pips            DECIMAL(8,2),           -- กำไร/ขาดทุนเป็น pips
  profit_usd      DECIMAL(10,2),          -- กำไร/ขาดทุนเป็น USD
  -- Exit Market Data (Auto ดึงโดย Agent #1)
  exit_market_snapshot  JSONB,
  exit_indicators_snapshot JSONB,
  -- ข้อมูลจากผู้ใช้
  user_exit_reason TEXT,                  -- เหตุผลออกจากเทรด
  user_lesson      TEXT,                  -- บทเรียนที่ได้
  -- AI Summary
  ai_lesson        TEXT,                  -- AI สรุปบทเรียน
  ai_pattern_tags  JSONB,                 -- ["trend_following","breakout"] สำหรับ query ในอนาคต
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
```

#### Table: `ai_alerts`
```sql
CREATE TABLE ai_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id),
  symbol          VARCHAR(20) NOT NULL,
  timeframe       VARCHAR(10) NOT NULL,
  direction       VARCHAR(10),             -- BUY / SELL / WAIT
  confidence_score DECIMAL(4,2),           -- 0.00 - 1.00
  ai_analysis     TEXT,
  suggested_tp    DECIMAL(10,5),
  suggested_sl    DECIMAL(10,5),
  indicators_snapshot JSONB,
  is_sent         BOOLEAN DEFAULT false,   -- ส่ง Notification แล้วหรือยัง
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 4. Project Structure (Node.js)

```
forex-ai-agent/
├── src/
│   ├── agents/
│   │   ├── tradeLoggerAgent.js       # Agent #1
│   │   ├── marketAnalyzerAgent.js    # Agent #2
│   │   └── autoAlertAgent.js         # Agent #3
│   │
│   ├── services/
│   │   ├── marketDataService.js      # Abstract interface สำหรับดึง OHLC Candle
│   │   ├── adapters/
│   │   │   ├── finnhubAdapter.js     # Phase 1-2: Finnhub (Free)
│   │   │   └── twelveDataAdapter.js  # Phase 3+: Twelve Data ($8/เดือน)
│   │   ├── indicatorService.js       # คำนวณ Technical Indicators (technicalindicators lib)
│   │   ├── embeddingService.js       # สร้าง Vector Embedding จาก Trade Context
│   │   ├── vectorSearchService.js    # ค้นหา Similar Trades ด้วย pgvector
│   │   ├── claudeAiService.js        # เรียกใช้ Claude AI API
│   │   ├── notificationService.js    # ส่ง LINE / Telegram
│   │   └── schedulerService.js       # Cron Job สำหรับ Agent #3
│   │
│   ├── repositories/
│   │   ├── tradeLogRepository.js     # CRUD Trade Logs
│   │   ├── tradeResultRepository.js  # CRUD Trade Results
│   │   ├── candleRepository.js       # เก็บ/ดึง OHLC Candles
│   │   ├── indicatorRepository.js    # เก็บ/ดึง Indicators
│   │   └── alertRepository.js        # CRUD Alerts
│   │
│   ├── routes/
│   │   ├── tradeRoutes.js            # POST /trades, PUT /trades/:id/result
│   │   ├── analyzeRoutes.js          # POST /analyze
│   │   └── alertRoutes.js            # GET/PUT /alerts/settings
│   │
│   ├── db/
│   │   ├── connection.js             # PostgreSQL connection pool
│   │   └── migrations/               # SQL migration files
│   │
│   └── index.js                      # Entry point
│
├── .env
├── package.json
└── README.md
```

---

## 5. Technical Indicators ที่จะคำนวณ

ใช้ library **`technicalindicators`** (npm) คำนวณทั้งหมดใน Node.js

| หมวด | Indicators | Timeframe ที่คำนวณ |
|---|---|---|
| Trend | EMA 14, 60, 200 / SMA 20 | 5m, 15m, 1h, 4h |
| Momentum | RSI 14, Stochastic (14,3,3), ADX 14 | 5m, 15m, 1h, 4h |
| MACD | MACD (12,26,9) | 15m, 1h, 4h |
| Volatility | Bollinger Bands (20,2), ATR 14 | 15m, 1h, 4h |
| Pivot Points | Classic Pivot, S1/S2/R1/R2 | Daily |

---

## 6. Vector Search — การค้นหา Similar Trades

### 6.1 กระบวนการสร้าง Embedding

```javascript
// embeddingService.js
async function createTradeEmbedding(tradeLog, indicatorsSnapshot) {
  // สร้าง Trade Context Text
  const contextText = `
    ${tradeLog.symbol} ${tradeLog.direction} ${tradeLog.timeframe} |
    Entry: ${tradeLog.entry_price} | TP: ${tradeLog.tp_price} | SL: ${tradeLog.sl_price} |
    RSI(14): ${indicatorsSnapshot['15m'].rsi_14} |
    MACD: ${indicatorsSnapshot['15m'].macd_hist > 0 ? 'bullish' : 'bearish'} |
    EMA14: price ${tradeLog.entry_price > indicatorsSnapshot['4h'].ema_14 ? 'above' : 'below'} | EMA60: price ${tradeLog.entry_price > indicatorsSnapshot['4h'].ema_60 ? 'above' : 'below'} | EMA200: price ${tradeLog.entry_price > indicatorsSnapshot['4h'].ema_200 ? 'above' : 'below'} |
    ADX: ${indicatorsSnapshot['1h'].adx_14} |
    BB: ${getBBPosition(tradeLog.entry_price, indicatorsSnapshot)} |
    User reason: ${tradeLog.user_reason}
  `;

  // เรียก Claude Embedding API
  const response = await anthropic.embeddings.create({
    model: "voyage-3",  // หรือ text-embedding-3-small ของ OpenAI
    input: contextText
  });

  return response.embedding; // vector[1536]
}
```

### 6.2 กระบวนการ Vector Search ใน Agent #2

```javascript
// vectorSearchService.js
async function findSimilarTrades(currentEmbedding, userId, options = {}) {
  const { minSimilarity = 0.75, limit = 10, resultFilter } = options;

  const query = `
    SELECT
      tl.id, tl.symbol, tl.direction, tl.timeframe,
      tl.entry_price, tl.tp_price, tl.sl_price,
      tl.user_reason, tl.indicators_snapshot,
      tr.result, tr.pips, tr.profit_usd,
      tr.user_exit_reason, tr.ai_lesson,
      1 - (tl.embedding <=> $1) AS similarity_score
    FROM trade_logs tl
    JOIN trade_results tr ON tl.id = tr.trade_log_id
    WHERE tl.user_id = $2
      ${resultFilter ? `AND tr.result = '${resultFilter}'` : ''}
      AND 1 - (tl.embedding <=> $1) >= $3
    ORDER BY tl.embedding <=> $1
    LIMIT $4;
  `;

  return db.query(query, [currentEmbedding, userId, minSimilarity, limit]);
}
```

### 6.3 Use Cases ของ Vector Search ในระบบ

| Use Case | คำถามที่ตอบได้ |
|---|---|
| **Similar WIN Trades** | "ในอดีตที่ตลาดสถานการณ์แบบนี้ เคยชนะด้วย setup แบบไหน?" |
| **Similar LOSS Trades** | "เคยผิดพลาดอะไรในสถานการณ์แบบนี้บ้าง?" |
| **TP/SL Reference** | "Trade ที่คล้ายกันในอดีต ตั้ง TP/SL ไว้เท่าไหร่และได้ผลอย่างไร?" |
| **Pattern Recognition** | "รูปแบบนี้มี Win Rate เฉลี่ยเท่าไหร่จากประวัติทั้งหมด?" |

---

## 7. แผนการพัฒนา (Development Phases)

### Phase 1 — Foundation (สัปดาห์ที่ 1-2)
- [ ] Setup PostgreSQL + TimescaleDB + pgvector (3 Extensions)
- [ ] สร้าง Database Schema และ Migrations ครบทุก Table
- [ ] พัฒนา `fcsApiService.js` ดึง OHLC Candle
- [ ] พัฒนา `indicatorService.js` คำนวณ Indicators ทั้งหมด
- [ ] พัฒนา `embeddingService.js` สร้าง Vector จาก Trade Context
- [ ] Test การดึงและคำนวณข้อมูล GBPUSD ครบทุก Timeframe

### Phase 2 — Agent #1 (สัปดาห์ที่ 3-4)
- [ ] พัฒนา `tradeLoggerAgent.js`
- [ ] พัฒนา `claudeAiService.js` (Prompt สำหรับวิเคราะห์ตลาด)
- [ ] สร้าง API: `POST /trades` (บันทึก Trade Log + ดึงข้อมูล Auto + สร้าง Embedding)
- [ ] สร้าง API: `PUT /trades/:id/result` (บันทึกผลการเทรด)
- [ ] Test End-to-End การบันทึก + Embedding + AI Analysis

### Phase 3 — Agent #2 (สัปดาห์ที่ 5-6)
- [ ] พัฒนา `vectorSearchService.js`
- [ ] พัฒนา `marketAnalyzerAgent.js` พร้อม Vector Search
- [ ] Prompt Engineering: ส่ง Similar Trades + Win Rate ให้ Claude แนะนำ
- [ ] สร้าง API: `POST /analyze`
- [ ] Test ความแม่นยำของคำแนะนำเมื่อมีข้อมูล

### Phase 4 — Agent #3 (สัปดาห์ที่ 7-8)
- [ ] พัฒนา `schedulerService.js` (node-cron)
- [ ] พัฒนา `notificationService.js` (LINE / Telegram)
- [ ] สร้าง API สำหรับตั้งค่า Alert ของผู้ใช้
- [ ] Test Scheduler และ Notification

### Phase 5 — Optimization & UI (สัปดาห์ที่ 9+)
- [ ] Dashboard แสดงสถิติ Win/Loss Rate
- [ ] กราฟ Performance ตามเวลา
- [ ] Fine-tune AI Prompts จากข้อมูลจริง
- [ ] Tune IVFFlat Index (ปรับ `lists` ตามจำนวน Vectors ที่สะสม)

---

## 8. Dependencies หลัก (package.json)

```json
{
  "dependencies": {
    "express": "^5.x",
    "pg": "^8.x",
    "pgvector": "^0.x",
    "technicalindicators": "^3.x",
    "@anthropic-ai/sdk": "^0.x",
    "axios": "^1.x",
    "node-cron": "^3.x",
    "dotenv": "^16.x",
    "zod": "^3.x"
  }
}
```

---

## 9. Environment Variables (.env)

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/forex_agent

# Market Data Provider (เลือกอย่างใดอย่างหนึ่ง)
MARKET_DATA_PROVIDER=finnhub           # 'finnhub' (Phase 1-2) | 'twelvedata' (Phase 3+)

# Finnhub (Phase 1-2 — Free)
FINNHUB_API_KEY=your_finnhub_key
FINNHUB_BASE_URL=https://finnhub.io/api/v1

# Twelve Data (Phase 3+ — $8/เดือน)
TWELVEDATA_API_KEY=your_twelvedata_key
TWELVEDATA_BASE_URL=https://api.twelvedata.com

# Anthropic Claude AI
ANTHROPIC_API_KEY=your_anthropic_key
CLAUDE_MODEL=claude-sonnet-4-20250514

# Embedding Model (เลือกอย่างใดอย่างหนึ่ง)
EMBEDDING_PROVIDER=openai              # 'openai' แนะนำ (ถูกกว่า)
OPENAI_API_KEY=your_openai_key        # text-embedding-3-small (~$0.02/1M tokens)

# Notifications (Phase 4)
LINE_NOTIFY_TOKEN=your_line_token
TELEGRAM_BOT_TOKEN=your_telegram_token
TELEGRAM_CHAT_ID=your_chat_id

# Server
PORT=3000
NODE_ENV=development
```

---

## 10. ข้อควรระวังและ Best Practices

### Data Quality
- เก็บ Candle ย้อนหลังอย่างน้อย **200 bars** ก่อนคำนวณ Indicators เพื่อให้ค่า EMA 200 แม่นยำ
- ควร Cache ข้อมูล Candle ล่าสุดใน Memory เพื่อลด API calls ไปยัง Provider
- Finnhub และ Twelve Data ทั้งคู่รองรับ Historical Data เพียงพอสำหรับการ Backfill ข้อมูลเริ่มต้น

### Vector Search
- Vector Search จะมีประโยชน์จริงเมื่อมี Trade Log สะสมอย่างน้อย **50+ records**
- ควรสร้าง IVFFlat Index หลังจากมีข้อมูลครบ 100 rows ขึ้นไป (ก่อนหน้านั้นใช้ Sequential Scan แทน)
- `lists` parameter ของ Index ควรเท่ากับ `จำนวน rows / 1000` (เช่น 1,000 rows → lists = 1)

### AI Prompt Design
- ส่งข้อมูล Indicators หลาย Timeframe ให้ Claude พร้อมกัน เพื่อให้วิเคราะห์ Multi-timeframe Analysis ได้
- ส่ง Similar Trades (จาก Vector Search) พร้อม Win Rate และ AI Lesson เข้า Prompt เพื่อให้ AI อ้างอิงได้

### Cost Management

| รายการ | Phase 1-2 | Phase 3+ |
|---|---|---|
| Market Data (OHLC) | **Finnhub Free — $0** | Twelve Data — $8/เดือน |
| Claude AI | จ่ายตาม usage | จ่ายตาม usage |
| Embedding API | OpenAI ~$0.02/1M tokens | OpenAI ~$0.02/1M tokens |
| **รวม/เดือน** | **~$0–5** | **~$10–20** |

- ควรกำหนด `max_tokens` ให้เหมาะสมในแต่ละ Agent เพื่อควบคุมค่า Claude AI
- Agent #3 (Auto Alert): ไม่ควรรันถี่กว่า **15 นาที** เพื่อประหยัด API calls
- ใช้ `marketDataService.js` เป็น abstraction เพื่อให้เปลี่ยน Provider ได้โดยไม่ต้องแก้ Code

### Security
- ไม่เก็บ API Key ใน Code — ใช้ `.env` เสมอ
- ใช้ UUID สำหรับ Primary Key แทน Sequential ID
- Rate Limit ทุก Endpoint ที่เปิดให้ผู้ใช้เรียก

---

## 11. สรุป MVP ที่ควรทำก่อน

สำหรับ **MVP (Minimum Viable Product)** ให้ Focus ที่ Agent #1 + Agent #2 ก่อน โดย:

1. ผู้ใช้กรอก Trade Log → Agent #1 ดึงข้อมูลตลาดจริง + สร้าง Embedding + AI วิเคราะห์ → บันทึก DB
2. ผู้ใช้กรอกผลการเทรด → บันทึก + AI สรุปบทเรียน
3. ผู้ใช้ถามขอคำแนะนำ → Agent #2 ค้นหา Similar Trades (Vector Search) + ดึงข้อมูลปัจจุบัน → AI แนะนำ

เมื่อมีข้อมูลสะสมเพียงพอ (อย่างน้อย 30-50 Trades) ค่อยพัฒนา Agent #3

---

*เอกสารนี้เป็น Living Document ควรอัปเดตเมื่อมีการเปลี่ยนแปลงในการออกแบบระบบ*
