/* Agregação dos relatórios históricos: período, agrupamento e métricas. */
const assert = require('node:assert');
const { buildReport, resolvePeriod, dayKey } = require('../lib/reports');

function reading(score, level, factors = []) {
  return { risk: { score, level, factors }, timestamp: null };
}

const rows = [
  { deviceId: 'colheitadeira-01', machineName: 'Colheitadeira 01', farmName: 'Santa Helena', customerName: 'Fazenda Santa Helena', city: 'Sorriso', state: 'MT', recordedAt: '2026-09-01T12:00:00.000Z', payload: reading(80, 'ALTO', [{ label: 'Inclinação crítica', points: 25 }]) },
  { deviceId: 'colheitadeira-01', machineName: 'Colheitadeira 01', farmName: 'Santa Helena', customerName: 'Fazenda Santa Helena', city: 'Sorriso', state: 'MT', recordedAt: '2026-09-01T13:00:00.000Z', payload: reading(20, 'BAIXO', []) },
  { deviceId: 'colheitadeira-01', machineName: 'Colheitadeira 01', farmName: 'Santa Helena', customerName: 'Fazenda Santa Helena', city: 'Sorriso', state: 'MT', recordedAt: '2026-09-02T13:00:00.000Z', payload: reading(90, 'ALTO', [{ label: 'Inclinação crítica', points: 25 }, { label: 'Obstáculo crítico', points: 30 }]) },
  { deviceId: 'trator-hz-11', machineName: 'Trator 11', farmName: 'Horizonte', customerName: 'Agropecuária Horizonte', city: 'Rio Verde', state: 'GO', recordedAt: '2026-09-02T14:00:00.000Z', payload: reading(45, 'MEDIO', [{ label: 'Velocidade alta', points: 10 }]) },
  { deviceId: 'trator-hz-11', machineName: 'Trator 11', farmName: 'Horizonte', customerName: 'Agropecuária Horizonte', city: 'Rio Verde', state: 'GO', recordedAt: '2026-08-01T14:00:00.000Z', payload: reading(95, 'ALTO', []) },
  { deviceId: 'sem-sinal-01', machineName: 'Pulverizador', farmName: 'Santa Helena', customerName: 'Fazenda Santa Helena', city: 'Sorriso', state: 'MT', recordedAt: '2026-09-02T15:00:00.000Z', payload: null },
];

// 1. Agrupamento por fazenda, dentro do período pedido.
const porFazenda = buildReport(rows, { groupBy: 'fazenda', from: '2026-09-01', to: '2026-09-02' });
assert.strictEqual(porFazenda.groups.length, 2);
const helena = porFazenda.groups.find((group) => group.key === 'Santa Helena');
assert.strictEqual(helena.readings, 4, 'a leitura sem telemetria também conta como leitura');
assert.strictEqual(helena.devices, 2);
assert.strictEqual(helena.criticalEvents, 2);
assert.strictEqual(helena.maximumScore, 90);
assert.strictEqual(helena.averageScore, Math.round((80 + 20 + 90) / 3), 'a média ignora leituras sem score');
assert.strictEqual(helena.levels.SEM_SINAL, 1);
assert.strictEqual(helena.highRiskShare, 67, '2 de 3 leituras com score ficaram em risco alto');

// 2. A leitura de agosto fica fora do período e não entra em lugar nenhum.
const horizonte = porFazenda.groups.find((group) => group.key === 'Horizonte');
assert.strictEqual(horizonte.readings, 1);
assert.strictEqual(porFazenda.summary.readings, 5);

// 3. O que exige ação vem primeiro.
assert.strictEqual(porFazenda.groups[0].key, 'Santa Helena', 'mais eventos críticos deve vir primeiro');

// 4. Os fatores dominantes explicam o porquê do número.
assert.strictEqual(helena.topFactors[0].label, 'Inclinação crítica');
assert.strictEqual(helena.topFactors[0].occurrences, 2);

// 5. Os outros agrupamentos.
const porRegiao = buildReport(rows, { groupBy: 'regiao', from: '2026-09-01', to: '2026-09-02' });
assert.deepStrictEqual(porRegiao.groups.map((group) => group.key).sort(), ['Rio Verde / GO', 'Sorriso / MT']);

const porEquipamento = buildReport(rows, { groupBy: 'equipamento', from: '2026-09-01', to: '2026-09-02' });
assert.strictEqual(porEquipamento.groups.length, 3);

const porDia = buildReport(rows, { groupBy: 'dia', from: '2026-09-01', to: '2026-09-02' });
assert.deepStrictEqual(porDia.groups.map((group) => group.key).sort(), ['2026-09-01', '2026-09-02']);

// 6. "até 10/09" inclui o dia 10 inteiro, não só a meia-noite.
const periodo = resolvePeriod({ from: '2026-09-01', to: '2026-09-02' });
assert.strictEqual(periodo.to.toISOString(), '2026-09-02T23:59:59.999Z');
const soUmDia = buildReport(rows, { groupBy: 'dia', from: '2026-09-02', to: '2026-09-02' });
assert.strictEqual(soUmDia.groups.length, 1, 'um único dia precisa incluir as leituras daquele dia');
assert.strictEqual(soUmDia.groups[0].readings, 3);

// 7. Datas invertidas não devolvem relatório vazio: o período é normalizado.
const invertido = buildReport(rows, { groupBy: 'dia', from: '2026-09-02', to: '2026-09-01' });
assert.strictEqual(invertido.summary.readings, 5);

// 8. Sem dados no período, o relatório é vazio mas bem formado.
const vazio = buildReport(rows, { groupBy: 'fazenda', from: '2026-01-01', to: '2026-01-31' });
assert.strictEqual(vazio.groups.length, 0);
assert.strictEqual(vazio.summary.readings, 0);
assert.strictEqual(vazio.summary.averageScore, null);
assert.strictEqual(vazio.summary.highRiskShare, 0);

// 9. O agrupamento por dia usa o fuso da operação, não UTC.
assert.strictEqual(dayKey('2026-09-02T02:00:00.000Z'), '2026-09-01', '02:00 UTC ainda é dia 1 em São Paulo');

// 10. Agrupamento desconhecido cai no padrão em vez de quebrar.
assert.strictEqual(buildReport(rows, { groupBy: 'inventado' }).groupBy, 'fazenda');

// 11. A trilha de auditoria entra no mesmo recorte da telemetria.
const eventos = [
  { deviceId: 'colheitadeira-01', farmName: 'Santa Helena', city: 'Sorriso', state: 'MT', recordedAt: '2026-09-01T12:10:00.000Z', severity: 'critical', type: 'geofence', message: 'saiu da área' },
  { deviceId: 'colheitadeira-01', farmName: 'Santa Helena', city: 'Sorriso', state: 'MT', recordedAt: '2026-09-01T12:40:00.000Z', severity: 'info', type: 'geofence', message: 'voltou' },
  { deviceId: 'colheitadeira-01', farmName: 'Santa Helena', city: 'Sorriso', state: 'MT', recordedAt: '2026-09-02T09:00:00.000Z', severity: 'critical', type: 'danger-zone', message: 'entrou na faixa crítica' },
  { deviceId: 'trator-hz-11', farmName: 'Horizonte', city: 'Rio Verde', state: 'GO', recordedAt: '2026-07-01T09:00:00.000Z', severity: 'critical', type: 'geofence', message: 'fora do período' },
];
const comEventos = buildReport(rows, { groupBy: 'fazenda', from: '2026-09-01', to: '2026-09-02', events: eventos });
const helenaEventos = comEventos.groups.find((group) => group.key === 'Santa Helena').events;
assert.strictEqual(helenaEventos.total, 3);
assert.strictEqual(helenaEventos.critical, 2);
assert.strictEqual(helenaEventos.info, 1);
assert.strictEqual(helenaEventos.byType[0].label, 'Área operacional', 'o tipo com mais críticos vem primeiro');
assert.strictEqual(helenaEventos.byType[0].occurrences, 2);
assert.strictEqual(comEventos.groups.find((group) => group.key === 'Horizonte').events.total, 0, 'evento fora do período não entra');
assert.strictEqual(comEventos.summary.events.critical, 2);

// 12. Quem tem evento crítico registrado vem antes de quem só tem score alto.
const soScore = [{ deviceId: 'x', farmName: 'Só Score', recordedAt: '2026-09-01T12:00:00.000Z', payload: reading(100, 'ALTO', []) }];
const soEvento = [{ deviceId: 'y', farmName: 'Só Evento', recordedAt: '2026-09-01T12:00:00.000Z', severity: 'critical', type: 'geofence', message: 'saiu' }];
const ordenado = buildReport(soScore, { groupBy: 'fazenda', from: '2026-09-01', to: '2026-09-02', events: soEvento });
assert.strictEqual(ordenado.groups[0].key, 'Só Evento', 'fato registrado pesa mais que média alta');

// 13. Um grupo pode existir só por causa de eventos, sem telemetria no período.
assert.strictEqual(ordenado.groups.find((group) => group.key === 'Só Evento').readings, 0);

console.log('✅ test-reports: período, agrupamentos, métricas, eventos, fuso e casos vazios aprovados');

/* Endpoint: escopo por perfil, filtros e exportação. */
async function testarEndpoint() {
  delete process.env.DATABASE_URL;
  const db = require('../lib/db');
  const handler = require('../handlers/reports');

  const agora = new Date();
  await db.saveTelemetry('colheitadeira-01', { timestamp: agora.toISOString(), risk: { score: 85, level: 'ALTO', factors: [{ label: 'Inclinação crítica', points: 25 }] } });
  await db.saveTelemetry('colheitadeira-01', { timestamp: agora.toISOString(), risk: { score: 15, level: 'BAIXO', factors: [] } });

  const invoke = (request) => new Promise((resolve) => {
    const response = {
      statusCode: 200, headers: {},
      status(code) { this.statusCode = code; return this; },
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload, headers: this.headers }); },
      end(payload) { resolve({ status: this.statusCode, body: payload, headers: this.headers }); },
    };
    handler({ method: 'GET', headers: {}, query: {}, ...request }, response);
  });

  const farmer = { role: 'farmer', customerId: 'cust-farm-001', sub: 'user-farmer-demo' };

  // O produtor vê a própria carteira.
  const doProdutor = await invoke({ query: { groupBy: 'fazenda' }, user: farmer });
  assert.strictEqual(doProdutor.status, 200);
  assert.ok(doProdutor.body.groups.length >= 1, 'o produtor deveria ver a própria fazenda');
  assert.strictEqual(doProdutor.body.scope.customerId, 'cust-farm-001');

  // Um produtor de outra carteira não alcança esses dados, mesmo pedindo o equipamento pelo nome.
  const deOutro = await invoke({ query: { groupBy: 'fazenda', deviceId: 'colheitadeira-01' }, user: { role: 'farmer', customerId: 'cust-farm-002', sub: 'x' } });
  assert.strictEqual(deOutro.body.summary.readings, 0, 'equipamento de outra carteira não pode aparecer no relatório');

  // O parâmetro de cliente é ignorado para quem não é Sompo.
  const tentativa = await invoke({ query: { groupBy: 'fazenda', customerId: 'cust-farm-003' }, user: farmer });
  assert.strictEqual(tentativa.body.scope.customerId, 'cust-farm-001', 'o produtor não escolhe a carteira que quer ver');

  // A Sompo enxerga sem recorte de cliente.
  const daSompo = await invoke({ query: { groupBy: 'regiao' }, user: { role: 'sompo', sub: 'user-sompo-demo' } });
  assert.strictEqual(daSompo.body.scope.customerId, null);
  assert.strictEqual(daSompo.body.groupBy, 'regiao');

  // Os eventos da trilha de auditoria acompanham o relatório.
  await db.addSafetyLog('colheitadeira-01', 'critical', 'geofence', 'Equipamento saiu da área operacional segura', {});
  await db.addSafetyLog('colheitadeira-01', 'info', 'geofence', 'Equipamento retornou à área operacional segura', {});

  const comEventosApi = await invoke({ query: { groupBy: 'fazenda' }, user: farmer });
  assert.strictEqual(comEventosApi.body.summary.events.total, 2, 'a trilha de auditoria precisa chegar ao relatório');
  assert.strictEqual(comEventosApi.body.summary.events.critical, 1);

  // O evento é datado pela leitura que o originou, não pelo processamento: o gateway
  // acumula telemetria sem rede e reenvia depois.
  const ontem = new Date(Date.now() - 86400000).toISOString();
  const registrado = await db.addSafetyLog('colheitadeira-01', 'warning', 'danger-zone', 'Aproximação', {}, ontem);
  assert.strictEqual(registrado.timestamp, ontem, 'o evento precisa guardar o horário da leitura');
  const porDiaApi = await invoke({ query: { groupBy: 'dia' }, user: farmer });
  const diaDeOntem = porDiaApi.body.groups.find((group) => group.key === ontem.slice(0, 10));
  assert.ok(diaDeOntem, 'o evento de ontem deve aparecer no dia de ontem, não no de hoje');
  assert.strictEqual(diaDeOntem.events.total, 1);

  // Exportação em CSV, com cabeçalho e uma linha por grupo.
  const csv = await invoke({ query: { groupBy: 'fazenda', format: 'csv' }, user: farmer });
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.headers['content-disposition'], /agrorisk-relatorio-fazenda-\d{4}-\d{2}-\d{2}\.csv/);
  const linhas = String(csv.body).split('\r\n');
  assert.match(linhas[0], /"Fazenda";"Leituras"/);
  assert.match(linhas[0], /"Eventos";"Eventos criticos"/, 'o CSV precisa trazer as colunas de evento');
  assert.strictEqual(linhas.length, doProdutor.body.groups.length + 1);

  // Método não suportado é recusado.
  const post = await invoke({ method: 'POST', user: farmer });
  assert.strictEqual(post.status, 405);

  console.log('✅ test-reports (API): escopo por perfil, isolamento entre carteiras, CSV e método aprovados');
}

testarEndpoint().catch((error) => { console.error('❌', error.message); process.exit(1); });
