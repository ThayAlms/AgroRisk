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
  assert.doesNotMatch(dashboardHtml, /class="card risk-mapping-card"/);
  assert.match(dashboardHtml, /href="\/mapeamento-riscos\.html"/);
  assert.match(mappingHtml, /Mapeamento híbrido de áreas de risco/);
  for (const id of ['locate-me', 'discover-risks', 'draw-risk', 'zone-review', 'risk-feedback']) assert.match(mappingHtml, new RegExp(`id=["']${id}["']`));
  for (const html of [dashboardHtml, mappingHtml]) {
    const htmlIds = [...html.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1]);
    assert.equal(new Set(htmlIds).size, htmlIds.length, 'O HTML contém IDs duplicados');
  }

  const location = require('../api/location');
  const telemetry = require('../api/telemetry');
  const dangerZones = require('../api/danger-zones');
  const discovery = require('../api/risk-discovery');
  const sameOriginHeaders = { origin: 'https://agrorisk.test', host: 'agrorisk.test', 'sec-fetch-site': 'same-origin' };

  const located = await call(location, { method: 'POST', body: { latitude: -23.55, longitude: -46.63, accuracyMeters: 12 } });
  assert.equal(located.statusCode, 200);

  const reading = await call(telemetry, {
    method: 'POST', headers: { 'x-device-key': 'test-device-key' },
    body: { telemetry: { distanceCm: 80, gps: { valid: false, source: 'esp32' }, acceleration: { x: 0, y: 0, z: 1 }, environment: {} } },
  });
  assert.equal(reading.statusCode, 201);
  assert.equal(reading.body.telemetry.gps.source, 'notebook');
  assert.equal(reading.body.telemetry.gps.valid, true);

  const created = await call(dangerZones, {
    method: 'POST', headers: sameOriginHeaders,
    body: { zone: { id: 'manual-test', name: 'Lago teste', category: 'water', coordinates: [[-23.55, -46.63], [-23.551, -46.63], [-23.55, -46.63]], closed: true, warningMeters: 150, criticalMeters: 60 } },
  });
  assert.equal(created.statusCode, 201);
  const listed = await call(dangerZones, { method: 'GET' });
  assert.equal(listed.body.zones.length, 1);
  const removed = await call(dangerZones, { method: 'DELETE', headers: sameOriginHeaders, query: { id: created.body.id } });
  assert.equal(removed.statusCode, 200);

  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ elements: [{ type: 'way', id: 42, tags: { natural: 'water', name: 'Represa teste' }, geometry: [{ lat: -23.55, lon: -46.63 }, { lat: -23.551, lon: -46.631 }] }] }) });
  const discovered = await call(discovery, { method: 'GET', query: { latitude: '-23.55', longitude: '-46.63', radius: '5000' } });
  global.fetch = originalFetch;
  assert.equal(discovered.statusCode, 200);
  assert.equal(discovered.body.candidates[0].source, 'openstreetmap-pending');

  console.log(JSON.stringify({ ok: true, htmlHybrid: true, browserGpsFallback: true, zoneLifecycle: true, riskDiscovery: true }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
