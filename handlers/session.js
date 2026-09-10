const { readSession, publicUser } = require('../lib/auth');
const { json, method } = require('../lib/http');

module.exports = async (request, response) => {
  if (!method(request, response, ['GET'])) return;
  const user = readSession(request);
  if (!user) return json(response, 401, { authenticated: false });
  return json(response, 200, { authenticated: true, user: publicUser(user) });
};
