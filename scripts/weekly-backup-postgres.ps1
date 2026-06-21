param(
  [string]$BackupDir = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "backups\postgres"),
  [string]$WeeklyDir = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "backups\postgres\weekly")
)

$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "backup-postgres.ps1") -BackupDir $BackupDir

New-Item -ItemType Directory -Force -Path $WeeklyDir | Out-Null
$latest = Get-ChildItem -LiteralPath $BackupDir -Filter "jiying-postgres-*.sql.gz*" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $latest) {
  throw "No daily backup found to archive weekly."
}

$weeklyName = $latest.Name -replace '^jiying-postgres-', "jiying-postgres-weekly-"
Copy-Item -LiteralPath $latest.FullName -Destination (Join-Path $WeeklyDir $weeklyName) -Force

Get-ChildItem -LiteralPath $WeeklyDir -Filter "jiying-postgres-weekly-*.sql.gz*" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 4 |
  Remove-Item -Force

Write-Host "Weekly backup archived: $weeklyName"
