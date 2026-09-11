const { calculateOperationalRisk } = require('./risk');

const RISK_PRIORITY = Object.freeze({ ALTO: 3, MEDIO: 2, BAIXO: 1, SEM_SINAL: 0 });

function prepareFleetMachine(machine, now = Date.now()) {
  const lastSeenAt = machine.lastSeenAt || machine.latest?.timestamp || null;
  const ageMs = lastSeenAt ? now - new Date(lastSeenAt).getTime() : Infinity;
  const online = machine.latest?.demo === true || ageMs < 30_000;
  const risk = machine.latest?.risk || (machine.latest ? calculateOperationalRisk(machine.latest) : null);
  return {
    ...machine,
    online,
    risk: online && risk ? risk : {
      score: null, level: 'SEM_SINAL', factors: [{ code: 'offline', label: 'Telemetria indisponível', points: 0 }],
      alerts: ['Verificar conexão e alimentação do equipamento'], evaluatedAt: lastSeenAt,
    },
  };
}

function sortFleet(machines) {
  return [...machines].sort((a, b) =>
    (RISK_PRIORITY[b.risk.level] || 0) - (RISK_PRIORITY[a.risk.level] || 0)
      || (Number(b.risk.score) || 0) - (Number(a.risk.score) || 0)
      || String(a.name).localeCompare(String(b.name), 'pt-BR'));
}

function summarizeFleet(machines) {
  const summary = { total: machines.length, high: 0, medium: 0, low: 0, offline: 0 };
  for (const machine of machines) {
    if (machine.risk.level === 'ALTO') summary.high += 1;
    else if (machine.risk.level === 'MEDIO') summary.medium += 1;
    else if (machine.risk.level === 'BAIXO') summary.low += 1;
    else summary.offline += 1;
  }
  return summary;
}

module.exports = { RISK_PRIORITY, prepareFleetMachine, sortFleet, summarizeFleet };
