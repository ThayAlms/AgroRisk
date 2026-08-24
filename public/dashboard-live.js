(() => {
  const el = (id) => document.getElementById(id);
  const set = (id, value) => { if (el(id)) el(id).textContent = value; };
  const finite = Number.isFinite;
  const fmt = (value, digits = 1) => finite(value) ? Number(value).toFixed(digits) : '—';
  let config;
  let map;
  let marker;
  let fence;
  let dangerLayerGroup;
  let latestDangerState;
  let pendingCenter;
  let lastReceivedAt;
  let recent = [];
  let lastReading;
  const demoTilt = new URLSearchParams(location.search).get('demo') === '1';
  let locationWatchId;

  function setConnection(status) {
    const node = el('connection');
    if (!node) return;
    node.classList.toggle('online', status.connected);
    node.classList.toggle('offline', !status.connected);
    node.innerHTML = `<i></i>${status.connected ? `${status.port} • ${status.baudRate} baud` : 'ESP32 desconectado'}`;
  }

  function initializeMap(lat, lon) {
    if (map || !window.L || !el('map')) return;
    map = L.map('map', { zoomControl: true }).setView([finite(lat) ? lat : -14.2, finite(lon) ? lon : -51.9], finite(lat) ? 17 : 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, attribution: '&copy; OpenStreetMap' }).addTo(map);
    dangerLayerGroup = L.layerGroup().addTo(map);
    map.on('click', ({ latlng }) => { pendingCenter = latlng; renderFence(); });
    renderFence();
    if (latestDangerState) renderDangerZones(latestDangerState);
  }

  function renderDangerZones(state) {
    latestDangerState = state;
    set('danger-count', `${state.zones?.length || 0} zonas mapeadas`);
    if (state.error) set('danger-source', `Falha no mapa de riscos: ${state.error}`);
    else set('danger-source', state.loadedAt ? 'OpenStreetMap • atualizado' : 'Aguardando localização');
    if (!map || !dangerLayerGroup) return;
    dangerLayerGroup.clearLayers();
    for (const zone of state.zones || []) {
      const color = zone.category === 'quarry' ? '#df082a' : '#0b5fff';
      const options = { color, weight: zone.category === 'quarry' ? 3 : 4, opacity: .85, fillColor: color, fillOpacity: .18, dashArray: zone.category === 'quarry' ? '7 5' : null };
      const layer = zone.closed ? L.polygon(zone.coordinates, options) : L.polyline(zone.coordinates, options);
      layer.bindTooltip(`<strong>${zone.name}</strong><br>${zone.category === 'quarry' ? 'Pedreira' : 'Área com água'}`);
      layer.addTo(dangerLayerGroup);
    }
  }

  function renderSafetyLogs(logs) {
    const container = el('safety-log');
    if (!container) return;
    if (!logs.length) { container.innerHTML = '<div class="log-empty">Nenhum evento perigoso registrado.</div>'; return; }
    container.innerHTML = logs.slice(-12).reverse().map((entry) => `<div class="log-entry ${entry.severity}"><time>${new Date(entry.timestamp).toLocaleString('pt-BR')}</time><div><strong>${entry.message}</strong><small>${finite(entry.details?.distanceMeters) ? `Distância: ${Math.round(entry.details.distanceMeters)} m` : entry.type}</small></div><span>${entry.severity === 'critical' ? 'CRÍTICO' : entry.severity === 'warning' ? 'ATENÇÃO' : 'SEGURO'}</span></div>`).join('');
  }

  function renderFence() {
    if (!map || !config) return;
    if (fence) map.removeLayer(fence);
    const center = pendingCenter || (finite(config.geofence.latitude) ? { lat: config.geofence.latitude, lng: config.geofence.longitude } : null);
    if (!center) { set('fence-center', 'Clique no mapa para definir'); return; }
    const radius = Number(el('radius')?.value || config.geofence.radiusMeters);
    fence = L.circle(center, { radius, color: '#ed1b2f', weight: 2, fillColor: '#0057b8', fillOpacity: .12 }).addTo(map);
    set('fence-center', `${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}`);
  }

  function updateMap(reading) {
    if (!reading.gps.valid) return;
    initializeMap(reading.gps.latitude, reading.gps.longitude);
    const position = [reading.gps.latitude, reading.gps.longitude];
    if (!marker) marker = L.circleMarker(position, { radius: 9, color: '#fff', weight: 3, fillColor: '#ed1b2f', fillOpacity: 1 }).addTo(map);
    else marker.setLatLng(position);
    map.panTo(position, { animate: true, duration: .5 });
  }

  function updateTilt(reading) {
    const demoSeconds = performance.now() / 1000;
    const roll = demoTilt ? Math.sin(demoSeconds * .72) * 17 : reading.tilt?.roll;
    const pitch = demoTilt ? Math.sin(demoSeconds * .51 + 1.2) * 10 : reading.tilt?.pitch;
    const hasTilt = finite(roll) && finite(pitch);
    document.documentElement.style.setProperty('--live-roll', `${hasTilt ? Math.max(-30, Math.min(30, roll)) : 0}deg`);
    document.documentElement.style.setProperty('--live-pitch', `${hasTilt ? Math.max(-30, Math.min(30, pitch)) : 0}deg`);
    set('roll', fmt(roll)); set('pitch', fmt(pitch));
    set('gyro-x', fmt(reading.gyroscope?.x, 2)); set('gyro-y', fmt(reading.gyroscope?.y, 2)); set('gyro-z', fmt(reading.gyroscope?.z, 2));
    const status = el('tilt-status');
    if (status) {
      status.textContent = demoTilt ? 'Demonstração visual' : !hasTilt ? 'IMU sem leitura' : reading.alerts.tilt ? 'Inclinação crítica' : 'Máquina estável';
      status.className = `pill ${!demoTilt && reading.alerts.tilt ? 'danger' : hasTilt ? 'safe' : 'waiting'}`;
    }
    document.querySelectorAll('.tilt-machine').forEach((node) => node.classList.toggle('unavailable', !hasTilt));
  }

  function updateReading(reading, completed = false) {
    lastReading = reading;
    lastReceivedAt = Date.now();
    set('distance', fmt(reading.distanceCm)); set('temperature', fmt(reading.environment?.temperatureC));
    set('humidity', fmt(reading.environment?.humidityPercent, 0));
    set('latitude', fmt(reading.gps?.latitude, 6)); set('longitude', fmt(reading.gps?.longitude, 6));
    set('gps-state', reading.gps?.valid ? (reading.gps.source === 'notebook' ? 'Localização do notebook' : 'GPS do ESP32 fixado') : 'Buscando localização');
    const buzzer = el('buzzer-state');
    if (buzzer) { buzzer.textContent = reading.buzzer ? 'BUZZER ATIVO' : 'Área livre'; buzzer.className = `pill ${reading.buzzer ? 'danger' : 'safe'}`; }
    const pct = Math.min(100, Math.max(2, (reading.distanceCm || 0) / Math.max((config?.distanceAlertCm || 30) * 4, 1) * 100));
    if (el('distance-bar')) el('distance-bar').style.width = `${pct}%`;
    document.body.classList.toggle('obstacle-alert', reading.alerts?.obstacle);
    document.body.classList.toggle('tilt-alert', reading.alerts?.tilt);
    document.body.classList.toggle('fence-alert', reading.alerts?.outsideGeofence);
    const alerts = Object.values(reading.alerts || {}).filter(Boolean).length;
    const safety = el('safety-status');
    if (safety) { safety.textContent = alerts ? `${alerts} ALERTA${alerts > 1 ? 'S' : ''}` : 'OPERAÇÃO NORMAL'; safety.className = `safety ${alerts ? 'danger' : 'safe'}`; }
    const fenceState = el('fence-state');
    if (fenceState) {
      fenceState.textContent = !reading.geofence?.configured ? 'Não configurada' : reading.geofence.inside === null ? 'Aguardando GPS' : reading.geofence.inside ? 'Dentro da zona' : 'Fora da zona';
      fenceState.className = `pill ${reading.geofence?.inside === false ? 'danger' : reading.geofence?.inside ? 'safe' : 'waiting'}`;
    }
    const danger = reading.danger;
    const dangerNode = el('danger-state');
    if (dangerNode) {
      dangerNode.textContent = danger?.level === 'critical' ? 'Faixa crítica' : danger?.level === 'warning' ? 'Aproximação perigosa' : danger?.level === 'safe' ? 'Distância segura' : 'Mapeando riscos';
      dangerNode.className = `pill ${danger?.level === 'critical' ? 'danger' : danger?.level === 'warning' ? 'waiting' : danger?.level === 'safe' ? 'safe' : 'waiting'}`;
    }
    set('nearest-danger', danger?.nearest?.name || 'Nenhuma zona próxima');
    set('danger-distance', finite(danger?.nearest?.distanceMeters) ? `${Math.round(danger.nearest.distanceMeters)} m` : '—');
    document.body.classList.toggle('danger-zone-critical', danger?.level === 'critical');
    updateTilt(reading); updateMap(reading);
    if (completed) { recent.push(reading); if (recent.length > 20) recent.shift(); renderHistory(); renderTrend(); }
  }

  function renderHistory() {
    const body = el('history-body');
    if (!body || !recent.length) return;
    body.innerHTML = recent.slice(-6).reverse().map((r) => `<tr><td>${new Date(r.timestamp).toLocaleTimeString('pt-BR')}</td><td>${fmt(r.distanceCm)} cm</td><td>${fmt(r.environment.temperatureC)} °C</td><td>${fmt(r.tilt.roll)}° / ${fmt(r.tilt.pitch)}°</td><td>${r.gps.valid ? 'GPS fix' : 'Sem fix'}</td></tr>`).join('');
  }

  function renderTrend() {
    const svg = el('distance-trend');
    if (!svg || recent.length < 2) return;
    const values = recent.slice(-16).map((r) => r.distanceCm).filter(finite);
    if (values.length < 2) return;
    const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
    const points = values.map((v, i) => `${i / (values.length - 1) * 100},${36 - (v - min) / range * 30}`).join(' ');
    svg.innerHTML = `<polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/><circle cx="100" cy="${points.split(' ').at(-1).split(',')[1]}" r="2.8" fill="currentColor"/>`;
  }

  function applyConfig(next) {
    config = next;
    if (el('radius')) el('radius').value = config.geofence.radiusMeters;
    set('radius-value', `${config.geofence.radiusMeters} m`);
    set('distance-limit', `${config.distanceAlertCm} cm`);
    initializeMap(config.geofence.latitude, config.geofence.longitude);
    renderFence();
  }

  async function saveFence() {
    const center = pendingCenter || { lat: config.geofence.latitude, lng: config.geofence.longitude };
    const response = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      ...config, geofence: { latitude: center.lat ?? null, longitude: center.lng ?? null, radiusMeters: Number(el('radius').value) },
    }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    pendingCenter = null; applyConfig(result); set('save-result', 'Configuração salva');
    setTimeout(() => set('save-result', ''), 2500);
  }

  async function start() {
    const [status, history, dangerZones, logs] = await Promise.all([
      fetch('/api/status', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/measurements?limit=20', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/danger-zones', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/safety-logs?limit=30', { cache: 'no-store' }).then((r) => r.json()),
    ]);
    recent = history; applyConfig(status.config); setConnection(status.serial); renderHistory(); renderTrend();
    renderDangerZones(dangerZones); renderSafetyLogs(logs);
    if (status.latest) updateReading(status.latest);
    const events = new EventSource(`/events?t=${Date.now()}`);
    events.addEventListener('telemetry', ({ data }) => updateReading(JSON.parse(data), false));
    events.addEventListener('measurement', ({ data }) => updateReading(JSON.parse(data), true));
    events.addEventListener('serial', ({ data }) => setConnection(JSON.parse(data)));
    events.addEventListener('config', ({ data }) => applyConfig(JSON.parse(data)));
    events.addEventListener('danger-zones', ({ data }) => renderDangerZones(JSON.parse(data)));
    events.addEventListener('safety-log', ({ data }) => { logs.push(JSON.parse(data)); renderSafetyLogs(logs); });
    events.onerror = () => { const node = el('connection'); if (node) node.innerHTML = '<i></i>Reconectando…'; };
    startNotebookLocation();
  }

  function startNotebookLocation() {
    if (!navigator.geolocation || locationWatchId !== undefined) {
      if (!navigator.geolocation) set('gps-state', 'Localização indisponível');
      return;
    }
    set('gps-state', 'Autorize a localização');
    locationWatchId = navigator.geolocation.watchPosition(async (position) => {
      const payload = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
        timestamp: new Date(position.timestamp).toISOString(),
      };
      try {
        await fetch('/api/location', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        set('gps-state', `Notebook • precisão ${Math.round(position.coords.accuracy)} m`);
      } catch {
        set('gps-state', 'Falha ao enviar localização');
      }
    }, (error) => {
      const messages = { 1: 'Permissão de localização negada', 2: 'Localização indisponível', 3: 'Tempo de localização esgotado' };
      set('gps-state', messages[error.code] || 'Erro de localização');
    }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
  }

  el('radius')?.addEventListener('input', () => { set('radius-value', `${el('radius').value} m`); renderFence(); });
  el('save-fence')?.addEventListener('click', () => saveFence().catch((error) => set('save-result', error.message)));
  el('refresh-danger')?.addEventListener('click', async () => {
    set('danger-source', 'Atualizando mapa de riscos...');
    const response = await fetch('/api/danger-zones/refresh', { method: 'POST' });
    renderDangerZones(await response.json());
  });
  setInterval(() => {
    if (!lastReceivedAt) return;
    const seconds = Math.floor((Date.now() - lastReceivedAt) / 1000);
    set('last-update', seconds < 2 ? 'Atualizado agora' : `Atualizado há ${seconds}s`);
  }, 500);
  if (demoTilt) setInterval(() => { if (lastReading) updateTilt(lastReading); }, 80);
  start().catch((error) => set('last-update', `Falha: ${error.message}`));
})();
