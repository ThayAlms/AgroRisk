const { listTelemetryForReport, listSafetyLogsForReport } = require('../lib/db');
const { buildReport, resolvePeriod, GROUPS } = require('../lib/reports');
const { json, method } = require('../lib/http');

const GROUP_LABEL = Object.freeze({ fazenda: 'Fazenda', regiao: 'Região', equipamento: 'Equipamento', dia: 'Dia' });

function csvCell(value) {
  const normalized = typeof value === 'number' && Number.isFinite(value) ? String(value).replace('.', ',')
    : value == null ? '' : String(value);
  return `"${normalized.replaceAll('"', '""')}"`;
}

function toCsv(report) {
  const header = [
    GROUP_LABEL[report.groupBy] || 'Grupo', 'Leituras', 'Equipamentos', 'Score medio', 'Score maximo',
    'Risco alto (%)', 'Em atencao (%)', 'Leituras alto', 'Leituras medio', 'Leituras baixo', 'Sem sinal',
    'Eventos', 'Eventos criticos', 'Eventos atencao', 'Tipos de evento',
    'Primeira leitura', 'Ultima leitura', 'Fatores predominantes',
  ];
  const lines = report.groups.map((group) => [
    group.key, group.readings, group.devices, group.averageScore, group.maximumScore,
    group.highRiskShare, group.attentionShare,
    group.levels.ALTO, group.levels.MEDIO, group.levels.BAIXO, group.levels.SEM_SINAL,
    group.events.total, group.events.critical, group.events.warning,
    group.events.byType.map((item) => `${item.label} (${item.occurrences}x)`).join(' | '),
    group.firstReadingAt, group.lastReadingAt,
    group.topFactors.map((factor) => `${factor.label} (${factor.occurrences}x)`).join(' | '),
  ]);
  return [header, ...lines].map((row) => row.map(csvCell).join(';')).join('\r\n');
}

module.exports = async (request, response) => {
  if (!method(request, response, ['GET'])) return;
  try {
    const groupBy = String(request.query?.groupBy || 'fazenda');
    const from = request.query?.from || null;
    const to = request.query?.to || null;
    const requestedDevice = request.query?.deviceId ? String(request.query.deviceId).slice(0, 80) : null;
    // O perfil farmer enxerga apenas a própria carteira; o perfil sompo enxerga todas.
    const customerId = request.user?.role === 'sompo' ? (request.query?.customerId || null) : (request.user?.customerId || null);

    const period = resolvePeriod({ from, to });
    const escopo = { from: period.from, to: period.to, customerId, deviceId: requestedDevice };
    const [rows, events] = await Promise.all([listTelemetryForReport(escopo), listSafetyLogsForReport(escopo)]);
    const report = buildReport(rows, { groupBy, from: period.from.toISOString(), to: period.to.toISOString(), events });
    report.scope = { customerId, deviceId: requestedDevice, role: request.user?.role || null };
    report.available = { groups: GROUPS };

    if (String(request.query?.format || '').toLowerCase() === 'csv') {
      const stamp = period.from.toISOString().slice(0, 10);
      response.status(200);
      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Disposition', `attachment; filename="agrorisk-relatorio-${report.groupBy}-${stamp}.csv"`);
      return response.end(`﻿${toCsv(report)}`);
    }

    return json(response, 200, report);
  } catch (error) {
    return json(response, 500, { error: error.message });
  }
};
