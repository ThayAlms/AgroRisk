const { savePushSubscription, deletePushSubscription, listPushSubscriptions } = require('../lib/db');
const { vapidKeysFromEnvironment } = require('../lib/webpush');
const { sendTestAlert } = require('../lib/notify');
const { json, method, deviceId } = require('../lib/http');

module.exports = async (request, response) => {
  if (!method(request, response, ['GET', 'POST', 'DELETE'])) return;
  const id = deviceId(request);
  const keys = vapidKeysFromEnvironment();

  try {
    if (request.method === 'GET') {
      const subscriptions = keys ? await listPushSubscriptions(id) : [];
      return json(response, 200, {
        configured: Boolean(keys),
        publicKey: keys?.publicKey || null,
        deviceId: id,
        devices: subscriptions.map((subscription) => ({
          endpoint: subscription.endpoint,
          userAgent: subscription.userAgent,
          createdAt: subscription.createdAt,
          lastNotifiedAt: subscription.lastNotifiedAt,
        })),
      });
    }

    if (!keys) return json(response, 503, { error: 'Alertas no celular não configurados: defina VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY' });

    if (request.method === 'DELETE') {
      const endpoint = String(request.query?.endpoint || request.body?.endpoint || '');
      if (!endpoint) return json(response, 400, { error: 'Endpoint da inscrição é obrigatório' });
      const removed = await deletePushSubscription(endpoint);
      return json(response, 200, { removed });
    }

    const subscription = request.body?.subscription || request.body;
    if (!subscription?.endpoint) return json(response, 400, { error: 'Inscrição de push inválida' });
    const saved = await savePushSubscription(id, { ...subscription, userAgent: request.headers['user-agent'] }, request.user);
    const test = request.body?.sendTest ? await sendTestAlert(id, [saved]) : null;
    return json(response, 201, { subscribed: true, deviceId: id, test: test && { delivered: test.delivered, attempted: test.attempted } });
  } catch (error) {
    return json(response, 500, { error: error.message });
  }
};
