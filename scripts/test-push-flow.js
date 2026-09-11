/* Fluxo completo sem banco e sem push service real: inscrição pela API, telemetria crítica e entrega. */
const assert = require('node:assert');
const crypto = require('node:crypto');
const http = require('node:http');
const { generateVapidKeys } = require('../lib/webpush');

delete process.env.DATABASE_URL;
const keys = generateVapidKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
process.env.VAPID_SUBJECT = 'mailto:alertas@agrorisk.app';
process.env.PUSH_COOLDOWN_MINUTES = '5';

const received = [];
let pushServiceGone = false;

async function main() {
  const pushService = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      if (pushServiceGone) return response.writeHead(410).end();
      received.push({ url: request.url, authorization: request.headers.authorization, encoding: request.headers['content-encoding'], urgency: request.headers.urgency, bytes: Buffer.concat(chunks).length });
      response.writeHead(201).end();
    });
  });
  await new Promise((resolve) => pushService.listen(0, resolve));
  const port = pushService.address().port;
  const endpoint = `http://127.0.0.1:${port}/push/abc123`;

  const clientEcdh = crypto.createECDH('prime256v1');
  const subscription = {
    endpoint,
    keys: { p256dh: clientEcdh.generateKeys().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') },
  };

  const push = require('../handlers/push');
  const telemetry = require('../handlers/telemetry');

  const invoke = (handler, request) => new Promise((resolve) => {
    const body = [];
    const response = {
      statusCode: 200, headersSent: false,
      status(code) { this.statusCode = code; return this; },
      setHeader() { return this; },
      json(payload) { body.push(payload); resolve({ status: this.statusCode, body: payload }); },
      end(payload) { resolve({ status: this.statusCode, body: payload }); },
    };
    handler({ headers: {}, query: {}, body: {}, ...request }, response);
  });

  // 1. Chave pública exposta ao navegador.
  const settings = await invoke(push, { method: 'GET', query: { deviceId: 'colheitadeira-01' } });
  assert.strictEqual(settings.body.configured, true);
  assert.strictEqual(settings.body.publicKey, keys.publicKey);

  // 2. Inscrição do aparelho, com notificação de teste.
  const subscribed = await invoke(push, { method: 'POST', query: { deviceId: 'colheitadeira-01' }, body: { subscription, sendTest: true } });
  assert.strictEqual(subscribed.status, 201);
  assert.strictEqual(subscribed.body.test.delivered, 1, 'a notificação de teste deveria ter sido entregue');

  // 3. Telemetria crítica dispara o alerta do operador.
  const critical = {
    method: 'POST', headers: {}, query: { deviceId: 'colheitadeira-01' },
    body: { distanceCm: 8, temperatureC: 41, humidityPercent: 30, speedKmh: 12, acceleration: { x: 8.2, y: 1.1, z: 3.4 }, gps: { latitude: -23.5632, longitude: -46.6541 } },
  };
  const ingest = await invoke(telemetry, critical);
  assert.strictEqual(ingest.status, 201, `ingestão falhou: ${JSON.stringify(ingest.body)}`);
  assert.strictEqual(ingest.body.push.sent, 1, `alerta não enviado: ${JSON.stringify(ingest.body.push)}`);

  // 4. Repetição imediata da mesma severidade é suprimida.
  const repeated = await invoke(telemetry, critical);
  assert.strictEqual(repeated.body.push.sent, 0);
  assert.strictEqual(repeated.body.push.channels.push.skipped, 'cooldown');
  assert.strictEqual(repeated.body.push.channels.telegram.skipped, 'not-configured', 'sem token o Telegram apenas se declara indisponível');

  // 5. Contrato HTTP com o push service.
  assert.strictEqual(received.length, 2, 'esperadas duas requisições ao push service');
  for (const request of received) {
    assert.match(request.authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    assert.strictEqual(request.encoding, 'aes128gcm');
    assert.ok(request.bytes > 86, 'corpo cifrado menor que o cabeçalho aes128gcm');
  }
  assert.strictEqual(received[1].urgency, 'high', 'risco alto deve ir com urgência alta');

  // 6. Inscrição descartada pelo navegador (410) sai do banco sozinha.
  pushServiceGone = true;
  const { listPushSubscriptions } = require('../lib/db');
  const { notifyOperators } = require('../lib/notify');
  // O aviso de normalização sempre passa depois de um alerta crítico, então serve para exercitar o 410.
  const expired = await notifyOperators('colheitadeira-01', { risk: { score: 8, level: 'BAIXO', factors: [] }, geofence: { inside: true } });
  assert.strictEqual(expired.alert.severity, 'info');
  assert.strictEqual(expired.removed, 1, 'inscrição expirada deveria ter sido removida');
  assert.strictEqual((await listPushSubscriptions('colheitadeira-01')).length, 0);
  pushService.close();

  console.log('✅ test-push-flow: inscrição, alerta crítico, silêncio, cabeçalhos VAPID e limpeza de inscrição expirada aprovados');
}

main().catch((error) => { console.error('❌', error.message); process.exit(1); });
