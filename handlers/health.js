const { hasDatabase, ensureSchema } = require('../lib/db');
const { json, method } = require('../lib/http');

module.exports = async (request, response) => {
  if (!method(request, response, ['GET'])) return;
  try {
    await ensureSchema();
    json(response, 200, { ok: true, database: hasDatabase() ? 'postgresql' : 'memory', timestamp: new Date().toISOString() });
  } catch (error) {
    json(response, 503, { ok: false, error: error.message });
  }
};
