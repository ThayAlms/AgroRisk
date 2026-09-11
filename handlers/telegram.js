const { listTelegramRecipients, deleteTelegramRecipient, createTelegramLinkCode } = require('../lib/db');
const { isConfigured, botUsername, deepLink } = require('../lib/telegram');
const { sendTestAlert } = require('../lib/notify');
const { json, method, deviceId, requestOrigin } = require('../lib/http');

module.exports = async (request, response) => {
  if (!method(request, response, ['GET', 'POST', 'DELETE'])) return;
  const id = deviceId(request);

  try {
    if (request.method === 'GET') {
      const recipients = isConfigured() ? await listTelegramRecipients(id) : [];
      return json(response, 200, {
        configured: isConfigured(),
        botUsername: botUsername(),
        deviceId: id,
        operators: recipients.map((recipient) => ({
          chatId: recipient.chatId,
          operatorName: recipient.operatorName,
          username: recipient.username,
          createdAt: recipient.createdAt,
          lastNotifiedAt: recipient.lastNotifiedAt,
        })),
      });
    }

    if (!isConfigured()) return json(response, 503, { error: 'Alertas por Telegram não configurados: defina TELEGRAM_BOT_TOKEN' });

    if (request.method === 'DELETE') {
      const chatId = String(request.query?.chatId || request.body?.chatId || '');
      if (!chatId) return json(response, 400, { error: 'chatId do operador é obrigatório' });
      const recipients = await listTelegramRecipients(id);
      // Impede que uma conta remova o operador vinculado ao equipamento de outra.
      if (!recipients.some((recipient) => recipient.chatId === chatId)) return json(response, 404, { error: 'Operador não vinculado a este equipamento' });
      return json(response, 200, { removed: await deleteTelegramRecipient(chatId) });
    }

    if (request.body?.sendTest) {
      const chatId = String(request.body.chatId || '');
      const recipients = (await listTelegramRecipients(id)).filter((recipient) => !chatId || recipient.chatId === chatId);
      if (!recipients.length) return json(response, 404, { error: 'Nenhum operador vinculado a este equipamento' });
      const outcome = await sendTestAlert(id, recipients, 'telegram', requestOrigin(request));
      return json(response, 200, { test: { attempted: outcome.attempted, delivered: outcome.delivered } });
    }

    const link = await createTelegramLinkCode(id, {
      operatorName: String(request.body?.operatorName || '').slice(0, 120) || null,
      createdBy: request.user?.sub || null,
    });
    return json(response, 201, {
      code: link.code,
      url: deepLink(link.code),
      expiresAt: link.expiresAt,
      instructions: 'Abra o link no celular do operador e toque em INICIAR no Telegram. O código vale uma vinculação e expira em 15 minutos.',
    });
  } catch (error) {
    return json(response, 500, { error: error.message });
  }
};
