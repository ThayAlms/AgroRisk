const { listDangerZones, saveDangerZone, disableDangerZone } = require('../lib/db');
const { json, method, deviceId, authorizedZoneEditor } = require('../lib/http');

function normalizeZone(input, device) {
  const coordinates = Array.isArray(input?.coordinates) ? input.coordinates.slice(0, 500).map((point) => [Number(point?.[0]), Number(point?.[1])]) : [];
  const validCoordinates = coordinates.length >= 2 && coordinates.every(([lat, lon]) => Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lon) && lon >= -180 && lon <= 180);
  if (!validCoordinates) return null;
  const category = ['water', 'flood', 'quarry', 'cliff', 'steep_slope', 'bridge', 'road', 'powerline', 'restricted', 'other'].includes(input.category) ? input.category : 'other';
  const safeId = String(input.id || `manual-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
  return {
    id: `${device}-${safeId}`.slice(0, 180),
    name: String(input.name || 'Área de risco').replace(/[<>]/g, '').slice(0, 100),
    category,
    coordinates,
    closed: input.closed !== false,
    warningMeters: Math.min(Math.max(Number(input.warningMeters) || 150, 20), 5000),
    criticalMeters: Math.min(Math.max(Number(input.criticalMeters) || 60, 5), 1000),
    source: input.source === 'openstreetmap-confirmed' ? input.source : 'manual',
  };
}

module.exports = async (request, response) => {
  if (!method(request, response, ['GET', 'POST', 'DELETE'])) return;
  try {
    const id = deviceId(request);
    if (request.method === 'GET') {
      const zones = await listDangerZones(id);
      return json(response, 200, { zones, loadedAt: new Date().toISOString(), center: null, error: null });
    }
    if (!authorizedZoneEditor(request)) return json(response, 401, { error: 'Edição de zonas não autorizada' });
    if (request.method === 'DELETE') {
      const zoneId = String(request.query?.id || '').slice(0, 180);
      if (!zoneId) return json(response, 400, { error: 'Identificador da zona não informado' });
      const removed = await disableDangerZone(id, zoneId);
      return json(response, removed ? 200 : 404, { removed });
    }
    const zone = normalizeZone(request.body?.zone || request.body, id);
    if (!zone || zone.criticalMeters >= zone.warningMeters) return json(response, 400, { error: 'Zona perigosa inválida' });
    json(response, 201, await saveDangerZone(id, zone));
  } catch (error) { json(response, 500, { error: error.message }); }
};
