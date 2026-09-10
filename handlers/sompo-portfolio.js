const { buildSompoPortfolio } = require('../lib/portfolio');
const { json, method } = require('../lib/http');

module.exports = async (request, response) => {
  if (!method(request, response, ['GET'])) return;
  try { return json(response, 200, await buildSompoPortfolio()); }
  catch (error) { return json(response, 500, { error: error.message }); }
};
