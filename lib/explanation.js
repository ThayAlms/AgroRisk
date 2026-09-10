const { calculateOperationalRisk } = require('./risk');
const { predictEscalation } = require('./predictive-model');

const LEVEL_LABEL = Object.freeze({ ALTO: 'alto', MEDIO: 'médio', BAIXO: 'baixo', SEM_SINAL: 'indisponível' });

function present(value, unit = '') {
  return Number.isFinite(Number(value)) && value !== null && value !== '' ? `${Number(value).toFixed(1)}${unit}` : 'sem leitura';
}

function riskFor(reading) {
  return reading?.risk || (reading ? calculateOperationalRisk(reading) : null);
}

function historyContext(history = []) {
  const risks = history.map(riskFor).filter(Boolean);
  const scores = risks.map((risk) => Number(risk.score)).filter(Number.isFinite);
  const attentionCount = risks.filter((risk) => ['ALTO', 'MEDIO'].includes(risk.level)).length;
  if (!scores.length) return { samples: 0, averageScore: null, attentionCount: 0, direction: 'sem histórico' };
  const midpoint = Math.max(1, Math.floor(scores.length / 2));
  const average = (values) => values.reduce((total, value) => total + value, 0) / values.length;
  const before = average(scores.slice(0, midpoint));
  const after = average(scores.slice(midpoint).length ? scores.slice(midpoint) : scores.slice(0, midpoint));
  const delta = after - before;
  return {
    samples: scores.length,
    averageScore: Math.round(average(scores)),
    attentionCount,
    direction: delta >= 8 ? 'em elevação' : delta <= -8 ? 'em redução' : 'estável',
  };
}

function dataQuality(reading = {}) {
  const checks = [
    ['distanceCm', 'distância frontal', reading.distanceCm],
    ['temperatureC', 'temperatura', reading.environment?.temperatureC],
    ['humidityPercent', 'umidade', reading.environment?.humidityPercent],
    ['tilt', 'inclinação', reading.stability?.maximumAngle],
    ['gps', 'localização GPS', reading.gps?.valid ? reading.gps?.latitude : null],
    ['speedKmh', 'velocidade', reading.speedKmh],
  ];
  const missing = checks.filter(([, , value]) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))).map(([field, label]) => ({ field, label }));
  return { completenessPercent: Math.round((checks.length - missing.length) / checks.length * 100), missing };
}

function levelHeadline(level, machineName) {
  if (level === 'ALTO') return `${machineName} exige ação imediata`;
  if (level === 'MEDIO') return `${machineName} requer acompanhamento`;
  if (level === 'BAIXO') return `${machineName} opera com baixa exposição atual`;
  return `${machineName} está sem telemetria suficiente`;
}

function generateExplanation(reading, history = [], machine = {}, model = null) {
  const risk = riskFor(reading);
  const machineName = machine.name || reading?.deviceId || 'Equipamento';
  if (!reading || !risk) {
    return {
      version: 'natural-language-v1', generatedAt: new Date().toISOString(), machine,
      source: { score: null, level: 'SEM_SINAL', evaluatedAt: null, formulaVersion: 'operational-risk-v1' },
      model: { available: false, version: model?.version || null, advisoryOnly: true },
      quality: { completenessPercent: 0, missing: [{ field: 'telemetry', label: 'telemetria' }] },
      audit: { factors: [], telemetry: {} }, history: historyContext(history),
      audiences: {
        broker: { headline: `${machineName} está sem telemetria`, summary: 'Não há dados recentes suficientes para explicar a exposição operacional.', actions: ['Confirmar alimentação e conectividade do equipamento.', 'Evitar comunicar condição segura sem dados atuais.'] },
        underwriter: { headline: 'Exposição não mensurável com os dados atuais', summary: 'A ausência de telemetria impede caracterizar o risco operacional neste momento.', actions: ['Registrar a lacuna de dados.', 'Solicitar restabelecimento da telemetria antes da avaliação.'] },
        claims: { headline: 'Sem evidência telemétrica disponível', summary: 'Não há leitura disponível para apoiar uma reconstrução técnica. A ausência de dados não comprova causa, dinâmica ou cobertura.', actions: ['Preservar logs do gateway e do dispositivo.', 'Registrar o intervalo sem comunicação.'] },
      },
      disclaimer: 'Camada interpretativa. Não altera o score auditável e não determina cobertura, aceitação ou causalidade.',
    };
  }

  const quality = dataQuality(reading);
  const context = historyContext(history);
  const factorLabels = risk.factors.filter((factor) => factor.points > 0).map((factor) => factor.label.toLowerCase());
  const reasons = factorLabels.length ? factorLabels.slice(0, 3).join(', ') : 'ausência de fatores relevantes nas leituras disponíveis';
  const recurrence = context.samples ? `${context.attentionCount} de ${context.samples} leituras recentes ficaram em médio ou alto risco; tendência ${context.direction}.` : 'Ainda não há histórico suficiente para avaliar recorrência.';
  const level = LEVEL_LABEL[risk.level] || String(risk.level).toLowerCase();
  const timestamp = reading.timestamp ? new Date(reading.timestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'horário não informado';
  const evidenceLine = `Score ${risk.score}/100, nível ${level}, sustentado principalmente por ${reasons}.`;
  const prediction = model ? predictEscalation(reading, model) : null;
  const predictionText = prediction
    ? `O modelo ${prediction.modelVersion} estima ${prediction.probabilityPercent}% de probabilidade de escalada para risco alto nas próximas ${prediction.horizonReadings} leituras; este sinal é apenas consultivo.`
    : 'Não há modelo preditivo validado ativo; a interpretação usa somente o score e a telemetria observada.';

  return {
    version: 'natural-language-v1', generatedAt: new Date().toISOString(), machine,
    source: { score: risk.score, level: risk.level, evaluatedAt: risk.evaluatedAt || reading.timestamp, formulaVersion: 'operational-risk-v1' },
    model: prediction ? { available: true, ...prediction } : { available: false, version: null, advisoryOnly: true },
    quality,
    history: context,
    audit: {
      factors: risk.factors,
      alerts: risk.alerts,
      telemetry: {
        timestamp: reading.timestamp || null,
        distanceCm: reading.distanceCm ?? null,
        maximumTiltDegrees: reading.stability?.maximumAngle ?? null,
        temperatureC: reading.environment?.temperatureC ?? null,
        humidityPercent: reading.environment?.humidityPercent ?? null,
        speedKmh: reading.speedKmh ?? null,
        insideGeofence: reading.geofence?.inside ?? null,
        dangerLevel: reading.danger?.level ?? 'unknown',
        buzzer: Boolean(reading.buzzer),
      },
    },
    audiences: {
      broker: {
        headline: levelHeadline(risk.level, machineName),
        summary: `${evidenceLine} ${recurrence} ${predictionText}`,
        actions: risk.level === 'ALTO'
          ? ['Contatar o responsável pela operação e confirmar a ação corretiva.', 'Explicar ao cliente os fatores observados sem prometer cobertura ou resultado.']
          : risk.level === 'MEDIO'
            ? ['Orientar acompanhamento dos fatores destacados.', 'Confirmar se a condição retorna ao nível baixo nas próximas leituras.']
            : ['Manter monitoramento e rotina preventiva.', 'Registrar mudanças relevantes na operação.'],
      },
      underwriter: {
        headline: `Exposição operacional ${level} · ${machineName}`,
        summary: `${evidenceLine} ${recurrence} Completude da telemetria: ${quality.completenessPercent}%. ${predictionText}`,
        actions: ['Considerar recorrência, severidade e qualidade dos dados na revisão técnica.', quality.missing.length ? `Solicitar dados ausentes: ${quality.missing.map((item) => item.label).join(', ')}.` : 'Telemetria essencial disponível para revisão.', 'Não usar esta narrativa isoladamente como decisão de aceitação ou precificação.'],
      },
      claims: {
        headline: `Indícios telemétricos registrados em ${timestamp}`,
        summary: `${evidenceLine} ${predictionText} Os dados descrevem condições observadas pelo equipamento, mas não comprovam isoladamente causa, responsabilidade ou cobertura do evento.`,
        actions: ['Preservar a leitura original, os horários e os logs do dispositivo.', 'Correlacionar os indicadores com vistoria, relato do operador e demais evidências.', 'Verificar calibração e eventuais lacunas dos sensores antes de concluir a análise.'],
      },
    },
    snapshot: `Distância ${present(reading.distanceCm, ' cm')}; inclinação ${present(reading.stability?.maximumAngle, '°')}; temperatura ${present(reading.environment?.temperatureC, ' °C')}; umidade ${present(reading.environment?.humidityPercent, '%')}.`,
    disclaimer: 'Camada interpretativa. Não altera o score auditável e não determina cobertura, aceitação, precificação ou causalidade.',
  };
}

module.exports = { generateExplanation, dataQuality, historyContext };
