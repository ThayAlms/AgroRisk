const { listTelemetryDataset, saveWeatherContext } = require('../lib/db');

const PARAMETERS = ['T2M', 'RH2M', 'PRECTOTCORR', 'WS10M'];

function compactDate(date) { return date.replaceAll('-', ''); }
function valid(value) { return value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) > -900 ? Number(value) : null; }

async function fetchPower(latitude, longitude, start, end) {
  const params = new URLSearchParams({
    parameters: PARAMETERS.join(','), community: 'AG', longitude: String(longitude), latitude: String(latitude),
    start: compactDate(start), end: compactDate(end), format: 'JSON', timeStandard: 'UTC',
  });
  const response = await fetch(`https://power.larc.nasa.gov/api/temporal/daily/point?${params}`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`NASA POWER HTTP ${response.status}`);
  return response.json();
}

async function fetchOpenMeteo(latitude, longitude, start, end) {
  const params = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude), start_date: start, end_date: end,
    hourly: 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m',
    timezone: 'UTC', wind_speed_unit: 'ms',
  });
  const response = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`, { signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
  const result = await response.json(); const hourly = result.hourly || {}; const days = {};
  (hourly.time || []).forEach((timestamp, index) => {
    const date = timestamp.slice(0, 10); const day = days[date] || { temperature: [], humidity: [], precipitation: [], wind: [] };
    const append = (target, value) => { const number = valid(value); if (number !== null) target.push(number); };
    append(day.temperature, hourly.temperature_2m?.[index]); append(day.humidity, hourly.relative_humidity_2m?.[index]);
    append(day.precipitation, hourly.precipitation?.[index]); append(day.wind, hourly.wind_speed_10m?.[index]); days[date] = day;
  });
  const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return Object.fromEntries(Object.entries(days).map(([date, day]) => [date, {
    temperatureC: average(day.temperature), humidityPercent: average(day.humidity),
    precipitationMm: day.precipitation.length ? day.precipitation.reduce((sum, value) => sum + value, 0) : null,
    windSpeedMps: average(day.wind), source: 'Open-Meteo Historical API', apiVersion: 'v1',
  }]));
}

async function main() {
  const rows = (await listTelemetryDataset(Number(process.env.WEATHER_DATASET_LIMIT || 100000)))
    .filter((row) => row.payload?.demo !== true && row.payload?.gps?.valid && Number.isFinite(Number(row.payload.gps.latitude)) && Number.isFinite(Number(row.payload.gps.longitude)));
  const devices = new Map();
  for (const row of rows) {
    const date = String(row.recordedAt || row.payload.timestamp).slice(0, 10);
    const entry = devices.get(row.deviceId) || { dates: new Set(), latitude: Number(row.payload.gps.latitude), longitude: Number(row.payload.gps.longitude) };
    entry.dates.add(date); devices.set(row.deviceId, entry);
  }
  let saved = 0; const failures = [];
  for (const [deviceId, entry] of devices) {
    const dates = [...entry.dates].sort();
    try {
      let contexts; let source;
      try {
        const result = await fetchPower(entry.latitude, entry.longitude, dates[0], dates.at(-1));
        const data = result.properties?.parameter || {};
        contexts = Object.fromEntries(dates.map((date) => { const key = compactDate(date); return [date, { temperatureC: valid(data.T2M?.[key]), humidityPercent: valid(data.RH2M?.[key]), precipitationMm: valid(data.PRECTOTCORR?.[key]), windSpeedMps: valid(data.WS10M?.[key]), source: 'NASA POWER', apiVersion: result.header?.api?.version || null }]; }));
        source = 'NASA_POWER_DAILY';
      } catch (nasaError) {
        contexts = await fetchOpenMeteo(entry.latitude, entry.longitude, dates[0], dates.at(-1));
        source = 'OPEN_METEO_HISTORICAL';
        failures.push({ deviceId, source: 'NASA POWER', fallbackUsed: true, error: nasaError.message });
      }
      for (const date of dates) {
        if (!contexts[date]) continue;
        await saveWeatherContext({
          deviceId, observedDate: date, latitude: entry.latitude, longitude: entry.longitude, source, payload: contexts[date],
        });
        saved += 1;
      }
    } catch (error) { failures.push({ deviceId, source: 'all', error: error.message }); }
  }
  console.log(JSON.stringify({ ok: saved > 0, sources: ['NASA POWER Daily API', 'Open-Meteo Historical API fallback'], cost: 'free-no-key for this academic prototype', devices: devices.size, contextsSaved: saved, failures }, null, 2));
  if (failures.length && !saved) process.exitCode = 2;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
