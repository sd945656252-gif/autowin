param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$ComposeProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$DecryptPassword = "",
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
$resolvedBackup = Resolve-Path -LiteralPath $BackupFile
$tempSqlFile = Join-Path ([System.IO.Path]::GetTempPath()) "jiying-restore-$([System.Guid]::NewGuid()).sql"
$tempGzipFile = Join-Path ([System.IO.Path]::GetTempPath()) "jiying-restore-$([System.Guid]::NewGuid()).sql.gz"

if (-not $Yes) {
  Write-Warning "This restore will overwrite data in the jiying Postgres database."
  Write-Warning "Backup file: $resolvedBackup"
  $confirmation = Read-Host "Type RESTORE to continue"
  if ($confirmation -ne "RESTORE") {
    throw "Restore cancelled."
  }
}

function Expand-GzipFile {
  param(
    [string]$SourceFile,
    [string]$DestinationFile
  )
  $sourceStream = [System.IO.File]::OpenRead($SourceFile)
  $targetStream = [System.IO.File]::Create($DestinationFile)
  try {
    $gzipStream = [System.IO.Compression.GzipStream]::new($sourceStream, [System.IO.Compression.CompressionMode]::Decompress)
    try {
      $gzipStream.CopyTo($targetStream)
    } finally {
      $gzipStream.Dispose()
    }
  } finally {
    $sourceStream.Dispose()
    $targetStream.Dispose()
  }
}

try {
  $backupPath = $resolvedBackup.Path
  if ($backupPath.EndsWith(".sql.gz.enc")) {
    if (-not $DecryptPassword) {
      throw "DecryptPassword is required for encrypted backups."
    }
    openssl enc -d -aes-256-cbc -pbkdf2 -in $backupPath -out $tempGzipFile -pass pass:$DecryptPassword
    if ($LASTEXITCODE -ne 0) {
      throw "openssl decryption failed with exit code $LASTEXITCODE."
    }
    Expand-GzipFile -SourceFile $tempGzipFile -DestinationFile $tempSqlFile
  } elseif ($backupPath.EndsWith(".sql.gz")) {
    Expand-GzipFile -SourceFile $backupPath -DestinationFile $tempSqlFile
  } elseif ($backupPath.EndsWith(".sql")) {
    Copy-Item -LiteralPath $backupPath -Destination $tempSqlFile -Force
  } else {
    throw "Unsupported backup format. Expected .sql, .sql.gz, or .sql.gz.enc."
  }

  $sqlItem = Get-Item -LiteralPath $tempSqlFile -ErrorAction Stop
  if ($sqlItem.Length -le 0) {
    throw "Restore SQL is empty."
  }

  Push-Location $ComposeProjectDir
  try {
    $podmanCommand = Get-Command podman -ErrorAction SilentlyContinue
    if (-not $podmanCommand) {
      throw "Podman CLI was not found. Install Podman Desktop or Podman CLI, run `podman machine start`, then retry."
    }
    Get-Content -LiteralPath $tempSqlFile -Encoding UTF8 | & $podmanCommand.Source exec -i jiying_postgres_1 psql --username=jiying --dbname=jiying
    if ($LASTEXITCODE -ne 0) {
      throw "psql restore failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
} finally {
  foreach ($file in @($tempSqlFile, $tempGzipFile)) {
    if (Test-Path -LiteralPath $file) {
      Remove-Item -LiteralPath $file -Force
    }
  }
}

Write-Host "Postgres restore completed from: $resolvedBackup"
