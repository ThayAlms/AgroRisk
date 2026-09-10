const DEFAULT_CONFIG = {
  geofence: { latitude: -23.56318, longitude: -46.65409, radiusMeters: 400 },
  distanceAlertCm: 30,
  tiltAlertDegrees: 15,
  dangerZones: { warningDistanceMeters: 150, criticalDistanceMeters: 60 },
};

const DEMO_PASSWORD = '123456789';
const DEMO_CUSTOMERS = [
  { id: 'cust-farm-001', name: 'Fazenda Santa Helena', ownerName: 'Rafael Almeida', email: 'donodafazenda@sompo.com', document: '***.482.***-**', city: 'Sorriso', state: 'MT', hectares: 4280, manager: 'Camila Rocha', status: 'active' },
  { id: 'cust-farm-002', name: 'Grupo Vale Verde', ownerName: 'Ana Prado', email: 'ana.prado@valeverde.demo', document: '**.***.731/****-**', city: 'Lucas do Rio Verde', state: 'MT', hectares: 7350, manager: 'Camila Rocha', status: 'active' },
  { id: 'cust-farm-003', name: 'Agropecuária Horizonte', ownerName: 'Carlos Mendonça', email: 'carlos@horizonte.demo', document: '**.***.905/****-**', city: 'Rio Verde', state: 'GO', hectares: 5920, manager: 'Eduardo Mota', status: 'active' },
  { id: 'cust-farm-004', name: 'Fazenda Boa Safra', ownerName: 'Fernanda Costa', email: 'fernanda@boasafra.demo', document: '***.927.***-**', city: 'Luís Eduardo Magalhães', state: 'BA', hectares: 3150, manager: 'Eduardo Mota', status: 'active' },
];
const DEMO_POLICIES = [
  { id: 'pol-001', customerId: 'cust-farm-001', number: 'AGR-2026-00184', coverage: 'Máquinas, incêndio e responsabilidade civil', insured: 18750000, premium: 412500, deductible: 750000, starts: '2026-01-01', ends: '2026-12-31', status: 'active' },
  { id: 'pol-002', customerId: 'cust-farm-002', number: 'AGR-2026-00231', coverage: 'Patrimônio rural e máquinas', insured: 32600000, premium: 695000, deductible: 1200000, starts: '2026-02-15', ends: '2027-02-14', status: 'active' },
  { id: 'pol-003', customerId: 'cust-farm-003', number: 'AGR-2026-00307', coverage: 'Máquinas e interrupção operacional', insured: 24100000, premium: 538000, deductible: 900000, starts: '2026-03-01', ends: '2027-02-28', status: 'active' },
  { id: 'pol-004', customerId: 'cust-farm-004', number: 'AGR-2026-00412', coverage: 'Patrimônio rural, máquinas e incêndio', insured: 14800000, premium: 326000, deductible: 600000, starts: '2026-04-10', ends: '2027-04-09', status: 'active' },
];
const DEMO_CLAIMS = [
  { id: 'evt-001', customerId: 'cust-farm-002', deviceId: 'pulverizador-vv-03', number: null, kind: 'Possível tombamento', occurredAt: '2026-09-09T14:32:00Z', loss: 680000, status: 'triage', confidence: 86, source: 'telemetry', summary: 'Inclinação crítica combinada com desaceleração abrupta.' },
  { id: 'evt-002', customerId: 'cust-farm-003', deviceId: 'trator-hz-11', number: 'SIN-2026-00842', kind: 'Colisão com obstáculo', occurredAt: '2026-09-07T18:14:00Z', loss: 410000, status: 'investigating', confidence: 72, source: 'telemetry', summary: 'Proximidade crítica e acionamento contínuo do alarme físico.' },
  { id: 'evt-003', customerId: 'cust-farm-001', deviceId: 'colheitadeira-01', number: null, kind: 'Desvio operacional', occurredAt: '2026-09-10T16:48:00Z', loss: 145000, status: 'monitoring', confidence: 61, source: 'risk-engine', summary: 'Recorrência de risco médio sem confirmação de dano material.' },
];
const DEMO_RISKS = [
  { customerId: 'cust-farm-001', score: 48, level: 'MEDIO', reason: 'Recorrência de alertas operacionais na colheitadeira monitorada.' },
  { customerId: 'cust-farm-002', score: 78, level: 'ALTO', reason: 'Inclinação crítica e possível evento de tombamento em triagem.' },
  { customerId: 'cust-farm-003', score: 64, level: 'ALTO', reason: 'Sinistro em investigação com exposição operacional persistente.' },
  { customerId: 'cust-farm-004', score: 22, level: 'BAIXO', reason: 'Operação dentro dos parâmetros contratados.' },
];

const memory = globalThis.__agroRiskMemory || {
  telemetry: [], configs: new Map(), logs: [], zones: [], commands: new Map(), locations: new Map(), machines: new Map(), users: new Map(),
};
globalThis.__agroRiskMemory = memory;
if (!memory.machines) memory.machines = new Map();
if (!memory.users) memory.users = new Map();

let sqlClient;
let schemaPromise;

function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

function sql() {
  if (!sqlClient) {
    const { neon } = require('@neondatabase/serverless');
    sqlClient = neon(process.env.DATABASE_URL);
  }
  return sqlClient;
}

async function seedDemoData(query) {
  const { hashPassword } = require('./security');
  for (const customer of DEMO_CUSTOMERS) {
    await query`INSERT INTO insurance_customers
      (id, name, owner_name, email, document_masked, city, state, hectares, status, account_manager)
      VALUES (${customer.id}, ${customer.name}, ${customer.ownerName}, ${customer.email}, ${customer.document}, ${customer.city}, ${customer.state}, ${customer.hectares}, 'active', ${customer.manager})
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, owner_name=EXCLUDED.owner_name, email=EXCLUDED.email,
        document_masked=EXCLUDED.document_masked, city=EXCLUDED.city, state=EXCLUDED.state,
        hectares=EXCLUDED.hectares, account_manager=EXCLUDED.account_manager`;
  }

  const demoUsers = [
    { id: 'user-farmer-demo', email: 'donodafazenda@sompo.com', name: 'Rafael Almeida', role: 'farmer', customerId: 'cust-farm-001' },
    { id: 'user-sompo-demo', email: 'sompo@sompo.com', name: 'Equipe Sompo Agro', role: 'sompo', customerId: null },
  ];
  for (const user of demoUsers) {
    const passwordHash = hashPassword(DEMO_PASSWORD);
    await query`INSERT INTO app_users (id, email, name, role, customer_id, password_hash, active)
      VALUES (${user.id}, ${user.email}, ${user.name}, ${user.role}, ${user.customerId}, ${passwordHash}, TRUE)
      ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role,
        customer_id=EXCLUDED.customer_id, password_hash=EXCLUDED.password_hash, active=TRUE`;
  }

  for (const policy of DEMO_POLICIES) {
    await query`INSERT INTO insurance_policies
      (id, customer_id, policy_number, coverage, insured_value, annual_premium, deductible, starts_at, ends_at, status)
      VALUES (${policy.id}, ${policy.customerId}, ${policy.number}, ${policy.coverage}, ${policy.insured}, ${policy.premium}, ${policy.deductible}, ${policy.starts}, ${policy.ends}, 'active')
      ON CONFLICT (id) DO UPDATE SET coverage=EXCLUDED.coverage, insured_value=EXCLUDED.insured_value,
        annual_premium=EXCLUDED.annual_premium, deductible=EXCLUDED.deductible,
        starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at, status=EXCLUDED.status`;
  }

  for (const claim of DEMO_CLAIMS) {
    await query`INSERT INTO insurance_claims
      (id, customer_id, device_id, claim_number, kind, occurred_at, estimated_loss, status, confidence, source, summary)
      VALUES (${claim.id}, ${claim.customerId}, ${claim.deviceId}, ${claim.number}, ${claim.kind}, ${claim.occurredAt}, ${claim.loss}, ${claim.status}, ${claim.confidence}, ${claim.source}, ${claim.summary})
      ON CONFLICT (id) DO UPDATE SET estimated_loss=EXCLUDED.estimated_loss, status=EXCLUDED.status,
        confidence=EXCLUDED.confidence, summary=EXCLUDED.summary`;
  }

  for (const risk of DEMO_RISKS) {
    await query`INSERT INTO customer_risk_snapshots (customer_id, score, level, reason, evaluated_at)
      VALUES (${risk.customerId}, ${risk.score}, ${risk.level}, ${risk.reason}, NOW())
      ON CONFLICT (customer_id) DO UPDATE SET score=EXCLUDED.score, level=EXCLUDED.level,
        reason=EXCLUDED.reason, evaluated_at=EXCLUDED.evaluated_at`;
  }
  await query`UPDATE machines SET customer_id = 'cust-farm-001' WHERE customer_id IS NULL`;
}

async function ensureSchema() {
  if (!hasDatabase()) return;
  if (!schemaPromise) schemaPromise = (async () => {
    const query = sql();
    await query`CREATE TABLE IF NOT EXISTS telemetry (
      id BIGSERIAL PRIMARY KEY,
      device_id TEXT NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      payload JSONB NOT NULL
    )`;
    await query`CREATE INDEX IF NOT EXISTS telemetry_device_time_idx ON telemetry (device_id, recorded_at DESC)`;
    await query`CREATE TABLE IF NOT EXISTS machines (
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
    )`;
    await query`ALTER TABLE machines ADD COLUMN IF NOT EXISTS customer_id TEXT`;
    await query`CREATE TABLE IF NOT EXISTS model_registry (
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
    )`;
    await query`CREATE INDEX IF NOT EXISTS model_registry_status_idx ON model_registry (status, created_at DESC)`;
    await query`CREATE TABLE IF NOT EXISTS device_configs (
      device_id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await query`CREATE TABLE IF NOT EXISTS safety_logs (
      id BIGSERIAL PRIMARY KEY,
      device_id TEXT NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      severity TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb
    )`;
    await query`CREATE INDEX IF NOT EXISTS safety_logs_device_time_idx ON safety_logs (device_id, recorded_at DESC)`;
    await query`CREATE TABLE IF NOT EXISTS danger_zones (
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
    )`;
    await query`CREATE INDEX IF NOT EXISTS danger_zones_device_idx ON danger_zones (device_id, enabled)`;
    await query`CREATE TABLE IF NOT EXISTS device_commands (
      device_id TEXT PRIMARY KEY,
      buzzer_active BOOLEAN NOT NULL DEFAULT FALSE,
      reason TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await query`CREATE TABLE IF NOT EXISTS device_locations (
      device_id TEXT PRIMARY KEY,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      accuracy_m DOUBLE PRECISION,
      source TEXT NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await query`CREATE TABLE IF NOT EXISTS insurance_customers (
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
    )`;
    await query`CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('farmer', 'sompo')),
      customer_id TEXT REFERENCES insurance_customers(id),
      password_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await query`CREATE TABLE IF NOT EXISTS insurance_policies (
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
    )`;
    await query`CREATE TABLE IF NOT EXISTS insurance_claims (
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
    )`;
    await query`CREATE TABLE IF NOT EXISTS customer_risk_snapshots (
      customer_id TEXT PRIMARY KEY REFERENCES insurance_customers(id),
      score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
      level TEXT NOT NULL CHECK (level IN ('BAIXO', 'MEDIO', 'ALTO', 'SEM_SINAL')),
      reason TEXT NOT NULL,
      evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await seedDemoData(query);
  })();
  return schemaPromise;
}

async function getConfig(deviceId) {
  await ensureSchema();
  if (!hasDatabase()) return memory.configs.get(deviceId) || structuredClone(DEFAULT_CONFIG);
  const rows = await sql()`SELECT payload FROM device_configs WHERE device_id = ${deviceId}`;
  return rows[0]?.payload || structuredClone(DEFAULT_CONFIG);
}

async function saveConfig(deviceId, config) {
  await ensureSchema();
  if (!hasDatabase()) { memory.configs.set(deviceId, config); return config; }
  const json = JSON.stringify(config);
  await sql()`INSERT INTO device_configs (device_id, payload, updated_at) VALUES (${deviceId}, ${json}::jsonb, NOW())
    ON CONFLICT (device_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`;
  return config;
}

async function saveTelemetry(deviceId, payload) {
  await ensureSchema();
  if (!hasDatabase()) {
    memory.telemetry.push({ deviceId, recordedAt: payload.timestamp || new Date().toISOString(), payload });
    if (memory.telemetry.length > 2000) memory.telemetry.shift();
    return payload;
  }
  const json = JSON.stringify(payload);
  await sql()`INSERT INTO telemetry (device_id, recorded_at, payload) VALUES (${deviceId}, ${payload.timestamp || new Date().toISOString()}, ${json}::jsonb)`;
  return payload;
}

async function getLatestTelemetry(deviceId) {
  await ensureSchema();
  if (!hasDatabase()) return memory.telemetry.filter((row) => row.deviceId === deviceId).at(-1)?.payload || null;
  const rows = await sql()`SELECT payload FROM telemetry WHERE device_id = ${deviceId} ORDER BY recorded_at DESC LIMIT 1`;
  return rows[0]?.payload || null;
}

async function listTelemetry(deviceId, limit = 50) {
  await ensureSchema();
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
  if (!hasDatabase()) return memory.telemetry.filter((row) => row.deviceId === deviceId).slice(-safeLimit).map((row) => row.payload);
  const rows = await sql()`SELECT payload FROM telemetry WHERE device_id = ${deviceId} ORDER BY recorded_at DESC LIMIT ${safeLimit}`;
  return rows.reverse().map((row) => row.payload);
}

async function listTelemetryDataset(limit = 50000) {
  await ensureSchema();
  const safeLimit = Math.min(Math.max(Number(limit) || 50000, 100), 200000);
  if (!hasDatabase()) return memory.telemetry.slice(-safeLimit).map((row) => ({ deviceId: row.deviceId, recordedAt: row.recordedAt, payload: row.payload }));
  const rows = await sql()`SELECT device_id, recorded_at, payload FROM telemetry ORDER BY recorded_at ASC LIMIT ${safeLimit}`;
  return rows.map((row) => ({ deviceId: row.device_id, recordedAt: row.recorded_at, payload: row.payload }));
}

function modelFromRow(row) {
  if (!row) return null;
  return {
    version: row.version, algorithm: row.algorithm, target: row.target, status: row.status,
    featureNames: row.feature_names, datasetHash: row.dataset_hash, datasetRows: row.dataset_rows,
    trainingStartedAt: row.training_started_at, trainingEndedAt: row.training_ended_at,
    validationMetrics: row.validation_metrics, artifact: row.artifact, createdAt: row.created_at,
  };
}

async function saveModelVersion(model) {
  await ensureSchema();
  if (!hasDatabase()) {
    memory.models = memory.models || new Map();
    if (model.status === 'active') for (const item of memory.models.values()) if (item.status === 'active') item.status = 'archived';
    memory.models.set(model.version, structuredClone(model));
    return model;
  }
  if (model.status === 'active') await sql()`UPDATE model_registry SET status = 'archived' WHERE status = 'active'`;
  const features = JSON.stringify(model.featureNames); const metrics = JSON.stringify(model.validationMetrics); const artifact = JSON.stringify(model.artifact);
  const rows = await sql()`INSERT INTO model_registry
    (version, algorithm, target, status, feature_names, dataset_hash, dataset_rows, training_started_at, training_ended_at, validation_metrics, artifact)
    VALUES (${model.version}, ${model.algorithm}, ${model.target}, ${model.status}, ${features}::jsonb, ${model.datasetHash}, ${model.datasetRows}, ${model.trainingStartedAt}, ${model.trainingEndedAt}, ${metrics}::jsonb, ${artifact}::jsonb)
    ON CONFLICT (version) DO UPDATE SET status=EXCLUDED.status, validation_metrics=EXCLUDED.validation_metrics, artifact=EXCLUDED.artifact
    RETURNING *`;
  return modelFromRow(rows[0]);
}

async function getActiveModel() {
  await ensureSchema();
  if (!hasDatabase()) {
    const models = [...(memory.models?.values() || [])].filter((model) => model.status === 'active');
    return models.at(-1) || null;
  }
  const rows = await sql()`SELECT * FROM model_registry WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`;
  return modelFromRow(rows[0]);
}

async function getLatestModel() {
  await ensureSchema();
  if (!hasDatabase()) {
    const models = [...(memory.models?.values() || [])];
    return models.at(-1) || null;
  }
  const rows = await sql()`SELECT * FROM model_registry ORDER BY created_at DESC LIMIT 1`;
  return modelFromRow(rows[0]);
}

async function addAnalysisAuditLog(deviceId, details) {
  const fingerprint = details.fingerprint;
  await ensureSchema();
  if (!hasDatabase()) {
    const found = memory.logs.find((entry) => entry.deviceId === deviceId && entry.type === 'ai-explanation' && entry.details?.fingerprint === fingerprint);
    return found || addSafetyLog(deviceId, 'info', 'ai-explanation', 'Explicação analítica gerada', details);
  }
  const found = await sql()`SELECT id, recorded_at, severity, event_type, message, details FROM safety_logs
    WHERE device_id = ${deviceId} AND event_type = 'ai-explanation' AND details->>'fingerprint' = ${fingerprint} LIMIT 1`;
  if (found[0]) return { id: String(found[0].id), timestamp: found[0].recorded_at, severity: found[0].severity, type: found[0].event_type, message: found[0].message, details: found[0].details };
  return addSafetyLog(deviceId, 'info', 'ai-explanation', 'Explicação analítica gerada', details);
}

function machineFromRow(row) {
  return {
    deviceId: row.device_id,
    customerId: row.customer_id || null,
    name: row.name || row.device_id,
    type: row.machine_type || 'Máquina agrícola',
    model: row.model || '',
    farmName: row.farm_name || '',
    currentOperator: row.current_operator || '',
    notes: row.notes || '',
    active: row.active !== false,
    latest: row.payload || null,
    lastSeenAt: row.recorded_at || row.payload?.timestamp || null,
  };
}

async function listMachines(customerId = null) {
  await ensureSchema();
  if (!hasDatabase()) {
    const ids = new Set([...memory.machines.keys(), ...memory.telemetry.map((row) => row.deviceId)]);
    return [...ids].map((deviceId) => {
      const metadata = memory.machines.get(deviceId) || {};
      const telemetry = memory.telemetry.filter((row) => row.deviceId === deviceId).at(-1);
      return {
        deviceId, name: metadata.name || deviceId, type: metadata.type || 'Máquina agrícola',
        customerId: metadata.customerId || 'cust-farm-001',
        model: metadata.model || '', farmName: metadata.farmName || '',
        currentOperator: metadata.currentOperator || '', notes: metadata.notes || '',
        active: metadata.active !== false, latest: telemetry?.payload || null,
        lastSeenAt: telemetry?.recordedAt || null,
      };
    });
  }
  const rows = customerId ? await sql()`WITH latest AS (
      SELECT DISTINCT ON (device_id) device_id, payload, recorded_at
      FROM telemetry ORDER BY device_id, recorded_at DESC
    )
    SELECT COALESCE(m.device_id, latest.device_id) AS device_id,
      m.name, m.machine_type, m.model, m.farm_name, COALESCE(m.customer_id, 'cust-farm-001') AS customer_id, m.current_operator, m.notes,
      COALESCE(m.active, TRUE) AS active, latest.payload, latest.recorded_at
    FROM machines m FULL OUTER JOIN latest ON latest.device_id = m.device_id
    WHERE COALESCE(m.customer_id, 'cust-farm-001') = ${customerId}` : await sql()`WITH latest AS (
      SELECT DISTINCT ON (device_id) device_id, payload, recorded_at
      FROM telemetry ORDER BY device_id, recorded_at DESC
    )
    SELECT COALESCE(m.device_id, latest.device_id) AS device_id,
      m.name, m.machine_type, m.model, m.farm_name, COALESCE(m.customer_id, 'cust-farm-001') AS customer_id, m.current_operator, m.notes,
      COALESCE(m.active, TRUE) AS active, latest.payload, latest.recorded_at
    FROM machines m FULL OUTER JOIN latest ON latest.device_id = m.device_id`;
  return rows.map(machineFromRow);
}

async function saveMachine(deviceId, machine, customerId = null) {
  await ensureSchema();
  const normalized = {
    deviceId,
    customerId: customerId || machine.customerId || 'cust-farm-001',
    name: String(machine.name || deviceId).trim().slice(0, 100),
    type: String(machine.type || 'Máquina agrícola').trim().slice(0, 80),
    model: String(machine.model || '').trim().slice(0, 100),
    farmName: String(machine.farmName || '').trim().slice(0, 120),
    currentOperator: String(machine.currentOperator || '').trim().slice(0, 120),
    notes: String(machine.notes || '').trim().slice(0, 1000),
    active: machine.active !== false,
  };
  if (!normalized.deviceId || !normalized.name) throw new Error('Identificação e nome da máquina são obrigatórios');
  if (!hasDatabase()) { memory.machines.set(deviceId, normalized); return normalized; }
  const rows = await sql()`INSERT INTO machines (device_id, name, machine_type, model, farm_name, customer_id, current_operator, notes, active, updated_at)
    VALUES (${deviceId}, ${normalized.name}, ${normalized.type}, ${normalized.model}, ${normalized.farmName}, ${normalized.customerId}, ${normalized.currentOperator}, ${normalized.notes}, ${normalized.active}, NOW())
    ON CONFLICT (device_id) DO UPDATE SET name=EXCLUDED.name, machine_type=EXCLUDED.machine_type,
      model=EXCLUDED.model, farm_name=EXCLUDED.farm_name, customer_id=EXCLUDED.customer_id, current_operator=EXCLUDED.current_operator,
      notes=EXCLUDED.notes, active=EXCLUDED.active, updated_at=NOW()
    RETURNING device_id, name, machine_type, model, farm_name, customer_id, current_operator, notes, active`;
  return machineFromRow(rows[0]);
}

async function addSafetyLog(deviceId, severity, eventType, message, details = {}) {
  await ensureSchema();
  const entry = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, deviceId, timestamp: new Date().toISOString(), severity, type: eventType, message, details };
  if (!hasDatabase()) { memory.logs.push(entry); return entry; }
  const json = JSON.stringify(details);
  const rows = await sql()`INSERT INTO safety_logs (device_id, severity, event_type, message, details)
    VALUES (${deviceId}, ${severity}, ${eventType}, ${message}, ${json}::jsonb)
    RETURNING id, recorded_at`;
  entry.id = String(rows[0].id); entry.timestamp = rows[0].recorded_at;
  return entry;
}

async function listSafetyLogs(deviceId, limit = 50) {
  await ensureSchema();
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
  if (!hasDatabase()) return memory.logs.filter((entry) => entry.deviceId === deviceId).slice(-safeLimit);
  const rows = await sql()`SELECT id, recorded_at, severity, event_type, message, details FROM safety_logs
    WHERE device_id = ${deviceId} ORDER BY recorded_at DESC LIMIT ${safeLimit}`;
  return rows.reverse().map((row) => ({ id: String(row.id), timestamp: row.recorded_at, severity: row.severity, type: row.event_type, message: row.message, details: row.details }));
}

async function listDangerZones(deviceId) {
  await ensureSchema();
  if (!hasDatabase()) return memory.zones.filter((zone) => zone.deviceId === deviceId && zone.enabled !== false);
  const rows = await sql()`SELECT id, name, category, geometry, warning_m, critical_m, source FROM danger_zones WHERE device_id = ${deviceId} AND enabled = TRUE`;
  return rows.map((row) => ({ id: row.id, name: row.name, category: row.category, coordinates: row.geometry.coordinates, closed: row.geometry.closed, warningMeters: row.warning_m, criticalMeters: row.critical_m, source: row.source }));
}

async function saveDangerZone(deviceId, zone) {
  await ensureSchema();
  const normalized = { ...zone, id: zone.id || `manual-${Date.now()}`, deviceId, enabled: true, source: zone.source || 'manual' };
  if (!hasDatabase()) { memory.zones.push(normalized); return normalized; }
  const geometry = JSON.stringify({ coordinates: normalized.coordinates, closed: normalized.closed !== false });
  await sql()`INSERT INTO danger_zones (id, device_id, name, category, geometry, warning_m, critical_m, source)
    VALUES (${normalized.id}, ${deviceId}, ${normalized.name}, ${normalized.category}, ${geometry}::jsonb, ${normalized.warningMeters}, ${normalized.criticalMeters}, ${normalized.source})
    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category, geometry=EXCLUDED.geometry,
      warning_m=EXCLUDED.warning_m, critical_m=EXCLUDED.critical_m, enabled=TRUE`;
  return normalized;
}

async function disableDangerZone(deviceId, zoneId) {
  await ensureSchema();
  if (!hasDatabase()) {
    const zone = memory.zones.find((item) => item.deviceId === deviceId && item.id === zoneId);
    if (zone) zone.enabled = false;
    return Boolean(zone);
  }
  const rows = await sql()`UPDATE danger_zones SET enabled = FALSE WHERE device_id = ${deviceId} AND id = ${zoneId} RETURNING id`;
  return rows.length > 0;
}

async function setCommand(deviceId, buzzerActive, reason) {
  await ensureSchema();
  const command = { buzzerActive: Boolean(buzzerActive), reason: reason || null, updatedAt: new Date().toISOString() };
  if (!hasDatabase()) { memory.commands.set(deviceId, command); return command; }
  const rows = await sql()`INSERT INTO device_commands (device_id, buzzer_active, reason, updated_at)
    VALUES (${deviceId}, ${command.buzzerActive}, ${command.reason}, NOW())
    ON CONFLICT (device_id) DO UPDATE SET buzzer_active=EXCLUDED.buzzer_active, reason=EXCLUDED.reason, updated_at=NOW()
    RETURNING buzzer_active, reason, updated_at`;
  return { buzzerActive: rows[0].buzzer_active, reason: rows[0].reason, updatedAt: rows[0].updated_at };
}

async function getCommand(deviceId) {
  await ensureSchema();
  if (!hasDatabase()) return memory.commands.get(deviceId) || { buzzerActive: false, reason: null, updatedAt: null };
  const rows = await sql()`SELECT buzzer_active, reason, updated_at FROM device_commands WHERE device_id = ${deviceId}`;
  return rows[0] ? { buzzerActive: rows[0].buzzer_active, reason: rows[0].reason, updatedAt: rows[0].updated_at } : { buzzerActive: false, reason: null, updatedAt: null };
}

async function saveLocation(deviceId, location) {
  await ensureSchema();
  if (!hasDatabase()) { memory.locations.set(deviceId, location); return location; }
  await sql()`INSERT INTO device_locations (device_id, latitude, longitude, accuracy_m, source, recorded_at)
    VALUES (${deviceId}, ${location.latitude}, ${location.longitude}, ${location.accuracyMeters}, ${location.source}, NOW())
    ON CONFLICT (device_id) DO UPDATE SET latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude,
      accuracy_m=EXCLUDED.accuracy_m, source=EXCLUDED.source, recorded_at=NOW()`;
  return location;
}

async function getLocation(deviceId) {
  await ensureSchema();
  if (!hasDatabase()) return memory.locations.get(deviceId) || null;
  const rows = await sql()`SELECT latitude, longitude, accuracy_m, source, recorded_at FROM device_locations WHERE device_id = ${deviceId}`;
  if (!rows[0]) return null;
  return { latitude: rows[0].latitude, longitude: rows[0].longitude, accuracyMeters: rows[0].accuracy_m, source: rows[0].source, timestamp: rows[0].recorded_at };
}

async function getUserByEmail(email) {
  await ensureSchema();
  const normalized = String(email || '').trim().toLowerCase();
  if (!hasDatabase()) {
    if (!memory.users.size) {
      const { hashPassword } = require('./security');
      memory.users.set('donodafazenda@sompo.com', { id: 'user-farmer-demo', email: 'donodafazenda@sompo.com', name: 'Rafael Almeida', role: 'farmer', customerId: 'cust-farm-001', passwordHash: hashPassword(DEMO_PASSWORD), active: true });
      memory.users.set('sompo@sompo.com', { id: 'user-sompo-demo', email: 'sompo@sompo.com', name: 'Equipe Sompo Agro', role: 'sompo', customerId: null, passwordHash: hashPassword(DEMO_PASSWORD), active: true });
    }
    return memory.users.get(normalized) || null;
  }
  const rows = await sql()`SELECT id, email, name, role, customer_id, password_hash, active FROM app_users WHERE email = ${normalized} LIMIT 1`;
  if (!rows[0]) return null;
  return { id: rows[0].id, email: rows[0].email, name: rows[0].name, role: rows[0].role, customerId: rows[0].customer_id, passwordHash: rows[0].password_hash, active: rows[0].active };
}

async function canAccessDevice(user, deviceId) {
  if (!user || !deviceId) return false;
  if (user.role === 'sompo') return true;
  if (!user.customerId) return false;
  const machines = await listMachines(user.customerId);
  return machines.some((machine) => machine.deviceId === deviceId);
}

async function listInsurancePortfolioRecords() {
  await ensureSchema();
  if (!hasDatabase()) return {
    customers: structuredClone(DEMO_CUSTOMERS), policies: structuredClone(DEMO_POLICIES),
    claims: structuredClone(DEMO_CLAIMS), risks: structuredClone(DEMO_RISKS),
  };
  const [customerRows, policyRows, claimRows, riskRows] = await Promise.all([
    sql()`SELECT id, name, owner_name, email, document_masked, city, state, hectares, status, account_manager FROM insurance_customers ORDER BY name`,
    sql()`SELECT id, customer_id, policy_number, coverage, insured_value, annual_premium, deductible, starts_at, ends_at, status FROM insurance_policies ORDER BY policy_number`,
    sql()`SELECT id, customer_id, device_id, claim_number, kind, occurred_at, estimated_loss, status, confidence, source, summary FROM insurance_claims ORDER BY occurred_at DESC`,
    sql()`SELECT customer_id, score, level, reason, evaluated_at FROM customer_risk_snapshots`,
  ]);
  return {
    customers: customerRows.map((row) => ({ id: row.id, name: row.name, ownerName: row.owner_name, email: row.email, document: row.document_masked, city: row.city, state: row.state, hectares: row.hectares, status: row.status, manager: row.account_manager })),
    policies: policyRows.map((row) => ({ id: row.id, customerId: row.customer_id, number: row.policy_number, coverage: row.coverage, insured: Number(row.insured_value), premium: Number(row.annual_premium), deductible: Number(row.deductible), starts: row.starts_at, ends: row.ends_at, status: row.status })),
    claims: claimRows.map((row) => ({ id: row.id, customerId: row.customer_id, deviceId: row.device_id, number: row.claim_number, kind: row.kind, occurredAt: row.occurred_at, loss: Number(row.estimated_loss), status: row.status, confidence: row.confidence, source: row.source, summary: row.summary })),
    risks: riskRows.map((row) => ({ customerId: row.customer_id, score: row.score, level: row.level, reason: row.reason, evaluatedAt: row.evaluated_at })),
  };
}

module.exports = {
  DEFAULT_CONFIG, hasDatabase, ensureSchema, getConfig, saveConfig, saveTelemetry, getLatestTelemetry,
  listTelemetry, listTelemetryDataset, addSafetyLog, listSafetyLogs, listDangerZones, saveDangerZone, disableDangerZone,
  setCommand, getCommand, saveLocation, getLocation, listMachines, saveMachine,
  saveModelVersion, getActiveModel, getLatestModel, addAnalysisAuditLog,
  getUserByEmail, canAccessDevice, listInsurancePortfolioRecords,
};
