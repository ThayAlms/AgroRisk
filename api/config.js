const { getConfig, saveConfig } = require('../lib/db');
const { json, method, deviceId, authorizedZoneEditor } = require('../lib/http');

module.exports = async (request, response) => {
  if (!method(request, response, ['GET', 'PUT'])) return;
  const id = deviceId(request);
  try {
    if (request.method === 'GET') return json(response, 200, await getConfig(id));
    if (!authorizedZoneEditor(request)) return json(response, 401, { error: 'Edição do geofence não autorizada' });
    const current = await getConfig(id); const body = request.body || {};
    const next = {
      geofence: {
        latitude: body.geofence?.latitude == null ? null : Number(body.geofence.latitude),
        longitude: body.geofence?.longitude == null ? null : Number(body.geofence.longitude),
        radiusMeters: Number(body.geofence?.radiusMeters ?? current.geofence.radiusMeters),
      },
      distanceAlertCm: Number(body.distanceAlertCm ?? current.distanceAlertCm),
      tiltAlertDegrees: Number(body.tiltAlertDegrees ?? current.tiltAlertDegrees),
      dangerZones: {
        warningDistanceMeters: Number(body.dangerZones?.warningDistanceMeters ?? current.dangerZones.warningDistanceMeters),
        criticalDistanceMeters: Number(body.dangerZones?.criticalDistanceMeters ?? current.dangerZones.criticalDistanceMeters),
      },
    };
    const numeric = [next.geofence.radiusMeters, next.distanceAlertCm, next.tiltAlertDegrees, next.dangerZones.warningDistanceMeters, next.dangerZones.criticalDistanceMeters];
    if (!numeric.every((value) => Number.isFinite(value) && value > 0) || next.dangerZones.criticalDistanceMeters >= next.dangerZones.warningDistanceMeters) {
      return json(response, 400, { error: 'Configuração inválida' });
    }
    json(response, 200, await saveConfig(id, next));
  } catch (error) { json(response, 500, { error: error.message }); }
};
