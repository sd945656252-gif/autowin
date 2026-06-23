$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$ip = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
  Where-Object {
    $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
    $_.IPAddressToString -notlike "127.*" -and
    $_.IPAddressToString -notlike "169.254.*"
  } |
  Select-Object -First 1 -ExpandProperty IPAddressToString

if (-not $ip) {
  throw "No LAN IPv4 address was found. Connect to Wi-Fi/Ethernet and retry."
}

$publicUrl = "http://$ip`:3000"
$shareEnvPath = Join-Path $projectRoot ".env.share"
$envPath = Join-Path $projectRoot ".env"

if (-not (Test-Path -LiteralPath $envPath)) {
  throw ".env was not found. Copy .env.example to .env and set strong local secrets before sharing."
}

$envText = Get-Content -LiteralPath $envPath -Raw
if ($envText -match "(?m)^ENCRYPTION_KEY\s*=\s*(replace_with_32_byte_secret_key|dev_jiying_32_byte_secret_key_01)\s*$") {
  throw "Refusing to share with a default ENCRYPTION_KEY. Set a unique 32-byte ENCRYPTION_KEY in .env."
}
if ($envText -match "(?m)^SEED_ADMIN_PASSWORD\s*=\s*JiyingAdmin123!\s*$") {
  throw "Refusing to share with the default SEED_ADMIN_PASSWORD. Set a strong password and rerun npm run db:seed."
}

@"
PUBLIC_APP_URL=$publicUrl
APP_URL=$publicUrl
LOCAL_TEAM_MODE=true
REQUIRE_AUTH_FOR_TEAM_MODE=true
REQUIRE_STRONG_LOCAL_SECRETS=true
"@ | Set-Content -LiteralPath $shareEnvPath -Encoding ASCII

Write-Host "Starting JIYING shared live preview..."
& (Join-Path $PSScriptRoot "start-live-lan.ps1")

Write-Host ""
Write-Host "JIYING is running. Share this URL with devices on the same LAN:"
Write-Host "  $publicUrl"
Write-Host ""
Write-Host "If another computer cannot open it, allow TCP port 3000 through Windows Firewall."
