const { getCommand } = require('../lib/db');
const { json, method, deviceId, authorizedDevice } = require('../lib/http');

module.exports = async (request, response) => {
  if (!method(request, response, ['GET'])) return;
  if (!authorizedDevice(request)) return json(response, 401, { error: 'Chave do dispositivo inválida' });
  try { json(response, 200, await getCommand(deviceId(request))); }
  catch (error) { json(response, 500, { error: error.message }); }
};
