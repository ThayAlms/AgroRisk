# Alertas no celular do operador

Atende à sugestão da Sompo na apresentação de 26/08/2026: levar o alerta de risco
para fora da cabine, no aparelho de quem opera a máquina.

O alerta sai por **dois canais independentes**, e o operador pode usar um, outro
ou os dois:

| Canal | Para quem | Vantagem | Limitação |
|---|---|---|---|
| **Web Push** | o aparelho que abriu o painel | criptografado de ponta a ponta; o intermediário não lê o conteúdo | exige permissão do navegador; no iPhone só funciona com o site instalado na tela inicial |
| **Telegram** | um operador por vez, na conversa dele com o bot | zero fricção, chega em celular e desktop, dispensa permissão | a mensagem trafega pelos servidores do Telegram, que **não** é ponta a ponta em chats comuns |

> A escolha de canal tem consequência de privacidade. A mensagem carrega
> identificação do equipamento, condição operacional e o link do painel — dados
> de um cliente segurado. O Web Push é o canal adequado quando isso importa; o
> Telegram é conveniência operacional. Por isso os dois coexistem em vez de um
> substituir o outro.

## Arquitetura

```
ESP32 → gateway → POST /api/telemetry → motor de risco (lib/risk.js)
                                     → lib/notify.js   decide UMA vez o que merece interromper
                                          ├── canal push     → lib/webpush.js  → push service → navegador
                                          └── canal telegram → lib/telegram.js → Bot API      → conversa
```

`lib/notify.js` define os canais como objetos com a mesma interface
(`list`, `send`, `forget`, `remember`), então a regra de severidade e de silêncio
é escrita uma vez só e vale para os dois. Acrescentar um terceiro canal —
WhatsApp Business, e-mail, SMS — é registrar mais uma entrada em `CHANNELS`.

Os canais são disparados **em paralelo e isolados**: um canal fora do ar não
impede a entrega pelo outro, e nenhum dos dois pode derrubar a ingestão de
telemetria.

## Quando o operador é interrompido

| Severidade | Condição | Web Push | Telegram |
|---|---|---|---|
| `critical` | risco ALTO, inclinação crítica ou zona perigosa crítica | vibração longa, fica na tela até ser tocada, `Urgency: high` | mensagem com notificação sonora |
| `warning` | risco MÉDIO, obstáculo próximo, aproximação de zona ou fora do geofence | notificação comum | mensagem comum |
| `info` | condição normalizada após um alerta | só para quem recebeu o alerta anterior | enviada em silêncio (`disable_notification`) |

Um alerta só é disparado quando a condição **piora** em relação ao último aviso
*daquele destinatário* ou quando **persiste** além de `PUSH_COOLDOWN_MINUTES`
(padrão: 5). Sem essa regra, uma hora de colheita em terreno inclinado
transformaria a notificação em ruído — e alerta ignorado não previne sinistro.

O controle é por destinatário, não global: um operador que vincula o Telegram no
meio de uma ocorrência recebe o alerta em curso mesmo que o aparelho com push já
tenha sido avisado.

Destinatários que não existem mais somem sozinhos: inscrição de push descartada
pelo navegador (HTTP 404/410) e operador que bloqueou o bot (HTTP 403 ou
`chat not found`) são removidos do banco na primeira tentativa de entrega.

---

# Canal 1 — Web Push

Implementa **RFC 8291** (criptografia `aes128gcm` sobre RFC 8188) e **VAPID**
(JWT ES256) em `lib/webpush.js`, usando apenas `node:crypto` — sem dependência
externa, o que mantém o bundle serverless enxuto e o histórico de dependências
auditável.

O celular não precisa estar com o site aberto: `public/sw.js` (service worker)
recebe a mensagem em segundo plano, mostra a notificação e abre o painel do
equipamento correto quando ela é tocada.

## Configuração

1. Gere o par de chaves:

   ```bash
   npm run push:keys
   ```

2. Publique no `.env.local` e no painel da Vercel:

   ```
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...
   VAPID_SUBJECT=mailto:alertas@agrorisk.app
   PUSH_COOLDOWN_MINUTES=5
   ```

3. No painel autenticado, toque em **🔔 Alertas** → **Neste aparelho** →
   **Ativar**. Uma notificação de teste confirma o registro.

> O navegador só permite Web Push em HTTPS (ou `localhost`), o que a Vercel já
> atende. No Android, instalar pela opção "Adicionar à tela inicial"
> (`public/manifest.json`) deixa com cara de aplicativo; no iPhone essa
> instalação é **obrigatória** para receber notificação.

---

# Canal 2 — Telegram

Um operador por conversa. A vinculação usa um **código de uso único que expira em
15 minutos**: o painel gera o código, o link `https://t.me/<bot>?start=<código>`
é aberto no celular do operador, e o bot recebe `/start <código>`. O webhook
valida, consome o código e grava o `chat_id` daquele operador para aquele
equipamento. Um link vazado não vira acesso permanente ao alerta.

O operador sai quando quiser enviando `/parar` ao bot, e o gestor pode removê-lo
pelo painel.

## Configuração

1. Crie o bot no [@BotFather](https://t.me/BotFather) (`/newbot`) e guarde o token.

2. Defina as variáveis no `.env.local` e na Vercel:

   ```
   TELEGRAM_BOT_TOKEN=123456789:AA...
   TELEGRAM_BOT_USERNAME=SeuBotAgroRisk
   TELEGRAM_WEBHOOK_SECRET=<valor longo e aleatório>
   PUBLIC_APP_URL=https://agrorisk-sompo.vercel.app
   ```

3. Registre o webhook no Telegram:

   ```bash
   npm run telegram:webhook
   ```

   `npm run telegram:webhook -- --info` mostra o estado atual e `-- --delete`
   remove o registro.

4. No painel, **🔔 Alertas** → **Gerar link de vinculação** → abra o link no
   celular do operador e toque em **INICIAR**. O painel detecta a vinculação
   sozinho e passa a listar o operador.

> **O token do bot é um segredo**: quem o tem controla o bot. Não versione e não
> deixe aparecer em print na apresentação.
>
> O `TELEGRAM_WEBHOOK_SECRET` é o que garante que a chamada veio mesmo do
> Telegram — ele devolve o valor no cabeçalho
> `X-Telegram-Bot-Api-Secret-Token` de cada atualização. Sem ele, qualquer
> pessoa que descobrisse a URL poderia forjar uma vinculação.
>
> **Em desenvolvimento local o webhook não funciona**: o Telegram precisa
> alcançar a URL pela internet. Vincule pelo ambiente publicado, ou exponha o
> servidor local com um túnel (ngrok) e aponte `PUBLIC_APP_URL` para ele.

---

## API

| Método | Rota | Efeito |
|---|---|---|
| `GET` | `/api/push?deviceId=` | `configured`, chave pública VAPID e aparelhos registrados |
| `POST` | `/api/push?deviceId=` | registra a inscrição (`sendTest: true` dispara o teste) |
| `DELETE` | `/api/push?deviceId=&endpoint=` | remove a inscrição |
| `GET` | `/api/telegram?deviceId=` | `configured`, usuário do bot e operadores vinculados |
| `POST` | `/api/telegram?deviceId=` | gera o código e o link de vinculação (`sendTest: true` envia teste) |
| `DELETE` | `/api/telegram?deviceId=&chatId=` | desvincula o operador |
| `POST` | `/api/telegram-webhook` | recebe as atualizações do Telegram (autenticado pelo segredo) |

Todas as rotas de painel exigem sessão autenticada e, para o perfil `farmer`,
respeitam o vínculo entre o usuário e o equipamento (`canAccessDevice`). O
`DELETE` do Telegram só remove operador vinculado ao equipamento informado, para
uma conta não conseguir desvincular o operador de outra.

As tabelas envolvidas são `push_subscriptions`, `telegram_recipients` e
`telegram_link_codes`.

## Testes

```bash
node scripts/test-push.js       # criptografia aes128gcm, JWT VAPID, severidade e silêncio
node scripts/test-push-flow.js  # inscrição, alerta crítico e limpeza de inscrição expirada
node scripts/test-telegram.js   # vinculação de uso único, webhook autenticado e descadastro
```

O primeiro decifra a mensagem com a chave do "navegador" e confere o texto
original; os outros dois sobem servidores falsos (push service e Bot API) e
percorrem o caminho completo da API, sem banco e sem rede externa. Os três entram
no `npm test`.
