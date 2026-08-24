# AgroRisk — monitor da colheitadeira

Dashboard em nuvem que recebe a telemetria do ESP32 pela porta serial e mostra distância, buzzer, temperatura, umidade, GPS, geofence e inclinação em tempo real.

Produção: **https://agrorisk-ten.vercel.app**

O frontend e as APIs estão na Vercel, os dados ficam no PostgreSQL/Neon e o gateway local conecta a COM3 à nuvem. Consulte [docs/ARQUITETURA_VERCEL.md](docs/ARQUITETURA_VERCEL.md) e [docs/DBEAVER.md](docs/DBEAVER.md).

## Geofence híbrida

O HTML Sompo é a interface principal. Após o operador autorizar a localização, o sistema usa o navegador como fallback enquanto o GPS do ESP32 estiver sem fix, consulta rios, áreas de água, pedreiras e escarpas próximas no OpenStreetMap e apresenta tudo como sugestão. Somente áreas confirmadas ou desenhadas e confirmadas pelo operador são persistidas e passam a participar dos alertas.

O servidor local legado está em `local-server.js`. Para a operação em nuvem, execute `npm run gateway` no computador ligado ao ESP32; a Vercel utiliza somente `api/`, `lib/` e `public/`.

## Executar

1. Feche o Monitor Serial da Arduino IDE.
2. Abra um terminal nesta pasta.
3. Execute `npm install` na primeira vez.
4. Para o modo local, execute `npm start` e abra `http://localhost:3000`.
5. Para transmitir o ESP32 ao site publicado, execute `npm run gateway`.

## Opções de interface

- `http://localhost:3000/sompo-agro-risk.html` — protótipo institucional Sompo Agro Risk.
- `http://localhost:3000/versao-1-command-center.html` — central de comando escura.
- `http://localhost:3000/versao-2-executiva.html` — visual corporativo claro.
- `http://localhost:3000/versao-3-field-hud.html` — HUD futurista para operação em campo.

Acrescente `?demo=1` ao endereço para avaliar a animação do inclinômetro com valores simulados. Sem esse parâmetro, somente dados reais são apresentados.

A porta USB do ESP32 é detectada automaticamente. Para escolher manualmente no PowerShell:

```powershell
$env:SERIAL_PORT = "COM3"
npm start
```

O histórico fica em `data/measurements.ndjson` e pode ser baixado como planilha CSV pelo botão **Exportar CSV**.

Eventos de aproximação de rios e pedreiras ficam em `data/safety-logs.ndjson`. As zonas automáticas vêm do OpenStreetMap e são apenas uma camada auxiliar; áreas críticas devem ser conferidas e homologadas antes da operação real.

## Formato serial reconhecido

O parser foi criado a partir da saída real da placa em 115200 baud. Também reconhece coordenadas nos formatos `Latitude: ...` / `Longitude: ...` ou `GPS: latitude, longitude`.

Observações do teste inicial:

- O GPS foi detectado no GPIO 16, porém ainda estava sem localização. Teste ao ar livre.
- O MPU-6050 retornou aceleração e giro iguais a zero. A inclinação depende de aceleração X/Y/Z válida.
