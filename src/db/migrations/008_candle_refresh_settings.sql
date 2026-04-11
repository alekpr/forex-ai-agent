-- 008_candle_refresh_settings.sql
-- Separate candle refresh config from alert config

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS candle_refresh_enabled        BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS candle_refresh_interval_minutes INT DEFAULT 15;
