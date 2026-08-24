const { saveLocation, getLatestTelemetry, getConfig, listDangerZones, saveTelemetry } = require('../lib/db');
const { enrichTelemetry } = require('../lib/risk');
const { json, method, deviceId } = require('../lib/http');

module.exports = async (request, response) => {
  if (!method(request, response, ['POST'])) return;
  try {
    const id = deviceId(request); const latitude = Number(request.body?.latitude); const longitude = Number(request.body?.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return json(response, 400, { error: 'Coordenadas inválidas' });
    const location = { latitude, longitude, accuracyMeters: Number(request.body?.accuracyMeters) || null, source: 'notebook', timestamp: request.body?.timestamp || new Date().toISOString() };
    await saveLocation(id, location);
    const previous = await getLatestTelemetry(id);
    if (previous && (!previous.gps?.valid || previous.gps?.source !== 'esp32')) {
      const [config, zones] = await Promise.all([getConfig(id), listDangerZones(id)]);
      const updated = enrichTelemetry({ ...previous, timestamp: new Date().toISOString(), gps: { ...location, valid: true } }, config, zones);
      await saveTelemetry(id, updated);
    }
    json(response, 200, location);
  } catch (error) { json(response, 500, { error: error.message }); }
};
