const {
  getConfig, listDangerZones, getLatestTelemetry, saveTelemetry, addSafetyLog, setCommand,
} = require('../lib/db');
const { enrichTelemetry } = require('../lib/risk');
const { json, method, deviceId, authorizedDevice } = require('../lib/http');

module.exports = async (request, response) => {
  if (!method(request, response, ['POST'])) return;
  if (!authorizedDevice(request)) return json(response, 401, { error: 'Chave do dispositivo inválida' });
  try {
    const id = deviceId(request); const payload = request.body?.telemetry || request.body;
    if (!payload || typeof payload !== 'object') return json(response, 400, { error: 'Telemetria inválida' });
    const [config, zones, previous] = await Promise.all([getConfig(id), listDangerZones(id), getLatestTelemetry(id)]);
    const reading = enrichTelemetry({ ...payload, deviceId: id }, config, zones);
    const previousLevel = previous?.danger?.level || 'unknown'; const nextLevel = reading.danger.level;
    let log = null;
    if (nextLevel !== previousLevel) {
      const nearest = reading.danger.nearest;
      if (nextLevel === 'critical') log = await addSafetyLog(id, 'critical', 'danger-zone', `Entrada na faixa crítica de ${nearest?.name || 'zona perigosa'}`, nearest || {});
      else if (nextLevel === 'warning') log = await addSafetyLog(id, 'warning', 'danger-zone', `Aproximação de ${nearest?.name || 'zona perigosa'}`, nearest || {});
      else if (nextLevel === 'safe' && ['warning', 'critical'].includes(previousLevel)) log = await addSafetyLog(id, 'info', 'danger-zone', 'Equipamento retornou à distância segura', nearest || {});
    }
    const leftGeofence = reading.geofence?.inside === false && previous?.geofence?.inside !== false;
    const returnedToGeofence = reading.geofence?.inside === true && previous?.geofence?.inside === false;
    if (leftGeofence) log = await addSafetyLog(id, 'critical', 'geofence', 'Equipamento saiu da área operacional segura', reading.geofence);
    else if (returnedToGeofence) log = await addSafetyLog(id, 'info', 'geofence', 'Equipamento retornou à área operacional segura', reading.geofence);
    const buzzerActive = nextLevel === 'critical' || reading.geofence?.inside === false;
    const reason = nextLevel === 'critical' ? 'danger-zone' : reading.geofence?.inside === false ? 'geofence' : null;
    const command = await setCommand(id, buzzerActive, reason);
    await saveTelemetry(id, reading);
    json(response, 201, { accepted: true, telemetry: reading, command, log });
  } catch (error) { json(response, 500, { error: error.message }); }
};
