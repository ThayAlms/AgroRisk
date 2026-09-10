(() => {
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const levelConfig = {
    ALTO: { list: 'list-high', count: 'count-high', css: 'high', empty: 'Nenhuma máquina em risco alto.' },
    MEDIO: { list: 'list-medium', count: 'count-medium', css: 'medium', empty: 'Nenhuma máquina em risco médio.' },
    BAIXO: { list: 'list-low', count: 'count-low', css: 'low', empty: 'Nenhuma máquina em baixo risco.' },
    SEM_SINAL: { list: 'list-offline', count: 'count-offline', css: 'offline', empty: 'Nenhuma máquina sem sinal.' },
  };
  let machines = [];
  let refreshTimer;

  function timeAgo(timestamp) {
    if (!timestamp) return 'Nunca recebeu dados';
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
    if (seconds < 10) return 'Atualizada agora';
    if (seconds < 60) return `Há ${seconds} segundos`;
    if (seconds < 3600) return `Há ${Math.floor(seconds / 60)} min`;
    if (seconds < 86400) return `Há ${Math.floor(seconds / 3600)} h`;
    return `Há ${Math.floor(seconds / 86400)} dias`;
  }

  function machineCard(machine) {
    const config = levelConfig[machine.risk.level] || levelConfig.SEM_SINAL;
    const factor = machine.risk.factors?.[0]?.label || 'Sem motivo informado';
    const score = Number.isFinite(machine.risk.score) ? `<b>${machine.risk.score}</b> / 100` : '<b>—</b> sem dados';
    const operator = machine.currentOperator || 'Não atribuído';
    const farm = machine.farmName || 'Unidade não informada';
    return `<article class="machine-card ${config.css}" data-machine="${escapeHtml(machine.deviceId)}">
      <div class="machine-head"><div><h3>${escapeHtml(machine.name)}</h3><small>${escapeHtml(machine.type)}${machine.model ? ` · ${escapeHtml(machine.model)}` : ''}</small></div><span class="risk-score">${score}</span></div>
      <div class="machine-meta"><span>OPERADOR<b>${escapeHtml(operator)}</b></span><span>FAZENDA / UNIDADE<b>${escapeHtml(farm)}</b></span></div>
      <div class="reason"><strong>Motivo:</strong> ${escapeHtml(factor)}</div>
      ${machine.notes ? `<p class="machine-notes">${escapeHtml(machine.notes)}</p>` : ''}
      <div class="machine-meta"><span>ÚLTIMA TELEMETRIA<b>${escapeHtml(timeAgo(machine.lastSeenAt))}</b></span><span>DISPOSITIVO<b>${escapeHtml(machine.deviceId)}</b></span></div>
      <div class="machine-actions"><a href="/analise.html?deviceId=${encodeURIComponent(machine.deviceId)}">ANÁLISE</a><a href="/sompo-agro-risk.html?deviceId=${encodeURIComponent(machine.deviceId)}">TELEMETRIA</a><button type="button" data-edit="${escapeHtml(machine.deviceId)}">EDITAR</button></div>
    </article>`;
  }

  function currentFilteredMachines() {
    const query = normalize($('fleet-search').value);
    const type = $('type-filter').value;
    const operator = $('operator-filter').value;
    return machines.filter((machine) => {
      const factorText = machine.risk.factors?.map((factor) => factor.label).join(' ') || '';
      const searchable = normalize([machine.name, machine.deviceId, machine.type, machine.model, machine.farmName, machine.currentOperator, machine.notes, factorText].join(' '));
      return (!query || searchable.includes(query)) && (!type || machine.type === type) && (!operator || machine.currentOperator === operator);
    });
  }

  function render() {
    const filtered = currentFilteredMachines();
    for (const [level, config] of Object.entries(levelConfig)) {
      const list = filtered.filter((machine) => machine.risk.level === level);
      $(config.count).textContent = list.length;
      $(config.list).innerHTML = list.length ? list.map(machineCard).join('') : `<div class="empty-column">${config.empty}</div>`;
    }
  }

  function fillFilters() {
    const preserve = (select, values, placeholder) => {
      const selected = select.value;
      select.innerHTML = `<option value="">${placeholder}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
      select.value = values.includes(selected) ? selected : '';
    };
    fillFilters.types = [...new Set(machines.map((machine) => machine.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    fillFilters.operators = [...new Set(machines.map((machine) => machine.currentOperator).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    preserve($('type-filter'), fillFilters.types, 'Todos os tipos');
    preserve($('operator-filter'), fillFilters.operators, 'Todos os operadores');
  }

  async function loadFleet(showLoading = false) {
    if (showLoading) $('last-sync').textContent = 'Atualizando frota...';
    try {
      const response = await fetch('/api/fleet', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível carregar a frota');
      machines = result.machines || [];
      $('summary-total').textContent = result.summary.total;
      $('summary-high').textContent = result.summary.high;
      $('summary-medium').textContent = result.summary.medium;
      $('summary-offline').textContent = result.summary.offline;
      $('last-sync').textContent = `Sincronizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      $('fleet-error').hidden = true;
      fillFilters(); render();
    } catch (error) {
      $('fleet-error').textContent = error.message;
      $('fleet-error').hidden = false;
      $('last-sync').textContent = 'Falha na atualização';
    }
  }

  function openMachineDialog(machine) {
    const editing = Boolean(machine);
    $('dialog-title').textContent = editing ? 'Editar máquina' : 'Cadastrar máquina';
    $('machine-id').value = machine?.deviceId || '';
    $('machine-id').readOnly = editing;
    $('machine-name').value = machine?.name || '';
    $('machine-type').value = machine?.type || '';
    $('machine-model').value = machine?.model || '';
    $('machine-farm').value = machine?.farmName || '';
    $('machine-operator').value = machine?.currentOperator || '';
    $('machine-notes').value = machine?.notes || '';
    $('form-feedback').textContent = '';
    $('machine-dialog').showModal();
  }

  async function saveMachine(event) {
    event.preventDefault();
    const submit = event.submitter;
    submit.disabled = true;
    $('form-feedback').textContent = 'Salvando...';
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch('/api/machines', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível salvar a máquina');
      $('machine-dialog').close();
      await loadFleet(true);
    } catch (error) {
      $('form-feedback').textContent = error.message;
    } finally { submit.disabled = false; }
  }

  $('fleet-search').addEventListener('input', render);
  $('type-filter').addEventListener('change', render);
  $('operator-filter').addEventListener('change', render);
  $('refresh-fleet').addEventListener('click', () => loadFleet(true));
  $('add-machine').addEventListener('click', () => openMachineDialog(null));
  $('machine-form').addEventListener('submit', saveMachine);
  document.querySelectorAll('.dialog-close,.dialog-cancel').forEach((button) => button.addEventListener('click', () => $('machine-dialog').close()));
  document.querySelector('.kanban').addEventListener('click', (event) => {
    const id = event.target.closest('[data-edit]')?.dataset.edit;
    if (id) openMachineDialog(machines.find((machine) => machine.deviceId === id));
  });
  $('machine-dialog').addEventListener('click', (event) => { if (event.target === $('machine-dialog')) $('machine-dialog').close(); });

  loadFleet(true);
  refreshTimer = setInterval(() => { if (!$('machine-dialog').open) loadFleet(false); }, 5000);
  window.addEventListener('beforeunload', () => clearInterval(refreshTimer));
})();
