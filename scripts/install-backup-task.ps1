param(
  [string]$TaskName = "JiyingPostgresDailyBackup",
  [string]$At = "03:30"
)

$ErrorActionPreference = "Stop"

$projectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backupScript = Join-Path $projectDir "scripts\backup-postgres.ps1"

if (-not (Test-Path -LiteralPath $backupScript)) {
  throw "Backup script not found: $backupScript"
}

$time = [DateTime]::ParseExact($At, "HH:mm", $null)
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backupScript`""
$trigger = New-ScheduledTaskTrigger -Daily -At $time
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Scheduled task installed: $TaskName daily at $At"
Write-Host "Backup script: $backupScript"
