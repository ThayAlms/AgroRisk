const { listTelemetry } = require('../lib/db');
const { deviceId } = require('../lib/http');

function cell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

module.exports = async (request, response) => {
  if (request.method !== 'GET') return response.status(405).end();
  try {
    const rows = await listTelemetry(deviceId(request), 500);
    const columns = [
      ['data_hora', (r) => r.timestamp], ['dispositivo', (r) => r.deviceId], ['distancia_cm', (r) => r.distanceCm],
      ['buzzer', (r) => r.buzzer], ['temperatura_c', (r) => r.environment?.temperatureC], ['umidade_pct', (r) => r.environment?.humidityPercent],
      ['inclinacao_lateral', (r) => r.tilt?.roll], ['inclinacao_frontal', (r) => r.tilt?.pitch],
      ['latitude', (r) => r.gps?.latitude], ['longitude', (r) => r.gps?.longitude], ['fonte_gps', (r) => r.gps?.source],
      ['dentro_geofence', (r) => r.geofence?.inside], ['nivel_perigo', (r) => r.danger?.level], ['zona_proxima', (r) => r.danger?.nearest?.name],
    ];
    const csv = [columns.map(([name]) => cell(name)).join(';'), ...rows.map((row) => columns.map(([, getter]) => cell(getter(row))).join(';'))].join('\r\n');
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="agrorisk-telemetria.csv"');
    response.status(200).send(`\uFEFF${csv}`);
  } catch (error) { response.status(500).json({ error: error.message }); }
};
