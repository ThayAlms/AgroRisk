const { getLatestTelemetry, getConfig, getCommand, hasDatabase } = require('../lib/db');
const { json, method, deviceId } = require('../lib/http');

module.exports = async (request, response) => {
  if (!method(request, response, ['GET'])) return;
  try {
    const id = deviceId(request);
    const [latest, config, command] = await Promise.all([getLatestTelemetry(id), getConfig(id), getCommand(id)]);
    const ageMs = latest?.timestamp ? Date.now() - new Date(latest.timestamp).getTime() : Infinity;
    json(response, 200, {
      deviceId: id,
      serial: { connected: ageMs < 15_000, port: latest?.gateway?.port || 'gateway remoto', baudRate: latest?.gateway?.baudRate || 115200, error: ageMs < 15_000 ? null : 'Sem telemetria recente', commandsEnabled: Boolean(latest?.gateway?.commandsEnabled) },
      latest, config, command, storage: hasDatabase() ? 'postgresql' : 'memory',
    });
  } catch (error) {
    json(response, 500, { error: error.message });
  }
};
