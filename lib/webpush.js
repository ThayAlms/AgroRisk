const crypto = require('node:crypto');

const CURVE = 'prime256v1';
const RECORD_SIZE = 4096;
const DEFAULT_TTL_SECONDS = 900;

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function decode(value) {
  return Buffer.from(String(value || ''), 'base64url');
}

function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: CURVE });
  const jwk = publicKey.export({ format: 'jwk' });
  const privateJwk = privateKey.export({ format: 'jwk' });
  return {
    publicKey: base64url(Buffer.concat([Buffer.from([4]), decode(jwk.x), decode(jwk.y)])),
    privateKey: privateJwk.d,
  };
}

function vapidKeyObject(publicKeyBase64Url, privateKeyBase64Url) {
  const raw = decode(publicKeyBase64Url);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('VAPID_PUBLIC_KEY deve ser um ponto P-256 não comprimido em base64url');
  return crypto.createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', x: base64url(raw.subarray(1, 33)), y: base64url(raw.subarray(33)), d: privateKeyBase64Url },
  });
}

function vapidAuthorization(endpoint, keys, subject) {
  const audience = new URL(endpoint).origin;
  const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = base64url(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: subject }));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: vapidKeyObject(keys.publicKey, keys.privateKey),
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${signingInput}.${base64url(signature)}, k=${keys.publicKey}`;
}

// RFC 8291 (Message Encryption for Web Push) sobre RFC 8188 (aes128gcm).
function encryptPayload(plaintext, subscriberPublicKey, subscriberAuthSecret) {
  const clientPublic = decode(subscriberPublicKey);
  const authSecret = decode(subscriberAuthSecret);
  if (clientPublic.length !== 65 || clientPublic[0] !== 4) throw new Error('Chave p256dh da inscrição é inválida');
  if (authSecret.length !== 16) throw new Error('Segredo auth da inscrição é inválido');

  const ecdh = crypto.createECDH(CURVE);
  const serverPublic = ecdh.generateKeys();
  const sharedSecret = ecdh.computeSecret(clientPublic);
  const salt = crypto.randomBytes(16);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), clientPublic, serverPublic]);
  const inputKeyMaterial = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));
  const contentKey = Buffer.from(crypto.hkdfSync('sha256', inputKeyMaterial, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', inputKeyMaterial, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const record = Buffer.concat([Buffer.from(plaintext, 'utf8'), Buffer.from([2])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', contentKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(RECORD_SIZE);
  return Buffer.concat([salt, recordSize, Buffer.from([serverPublic.length]), serverPublic, ciphertext]);
}

function vapidKeysFromEnvironment() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT || 'mailto:alertas@agrorisk.app' };
}

async function sendNotification(subscription, payload, options = {}) {
  const keys = options.keys || vapidKeysFromEnvironment();
  if (!keys) return { delivered: false, status: 0, expired: false, error: 'VAPID não configurado' };
  try {
    const body = encryptPayload(typeof payload === 'string' ? payload : JSON.stringify(payload), subscription.p256dh, subscription.auth);
    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(subscription.endpoint, keys, keys.subject),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(options.ttlSeconds || DEFAULT_TTL_SECONDS),
        Urgency: options.urgency || 'high',
      },
      body,
    });
    // 404/410 significam que o navegador descartou a inscrição: ela deve sair do banco.
    return {
      delivered: response.ok,
      status: response.status,
      expired: response.status === 404 || response.status === 410,
      error: response.ok ? null : `Push service respondeu ${response.status}`,
    };
  } catch (error) {
    return { delivered: false, status: 0, expired: false, error: error.message };
  }
}

module.exports = { generateVapidKeys, vapidKeysFromEnvironment, vapidAuthorization, encryptPayload, sendNotification };
