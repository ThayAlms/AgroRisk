(() => {
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const money = (value, compact = false) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0 }).format(Number(value) || 0);
  const percent = (value) => `${Number(value || 0).toFixed(1).replace('.', ',')}%`;
  const statusNames = { triage: 'TRIAGEM', investigating: 'EM INVESTIGAÇÃO', monitoring: 'MONITORAMENTO', open: 'ABERTO' };
  const levelNames = { ALTO: 'ALTO', MEDIO: 'MÉDIO', BAIXO: 'BAIXO', SEM_SINAL: 'SEM SINAL' };
  let portfolio;

  function renderKpis() {
    const { summary, exposureByRisk } = portfolio;
    $('kpi-exposure').textContent = money(summary.exposure, true);
    $('kpi-contractors').textContent = `${summary.activeContractors} segurados ativos`;
    $('kpi-high-exposure').textContent = money(exposureByRisk.ALTO, true);
    $('kpi-high').textContent = summary.highRiskContractors;
    $('high-exposure-line').style.width = `${summary.exposure ? exposureByRisk.ALTO / summary.exposure * 100 : 0}%`;
    $('kpi-premium').textContent = money(summary.annualPremium, true);
    $('kpi-loss').textContent = money(summary.estimatedLoss, true);
    $('kpi-claims').textContent = `${summary.openClaims} EVENTOS`;
    $('kpi-loss-ratio').textContent = percent(summary.lossToPremiumPercent);
    $('loss-ratio-line').style.width = `${Math.min(summary.lossToPremiumPercent, 100)}%`;
    $('nav-customer-count').textContent = summary.activeContractors;
    $('nav-claim-count').textContent = summary.openClaims;
  }

  function renderPriorities() {
    const items = portfolio.contractors.slice(0, 3);
    $('priority-list').innerHTML = items.map((customer, index) => `<button class="priority-item" type="button" data-customer="${escapeHtml(customer.id)}" style="width:100%;border:0;background:transparent;text-align:left;cursor:pointer">
      <span class="priority-rank">0${index + 1}</span><span><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.risk.reason)} · ${money(customer.policy?.insured, true)} segurados</small></span><span class="risk-chip ${customer.risk.level.toLowerCase()}">${levelNames[customer.risk.level]}</span>
    </button>`).join('');
  }

  function renderExposure() {
    const levels = ['ALTO', 'MEDIO', 'BAIXO', 'SEM_SINAL'];
    const maximum = Math.max(...Object.values(portfolio.exposureByRisk), 1);
    $('exposure-chart').innerHTML = levels.map((level) => `<div class="exposure-row"><label>${levelNames[level]}</label><div class="bar-track"><span class="${level.toLowerCase()}" style="width:${portfolio.exposureByRisk[level] / maximum * 100}%"></span></div><b>${money(portfolio.exposureByRisk[level], true)}</b></div>`).join('');

    const total = portfolio.contractors.length || 1;
    const criticalShare = portfolio.distribution.ALTO / total * 100;
    const allMachines = portfolio.contractors.reduce((sum, customer) => sum + customer.machineCount, 0);
    const onlineMachines = portfolio.contractors.reduce((sum, customer) => sum + customer.onlineMachines, 0);
    const onlineShare = allMachines ? onlineMachines / allMachines * 100 : 0;
    const attention = Math.min(100, Math.round(criticalShare * .6 + Math.min(portfolio.summary.lossToPremiumPercent, 100) * .3 + (100 - onlineShare) * .1));
    $('attention-score').textContent = attention;
    $('attention-label').textContent = attention >= 65 ? 'Atenção elevada' : attention >= 35 ? 'Atenção moderada' : 'Carteira estável';
    $('critical-share').textContent = percent(criticalShare);
    $('online-share').textContent = percent(onlineShare);
    document.querySelector('.score-ring').style.background = `conic-gradient(${attention >= 65 ? '#e3062c' : '#e89012'} 0 ${attention}%, #edf0f3 ${attention}% 100%)`;
  }

  function filteredCustomers() {
    const query = $('customer-search').value.toLocaleLowerCase('pt-BR');
    const level = $('risk-filter').value;
    return portfolio.contractors.filter((customer) => {
      const text = [customer.name, customer.ownerName, customer.city, customer.state, customer.policy?.number].join(' ').toLocaleLowerCase('pt-BR');
      return (!query || text.includes(query)) && (!level || customer.risk.level === level);
    });
  }

  function renderCustomers() {
    const rows = filteredCustomers();
    $('customer-rows').innerHTML = rows.length ? rows.map((customer) => `<tr data-customer="${escapeHtml(customer.id)}">
      <td><div class="customer-cell"><span class="customer-mark">${escapeHtml(customer.name.split(' ').filter(Boolean).slice(0, 2).map((word) => word[0]).join(''))}</span><span><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.city)} / ${escapeHtml(customer.state)} · ${Number(customer.hectares).toLocaleString('pt-BR')} ha</small></span></div></td>
      <td><span class="risk-chip ${customer.risk.level.toLowerCase()}">${levelNames[customer.risk.level]} ${customer.risk.score ?? '—'}</span></td>
      <td><strong>${escapeHtml(customer.policy?.number || 'Sem apólice')}</strong><br><span class="muted">${escapeHtml(customer.policy?.status || '')}</span></td>
      <td class="money">${money(customer.policy?.insured)}</td><td class="money">${customer.estimatedLoss ? money(customer.estimatedLoss) : '—'}</td>
      <td><span class="${customer.onlineMachines ? 'online-dot' : 'online-dot offline-dot'}"></span>${customer.onlineMachines}/${customer.machineCount} online</td><td><button class="row-action" type="button" aria-label="Ver detalhes">→</button></td>
    </tr>`).join('') : '<tr><td colspan="7" class="muted">Nenhum segurado encontrado com esses filtros.</td></tr>';
  }

  function renderClaims() {
    $('claim-total').textContent = `${portfolio.claims.length} eventos`;
    $('claim-list').innerHTML = portfolio.claims.map((claim) => `<article class="claim-card"><div class="claim-head"><span class="claim-status">${statusNames[claim.status] || escapeHtml(claim.status)}</span><span class="muted">${new Date(claim.occurredAt).toLocaleDateString('pt-BR')}</span></div><h3>${escapeHtml(claim.kind)}</h3><small>${escapeHtml(claim.customerName)} · ${escapeHtml(claim.deviceId || 'sem dispositivo')}</small><p>${escapeHtml(claim.summary)}</p><div class="claim-metrics"><span>PERDA ESTIMADA<b>${money(claim.loss)}</b></span><span>CONFIANÇA DO SINAL<b>${claim.confidence ?? '—'}%</b></span></div></article>`).join('');
  }

  function openCustomer(id) {
    const customer = portfolio.contractors.find((item) => item.id === id);
    if (!customer) return;
    $('customer-detail').innerHTML = `<div class="detail-head"><span class="section-kicker">DOSSIÊ DO SEGURADO</span><h2>${escapeHtml(customer.name)}</h2><p>${escapeHtml(customer.ownerName)} · ${escapeHtml(customer.document)} · ${escapeHtml(customer.email)}</p></div><span class="risk-chip ${customer.risk.level.toLowerCase()}">${levelNames[customer.risk.level]} · ${customer.risk.score ?? '—'}/100</span><div class="detail-grid"><div><span>VALOR SEGURADO</span><strong>${money(customer.policy?.insured)}</strong></div><div><span>PRÊMIO ANUAL</span><strong>${money(customer.policy?.premium)}</strong></div><div><span>FRANQUIA</span><strong>${money(customer.policy?.deductible)}</strong></div><div><span>APÓLICE</span><strong>${escapeHtml(customer.policy?.number || '—')}</strong></div><div><span>ÁREA PRODUTIVA</span><strong>${Number(customer.hectares).toLocaleString('pt-BR')} ha</strong></div><div><span>GESTOR SOMPO</span><strong>${escapeHtml(customer.manager)}</strong></div></div><div class="detail-note"><strong>Leitura prioritária:</strong> ${escapeHtml(customer.risk.reason)} A telemetria é evidência de apoio e deve ser confrontada com vistoria e documentos.</div>`;
    $('customer-dialog').showModal();
  }

  async function load() {
    $('refresh').disabled = true;
    try {
      const response = await fetch('/api/sompo-portfolio', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível carregar a carteira');
      portfolio = result;
      renderKpis(); renderPriorities(); renderExposure(); renderCustomers(); renderClaims();
      $('updated-at').textContent = `Atualizado às ${new Date(result.generatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      $('page-error').hidden = true;
    } catch (error) {
      $('page-error').textContent = error.message;
      $('page-error').hidden = false;
    } finally { $('refresh').disabled = false; }
  }

  $('refresh').addEventListener('click', load);
  $('customer-search').addEventListener('input', renderCustomers);
  $('risk-filter').addEventListener('change', renderCustomers);
  document.addEventListener('click', (event) => { const target = event.target.closest('[data-customer]'); if (target) openCustomer(target.dataset.customer); });
  document.querySelector('.dialog-close').addEventListener('click', () => $('customer-dialog').close());
  $('customer-dialog').addEventListener('click', (event) => { if (event.target === $('customer-dialog')) $('customer-dialog').close(); });
  $('logout').addEventListener('click', () => window.agroRiskLogout());
  load();
})();
