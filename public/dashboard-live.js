(() => {
  const el = (id) => document.getElementById(id);
  const set = (id, value) => { if (el(id)) el(id).textContent = value; };
  const finite = Number.isFinite;
  const fmt = (value, digits = 1) => finite(value) ? Number(value).toFixed(digits) : '—';
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  let config;
  let map;
  let marker;
  let fence;
  let dangerLayerGroup;
  let candidateLayerGroup;
  let operatorMarker;
  let latestDangerState;
  let pendingCenter;
  let lastReceivedAt;
  let recent = [];
  let lastReading;
  const demoTilt = new URLSearchParams(location.search).get('demo') === '1';
  const cloudMode = location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
  let lastCloudTimestamp;
  let locationWatchId;
  let browserLocation;
  let discoveryCandidates = [];
  let drawingActive = false;
  let locationDiscoveryStarted = false;

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
    candidateLayerGroup = L.layerGroup().addTo(map);
    map.on('click', ({ latlng }) => { if (!drawingActive) { pendingCenter = latlng; renderFence(); } });
    if (window.L.Draw) {
      map.on(L.Draw.Event.DRAWSTART, () => { drawingActive = true; });
      map.on(L.Draw.Event.DRAWSTOP, () => { drawingActive = false; });
      map.on(L.Draw.Event.CREATED, ({ layer }) => addManualCandidate(layer));
    }
    renderFence();
    if (latestDangerState) renderDangerZones(latestDangerState);
  }

  function renderDangerZones(state) {
    latestDangerState = state;
    set('danger-count', `${state.zones?.length || 0} áreas confirmadas`);
    if (state.error) set('danger-source', `Falha no mapa de riscos: ${state.error}`);
    else set('danger-source', state.zones?.length ? 'Áreas validadas pelo operador' : 'Nenhuma área confirmada');
    if (!map || !dangerLayerGroup) return;
    dangerLayerGroup.clearLayers();
    for (const zone of state.zones || []) {
      const color = zone.category === 'quarry' || zone.category === 'cliff' ? '#df082a' : zone.category === 'water' ? '#0b5fff' : '#df8c00';
      const options = { color, weight: zone.category === 'quarry' ? 3 : 4, opacity: .85, fillColor: color, fillOpacity: .18, dashArray: zone.category === 'quarry' ? '7 5' : null };
      const layer = zone.closed ? L.polygon(zone.coordinates, options) : L.polyline(zone.coordinates, options);
      layer.bindTooltip(`<strong>${escapeHtml(zone.name)}</strong><br>Confirmada • alerta ${zone.warningMeters} m • crítico ${zone.criticalMeters} m`);
      layer.addTo(dangerLayerGroup);
    }
    renderZoneReview();
  }

  function zoneCategory(category) {
    return { water: 'Água', quarry: 'Pedreira', cliff: 'Barranco/escarpa', restricted: 'Área restrita', other: 'Outro risco' }[category] || 'Risco';
  }

  function parseRiskDistances() {
    const values = String(el('risk-distances')?.value || '').split(/[/,;|]/).map((value) => Number(value.trim()));
    const warningMeters = values[0]; const criticalMeters = values[1];
    if (!finite(warningMeters) || !finite(criticalMeters) || warningMeters <= criticalMeters || criticalMeters < 5) throw new Error('Use distâncias no formato 150 / 60');
    return { warningMeters, criticalMeters };
  }

  function renderCandidateLayers() {
    if (!candidateLayerGroup) return;
    candidateLayerGroup.clearLayers();
    for (const zone of discoveryCandidates) {
      const layer = zone.closed ? L.polygon(zone.coordinates, { color: '#df8c00', weight: 3, dashArray: '6 5', fillOpacity: .08 }) : L.polyline(zone.coordinates, { color: '#df8c00', weight: 4, dashArray: '6 5' });
      layer.bindTooltip(`<strong>${escapeHtml(zone.name)}</strong><br>Sugestão pendente de confirmação`);
      layer.addTo(candidateLayerGroup);
    }
  }

  function renderZoneReview() {
    const container = el('zone-review');
    if (!container) return;
    const confirmed = latestDangerState?.zones || [];
    const cards = [
      ...discoveryCandidates.map((zone) => `<article class="zone-candidate ${zone.source === 'manual' ? 'manual' : ''}" data-candidate="${escapeHtml(zone.id)}"><strong>${escapeHtml(zone.name)}</strong><small>${zoneCategory(zone.category)} • ${zone.source === 'manual' ? 'desenhada pelo operador' : 'sugestão do OpenStreetMap'} • ${zone.warningMeters}/${zone.criticalMeters} m</small><div class="zone-actions"><button class="primary" data-confirm-zone="${escapeHtml(zone.id)}">CONFIRMAR</button><button class="outline red" data-reject-zone="${escapeHtml(zone.id)}">REJEITAR</button></div></article>`),
      ...confirmed.slice(0, 12).map((zone) => `<article class="zone-candidate confirmed"><strong>${escapeHtml(zone.name)}</strong><small>${zoneCategory(zone.category)} • confirmada • ${zone.warningMeters}/${zone.criticalMeters} m</small><div class="zone-actions"><span class="pill safe">ATIVA</span><button class="outline red" data-remove-zone="${escapeHtml(zone.id)}">REMOVER</button></div></article>`),
    ];
    container.innerHTML = cards.length ? cards.join('') : '<div class="zone-review-empty">Nenhuma sugestão pendente. Mapeie riscos próximos ou desenhe uma área conhecida.</div>';
    renderCandidateLayers();
  }

  async function reloadDangerZones() {
    const state = await fetch('/api/danger-zones', { cache: 'no-store' }).then((response) => response.json());
    renderDangerZones(state);
  }

  async function confirmZone(zoneId) {
    const zone = discoveryCandidates.find((item) => item.id === zoneId);
    if (!zone) return;
    set('risk-feedback', `Confirmando ${zone.name}...`);
    const payload = { ...zone, source: zone.source === 'manual' ? 'manual' : 'openstreetmap-confirmed' };
    const response = await fetch('/api/danger-zones', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ zone: payload }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Falha ao confirmar área');
    discoveryCandidates = discoveryCandidates.filter((item) => item.id !== zoneId);
    await reloadDangerZones();
    set('risk-feedback', `${zone.name} confirmada e incluída nas regras de alerta.`);
  }

  async function removeZone(zoneId) {
    const response = await fetch(`/api/danger-zones?id=${encodeURIComponent(zoneId)}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Falha ao remover área');
    await reloadDangerZones();
    set('risk-feedback', 'Área removida das regras de alerta.');
  }

  function rejectZone(zoneId) {
    discoveryCandidates = discoveryCandidates.filter((item) => item.id !== zoneId);
    renderZoneReview();
    set('risk-feedback', 'Sugestão rejeitada; nenhuma informação foi gravada.');
  }

  function addManualCandidate(layer) {
    const coordinates = layer.getLatLngs()?.[0]?.map(({ lat, lng }) => [lat, lng]) || [];
    if (coordinates.length < 3) return;
    coordinates.push([...coordinates[0]]);
    try {
      const distances = parseRiskDistances();
      discoveryCandidates.unshift({
        id: `manual-${Date.now()}`,
        name: el('manual-zone-name')?.value.trim() || 'Área de risco manual',
        category: el('manual-zone-category')?.value || 'other',
        coordinates, closed: true, source: 'manual', ...distances,
      });
      renderZoneReview();
      set('risk-feedback', 'Área desenhada. Revise e clique em confirmar para ativá-la.');
    } catch (error) { set('risk-feedback', error.message); }
  }

  function startDrawing() {
    if (!map || !window.L?.Draw) return set('risk-feedback', 'O mapa ainda está carregando.');
    try { parseRiskDistances(); } catch (error) { return set('risk-feedback', error.message); }
    set('risk-feedback', 'Clique nos limites da área de risco e depois clique no primeiro ponto para concluir.');
    new L.Draw.Polygon(map, { shapeOptions: { color: '#df8c00', weight: 3, fillOpacity: .12 }, allowIntersection: false, showArea: true }).enable();
  }

  async function discoverRisks() {
    if (!browserLocation) {
      startNotebookLocation();
      set('risk-feedback', 'Aguardando autorização e localização do navegador...');
      return;
    }
    set('mapping-state', 'BUSCANDO RISCOS');
    set('risk-feedback', 'Consultando rios, áreas de água, pedreiras e escarpas próximas...');
    const radius = Number(el('search-radius')?.value || 5000);
    const params = new URLSearchParams({ latitude: browserLocation.latitude, longitude: browserLocation.longitude, radius });
    const response = await fetch(`/api/risk-discovery?${params}`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível mapear os riscos');
    const confirmedIds = (latestDangerState?.zones || []).map((zone) => zone.id);
    discoveryCandidates = result.candidates.filter((zone) => !confirmedIds.some((id) => id.endsWith(zone.id)));
    renderZoneReview();
    set('mapping-state', discoveryCandidates.length ? `${discoveryCandidates.length} PARA REVISAR` : 'NENHUMA SUGESTÃO');
    set('risk-feedback', discoveryCandidates.length ? `${discoveryCandidates.length} sugestões encontradas. Confirme somente as áreas verificadas.` : 'Nenhum risco público foi encontrado nesse raio; você ainda pode desenhar áreas manuais.');
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
    if (cloudMode) {
      lastCloudTimestamp = status.latest?.timestamp;
      setInterval(async () => {
        try {
          const current = await fetch('/api/status', { cache: 'no-store' }).then((response) => response.json());
          setConnection(current.serial);
          if (current.latest && current.latest.timestamp !== lastCloudTimestamp) {
            lastCloudTimestamp = current.latest.timestamp; updateReading(current.latest, true);
          }
        } catch { setConnection({ connected: false }); }
      }, 1500);
      setInterval(async () => {
        const [zones, freshLogs] = await Promise.all([
          fetch('/api/danger-zones', { cache: 'no-store' }).then((response) => response.json()),
          fetch('/api/safety-logs?limit=30', { cache: 'no-store' }).then((response) => response.json()),
        ]);
        renderDangerZones(zones); logs.splice(0, logs.length, ...freshLogs); renderSafetyLogs(logs);
      }, 10000);
    } else {
      const events = new EventSource(`/events?t=${Date.now()}`);
      events.addEventListener('telemetry', ({ data }) => updateReading(JSON.parse(data), false));
      events.addEventListener('measurement', ({ data }) => updateReading(JSON.parse(data), true));
      events.addEventListener('serial', ({ data }) => setConnection(JSON.parse(data)));
      events.addEventListener('config', ({ data }) => applyConfig(JSON.parse(data)));
      events.addEventListener('danger-zones', ({ data }) => renderDangerZones(JSON.parse(data)));
      events.addEventListener('safety-log', ({ data }) => { logs.push(JSON.parse(data)); renderSafetyLogs(logs); });
      events.onerror = () => { const node = el('connection'); if (node) node.innerHTML = '<i></i>Reconectando…'; };
    }
    prepareLocationPermission();
  }

  function startNotebookLocation() {
    if (!navigator.geolocation || locationWatchId !== undefined) {
      if (!navigator.geolocation) set('gps-state', 'Localização indisponível');
      return;
    }
    set('gps-state', 'Autorize a localização');
    set('location-help', 'O navegador solicitará permissão para acompanhar sua posição.');
    locationWatchId = navigator.geolocation.watchPosition(async (position) => {
      const payload = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
        timestamp: new Date(position.timestamp).toISOString(),
      };
      browserLocation = payload;
      initializeMap(payload.latitude, payload.longitude);
      if (map) {
        const point = [payload.latitude, payload.longitude];
        if (!operatorMarker) operatorMarker = L.circleMarker(point, { radius: 7, color: '#fff', weight: 3, fillColor: '#0b5fff', fillOpacity: 1 }).bindTooltip('Sua localização').addTo(map);
        else operatorMarker.setLatLng(point);
        map.setView(point, Math.max(map.getZoom(), 15));
      }
      try {
        await fetch('/api/location', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        set('gps-state', `Notebook • precisão ${Math.round(position.coords.accuracy)} m`);
        set('location-help', `Localização ativa • precisão aproximada de ${Math.round(position.coords.accuracy)} m.`);
        set('mapping-state', 'LOCALIZAÇÃO ATIVA');
        const button = el('locate-me'); if (button) { button.textContent = 'LOCALIZAÇÃO ATIVA'; button.disabled = true; }
        if (!locationDiscoveryStarted) {
          locationDiscoveryStarted = true;
          discoverRisks().catch((error) => { set('mapping-state', 'BUSCA INDISPONÍVEL'); set('risk-feedback', error.message); });
        }
      } catch {
        set('gps-state', 'Falha ao enviar localização');
      }
    }, (error) => {
      const messages = { 1: 'Permissão de localização negada', 2: 'Localização indisponível', 3: 'Tempo de localização esgotado' };
      set('gps-state', messages[error.code] || 'Erro de localização');
      set('location-help', messages[error.code] || 'Não foi possível obter sua localização.');
      set('mapping-state', 'LOCALIZAÇÃO INDISPONÍVEL');
      locationWatchId = undefined;
    }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
  }

  async function prepareLocationPermission() {
    if (!navigator.geolocation) {
      set('location-help', 'Este navegador não disponibiliza geolocalização.');
      set('mapping-state', 'SEM GEOLOCALIZAÇÃO');
      return;
    }
    try {
      const permission = await navigator.permissions?.query({ name: 'geolocation' });
      if (permission?.state === 'granted') startNotebookLocation();
      else if (permission?.state === 'denied') {
        set('location-help', 'Permissão bloqueada. Libere a localização nas configurações do navegador.');
        set('mapping-state', 'PERMISSÃO BLOQUEADA');
      }
    } catch { /* Alguns navegadores não implementam a consulta de permissão. */ }
  }

  el('radius')?.addEventListener('input', () => { set('radius-value', `${el('radius').value} m`); renderFence(); });
  el('save-fence')?.addEventListener('click', () => saveFence().catch((error) => set('save-result', error.message)));
  el('locate-me')?.addEventListener('click', startNotebookLocation);
  el('discover-risks')?.addEventListener('click', () => discoverRisks().catch((error) => { set('mapping-state', 'BUSCA INDISPONÍVEL'); set('risk-feedback', error.message); }));
  el('draw-risk')?.addEventListener('click', startDrawing);
  el('zone-review')?.addEventListener('click', ({ target }) => {
    const confirmId = target.closest('[data-confirm-zone]')?.dataset.confirmZone;
    const rejectId = target.closest('[data-reject-zone]')?.dataset.rejectZone;
    const removeId = target.closest('[data-remove-zone]')?.dataset.removeZone;
    if (confirmId) confirmZone(confirmId).catch((error) => set('risk-feedback', error.message));
    else if (rejectId) rejectZone(rejectId);
    else if (removeId && window.confirm('Remover esta área das regras de alerta?')) removeZone(removeId).catch((error) => set('risk-feedback', error.message));
  });
  el('refresh-danger')?.addEventListener('click', async () => {
    set('danger-source', 'Atualizando áreas confirmadas...');
    await reloadDangerZones();
  });
  setInterval(() => {
    if (!lastReceivedAt) return;
    const seconds = Math.floor((Date.now() - lastReceivedAt) / 1000);
    set('last-update', seconds < 2 ? 'Atualizado agora' : `Atualizado há ${seconds}s`);
  }, 500);
  if (demoTilt) setInterval(() => { if (lastReading) updateTilt(lastReading); }, 80);
  start().catch((error) => set('last-update', `Falha: ${error.message}`));
})();
