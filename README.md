# AgroGuard — monitor da colheitadeira

Dashboard local que lê a telemetria do ESP32 pela porta serial e mostra distância, buzzer, temperatura, umidade, GPS, geofence e inclinação em tempo real.

> A arquitetura atual é local porque precisa acessar a porta USB. Consulte [docs/ARQUITETURA_VERCEL.md](docs/ARQUITETURA_VERCEL.md) antes da implantação em nuvem.

## Executar

1. Feche o Monitor Serial da Arduino IDE.
2. Abra um terminal nesta pasta.
3. Execute `npm install` na primeira vez.
4. Execute `npm start`.
5. Abra `http://localhost:3000`. O protótipo Sompo Agro Risk é a interface principal.

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
