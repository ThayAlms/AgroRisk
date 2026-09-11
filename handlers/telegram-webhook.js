const { consumeTelegramLinkCode, saveTelegramRecipient, deleteTelegramRecipient, listTelegramRecipients } = require('../lib/db');
const { isConfigured, sendPlainMessage, escapeHtml } = require('../lib/telegram');
const { json, method } = require('../lib/http');

// O Telegram repete a entrega de qualquer atualização que não receba 200, então esta rota
// responde 200 mesmo quando ignora a mensagem: só um 200 encerra a fila do lado deles.
function acknowledge(response, detail) {
  return json(response, 200, { ok: true, ...detail });
}

function authorized(request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return false;
  return request.headers['x-telegram-bot-api-secret-token'] === expected;
}

function profileOf(message) {
  const from = message.from || {};
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ');
  return { operatorName: name || from.username || null, username: from.username || null };
}

module.exports = async (request, response) => {
  if (!method(request, response, ['POST'])) return;
  if (!isConfigured()) return json(response, 503, { error: 'Telegram não configurado' });
  // Sem o segredo compartilhado a requisição não veio do Telegram: aqui a resposta é 401 mesmo,
  // porque não existe atualização legítima a confirmar.
  if (!authorized(request)) return json(response, 401, { error: 'Origem não autorizada' });

  try {
    const message = request.body?.message || request.body?.edited_message;
    const chatId = message?.chat?.id;
    const text = String(message?.text || '').trim();
    if (!chatId || !text) return acknowledge(response, { ignored: 'sem-mensagem' });

    if (/^\/parar|^\/stop/i.test(text)) {
      const removed = await deleteTelegramRecipient(chatId);
      await sendPlainMessage(chatId, removed
        ? 'Alertas do AgroRisk desativados neste aparelho. Para voltar a receber, peça um novo link no painel.'
        : 'Este aparelho não estava recebendo alertas do AgroRisk.');
      return acknowledge(response, { unlinked: removed });
    }

    const start = text.match(/^\/start(?:@\w+)?\s+(\S+)/i);
    if (!start) {
      await sendPlainMessage(chatId, 'Para receber os alertas do AgroRisk, use o link de vinculação gerado no painel do equipamento.');
      return acknowledge(response, { ignored: 'sem-codigo' });
    }

    const link = await consumeTelegramLinkCode(start[1]);
    if (!link) {
      await sendPlainMessage(chatId, 'Este link de vinculação já foi usado ou expirou. Peça um novo no painel do AgroRisk.');
      return acknowledge(response, { ignored: 'codigo-invalido' });
    }

    const profile = profileOf(message);
    await saveTelegramRecipient(link.deviceId, chatId, {
      operatorName: link.operatorName || profile.operatorName,
      username: profile.username,
      linkedBy: link.createdBy,
    });
    await sendPlainMessage(chatId, [
      `<b>✅ Alertas ativados</b> para <b>${escapeHtml(link.deviceId)}</b>.`,
      '',
      'Você receberá aviso quando o risco da máquina subir, com o motivo e a ação recomendada.',
      'Para parar a qualquer momento, envie /parar.',
    ].join('\n'));

    const recipients = await listTelegramRecipients(link.deviceId);
    return acknowledge(response, { linked: true, deviceId: link.deviceId, operators: recipients.length });
  } catch (error) {
    return json(response, 500, { error: error.message });
  }
};
