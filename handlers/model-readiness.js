const { getLearningReadiness, getActiveModel, getLatestModel } = require('../lib/db');
const { json, method } = require('../lib/http');

const ANOMALY_TARGET = 'anomalia multivariada por equipamento';
const EVENT_TARGET = 'evento humano confirmado nos próximos 30 minutos';

module.exports = async (request, response) => {
  if (!method(request, response, ['GET'])) return;
  try {
    const [readiness, anomaly, eventModel] = await Promise.all([
      getLearningReadiness(), getActiveModel(ANOMALY_TARGET), getLatestModel(EVENT_TARGET),
    ]);
    const minimums = { positives: 30, negatives: 30, devices: 5 };
    const eligible = readiness.positiveLabels >= minimums.positives && readiness.negativeLabels >= minimums.negatives && readiness.devices >= minimums.devices;
    return json(response, 200, {
      readiness: { ...readiness, minimums, eligibleForSupervisedTraining: eligible },
      anomalyModel: anomaly ? { version: anomaly.version, status: anomaly.status, algorithm: anomaly.algorithm, datasetRows: anomaly.datasetRows, datasetHash: anomaly.datasetHash, metrics: anomaly.validationMetrics, createdAt: anomaly.createdAt } : null,
      eventModel: eventModel ? { version: eventModel.version, status: eventModel.status, algorithm: eventModel.algorithm, datasetRows: eventModel.datasetRows, datasetHash: eventModel.datasetHash, metrics: eventModel.validationMetrics, createdAt: eventModel.createdAt } : null,
      policy: 'Dados demonstrativos são excluídos. Somente rótulos humanos verificados treinam o modelo supervisionado.',
    });
  } catch (error) { return json(response, 500, { error: error.message }); }
};
