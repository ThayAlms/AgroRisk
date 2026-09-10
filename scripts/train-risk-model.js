const crypto = require('node:crypto');
const { listTelemetryDataset, saveModelVersion, addSafetyLog } = require('../lib/db');
const { calculateOperationalRisk } = require('../lib/risk');
const { FEATURE_NAMES, extractFeatures, sigmoid } = require('../lib/predictive-model');

const HORIZON = 5;
const MIN_EXAMPLES = 30;

function mean(values) { return values.reduce((total, value) => total + value, 0) / values.length; }
function standardDeviation(values, average) { return Math.sqrt(mean(values.map((value) => (value - average) ** 2))) || 1; }

function prepareExamples(rows) {
  const groups = new Map();
  for (const row of rows) {
    const reading = structuredClone(row.payload || {});
    reading.timestamp = reading.timestamp || row.recordedAt;
    reading.risk = reading.risk || calculateOperationalRisk(reading);
    if (!groups.has(row.deviceId)) groups.set(row.deviceId, []);
    groups.get(row.deviceId).push(reading);
  }
  const examples = [];
  for (const [deviceId, readings] of groups) {
    readings.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    for (let index = 0; index < readings.length - 1; index += 1) {
      const future = readings.slice(index + 1, index + 1 + HORIZON);
      if (!future.length) continue;
      examples.push({ deviceId, timestamp: readings[index].timestamp, x: extractFeatures(readings[index]), y: future.some((item) => item.risk.level === 'ALTO') ? 1 : 0 });
    }
  }
  return examples.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function trainLogisticRegression(train) {
  const columns = FEATURE_NAMES.map((_, column) => train.map((row) => row.x[column]));
  const means = columns.map(mean);
  const standardDeviations = columns.map((column, index) => standardDeviation(column, means[index]));
  const normalized = train.map((row) => ({ ...row, x: row.x.map((feature, index) => (feature - means[index]) / standardDeviations[index]) }));
  const positives = normalized.filter((row) => row.y === 1).length;
  const positiveWeight = Math.max(1, (normalized.length - positives) / Math.max(positives, 1));
  const weights = Array(FEATURE_NAMES.length).fill(0);
  let intercept = 0;
  const learningRate = 0.05; const l2 = 0.002;
  for (let iteration = 0; iteration < 1500; iteration += 1) {
    const gradients = Array(weights.length).fill(0); let interceptGradient = 0;
    for (const row of normalized) {
      const prediction = sigmoid(intercept + row.x.reduce((total, feature, index) => total + feature * weights[index], 0));
      const sampleWeight = row.y ? positiveWeight : 1;
      const error = (prediction - row.y) * sampleWeight;
      interceptGradient += error;
      row.x.forEach((feature, index) => { gradients[index] += error * feature; });
    }
    intercept -= learningRate * interceptGradient / normalized.length;
    weights.forEach((weight, index) => { weights[index] -= learningRate * (gradients[index] / normalized.length + l2 * weight); });
  }
  return { weights, intercept, means, standardDeviations, horizonReadings: HORIZON, threshold: 0.5 };
}

function validate(rows, artifact) {
  let tp = 0; let tn = 0; let fp = 0; let fn = 0; let brier = 0;
  for (const row of rows) {
    const x = row.x.map((feature, index) => (feature - artifact.means[index]) / artifact.standardDeviations[index]);
    const probability = sigmoid(artifact.intercept + x.reduce((total, feature, index) => total + feature * artifact.weights[index], 0));
    const predicted = probability >= artifact.threshold ? 1 : 0;
    if (predicted && row.y) tp += 1; else if (predicted) fp += 1; else if (row.y) fn += 1; else tn += 1;
    brier += (probability - row.y) ** 2;
  }
  const precision = tp / Math.max(tp + fp, 1); const recall = tp / Math.max(tp + fn, 1);
  return {
    samples: rows.length, positives: rows.filter((row) => row.y === 1).length,
    accuracy: (tp + tn) / Math.max(rows.length, 1), precision, recall,
    f1: 2 * precision * recall / Math.max(precision + recall, Number.EPSILON),
    brierScore: brier / Math.max(rows.length, 1), confusionMatrix: { tp, tn, fp, fn }, split: 'temporal-80-20',
  };
}

function roundedMetrics(metrics) {
  return Object.fromEntries(Object.entries(metrics).map(([key, value]) => typeof value === 'number' ? [key, Number(value.toFixed(4))] : [key, value]));
}

async function main() {
  const rows = await listTelemetryDataset(Number(process.env.MODEL_DATASET_LIMIT || 50000));
  const hash = crypto.createHash('sha256');
  rows.forEach((row) => hash.update(`${row.deviceId}|${row.recordedAt}|${JSON.stringify(row.payload)}\n`));
  const datasetHash = hash.digest('hex');
  const examples = prepareExamples(rows);
  const version = `escalation-logreg-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const common = {
    version, algorithm: 'logistic-regression-gradient-descent', target: `risco ALTO nas próximas ${HORIZON} leituras`,
    featureNames: FEATURE_NAMES, datasetHash, datasetRows: rows.length,
    trainingStartedAt: rows[0]?.recordedAt || null, trainingEndedAt: rows.at(-1)?.recordedAt || null,
  };
  const positives = examples.filter((row) => row.y === 1).length;
  if (examples.length < MIN_EXAMPLES || positives < 5 || examples.length - positives < 5) {
    const validationMetrics = { samples: examples.length, positives, statusReason: 'Histórico insuficiente ou sem diversidade de classes', minimumExamples: MIN_EXAMPLES };
    const model = await saveModelVersion({ ...common, status: 'rejected', validationMetrics, artifact: {} });
    await addSafetyLog('__system__', 'warning', 'model-validation', `Modelo ${version} não ativado`, { modelVersion: version, datasetHash, datasetRows: rows.length, validationMetrics, target: common.target });
    console.log(JSON.stringify(model, null, 2)); process.exitCode = 2; return;
  }
  const splitAt = Math.max(1, Math.floor(examples.length * 0.8));
  const train = examples.slice(0, splitAt); const validation = examples.slice(splitAt);
  const artifact = trainLogisticRegression(train);
  const validationMetrics = roundedMetrics(validate(validation, artifact));
  const approved = validationMetrics.samples >= 20 && validationMetrics.recall >= 0.5 && validationMetrics.precision >= 0.3;
  const status = approved ? 'active' : 'candidate';
  const model = await saveModelVersion({ ...common, status, validationMetrics, artifact });
  await addSafetyLog('__system__', approved ? 'info' : 'warning', 'model-validation', `Modelo ${version} ${approved ? 'ativado' : 'mantido como candidato'}`, {
    modelVersion: version, algorithm: common.algorithm, target: common.target, status,
    datasetHash, datasetRows: rows.length, trainingRows: train.length, validationRows: validation.length,
    validationMetrics, featureNames: FEATURE_NAMES, temporalSplit: true,
  });
  console.log(JSON.stringify(model, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
