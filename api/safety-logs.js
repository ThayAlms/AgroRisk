const { listSafetyLogs } = require('../lib/db');
const { json, method, deviceId } = require('../lib/http');

module.exports = async (request, response) => {
  if (!method(request, response, ['GET'])) return;
  try { json(response, 200, await listSafetyLogs(deviceId(request), request.query?.limit)); }
  catch (error) { json(response, 500, { error: error.message }); }
};
