const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const { calculateStability } = require('./lib/risk');

const WEB_PORT = Number(process.env.PORT || 3000);
const SERIAL_BAUD = Number(process.env.SERIAL_BAUD || 115200);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'measurements.ndjson');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SAFETY_LOG_FILE = path.join(DATA_DIR, 'safety-logs.ndjson');

fs.mkdirSync(DATA_DIR, { recursive: true });

const defaultConfig = {
  geofence: { latitude: null, longitude: null, radiusMeters: 250 },
  distanceAlertCm: 30,
  tiltAlertDegrees: 15,
  dangerZones: { searchRadiusMeters: 5000, warningDistanceMeters: 150, criticalDistanceMeters: 60 },
};

let config = loadJson(CONFIG_FILE, defaultConfig);
let latest = null;
let history = loadHistory(1000);
let notebookLocation = null;
let safetyLogs = loadLines(SAFETY_LOG_FILE, 500);
let serialPortHandle = null;
let activeDangerLevel = 'safe';
let dangerRefreshInProgress = false;
const dangerState = { zones: [], loadedAt: null, center: null, nearest: null, error: null };
const clients = new Set();
const serialStatus = { connected: false, port: null, baudRate: SERIAL_BAUD, error: null, commandsEnabled: process.env.SERIAL_COMMANDS === '1' };

function loadJson(file, fallback) {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return structuredClone(fallback);
  }
}

function loadHistory(limit) {
  try {
    return fs.readFileSync(HISTORY_FILE, 'utf8').trim().split('\n').filter(Boolean)
      .slice(-limit).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function loadLines(file, limit) {
  try {
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
      .slice(-limit).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function calculateTilt(acceleration) {
  const { x, y, z } = acceleration;
  if (![x, y, z].every(Number.isFinite) || (x === 0 && y === 0 && z === 0)) {
    return { roll: null, pitch: null };
  }
  return {
    roll: Math.atan2(y, z) * 180 / Math.PI,
    pitch: Math.atan2(-x, Math.sqrt(y * y + z * z)) * 180 / Math.PI,
  };
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const rad = (value) => value * Math.PI / 180;
  const earth = 6371000;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function localPoint(originLat, originLon, latitude, longitude) {
  return {
    x: (longitude - originLon) * 111320 * Math.cos(originLat * Math.PI / 180),
    y: (latitude - originLat) * 110540,
  };
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function pointInsidePolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]; const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || Number.EPSILON) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToZone(latitude, longitude, zone) {
  const point = { x: 0, y: 0 };
  const points = zone.coordinates.map(([lat, lon]) => localPoint(latitude, longitude, lat, lon));
  if (zone.closed && pointInsidePolygon(point, points)) return 0;
  let minimum = Infinity;
  for (let index = 1; index < points.length; index++) {
    minimum = Math.min(minimum, distanceToSegment(point, points[index - 1], points[index]));
  }
  return Number.isFinite(minimum) ? minimum : null;
}

function dangerForPosition(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !dangerState.zones.length) {
    return { level: 'unknown', nearest: null, zonesLoaded: dangerState.zones.length };
  }
  let nearest = null;
  for (const zone of dangerState.zones) {
    const distanceMeters = distanceToZone(latitude, longitude, zone);
    if (distanceMeters !== null && (!nearest || distanceMeters < nearest.distanceMeters)) {
      nearest = { id: zone.id, name: zone.name, category: zone.category, distanceMeters };
    }
  }
  const limits = config.dangerZones;
  const level = !nearest ? 'safe'
    : nearest.distanceMeters <= limits.criticalDistanceMeters ? 'critical'
      : nearest.distanceMeters <= limits.warningDistanceMeters ? 'warning' : 'safe';
  return { level, nearest, zonesLoaded: dangerState.zones.length };
}

function addSafetyLog(type, severity, message, details = {}) {
  const entry = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, timestamp: new Date().toISOString(), type, severity, message, details };
  safetyLogs.push(entry);
  if (safetyLogs.length > 500) safetyLogs = safetyLogs.slice(-500);
  fs.appendFile(SAFETY_LOG_FILE, `${JSON.stringify(entry)}\n`, () => {});
  broadcast('safety-log', entry);
  return entry;
}

function sendBuzzerCommand(enabled) {
  if (!serialStatus.commandsEnabled || !serialPortHandle?.isOpen) return false;
  serialPortHandle.write(`ALERT:GEOFENCE:${enabled ? 'ON' : 'OFF'}\n`);
  return true;
}

function handleDangerTransition(reading) {
  const nextLevel = reading.danger?.level || 'unknown';
  if (nextLevel === activeDangerLevel || nextLevel === 'unknown') return;
  const nearest = reading.danger.nearest;
  if (nextLevel === 'critical') {
    const buzzerCommandSent = sendBuzzerCommand(true);
    addSafetyLog('danger-zone', 'critical', `Entrada na faixa crítica de ${nearest?.name || 'área perigosa'}`, { ...nearest, buzzerCommandSent });
  } else if (nextLevel === 'warning') {
    sendBuzzerCommand(false);
    addSafetyLog('danger-zone', 'warning', `Aproximação de ${nearest?.name || 'área perigosa'}`, nearest || {});
  } else if (nextLevel === 'safe' && ['critical', 'warning'].includes(activeDangerLevel)) {
    sendBuzzerCommand(false);
    addSafetyLog('danger-zone', 'info', 'Equipamento afastado da área perigosa', nearest || {});
  }
  activeDangerLevel = nextLevel;
}

function overpassQuery(latitude, longitude) {
  const radius = config.dangerZones.searchRadiusMeters;
  return `[out:json][timeout:20];(way(around:${radius},${latitude},${longitude})["waterway"~"river|stream|canal"];way(around:${radius},${latitude},${longitude})["natural"="water"];way(around:${radius},${latitude},${longitude})["landuse"="quarry"];);out tags geom;`;
}

function parseOverpassZones(payload) {
  return (payload.elements || []).filter((element) => Array.isArray(element.geometry) && element.geometry.length > 1).map((element) => {
    const coordinates = element.geometry.map((point) => [point.lat, point.lon]);
    const tags = element.tags || {};
    const category = tags.landuse === 'quarry' ? 'quarry' : tags.waterway ? 'waterway' : 'water';
    const fallbackName = category === 'quarry' ? 'Pedreira' : category === 'waterway' ? 'Curso d’água' : 'Área de água';
    const first = coordinates[0]; const last = coordinates.at(-1);
    return { id: `osm-way-${element.id}`, osmId: element.id, name: tags.name || fallbackName, category, closed: first[0] === last[0] && first[1] === last[1], coordinates };
  });
}

async function refreshDangerZones(latitude, longitude, force = false) {
  if (dangerRefreshInProgress) return;
  const moved = dangerState.center ? haversineMeters(latitude, longitude, dangerState.center.latitude, dangerState.center.longitude) : Infinity;
  const stale = !dangerState.loadedAt || Date.now() - new Date(dangerState.loadedAt).getTime() > 300_000;
  if (!force && moved < 500 && !stale) return;
  dangerRefreshInProgress = true;
  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'SompoAgroRiskPrototype/1.0' },
      body: new URLSearchParams({ data: overpassQuery(latitude, longitude) }), signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error(`Overpass respondeu ${response.status}`);
    dangerState.zones = parseOverpassZones(await response.json());
    dangerState.loadedAt = new Date().toISOString();
    dangerState.center = { latitude, longitude };
    dangerState.error = null;
    broadcast('danger-zones', dangerState);
  } catch (error) {
    dangerState.error = error.message;
    broadcast('danger-zones', dangerState);
  } finally {
    dangerRefreshInProgress = false;
  }
}

function enrich(reading) {
  const physicalGpsValid = reading.gps.source !== 'notebook'
    && Number.isFinite(reading.gps.latitude) && Number.isFinite(reading.gps.longitude);
  const notebookLocationFresh = notebookLocation && Date.now() - notebookLocation.receivedAt < 120_000;
  if (!physicalGpsValid && notebookLocationFresh) {
    reading.gps = {
      latitude: notebookLocation.latitude,
      longitude: notebookLocation.longitude,
      valid: true,
      source: 'notebook',
      accuracyMeters: notebookLocation.accuracyMeters,
      message: 'Localização fornecida pelo notebook',
    };
  } else if (physicalGpsValid) {
    reading.gps.source = 'esp32';
  }
  reading.tilt = calculateTilt(reading.acceleration);
  reading.stability = calculateStability(reading.tilt, reading.acceleration, reading.gyroscope, config.tiltAlertDegrees);
  const fence = config.geofence;
  const hasPosition = Number.isFinite(reading.gps.latitude) && Number.isFinite(reading.gps.longitude);
  const hasFence = Number.isFinite(fence.latitude) && Number.isFinite(fence.longitude);
  const distanceFromCenter = hasPosition && hasFence
    ? haversineMeters(reading.gps.latitude, reading.gps.longitude, fence.latitude, fence.longitude)
    : null;

  reading.geofence = {
    configured: hasFence,
    distanceFromCenter,
    inside: distanceFromCenter === null ? null : distanceFromCenter <= fence.radiusMeters,
  };
  reading.danger = hasPosition ? dangerForPosition(reading.gps.latitude, reading.gps.longitude) : { level: 'unknown', nearest: null, zonesLoaded: dangerState.zones.length };
  reading.alerts = {
    obstacle: reading.buzzer || (Number.isFinite(reading.distanceCm) && reading.distanceCm <= config.distanceAlertCm),
    tilt: reading.stability.level === 'critical',
    outsideGeofence: reading.geofence.inside === false,
    dangerZone: ['warning', 'critical'].includes(reading.danger.level),
  };
  return reading;
}

function persist(reading) {
  history.push(reading);
  if (history.length > 1000) history = history.slice(-1000);
  fs.appendFile(HISTORY_FILE, `${JSON.stringify(reading)}\n`, () => {});
}

function broadcast(event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const response of clients) response.write(message);
}

class SensorBlockParser {
  constructor(onReading) {
    this.onReading = onReading;
    this.reset();
  }

  reset() {
    this.reading = {
      timestamp: new Date().toISOString(),
      distanceCm: null,
      buzzer: false,
      acceleration: { x: null, y: null, z: null },
      gyroscope: { x: null, y: null, z: null },
      environment: { temperatureC: null, humidityPercent: null },
      gps: { latitude: null, longitude: null, valid: false, message: null },
    };
    this.hasSensorData = false;
  }

  number(value) {
    const parsed = Number(String(value).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  feed(rawLine) {
    const line = rawLine.trim();
    if (/^-{5,}$/.test(line)) {
      if (this.hasSensorData) this.finish();
      return;
    }

    let match;
    let changed = false;
    if ((match = line.match(/^Distancia:\s*([-\d.,]+)\s*cm/i))) {
      this.reading.distanceCm = this.number(match[1]); this.hasSensorData = true; changed = true;
    } else if ((match = line.match(/^Buzzer:\s*(.+)$/i))) {
      this.reading.buzzer = /ativado|ligado|on/i.test(match[1]) && !/desativado/i.test(match[1]); changed = true;
    } else if ((match = line.match(/^Aceleracao X\/Y\/Z:\s*([-\d.,]+)\s*\/\s*([-\d.,]+)\s*\/\s*([-\d.,]+)/i))) {
      [this.reading.acceleration.x, this.reading.acceleration.y, this.reading.acceleration.z] = match.slice(1, 4).map((v) => this.number(v));
      changed = true;
    } else if ((match = line.match(/^Giroscopio X\/Y\/Z:\s*([-\d.,]+)\s*\/\s*([-\d.,]+)\s*\/\s*([-\d.,]+)/i))) {
      [this.reading.gyroscope.x, this.reading.gyroscope.y, this.reading.gyroscope.z] = match.slice(1, 4).map((v) => this.number(v));
      changed = true;
    } else if ((match = line.match(/^Temperatura ambiente:\s*([-\d.,]+)/i))) {
      this.reading.environment.temperatureC = this.number(match[1]); changed = true;
    } else if ((match = line.match(/^Umidade:\s*([-\d.,]+)/i))) {
      this.reading.environment.humidityPercent = this.number(match[1]); changed = true;
    } else if ((match = line.match(/Latitude:\s*([-\d.]+)/i))) {
      this.reading.gps.latitude = this.number(match[1]); changed = true;
    } else if ((match = line.match(/Longitude:\s*([-\d.]+)/i))) {
      this.reading.gps.longitude = this.number(match[1]); changed = true;
    } else if ((match = line.match(/(?:Localizacao|GPS):\s*([-\d.]+)\s*[,;/]\s*([-\d.]+)/i))) {
      this.reading.gps.latitude = this.number(match[1]);
      this.reading.gps.longitude = this.number(match[2]);
      changed = true;
    } else if (/sem localizacao|sem sinal|aguardando/i.test(line)) {
      this.reading.gps.message = line; changed = true;
    }

    this.reading.gps.valid = Number.isFinite(this.reading.gps.latitude) && Number.isFinite(this.reading.gps.longitude);
    if (changed && this.hasSensorData) broadcast('telemetry', enrich(structuredClone(this.reading)));
    if (/teste perto de uma janela|area aberta/i.test(line) && this.hasSensorData) this.finish();
  }

  finish() {
    const completed = enrich(this.reading);
    latest = completed;
    handleDangerTransition(completed);
    persist(completed);
    broadcast('measurement', completed);
    this.reset();
  }
}

async function connectSerial() {
  try {
    const ports = await SerialPort.list();
    const requested = process.env.SERIAL_PORT;
    const selected = requested
      ? ports.find((port) => port.path.toLowerCase() === requested.toLowerCase())
      : ports.find((port) => /silicon|cp210|ch340|usb/i.test(`${port.manufacturer || ''} ${port.friendlyName || ''} ${port.pnpId || ''}`))
        || ports.find((port) => !/^COM[45]$/i.test(port.path));

    if (!selected) throw new Error('ESP32 não encontrado. Conecte a placa por USB.');
    const port = new SerialPort({ path: selected.path, baudRate: SERIAL_BAUD, autoOpen: false });
    serialPortHandle = port;
    const lines = port.pipe(new ReadlineParser({ delimiter: '\n' }));
    const parser = new SensorBlockParser((reading) => reading);

    port.on('open', () => {
      Object.assign(serialStatus, { connected: true, port: selected.path, error: null });
      broadcast('serial', serialStatus);
      console.log(`ESP32 conectado em ${selected.path} @ ${SERIAL_BAUD}`);
    });
    lines.on('data', (line) => parser.feed(line));
    port.on('error', (error) => {
      Object.assign(serialStatus, { connected: false, error: error.message });
      broadcast('serial', serialStatus);
    });
    port.on('close', () => {
      serialPortHandle = null;
      Object.assign(serialStatus, { connected: false, error: 'Porta serial desconectada' });
      broadcast('serial', serialStatus);
      setTimeout(connectSerial, 3000);
    });
    port.open((error) => {
      if (error) {
        Object.assign(serialStatus, { connected: false, port: selected.path, error: error.message });
        console.error(`Não foi possível abrir ${selected.path}: ${error.message}`);
        setTimeout(connectSerial, 3000);
      }
    });
  } catch (error) {
    Object.assign(serialStatus, { connected: false, error: error.message });
    console.error(error.message);
    setTimeout(connectSerial, 3000);
  }
}

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 100_000) reject(new Error('Corpo da requisição muito grande'));
    });
    request.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('JSON inválido')); }
    });
    request.on('error', reject);
  });
}

function csvValue(value) {
  const normalized = typeof value === 'number' && Number.isFinite(value) ? String(value).replace('.', ',')
    : typeof value === 'boolean' ? (value ? 'SIM' : 'NAO') : value;
  const text = normalized === null || normalized === undefined ? '' : String(normalized);
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCsv(response) {
  const stabilityCache = new WeakMap();
  const stability = (reading) => {
    if (!stabilityCache.has(reading)) stabilityCache.set(reading, reading.stability || calculateStability(reading.tilt, reading.acceleration, reading.gyroscope, config.tiltAlertDegrees));
    return stabilityCache.get(reading);
  };
  const datePart = (timestamp) => timestamp ? new Date(timestamp).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
  const timePart = (timestamp) => timestamp ? new Date(timestamp).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false }) : '';
  const columns = [
    ['data', (r) => datePart(r.timestamp)], ['hora', (r) => timePart(r.timestamp)], ['timestamp_iso', (r) => r.timestamp],
    ['dispositivo', (r) => r.deviceId || 'colheitadeira-01'], ['transporte', (r) => r.gateway?.transport || 'usb'],
    ['distancia_frontal_cm', (r) => r.distanceCm], ['alerta_obstaculo', (r) => r.alerts?.obstacle], ['buzzer_ativo', (r) => r.buzzer],
    ['temperatura_c', (r) => r.environment?.temperatureC], ['umidade_percentual', (r) => r.environment?.humidityPercent],
    ['estabilidade_nivel', (r) => stability(r).level], ['estabilidade_uso_limite_percentual', (r) => stability(r).utilizationPercent],
    ['angulo_maximo_graus', (r) => stability(r).maximumAngle], ['margem_ate_limite_graus', (r) => stability(r).marginDegrees],
    ['limite_inclinacao_graus', (r) => stability(r).limitDegrees], ['eixo_predominante', (r) => stability(r).dominantAxis],
    ['direcao_inclinacao', (r) => stability(r).direction], ['inclinacao_lateral_roll_graus', (r) => r.tilt?.roll],
    ['inclinacao_frontal_pitch_graus', (r) => r.tilt?.pitch], ['velocidade_angular_graus_s', (r) => stability(r).angularSpeedDegS],
    ['estado_movimento', (r) => stability(r).motion], ['qualidade_imu', (r) => stability(r).sensorQuality],
    ['aceleracao_x_m_s2', (r) => r.acceleration?.x], ['aceleracao_y_m_s2', (r) => r.acceleration?.y], ['aceleracao_z_m_s2', (r) => r.acceleration?.z],
    ['giroscopio_x_rad_s', (r) => r.gyroscope?.x], ['giroscopio_y_rad_s', (r) => r.gyroscope?.y], ['giroscopio_z_rad_s', (r) => r.gyroscope?.z],
    ['gps_valido', (r) => r.gps?.valid], ['latitude', (r) => r.gps?.latitude], ['longitude', (r) => r.gps?.longitude],
    ['fonte_gps', (r) => r.gps?.source], ['precisao_gps_m', (r) => r.gps?.accuracyMeters],
    ['geofence_configurada', (r) => r.geofence?.configured], ['dentro_geofence', (r) => r.geofence?.inside],
    ['distancia_centro_geofence_m', (r) => r.geofence?.distanceFromCenter],
    ['nivel_perigo_geografico', (r) => r.danger?.level], ['zona_risco_proxima', (r) => r.danger?.nearest?.name],
    ['categoria_zona_risco', (r) => r.danger?.nearest?.category], ['distancia_zona_risco_m', (r) => r.danger?.nearest?.distanceMeters],
  ];
  const rows = [columns.map(([name]) => csvValue(name)).join(';')];
  for (const reading of history) rows.push(columns.map(([, getter]) => csvValue(getter(reading))).join(';'));
  response.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="agrorisk-relatorio-operacional.csv"',
  });
  response.end(`\uFEFF${rows.join('\r\n')}`);
}

function serveStatic(response, pathname) {
  const requested = pathname === '/' ? 'sompo-agro-risk.html' : pathname.slice(1);
  const file = path.resolve(PUBLIC_DIR, requested);
  if (!file.startsWith(`${path.resolve(PUBLIC_DIR)}${path.sep}`) && file !== path.join(PUBLIC_DIR, 'index.html')) {
    return sendJson(response, 403, { error: 'Acesso negado' });
  }
  const contentTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
  fs.readFile(file, (error, content) => {
    if (error) return sendJson(response, 404, { error: 'Arquivo não encontrado' });
    response.writeHead(200, { 'Content-Type': `${contentTypes[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(content);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (request.method === 'GET' && url.pathname === '/api/status') {
      return sendJson(response, 200, { serial: serialStatus, latest, config, notebookLocation });
    }
    if (request.method === 'GET' && url.pathname === '/api/measurements') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 1000);
      return sendJson(response, 200, history.slice(-limit));
    }
    if (request.method === 'GET' && url.pathname === '/api/danger-zones') return sendJson(response, 200, dangerState);
    if (request.method === 'GET' && url.pathname === '/api/safety-logs') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 500);
      return sendJson(response, 200, safetyLogs.slice(-limit));
    }
    if (request.method === 'GET' && url.pathname === '/api/export.csv') return exportCsv(response);
    if (request.method === 'GET' && url.pathname === '/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      response.flushHeaders();
      response.write(`event: serial\ndata: ${JSON.stringify(serialStatus)}\n\n`);
      clients.add(response);
      request.on('close', () => clients.delete(response));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/location') {
      const body = await readBody(request);
      const latitude = Number(body.latitude);
      const longitude = Number(body.longitude);
      const accuracyMeters = Number(body.accuracyMeters);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
        || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        return sendJson(response, 400, { error: 'Coordenadas inválidas' });
      }
      notebookLocation = {
        latitude,
        longitude,
        accuracyMeters: Number.isFinite(accuracyMeters) ? accuracyMeters : null,
        timestamp: body.timestamp || new Date().toISOString(),
        receivedAt: Date.now(),
      };
      if (latest) {
        const current = enrich(structuredClone(latest));
        latest = current;
        broadcast('telemetry', current);
      }
      broadcast('location', notebookLocation);
      refreshDangerZones(latitude, longitude);
      return sendJson(response, 200, notebookLocation);
    }
    if (request.method === 'POST' && url.pathname === '/api/danger-zones/refresh') {
      const position = latest?.gps?.valid ? latest.gps : notebookLocation;
      if (!position) return sendJson(response, 400, { error: 'Localização indisponível' });
      await refreshDangerZones(position.latitude, position.longitude, true);
      return sendJson(response, 200, dangerState);
    }
    if (request.method === 'PUT' && url.pathname === '/api/config') {
      const body = await readBody(request);
      const latitude = body.geofence?.latitude === null ? null : Number(body.geofence?.latitude);
      const longitude = body.geofence?.longitude === null ? null : Number(body.geofence?.longitude);
      const radiusMeters = Number(body.geofence?.radiusMeters ?? config.geofence.radiusMeters);
      const distanceAlertCm = Number(body.distanceAlertCm ?? config.distanceAlertCm);
      const tiltAlertDegrees = Number(body.tiltAlertDegrees ?? config.tiltAlertDegrees);
      const searchRadiusMeters = Number(body.dangerZones?.searchRadiusMeters ?? config.dangerZones.searchRadiusMeters);
      const warningDistanceMeters = Number(body.dangerZones?.warningDistanceMeters ?? config.dangerZones.warningDistanceMeters);
      const criticalDistanceMeters = Number(body.dangerZones?.criticalDistanceMeters ?? config.dangerZones.criticalDistanceMeters);
      if ((latitude !== null && !Number.isFinite(latitude)) || (longitude !== null && !Number.isFinite(longitude))
        || !Number.isFinite(radiusMeters) || radiusMeters <= 0 || !Number.isFinite(distanceAlertCm) || distanceAlertCm <= 0
        || !Number.isFinite(tiltAlertDegrees) || tiltAlertDegrees <= 0 || !Number.isFinite(searchRadiusMeters) || searchRadiusMeters < 500
        || !Number.isFinite(warningDistanceMeters) || warningDistanceMeters <= 0 || !Number.isFinite(criticalDistanceMeters)
        || criticalDistanceMeters <= 0 || criticalDistanceMeters >= warningDistanceMeters) {
        return sendJson(response, 400, { error: 'Configuração inválida' });
      }
      config = { geofence: { latitude, longitude, radiusMeters }, distanceAlertCm, tiltAlertDegrees, dangerZones: { searchRadiusMeters, warningDistanceMeters, criticalDistanceMeters } };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
      broadcast('config', config);
      return sendJson(response, 200, config);
    }
    return serveStatic(response, url.pathname);
  } catch (error) {
    return sendJson(response, 400, { error: error.message });
  }
});

server.listen(WEB_PORT, '0.0.0.0', () => {
  console.log(`Dashboard disponível em http://localhost:${WEB_PORT}`);
  connectSerial();
});
