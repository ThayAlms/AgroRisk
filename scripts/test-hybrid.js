const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

delete process.env.DATABASE_URL;
process.env.DEVICE_API_KEY = 'test-device-key';

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

async function call(handler, request) {
  const output = response();
  await handler({ query: {}, body: {}, headers: {}, ...request }, output);
  return output;
}

async function main() {
  const dashboardHtml = readFileSync(join(__dirname, '..', 'public', 'sompo-agro-risk.html'), 'utf8');
  const mappingHtml = readFileSync(join(__dirname, '..', 'public', 'mapeamento-riscos.html'), 'utf8');
  const dashboardJs = readFileSync(join(__dirname, '..', 'public', 'dashboard-live.js'), 'utf8');
  assert.doesNotMatch(dashboardHtml, /class="card risk-mapping-card"/);
  assert.match(dashboardHtml, /href="\/mapeamento-riscos\.html"/);
  for (const id of ['stability-utilization', 'stability-bar', 'stability-maximum', 'stability-margin', 'stability-direction', 'stability-motion', 'stability-quality', 'gyro-x', 'gyro-y', 'gyro-z', 'gyro-total', 'gyro-live-state']) assert.match(dashboardHtml, new RegExp(`id=["']${id}["']`));
  assert.match(dashboardJs, /fmt\(gyroValues\[0\], 4\)/);
  assert.match(dashboardJs, /Math\.hypot\(\.\.\.gyroValues\) \* 180 \/ Math\.PI/);
  assert.match(dashboardJs, /REFERÊNCIA ESTÁVEL: ROLL 0° · PITCH 0°/);
  assert.match(mappingHtml, /Mapeamento de riscos da região FIAP/);
  assert.match(mappingHtml, /value="25000" selected/);
  assert.match(mappingHtml, /class="risk-area"/);
  assert.match(mappingHtml, /class="warning-area"/);
  assert.match(mappingHtml, /Faixa de atenção até 10 m/);
  assert.match(mappingHtml, /value="10 \/ 0"/);
  assert.match(mappingHtml, /@turf\/turf@7/);
  assert.match(dashboardHtml, /@turf\/turf@7/);
  assert.match(dashboardJs, /turf\.buffer/);
  assert.match(mappingHtml, /REGIÃO FIAP FIXA/);
  assert.match(mappingHtml, /FIAP Paulista — Av\. Paulista, 1106/);
  assert.match(mappingHtml, /value="powerline"/);
  assert.match(dashboardJs, /FIAP_REGION = Object\.freeze/);
  assert.match(dashboardJs, /lockMapToFiapRegion/);
  assert.match(dashboardJs, /locationHeartbeatId/);
  assert.match(dashboardJs, /12000/);
  assert.match(dashboardJs, /window\.isSecureContext/);
  for (const id of ['locate-me', 'discover-risks', 'draw-risk', 'zone-review', 'risk-feedback']) assert.match(mappingHtml, new RegExp(`id=["']${id}["']`));
  for (const html of [dashboardHtml, mappingHtml]) {
    const htmlIds = [...html.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1]);
    assert.equal(new Set(htmlIds).size, htmlIds.length, 'O HTML contém IDs duplicados');
  }

  const location = require('../handlers/location');
  const configApi = require('../handlers/config');
  const telemetry = require('../handlers/telemetry');
  const dangerZones = require('../handlers/danger-zones');
  const discovery = require('../handlers/risk-discovery');
  const sameOriginHeaders = { origin: 'https://agrorisk.test', host: 'agrorisk.test', 'sec-fetch-site': 'same-origin' };

  const defaultConfig = await call(configApi, { method: 'GET' });
  assert.equal(defaultConfig.body.geofence.latitude, -23.56318);
  assert.equal(defaultConfig.body.geofence.longitude, -46.65409);
  assert.equal(defaultConfig.body.geofence.radiusMeters, 400);
  const blockedConfig = await call(configApi, { method: 'PUT', body: defaultConfig.body });
  assert.equal(blockedConfig.statusCode, 401);
  const savedFiapConfig = await call(configApi, { method: 'PUT', headers: sameOriginHeaders, body: defaultConfig.body });
  assert.equal(savedFiapConfig.statusCode, 200);

  const blockedLocation = await call(location, { method: 'POST', body: { latitude: -23.55, longitude: -46.63 } });
  assert.equal(blockedLocation.statusCode, 403);
  const located = await call(location, { method: 'POST', headers: sameOriginHeaders, body: { latitude: -23.55, longitude: -46.63, accuracyMeters: 12 } });
  assert.equal(located.statusCode, 200);
  assert.equal(located.body.deviceGpsActive, false);

  const reading = await call(telemetry, {
    method: 'POST', headers: { 'x-device-key': 'test-device-key' },
    body: { telemetry: { distanceCm: 80, gps: { valid: false, source: 'esp32' }, acceleration: { x: 0, y: 0, z: 1 }, environment: {} } },
  });
  assert.equal(reading.statusCode, 201);
  assert.equal(reading.body.telemetry.gps.source, 'notebook');
  assert.equal(reading.body.telemetry.gps.valid, true);
  assert.equal(reading.body.telemetry.stability.level, 'safe');
  assert.equal(reading.body.telemetry.stability.maximumAngle, 0);

  const refreshedLocation = await call(location, { method: 'POST', headers: sameOriginHeaders, body: { latitude: -23.55, longitude: -46.63, accuracyMeters: 12 } });
  assert.equal(refreshedLocation.body.usedAsDeviceFallback, true);

  const { calculateStability, enrichTelemetry } = require('../lib/risk');
  const centeredStability = calculateStability({ roll: 0, pitch: 0 }, { x: 0, y: 0, z: 9.80665 }, { x: 0, y: 0, z: 0 }, 15);
  assert.equal(centeredStability.level, 'safe');
  assert.equal(centeredStability.maximumAngle, 0);
  assert.equal(centeredStability.angularSpeedDegS, 0);
  assert.equal(centeredStability.motion, 'steady');
  const warningStability = calculateStability({ roll: 12, pitch: 4 }, { x: 0, y: 2, z: 9.6 }, { x: .01, y: .02, z: .01 }, 15);
  assert.equal(warningStability.level, 'warning');
  assert.equal(Math.round(warningStability.utilizationPercent), 80);
  assert.equal(warningStability.dominantAxis, 'lateral');

  const lakeZone = {
    id: 'lake-test', name: 'Lago teste', category: 'water', closed: true, warningMeters: 10, criticalMeters: 0,
    coordinates: [[-23.55, -46.63], [-23.55, -46.629], [-23.551, -46.629], [-23.551, -46.63], [-23.55, -46.63]],
  };
  const riskConfig = { tiltAlertDegrees: 15, distanceAlertCm: 50, geofence: { latitude: -23.55, longitude: -46.63, radiusMeters: 1000 } };
  const telemetryAt = (latitude, longitude) => ({ acceleration: { x: 0, y: 0, z: 9.80665 }, gyroscope: { x: 0, y: 0, z: 0 }, gps: { latitude, longitude } });
  assert.equal(enrichTelemetry(telemetryAt(-23.5505, -46.6295), riskConfig, [lakeZone]).danger.level, 'critical');
  assert.equal(enrichTelemetry(telemetryAt(-23.5505, -46.62895), riskConfig, [lakeZone]).danger.level, 'warning');

  const exportCsv = require('../handlers/export.csv');
  const exported = await call(exportCsv, { method: 'GET' });
  assert.equal(exported.statusCode, 200);
  assert.match(exported.headers['Content-Disposition'], /agrorisk-relatorio-operacional\.csv/);
  const csvLines = exported.body.split(/\r?\n/);
  assert.equal(csvLines[0].split(';').length, 40);
  assert.match(csvLines[0], /"estabilidade_nivel"/);
  assert.match(csvLines[0], /"qualidade_imu"/);
  assert.match(csvLines[1], /"seguro"|"safe"/);

  const created = await call(dangerZones, {
    method: 'POST', headers: sameOriginHeaders,
    body: { zone: { id: 'manual-test', name: 'Lago teste', category: 'water', coordinates: [[-23.55, -46.63], [-23.551, -46.63], [-23.55, -46.63]], closed: true, warningMeters: 10, criticalMeters: 0 } },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.warningMeters, 10);
  assert.equal(created.body.criticalMeters, 0);
  const listed = await call(dangerZones, { method: 'GET' });
  assert.equal(listed.body.zones.length, 1);
  const removed = await call(dangerZones, { method: 'DELETE', headers: sameOriginHeaders, query: { id: created.body.id } });
  assert.equal(removed.statusCode, 200);

  const originalFetch = global.fetch;
  let overpassBody = '';
  global.fetch = async (_url, options) => { overpassBody = String(options.body); return { ok: true, json: async () => ({ elements: [{ type: 'way', id: 42, tags: { natural: 'water', water: 'lake', name: 'Represa teste' }, geometry: [{ lat: -23.55, lon: -46.63 }, { lat: -23.551, lon: -46.63 }, { lat: -23.551, lon: -46.631 }, { lat: -23.55, lon: -46.63 }] }] }) }; };
  const discovered = await call(discovery, { method: 'GET', query: { latitude: '-23.55', longitude: '-46.63', radius: '50000' } });
  global.fetch = originalFetch;
  assert.equal(discovered.statusCode, 200);
  assert.equal(discovered.body.radius, 25000);
  assert.match(overpassBody, /around%3A25000/);
  assert.match(overpassBody, /natural%22%3D%22wetland/);
  assert.match(overpassBody, /man_made%22%3D%22embankment/);
  assert.equal(discovered.body.candidates[0].source, 'openstreetmap-pending');
  assert.equal(discovered.body.candidates[0].automaticDanger, true);
  assert.equal(discovered.body.candidates[0].warningMeters, 10);
  assert.equal(discovered.body.candidates[0].criticalMeters, 0);
  assert.equal(Number.isFinite(discovered.body.candidates[0].distanceMeters), true);

  console.log(JSON.stringify({ ok: true, stability: true, csvColumns: 40, htmlHybrid: true, browserGpsFallback: true, locationHeartbeat: true, locationOriginProtected: true, zoneLifecycle: true, riskDiscovery: true }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
