const handlers = Object.freeze({
  login: require('../handlers/login'),
  session: require('../handlers/session'),
  logout: require('../handlers/logout'),
  'sompo-portfolio': require('../handlers/sompo-portfolio'),
  analysis: require('../handlers/analysis'),
  commands: require('../handlers/commands'),
  config: require('../handlers/config'),
  'danger-zones': require('../handlers/danger-zones'),
  'export.csv': require('../handlers/export.csv'),
  fleet: require('../handlers/fleet'),
  health: require('../handlers/health'),
  location: require('../handlers/location'),
  machines: require('../handlers/machines'),
  measurements: require('../handlers/measurements'),
  'risk-discovery': require('../handlers/risk-discovery'),
  'safety-logs': require('../handlers/safety-logs'),
  status: require('../handlers/status'),
  telemetry: require('../handlers/telemetry'),
});

const PUBLIC_ROUTES = new Set(['health', 'login', 'session', 'logout', 'telemetry', 'commands']);
const DEVICE_SCOPED_ROUTES = new Set(['analysis', 'config', 'danger-zones', 'export.csv', 'location', 'measurements', 'safety-logs', 'status']);

function reject(response, status, error) {
  response.statusCode = status;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  return response.end(JSON.stringify({ error }));
}

module.exports = async (request, response) => {
  const rawRoute = Array.isArray(request.query?.route) ? request.query.route[0] : request.query?.route;
  const route = String(rawRoute || '').replace(/^\/+|\/+$/g, '');
  const handler = handlers[route];

  if (!handler) {
    return reject(response, 404, 'Rota de API não encontrada');
  }

  if (!PUBLIC_ROUTES.has(route)) {
    const { readSession } = require('../lib/auth');
    const user = readSession(request);
    if (!user) return reject(response, 401, 'Autenticação necessária');
    request.user = user;
    if (route === 'sompo-portfolio' && user.role !== 'sompo') return reject(response, 403, 'Acesso exclusivo Sompo');

    if (user.role === 'farmer' && DEVICE_SCOPED_ROUTES.has(route)) {
      const { canAccessDevice } = require('../lib/db');
      const requestedDevice = String(request.query?.deviceId || request.body?.deviceId || 'colheitadeira-01').slice(0, 80);
      if (!await canAccessDevice(user, requestedDevice)) return reject(response, 403, 'Equipamento fora da conta autenticada');
    }
  }

  return handler(request, response);
};
