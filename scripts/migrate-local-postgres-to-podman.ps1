param(
  [string]$SourceDatabaseUrl = "postgresql://jiying:jiying_dev_password@localhost:5432/jiying?schema=public",
  [string]$ComposeProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$BackupDir = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "backups\postgres"),
  [string]$PgDumpPath = "",
  [switch]$SkipComposeUp
)

$ErrorActionPreference = "Stop"

function Resolve-PgDump {
  param([string]$ExplicitPath)

  if ($ExplicitPath) {
    if (-not (Test-Path -LiteralPath $ExplicitPath)) {
      throw "pg_dump was not found at PgDumpPath: $ExplicitPath"
    }
    return (Resolve-Path -LiteralPath $ExplicitPath).Path
  }

  $command = Get-Command pg_dump -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidates = @(
    "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe",
    "C:\Program Files\PostgreSQL\15\bin\pg_dump.exe",
    "C:\Program Files\PostgreSQL\14\bin\pg_dump.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  throw "pg_dump.exe was not found. Add PostgreSQL bin to PATH or pass -PgDumpPath."
}

function Convert-PrismaUrlToPgUrl {
  param([string]$DatabaseUrl)

  $uriBuilder = [System.UriBuilder]::new($DatabaseUrl)
  $query = [System.Web.HttpUtility]::ParseQueryString($uriBuilder.Query)
  $query.Remove("schema")
  $uriBuilder.Query = $query.ToString()
  return $uriBuilder.Uri.AbsoluteUri
}

$compose = Join-Path $PSScriptRoot "invoke-podman-compose.ps1"
if (-not (Test-Path -LiteralPath $compose)) {
  throw "Podman Compose helper was not found: $compose"
}
$podmanCommand = Get-Command podman -ErrorAction SilentlyContinue
if (-not $podmanCommand) {
  throw "Podman CLI was not found. Install Podman Desktop or Podman CLI, run `podman machine start`, then retry."
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$plainBackup = Join-Path $BackupDir "jiying-local-postgres-before-podman-$timestamp.sql"
$compressedBackup = "$plainBackup.gz"
$pgDump = Resolve-PgDump -ExplicitPath $PgDumpPath
$pgDumpDatabaseUrl = Convert-PrismaUrlToPgUrl -DatabaseUrl $SourceDatabaseUrl

Write-Host "Exporting source PostgreSQL database..."
& $pgDump --dbname=$pgDumpDatabaseUrl --clean --if-exists --file=$plainBackup
if ($LASTEXITCODE -ne 0) {
  if (Test-Path -LiteralPath $plainBackup) {
    Remove-Item -LiteralPath $plainBackup -Force
  }
  throw "pg_dump failed with exit code $LASTEXITCODE."
}

$backupItem = Get-Item -LiteralPath $plainBackup -ErrorAction Stop
if ($backupItem.Length -le 0) {
  Remove-Item -LiteralPath $plainBackup -Force
  throw "pg_dump produced an empty backup file."
}

$sourceStream = [System.IO.File]::OpenRead($plainBackup)
$targetStream = [System.IO.File]::Create($compressedBackup)
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

Push-Location $ComposeProjectDir
try {
  if (-not $SkipComposeUp) {
    Write-Host "Starting Podman PostgreSQL..."
    & $compose up -d postgres
  }

  Write-Host "Waiting for Podman PostgreSQL to become ready..."
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    try {
      & $podmanCommand.Source exec jiying_postgres_1 pg_isready --username=jiying --dbname=jiying | Out-Null
      $ready = $true
      break
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  if (-not $ready) {
    throw "Podman PostgreSQL did not become ready within 60 seconds."
  }

  Write-Host "Importing backup into Podman PostgreSQL..."
  Get-Content -LiteralPath $plainBackup -Encoding UTF8 | & $podmanCommand.Source exec -i jiying_postgres_1 psql --username=jiying --dbname=jiying
  if ($LASTEXITCODE -ne 0) {
    throw "psql import failed with exit code $LASTEXITCODE."
  }

  Write-Host "Checking Prisma migration status against Podman PostgreSQL..."
  & (Join-Path $PSScriptRoot "prisma-local.ps1") migrate status

  Write-Host "Checking application health endpoint..."
  try {
    Invoke-WebRequest "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 10 | Out-Null
  } catch {
    Write-Warning "Health endpoint is not reachable yet. Start the full stack with `podman compose up --build -d` and retry the health check."
  }
} finally {
  Pop-Location
}

Remove-Item -LiteralPath $plainBackup -Force
Write-Host "Local PostgreSQL data migrated into Podman PostgreSQL."
Write-Host "Backup retained: $compressedBackup"
