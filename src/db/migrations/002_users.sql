-- 002_users.sql
CREATE TABLE IF NOT EXISTS users (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username                 VARCHAR(100) NOT NULL UNIQUE,
  email                    VARCHAR(255) UNIQUE,
  alert_interval_minutes   INT DEFAULT 15,
  alert_enabled            BOOLEAN DEFAULT false,
  confidence_threshold     DECIMAL(4,2) DEFAULT 0.70,
  risk_level               VARCHAR(20) DEFAULT 'medium',  -- low / medium / high
  created_at               TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default single-user for MVP
INSERT INTO users (id, username)
VALUES ('00000000-0000-0000-0000-000000000001', 'default')
ON CONFLICT (id) DO NOTHING;
