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

function enrichTelemetry(payload, config, zones) {
  const reading = structuredClone(payload);
  reading.timestamp = reading.timestamp || new Date().toISOString();
  reading.tilt = calculateTilt(reading.acceleration);
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
    tilt: [reading.tilt.roll, reading.tilt.pitch].some((value) => Number.isFinite(value) && Math.abs(value) >= config.tiltAlertDegrees),
    outsideGeofence: reading.geofence.inside === false,
    dangerZone: ['warning', 'critical'].includes(dangerLevel),
  };
  return reading;
}

module.exports = { haversineMeters, enrichTelemetry };
