const crypto = require('node:crypto');
const { getLatestTelemetry, listTelemetry, listMachines, getActiveModel, getLatestModel, addAnalysisAuditLog } = require('../lib/db');
const { generateExplanation } = require('../lib/explanation');
const { ANOMALY_TARGET, detectAnomaly } = require('../lib/anomaly-model');
const { json, method, deviceId } = require('../lib/http');

module.exports = async (request, response) => {
  if (!method(request, response, ['GET'])) return;
  try {
    const id = deviceId(request);
    const escalationTarget = 'risco ALTO nas próximas 5 leituras';
    const [latest, history, machines, model, latestModel, anomalyModel] = await Promise.all([getLatestTelemetry(id), listTelemetry(id, 30), listMachines(), getActiveModel(escalationTarget), getLatestModel(escalationTarget), getActiveModel(ANOMALY_TARGET)]);
    const machine = machines.find((item) => item.deviceId === id) || { deviceId: id, name: id };
    const analysis = generateExplanation(latest, history, machine, model);
    analysis.anomaly = latest && anomalyModel ? detectAnomaly(latest, id, anomalyModel) : { available: false, reason: 'Detector de anomalias ainda não treinado', advisoryOnly: true };
    if (analysis.anomaly.available) {
      const unusual = analysis.anomaly.unusualFeatures.map((item) => item.label.toLowerCase()).join(', ');
      const sentence = analysis.anomaly.anomalous
        ? ` O detector de anomalias marcou ${analysis.anomaly.score}/100 e encontrou comportamento incomum${unusual ? ` em ${unusual}` : ''}; o sinal exige validação humana.`
        : ` O detector de anomalias marcou ${analysis.anomaly.score}/100, sem desvio relevante do histórico próprio desta máquina.`;
      Object.values(analysis.audiences).forEach((audience) => { audience.summary += sentence; });
    }
    analysis.governance = latestModel ? {
      latestModelVersion: latestModel.version, status: latestModel.status, algorithm: latestModel.algorithm,
      datasetHash: latestModel.datasetHash, datasetRows: latestModel.datasetRows,
      trainingStartedAt: latestModel.trainingStartedAt, trainingEndedAt: latestModel.trainingEndedAt,
      validationMetrics: latestModel.validationMetrics,
    } : { latestModelVersion: null, status: 'not-trained' };
    const fingerprint = crypto.createHash('sha256').update(`${id}|${latest?.timestamp || 'no-data'}|${analysis.version}|${model?.version || 'no-model'}|${anomalyModel?.version || 'no-anomaly'}`).digest('hex');
    await addAnalysisAuditLog(id, {
      fingerprint, explanationVersion: analysis.version, formulaVersion: analysis.source.formulaVersion,
      modelVersion: model?.version || null, modelDatasetHash: model?.datasetHash || null,
      latestEvaluatedModelVersion: latestModel?.version || null, latestModelStatus: latestModel?.status || 'not-trained',
      telemetryTimestamp: latest?.timestamp || null, telemetryFieldsUsed: Object.keys(analysis.audit.telemetry || {}),
      score: analysis.source.score, level: analysis.source.level, dataCompletenessPercent: analysis.quality.completenessPercent,
      advisoryOnly: true,
      anomalyModelVersion: anomalyModel?.version || null, anomalyScore: analysis.anomaly.score ?? null,
      anomalyDetected: analysis.anomaly.anomalous ?? null,
    });
    json(response, 200, analysis);
  } catch (error) {
    json(response, 500, { error: error.message });
  }
};
