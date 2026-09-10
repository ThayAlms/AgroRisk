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
  customer_id TEXT,
  current_operator TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_registry (
  version TEXT PRIMARY KEY,
  algorithm TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  feature_names JSONB NOT NULL,
  dataset_hash TEXT NOT NULL,
  dataset_rows INTEGER NOT NULL,
  training_started_at TIMESTAMPTZ,
  training_ended_at TIMESTAMPTZ,
  validation_metrics JSONB NOT NULL,
  artifact JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS model_registry_status_idx ON model_registry (status, created_at DESC);

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

CREATE TABLE IF NOT EXISTS insurance_customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  email TEXT NOT NULL,
  document_masked TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  hectares INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  account_manager TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('farmer', 'sompo')),
  customer_id TEXT REFERENCES insurance_customers(id),
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS insurance_policies (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES insurance_customers(id),
  policy_number TEXT UNIQUE NOT NULL,
  coverage TEXT NOT NULL,
  insured_value NUMERIC(14,2) NOT NULL,
  annual_premium NUMERIC(14,2) NOT NULL,
  deductible NUMERIC(14,2) NOT NULL,
  starts_at DATE NOT NULL,
  ends_at DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS insurance_claims (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES insurance_customers(id),
  device_id TEXT,
  claim_number TEXT UNIQUE,
  kind TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  estimated_loss NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  confidence INTEGER,
  source TEXT NOT NULL DEFAULT 'telemetry',
  summary TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_risk_snapshots (
  customer_id TEXT PRIMARY KEY REFERENCES insurance_customers(id),
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  level TEXT NOT NULL CHECK (level IN ('BAIXO', 'MEDIO', 'ALTO', 'SEM_SINAL')),
  reason TEXT NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
