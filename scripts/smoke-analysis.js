const assert = require('node:assert/strict');
const analysisHandler = require('../handlers/analysis');
const { listSafetyLogs } = require('../lib/db');

async function main() {
  const deviceId = process.env.SMOKE_DEVICE_ID || 'colheitadeira-01';
  let statusCode; let body;
  const response = {
    status(code) { statusCode = code; return this; },
    setHeader() { return this; },
    json(value) { body = value; return this; },
  };
  await analysisHandler({ method: 'GET', query: { deviceId }, body: {}, headers: {} }, response);
  assert.equal(statusCode, 200);
  assert.ok(body.audiences?.broker?.summary);
  assert.ok(body.audiences?.underwriter?.summary);
  assert.ok(body.audiences?.claims?.summary);
  const logs = await listSafetyLogs(deviceId, 100);
  const auditLogged = logs.some((entry) => entry.type === 'ai-explanation' && entry.details?.explanationVersion === body.version);
  assert.equal(auditLogged, true);
  console.log(JSON.stringify({ ok: true, deviceId, modelStatus: body.governance?.status, auditLogged }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
