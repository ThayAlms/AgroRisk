const assert = require('node:assert/strict');

process.env.APP_SESSION_SECRET = 'test-session-secret-with-enough-entropy';
delete process.env.DATABASE_URL;

const { authenticate, setSessionCookie, readSession, publicUser } = require('../lib/auth');
const { buildSompoPortfolio } = require('../lib/portfolio');

function cookieResponse() {
  return { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; } };
}

(async () => {
  const farmer = await authenticate('donodafazenda@sompo.com', '123456789');
  const sompo = await authenticate('sompo@sompo.com', '123456789');
  assert.equal(farmer.role, 'farmer');
  assert.equal(farmer.customerId, 'cust-farm-001');
  assert.equal(sompo.role, 'sompo');
  assert.equal(await authenticate('sompo@sompo.com', 'senha-errada'), null);

  const response = cookieResponse();
  setSessionCookie({ headers: {} }, response, farmer);
  const cookie = response.headers['set-cookie'];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const session = readSession({ headers: { cookie: cookie.split(';')[0] } });
  assert.deepEqual(publicUser(session), { id: farmer.id, email: farmer.email, name: farmer.name, role: 'farmer', customerId: 'cust-farm-001' });

  const portfolio = await buildSompoPortfolio();
  assert.equal(portfolio.contractors.length, 4);
  assert.equal(portfolio.summary.activeContractors, 4);
  assert.equal(portfolio.summary.openClaims, 3);
  assert.ok(portfolio.summary.exposure > 0);
  assert.equal(portfolio.demoData, true);
  assert.equal(portfolio.contractors[0].risk.level, 'ALTO');
  console.log('Authentication and Sompo portfolio tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
