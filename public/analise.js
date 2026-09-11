(() => {
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const params = new URLSearchParams(location.search);
  let deviceId = params.get('deviceId') || 'colheitadeira-01';
  let analysis;
  let activeAudience = 'broker';
  const audienceLabels = { broker: 'LEITURA PARA O CORRETOR', underwriter: 'LEITURA PARA O SUBSCRITOR', claims: 'LEITURA PARA O ANALISTA DE SINISTROS' };
  const eventTypeLabels = { collision: 'Colisão', rollover: 'Tombamento', mechanical_failure: 'Falha mecânica', fire: 'Incêndio', geofence: 'Saída da área', sensor_failure: 'Falha de sensor', other: 'Outro' };
  const outcomeLabels = { incident: 'Incidente com dano', near_miss: 'Quase acidente', no_damage: 'Sem dano', false_alarm: 'Falso alerta', maintenance: 'Manutenção preventiva' };

  function fmt(value, unit = '') {
    return Number.isFinite(Number(value)) && value !== null && value !== '' ? `${Number(value).toFixed(1)}${unit}` : '—';
  }

  function renderNarrative() {
    if (!analysis) return;
    const narrative = analysis.audiences[activeAudience];
    $('audience-label').textContent = audienceLabels[activeAudience];
    $('narrative-headline').textContent = narrative.headline;
    $('narrative-summary').textContent = narrative.summary;
    $('narrative-actions').innerHTML = narrative.actions.map((action) => `<li>${escapeHtml(action)}</li>`).join('');
  }

  function renderAnalysis(result) {
    analysis = result;
    const level = result.source.level;
    const score = result.source.score;
    const levelClass = level === 'ALTO' ? 'high' : level === 'MEDIO' ? 'medium' : level === 'BAIXO' ? 'low' : '';
    const ringColor = level === 'ALTO' ? '#df082a' : level === 'MEDIO' ? '#d98700' : level === 'BAIXO' ? '#008f67' : '#7a8491';
    $('analysis-version').textContent = result.version;
    $('generated-at').textContent = `Gerada às ${new Date(result.generatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    $('risk-level').textContent = level === 'MEDIO' ? 'MÉDIO' : level.replace('_', ' ');
    $('risk-level').className = `level ${levelClass}`;
    $('risk-score').textContent = Number.isFinite(score) ? score : '—';
    $('score-ring').style.setProperty('--score', Number.isFinite(score) ? score : 0);
    $('score-ring').style.setProperty('--ring', ringColor);
    $('machine-name').textContent = result.machine.name || result.machine.deviceId || deviceId;
    $('machine-meta').textContent = [result.machine.type, result.machine.model, result.machine.farmName].filter(Boolean).join(' · ') || deviceId;
    $('attention-count').textContent = result.history.samples ? `${result.history.attentionCount}/${result.history.samples}` : '—';
    $('risk-direction').textContent = result.history.direction;
    $('data-quality').textContent = `${result.quality.completenessPercent}%`;
    $('model-prediction').textContent = result.model.available ? `${result.model.probabilityPercent}% de chance de escalada` : 'Somente regra determinística';
    $('model-version').textContent = result.model.available
      ? `${result.model.modelVersion} · horizonte de ${result.model.horizonReadings} leituras`
      : result.governance?.latestModelVersion
        ? `${result.governance.latestModelVersion} · status ${result.governance.status} · não usado na explicação`
        : 'Nenhum modelo treinado';
    $('anomaly-prediction').textContent = result.anomaly?.available
      ? result.anomaly.anomalous ? `Anomalia identificada · ${result.anomaly.score}/100` : `Comportamento esperado · ${result.anomaly.score}/100`
      : 'Perfil real ainda indisponível';
    $('anomaly-version').textContent = result.anomaly?.available
      ? `${result.anomaly.modelVersion} · ${result.anomaly.unusualFeatures.length ? `desvios: ${result.anomaly.unusualFeatures.map((item) => item.label).join(', ')}` : 'sem desvio relevante'}`
      : result.anomaly?.reason || 'Treinado somente com telemetria real';
    $('factor-total').textContent = `${result.audit.factors.reduce((total, factor) => total + Number(factor.points || 0), 0)} pontos brutos`;
    $('factor-list').innerHTML = result.audit.factors.map((factor) => `<div class="factor ${factor.points ? '' : 'zero'}"><div><strong>${escapeHtml(factor.label)}</strong><small>${escapeHtml(factor.code)}</small></div><b>+${Number(factor.points || 0)}</b></div>`).join('') || '<div class="factor zero"><strong>Sem fatores disponíveis</strong><b>—</b></div>';
    const t = result.audit.telemetry;
    const telemetry = [
      ['DISTÂNCIA', fmt(t.distanceCm, ' cm')], ['INCLINAÇÃO', fmt(t.maximumTiltDegrees, '°')],
      ['TEMPERATURA', fmt(t.temperatureC, ' °C')], ['UMIDADE', fmt(t.humidityPercent, '%')],
      ['VELOCIDADE', fmt(t.speedKmh, ' km/h')], ['GEOFENCE', t.insideGeofence === true ? 'Dentro' : t.insideGeofence === false ? 'Fora' : '—'],
      ['ZONA DE RISCO', String(t.dangerLevel || 'unknown').toUpperCase()], ['BUZZER', t.buzzer ? 'Ativo' : 'Inativo'],
    ];
    $('telemetry-grid').innerHTML = telemetry.map(([label, value]) => `<div class="telemetry-value"><span>${label}</span><b>${escapeHtml(value)}</b></div>`).join('');
    $('telemetry-time').textContent = t.timestamp ? new Date(t.timestamp).toLocaleString('pt-BR') : 'Sem horário';
    $('missing-data').innerHTML = result.quality.missing.length ? result.quality.missing.map((item) => `<span class="gap">${escapeHtml(item.label)}</span>`).join('') : '<span class="gap complete">Telemetria essencial completa</span>';
    $('disclaimer-text').textContent = result.disclaimer;
    $('governance-meta').textContent = result.model.available
      ? `Fórmula: ${result.source.formulaVersion} · modelo: ${result.model.modelVersion} · dataset: ${result.model.datasetHash}`
      : result.governance?.latestModelVersion
        ? `Fórmula: ${result.source.formulaVersion} · último modelo: ${result.governance.latestModelVersion} (${result.governance.status}) · dataset: ${result.governance.datasetHash}`
        : `Fórmula: ${result.source.formulaVersion} · sem modelo preditivo treinado`;
    $('telemetry-link').href = `/sompo-agro-risk.html?deviceId=${encodeURIComponent(deviceId)}`;
    $('mapping-link').href = `/mapeamento-riscos.html?deviceId=${encodeURIComponent(deviceId)}`;
    renderNarrative();
  }

  async function loadMachines() {
    try {
      const response = await fetch('/api/fleet', { cache: 'no-store' });
      const fleet = await response.json();
      const machines = fleet.machines || [];
      const select = $('machine-select');
      if (!machines.some((machine) => machine.deviceId === deviceId)) machines.unshift({ deviceId, name: deviceId });
      select.innerHTML = machines.map((machine) => `<option value="${escapeHtml(machine.deviceId)}">${escapeHtml(machine.name)}</option>`).join('');
      select.value = deviceId;
    } catch { $('machine-select').innerHTML = `<option value="${escapeHtml(deviceId)}">${escapeHtml(deviceId)}</option>`; }
  }

  async function loadAnalysis() {
    $('analysis-error').hidden = true;
    try {
      const response = await fetch(`/api/analysis?deviceId=${encodeURIComponent(deviceId)}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível gerar a análise');
      renderAnalysis(result);
    } catch (error) {
      $('analysis-error').textContent = error.message;
      $('analysis-error').hidden = false;
    }
  }

  async function loadEvents() {
    try {
      const response = await fetch('/api/events?limit=50', { cache: 'no-store' });
      const events = await response.json();
      if (!response.ok) throw new Error(events.error || 'Falha ao carregar ocorrências');
      const selected = events.filter((event) => event.deviceId === deviceId);
      $('event-history').innerHTML = selected.length ? selected.map((event) => `<div class="event-entry"><strong>${escapeHtml(eventTypeLabels[event.eventType] || event.eventType)} · ${escapeHtml(outcomeLabels[event.outcome] || event.outcome)}</strong><small>${new Date(event.eventAt).toLocaleString('pt-BR')} ${event.damageAmount ? `· dano estimado R$ ${Number(event.damageAmount).toLocaleString('pt-BR')}` : ''}</small><span class="event-status ${escapeHtml(event.verificationStatus)}">${event.verificationStatus === 'verified' ? 'VALIDADO PELA SOMPO' : event.verificationStatus === 'rejected' ? 'DESCARTADO' : 'AGUARDANDO VALIDAÇÃO'}</span></div>`).join('') : '<p class="empty-event">Nenhuma ocorrência registrada para esta máquina.</p>';
    } catch (error) { $('event-history').innerHTML = `<p class="empty-event">${escapeHtml(error.message)}</p>`; }
  }

  async function submitEvent(event) {
    event.preventDefault();
    const button = event.submitter; button.disabled = true; $('event-feedback').textContent = 'Registrando evidência...';
    const payload = Object.fromEntries(new FormData(event.currentTarget)); payload.deviceId = deviceId;
    try {
      const response = await fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Não foi possível registrar');
      $('event-feedback').textContent = result.source === 'demo' ? 'Cenário salvo como demonstração; ele não entra no treinamento.' : 'Ocorrência enviada para validação da Sompo.';
      event.currentTarget.reset(); setDefaultEventTime(); await loadEvents();
    } catch (error) { $('event-feedback').textContent = error.message; }
    finally { button.disabled = false; }
  }

  function setDefaultEventTime() {
    const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    $('event-at').value = local;
  }

  document.querySelector('.audience-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-audience]');
    if (!button) return;
    activeAudience = button.dataset.audience;
    document.querySelectorAll('[data-audience]').forEach((tab) => { const active = tab === button; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); });
    renderNarrative();
  });
  $('machine-select').addEventListener('change', (event) => { deviceId = event.target.value; history.replaceState(null, '', `/analise.html?deviceId=${encodeURIComponent(deviceId)}`); loadAnalysis(); loadEvents(); });
  $('event-form').addEventListener('submit', submitEvent);
  $('copy-analysis').addEventListener('click', async () => {
    if (!analysis) return;
    const narrative = analysis.audiences[activeAudience];
    await navigator.clipboard.writeText(`${narrative.headline}\n\n${narrative.summary}\n\n${narrative.actions.map((item) => `• ${item}`).join('\n')}\n\n${analysis.disclaimer}`);
    $('copy-analysis').textContent = 'RESUMO COPIADO'; setTimeout(() => { $('copy-analysis').textContent = 'COPIAR RESUMO'; }, 1800);
  });
  $('download-analysis').addEventListener('click', () => {
    if (!analysis) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(analysis, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `analise-${deviceId}.json`; link.click(); URL.revokeObjectURL(url);
  });

  setDefaultEventTime();
  Promise.all([loadMachines(), loadAnalysis(), loadEvents()]);
})();
