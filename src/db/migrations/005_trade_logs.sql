-- 005_trade_logs.sql
CREATE TABLE IF NOT EXISTS trade_logs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID REFERENCES users(id) ON DELETE CASCADE,
  symbol               VARCHAR(20) NOT NULL,
  direction            VARCHAR(10) NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  timeframe            VARCHAR(10) NOT NULL,
  entry_price          DECIMAL(10,5) NOT NULL,
  tp_price             DECIMAL(10,5),
  sl_price             DECIMAL(10,5),
  entry_time           TIMESTAMPTZ NOT NULL,
  -- User input
  user_reason          TEXT,
  indicators_used      JSONB DEFAULT '[]',
  user_analysis        TEXT,
  -- Auto-fetched market data
  market_snapshot      JSONB,
  indicators_snapshot  JSONB,
  ai_market_comment    TEXT,
  -- Vector embedding for similarity search (pgvector)
  embedding            vector(1536),
  status               VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- IVFFlat index for cosine similarity search
-- NOTE: Create this index only after accumulating 100+ rows for efficiency
-- CREATE INDEX ON trade_logs USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Regular indexes
CREATE INDEX IF NOT EXISTS idx_trade_logs_user_id   ON trade_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_trade_logs_symbol     ON trade_logs (symbol, entry_time DESC);
CREATE INDEX IF NOT EXISTS idx_trade_logs_status     ON trade_logs (status);
