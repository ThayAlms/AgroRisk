const crypto = require('node:crypto');
const { listTelemetryDataset, saveModelVersion, addSafetyLog } = require('../lib/db');
const { ANOMALY_TARGET, ANOMALY_FEATURES, extractAnomalyFeatures, robustDistance } = require('../lib/anomaly-model');

const MIN_DEVICE_ROWS = 200;
const MIN_TOTAL_ROWS = 500;

function quantile(values, probability) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position); const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function fitProfile(rows) {
  const featureRows = rows.map((row) => extractAnomalyFeatures(row.payload));
  const profile = { samples: rows.length, features: {} };
  for (const [name] of ANOMALY_FEATURES) {
    const values = featureRows.map((features) => features[name]).filter((value) => value !== null);
    if (values.length < Math.max(30, rows.length * 0.35)) continue;
    const median = quantile(values, 0.5);
    const mad = quantile(values.map((value) => Math.abs(value - median)), 0.5);
    const rangeScale = Math.max((quantile(values, .95) - quantile(values, .05)) / 3.29, 0.001);
    profile.features[name] = { median, madScaled: mad * 1.4826, minimumScale: Math.max(rangeScale * .15, 0.001), p05: quantile(values, .05), p95: quantile(values, .95), samples: values.length };
  }
  const distances = featureRows.map((features) => robustDistance(features, profile).rawScore);
  // The upper cap prevents a handful of sensor spikes from making the detector
  // blind to every later change; it is still well above the 99th percentile in
  // a normally stable robust-distance distribution.
  profile.threshold = Math.min(12, Math.max(3, quantile(distances, .99)));
  return profile;
}

async function main() {
  const sourceRows = await listTelemetryDataset(Number(process.env.MODEL_DATASET_LIMIT || 100000));
  const rows = sourceRows.filter((row) => row.payload?.demo !== true);
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.deviceId)) groups.set(row.deviceId, []);
    groups.get(row.deviceId).push(row);
  }
  const deviceProfiles = {}; const validationDetails = {};
  for (const [deviceId, deviceRows] of groups) {
    deviceRows.sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
    if (deviceRows.length < MIN_DEVICE_ROWS) continue;
    const split = Math.max(MIN_DEVICE_ROWS, Math.floor(deviceRows.length * .8));
    const training = deviceRows.slice(0, split); const validation = deviceRows.slice(split);
    const profile = fitProfile(training);
    const validationScores = validation.map((row) => robustDistance(extractAnomalyFeatures(row.payload), profile).rawScore);
    deviceProfiles[deviceId] = profile;
    validationDetails[deviceId] = {
      trainingRows: training.length, validationRows: validation.length,
      alertRate: validationScores.length ? validationScores.filter((score) => score >= profile.threshold).length / validationScores.length : 0,
      medianDistance: quantile(validationScores, .5), p95Distance: quantile(validationScores, .95), threshold: profile.threshold,
    };
  }
  const hash = crypto.createHash('sha256');
  rows.forEach((row) => hash.update(`${row.deviceId}|${row.recordedAt}|${JSON.stringify(row.payload)}\n`));
  const datasetHash = hash.digest('hex');
  const eligibleRows = Object.values(validationDetails).reduce((sum, item) => sum + item.trainingRows + item.validationRows, 0);
  const approved = eligibleRows >= MIN_TOTAL_ROWS && Object.keys(deviceProfiles).length > 0;
  const version = `robust-anomaly-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const validationMetrics = {
    eligibleRows, excludedDemoRows: sourceRows.length - rows.length, profiledDevices: Object.keys(deviceProfiles).length,
    split: 'temporal-80-20-per-device', validationByDevice: validationDetails,
    note: 'Sem rótulo de acidente: taxa de alertas mede estabilidade, não precisão de sinistro. Limiar robusto p99 limitado a 12 para resistir a picos isolados de sensor.',
  };
  const model = await saveModelVersion({
    version, algorithm: 'robust-multivariate-mad-v1', target: ANOMALY_TARGET,
    status: approved ? 'active' : 'rejected', featureNames: ANOMALY_FEATURES.map(([name]) => name),
    datasetHash, datasetRows: rows.length, trainingStartedAt: rows[0]?.recordedAt || null,
    trainingEndedAt: rows.at(-1)?.recordedAt || null, validationMetrics,
    artifact: { deviceProfiles, scoreThreshold: 70, trainedOnlyWithRealTelemetry: true },
  });
  await addSafetyLog('__system__', approved ? 'info' : 'warning', 'model-validation', `Detector de anomalias ${approved ? 'ativado' : 'não ativado'}`, {
    modelVersion: version, algorithm: model.algorithm, target: ANOMALY_TARGET, status: model.status,
    datasetHash, datasetRows: rows.length, validationMetrics, excludedDemoRows: sourceRows.length - rows.length,
  });
  console.log(JSON.stringify(model, null, 2));
  if (!approved) process.exitCode = 2;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
