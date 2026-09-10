const { listMachines, saveMachine } = require('../lib/db');
const { json, method, authorizedZoneEditor } = require('../lib/http');

module.exports = async (request, response) => {
  if (request.method === 'GET') {
    try { return json(response, 200, await listMachines(request.user?.role === 'farmer' ? request.user.customerId : null)); }
    catch (error) { return json(response, 500, { error: error.message }); }
  }
  if (!method(request, response, ['PUT'])) return;
  if (!authorizedZoneEditor(request)) return json(response, 401, { error: 'Edição não autorizada' });
  try {
    const deviceId = String(request.body?.deviceId || '').trim().slice(0, 80);
    if (!deviceId) return json(response, 400, { error: 'Identificação da máquina é obrigatória' });
    const customerId = request.user?.role === 'farmer' ? request.user.customerId : request.body?.customerId;
    json(response, 200, await saveMachine(deviceId, request.body, customerId));
  } catch (error) {
    json(response, 400, { error: error.message });
  }
};
