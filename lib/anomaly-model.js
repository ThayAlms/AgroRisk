const ANOMALY_TARGET = 'anomalia multivariada por equipamento';
const ANOMALY_FEATURES = Object.freeze([
  ['distance_cm', 'Distância frontal', (r) => r.distanceCm],
  ['maximum_tilt_deg', 'Inclinação máxima', (r) => r.stability?.maximumAngle],
  ['temperature_c', 'Temperatura', (r) => r.environment?.temperatureC],
  ['humidity_percent', 'Umidade', (r) => r.environment?.humidityPercent],
  ['speed_kmh', 'Velocidade', (r) => r.speedKmh],
  ['angular_speed_deg_s', 'Velocidade angular', (r) => r.stability?.angularSpeedDegS],
  ['gravity_magnitude', 'Magnitude da aceleração', (r) => r.stability?.gravityMagnitude],
]);

function numeric(value) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) ? number : null;
}

function extractAnomalyFeatures(reading = {}) {
  return Object.fromEntries(ANOMALY_FEATURES.map(([name, , getter]) => [name, numeric(getter(reading))]));
}

function robustDistance(features, profile) {
  const deviations = ANOMALY_FEATURES.map(([name, label]) => {
    const value = features[name]; const baseline = profile.features[name];
    if (value === null || !baseline) return null;
    const z = Math.abs(value - baseline.median) / Math.max(baseline.madScaled, baseline.minimumScale);
    return { name, label, value, baseline: baseline.median, deviation: z };
  }).filter(Boolean).sort((a, b) => b.deviation - a.deviation);
  const leading = deviations.slice(0, 3);
  return { rawScore: leading.length ? leading.reduce((total, item) => total + item.deviation, 0) / leading.length : 0, deviations };
}

function detectAnomaly(reading, deviceId, model) {
  const profile = model?.artifact?.deviceProfiles?.[deviceId];
  if (!profile) return { available: false, reason: 'Máquina ainda sem perfil mínimo de telemetria real', advisoryOnly: true };
  const { rawScore, deviations } = robustDistance(extractAnomalyFeatures(reading), profile);
  const threshold = Number(profile.threshold) || 3;
  const score = Math.round(Math.min(100, rawScore / threshold * 70));
  return {
    available: true, anomalous: rawScore >= threshold, score, thresholdScore: 70,
    rawScore: Number(rawScore.toFixed(3)), threshold: Number(threshold.toFixed(3)),
    unusualFeatures: deviations.filter((item) => item.deviation >= 2).slice(0, 3).map((item) => ({ ...item, deviation: Number(item.deviation.toFixed(2)) })),
    modelVersion: model.version, datasetHash: model.datasetHash, algorithm: model.algorithm,
    advisoryOnly: true,
  };
}

module.exports = { ANOMALY_TARGET, ANOMALY_FEATURES, extractAnomalyFeatures, robustDistance, detectAnomaly };
