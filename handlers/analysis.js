const crypto = require('node:crypto');
const { getLatestTelemetry, listTelemetry, listMachines, getActiveModel, getLatestModel, addAnalysisAuditLog } = require('../lib/db');
const { generateExplanation } = require('../lib/explanation');
const { json, method, deviceId } = require('../lib/http');

module.exports = async (request, response) => {
  if (!method(request, response, ['GET'])) return;
  try {
    const id = deviceId(request);
    const [latest, history, machines, model, latestModel] = await Promise.all([getLatestTelemetry(id), listTelemetry(id, 30), listMachines(), getActiveModel(), getLatestModel()]);
    const machine = machines.find((item) => item.deviceId === id) || { deviceId: id, name: id };
    const analysis = generateExplanation(latest, history, machine, model);
    analysis.governance = latestModel ? {
      latestModelVersion: latestModel.version, status: latestModel.status, algorithm: latestModel.algorithm,
      datasetHash: latestModel.datasetHash, datasetRows: latestModel.datasetRows,
      trainingStartedAt: latestModel.trainingStartedAt, trainingEndedAt: latestModel.trainingEndedAt,
      validationMetrics: latestModel.validationMetrics,
    } : { latestModelVersion: null, status: 'not-trained' };
    const fingerprint = crypto.createHash('sha256').update(`${id}|${latest?.timestamp || 'no-data'}|${analysis.version}|${model?.version || 'no-model'}`).digest('hex');
    await addAnalysisAuditLog(id, {
      fingerprint, explanationVersion: analysis.version, formulaVersion: analysis.source.formulaVersion,
      modelVersion: model?.version || null, modelDatasetHash: model?.datasetHash || null,
      latestEvaluatedModelVersion: latestModel?.version || null, latestModelStatus: latestModel?.status || 'not-trained',
      telemetryTimestamp: latest?.timestamp || null, telemetryFieldsUsed: Object.keys(analysis.audit.telemetry || {}),
      score: analysis.source.score, level: analysis.source.level, dataCompletenessPercent: analysis.quality.completenessPercent,
      advisoryOnly: true,
    });
    json(response, 200, analysis);
  } catch (error) {
    json(response, 500, { error: error.message });
  }
};
