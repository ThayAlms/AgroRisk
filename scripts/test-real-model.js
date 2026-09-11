const assert = require('node:assert/strict');
const { detectAnomaly } = require('../lib/anomaly-model');
const { getUserByEmail, saveEventLabel, reviewEventLabel, listVerifiedEventLabels, saveWeatherContext, listWeatherContexts, getLearningReadiness } = require('../lib/db');

async function main() {
  const profile = {
    threshold: 3,
    features: {
      distance_cm: { median: 100, madScaled: 10, minimumScale: 1 },
      maximum_tilt_deg: { median: 4, madScaled: 1, minimumScale: .2 },
      temperature_c: { median: 30, madScaled: 2, minimumScale: .5 },
    },
  };
  const model = { version: 'test-v1', datasetHash: 'test', algorithm: 'robust-mad', artifact: { deviceProfiles: { 'machine-1': profile } } };
  assert.equal(detectAnomaly({ distanceCm: 101, stability: { maximumAngle: 4.1 }, environment: { temperatureC: 30.2 } }, 'machine-1', model).anomalous, false);
  const anomalous = detectAnomaly({ distanceCm: 20, stability: { maximumAngle: 15 }, environment: { temperatureC: 48 } }, 'machine-1', model);
  assert.equal(anomalous.anomalous, true);
  assert.ok(anomalous.unusualFeatures.length >= 2);

  const farmer = await getUserByEmail('donodafazenda@sompo.com');
  const sompo = await getUserByEmail('sompo@sompo.com');
  const event = await saveEventLabel(farmer, { deviceId: 'trator-demo-09', eventType: 'rollover', outcome: 'near_miss', severity: 'high' });
  assert.equal(event.source, 'demo', 'cenários demonstrativos precisam ser marcados como demo');
  assert.equal(event.verificationStatus, 'pending');
  await reviewEventLabel(sompo, event.id, 'verified');
  assert.equal((await listVerifiedEventLabels()).some((item) => item.id === event.id), false, 'rótulos demo não podem entrar no treino');

  await saveWeatherContext({ deviceId: 'machine-1', observedDate: '2026-01-01', latitude: -12.5, longitude: -55.7, source: 'NASA_POWER_DAILY', payload: { temperatureC: 29 } });
  assert.equal((await listWeatherContexts()).length, 1);
  const readiness = await getLearningReadiness();
  assert.equal(readiness.verifiedLabels, 0);
  console.log('Modelo real: detector, isolamento demo, validação humana e clima aprovados.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
