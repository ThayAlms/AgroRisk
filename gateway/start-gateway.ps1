$localKey = [Environment]::GetEnvironmentVariable('AGRORISK_DEVICE_API_KEY', 'User')
if ($localKey) {
  $env:AGRORISK_DEVICE_API_KEY = $localKey
}

node --env-file-if-exists=.env --env-file-if-exists=.vercel/.env.production.local gateway/index.js
