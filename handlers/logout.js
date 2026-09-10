const { clearSessionCookie } = require('../lib/auth');
const { json, method } = require('../lib/http');

module.exports = async (request, response) => {
  if (!method(request, response, ['POST'])) return;
  clearSessionCookie(request, response);
  return json(response, 200, { ok: true });
};
