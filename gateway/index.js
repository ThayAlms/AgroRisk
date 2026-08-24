const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const cloudUrl = String(process.env.CLOUD_API_URL || 'https://agrorisk-sompo.vercel.app').replace(/\/$/, '');
const deviceId = process.env.DEVICE_ID || 'colheitadeira-01';
const deviceKey = process.env.AGRORISK_DEVICE_API_KEY || process.env.DEVICE_API_KEY || '';
const requestedPort = process.env.SERIAL_PORT;
const baudRate = Number(process.env.SERIAL_BAUD || 115200);
const commandsEnabled = process.env.SERIAL_COMMANDS === '1';
let activePort;
let lastBuzzerCommand;

if (!cloudUrl) {
  console.error('CLOUD_API_URL não configurada. Copie .env.example para .env e informe a URL da Vercel.');
  process.exit(1);
}

class SensorParser {
  constructor(onReading) { this.onReading = onReading; this.reset(); }
  reset() {
    this.reading = {
      timestamp: new Date().toISOString(), distanceCm: null, buzzer: false,
      acceleration: { x: null, y: null, z: null }, gyroscope: { x: null, y: null, z: null },
      environment: { temperatureC: null, humidityPercent: null },
      gps: { latitude: null, longitude: null, valid: false, source: 'esp32', message: null },
      gateway: { port: activePort?.path || requestedPort || null, baudRate, commandsEnabled },
    };
    this.hasData = false;
  }
  number(value) { const parsed = Number(String(value).replace(',', '.')); return Number.isFinite(parsed) ? parsed : null; }
  feed(rawLine) {
    const line = rawLine.trim();
    if (/^-{5,}$/.test(line)) { if (this.hasData) this.finish(); return; }
    let match;
    if ((match = line.match(/^Distancia:\s*([-\d.,]+)\s*cm/i))) { this.reading.distanceCm = this.number(match[1]); this.hasData = true; }
    else if ((match = line.match(/^Buzzer:\s*(.+)$/i))) this.reading.buzzer = /ativado|ligado|on/i.test(match[1]) && !/desativado/i.test(match[1]);
    else if ((match = line.match(/^Aceleracao X\/Y\/Z:\s*([-\d.,]+)\s*\/\s*([-\d.,]+)\s*\/\s*([-\d.,]+)/i))) [this.reading.acceleration.x, this.reading.acceleration.y, this.reading.acceleration.z] = match.slice(1, 4).map((value) => this.number(value));
    else if ((match = line.match(/^Giroscopio X\/Y\/Z:\s*([-\d.,]+)\s*\/\s*([-\d.,]+)\s*\/\s*([-\d.,]+)/i))) [this.reading.gyroscope.x, this.reading.gyroscope.y, this.reading.gyroscope.z] = match.slice(1, 4).map((value) => this.number(value));
    else if ((match = line.match(/^Temperatura ambiente:\s*([-\d.,]+)/i))) this.reading.environment.temperatureC = this.number(match[1]);
    else if ((match = line.match(/^Umidade:\s*([-\d.,]+)/i))) this.reading.environment.humidityPercent = this.number(match[1]);
    else if ((match = line.match(/Latitude:\s*([-\d.]+)/i))) this.reading.gps.latitude = this.number(match[1]);
    else if ((match = line.match(/Longitude:\s*([-\d.]+)/i))) this.reading.gps.longitude = this.number(match[1]);
    else if ((match = line.match(/(?:Localizacao|GPS):\s*([-\d.]+)\s*[,;/]\s*([-\d.]+)/i))) {
      this.reading.gps.latitude = this.number(match[1]); this.reading.gps.longitude = this.number(match[2]);
    } else if (/sem localizacao|sem sinal|aguardando/i.test(line)) this.reading.gps.message = line;
    this.reading.gps.valid = Number.isFinite(this.reading.gps.latitude) && Number.isFinite(this.reading.gps.longitude);
    if (/teste perto de uma janela|area aberta/i.test(line) && this.hasData) this.finish();
  }
  finish() { const completed = this.reading; this.reset(); this.onReading(completed); }
}

async function publish(reading) {
  try {
    const response = await fetch(`${cloudUrl}/api/telemetry`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-device-key': deviceKey },
      body: JSON.stringify({ deviceId, telemetry: reading }), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    const buzzer = Boolean(result.command?.buzzerActive);
    if (commandsEnabled && buzzer !== lastBuzzerCommand && activePort?.isOpen) {
      activePort.write(`ALERT:GEOFENCE:${buzzer ? 'ON' : 'OFF'}\n`);
      lastBuzzerCommand = buzzer;
    }
    console.log(`${new Date().toLocaleTimeString('pt-BR')} enviado • ${reading.distanceCm ?? '—'} cm • buzzer cloud ${buzzer ? 'ON' : 'OFF'}`);
  } catch (error) {
    console.error(`Falha no envio: ${error.message}`);
  }
}

async function connect() {
  try {
    const ports = await SerialPort.list();
    const selected = requestedPort ? ports.find((item) => item.path.toLowerCase() === requestedPort.toLowerCase())
      : ports.find((item) => /silicon|cp210|ch340|usb/i.test(`${item.manufacturer || ''} ${item.friendlyName || ''}`));
    if (!selected) throw new Error('ESP32 não encontrado');
    activePort = new SerialPort({ path: selected.path, baudRate, autoOpen: false });
    const parser = new SensorParser(publish);
    activePort.pipe(new ReadlineParser({ delimiter: '\n' })).on('data', (line) => parser.feed(line));
    activePort.on('open', () => console.log(`Gateway conectado em ${selected.path} @ ${baudRate} → ${cloudUrl}`));
    activePort.on('error', (error) => console.error(`Serial: ${error.message}`));
    activePort.on('close', () => { console.error('ESP32 desconectado; reconectando...'); activePort = null; setTimeout(connect, 3000); });
    activePort.open((error) => { if (error) { console.error(error.message); activePort = null; setTimeout(connect, 3000); } });
  } catch (error) { console.error(`${error.message}; nova tentativa em 3s`); setTimeout(connect, 3000); }
}

connect();
