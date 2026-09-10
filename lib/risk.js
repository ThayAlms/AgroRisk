function haversineMeters(lat1, lon1, lat2, lon2) {
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(lat2 - lat1); const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function localPoint(originLat, originLon, latitude, longitude) {
  return { x: (longitude - originLon) * 111320 * Math.cos(originLat * Math.PI / 180), y: (latitude - originLat) * 110540 };
}

function segmentDistance(point, start, end) {
  const dx = end.x - start.x; const dy = end.y - start.y;
  if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

function insidePolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]; const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || Number.EPSILON) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToZone(latitude, longitude, zone) {
  const points = (zone.coordinates || []).map(([lat, lon]) => localPoint(latitude, longitude, lat, lon));
  if (points.length < 2) return null;
  if (zone.closed && insidePolygon({ x: 0, y: 0 }, points)) return 0;
  let minimum = Infinity;
  for (let index = 1; index < points.length; index++) minimum = Math.min(minimum, segmentDistance({ x: 0, y: 0 }, points[index - 1], points[index]));
  return minimum;
}

function calculateTilt(acceleration = {}) {
  const { x, y, z } = acceleration;
  if (![x, y, z].every(Number.isFinite) || (!x && !y && !z)) return { roll: null, pitch: null };
  return { roll: Math.atan2(y, z) * 180 / Math.PI, pitch: Math.atan2(-x, Math.sqrt(y * y + z * z)) * 180 / Math.PI };
}

function calculateStability(tilt = {}, acceleration = {}, gyroscope = {}, limitDegrees = 15) {
  const roll = Number(tilt.roll); const pitch = Number(tilt.pitch);
  const valid = Number.isFinite(roll) && Number.isFinite(pitch);
  const limit = Number.isFinite(Number(limitDegrees)) && Number(limitDegrees) > 0 ? Number(limitDegrees) : 15;
  const maximumAngle = valid ? Math.max(Math.abs(roll), Math.abs(pitch)) : null;
  const utilizationPercent = valid ? maximumAngle / limit * 100 : null;
  const warningAt = limit * 0.7;
  const level = !valid ? 'unavailable' : maximumAngle >= limit ? 'critical' : maximumAngle >= warningAt ? 'warning' : 'safe';
  const dominantAxis = !valid ? null : Math.abs(roll) >= Math.abs(pitch) ? 'lateral' : 'longitudinal';
  const dominantAngle = dominantAxis === 'lateral' ? roll : dominantAxis === 'longitudinal' ? pitch : null;
  const direction = dominantAxis === 'lateral'
    ? (dominantAngle >= 0 ? 'lateral_positiva' : 'lateral_negativa')
    : dominantAxis === 'longitudinal' ? (dominantAngle >= 0 ? 'frontal_positiva' : 'frontal_negativa') : null;

  const gyroValues = [gyroscope.x, gyroscope.y, gyroscope.z].map(Number);
  const angularSpeedDegS = gyroValues.every(Number.isFinite)
    ? Math.hypot(...gyroValues) * 180 / Math.PI : null;
  const motion = angularSpeedDegS === null ? 'unavailable' : angularSpeedDegS >= 12 ? 'abrupt' : angularSpeedDegS >= 3 ? 'moving' : 'steady';

  const accelerationValues = [acceleration.x, acceleration.y, acceleration.z].map(Number);
  const gravityMagnitude = accelerationValues.every(Number.isFinite) ? Math.hypot(...accelerationValues) : null;
  const gravityError = gravityMagnitude === null ? null : Math.abs(gravityMagnitude - 9.80665);
  const sensorQuality = !valid || gravityError === null ? 'unavailable' : gravityError <= 1.5 ? 'good' : gravityError <= 3.5 ? 'fair' : 'poor';

  return {
    level, maximumAngle, limitDegrees: limit,
    marginDegrees: valid ? limit - maximumAngle : null,
    utilizationPercent, dominantAxis, direction,
    angularSpeedDegS, motion, sensorQuality, gravityMagnitude,
  };
}

function classifyOperationalRisk(score) {
  if (score < 30) return 'BAIXO';
  if (score < 60) return 'MEDIO';
  return 'ALTO';
}

function calculateOperationalRisk(reading = {}) {
  let score = 0;
  const factors = [];
  const alerts = [];
  const numeric = (value) => value === null || value === undefined || value === '' ? null : Number(value);
  const add = (points, code, label, alert) => {
    score += points;
    factors.push({ code, label, points });
    if (alert) alerts.push(alert);
  };

  const distance = numeric(reading.distanceCm);
  if (Number.isFinite(distance)) {
    if (distance <= 30) add(30, 'obstacle-critical', 'Obstáculo crítico', 'Parar: obstáculo muito próximo');
    else if (distance <= 75) add(20, 'obstacle-near', 'Obstáculo próximo', 'Reduzir velocidade');
    else if (distance <= 150) add(10, 'obstacle-warning', 'Obstáculo em atenção');
  }

  const tilt = numeric(reading.stability?.maximumAngle);
  if (Number.isFinite(tilt)) {
    if (tilt >= 15) add(25, 'tilt-critical', 'Inclinação crítica', 'Estabilizar o equipamento');
    else if (tilt >= 10) add(15, 'tilt-high', 'Inclinação elevada');
    else if (tilt >= 7) add(5, 'tilt-warning', 'Inclinação em atenção');
  }

  const temperature = numeric(reading.environment?.temperatureC);
  if (Number.isFinite(temperature)) {
    if (temperature >= 40 || temperature <= 5) add(15, 'temperature-extreme', 'Temperatura extrema', 'Verificar condição térmica');
    else if (temperature >= 35 || temperature <= 10) add(8, 'temperature-warning', 'Temperatura em atenção');
  }

  const humidity = numeric(reading.environment?.humidityPercent);
  if (Number.isFinite(humidity)) {
    if (humidity >= 90 || humidity <= 20) add(10, 'humidity-extreme', 'Umidade extrema');
    else if (humidity >= 80 || humidity <= 30) add(5, 'humidity-warning', 'Umidade em atenção');
  }

  const speed = numeric(reading.speedKmh);
  if (Number.isFinite(speed)) {
    if (speed >= 15) add(10, 'speed-high', 'Velocidade alta', 'Reduzir velocidade operacional');
    else if (speed >= 10) add(5, 'speed-warning', 'Velocidade elevada');
  }

  if (reading.geofence?.inside === false) add(10, 'outside-geofence', 'Fora da área autorizada', 'Retornar à área operacional');
  if (reading.danger?.level === 'critical') add(15, 'danger-zone-critical', 'Zona perigosa crítica', 'Afastar-se da zona perigosa');
  else if (reading.danger?.level === 'warning') add(8, 'danger-zone-warning', 'Proximidade de zona perigosa');
  if (reading.buzzer) add(10, 'buzzer-active', 'Alarme físico acionado');

  score = Math.min(score, 100);
  return {
    score,
    level: classifyOperationalRisk(score),
    factors: factors.length ? factors : [{ code: 'normal', label: 'Nenhum fator de risco relevante', points: 0 }],
    alerts: alerts.length ? alerts : ['Operação dentro dos parâmetros seguros'],
    evaluatedAt: reading.timestamp || new Date().toISOString(),
  };
}

function enrichTelemetry(payload, config, zones) {
  const reading = structuredClone(payload);
  reading.timestamp = reading.timestamp || new Date().toISOString();
  reading.tilt = calculateTilt(reading.acceleration);
  reading.stability = calculateStability(reading.tilt, reading.acceleration, reading.gyroscope, config.tiltAlertDegrees);
  const gpsValid = Number.isFinite(reading.gps?.latitude) && Number.isFinite(reading.gps?.longitude);
  reading.gps = { ...(reading.gps || {}), valid: gpsValid };
  const fence = config.geofence;
  const fenceConfigured = Number.isFinite(fence?.latitude) && Number.isFinite(fence?.longitude);
  const distanceFromCenter = gpsValid && fenceConfigured ? haversineMeters(reading.gps.latitude, reading.gps.longitude, fence.latitude, fence.longitude) : null;
  reading.geofence = { configured: fenceConfigured, distanceFromCenter, inside: distanceFromCenter === null ? null : distanceFromCenter <= fence.radiusMeters };
  let nearest = null;
  if (gpsValid) for (const zone of zones) {
    const distanceMeters = distanceToZone(reading.gps.latitude, reading.gps.longitude, zone);
    if (distanceMeters !== null && (!nearest || distanceMeters < nearest.distanceMeters)) nearest = { id: zone.id, name: zone.name, category: zone.category, distanceMeters, warningMeters: zone.warningMeters, criticalMeters: zone.criticalMeters };
  }
  const dangerLevel = !nearest ? (zones.length ? 'safe' : 'unknown') : nearest.distanceMeters <= nearest.criticalMeters ? 'critical' : nearest.distanceMeters <= nearest.warningMeters ? 'warning' : 'safe';
  reading.danger = { level: dangerLevel, nearest, zonesLoaded: zones.length };
  reading.alerts = {
    obstacle: reading.buzzer || (Number.isFinite(reading.distanceCm) && reading.distanceCm <= config.distanceAlertCm),
    tilt: reading.stability.level === 'critical',
    outsideGeofence: reading.geofence.inside === false,
    dangerZone: ['warning', 'critical'].includes(dangerLevel),
  };
  reading.risk = calculateOperationalRisk(reading);
  return reading;
}

module.exports = { haversineMeters, enrichTelemetry, calculateStability, calculateOperationalRisk, classifyOperationalRisk };
