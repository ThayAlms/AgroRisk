/* Servidor de pré-visualização: emula o roteamento da Vercel sem serialport e sem banco.
   Uso: node --env-file-if-exists=.env.local scripts/preview-server.js */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PREVIEW_PORT || 4000);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };

function adapt(response) {
  // Preserva o setHeader nativo: os handlers dependem dele para declarar o charset.
  response.status = (code) => { response.statusCode = code; return response; };
  response.json = (payload) => response.end(Buffer.from(JSON.stringify(payload), 'utf8'));
  return response;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname.startsWith('/api')) {
    request.query = Object.fromEntries(url.searchParams);
    request.query.route = request.query.route || url.pathname.replace(/^\/api\/?/, '');
    request.body = await readBody(request);
    return require('../api/index.js')(request, adapt(response));
  }
  const file = path.join(PUBLIC_DIR, url.pathname === '/' ? 'login.html' : url.pathname.replace(/^\/+/, ''));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file)) { response.statusCode = 404; return response.end('não encontrado'); }
  response.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(response);
}).listen(PORT, () => console.log(`Pré-visualização em http://localhost:${PORT}`));
