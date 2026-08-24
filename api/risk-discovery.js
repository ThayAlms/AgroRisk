const { json, method } = require('../lib/http');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

function categoryOf(tags = {}) {
  if (tags.landuse === 'quarry') return 'quarry';
  if (tags.natural === 'cliff') return 'cliff';
  return 'water';
}

function nameOf(element, category) {
  const given = String(element.tags?.name || '').replace(/[<>]/g, '').slice(0, 90);
  if (given) return given;
  if (category === 'quarry') return 'Pedreira mapeada';
  if (category === 'cliff') return 'Escarpa mapeada';
  return 'Curso ou área de água';
}

function simplifyGeometry(geometry = []) {
  if (geometry.length <= 250) return geometry;
  const stride = Math.ceil(geometry.length / 250);
  return geometry.filter((_, index) => index % stride === 0 || index === geometry.length - 1);
}

module.exports = async (request, response) => {
  if (!method(request, response, ['GET'])) return;
  try {
    const latitude = Number(request.query?.latitude);
    const longitude = Number(request.query?.longitude);
    const radius = Math.min(Math.max(Number(request.query?.radius) || 5000, 500), 10_000);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return json(response, 400, { error: 'Localização válida necessária para mapear riscos' });
    }
    const query = `[out:json][timeout:20];(way(around:${radius},${latitude},${longitude})["natural"="water"];way(around:${radius},${latitude},${longitude})["waterway"~"^(river|stream|canal|drain)$"];way(around:${radius},${latitude},${longitude})["landuse"="quarry"];way(around:${radius},${latitude},${longitude})["natural"="cliff"];);out tags geom;`;
    const overpass = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'AgroRisk/1.0 risk-mapping' },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(24_000),
    });
    if (!overpass.ok) throw new Error(`OpenStreetMap indisponível (${overpass.status})`);
    const data = await overpass.json();
    const candidates = (data.elements || []).slice(0, 60).map((element) => {
      const geometry = simplifyGeometry(element.geometry || []);
      const coordinates = geometry.map(({ lat, lon }) => [Number(lat), Number(lon)]).filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
      if (coordinates.length < 2) return null;
      const category = categoryOf(element.tags);
      const first = coordinates[0]; const last = coordinates.at(-1);
      return {
        id: `osm-${element.type}-${element.id}`,
        name: nameOf(element, category),
        category,
        coordinates,
        closed: first[0] === last[0] && first[1] === last[1],
        source: 'openstreetmap-pending',
        warningMeters: 150,
        criticalMeters: 60,
      };
    }).filter(Boolean);
    json(response, 200, { candidates, center: { latitude, longitude }, radius, loadedAt: new Date().toISOString(), attribution: 'OpenStreetMap contributors' });
  } catch (error) {
    json(response, 502, { error: error.name === 'TimeoutError' ? 'A busca no OpenStreetMap demorou demais. Tente novamente.' : error.message });
  }
};
