const { calculateOperationalRisk } = require('./risk');

const LEVELS = Object.freeze(['ALTO', 'MEDIO', 'BAIXO']);
const EVENT_LABEL = Object.freeze({
  'danger-zone': 'Zona perigosa',
  geofence: 'Área operacional',
  obstacle: 'Obstáculo',
  tilt: 'Inclinação',
});
const GROUPS = Object.freeze(['fazenda', 'regiao', 'equipamento', 'dia']);

function riskOf(reading) {
  if (!reading) return null;
  return reading.risk || calculateOperationalRisk(reading);
}

function dayKey(timestamp) {
  // Agrupar por dia só faz sentido no fuso da operação, não em UTC.
  return new Date(timestamp).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }).split('/').reverse().join('-');
}

function groupKeyOf(row, groupBy) {
  if (groupBy === 'fazenda') return row.farmName || row.customerName || 'Fazenda não identificada';
  if (groupBy === 'regiao') return [row.city, row.state].filter(Boolean).join(' / ') || 'Região não informada';
  if (groupBy === 'equipamento') return row.machineName || row.deviceId;
  return dayKey(row.recordedAt);
}

function emptyBucket(key) {
  return {
    key,
    readings: 0,
    scoreSum: 0,
    averageScore: null,
    maximumScore: null,
    levels: { ALTO: 0, MEDIO: 0, BAIXO: 0, SEM_SINAL: 0 },
    highRiskShare: 0,
    devices: new Set(),
    criticalEvents: 0,
    firstReadingAt: null,
    lastReadingAt: null,
    topFactors: new Map(),
    events: { total: 0, critical: 0, warning: 0, info: 0, byType: new Map() },
  };
}

// A trilha de auditoria conta o que aconteceu — saiu da área, entrou em zona
// perigosa — enquanto a telemetria conta como a máquina estava. As duas juntas
// é o que o corretor precisa para explicar o período ao cliente.
function accumulateEvent(bucket, event) {
  bucket.events.total += 1;
  if (event.severity === 'critical') bucket.events.critical += 1;
  else if (event.severity === 'warning') bucket.events.warning += 1;
  else bucket.events.info += 1;
  const label = EVENT_LABEL[event.type] || event.type || 'Evento';
  const current = bucket.events.byType.get(label) || { label, occurrences: 0, critical: 0 };
  current.occurrences += 1;
  if (event.severity === 'critical') current.critical += 1;
  bucket.events.byType.set(label, current);
}

function accumulate(bucket, row) {
  const risk = riskOf(row.payload);
  bucket.readings += 1;
  bucket.devices.add(row.deviceId);
  const score = Number(risk?.score);
  if (Number.isFinite(score)) {
    bucket.scoreSum += score;
    bucket.maximumScore = bucket.maximumScore === null ? score : Math.max(bucket.maximumScore, score);
  }
  const level = LEVELS.includes(risk?.level) ? risk.level : 'SEM_SINAL';
  bucket.levels[level] += 1;
  if (level === 'ALTO') bucket.criticalEvents += 1;
  for (const factor of risk?.factors || []) {
    if (!(factor.points > 0)) continue;
    const current = bucket.topFactors.get(factor.label) || { label: factor.label, occurrences: 0, points: 0 };
    current.occurrences += 1;
    current.points += factor.points;
    bucket.topFactors.set(factor.label, current);
  }
  const at = row.recordedAt;
  if (!bucket.firstReadingAt || at < bucket.firstReadingAt) bucket.firstReadingAt = at;
  if (!bucket.lastReadingAt || at > bucket.lastReadingAt) bucket.lastReadingAt = at;
}

function finalize(bucket) {
  const scored = bucket.levels.ALTO + bucket.levels.MEDIO + bucket.levels.BAIXO;
  return {
    key: bucket.key,
    readings: bucket.readings,
    devices: bucket.devices.size,
    averageScore: scored ? Math.round(bucket.scoreSum / scored) : null,
    maximumScore: bucket.maximumScore,
    levels: bucket.levels,
    // Parcela das leituras com risco alto: é o número que responde
    // "quanto dessa operação aconteceu em condição crítica?".
    highRiskShare: scored ? Math.round((bucket.levels.ALTO / scored) * 100) : 0,
    attentionShare: scored ? Math.round(((bucket.levels.ALTO + bucket.levels.MEDIO) / scored) * 100) : 0,
    criticalEvents: bucket.criticalEvents,
    firstReadingAt: bucket.firstReadingAt,
    lastReadingAt: bucket.lastReadingAt,
    topFactors: [...bucket.topFactors.values()]
      .sort((a, b) => b.occurrences - a.occurrences || b.points - a.points)
      .slice(0, 3),
    events: {
      total: bucket.events.total,
      critical: bucket.events.critical,
      warning: bucket.events.warning,
      info: bucket.events.info,
      byType: [...bucket.events.byType.values()]
        .sort((a, b) => b.critical - a.critical || b.occurrences - a.occurrences)
        .slice(0, 3),
    },
  };
}

function parseDate(value, fallback) {
  if (!value) return fallback;
  const parsed = new Date(String(value).length <= 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

// Fim do dia quando o filtro vem como data pura: "até 10/09" inclui o dia 10 inteiro.
function parseEndDate(value, fallback) {
  if (!value) return fallback;
  if (String(value).length <= 10) {
    const parsed = new Date(`${value}T23:59:59.999Z`);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  }
  return parseDate(value, fallback);
}

function resolvePeriod({ from, to } = {}, now = new Date()) {
  // Datas invertidas são reinterpretadas na ordem certa, e não apenas trocadas:
  // trocar os instantes já convertidos deixaria a janela com milissegundos de duração.
  const startCandidate = from ? parseDate(from, null) : null;
  const endCandidate = to ? parseEndDate(to, null) : null;
  if (startCandidate && endCandidate && startCandidate > endCandidate) {
    return resolvePeriod({ from: to, to: from }, now);
  }
  const end = endCandidate || now;
  const start = startCandidate || new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { from: start, to: end };
}

function buildReport(rows, { groupBy = 'fazenda', from, to, events = [] } = {}) {
  const grouping = GROUPS.includes(groupBy) ? groupBy : 'fazenda';
  const period = resolvePeriod({ from, to });
  const buckets = new Map();
  const overall = emptyBucket('total');

  for (const row of rows) {
    const at = new Date(row.recordedAt);
    if (Number.isNaN(at.getTime()) || at < period.from || at > period.to) continue;
    const key = groupKeyOf(row, grouping);
    if (!buckets.has(key)) buckets.set(key, emptyBucket(key));
    accumulate(buckets.get(key), row);
    accumulate(overall, row);
  }

  for (const event of events) {
    const at = new Date(event.recordedAt);
    if (Number.isNaN(at.getTime()) || at < period.from || at > period.to) continue;
    const key = groupKeyOf(event, grouping);
    // Um grupo pode existir só por causa de eventos, sem telemetria no período.
    if (!buckets.has(key)) buckets.set(key, emptyBucket(key));
    accumulateEvent(buckets.get(key), event);
    accumulateEvent(overall, event);
  }

  const groups = [...buckets.values()]
    .map(finalize)
    // O que exige ação aparece primeiro: mais eventos críticos, depois maior exposição média.
    // Eventos críticos registrados pesam mais que exposição média: são fatos, não médias.
    .sort((a, b) => b.events.critical - a.events.critical
      || b.criticalEvents - a.criticalEvents
      || (b.averageScore ?? -1) - (a.averageScore ?? -1)
      || String(a.key).localeCompare(String(b.key), 'pt-BR'));

  return {
    generatedAt: new Date().toISOString(),
    period: { from: period.from.toISOString(), to: period.to.toISOString() },
    groupBy: grouping,
    summary: finalize(overall),
    groups,
  };
}

module.exports = { GROUPS, EVENT_LABEL, buildReport, resolvePeriod, dayKey };
