-- 007_backtest_source.sql
-- Add source column to trade_logs to distinguish live trades from backtest imports
ALTER TABLE trade_logs
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'live'
    CHECK (source IN ('live', 'backtest'));

CREATE INDEX IF NOT EXISTS idx_trade_logs_source ON trade_logs (source);
