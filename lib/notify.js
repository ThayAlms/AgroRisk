const {
  listPushSubscriptions, deletePushSubscription, markPushDelivered,
  listTelegramRecipients, deleteTelegramRecipient, markTelegramDelivered,
} = require('./db');
const { sendNotification, vapidKeysFromEnvironment } = require('./webpush');
const telegram = require('./telegram');

const COOLDOWN_MINUTES = Number(process.env.PUSH_COOLDOWN_MINUTES || 5);
const SEVERITY_RANK = Object.freeze({ info: 0, warning: 1, critical: 2 });

function urgencyOf(reading) {
  const tiltCritical = reading?.stability?.level === 'critical';
  const dangerCritical = reading?.danger?.level === 'critical';
  const outsideGeofence = reading?.geofence?.inside === false;
  const level = reading?.risk?.level;
  if (level === 'ALTO' || tiltCritical || dangerCritical) return 'critical';
  if (level === 'MEDIO' || reading?.danger?.level === 'warning' || outsideGeofence || reading?.alerts?.obstacle) return 'warning';
  return 'info';
}

function reasonLine(reading) {
  const factors = (reading?.risk?.factors || []).filter((factor) => factor.points > 0);
  if (factors.length) return factors.slice(0, 3).map((factor) => factor.label).join(' · ');
  if (reading?.geofence?.inside === false) return 'Fora da área operacional segura';
  return 'Condição operacional monitorada';
}

function actionLine(reading) {
  if (reading?.stability?.level === 'critical') return 'Pare e nivele a máquina antes de seguir.';
  if (reading?.danger?.level === 'critical') return 'Afaste-se da zona perigosa imediatamente.';
  if (reading?.alerts?.obstacle) return 'Obstáculo próximo: reduza a velocidade.';
  if (reading?.geofence?.inside === false) return 'Retorne à área operacional autorizada.';
  return 'Acompanhe o painel e confirme a condição.';
}

function buildAlert(deviceId, reading, machineName, baseUrl = null) {
  const severity = urgencyOf(reading);
  const name = machineName || deviceId;
  const score = Number.isFinite(Number(reading?.risk?.score)) ? `${reading.risk.score}/100` : 'sem score';
  const title = severity === 'critical' ? `🚨 Risco alto · ${name}` : severity === 'warning' ? `⚠️ Atenção · ${name}` : `✅ Normalizado · ${name}`;
  return {
    severity,
    title,
    body: `${reasonLine(reading)} — score ${score}. ${actionLine(reading)}`,
    deviceId,
    score: reading?.risk?.score ?? null,
    level: reading?.risk?.level ?? null,
    timestamp: reading?.timestamp || new Date().toISOString(),
    url: `/index.html?deviceId=${encodeURIComponent(deviceId)}`,
    baseUrl: baseUrl || null,
  };
}

// Cada canal de entrega expõe a mesma interface, então a decisão de risco é tomada
// uma única vez e o transporte deixa de ser preocupação de quem avalia a telemetria.
const CHANNELS = Object.freeze({
  push: {
    label: 'Web Push',
    isConfigured: () => Boolean(vapidKeysFromEnvironment()),
    list: (deviceId) => listPushSubscriptions(deviceId),
    identify: (recipient) => recipient.endpoint,
    send: (recipient, alert) => sendNotification(recipient, alert, { urgency: alert.severity === 'critical' ? 'high' : 'normal' }),
    forget: (recipient) => deletePushSubscription(recipient.endpoint),
    remember: (recipient, severity) => markPushDelivered(recipient.endpoint, severity),
  },
  telegram: {
    label: 'Telegram',
    isConfigured: () => telegram.isConfigured(),
    list: (deviceId) => listTelegramRecipients(deviceId),
    identify: (recipient) => recipient.chatId,
    send: (recipient, alert) => telegram.sendAlert(recipient, alert),
    forget: (recipient) => deleteTelegramRecipient(recipient.chatId),
    remember: (recipient, severity) => markTelegramDelivered(recipient.chatId, severity),
  },
});

// Só interrompe o operador quando a condição piora ou quando persiste além do período de silêncio,
// para o alerta continuar significando alguma coisa depois de uma hora de colheita.
// O estado é por destinatário: quem acabou de vincular o Telegram recebe o alerta em curso
// mesmo que o aparelho com push já tenha sido avisado.
function shouldNotifyRecipient(recipient, alert) {
  if (alert.severity === 'info') return Boolean(recipient.lastSeverity) && recipient.lastSeverity !== 'info';
  const previousRank = SEVERITY_RANK[recipient.lastSeverity] ?? -1;
  if (SEVERITY_RANK[alert.severity] > previousRank) return true;
  const lastAt = recipient.lastNotifiedAt ? new Date(recipient.lastNotifiedAt).getTime() : 0;
  return Date.now() - lastAt >= COOLDOWN_MINUTES * 60_000;
}

async function deliverThrough(channel, recipients, alert, { track = true } = {}) {
  const results = await Promise.all(recipients.map(async (recipient) => {
    const result = await channel.send(recipient, alert);
    if (result.expired) await channel.forget(recipient);
    else if (result.delivered && track) await channel.remember(recipient, alert.severity);
    return { recipient: channel.identify(recipient), ...result };
  }));
  return {
    attempted: results.length,
    delivered: results.filter((result) => result.delivered).length,
    removed: results.filter((result) => result.expired).length,
    results,
  };
}

async function notifyChannel(name, deviceId, alert) {
  const channel = CHANNELS[name];
  const empty = { attempted: 0, delivered: 0, removed: 0, results: [] };
  if (!channel.isConfigured()) return { ...empty, skipped: 'not-configured' };
  const recipients = await channel.list(deviceId);
  if (!recipients.length) return { ...empty, skipped: 'no-recipients' };
  const targets = recipients.filter((recipient) => shouldNotifyRecipient(recipient, alert));
  if (!targets.length) return { ...empty, skipped: 'cooldown' };
  return deliverThrough(channel, targets, alert);
}

async function notifyOperators(deviceId, reading, machineName = null, { baseUrl = null } = {}) {
  const alert = buildAlert(deviceId, reading, machineName, baseUrl);
  const names = Object.keys(CHANNELS);
  // Um canal indisponível não pode impedir a entrega pelo outro.
  const outcomes = await Promise.all(names.map((name) => notifyChannel(name, deviceId, alert)
    .catch((error) => ({ attempted: 0, delivered: 0, removed: 0, results: [], skipped: error.message }))));
  const channels = Object.fromEntries(names.map((name, index) => [name, outcomes[index]]));
  const sent = outcomes.reduce((total, outcome) => total + outcome.delivered, 0);
  const skipped = sent ? null : [...new Set(outcomes.map((outcome) => outcome.skipped).filter(Boolean))].join('/') || null;
  return {
    sent,
    attempted: outcomes.reduce((total, outcome) => total + outcome.attempted, 0),
    removed: outcomes.reduce((total, outcome) => total + outcome.removed, 0),
    ...(skipped ? { skipped } : {}),
    channels,
    alert,
  };
}

function testAlert(deviceId, channelLabel, baseUrl = null) {
  return {
    severity: 'warning',
    title: '🔔 AgroRisk · teste de alerta',
    body: `Alertas ativados por ${channelLabel}. Você receberá avisos de risco alto em tempo real.`,
    deviceId,
    timestamp: new Date().toISOString(),
    url: `/index.html?deviceId=${encodeURIComponent(deviceId)}`,
    baseUrl: baseUrl || null,
  };
}

// O teste não consome a janela de silêncio: ele não pode atrasar o primeiro alerta real.
async function sendTestAlert(deviceId, recipients, channelName = 'push', baseUrl = null) {
  const channel = CHANNELS[channelName];
  return deliverThrough(channel, recipients, testAlert(deviceId, channel.label, baseUrl), { track: false });
}

module.exports = {
  notifyOperators, sendTestAlert, buildAlert, urgencyOf, shouldNotifyRecipient,
  shouldNotifySubscription: shouldNotifyRecipient, CHANNELS,
};
