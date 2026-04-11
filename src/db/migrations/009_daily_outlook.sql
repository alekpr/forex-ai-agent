-- 009_daily_outlook.sql
-- DailyOutlookAgent: daily market plan table + user settings columns

CREATE TABLE IF NOT EXISTS daily_outlook_logs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol                VARCHAR(20)     NOT NULL,
  analysis_date         DATE            NOT NULL,
  macro_trend           VARCHAR(10),                        -- bullish | bearish | mixed
  primary_trend         VARCHAR(10),                        -- bullish | bearish | mixed
  current_price         DECIMAL(10,5),
  primary_zone_low      DECIMAL(10,5),                      -- EMA14 4H pullback zone
  primary_zone_high     DECIMAL(10,5),
  secondary_zone_low    DECIMAL(10,5),                      -- EMA60 4H pullback zone
  secondary_zone_high   DECIMAL(10,5),
  key_resistance        DECIMAL(10,5),                      -- nearest resistance above price
  key_support           DECIMAL(10,5),                      -- nearest support below price
  adx_value             DECIMAL(6,2),
  bias                  VARCHAR(10),                        -- BUY | SELL | NEUTRAL
  ai_analysis           TEXT,                               -- Claude narrative in Thai
  trading_plan          TEXT,                               -- Claude actionable plan
  telegram_message_text TEXT,                               -- cached formatted message
  is_sent               BOOLEAN         NOT NULL DEFAULT false,
  sent_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  -- One record per user + symbol + day
  UNIQUE (user_id, symbol, analysis_date)
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daily_outlook_enabled  BOOLEAN             DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_outlook_hour     INTEGER             DEFAULT 7,
  ADD COLUMN IF NOT EXISTS daily_outlook_symbols  TEXT                DEFAULT 'EURUSD,GBPUSD';
