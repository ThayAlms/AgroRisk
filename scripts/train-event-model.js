const crypto = require('node:crypto');
const { listTelemetryDataset, listVerifiedEventLabels, listWeatherContexts, saveModelVersion, addSafetyLog } = require('../lib/db');
const { extractFeatures, sigmoid } = require('../lib/predictive-model');

const TARGET = 'evento humano confirmado nos próximos 30 minutos';
const BASE_FEATURES = ['risk_score', 'obstacle_proximity', 'maximum_tilt', 'temperature_deviation', 'humidity_deviation', 'speed', 'outside_geofence', 'danger_zone', 'buzzer', 'missing_ratio'];
const FEATURE_NAMES = [...BASE_FEATURES, 'weather_temperature', 'weather_humidity', 'weather_precipitation', 'weather_wind'];
const POSITIVE = new Set(['incident', 'near_miss']);
const NEGATIVE = new Set(['false_alarm', 'no_damage']);

function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function standardDeviation(values, average) { return Math.sqrt(mean(values.map((value) => (value - average) ** 2))) || 1; }
function weatherFeatures(payload = {}) {
  const safe = (value, divisor) => Number.isFinite(Number(value)) ? Number(value) / divisor : 0;
  return [safe(payload.temperatureC, 50), safe(payload.humidityPercent, 100), safe(payload.precipitationMm, 100), safe(payload.windSpeedMps, 30)];
}

function prepareExamples(rows, labels, contexts) {
  const readings = new Map();
  for (const row of rows.filter((item) => item.payload?.demo !== true)) {
    if (!readings.has(row.deviceId)) readings.set(row.deviceId, []);
    readings.get(row.deviceId).push(row);
  }
  for (const values of readings.values()) values.sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
  const weather = new Map(contexts.map((item) => [`${item.deviceId}|${item.observedDate}`, item.payload]));
  const examples = [];
  for (const label of labels) {
    if (!POSITIVE.has(label.outcome) && !NEGATIVE.has(label.outcome)) continue;
    const eventTime = new Date(label.eventAt).getTime();
    const candidates = (readings.get(label.deviceId) || []).filter((row) => {
      const time = new Date(row.recordedAt).getTime();
      return time <= eventTime && time >= eventTime - 30 * 60 * 1000;
    });
    const reading = candidates.at(-1);
    if (!reading) continue;
    const date = String(reading.recordedAt).slice(0, 10);
    examples.push({
      deviceId: label.deviceId, timestamp: reading.recordedAt, y: POSITIVE.has(label.outcome) ? 1 : 0,
      x: [...extractFeatures(reading.payload), ...weatherFeatures(weather.get(`${label.deviceId}|${date}`))], labelId: label.id,
    });
  }
  return examples;
}

function train(trainRows) {
  const columns = FEATURE_NAMES.map((_, index) => trainRows.map((row) => row.x[index]));
  const means = columns.map(mean); const standardDeviations = columns.map((column, index) => standardDeviation(column, means[index]));
  const rows = trainRows.map((row) => ({ ...row, x: row.x.map((value, index) => (value - means[index]) / standardDeviations[index]) }));
  const positives = rows.filter((row) => row.y).length; const positiveWeight = Math.max(1, (rows.length - positives) / Math.max(positives, 1));
  const weights = Array(FEATURE_NAMES.length).fill(0); let intercept = 0;
  for (let iteration = 0; iteration < 1800; iteration += 1) {
    const gradients = Array(weights.length).fill(0); let interceptGradient = 0;
    for (const row of rows) {
      const prediction = sigmoid(intercept + row.x.reduce((sum, value, index) => sum + value * weights[index], 0));
      const error = (prediction - row.y) * (row.y ? positiveWeight : 1); interceptGradient += error;
      row.x.forEach((value, index) => { gradients[index] += error * value; });
    }
    intercept -= .04 * interceptGradient / rows.length;
    weights.forEach((weight, index) => { weights[index] -= .04 * (gradients[index] / rows.length + .003 * weight); });
  }
  return { weights, intercept, means, standardDeviations, horizonMinutes: 30, threshold: .5 };
}

function validate(rows, artifact) {
  let tp = 0; let tn = 0; let fp = 0; let fn = 0; let brier = 0;
  for (const row of rows) {
    const x = row.x.map((value, index) => (value - artifact.means[index]) / artifact.standardDeviations[index]);
    const probability = sigmoid(artifact.intercept + x.reduce((sum, value, index) => sum + value * artifact.weights[index], 0));
    const predicted = probability >= artifact.threshold;
    if (predicted && row.y) tp += 1; else if (predicted) fp += 1; else if (row.y) fn += 1; else tn += 1;
    brier += (probability - row.y) ** 2;
  }
  const precision = tp / Math.max(tp + fp, 1); const recall = tp / Math.max(tp + fn, 1);
  return { samples: rows.length, positives: rows.filter((row) => row.y).length, precision, recall, f1: 2 * precision * recall / Math.max(precision + recall, Number.EPSILON), accuracy: (tp + tn) / Math.max(rows.length, 1), brierScore: brier / Math.max(rows.length, 1), confusionMatrix: { tp, tn, fp, fn }, split: 'leave-devices-out' };
}

async function main() {
  const [rows, labels, contexts] = await Promise.all([listTelemetryDataset(100000), listVerifiedEventLabels(), listWeatherContexts()]);
  const examples = prepareExamples(rows, labels, contexts); const positives = examples.filter((row) => row.y).length; const negatives = examples.length - positives;
  const devices = [...new Set(examples.map((row) => row.deviceId))].sort();
  const hash = crypto.createHash('sha256');
  examples.forEach((row) => hash.update(`${row.deviceId}|${row.timestamp}|${row.labelId}|${row.y}|${row.x.join(',')}\n`));
  const datasetHash = hash.digest('hex'); const version = `verified-event-logreg-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const common = { version, algorithm: 'logistic-regression-verified-events-v1', target: TARGET, featureNames: FEATURE_NAMES, datasetHash, datasetRows: examples.length, trainingStartedAt: examples[0]?.timestamp || null, trainingEndedAt: examples.at(-1)?.timestamp || null };
  if (positives < 30 || negatives < 30 || devices.length < 5) {
    const validationMetrics = { statusReason: 'Rótulos reais insuficientes', positives, negatives, devices: devices.length, minimums: { positives: 30, negatives: 30, devices: 5 }, demoDataExcluded: true };
    const model = await saveModelVersion({ ...common, status: 'rejected', validationMetrics, artifact: {} });
    await addSafetyLog('__system__', 'warning', 'model-validation', 'Modelo de eventos aguardando rótulos humanos', { modelVersion: version, target: TARGET, datasetHash, validationMetrics });
    console.log(JSON.stringify(model, null, 2)); process.exitCode = 2; return;
  }
  const validationDevices = new Set(devices.slice(-Math.max(1, Math.ceil(devices.length * .2))));
  const training = examples.filter((row) => !validationDevices.has(row.deviceId)); const validation = examples.filter((row) => validationDevices.has(row.deviceId));
  const artifact = train(training); const rawMetrics = validate(validation, artifact);
  const validationMetrics = Object.fromEntries(Object.entries(rawMetrics).map(([key, value]) => typeof value === 'number' ? [key, Number(value.toFixed(4))] : [key, value]));
  const approved = validationMetrics.samples >= 10 && validationMetrics.precision >= .5 && validationMetrics.recall >= .6 && validationMetrics.brierScore <= .25;
  const model = await saveModelVersion({ ...common, status: approved ? 'active' : 'candidate', validationMetrics, artifact });
  await addSafetyLog('__system__', approved ? 'info' : 'warning', 'model-validation', `Modelo de eventos ${approved ? 'ativado' : 'mantido como candidato'}`, { modelVersion: version, target: TARGET, datasetHash, validationMetrics, trainingRows: training.length, validationRows: validation.length, validationDevices: [...validationDevices], demoDataExcluded: true });
  console.log(JSON.stringify(model, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
