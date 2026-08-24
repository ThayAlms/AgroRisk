# Arquitetura para publicação na Vercel

## Por que o servidor atual não pode simplesmente ser enviado

O `local-server.js` abre a porta COM do ESP32 e mantém uma conexão contínua. A Vercel executa funções na nuvem e não tem acesso ao USB do notebook ou da máquina. O sistema final está dividido em dois processos.

```text
ESP32 ──USB/Serial──> Gateway local ──HTTPS──> API na Vercel ──> Banco PostgreSQL
                                                   │
                                                   └──> Dashboard web
```

### Gateway local

Executado em um notebook, Raspberry Pi ou mini-PC instalado na máquina:

- lê a COM do ESP32;
- transforma o bloco serial em JSON;
- envia telemetria autenticada para a API;
- consulta comandos pendentes;
- envia `ALERT:GEOFENCE:ON/OFF` ao ESP32.

### Aplicação Vercel

- hospeda o front-end;
- recebe telemetria via HTTPS;
- consulta e grava o banco;
- calcula geofences e zonas perigosas homologadas;
- disponibiliza dados para os dashboards;
- registra logs de segurança.

### Banco de dados

Arquivos como `data/measurements.ndjson` são adequados somente para uso local. Em produção, use PostgreSQL, por exemplo uma integração Neon ou Supabase. A conexão deve ficar na variável protegida `DATABASE_URL`.

## Variáveis futuras na Vercel

- `DATABASE_URL`: conexão protegida do PostgreSQL.
- `DEVICE_API_KEY`: segredo usado pelo gateway para publicar dados.
- A consulta ao OpenStreetMap é iniciada somente após o usuário autorizar a localização e informa na interface que a coordenada será enviada ao serviço.

## Variáveis do gateway local

- `CLOUD_API_URL`: endereço público da aplicação.
- `DEVICE_ID`: identificador da máquina.
- `DEVICE_API_KEY`: a mesma chave cadastrada na Vercel.
- `SERIAL_PORT`: porta local, como `COM3`.
- `SERIAL_BAUD`: atualmente `115200`.

## Segurança operacional

- Nunca exponha `DEVICE_API_KEY` no JavaScript do navegador.
- Não envie tokens, senhas ou strings de banco pelo chat ou para o GitHub.
- Mantenha o alarme ultrassônico funcionando diretamente no ESP32.
- Trate o comando vindo da nuvem como uma camada adicional.
- Homologue manualmente rios, pedreiras e demais áreas críticas.
- Use o GPS da própria máquina para produção.
- O sistema não deve depender de internet para evitar uma colisão imediata.

## Acesso à Vercel

Há duas opções seguras:

1. Conectar o repositório pelo painel da Vercel e autorizar o aplicativo oficial da Vercel no GitHub.
2. Instalar a Vercel CLI e executar `vercel login`. O login é confirmado no navegador; não é necessário compartilhar senha ou token.

Depois do login, o projeto pode ser vinculado com `vercel link` e implantado com `vercel deploy`. Variáveis secretas devem ser cadastradas pelo painel ou por `vercel env add`, nunca gravadas em arquivos versionados.

## Referências oficiais

- [Integração GitHub da Vercel](https://vercel.com/docs/git/vercel-for-github)
- [Vercel CLI](https://vercel.com/docs/cli)
- [Variáveis de ambiente](https://vercel.com/docs/environment-variables)
- [Limites das Vercel Functions](https://vercel.com/docs/functions/limitations)
