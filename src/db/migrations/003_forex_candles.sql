-- 003_forex_candles.sql
CREATE TABLE IF NOT EXISTS forex_candles (
  time        TIMESTAMPTZ NOT NULL,
  symbol      VARCHAR(20) NOT NULL,
  timeframe   VARCHAR(10) NOT NULL,
  open        DECIMAL(10,5),
  high        DECIMAL(10,5),
  low         DECIMAL(10,5),
  close       DECIMAL(10,5),
  volume      BIGINT,
  PRIMARY KEY (time, symbol, timeframe)
);

-- Convert to TimescaleDB hypertable partitioned by time
SELECT create_hypertable('forex_candles', 'time', if_not_exists => TRUE);

-- Index for fast symbol + timeframe queries
CREATE INDEX IF NOT EXISTS idx_forex_candles_symbol_tf
  ON forex_candles (symbol, timeframe, time DESC);
