# Gateway local

Este processo precisa permanecer ligado no computador conectado ao ESP32.

1. Copie `.env.example` para `.env` na raiz.
2. Preencha `CLOUD_API_URL`, `DEVICE_ID`, `DEVICE_API_KEY` e `SERIAL_PORT`.
3. Feche o Monitor Serial da Arduino IDE.
4. Execute `npm run gateway`.

O gateway publica um pacote aproximadamente a cada dois segundos e recebe da API o estado desejado do buzzer geográfico.
