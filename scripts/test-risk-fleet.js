const assert = require('node:assert/strict');
const { calculateOperationalRisk, classifyOperationalRisk } = require('../lib/risk');
const { prepareFleetMachine, sortFleet, summarizeFleet } = require('../lib/fleet');

assert.equal(classifyOperationalRisk(0), 'BAIXO');
assert.equal(classifyOperationalRisk(29), 'BAIXO');
assert.equal(classifyOperationalRisk(30), 'MEDIO');
assert.equal(classifyOperationalRisk(59), 'MEDIO');
assert.equal(classifyOperationalRisk(60), 'ALTO');
assert.equal(classifyOperationalRisk(100), 'ALTO');

const low = calculateOperationalRisk({
  distanceCm: 300, stability: { maximumAngle: 2 },
  environment: { temperatureC: 25, humidityPercent: 55 }, speedKmh: 5,
  geofence: { inside: true }, danger: { level: 'safe' }, buzzer: false,
});
assert.deepEqual({ score: low.score, level: low.level }, { score: 0, level: 'BAIXO' });

const medium = calculateOperationalRisk({
  distanceCm: 60, stability: { maximumAngle: 10 },
  environment: { temperatureC: 25, humidityPercent: 55 },
  geofence: { inside: true }, danger: { level: 'safe' }, buzzer: false,
});
assert.deepEqual({ score: medium.score, level: medium.level }, { score: 35, level: 'MEDIO' });

const high = calculateOperationalRisk({
  distanceCm: 20, stability: { maximumAngle: 16 },
  environment: { temperatureC: 25, humidityPercent: 55 },
  geofence: { inside: true }, danger: { level: 'warning' }, buzzer: false,
});
assert.deepEqual({ score: high.score, level: high.level }, { score: 63, level: 'ALTO' });

const noFalseRisk = calculateOperationalRisk({ distanceCm: null, stability: { maximumAngle: null }, environment: {} });
assert.deepEqual({ score: noFalseRisk.score, level: noFalseRisk.level }, { score: 0, level: 'BAIXO' });

const now = Date.now();
const machines = sortFleet([
  prepareFleetMachine({ deviceId: 'low', name: 'Baixo', latest: { risk: low }, lastSeenAt: new Date(now).toISOString() }, now),
  prepareFleetMachine({ deviceId: 'high', name: 'Alto', latest: { risk: high }, lastSeenAt: new Date(now).toISOString() }, now),
  prepareFleetMachine({ deviceId: 'medium', name: 'Médio', latest: { risk: medium }, lastSeenAt: new Date(now).toISOString() }, now),
  prepareFleetMachine({ deviceId: 'offline', name: 'Sem sinal', latest: null, lastSeenAt: null }, now),
]);
assert.deepEqual(machines.map((machine) => machine.risk.level), ['ALTO', 'MEDIO', 'BAIXO', 'SEM_SINAL']);
assert.deepEqual(summarizeFleet(machines), { total: 4, high: 1, medium: 1, low: 1, offline: 1 });

console.log('Risk and fleet tests passed');
