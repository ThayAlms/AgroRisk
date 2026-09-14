/* Painel de alertas do operador: Web Push neste aparelho e Telegram por operador. */
(() => {
  const STYLE = `
    .agro-alerts { position: fixed; right: 18px; bottom: 18px; z-index: 9000; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; font-family: inherit; }
    .agro-alerts__toggle { display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 999px; padding: 12px 18px; cursor: pointer;
      background: #c8102e; color: #fff; font-size: 14px; font-weight: 700; box-shadow: 0 10px 24px rgba(10, 18, 32, .28); }
    .agro-alerts__toggle[data-active="true"] { background: #12603a; }
    .agro-alerts__panel { width: min(320px, calc(100vw - 36px)); padding: 16px; border-radius: 14px; background: #fff; color: #16202f;
      box-shadow: 0 18px 44px rgba(10, 18, 32, .26); border: 1px solid rgba(10, 18, 32, .1); }
    .agro-alerts__panel[hidden] { display: none; }
    .agro-alerts__panel h3 { margin: 0 0 4px; font-size: 15px; }
    .agro-alerts__panel p.hint { margin: 0 0 14px; font-size: 12px; line-height: 1.45; color: #5a6678; }
    .agro-alerts__row { padding: 12px 0; border-top: 1px solid rgba(10, 18, 32, .08); }
    .agro-alerts__row:first-of-type { border-top: 0; padding-top: 0; }
    .agro-alerts__row strong { display: block; font-size: 13px; margin-bottom: 2px; }
    .agro-alerts__row small { display: block; font-size: 11px; line-height: 1.4; color: #5a6678; margin-bottom: 8px; }
    .agro-alerts button.action { width: 100%; border: 0; border-radius: 8px; padding: 9px 12px; cursor: pointer; font-size: 13px; font-weight: 600; background: #16202f; color: #fff; }
    .agro-alerts button.action[data-state="on"] { background: #12603a; }
    .agro-alerts button.action[disabled] { opacity: .55; cursor: not-allowed; }
    .agro-alerts a.link { display: block; margin-top: 8px; padding: 9px 12px; border-radius: 8px; background: #229ed9; color: #fff; font-size: 13px; font-weight: 600; text-align: center; text-decoration: none; word-break: break-all; }
    .agro-alerts ul { margin: 8px 0 0; padding: 0; list-style: none; font-size: 12px; color: #16202f; }
    .agro-alerts ul li { display: flex; justify-content: space-between; gap: 8px; padding: 5px 0; }
    .agro-alerts ul li button { border: 0; background: none; color: #c8102e; cursor: pointer; font-size: 11px; font-weight: 600; padding: 0; }
    .agro-alerts__status { margin: 10px 0 0; font-size: 12px; line-height: 1.45; color: #16202f; }
    .agro-alerts__status:empty { display: none; }
    @media (max-width: 640px) { .agro-alerts { right: 12px; left: 12px; bottom: 12px; align-items: stretch; } .agro-alerts__toggle { justify-content: center; } }
    /* O cartão de conta do auth-guard ocupa o mesmo canto: subimos para não cobrir o botão SAIR. */
    body:has(.auth-account) .agro-alerts { bottom: 82px; }
    @media (max-width: 640px) { body:has(.auth-account) .agro-alerts { bottom: 80px; } }
  `;

  const state = { open: false, push: false, telegram: null };

  function currentDeviceId() {
    return new URLSearchParams(location.search).get('deviceId') || document.querySelector('meta[name="device-id"]')?.content || 'colheitadeira-01';
  }

  function api(route, extra = '') {
    return `/api/${route}?deviceId=${encodeURIComponent(currentDeviceId())}${extra}`;
  }

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Falha na requisição (${response.status})`);
    return body;
  }

  function decodeKey(base64url) {
    const padded = `${base64url}${'='.repeat((4 - (base64url.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  }

  const supportsPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  function build() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);

    const root = document.createElement('div');
    root.className = 'agro-alerts';
    root.innerHTML = `
      <section class="agro-alerts__panel" hidden>
        <h3>Alertas de risco</h3>
        <p class="hint">Avisos de risco alto chegam com o motivo e a ação recomendada.</p>
        <div class="agro-alerts__row" data-row="push">
          <strong>Neste aparelho</strong>
          <small>Notificação do navegador, criptografada de ponta a ponta.</small>
          <button class="action" type="button" data-action="push">Ativar</button>
        </div>
        <div class="agro-alerts__row" data-row="telegram">
          <strong>Telegram do operador</strong>
          <small>Gere um link e abra no celular de quem vai operar a máquina.</small>
          <button class="action" type="button" data-action="telegram">Gerar link de vinculação</button>
          <div data-slot="telegram-link"></div>
          <ul data-slot="telegram-list"></ul>
        </div>
        <p class="agro-alerts__status" role="status"></p>
      </section>
      <button class="agro-alerts__toggle" type="button">🔔 Alertas</button>
    `;
    document.body.append(root);
    return {
      root,
      panel: root.querySelector('.agro-alerts__panel'),
      toggle: root.querySelector('.agro-alerts__toggle'),
      pushRow: root.querySelector('[data-row="push"]'),
      pushButton: root.querySelector('[data-action="push"]'),
      telegramRow: root.querySelector('[data-row="telegram"]'),
      telegramButton: root.querySelector('[data-action="telegram"]'),
      telegramLink: root.querySelector('[data-slot="telegram-link"]'),
      telegramList: root.querySelector('[data-slot="telegram-list"]'),
      status: root.querySelector('.agro-alerts__status'),
    };
  }

  function say(ui, message, persist = false) {
    ui.status.textContent = message;
    clearTimeout(ui.timer);
    if (message && !persist) ui.timer = setTimeout(() => { ui.status.textContent = ''; }, 7000);
  }

  function paint(ui) {
    ui.toggle.dataset.active = String(state.push || Boolean(state.telegram?.operators?.length));
    ui.pushButton.dataset.state = state.push ? 'on' : 'off';
    ui.pushButton.textContent = state.push ? 'Ativo — desativar' : 'Ativar';
    ui.pushButton.disabled = false;
    if (!supportsPush) {
      ui.pushButton.disabled = true;
      ui.pushButton.textContent = 'Não suportado neste navegador';
    }

    const telegram = state.telegram;
    ui.telegramRow.hidden = Boolean(telegram && !telegram.configured);
    ui.telegramList.innerHTML = '';
    for (const operator of telegram?.operators || []) {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = operator.operatorName || operator.username || `chat ${operator.chatId}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'remover';
      remove.addEventListener('click', () => unlinkTelegram(ui, operator.chatId));
      item.append(name, remove);
      ui.telegramList.append(item);
    }
  }

  async function currentSubscription() {
    const registration = await navigator.serviceWorker.getRegistration('/sw.js');
    return registration ? registration.pushManager.getSubscription() : null;
  }

  // O aparelho pode ter uma inscrição válida que o servidor não conhece mais
  // (servidor reiniciado, banco trocado, outro ambiente). Sem reconciliar, o botão
  // diria "ativo" e o operador não receberia nada — o pior tipo de falha para um alerta.
  async function reconcilePush() {
    const subscription = await currentSubscription();
    if (!subscription) return false;
    const settings = await request(api('push')).catch(() => null);
    if (!settings?.configured) return false;
    if ((settings.devices || []).some((device) => device.endpoint === subscription.endpoint)) return true;
    await request(api('push'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    }).catch(() => null);
    return true;
  }

  async function enablePush(ui) {
    const settings = await request(api('push'));
    if (!settings.configured) throw new Error('Servidor sem chaves VAPID configuradas.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Permissão de notificação negada no aparelho.');
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription()
      || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(settings.publicKey) });
    await request(api('push'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON(), sendTest: true }),
    });
    state.push = true;
    say(ui, 'Aparelho registrado. Enviamos uma notificação de teste.');
  }

  async function disablePush(ui) {
    const subscription = await currentSubscription();
    if (subscription) {
      await fetch(api('push', `&endpoint=${encodeURIComponent(subscription.endpoint)}`), { method: 'DELETE', credentials: 'same-origin' });
      await subscription.unsubscribe();
    }
    state.push = false;
    say(ui, 'Alertas desativados neste aparelho.');
  }

  async function generateTelegramLink(ui) {
    const link = await request(api('telegram'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    ui.telegramLink.innerHTML = '';
    const anchor = document.createElement('a');
    anchor.className = 'link';
    anchor.href = link.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener';
    anchor.textContent = 'Abrir no Telegram e tocar em INICIAR';
    ui.telegramLink.append(anchor);
    say(ui, 'O link vale uma vinculação e expira em 15 minutos. Abra no celular do operador.', true);
    // A vinculação acontece fora desta aba: consulta a lista por alguns instantes para refletir o resultado.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      state.telegram = await request(api('telegram')).catch(() => state.telegram);
      paint(ui);
      if (state.telegram?.operators?.length) {
        ui.telegramLink.innerHTML = '';
        say(ui, 'Operador vinculado. Ele já recebe os alertas deste equipamento.');
        return;
      }
    }
  }

  async function unlinkTelegram(ui, chatId) {
    await request(api('telegram', `&chatId=${encodeURIComponent(chatId)}`), { method: 'DELETE' });
    state.telegram = await request(api('telegram'));
    paint(ui);
    say(ui, 'Operador removido dos alertas.');
  }

  async function guard(ui, action) {
    ui.pushButton.disabled = true;
    ui.telegramButton.disabled = true;
    try {
      await action();
    } catch (error) {
      say(ui, error.message);
    } finally {
      ui.telegramButton.disabled = false;
      paint(ui);
    }
  }

  // Reserva para navegador sem suporte a :has() — mede o cartão de conta e afasta o painel.
  function afastarDoCartaoDeConta(ui) {
    if (CSS.supports?.('selector(body:has(a))')) return;
    const ajustar = () => {
      const conta = document.querySelector('.auth-account');
      ui.root.style.bottom = conta ? `${Math.round(conta.getBoundingClientRect().height) + 28}px` : '';
    };
    ajustar();
    setTimeout(ajustar, 1200);
  }

  async function start() {
    const ui = build();
    afastarDoCartaoDeConta(ui);

    ui.toggle.addEventListener('click', async () => {
      state.open = !state.open;
      ui.panel.hidden = !state.open;
      if (!state.open) return;
      const [telegramSettings, pushActive] = await Promise.all([
        request(api('telegram')).catch(() => ({ configured: false, operators: [] })),
        supportsPush ? reconcilePush().catch(() => false) : false,
      ]);
      state.telegram = telegramSettings;
      state.push = pushActive;
      paint(ui);
    });

    ui.pushButton.addEventListener('click', () => guard(ui, () => (state.push ? disablePush(ui) : enablePush(ui))));
    ui.telegramButton.addEventListener('click', () => guard(ui, () => generateTelegramLink(ui)));

    if (supportsPush) state.push = await reconcilePush();
    paint(ui);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
