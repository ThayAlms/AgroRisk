const { json, method } = require('../lib/http');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

function categoryOf(tags = {}) {
  if (tags.landuse === 'quarry') return 'quarry';
  if (tags.natural === 'cliff') return 'cliff';
  if (tags.natural === 'wetland' || tags.hazard === 'flood' || tags.flood_prone === 'yes') return 'flood';
  if (tags.man_made === 'embankment') return 'steep_slope';
  return 'water';
}

function nameOf(element, category) {
  const given = String(element.tags?.name || '').replace(/[<>]/g, '').slice(0, 90);
  if (given) return given;
  if (category === 'quarry') return 'Pedreira mapeada';
  if (category === 'cliff') return 'Escarpa mapeada';
  if (category === 'flood') return 'Área alagável mapeada';
  if (category === 'steep_slope') return 'Talude ou aterro mapeado';
  return 'Curso ou área de água';
}

function simplifyGeometry(geometry = []) {
  if (geometry.length <= 250) return geometry;
  const stride = Math.ceil(geometry.length / 250);
  return geometry.filter((_, index) => index % stride === 0 || index === geometry.length - 1);
}

function geometryOf(element) {
  if (Array.isArray(element.geometry)) return element.geometry;
  const outerMembers = (element.members || []).filter((member) => member.role === 'outer' && Array.isArray(member.geometry));
  return outerMembers.sort((a, b) => b.geometry.length - a.geometry.length)[0]?.geometry || [];
}

function isAutomaticWaterDanger(tags = {}, closed) {
  const excludedTypes = ['fountain', 'reflecting_pool', 'swimming_pool', 'wastewater'];
  const excludedUse = tags.leisure === 'swimming_pool' || tags.amenity === 'fountain' || tags.man_made === 'wastewater_plant';
  return Boolean(closed && tags.natural === 'water' && !excludedUse && !excludedTypes.includes(tags.water));
}

function distanceToGeometry(latitude, longitude, coordinates) {
  const center = coordinates.reduce((sum, [lat, lon]) => ({ lat: sum.lat + lat, lon: sum.lon + lon }), { lat: 0, lon: 0 });
  center.lat /= coordinates.length; center.lon /= coordinates.length;
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(center.lat - latitude); const dLon = radians(center.lon - longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(latitude)) * Math.cos(radians(center.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = async (request, response) => {
  if (!method(request, response, ['GET'])) return;
  try {
    const latitude = Number(request.query?.latitude);
    const longitude = Number(request.query?.longitude);
    const radius = Math.min(Math.max(Number(request.query?.radius) || 25_000, 500), 25_000);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return json(response, 400, { error: 'Localização válida necessária para mapear riscos' });
    }
    const query = `[out:json][timeout:25];(way(around:${radius},${latitude},${longitude})["natural"="water"];relation(around:${radius},${latitude},${longitude})["natural"="water"];way(around:${radius},${latitude},${longitude})["waterway"~"^(river|stream|canal|drain)$"];way(around:${radius},${latitude},${longitude})["natural"="wetland"];way(around:${radius},${latitude},${longitude})["hazard"="flood"];way(around:${radius},${latitude},${longitude})["flood_prone"="yes"];way(around:${radius},${latitude},${longitude})["landuse"="quarry"];way(around:${radius},${latitude},${longitude})["natural"="cliff"];way(around:${radius},${latitude},${longitude})["man_made"="embankment"];);out tags geom;`;
    const overpass = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'AgroRisk/1.0 risk-mapping' },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(29_000),
    });
    if (!overpass.ok) throw new Error(`OpenStreetMap indisponível (${overpass.status})`);
    const data = await overpass.json();
    const mappedCandidates = (data.elements || []).map((element) => {
      const geometry = simplifyGeometry(geometryOf(element));
      const coordinates = geometry.map(({ lat, lon }) => [Number(lat), Number(lon)]).filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
      if (coordinates.length < 2) return null;
      const category = categoryOf(element.tags);
      const first = coordinates[0]; const last = coordinates.at(-1);
      const closed = first[0] === last[0] && first[1] === last[1];
      const automaticDanger = isAutomaticWaterDanger(element.tags, closed);
      return {
        id: `osm-${element.type}-${element.id}`,
        name: nameOf(element, category),
        category,
        coordinates,
        closed,
        source: 'openstreetmap-pending',
        warningMeters: category === 'water' || category === 'flood' ? 10 : 150,
        criticalMeters: category === 'water' || category === 'flood' ? 0 : 60,
        automaticDanger,
        waterType: element.tags?.water || null,
        distanceMeters: Math.round(distanceToGeometry(latitude, longitude, coordinates)),
      };
    }).filter(Boolean);
    const automaticWaterZones = mappedCandidates.filter((candidate) => candidate.automaticDanger);
    const reviewCandidates = mappedCandidates.filter((candidate) => !candidate.automaticDanger)
      .sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 120);
    const candidates = [...automaticWaterZones, ...reviewCandidates].sort((a, b) => a.distanceMeters - b.distanceMeters);
    json(response, 200, { candidates, center: { latitude, longitude }, radius, loadedAt: new Date().toISOString(), attribution: 'OpenStreetMap contributors' });
  } catch (error) {
    json(response, 502, { error: error.name === 'TimeoutError' ? 'A busca no OpenStreetMap demorou demais. Tente novamente.' : error.message });
  }
};
