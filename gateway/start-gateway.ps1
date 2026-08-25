if (-not (Test-Path 'node_modules')) {
  Write-Host 'Primeira execucao neste computador: instalando dependencias...' -ForegroundColor Yellow
  npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'Falha ao instalar dependencias. Rode "npm install" manualmente e tente novamente.' -ForegroundColor Red
    exit 1
  }
}

if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host ''
  Write-Host 'Arquivo .env criado a partir de .env.example neste computador.' -ForegroundColor Yellow
  Write-Host 'Preencha CLOUD_API_URL, DEVICE_ID e DEVICE_API_KEY em .env antes de continuar (a chave deve ser igual a cadastrada na Vercel).' -ForegroundColor Yellow
  Write-Host 'Dica: para nao repetir isso em outros clones neste mesmo computador, defina a variavel de usuario do Windows AGRORISK_DEVICE_API_KEY.' -ForegroundColor Yellow
  Write-Host ''
  exit 1
}

$localKey = [Environment]::GetEnvironmentVariable('AGRORISK_DEVICE_API_KEY', 'User')
if ($localKey) {
  $env:AGRORISK_DEVICE_API_KEY = $localKey
}

node --env-file-if-exists=.env --env-file-if-exists=.vercel/.env.production.local gateway/index.js
