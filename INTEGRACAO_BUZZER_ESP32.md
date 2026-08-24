# Integração do buzzer com os alertas geográficos

O back-end envia estes comandos pela mesma porta serial:

```text
ALERT:GEOFENCE:ON
ALERT:GEOFENCE:OFF
```

O firmware atual precisa incorporar a leitura abaixo. Use o mesmo `PIN_BUZZER` já configurado no projeto dos sensores.

```cpp
bool alertaGeofence = false;
String comandoSerial = "";

void processarComandosDoServidor() {
  while (Serial.available() > 0) {
    char caractere = (char) Serial.read();

    if (caractere == '\n') {
      comandoSerial.trim();

      if (comandoSerial == "ALERT:GEOFENCE:ON") {
        alertaGeofence = true;
        Serial.println("Geofence: alerta critico recebido");
      } else if (comandoSerial == "ALERT:GEOFENCE:OFF") {
        alertaGeofence = false;
        Serial.println("Geofence: alerta encerrado");
      }

      comandoSerial = "";
    } else if (caractere != '\r' && comandoSerial.length() < 80) {
      comandoSerial += caractere;
    }
  }
}
```

No início de `loop()`, chame:

```cpp
processarComandosDoServidor();
```

Ao atualizar o buzzer, combine o ultrassônico com a geofence:

```cpp
bool alertaUltrassonico = distanciaCm > 0 && distanciaCm <= LIMITE_DISTANCIA_CM;
digitalWrite(PIN_BUZZER, alertaUltrassonico || alertaGeofence ? HIGH : LOW);
```

Depois de gravar o firmware, habilite os comandos antes de iniciar o servidor:

```powershell
$env:SERIAL_COMMANDS = "1"
npm.cmd start
```

Mantenha o controle ultrassônico dentro do ESP32. Assim, a proteção frontal continua funcionando mesmo se o computador, a rede ou o mapa ficarem indisponíveis.

## LEDs de sinalização

O firmware usa dois LEDs externos ativos em nível alto:

- GPIO 13: pisca exatamente junto com cada bipe do buzzer.
- GPIO 23: permanece aceso enquanto houver alerta de obstáculo ou geofence, inclusive durante as pausas entre bipes.

Em cada LED, ligue o ânodo ao GPIO por meio de um resistor de 220 a 330 ohms e o cátodo ao GND. O GPIO 23 foi escolhido por estar livre no esquema atual; altere `PIN_LED_ALERTA` caso o segundo LED esteja fisicamente ligado a outro pino.
