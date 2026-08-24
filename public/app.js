const $ = (id) => document.getElementById(id);
let config = null;
let readings = [];
let map = null;
let machineMarker = null;
let fenceCircle = null;
let pendingFenceCenter = null;

function format(value, digits = 1) { return Number.isFinite(value) ? value.toFixed(digits) : '—'; }
function timeLabel(iso) { return new Intl.DateTimeFormat('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' }).format(new Date(iso)); }

function ensureMap(latitude, longitude) {
  if (!window.L || map) return;
  $('map').innerHTML = '';
  map = L.map('map').setView([latitude || -23.55, longitude || -46.63], latitude ? 16 : 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'&copy; OpenStreetMap' }).addTo(map);
  map.on('click', (event) => { pendingFenceCenter = event.latlng; drawFence(); });
  drawFence();
}

function drawFence() {
  if (!map || !config) return;
  const center = pendingFenceCenter || (Number.isFinite(config.geofence.latitude) ? { lat:config.geofence.latitude, lng:config.geofence.longitude } : null);
  if (fenceCircle) { map.removeLayer(fenceCircle); fenceCircle = null; }
  if (center) {
    fenceCircle = L.circle(center, { radius:Number($('radius').value), color:'#236b43', weight:2, fillColor:'#75a875', fillOpacity:.15 }).addTo(map);
    $('fenceCoords').textContent = `${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}`;
  } else $('fenceCoords').textContent = 'Clique no mapa';
}

function renderReading(reading) {
  $('distance').textContent = format(reading.distanceCm);
  $('temperature').textContent = format(reading.environment.temperatureC);
  $('humidity').textContent = format(reading.environment.humidityPercent, 0);
  $('roll').textContent = format(reading.tilt.roll);
  $('pitch').textContent = format(reading.tilt.pitch);
  $('latitude').textContent = format(reading.gps.latitude, 6);
  $('longitude').textContent = format(reading.gps.longitude, 6);
  $('lastUpdate').textContent = `Última leitura às ${timeLabel(reading.timestamp)}`;

  const obstacle = reading.alerts.obstacle;
  $('distanceCard').classList.toggle('alert', obstacle);
  $('distanceBar').style.width = `${Math.min(100, Math.max(0, reading.distanceCm || 0) / Math.max(config.distanceAlertCm * 3, 1) * 100)}%`;
  $('distanceBar').style.background = obstacle ? '#c94343' : '#236b43';
  $('buzzerBadge').textContent = reading.buzzer ? 'Buzzer ativo' : 'Buzzer off';
  $('buzzerBadge').className = `badge ${reading.buzzer ? 'danger' : 'neutral'}`;

  const hasTilt = Number.isFinite(reading.tilt.roll);
  $('tiltBadge').textContent = hasTilt ? (reading.alerts.tilt ? 'Risco' : 'Estável') : 'Sem leitura';
  $('tiltBadge').className = `badge ${reading.alerts.tilt ? 'danger' : hasTilt ? 'success' : 'neutral'}`;
  $('tiltCard').classList.toggle('alert', reading.alerts.tilt);
  $('gpsBadge').textContent = reading.gps.valid ? 'GPS fix' : 'Sem fix';
  $('gpsBadge').className = `badge ${reading.gps.valid ? 'success' : 'warning'}`;
  $('fenceBadge').textContent = !reading.geofence.configured ? 'Não configurada' : reading.geofence.inside === null ? 'Aguardando GPS' : reading.geofence.inside ? 'Dentro da área' : 'Fora da área';
  $('fenceBadge').className = `badge ${reading.geofence.inside === false ? 'danger' : reading.geofence.inside ? 'success' : 'neutral'}`;

  const danger = Object.values(reading.alerts).some(Boolean);
  $('overallState').className = `overall ${danger ? 'danger' : 'safe'}`;
  $('overallState').querySelector('strong').textContent = danger ? 'Atenção necessária' : 'Operação normal';

  if (reading.gps.valid) {
    ensureMap(reading.gps.latitude, reading.gps.longitude);
    if (!machineMarker) machineMarker = L.circleMarker([reading.gps.latitude, reading.gps.longitude], { radius:9, color:'#fff', weight:3, fillColor:'#236b43', fillOpacity:1 }).addTo(map);
    else machineMarker.setLatLng([reading.gps.latitude, reading.gps.longitude]);
    map.panTo([reading.gps.latitude, reading.gps.longitude]);
  }
}

function stateText(reading) {
  if (reading.alerts.obstacle) return ['Obstáculo', true];
  if (reading.alerts.outsideGeofence) return ['Fora da área', true];
  if (reading.alerts.tilt) return ['Inclinação', true];
  return ['Normal', false];
}

function renderHistory() {
  const body = $('historyBody');
  if (!readings.length) return;
  body.innerHTML = readings.slice(-12).reverse().map((r) => {
    const [state, danger] = stateText(r);
    const tilt = Number.isFinite(r.tilt.roll) ? `${format(r.tilt.roll)}° / ${format(r.tilt.pitch)}°` : '—';
    const gps = r.gps.valid ? `${format(r.gps.latitude,4)}, ${format(r.gps.longitude,4)}` : 'Sem fix';
    return `<tr><td>${timeLabel(r.timestamp)}</td><td>${format(r.distanceCm)} cm</td><td>${format(r.environment.temperatureC)} °C</td><td>${format(r.environment.humidityPercent,0)}%</td><td>${tilt}</td><td>${gps}</td><td><span class="status-dot ${danger?'danger':''}"></span>${state}</td></tr>`;
  }).join('');
}

function applyConfig(value) {
  config = value;
  $('radius').value = config.geofence.radiusMeters;
  $('radiusOutput').textContent = `${config.geofence.radiusMeters} m`;
  $('distanceLimit').value = config.distanceAlertCm;
  $('tiltLimit').value = config.tiltAlertDegrees;
  $('distanceHint').textContent = `Limite configurado: ${config.distanceAlertCm} cm`;
  ensureMap(config.geofence.latitude, config.geofence.longitude);
  drawFence();
}

function setSerial(status) {
  $('serialStatus').className = `connection ${status.connected ? 'online' : 'offline'}`;
  $('serialStatus').innerHTML = `<i></i>${status.connected ? `${status.port} conectada` : 'ESP32 desconectado'}`;
  $('serialStatus').title = status.error || '';
}

async function init() {
  const [statusResponse, historyResponse] = await Promise.all([fetch('/api/status'), fetch('/api/measurements?limit=50')]);
  const status = await statusResponse.json();
  readings = await historyResponse.json();
  applyConfig(status.config);
  setSerial(status.serial);
  if (status.latest) renderReading(status.latest);
  renderHistory();

  const events = new EventSource('/events');
  events.addEventListener('measurement', (event) => {
    const reading = JSON.parse(event.data); readings.push(reading); if (readings.length > 50) readings.shift(); renderReading(reading); renderHistory();
  });
  events.addEventListener('serial', (event) => setSerial(JSON.parse(event.data)));
  events.addEventListener('config', (event) => applyConfig(JSON.parse(event.data)));
}

$('radius').addEventListener('input', () => { $('radiusOutput').textContent = `${$('radius').value} m`; drawFence(); });
$('settingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const center = pendingFenceCenter || { lat:config.geofence.latitude, lng:config.geofence.longitude };
  const response = await fetch('/api/config', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
    geofence:{ latitude:center.lat ?? null, longitude:center.lng ?? null, radiusMeters:Number($('radius').value) },
    distanceAlertCm:Number($('distanceLimit').value), tiltAlertDegrees:Number($('tiltLimit').value),
  }) });
  const result = await response.json();
  if (!response.ok) { $('saveMessage').textContent = result.error; return; }
  pendingFenceCenter = null; applyConfig(result); $('saveMessage').textContent = 'Configurações salvas'; setTimeout(() => $('saveMessage').textContent='', 2500);
});

init().catch((error) => { $('lastUpdate').textContent = `Erro ao carregar: ${error.message}`; });
