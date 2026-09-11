/* Canal Telegram sem banco e sem rede externa: a API do bot é simulada localmente. */
const assert = require('node:assert');
const http = require('node:http');

delete process.env.DATABASE_URL;
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
process.env.TELEGRAM_BOT_TOKEN = '123456:token-de-teste';
process.env.TELEGRAM_BOT_USERNAME = 'AgroRiskTesteBot';
process.env.TELEGRAM_WEBHOOK_SECRET = 'segredo-do-webhook';
process.env.PUBLIC_APP_URL = 'https://agrorisk-sompo.vercel.app';
process.env.PUSH_COOLDOWN_MINUTES = '5';

const sent = [];
let blockedByOperator = false;

const invoke = (handler, request) => new Promise((resolve) => {
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    setHeader() { return this; },
    json(payload) { resolve({ status: this.statusCode, body: payload }); },
    end(payload) { resolve({ status: this.statusCode, body: payload }); },
  };
  handler({ headers: {}, query: {}, body: {}, ...request }, response);
});

async function main() {
  const botApi = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      sent.push({ url: request.url, payload });
      response.setHeader('Content-Type', 'application/json');
      if (blockedByOperator) return response.writeHead(403).end(JSON.stringify({ ok: false, description: 'Forbidden: bot was blocked by the user' }));
      response.writeHead(200).end(JSON.stringify({ ok: true, result: { message_id: sent.length } }));
    });
  });
  await new Promise((resolve) => botApi.listen(0, resolve));
  process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${botApi.address().port}`;

  const telegramHandler = require('../handlers/telegram');
  const webhook = require('../handlers/telegram-webhook');
  const telemetry = require('../handlers/telemetry');
  const { listTelegramRecipients } = require('../lib/db');
  const { notifyOperators } = require('../lib/notify');
  const { escapeHtml, formatAlert } = require('../lib/telegram');

  // 1. O painel gera um link de vinculação de uso único.
  const created = await invoke(telegramHandler, { method: 'POST', query: { deviceId: 'colheitadeira-01' }, body: { operatorName: 'João da Silva' }, user: { sub: 'user-farmer-demo' } });
  assert.strictEqual(created.status, 201);
  assert.match(created.body.url, /^https:\/\/t\.me\/AgroRiskTesteBot\?start=/);
  const code = created.body.code;

  // 2. O webhook exige o segredo compartilhado com o Telegram.
  const forged = await invoke(webhook, { method: 'POST', headers: {}, body: { message: { chat: { id: 999 }, text: `/start ${code}` } } });
  assert.strictEqual(forged.status, 401, 'webhook sem segredo deveria ser recusado');

  const authorized = { 'x-telegram-bot-api-secret-token': 'segredo-do-webhook' };

  // 3. /start com o código vincula o operador ao equipamento.
  const linked = await invoke(webhook, { method: 'POST', headers: authorized, body: { message: { chat: { id: 555001 }, text: `/start ${code}`, from: { first_name: 'João', last_name: 'Silva', username: 'joaosilva' } } } });
  assert.strictEqual(linked.status, 200);
  assert.strictEqual(linked.body.linked, true);
  const operators = await listTelegramRecipients('colheitadeira-01');
  assert.strictEqual(operators.length, 1);
  assert.strictEqual(operators[0].chatId, '555001');
  assert.strictEqual(operators[0].operatorName, 'João da Silva', 'o nome informado no painel tem precedência sobre o do perfil');

  // 4. O mesmo código não vincula um segundo aparelho.
  const replay = await invoke(webhook, { method: 'POST', headers: authorized, body: { message: { chat: { id: 555002 }, text: `/start ${code}`, from: { first_name: 'Outro' } } } });
  assert.strictEqual(replay.body.ignored, 'codigo-invalido', 'código de uso único não pode ser reutilizado');
  assert.strictEqual((await listTelegramRecipients('colheitadeira-01')).length, 1);

  // 5. Telemetria crítica alcança o operador pelo Telegram.
  const critical = {
    method: 'POST', headers: {}, query: { deviceId: 'colheitadeira-01' },
    body: { distanceCm: 8, temperatureC: 41, humidityPercent: 30, speedKmh: 12, acceleration: { x: 8.2, y: 1.1, z: 3.4 }, gps: { latitude: -23.5632, longitude: -46.6541 } },
  };
  sent.length = 0;
  const ingest = await invoke(telemetry, critical);
  assert.strictEqual(ingest.status, 201);
  assert.strictEqual(ingest.body.push.channels.telegram.delivered, 1, `Telegram não entregou: ${JSON.stringify(ingest.body.push.channels.telegram)}`);
  assert.strictEqual(ingest.body.push.channels.push.skipped, 'not-configured', 'sem VAPID o push apenas se declara indisponível');
  const message = sent.at(-1);
  assert.match(message.url, /\/bot123456:token-de-teste\/sendMessage$/);
  assert.strictEqual(String(message.payload.chat_id), '555001');
  assert.strictEqual(message.payload.parse_mode, 'HTML');
  assert.match(message.payload.text, /Risco alto/);
  assert.strictEqual(message.payload.reply_markup.inline_keyboard[0][0].url, 'https://agrorisk-sompo.vercel.app/index.html?deviceId=colheitadeira-01');

  // 5b. O endereço observado na requisição vence PUBLIC_APP_URL: o link precisa
  // apontar para onde o sistema está sendo acessado de fato (preview, túnel, produção).
  // Um operador recém-vinculado escapa da janela de silêncio do primeiro.
  const outro = await invoke(telegramHandler, { method: 'POST', query: { deviceId: 'colheitadeira-01' }, body: {}, user: { sub: 'user-farmer-demo' } });
  await invoke(webhook, { method: 'POST', headers: authorized, body: { message: { chat: { id: 555007 }, text: `/start ${outro.body.code}`, from: { first_name: 'Ana' } } } });
  sent.length = 0;
  await invoke(telemetry, { ...critical, headers: { 'x-forwarded-host': 'tunel-de-teste.exemplo', 'x-forwarded-proto': 'https' }, body: { ...critical.body, distanceCm: 4 } });
  const routed = sent.find((item) => String(item.payload.chat_id) === '555007');
  assert.ok(routed, 'o operador recém-vinculado deveria receber o alerta em curso');
  assert.strictEqual(routed.payload.reply_markup.inline_keyboard[0][0].url, 'https://tunel-de-teste.exemplo/index.html?deviceId=colheitadeira-01');
  await invoke(telegramHandler, { method: 'DELETE', query: { deviceId: 'colheitadeira-01', chatId: '555007' } });

  // 6. A mesma regra de silêncio vale para o canal novo.
  sent.length = 0;
  const repeated = await invoke(telemetry, critical);
  assert.strictEqual(repeated.body.push.channels.telegram.skipped, 'cooldown');
  assert.strictEqual(sent.length, 0, 'nenhuma mensagem deveria ser enviada dentro da janela de silêncio');

  // 7. Nome de fazenda com HTML não quebra a formatação da mensagem.
  assert.strictEqual(escapeHtml('Santa & Helena <MT>'), 'Santa &amp; Helena &lt;MT&gt;');
  assert.ok(!formatAlert({ title: '<script>x</script>', body: 'ok' }).includes('<script>'), 'HTML do título precisa ser escapado');

  // 8. Operador que bloqueia o bot sai da lista sozinho.
  blockedByOperator = true;
  const afterBlock = await notifyOperators('colheitadeira-01', { risk: { score: 5, level: 'BAIXO', factors: [] }, geofence: { inside: true } });
  assert.strictEqual(afterBlock.alert.severity, 'info');
  assert.strictEqual(afterBlock.channels.telegram.removed, 1, 'bot bloqueado deveria remover o destinatário');
  assert.strictEqual((await listTelegramRecipients('colheitadeira-01')).length, 0);
  blockedByOperator = false;

  // 9. /parar remove a vinculação a pedido do operador.
  const second = await invoke(telegramHandler, { method: 'POST', query: { deviceId: 'colheitadeira-01' }, body: {}, user: { sub: 'user-farmer-demo' } });
  await invoke(webhook, { method: 'POST', headers: authorized, body: { message: { chat: { id: 555003 }, text: `/start ${second.body.code}`, from: { first_name: 'Maria' } } } });
  assert.strictEqual((await listTelegramRecipients('colheitadeira-01')).length, 1);
  const stopped = await invoke(webhook, { method: 'POST', headers: authorized, body: { message: { chat: { id: 555003 }, text: '/parar' } } });
  assert.strictEqual(stopped.body.unlinked, true);
  assert.strictEqual((await listTelegramRecipients('colheitadeira-01')).length, 0);

  botApi.close();
  console.log('✅ test-telegram: vinculação de uso único, webhook autenticado, alerta crítico, silêncio, escape de HTML e descadastro aprovados');
}

main().catch((error) => { console.error('❌', error.message); process.exit(1); });
