/* Relatórios históricos: filtros, consolidação e exportação. */
(() => {
  const GROUP_TITLE = { fazenda: 'Por fazenda', regiao: 'Por região', equipamento: 'Por equipamento', dia: 'Por dia' };
  const GROUP_COLUMN = { fazenda: 'Fazenda', regiao: 'Região', equipamento: 'Equipamento', dia: 'Dia' };

  const form = document.getElementById('filters');
  const fromField = document.getElementById('from');
  const toField = document.getElementById('to');
  const groupField = document.getElementById('groupBy');
  const rowsBody = document.getElementById('rows');
  const exportButton = document.getElementById('export');

  function isoDay(date) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function applyPreset(days) {
    const today = new Date();
    const start = new Date(today.getTime() - (days - 1) * 86400000);
    fromField.value = isoDay(start);
    toField.value = isoDay(today);
    for (const button of form.querySelectorAll('.presets button')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.days) === days));
    }
  }

  function query() {
    return new URLSearchParams({ from: fromField.value, to: toField.value, groupBy: groupField.value });
  }

  function scoreClass(score) {
    if (!Number.isFinite(score)) return '';
    if (score >= 60) return 'high';
    if (score >= 30) return 'medium';
    return 'low';
  }

  function formatDay(value) {
    if (!value) return '—';
    const parts = String(value).split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
  }

  function distribution(levels, groupBy) {
    const total = levels.ALTO + levels.MEDIO + levels.BAIXO + levels.SEM_SINAL || 1;
    const width = (value) => `${(value / total) * 100}%`;
    return `
      <div class="bar" role="img" aria-label="${levels.ALTO} alto, ${levels.MEDIO} médio, ${levels.BAIXO} baixo, ${levels.SEM_SINAL} sem sinal">
        <i class="b-high" style="width:${width(levels.ALTO)}"></i>
        <i class="b-medium" style="width:${width(levels.MEDIO)}"></i>
        <i class="b-low" style="width:${width(levels.BAIXO)}"></i>
        <i class="b-none" style="width:${width(levels.SEM_SINAL)}"></i>
      </div>
      <small class="bar-legend">${levels.ALTO} alto · ${levels.MEDIO} médio · ${levels.BAIXO} baixo${levels.SEM_SINAL ? ` · ${levels.SEM_SINAL} sem sinal` : ''}</small>`;
  }

  function renderRows(report) {
    rowsBody.textContent = '';
    if (!report.groups.length) {
      const row = rowsBody.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 9;
      cell.className = 'empty';
      cell.textContent = 'Nenhuma leitura de telemetria neste período.';
      return;
    }
    for (const group of report.groups) {
      const row = rowsBody.insertRow();
      const label = report.groupBy === 'dia' ? formatDay(group.key) : group.key;
      row.insertCell().outerHTML = `<td class="name">${escape(label)}</td>`;
      row.insertCell().textContent = group.readings.toLocaleString('pt-BR');
      row.insertCell().textContent = group.devices;
      row.insertCell().outerHTML = `<td><span class="score ${scoreClass(group.averageScore)}">${group.averageScore ?? '—'}</span></td>`;
      row.insertCell().outerHTML = `<td><span class="score ${scoreClass(group.maximumScore)}">${group.maximumScore ?? '—'}</span></td>`;
      row.insertCell().innerHTML = distribution(group.levels, report.groupBy);
      row.insertCell().outerHTML = `<td><span class="share ${group.highRiskShare >= 30 ? 'high' : ''}">${group.highRiskShare}%</span></td>`;
      row.insertCell().innerHTML = eventsCell(group.events);
      row.insertCell().innerHTML = group.topFactors.length
        ? `<div class="factors">${group.topFactors.map((factor) => `<span>${escape(factor.label)} · ${factor.occurrences}x</span>`).join('')}</div>`
        : '<span class="muted">sem fatores relevantes</span>';
    }
  }

  function eventsCell(events) {
    if (!events || !events.total) return '<span class="muted">nenhum</span>';
    const tipos = events.byType.map((item) => `${escape(item.label)} ${item.occurrences}x`).join(' · ');
    return `<div class="events"><b class="${events.critical ? 'has-critical' : ''}">${events.total}</b><small>${events.critical} crítico${events.critical === 1 ? '' : 's'}${tipos ? `<br>${tipos}` : ''}</small></div>`;
  }

  function escape(value) {
    return String(value ?? '').replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));
  }

  function renderSummary(report) {
    const summary = report.summary;
    document.getElementById('s-readings').textContent = summary.readings.toLocaleString('pt-BR');
    document.getElementById('s-average').textContent = summary.averageScore ?? '—';
    document.getElementById('s-high').textContent = `${summary.highRiskShare}%`;
    document.getElementById('s-devices').textContent = summary.devices;
    document.getElementById('s-events').textContent = summary.events.critical;
    document.getElementById('s-events-detail').textContent = summary.events.total
      ? `de ${summary.events.total} evento${summary.events.total === 1 ? '' : 's'} registrados`
      : 'na trilha de auditoria';
    document.getElementById('s-period').textContent = `${formatDay(report.period.from.slice(0, 10))} a ${formatDay(report.period.to.slice(0, 10))}`;
    document.getElementById('table-title').textContent = GROUP_TITLE[report.groupBy] || 'Detalhamento';
    document.getElementById('group-column').textContent = GROUP_COLUMN[report.groupBy] || 'Grupo';
    document.getElementById('row-count').textContent = `${report.groups.length} ${report.groups.length === 1 ? 'linha' : 'linhas'}`;
    document.getElementById('generated-at').textContent = `Gerado em ${new Date(report.generatedAt).toLocaleString('pt-BR')}`;
  }

  function showError(message) {
    document.querySelector('.notice')?.remove();
    const notice = document.createElement('div');
    notice.className = 'notice';
    notice.textContent = message;
    form.insertAdjacentElement('afterend', notice);
  }

  async function load() {
    document.querySelector('.notice')?.remove();
    try {
      const response = await fetch(`/api/reports?${query()}`, { credentials: 'same-origin' });
      const report = await response.json();
      if (!response.ok) throw new Error(report.error || `Falha ao carregar (${response.status})`);
      renderSummary(report);
      renderRows(report);
    } catch (error) {
      showError(`Não foi possível carregar o relatório: ${error.message}`);
      rowsBody.innerHTML = '<tr><td colspan="9" class="empty">Sem dados para exibir.</td></tr>';
    }
  }

  form.addEventListener('submit', (event) => { event.preventDefault(); load(); });
  groupField.addEventListener('change', load);
  for (const button of form.querySelectorAll('.presets button')) {
    button.addEventListener('click', () => { applyPreset(Number(button.dataset.days)); load(); });
  }

  // O download é servido pela própria API, com o mesmo recorte aplicado na tela.
  exportButton.addEventListener('click', () => {
    window.location.href = `/api/reports?${query()}&format=csv`;
  });

  applyPreset(30);
  load();
})();
