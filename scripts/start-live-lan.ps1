$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$preferredIp = $env:JIYING_LAN_IP
if (-not $preferredIp) {
  $preferredIp = "172.19.1.27"
}

$lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -eq $preferredIp } |
  Select-Object -First 1 -ExpandProperty IPAddress

if (-not $lanIp) {
  $lanIp = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
    Where-Object {
      $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
      $_.IPAddressToString -notlike "127.*" -and
      $_.IPAddressToString -notlike "169.254.*"
    } |
    Select-Object -First 1 -ExpandProperty IPAddressToString
}

if (-not $lanIp) {
  throw "No LAN IPv4 address was found. Connect to Wi-Fi/Ethernet and retry."
}

$publicUrl = "http://$lanIp`:3000"
$shareEnvPath = Join-Path $projectRoot ".env.live-lan"
$envPath = Join-Path $projectRoot ".env"

if (-not (Test-Path -LiteralPath $envPath)) {
  throw ".env was not found. Copy .env.example to .env and configure local secrets first."
}

$envText = Get-Content -LiteralPath $envPath -Raw
$encryptionKeyMatch = [regex]::Match($envText, "(?m)^ENCRYPTION_KEY\s*=\s*(.+?)\s*$")
if (-not $encryptionKeyMatch.Success) {
  throw "ENCRYPTION_KEY is missing in .env. Generate a strong local key before sharing the LAN preview."
}

$encryptionKey = $encryptionKeyMatch.Groups[1].Value.Trim()
if ($encryptionKey -eq "dev_jiying_32_byte_secret_key_01" -or $encryptionKey -eq "replace_with_32_byte_secret_key") {
  throw "ENCRYPTION_KEY still uses a development default. Set a unique key in .env before sharing the LAN preview."
}

foreach ($line in ($envText -split "`r?`n")) {
  if ($line -match "^\s*#" -or $line -notmatch "^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$") {
    continue
  }
  $name = $Matches[1]
  $value = $Matches[2].Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  [Environment]::SetEnvironmentVariable($name, $value, "Process")
}

[Environment]::SetEnvironmentVariable("PUBLIC_APP_URL", $publicUrl, "Process")
[Environment]::SetEnvironmentVariable("APP_URL", $publicUrl, "Process")
[Environment]::SetEnvironmentVariable("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,$publicUrl", "Process")

@"
PUBLIC_APP_URL=$publicUrl
APP_URL=$publicUrl
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,$publicUrl
LOCAL_TEAM_MODE=true
REQUIRE_AUTH_FOR_TEAM_MODE=true
REQUIRE_STRONG_LOCAL_SECRETS=true
"@ | Set-Content -LiteralPath $shareEnvPath -Encoding ASCII

Write-Host "Preparing Prisma Client once before live containers start..."
& (Join-Path $PSScriptRoot "invoke-podman-compose.ps1") --env-file .env --env-file .env.live-lan run --rm migrate npx prisma generate

Write-Host "Recreating web and worker containers so they use the latest live environment..."
podman rm -f jiying_jiying-web_1 jiying_jiying-worker_1 2>$null | Out-Null

Write-Host "Starting JIYING live LAN containers with source watch..."
try {
  & (Join-Path $PSScriptRoot "invoke-podman-compose.ps1") --env-file .env --env-file .env.live-lan up -d --no-build jiying-web jiying-worker
} catch {
  Write-Warning "podman compose could not recreate web/worker cleanly. Falling back to direct podman run."

  $commonEnv = @(
    "-e", "NODE_ENV=development",
    "-e", "RUNNING_IN_DOCKER=1",
    "-e", "NO_UPDATE_NOTIFIER=1",
    "-e", "PRISMA_HIDE_UPDATE_MESSAGE=true",
    "-e", "DATABASE_URL=postgresql://jiying:jiying_dev_password@postgres:5432/jiying?schema=public",
    "-e", "REDIS_URL=redis://redis:6379",
    "-e", "HTTP_PROXY=$env:CONTAINER_HTTP_PROXY",
    "-e", "HTTPS_PROXY=$env:CONTAINER_HTTPS_PROXY",
    "-e", "ALL_PROXY=$env:CONTAINER_ALL_PROXY",
    "-e", "NO_PROXY=$env:CONTAINER_NO_PROXY",
    "-e", "ENCRYPTION_KEY=$env:ENCRYPTION_KEY"
  )

  podman run -d --name jiying_jiying-web_1 --network jiying_default --network-alias jiying-web --replace -w /app -p 0.0.0.0:3000:3000 `
    @commonEnv `
    -e WORKFLOW_WORKER_ENABLED=false `
    -e SCRIPT_WORKER_ENABLED=false `
    -e HOST=0.0.0.0 `
    -e PORT=3000 `
    -e APP_URL=$publicUrl `
    -e PUBLIC_APP_URL=$publicUrl `
    -e ALLOWED_ORIGINS="http://localhost:3000,http://127.0.0.1:3000,$publicUrl" `
    -v "${projectRoot}:/app" `
    -v jiying_node_modules:/app/node_modules `
    -v jiying_uploads:/app/uploads `
    localhost/jiying_jiying-web:latest sh -c "npm run dev:server:watch" | Out-Null

  podman run -d --name jiying_jiying-worker_1 --network jiying_default --network-alias jiying-worker --replace -w /app `
    @commonEnv `
    -v "${projectRoot}:/app" `
    -v jiying_node_modules:/app/node_modules `
    -v jiying_uploads:/app/uploads `
    -v jiying_private_storage:/app/storage/private `
    localhost/jiying_jiying-worker:latest sh -c "npm run dev:worker:watch" | Out-Null
}

Write-Host ""
Write-Host "JIYING live LAN URL:"
Write-Host "  $publicUrl"
Write-Host ""
Write-Host "Containers use mounted source code and watch mode. Frontend HMR and backend/worker restarts should apply code changes automatically."
