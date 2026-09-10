const FEATURE_NAMES = Object.freeze([
  'risk_score', 'obstacle_proximity', 'maximum_tilt', 'temperature_deviation',
  'humidity_deviation', 'speed', 'outside_geofence', 'danger_zone', 'buzzer', 'missing_ratio',
]);

function value(number, fallback = 0) {
  return number === null || number === undefined || number === '' || !Number.isFinite(Number(number)) ? fallback : Number(number);
}

function extractFeatures(reading = {}) {
  const distance = value(reading.distanceCm, 150);
  const tilt = value(reading.stability?.maximumAngle, 0);
  const temperature = value(reading.environment?.temperatureC, 25);
  const humidity = value(reading.environment?.humidityPercent, 55);
  const speed = value(reading.speedKmh, 0);
  const required = [reading.distanceCm, reading.stability?.maximumAngle, reading.environment?.temperatureC, reading.environment?.humidityPercent, reading.speedKmh, reading.gps?.valid ? reading.gps.latitude : null];
  const missing = required.filter((item) => item === null || item === undefined || item === '' || !Number.isFinite(Number(item))).length;
  const danger = reading.danger?.level === 'critical' ? 1 : reading.danger?.level === 'warning' ? 0.5 : 0;
  return [
    value(reading.risk?.score, 0) / 100,
    Math.max(0, Math.min(1, (150 - distance) / 150)),
    Math.max(0, Math.min(1, tilt / 30)),
    Math.max(0, Math.min(1, Math.abs(temperature - 25) / 25)),
    Math.max(0, Math.min(1, Math.abs(humidity - 55) / 55)),
    Math.max(0, Math.min(1, speed / 25)),
    reading.geofence?.inside === false ? 1 : 0,
    danger,
    reading.buzzer ? 1 : 0,
    missing / required.length,
  ];
}

function sigmoid(valueToTransform) {
  const bounded = Math.max(-30, Math.min(30, valueToTransform));
  return 1 / (1 + Math.exp(-bounded));
}

function predictEscalation(reading, model) {
  const artifact = model?.artifact;
  if (!artifact || !Array.isArray(artifact.weights) || !Array.isArray(artifact.means) || !Array.isArray(artifact.standardDeviations)) return null;
  const features = extractFeatures(reading);
  const standardized = features.map((feature, index) => (feature - artifact.means[index]) / (artifact.standardDeviations[index] || 1));
  const logit = standardized.reduce((total, feature, index) => total + feature * artifact.weights[index], Number(artifact.intercept) || 0);
  const probability = sigmoid(logit);
  return {
    probability,
    probabilityPercent: Math.round(probability * 100),
    horizonReadings: artifact.horizonReadings || 5,
    modelVersion: model.version,
    datasetHash: model.datasetHash,
    validationMetrics: model.validationMetrics,
    advisoryOnly: true,
  };
}

module.exports = { FEATURE_NAMES, extractFeatures, predictEscalation, sigmoid };
