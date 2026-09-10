const assert = require('node:assert/strict');
const { generateExplanation, dataQuality } = require('../lib/explanation');

const reading = {
  deviceId: 'colheitadeira-07', timestamp: '2026-08-26T14:30:00.000Z', distanceCm: 20, buzzer: false,
  stability: { maximumAngle: 16 }, environment: { temperatureC: 42, humidityPercent: 55 }, speedKmh: 8,
  gps: { valid: true, latitude: -23.5, longitude: -46.6 }, geofence: { inside: false }, danger: { level: 'warning' },
  risk: { score: 88, level: 'ALTO', evaluatedAt: '2026-08-26T14:30:00.000Z', factors: [{ code: 'tilt-critical', label: 'Inclinação crítica', points: 25 }], alerts: ['Estabilizar o equipamento'] },
};
const analysis = generateExplanation(reading, [reading], { deviceId: reading.deviceId, name: 'Colheitadeira Norte 07' });
assert.equal(analysis.source.score, 88);
assert.equal(analysis.source.level, 'ALTO');
assert.match(analysis.audiences.broker.headline, /Colheitadeira Norte 07/);
assert.match(analysis.audiences.underwriter.summary, /Completude/);
assert.match(analysis.audiences.claims.summary, /não comprovam isoladamente causa/);
assert.equal(analysis.audit.factors[0].points, 25);
assert.equal(dataQuality(reading).completenessPercent, 100);

const unavailable = generateExplanation(null, [], { name: 'Trator 02' });
assert.equal(unavailable.source.level, 'SEM_SINAL');
assert.match(unavailable.audiences.claims.summary, /não comprova causa/);

console.log('Explanation tests passed');
