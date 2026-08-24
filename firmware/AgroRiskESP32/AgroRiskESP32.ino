#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <DHT.h>
#include <TinyGPSPlus.h>
#include "secrets.h"

// =================================================
// PINOS E CONSTANTES
// =================================================

const byte PIN_TRIG = 5;
const byte PIN_ECHO = 18;
const byte PIN_BUZZER = 19;

// Use divisor resistivo/conversor de nível no ECHO do HC-SR04 (5 V -> 3,3 V).
const float DISTANCIA_LIGAR_BUZZER_CM = 50.0f;
const float DISTANCIA_DESLIGAR_BUZZER_CM = 60.0f;
const unsigned long TIMEOUT_ULTRASSONICO_US = 25000;

const byte PIN_IMU_SDA = 21;
const byte PIN_IMU_SCL = 22;
const byte ENDERECOS_IMU[] = {0x68, 0x69};
const byte QUANTIDADE_ENDERECOS_IMU = sizeof(ENDERECOS_IMU) / sizeof(ENDERECOS_IMU[0]);

const byte PIN_DHT = 4;
#define TIPO_DHT DHT11

const byte PINOS_RX_GPS[] = {16, 17};
const byte QUANTIDADE_PINOS_GPS = sizeof(PINOS_RX_GPS) / sizeof(PINOS_RX_GPS[0]);
const unsigned long GPS_BAUD = 9600;
const unsigned long TEMPO_TESTE_PINO_GPS = 5000;

const unsigned long INTERVALO_TELEMETRIA_MS = 2000;
const unsigned long INTERVALO_ULTRASSONICO_MS = 100;
const unsigned long INTERVALO_IMU_MS = 20;       // 50 Hz
const unsigned long INTERVALO_WIFI_MS = 10000;
const unsigned long INTERVALO_ENVIO_WIFI_MS = 2000;
const unsigned long INTERVALO_REINICIO_IMU_MS = 5000;

const float ALFA_ACELERACAO = 0.18f;
const float ALFA_GIROSCOPIO = 0.22f;
const float ALFA_COMPLEMENTAR = 0.98f;
const byte LIMITE_LEITURAS_IMU_INVALIDAS = 20;

// =================================================
// OBJETOS E ESTADO
// =================================================

Adafruit_MPU6050 imu;
DHT dht(PIN_DHT, TIPO_DHT);
TinyGPSPlus gps;
HardwareSerial serialGPS(2);

bool imuEncontrado = false;
byte enderecoImu = 0;
byte leiturasImuInvalidas = 0;
bool filtroImuInicializado = false;

bool pinoGpsEncontrado = false;
byte indicePinoGps = 0;
unsigned long inicioTestePinoGps = 0;
unsigned long bytesGpsRecebidos = 0;

bool alertaObstaculo = false;
bool alertaGeofence = false;
bool buzzerLigado = false;
float distanciaAtualCm = -1.0f;

float aceleracaoX = NAN;
float aceleracaoY = NAN;
float aceleracaoZ = NAN;
float giroscopioX = NAN;
float giroscopioY = NAN;
float giroscopioZ = NAN;
float rollGraus = NAN;
float pitchGraus = NAN;
float temperaturaAtualC = NAN;
float umidadeAtualPercent = NAN;

float offsetGiroscopioX = 0.0f;
float offsetGiroscopioY = 0.0f;
float offsetGiroscopioZ = 0.0f;

unsigned long ultimaTelemetria = 0;
unsigned long ultimaMedicaoDistancia = 0;
unsigned long ultimaLeituraImu = 0;
unsigned long ultimaTentativaImu = 0;
unsigned long ultimaTentativaWifi = 0;
unsigned long ultimoEnvioWifi = 0;

String comandoSerial;

// =================================================
// FUNÇÕES AUXILIARES
// =================================================

bool numeroValido(float valor) {
  return !isnan(valor) && !isinf(valor);
}

float filtroExponencial(float anterior, float atual, float alfa) {
  if (!numeroValido(anterior)) return atual;
  return anterior + alfa * (atual - anterior);
}

const char *qualidadeWifi(int32_t rssi) {
  if (rssi >= -55) return "excelente";
  if (rssi >= -67) return "boa";
  if (rssi >= -75) return "regular";
  if (rssi >= -85) return "fraca";
  return "critica";
}

int percentualWifi(int32_t rssi) {
  return constrain(2 * (rssi + 100), 0, 100);
}

String numeroJson(float valor, unsigned int casasDecimais) {
  return numeroValido(valor) ? String(valor, casasDecimais) : "null";
}

// =================================================
// WI-FI (RSSI E RECONEXÃO NÃO BLOQUEANTE)
// =================================================

bool wifiConfigurado() {
  return WIFI_SSID != nullptr && strlen(WIFI_SSID) > 0;
}

void iniciarWifi() {
  if (!wifiConfigurado()) {
    Serial.println("WiFi nao configurado. Preencha secrets.h.");
    return;
  }

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  ultimaTentativaWifi = millis();
  Serial.println("Conexao WiFi iniciada sem bloquear os sensores.");
}

void atualizarWifi() {
  if (!wifiConfigurado() || WiFi.status() == WL_CONNECTED) return;
  if (millis() - ultimaTentativaWifi < INTERVALO_WIFI_MS) return;

  ultimaTentativaWifi = millis();
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void mostrarWifi() {
  Serial.println("[WIFI]");

  if (!wifiConfigurado()) {
    Serial.println("WiFi Status: nao configurado");
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi Status: desconectado");
    return;
  }

  int32_t rssi = WiFi.RSSI();
  Serial.println("WiFi Status: conectado");
  Serial.print("WiFi RSSI: ");
  Serial.print(rssi);
  Serial.println(" dBm");
  Serial.print("WiFi Qualidade: ");
  Serial.print(qualidadeWifi(rssi));
  Serial.print(" (");
  Serial.print(percentualWifi(rssi));
  Serial.println("%)");
  Serial.print("WiFi IP: ");
  Serial.println(WiFi.localIP());
}

bool apiWifiConfigurada() {
  return CLOUD_API_URL != nullptr && strlen(CLOUD_API_URL) > 0 &&
         DEVICE_API_KEY != nullptr && strlen(DEVICE_API_KEY) > 0;
}

void aplicarComandoDaApi(const String &resposta) {
  if (resposta.indexOf("\"buzzerActive\":true") >= 0) alertaGeofence = true;
  else if (resposta.indexOf("\"buzzerActive\":false") >= 0) alertaGeofence = false;
  else return;
  aplicarEstadoBuzzer();
}

void enviarTelemetriaWifi() {
  if (WiFi.status() != WL_CONNECTED || !apiWifiConfigurada()) return;
  if (millis() - ultimoEnvioWifi < INTERVALO_ENVIO_WIFI_MS) return;
  ultimoEnvioWifi = millis();

  const bool gpsValido = gps.location.isValid() && gps.location.age() < 5000;
  const int32_t rssi = WiFi.RSSI();
  String json;
  json.reserve(700);
  json = "{\"deviceId\":\"" + String(DEVICE_ID) + "\",\"telemetry\":{";
  json += "\"distanceCm\":" + numeroJson(distanciaAtualCm > 0 ? distanciaAtualCm : NAN, 1);
  json += ",\"buzzer\":" + String(buzzerLigado ? "true" : "false");
  json += ",\"acceleration\":{\"x\":" + numeroJson(aceleracaoX, 3) + ",\"y\":" + numeroJson(aceleracaoY, 3) + ",\"z\":" + numeroJson(aceleracaoZ, 3) + "}";
  json += ",\"gyroscope\":{\"x\":" + numeroJson(giroscopioX, 4) + ",\"y\":" + numeroJson(giroscopioY, 4) + ",\"z\":" + numeroJson(giroscopioZ, 4) + "}";
  json += ",\"environment\":{\"temperatureC\":" + numeroJson(temperaturaAtualC, 1) + ",\"humidityPercent\":" + numeroJson(umidadeAtualPercent, 1) + "}";
  json += ",\"gps\":{\"latitude\":" + numeroJson(gpsValido ? gps.location.lat() : NAN, 6) + ",\"longitude\":" + numeroJson(gpsValido ? gps.location.lng() : NAN, 6) + ",\"valid\":" + String(gpsValido ? "true" : "false") + ",\"source\":\"esp32\"}";
  json += ",\"gateway\":{\"transport\":\"wifi\",\"rssi\":" + String(rssi) + ",\"qualityPercent\":" + String(percentualWifi(rssi)) + "}}}";

  WiFiClientSecure cliente;
  cliente.setInsecure();
  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(7000);

  if (!http.begin(cliente, CLOUD_API_URL)) {
    Serial.println("WiFi API: falha ao iniciar HTTPS; serial permanece ativa.");
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_API_KEY);
  int codigo = http.POST(json);
  if (codigo >= 200 && codigo < 300) {
    aplicarComandoDaApi(http.getString());
    Serial.println("WiFi API: telemetria enviada.");
  } else {
    Serial.print("WiFi API: envio falhou (HTTP ");
    Serial.print(codigo);
    Serial.println("); serial permanece ativa.");
  }
  http.end();
}

// =================================================
// GPS
// =================================================

void iniciarTestePinoGps() {
  serialGPS.end();
  delay(30);

  if (!pinoGpsEncontrado) bytesGpsRecebidos = 0;

  serialGPS.begin(GPS_BAUD, SERIAL_8N1, PINOS_RX_GPS[indicePinoGps], -1);
  inicioTestePinoGps = millis();

  Serial.print("Testando TX do GPS ligado ao GPIO ");
  Serial.println(PINOS_RX_GPS[indicePinoGps]);
}

void processarGps() {
  while (serialGPS.available() > 0) {
    char caractere = serialGPS.read();
    gps.encode(caractere);
    bytesGpsRecebidos++;

    if (!pinoGpsEncontrado && caractere == '$') {
      pinoGpsEncontrado = true;
      Serial.print("GPS detectado! TX do GPS esta no GPIO ");
      Serial.println(PINOS_RX_GPS[indicePinoGps]);
    }
  }

  if (!pinoGpsEncontrado && millis() - inicioTestePinoGps >= TEMPO_TESTE_PINO_GPS) {
    indicePinoGps = (indicePinoGps + 1) % QUANTIDADE_PINOS_GPS;
    iniciarTestePinoGps();
  }
}

void mostrarGps() {
  Serial.println("[GPS NEO-6M V2]");

  if (pinoGpsEncontrado) {
    Serial.print("Dados encontrados no GPIO: ");
  } else {
    Serial.print("Procurando dados no GPIO: ");
  }
  Serial.println(PINOS_RX_GPS[indicePinoGps]);

  if (gps.location.isValid() && gps.location.age() < 5000) {
    Serial.print("Latitude: ");
    Serial.println(gps.location.lat(), 6);
    Serial.print("Longitude: ");
    Serial.println(gps.location.lng(), 6);
    Serial.print("Satelites: ");
    if (gps.satellites.isValid()) Serial.println(gps.satellites.value());
    else Serial.println("indisponivel");
    Serial.print("Altitude: ");
    if (gps.altitude.isValid()) {
      Serial.print(gps.altitude.meters(), 1);
      Serial.println(" m");
    } else Serial.println("indisponivel");
  } else if (bytesGpsRecebidos < 10) {
    Serial.println("Nenhum dado recebido neste pino.");
    Serial.println("Confira TX do GPS, alimentacao e GND.");
  } else {
    Serial.println("GPS conectado, mas ainda sem localizacao.");
    Serial.println("Teste perto de uma janela ou em area aberta.");
  }
}

// =================================================
// ULTRASSÔNICO E BUZZER
// =================================================

float medirDistanciaCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  unsigned long duracao = pulseIn(PIN_ECHO, HIGH, TIMEOUT_ULTRASSONICO_US);
  if (duracao == 0) return -1.0f;
  return duracao * 0.0343f / 2.0f;
}

void aplicarEstadoBuzzer() {
  bool novoEstado = alertaObstaculo || alertaGeofence;
  if (novoEstado == buzzerLigado) return;
  buzzerLigado = novoEstado;
  digitalWrite(PIN_BUZZER, buzzerLigado ? HIGH : LOW);
}

void atualizarUltrassonicoEBuzzer() {
  if (millis() - ultimaMedicaoDistancia < INTERVALO_ULTRASSONICO_MS) return;
  ultimaMedicaoDistancia = millis();
  distanciaAtualCm = medirDistanciaCm();

  if (distanciaAtualCm > 0) {
    if (!alertaObstaculo && distanciaAtualCm <= DISTANCIA_LIGAR_BUZZER_CM) alertaObstaculo = true;
    else if (alertaObstaculo && distanciaAtualCm >= DISTANCIA_DESLIGAR_BUZZER_CM) alertaObstaculo = false;
  } else {
    alertaObstaculo = false;
  }

  aplicarEstadoBuzzer();
}

void mostrarUltrassonico() {
  Serial.println("[ULTRASSONICO]");
  if (distanciaAtualCm < 0) {
    Serial.println("Sem eco. Verifique o sensor.");
  } else {
    Serial.print("Distancia: ");
    Serial.print(distanciaAtualCm, 1);
    Serial.println(" cm");
  }

  Serial.print("Buzzer: ");
  Serial.println(buzzerLigado ? "ATIVADO" : "desativado");
  if (alertaObstaculo) Serial.println("Motivo Buzzer: obstaculo");
  else if (alertaGeofence) Serial.println("Motivo Buzzer: geofence");
}

// =================================================
// COMANDOS RECEBIDOS DO GATEWAY
// =================================================

void executarComando(const String &comando) {
  String texto = comando;
  texto.trim();

  if (texto == "ALERT:GEOFENCE:ON") {
    alertaGeofence = true;
    aplicarEstadoBuzzer();
    Serial.println("Comando geofence: ON confirmado");
  } else if (texto == "ALERT:GEOFENCE:OFF") {
    alertaGeofence = false;
    aplicarEstadoBuzzer();
    Serial.println("Comando geofence: OFF confirmado");
  }
}

void processarComandosSerial() {
  while (Serial.available() > 0) {
    char caractere = Serial.read();
    if (caractere == '\n' || caractere == '\r') {
      if (comandoSerial.length() > 0) {
        executarComando(comandoSerial);
        comandoSerial = "";
      }
    } else if (comandoSerial.length() < 100) {
      comandoSerial += caractere;
    } else {
      comandoSerial = "";
    }
  }
}

// =================================================
// IMU MPU-6050
// =================================================

bool leituraImuFisicamenteValida(const sensors_event_t &aceleracao, const sensors_event_t &giro) {
  float x = aceleracao.acceleration.x;
  float y = aceleracao.acceleration.y;
  float z = aceleracao.acceleration.z;
  float modulo = sqrtf(x * x + y * y + z * z);

  return numeroValido(x) && numeroValido(y) && numeroValido(z) &&
         numeroValido(giro.gyro.x) && numeroValido(giro.gyro.y) && numeroValido(giro.gyro.z) &&
         modulo > 1.0f && modulo < 40.0f;
}

bool iniciarImu() {
  imuEncontrado = false;
  filtroImuInicializado = false;
  leiturasImuInvalidas = 0;

  for (byte indice = 0; indice < QUANTIDADE_ENDERECOS_IMU; indice++) {
    if (imu.begin(ENDERECOS_IMU[indice], &Wire)) {
      enderecoImu = ENDERECOS_IMU[indice];
      imuEncontrado = true;
      break;
    }
  }

  if (!imuEncontrado) return false;

  imu.setAccelerometerRange(MPU6050_RANGE_4_G);
  imu.setGyroRange(MPU6050_RANGE_250_DEG);
  imu.setFilterBandwidth(MPU6050_BAND_10_HZ);
  imu.setSampleRateDivisor(9);
  delay(100);
  return true;
}

bool calibrarGiroscopio() {
  if (!imuEncontrado) return false;

  const int amostrasDesejadas = 300;
  int amostrasValidas = 0;
  double somaX = 0.0;
  double somaY = 0.0;
  double somaZ = 0.0;

  Serial.println("Calibrando giroscopio: mantenha a placa parada...");

  for (int i = 0; i < amostrasDesejadas; i++) {
    sensors_event_t aceleracao;
    sensors_event_t giro;
    sensors_event_t temperatura;
    imu.getEvent(&aceleracao, &giro, &temperatura);

    if (leituraImuFisicamenteValida(aceleracao, giro)) {
      somaX += giro.gyro.x;
      somaY += giro.gyro.y;
      somaZ += giro.gyro.z;
      amostrasValidas++;
    }
    delay(5);
  }

  if (amostrasValidas < amostrasDesejadas * 0.8f) {
    Serial.println("Falha na calibracao: aceleracao ausente ou invalida.");
    return false;
  }

  offsetGiroscopioX = somaX / amostrasValidas;
  offsetGiroscopioY = somaY / amostrasValidas;
  offsetGiroscopioZ = somaZ / amostrasValidas;
  Serial.println("Calibracao do giroscopio concluida.");
  return true;
}

void atualizarImu() {
  unsigned long agora = millis();

  if (!imuEncontrado) {
    if (agora - ultimaTentativaImu >= INTERVALO_REINICIO_IMU_MS) {
      ultimaTentativaImu = agora;
      if (iniciarImu()) Serial.println("IMU recuperado automaticamente.");
    }
    return;
  }

  if (agora - ultimaLeituraImu < INTERVALO_IMU_MS) return;
  float dt = ultimaLeituraImu == 0 ? INTERVALO_IMU_MS / 1000.0f : (agora - ultimaLeituraImu) / 1000.0f;
  ultimaLeituraImu = agora;

  sensors_event_t aceleracao;
  sensors_event_t giro;
  sensors_event_t temperatura;
  imu.getEvent(&aceleracao, &giro, &temperatura);

  if (!leituraImuFisicamenteValida(aceleracao, giro)) {
    leiturasImuInvalidas++;
    if (leiturasImuInvalidas >= LIMITE_LEITURAS_IMU_INVALIDAS) {
      imuEncontrado = false;
      filtroImuInicializado = false;
      Serial.println("ERRO: IMU retornou leituras invalidas e sera reiniciado.");
    }
    return;
  }

  leiturasImuInvalidas = 0;
  aceleracaoX = filtroExponencial(aceleracaoX, aceleracao.acceleration.x, ALFA_ACELERACAO);
  aceleracaoY = filtroExponencial(aceleracaoY, aceleracao.acceleration.y, ALFA_ACELERACAO);
  aceleracaoZ = filtroExponencial(aceleracaoZ, aceleracao.acceleration.z, ALFA_ACELERACAO);

  float giroXAtual = giro.gyro.x - offsetGiroscopioX;
  float giroYAtual = giro.gyro.y - offsetGiroscopioY;
  float giroZAtual = giro.gyro.z - offsetGiroscopioZ;
  giroscopioX = filtroExponencial(giroscopioX, giroXAtual, ALFA_GIROSCOPIO);
  giroscopioY = filtroExponencial(giroscopioY, giroYAtual, ALFA_GIROSCOPIO);
  giroscopioZ = filtroExponencial(giroscopioZ, giroZAtual, ALFA_GIROSCOPIO);

  float rollAcelerometro = atan2f(aceleracaoY, aceleracaoZ) * RAD_TO_DEG;
  float pitchAcelerometro = atan2f(-aceleracaoX, sqrtf(aceleracaoY * aceleracaoY + aceleracaoZ * aceleracaoZ)) * RAD_TO_DEG;

  if (!filtroImuInicializado) {
    rollGraus = rollAcelerometro;
    pitchGraus = pitchAcelerometro;
    filtroImuInicializado = true;
  } else {
    rollGraus = ALFA_COMPLEMENTAR * (rollGraus + giroscopioX * RAD_TO_DEG * dt) + (1.0f - ALFA_COMPLEMENTAR) * rollAcelerometro;
    pitchGraus = ALFA_COMPLEMENTAR * (pitchGraus + giroscopioY * RAD_TO_DEG * dt) + (1.0f - ALFA_COMPLEMENTAR) * pitchAcelerometro;
  }
}

void mostrarImu() {
  Serial.println("[IMU HW-123 / MPU-6050]");

  if (!imuEncontrado || !filtroImuInicializado) {
    Serial.println("IMU sem leitura valida. Verifique VCC 3.3V, GND, SDA 21 e SCL 22.");
    return;
  }

  Serial.print("IMU Endereco: 0x");
  Serial.println(enderecoImu, HEX);
  Serial.print("Aceleracao X/Y/Z: ");
  Serial.print(aceleracaoX, 3);
  Serial.print(" / ");
  Serial.print(aceleracaoY, 3);
  Serial.print(" / ");
  Serial.print(aceleracaoZ, 3);
  Serial.println(" m/s^2");
  Serial.print("Giroscopio X/Y/Z: ");
  Serial.print(giroscopioX, 4);
  Serial.print(" / ");
  Serial.print(giroscopioY, 4);
  Serial.print(" / ");
  Serial.print(giroscopioZ, 4);
  Serial.println(" rad/s");
  Serial.print("Inclinacao Roll/Pitch: ");
  Serial.print(rollGraus, 2);
  Serial.print(" / ");
  Serial.print(pitchGraus, 2);
  Serial.println(" graus");
}

// =================================================
// DHT11
// =================================================

void atualizarDht11() {
  float umidade = dht.readHumidity();
  float temperatura = dht.readTemperature();

  if (!isnan(umidade) && !isnan(temperatura)) {
    umidadeAtualPercent = umidade;
    temperaturaAtualC = temperatura;
  }
}

void mostrarDht11() {
  Serial.println("[DHT11]");

  if (!numeroValido(umidadeAtualPercent) || !numeroValido(temperaturaAtualC)) {
    Serial.println("Falha ao ler o DHT11. Verifique DATA e o resistor de 10k.");
    return;
  }

  Serial.print("Temperatura ambiente: ");
  Serial.print(temperaturaAtualC, 1);
  Serial.println(" C");
  Serial.print("Umidade: ");
  Serial.print(umidadeAtualPercent, 1);
  Serial.println(" %");
}

// =================================================
// SETUP E LOOP
// =================================================

void setup() {
  Serial.begin(115200);
  delay(1200);

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_TRIG, LOW);
  digitalWrite(PIN_BUZZER, LOW);

  dht.begin();
  Wire.begin(PIN_IMU_SDA, PIN_IMU_SCL);
  Wire.setClock(100000);
  Wire.setTimeOut(50);

  imuEncontrado = iniciarImu();
  if (imuEncontrado) calibrarGiroscopio();

  iniciarTestePinoGps();
  iniciarWifi();

  Serial.println();
  Serial.println("========================================");
  Serial.println("AGRO RISK - MONITOR DE SENSORES ESP32");
  Serial.println("========================================");
  Serial.print("Buzzer liga em ate ");
  Serial.print(DISTANCIA_LIGAR_BUZZER_CM, 0);
  Serial.print(" cm e desliga acima de ");
  Serial.print(DISTANCIA_DESLIGAR_BUZZER_CM, 0);
  Serial.println(" cm.");

  if (imuEncontrado) {
    Serial.print("IMU encontrado no endereco 0x");
    Serial.println(enderecoImu, HEX);
  } else {
    Serial.println("ERRO: MPU-6050 nao encontrado em 0x68 nem 0x69.");
  }
}

void loop() {
  processarComandosSerial();
  processarGps();
  atualizarWifi();
  atualizarUltrassonicoEBuzzer();
  atualizarImu();

  if (millis() - ultimaTelemetria >= INTERVALO_TELEMETRIA_MS) {
    ultimaTelemetria = millis();
    atualizarDht11();

    Serial.println();
    Serial.println("----------------------------------------");
    mostrarUltrassonico();
    mostrarImu();
    mostrarDht11();
    mostrarGps();
    mostrarWifi();
    // O gateway reconhece esta confirmação e evita duplicar a leitura via USB.
    enviarTelemetriaWifi();
    // Separador final: faz o gateway publicar o bloco imediatamente.
    Serial.println("----------------------------------------");
  }
}
