CREATE TABLE IF NOT EXISTS telemetry (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS telemetry_device_time_idx ON telemetry (device_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS machines (
  device_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  machine_type TEXT NOT NULL DEFAULT 'Máquina agrícola',
  model TEXT,
  farm_name TEXT,
  current_operator TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_configs (
  device_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS safety_logs (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  severity TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS danger_zones (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  geometry JSONB NOT NULL,
  warning_m INTEGER NOT NULL DEFAULT 150,
  critical_m INTEGER NOT NULL DEFAULT 60,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_commands (
  device_id TEXT PRIMARY KEY,
  buzzer_active BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_locations (
  device_id TEXT PRIMARY KEY,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy_m DOUBLE PRECISION,
  source TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
