const baseUrl = String(process.argv[2] || 'https://agrorisk-sompo.vercel.app').replace(/\/$/, '');

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(30_000) });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${body.error || 'erro'}`);
  return body;
}

async function main() {
  const [dashboardPage, mappingPage] = await Promise.all([
    fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(15_000) }).then((response) => response.text()),
    fetch(`${baseUrl}/mapeamento-riscos.html`, { signal: AbortSignal.timeout(15_000) }).then((response) => response.text()),
  ]);
  if (!dashboardPage.includes('Mapeamento de Riscos') || dashboardPage.includes('class="card risk-mapping-card"')) throw new Error('Dashboard principal não foi simplificado');
  if (!mappingPage.includes('Mapeamento híbrido de áreas de risco')) throw new Error('Aba de mapeamento não está em produção');
  const discovery = await jsonRequest('/api/risk-discovery?latitude=-23.55052&longitude=-46.633308&radius=500');
  const headers = { origin: baseUrl, host: new URL(baseUrl).host, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  let created;
  try {
    created = await jsonRequest('/api/danger-zones', {
      method: 'POST', headers,
      body: JSON.stringify({ zone: { id: `smoke-${Date.now()}`, name: 'Validação temporária', category: 'other', coordinates: [[-23.55, -46.63], [-23.5501, -46.6301]], closed: false, warningMeters: 150, criticalMeters: 60 } }),
    });
  } finally {
    if (created?.id) await jsonRequest(`/api/danger-zones?id=${encodeURIComponent(created.id)}`, { method: 'DELETE', headers });
  }
  console.log(JSON.stringify({ ok: true, dashboardSimplified: true, mappingTab: true, openStreetMapCandidates: discovery.candidates.length, zoneMutation: true, cleanup: true }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
