const DEFAULT_CONFIG = {
  geofence: { latitude: null, longitude: null, radiusMeters: 250 },
  distanceAlertCm: 30,
  tiltAlertDegrees: 15,
  dangerZones: { warningDistanceMeters: 150, criticalDistanceMeters: 60 },
};

const memory = globalThis.__agroRiskMemory || {
  telemetry: [], configs: new Map(), logs: [], zones: [], commands: new Map(), locations: new Map(),
};
globalThis.__agroRiskMemory = memory;

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

module.exports = {
  DEFAULT_CONFIG, hasDatabase, ensureSchema, getConfig, saveConfig, saveTelemetry, getLatestTelemetry,
  listTelemetry, addSafetyLog, listSafetyLogs, listDangerZones, saveDangerZone, setCommand, getCommand, saveLocation,
};
