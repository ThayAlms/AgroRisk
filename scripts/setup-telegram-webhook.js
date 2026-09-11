/* Registra (ou consulta) o webhook do bot no Telegram.
   Uso: node --env-file-if-exists=.env.local scripts/setup-telegram-webhook.js [--info|--delete] */
const { callApi, isConfigured, botToken } = require('../lib/telegram');

async function main() {
  if (!isConfigured()) {
    console.error('TELEGRAM_BOT_TOKEN não configurado. Crie o bot no @BotFather e defina a variável.');
    process.exit(1);
  }

  const mode = process.argv[2] || '--set';

  if (mode === '--info') {
    const info = await callApi('getWebhookInfo', {});
    console.log(JSON.stringify(info.body?.result || info, null, 2));
    return;
  }

  if (mode === '--delete') {
    const result = await callApi('deleteWebhook', { drop_pending_updates: true });
    console.log(result.ok ? 'Webhook removido.' : `Falha: ${result.error}`);
    return;
  }

  const base = process.env.PUBLIC_APP_URL || process.env.CLOUD_API_URL;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!base) { console.error('Defina PUBLIC_APP_URL (ex.: https://agrorisk-sompo.vercel.app).'); process.exit(1); }
  if (!secret) { console.error('Defina TELEGRAM_WEBHOOK_SECRET com um valor longo e aleatório.'); process.exit(1); }

  const url = new URL('/api/telegram-webhook', base).href;
  const result = await callApi('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  });

  if (!result.ok) { console.error(`Falha ao registrar o webhook: ${result.error}`); process.exit(1); }
  console.log(`Webhook registrado em ${url}`);
  console.log(`Bot: ...${String(botToken()).slice(-6)} · atualizações aceitas: message`);
}

main().catch((error) => { console.error(error.message); process.exit(1); });
