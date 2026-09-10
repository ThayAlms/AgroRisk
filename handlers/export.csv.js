const { listTelemetry, getConfig } = require('../lib/db');
const { deviceId } = require('../lib/http');
const { calculateStability } = require('../lib/risk');

function cell(value) {
  const normalized = typeof value === 'number' && Number.isFinite(value) ? String(value).replace('.', ',')
    : typeof value === 'boolean' ? (value ? 'SIM' : 'NAO') : value;
  const text = normalized == null ? '' : String(normalized);
  return `"${text.replaceAll('"', '""')}"`;
}

function datePart(timestamp) { return timestamp ? new Date(timestamp).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : ''; }
function timePart(timestamp) { return timestamp ? new Date(timestamp).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false }) : ''; }
const stabilityCache = new WeakMap();
function stability(row, limit) {
  if (!stabilityCache.has(row)) stabilityCache.set(row, row.stability || calculateStability(row.tilt, row.acceleration, row.gyroscope, limit));
  return stabilityCache.get(row);
}

module.exports = async (request, response) => {
  if (request.method !== 'GET') return response.status(405).end();
  try {
    const id = deviceId(request);
    const [rows, config] = await Promise.all([listTelemetry(id, 500), getConfig(id)]);
    const columns = [
      ['data', (r) => datePart(r.timestamp)], ['hora', (r) => timePart(r.timestamp)], ['timestamp_iso', (r) => r.timestamp],
      ['dispositivo', (r) => r.deviceId || id], ['transporte', (r) => r.gateway?.transport],
      ['distancia_frontal_cm', (r) => r.distanceCm], ['alerta_obstaculo', (r) => r.alerts?.obstacle], ['buzzer_ativo', (r) => r.buzzer],
      ['temperatura_c', (r) => r.environment?.temperatureC], ['umidade_percentual', (r) => r.environment?.humidityPercent],
      ['estabilidade_nivel', (r) => stability(r, config.tiltAlertDegrees).level],
      ['estabilidade_uso_limite_percentual', (r) => stability(r, config.tiltAlertDegrees).utilizationPercent],
      ['angulo_maximo_graus', (r) => stability(r, config.tiltAlertDegrees).maximumAngle],
      ['margem_ate_limite_graus', (r) => stability(r, config.tiltAlertDegrees).marginDegrees],
      ['limite_inclinacao_graus', (r) => stability(r, config.tiltAlertDegrees).limitDegrees],
      ['eixo_predominante', (r) => stability(r, config.tiltAlertDegrees).dominantAxis],
      ['direcao_inclinacao', (r) => stability(r, config.tiltAlertDegrees).direction],
      ['inclinacao_lateral_roll_graus', (r) => r.tilt?.roll], ['inclinacao_frontal_pitch_graus', (r) => r.tilt?.pitch],
      ['velocidade_angular_graus_s', (r) => stability(r, config.tiltAlertDegrees).angularSpeedDegS],
      ['estado_movimento', (r) => stability(r, config.tiltAlertDegrees).motion], ['qualidade_imu', (r) => stability(r, config.tiltAlertDegrees).sensorQuality],
      ['aceleracao_x_m_s2', (r) => r.acceleration?.x], ['aceleracao_y_m_s2', (r) => r.acceleration?.y], ['aceleracao_z_m_s2', (r) => r.acceleration?.z],
      ['giroscopio_x_rad_s', (r) => r.gyroscope?.x], ['giroscopio_y_rad_s', (r) => r.gyroscope?.y], ['giroscopio_z_rad_s', (r) => r.gyroscope?.z],
      ['gps_valido', (r) => r.gps?.valid], ['latitude', (r) => r.gps?.latitude], ['longitude', (r) => r.gps?.longitude],
      ['fonte_gps', (r) => r.gps?.source], ['precisao_gps_m', (r) => r.gps?.accuracyMeters],
      ['geofence_configurada', (r) => r.geofence?.configured], ['dentro_geofence', (r) => r.geofence?.inside],
      ['distancia_centro_geofence_m', (r) => r.geofence?.distanceFromCenter],
      ['nivel_perigo_geografico', (r) => r.danger?.level], ['zona_risco_proxima', (r) => r.danger?.nearest?.name],
      ['categoria_zona_risco', (r) => r.danger?.nearest?.category], ['distancia_zona_risco_m', (r) => r.danger?.nearest?.distanceMeters],
    ];
    const csv = [columns.map(([name]) => cell(name)).join(';'), ...rows.map((row) => columns.map(([, getter]) => cell(getter(row))).join(';'))].join('\r\n');
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="agrorisk-relatorio-operacional.csv"');
    response.status(200).send(`\uFEFF${csv}`);
  } catch (error) { response.status(500).json({ error: error.message }); }
};
