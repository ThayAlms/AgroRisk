const API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';

function botToken() {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

function isConfigured() {
  return Boolean(botToken());
}

function botUsername() {
  return process.env.TELEGRAM_BOT_USERNAME || null;
}

// O Telegram interpreta HTML no corpo da mensagem: escapar evita que o nome de uma
// fazenda com "&" ou "<" quebre a formatação ou injete marcação.
function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function callApi(method, payload) {
  const token = botToken();
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN não configurado' };
  try {
    const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok && body.ok !== false, status: response.status, body, error: body.description || null };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  }
}

function formatAlert(alert) {
  const lines = [`<b>${escapeHtml(alert.title)}</b>`, escapeHtml(alert.body)];
  if (alert.timestamp) {
    lines.push(`\n<i>${escapeHtml(new Date(alert.timestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}</i>`);
  }
  return lines.join('\n');
}

function panelUrl(alert) {
  const base = process.env.PUBLIC_APP_URL || process.env.CLOUD_API_URL;
  if (!base || !alert.url) return null;
  try { return new URL(alert.url, base).href; } catch { return null; }
}

async function sendAlert(recipient, alert) {
  const url = panelUrl(alert);
  const result = await callApi('sendMessage', {
    chat_id: recipient.chatId,
    text: formatAlert(alert),
    parse_mode: 'HTML',
    disable_notification: alert.severity === 'info',
    ...(url ? { reply_markup: { inline_keyboard: [[{ text: 'Abrir painel', url }]] } } : {}),
  });
  // 403 = operador bloqueou o bot; 400 com "chat not found" = conversa apagada.
  const blocked = result.status === 403 || /chat not found|bot was blocked|user is deactivated/i.test(result.error || '');
  return { delivered: result.ok, status: result.status || 0, expired: blocked, error: result.ok ? null : result.error };
}

async function sendPlainMessage(chatId, text) {
  return callApi('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}

function deepLink(code) {
  const username = botUsername();
  return username ? `https://t.me/${username}?start=${encodeURIComponent(code)}` : null;
}

module.exports = { isConfigured, botUsername, botToken, escapeHtml, formatAlert, sendAlert, sendPlainMessage, deepLink, callApi };
