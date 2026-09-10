const baseUrl = String(process.argv[2] || process.env.CLOUD_API_URL || 'https://agrorisk-sompo.vercel.app').replace(/\/$/, '');
const deviceKey = process.env.AGRORISK_DEVICE_API_KEY || process.env.DEVICE_API_KEY;
const deviceId = 'colheitadeira-01';

let sessionCookie = '';
async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), ...(sessionCookie ? { cookie: sessionCookie } : {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} - ${body.error || 'erro'}`);
  return body;
}

async function main() {
  if (!deviceKey) throw new Error('DEVICE_API_KEY não foi carregada');
  const health = await request('/api/health');
  const loginResponse = await fetch(`${baseUrl}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'donodafazenda@sompo.com', password: '123456789' }), signal: AbortSignal.timeout(15_000) });
  if (!loginResponse.ok) throw new Error(`login: HTTP ${loginResponse.status}`);
  sessionCookie = String(loginResponse.headers.get('set-cookie') || '').split(';')[0];
  const now = new Date().toISOString();
  await request('/api/telemetry', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-key': deviceKey },
    body: JSON.stringify({
      deviceId,
      telemetry: {
        timestamp: now,
        distanceCm: 145,
        buzzer: false,
        acceleration: { x: 0.03, y: 0.02, z: 0.99 },
        gyroscope: { x: 0.1, y: -0.1, z: 0 },
        environment: { temperatureC: 26.4, humidityPercent: 58 },
        gps: { latitude: -23.55052, longitude: -46.633308, valid: true, source: 'smoke-test' },
        gateway: { port: 'teste', baudRate: 115200 },
      },
    }),
  });
  const status = await request(`/api/status?deviceId=${deviceId}`);
  if (!status.latest || status.storage !== 'postgresql') throw new Error('telemetria não persistiu no PostgreSQL');
  console.log(JSON.stringify({
    ok: health.ok,
    database: health.database,
    telemetryPersisted: true,
    deviceConnected: status.serial.connected,
    timestamp: status.latest.timestamp,
  }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
