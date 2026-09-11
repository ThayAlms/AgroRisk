/* Service worker dos alertas do AgroRisk: recebe o push mesmo com o navegador fechado. */
const FALLBACK = { title: 'AgroRisk', body: 'Nova condição operacional registrada.', url: '/index.html' };

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let alert = FALLBACK;
  try { alert = { ...FALLBACK, ...(event.data ? event.data.json() : {}) }; } catch { /* mantém o texto padrão */ }
  const critical = alert.severity === 'critical';
  event.waitUntil(self.registration.showNotification(alert.title, {
    body: alert.body,
    tag: `agrorisk-${alert.deviceId || 'geral'}`,
    renotify: true,
    requireInteraction: critical,
    vibrate: critical ? [300, 120, 300, 120, 300] : [180],
    icon: '/icons/icon-notification-192.png',
    badge: '/icons/icon-notification-192.png',
    timestamp: alert.timestamp ? new Date(alert.timestamp).getTime() : Date.now(),
    data: { url: alert.url || FALLBACK.url },
    actions: [{ action: 'open', title: 'Abrir painel' }],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || FALLBACK.url, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const open = windows.find((client) => client.url.startsWith(self.location.origin));
    if (open) return open.focus().then(() => open.navigate(target));
    return self.clients.openWindow(target);
  }));
});
