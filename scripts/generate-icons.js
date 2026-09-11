/* Gera os ícones do app (PWA + iOS) sem dependência externa.
   O logo institucional é uma faixa 4,6:1 e vira um borrão ilegível em 60 px na
   tela do celular, então o ícone usa o "A" da marca em branco sobre o vermelho oficial.
   Uso: node scripts/generate-icons.js */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'icons');
const BRAND = [183, 0, 33];      // vermelho Sompo, amostrado do logo oficial
const BRAND_DARK = [138, 0, 25]; // base do degradê
const WHITE = [255, 255, 255];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;  // bits por canal
  header[9] = 6;  // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // sem filtro: a imagem é pequena e comprime bem
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function mix(from, to, amount) {
  return from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount));
}

// Distância com sinal até um segmento de reta engrossado (traço de caneta).
function strokeDistance(x, y, ax, ay, bx, by, radius) {
  const edgeX = bx - ax;
  const edgeY = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * edgeX + (y - ay) * edgeY) / (edgeX * edgeX + edgeY * edgeY)));
  return Math.hypot(x - ax - t * edgeX, y - ay - t * edgeY) - radius;
}

// O "A" da marca, desenhado com três traços: as duas pernas e a travessa.
// O vão triangular entre as pernas aparece sozinho, sem precisar recortar nada.
function letterDistance(x, y) {
  const apexX = 0.5;
  const apexY = 0.17;
  const baseY = 0.84;
  const stroke = 0.093;
  const left = strokeDistance(x, y, apexX, apexY, 0.185, baseY, stroke);
  const right = strokeDistance(x, y, apexX, apexY, 0.815, baseY, stroke);
  const bar = strokeDistance(x, y, 0.305, 0.625, 0.695, 0.625, stroke * 0.88);
  return Math.min(left, right, bar);
}

// Amostra um pixel do ícone; coordenadas normalizadas 0..1.
function sample(x, y, { margin, inverted }) {
  const scale = 1 - margin * 2;
  const u = (x - margin) / scale;
  const v = (y - margin) / scale;

  const background = inverted
    ? mix(BRAND, BRAND_DARK, Math.max(0, Math.min(1, x * 0.35 + y * 0.9)))
    : [255, 255, 255];
  const foreground = inverted ? WHITE : BRAND;

  const distance = letterDistance(u, v);
  const coverage = Math.max(0, Math.min(1, -distance / 0.010));
  const color = coverage > 0 ? mix(background, foreground, coverage) : background;
  return [...color, 255];
}

function render(size, { margin = 0, inverted = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = 4; // supersampling: bordas suaves sem biblioteca gráfica
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const accumulator = [0, 0, 0, 0];
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const pixel = sample((px + (sx + 0.5) / samples) / size, (py + (sy + 0.5) / samples) / size, { margin, inverted });
          for (let i = 0; i < 4; i += 1) accumulator[i] += pixel[i];
        }
      }
      const offset = (py * size + px) * 4;
      for (let i = 0; i < 4; i += 1) rgba[offset + i] = Math.round(accumulator[i] / (samples * samples));
    }
  }
  return encodePng(size, size, rgba);
}

// O "A" branco sobre o vermelho da marca, em todos os tamanhos.
const TARGETS = [
  { file: 'icon-180.png', size: 180, margin: 0.12, inverted: true },          // apple-touch-icon
  { file: 'icon-192.png', size: 192, margin: 0.12, inverted: true },
  { file: 'icon-512.png', size: 512, margin: 0.12, inverted: true },
  { file: 'icon-maskable-512.png', size: 512, margin: 0.24, inverted: true }, // safe area do Android
  { file: 'icon-notification-192.png', size: 192, margin: 0.12, inverted: true },
];

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
for (const target of TARGETS) {
  const png = render(target.size, { margin: target.margin, inverted: target.inverted });
  fs.writeFileSync(path.join(OUTPUT_DIR, target.file), png);
  console.log(`${target.file.padEnd(24)} ${target.size}x${target.size}  ${(png.length / 1024).toFixed(1)} KB`);
}
console.log(`\nÍcones gerados em ${OUTPUT_DIR}`);
