param(
  [string]$ComposeProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$BackupDir = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "backups\postgres"),
  [string]$EncryptPassword = ""
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = Join-Path $BackupDir "jiying-postgres-$timestamp.sql.gz"
$tempFile = "$backupFile.tmp"
$plainTempFile = Join-Path $BackupDir "jiying-postgres-$timestamp.sql.tmp"

Push-Location $ComposeProjectDir
try {
  foreach ($file in @($tempFile, $plainTempFile)) {
    if (Test-Path -LiteralPath $file) {
      Remove-Item -LiteralPath $file -Force
    }
  }
  $podmanCommand = Get-Command podman -ErrorAction SilentlyContinue
  if (-not $podmanCommand) {
    throw "Podman CLI was not found. Install Podman Desktop or Podman CLI, run `podman machine start`, then retry."
  }
  & $podmanCommand.Source exec jiying_postgres_1 pg_dump --username=jiying --dbname=jiying --clean --if-exists > $plainTempFile
  if ($LASTEXITCODE -ne 0) {
    if (Test-Path -LiteralPath $plainTempFile) {
      Remove-Item -LiteralPath $plainTempFile -Force
    }
    throw "pg_dump failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

$tempItem = Get-Item -LiteralPath $plainTempFile -ErrorAction Stop
if ($tempItem.Length -le 0) {
  Remove-Item -LiteralPath $plainTempFile -Force
  throw "pg_dump produced an empty backup file."
}

$sourceStream = [System.IO.File]::OpenRead($plainTempFile)
$targetStream = [System.IO.File]::Create($tempFile)
try {
  $gzipStream = [System.IO.Compression.GzipStream]::new($targetStream, [System.IO.Compression.CompressionLevel]::Optimal)
  try {
    $sourceStream.CopyTo($gzipStream)
  } finally {
    $gzipStream.Dispose()
  }
} finally {
  $sourceStream.Dispose()
  $targetStream.Dispose()
}
Remove-Item -LiteralPath $plainTempFile -Force

Move-Item -LiteralPath $tempFile -Destination $backupFile -Force

if ($EncryptPassword) {
  $encryptedFile = "$backupFile.enc"
  openssl enc -aes-256-cbc -salt -pbkdf2 -in $backupFile -out $encryptedFile -pass pass:$EncryptPassword
  if ($LASTEXITCODE -ne 0) {
    throw "openssl encryption failed with exit code $LASTEXITCODE."
  }
  Remove-Item -LiteralPath $backupFile -Force
  $backupFile = $encryptedFile
}

Get-ChildItem -LiteralPath $BackupDir -Filter "jiying-postgres-*.sql.gz*" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 7 |
  Remove-Item -Force

Write-Host "Postgres backup created: $backupFile"
