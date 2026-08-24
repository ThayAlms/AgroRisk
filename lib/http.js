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

module.exports = { json, method, deviceId, authorizedDevice };
