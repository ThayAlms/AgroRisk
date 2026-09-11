const assert = require('node:assert');
const crypto = require('node:crypto');
const { generateVapidKeys, vapidAuthorization, encryptPayload } = require('../lib/webpush');
const { buildAlert, urgencyOf, shouldNotifySubscription } = require('../lib/notify');

function decrypt(body, clientEcdh, authSecret) {
  const salt = body.subarray(0, 16);
  const keyLength = body[20];
  const serverPublic = body.subarray(21, 21 + keyLength);
  const ciphertext = body.subarray(21 + keyLength);
  const sharedSecret = clientEcdh.computeSecret(serverPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), clientEcdh.getPublicKey(), serverPublic]);
  const inputKeyMaterial = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));
  const contentKey = Buffer.from(crypto.hkdfSync('sha256', inputKeyMaterial, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', inputKeyMaterial, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = crypto.createDecipheriv('aes-128-gcm', contentKey, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const record = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  assert.strictEqual(record[record.length - 1], 2, 'delimitador de padding aes128gcm ausente');
  return record.subarray(0, record.length - 1).toString('utf8');
}

// 1. O corpo cifrado (RFC 8291) precisa ser legível pelo navegador inscrito.
const clientEcdh = crypto.createECDH('prime256v1');
const clientPublic = clientEcdh.generateKeys();
const authSecret = crypto.randomBytes(16);
const payload = JSON.stringify({ title: '🚨 Risco alto', body: 'Inclinação crítica', severity: 'critical' });
const encrypted = encryptPayload(payload, clientPublic.toString('base64url'), authSecret.toString('base64url'));
assert.strictEqual(decrypt(encrypted, clientEcdh, authSecret), payload, 'payload decifrado difere do original');

// 2. O cabeçalho VAPID precisa ser um JWT ES256 verificável com a chave pública anunciada.
const keys = generateVapidKeys();
const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc123', { ...keys, subject: 'mailto:alertas@agrorisk.app' }, 'mailto:alertas@agrorisk.app');
const token = header.match(/t=([^,]+)/)[1];
const [headerPart, payloadPart, signaturePart] = token.split('.');
const raw = Buffer.from(keys.publicKey, 'base64url');
const publicKey = crypto.createPublicKey({
  format: 'jwk',
  key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') },
});
assert.ok(crypto.verify('sha256', Buffer.from(`${headerPart}.${payloadPart}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signaturePart, 'base64url')), 'assinatura VAPID inválida');
const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
assert.strictEqual(claims.aud, 'https://fcm.googleapis.com', 'audiência do JWT deve ser a origem do push service');
assert.ok(claims.exp > Math.floor(Date.now() / 1000), 'JWT VAPID já expirado');

// 3. A severidade acompanha a condição observada.
assert.strictEqual(urgencyOf({ risk: { level: 'ALTO' } }), 'critical');
assert.strictEqual(urgencyOf({ risk: { level: 'BAIXO' }, geofence: { inside: false } }), 'warning');
assert.strictEqual(urgencyOf({ risk: { level: 'BAIXO' }, geofence: { inside: true } }), 'info');
assert.strictEqual(urgencyOf({ risk: { level: 'BAIXO' }, stability: { level: 'critical' } }), 'critical');

const alert = buildAlert('colheitadeira-01', {
  risk: { score: 88, level: 'ALTO', factors: [{ points: 25, label: 'Inclinação crítica' }, { points: 0, label: 'Velocidade' }] },
  stability: { level: 'critical' },
}, 'Colheitadeira 01');
assert.match(alert.title, /Risco alto · Colheitadeira 01/);
assert.match(alert.body, /Inclinação crítica/);
assert.match(alert.body, /score 88\/100/);
assert.ok(!alert.body.includes('Velocidade'), 'fatores com zero ponto não devem entrar na mensagem');

// 4. Silêncio inteligente: escalada passa, repetição dentro do intervalo não.
const now = new Date().toISOString();
assert.ok(shouldNotifySubscription({ lastSeverity: null, lastNotifiedAt: null }, alert), 'primeiro alerta deve ser enviado');
assert.ok(shouldNotifySubscription({ lastSeverity: 'warning', lastNotifiedAt: now }, alert), 'escalada de warning para critical deve passar');
assert.ok(!shouldNotifySubscription({ lastSeverity: 'critical', lastNotifiedAt: now }, alert), 'repetição imediata deve ser suprimida');
assert.ok(shouldNotifySubscription({ lastSeverity: 'critical', lastNotifiedAt: new Date(Date.now() - 60 * 60_000).toISOString() }, alert), 'condição persistente deve alertar de novo após o intervalo');
const normalized = buildAlert('colheitadeira-01', { risk: { score: 10, level: 'BAIXO', factors: [] }, geofence: { inside: true } }, 'Colheitadeira 01');
assert.strictEqual(normalized.severity, 'info');
assert.ok(shouldNotifySubscription({ lastSeverity: 'critical', lastNotifiedAt: now }, normalized), 'normalização deve ser comunicada');
assert.ok(!shouldNotifySubscription({ lastSeverity: null, lastNotifiedAt: null }, normalized), 'não avisar normalização sem alerta anterior');

console.log('✅ test-push: criptografia aes128gcm, JWT VAPID, severidade e silêncio inteligente aprovados');
