# Firmware AgroRisk ESP32

## Bibliotecas da Arduino IDE

- Adafruit MPU6050
- Adafruit Unified Sensor
- Adafruit BusIO
- DHT sensor library
- TinyGPSPlus

`WiFi.h` e `Wire.h` já fazem parte do pacote de placas ESP32.

## Antes de gravar

1. Abra `secrets.h` e informe o SSID e a senha do Wi-Fi. Se deixar vazios, todos os sensores continuam funcionando e o firmware apenas informa que o Wi-Fi não está configurado.
2. Selecione a placa ESP32 e a porta correta na Arduino IDE.
3. Feche o gateway e qualquer Monitor Serial que esteja usando a COM antes do upload.
4. Mantenha o MPU-6050 imóvel durante os primeiros segundos, enquanto o giroscópio é calibrado.
5. Reabra o gateway depois do upload com `npm run gateway`.

## Wi-Fi prioritário com fallback USB

O ESP32 tenta enviar cada leitura diretamente para a API por HTTPS. A telemetria também permanece disponível na porta serial o tempo todo.

- Com Wi-Fi e API disponíveis, o envio direto tem prioridade e o gateway descarta a cópia USB da mesma leitura.
- Sem Wi-Fi ou quando a API falhar, o gateway envia automaticamente a leitura recebida pelo cabo.
- Para o fallback funcionar, o ESP32 deve estar conectado ao notebook e `npm run gateway` precisa estar em execução.
- `secrets.h` também precisa conter `CLOUD_API_URL`, `DEVICE_ID` e `DEVICE_API_KEY`; esse arquivo é local e ignorado pelo Git.

## Ligações importantes

- MPU-6050: `SDA 21`, `SCL 22`, alimentação `3,3 V` e GND comum.
- GPS NEO-6M: TX no GPIO 16 ou 17; o firmware detecta automaticamente.
- DHT11: DATA no GPIO 4.
- HC-SR04: TRIG no GPIO 5 e ECHO no GPIO 18.
- Buzzer: GPIO 19; use transistor se a corrente do buzzer exceder a capacidade do GPIO.

O ECHO do HC-SR04 trabalha em 5 V. Use divisor resistivo ou conversor de nível antes do GPIO 18 do ESP32.

## Geofence e buzzer

O firmware aceita pela USB:

```text
ALERT:GEOFENCE:ON
ALERT:GEOFENCE:OFF
```

O alarme físico usa uma operação OR: obstáculo próximo ou geofence crítica mantém o buzzer ligado. Para habilitar o comando vindo da nuvem, configure `SERIAL_COMMANDS=1` no gateway somente depois de testar os comandos acima.
