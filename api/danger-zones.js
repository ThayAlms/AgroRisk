const { listDangerZones, saveDangerZone } = require('../lib/db');
const { json, method, deviceId, authorizedDevice } = require('../lib/http');

module.exports = async (request, response) => {
  if (!method(request, response, ['GET', 'POST'])) return;
  try {
    const id = deviceId(request);
    if (request.method === 'GET') {
      const zones = await listDangerZones(id);
      return json(response, 200, { zones, loadedAt: new Date().toISOString(), center: null, error: null });
    }
    if (!authorizedDevice(request)) return json(response, 401, { error: 'Chave administrativa inválida' });
    const zone = request.body?.zone || request.body;
    if (!zone?.name || !Array.isArray(zone.coordinates) || zone.coordinates.length < 2) return json(response, 400, { error: 'Zona perigosa inválida' });
    zone.warningMeters = Number(zone.warningMeters || 150); zone.criticalMeters = Number(zone.criticalMeters || 60);
    json(response, 201, await saveDangerZone(id, zone));
  } catch (error) { json(response, 500, { error: error.message }); }
};
