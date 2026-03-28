-- 006_trade_results_alerts.sql

-- Trade Results
CREATE TABLE IF NOT EXISTS trade_results (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_log_id               UUID REFERENCES trade_logs(id) ON DELETE CASCADE UNIQUE,
  result                     VARCHAR(20) NOT NULL CHECK (result IN ('WIN', 'LOSS', 'BREAKEVEN')),
  exit_price                 DECIMAL(10,5),
  exit_time                  TIMESTAMPTZ,
  pips                       DECIMAL(8,2),
  profit_usd                 DECIMAL(10,2),
  -- Exit market data
  exit_market_snapshot       JSONB,
  exit_indicators_snapshot   JSONB,
  -- User input
  user_exit_reason           TEXT,
  user_lesson                TEXT,
  -- AI summary
  ai_lesson                  TEXT,
  ai_pattern_tags            JSONB DEFAULT '[]',
  created_at                 TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_results_trade_log_id ON trade_results (trade_log_id);
CREATE INDEX IF NOT EXISTS idx_trade_results_result        ON trade_results (result);

-- AI Alerts
CREATE TABLE IF NOT EXISTS ai_alerts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  symbol              VARCHAR(20) NOT NULL,
  timeframe           VARCHAR(10) NOT NULL,
  direction           VARCHAR(10) CHECK (direction IN ('BUY', 'SELL', 'WAIT')),
  confidence_score    DECIMAL(4,2),
  ai_analysis         TEXT,
  suggested_tp        DECIMAL(10,5),
  suggested_sl        DECIMAL(10,5),
  indicators_snapshot JSONB,
  is_sent             BOOLEAN DEFAULT false,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_alerts_user_id  ON ai_alerts (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_alerts_is_sent  ON ai_alerts (is_sent, created_at DESC);
