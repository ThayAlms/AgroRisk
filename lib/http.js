function json(response, status, body) {
  response.status(status).setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.json(body);
}

function method(request, response, allowed) {
  if (allowed.includes(request.method)) return true;
  response.setHeader('Allow', allowed.join(', '));
  json(response, 405, { error: 'Método não permitido' });
  return false;
}

function deviceId(request) {
  return String(request.query?.deviceId || request.body?.deviceId || 'colheitadeira-01').slice(0, 80);
}

function authorizedDevice(request) {
  const expected = process.env.DEVICE_API_KEY;
  return !expected || request.headers['x-device-key'] === expected;
}

function authorizedZoneEditor(request) {
  if (authorizedDevice(request)) return true;
  const origin = request.headers.origin;
  const host = request.headers['x-forwarded-host'] || request.headers.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host && (!request.headers['sec-fetch-site'] || request.headers['sec-fetch-site'] === 'same-origin');
  } catch { return false; }
}

// Origem pública desta requisição. Usada nos links das notificações para que o
// endereço acompanhe o ambiente (produção, preview, túnel) sem depender de
// alguém lembrar de atualizar PUBLIC_APP_URL.
function requestOrigin(request) {
  const host = request.headers?.['x-forwarded-host'] || request.headers?.host;
  if (!host) return null;
  const protocol = request.headers?.['x-forwarded-proto'] || (/^localhost|^127\.0\.0\.1/.test(host) ? 'http' : 'https');
  try { return new URL(`${protocol}://${host}`).origin; } catch { return null; }
}

module.exports = { json, method, deviceId, authorizedDevice, authorizedZoneEditor, requestOrigin };
