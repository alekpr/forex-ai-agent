-- 004_forex_indicators.sql
CREATE TABLE IF NOT EXISTS forex_indicators (
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

SELECT create_hypertable('forex_indicators', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_forex_indicators_symbol_tf
  ON forex_indicators (symbol, timeframe, time DESC);
