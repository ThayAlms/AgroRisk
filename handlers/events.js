const { saveEventLabel, listEventLabels, reviewEventLabel, addSafetyLog } = require('../lib/db');
const { json, method } = require('../lib/http');

module.exports = async (request, response) => {
  try {
    if (request.method === 'GET') return json(response, 200, await listEventLabels(request.user, request.query?.limit));
    if (request.method === 'POST') {
      const event = await saveEventLabel(request.user, request.body || {});
      await addSafetyLog(event.deviceId, 'info', 'event-label', 'Ocorrência registrada para aprendizado', { eventLabelId: event.id, outcome: event.outcome, source: event.source, verificationStatus: event.verificationStatus, reportedBy: request.user.email });
      return json(response, 201, event);
    }
    if (request.method === 'PUT') {
      const event = await reviewEventLabel(request.user, String(request.body?.id || ''), request.body?.decision, request.body?.outcome);
      if (!event) return json(response, 404, { error: 'Ocorrência não encontrada' });
      await addSafetyLog(event.deviceId, 'info', 'event-label-review', 'Rótulo revisado pela Sompo', { eventLabelId: event.id, decision: event.verificationStatus, outcome: event.outcome, verifiedBy: request.user.email });
      return json(response, 200, event);
    }
    return method(request, response, ['GET', 'POST', 'PUT']);
  } catch (error) {
    return json(response, /fora da conta|Somente/.test(error.message) ? 403 : 400, { error: error.message });
  }
};
