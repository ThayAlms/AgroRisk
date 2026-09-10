const { getLatestTelemetry, listTelemetry, listMachines } = require('../lib/db');
const { generateExplanation } = require('../lib/explanation');
const { json, method, deviceId } = require('../lib/http');

module.exports = async (request, response) => {
  if (!method(request, response, ['GET'])) return;
  try {
    const id = deviceId(request);
    const [latest, history, machines] = await Promise.all([getLatestTelemetry(id), listTelemetry(id, 30), listMachines()]);
    const machine = machines.find((item) => item.deviceId === id) || { deviceId: id, name: id };
    json(response, 200, generateExplanation(latest, history, machine));
  } catch (error) {
    json(response, 500, { error: error.message });
  }
};
