param(
  [switch]$SkipLint,
  [switch]$Browser,
  [switch]$ProductionAssets,
  [switch]$StrictPodman
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

$failed = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Write-Check {
  param(
    [string]$Name,
    [scriptblock]$Check
  )

  Write-Host "Checking $Name..."
  try {
    & $Check
    Write-Host "  OK $Name" -ForegroundColor Green
  } catch {
    $message = $_.Exception.Message
    $failed.Add("${Name}: ${message}") | Out-Null
    Write-Host "  FAIL $Name - $message" -ForegroundColor Red
  }
}

function Write-WarnCheck {
  param(
    [string]$Name,
    [scriptblock]$Check
  )

  Write-Host "Checking $Name..."
  try {
    & $Check
    Write-Host "  OK $Name" -ForegroundColor Green
  } catch {
    $message = $_.Exception.Message
    $warnings.Add("${Name}: ${message}") | Out-Null
    Write-Host "  WARN $Name - $message" -ForegroundColor Yellow
  }
}

function Invoke-CheckedCommand {
  param(
    [string]$Name,
    [string]$FilePath,
    [string[]]$Arguments
  )

  $output = & $FilePath @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    $tail = ($output | Select-Object -Last 30) -join "`n"
    throw "$Name exited with code $exitCode.`n$tail"
  }
}

function Write-PodmanCheck {
  param(
    [string]$Name,
    [scriptblock]$Check
  )

  if ($StrictPodman) {
    Write-Check $Name $Check
  } else {
    Write-WarnCheck $Name $Check
  }
}

function Assert-HttpOk {
  param(
    [string]$Url,
    [int]$TimeoutSec = 8
  )

  $response = Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec $TimeoutSec
  if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
    throw "$Url returned HTTP $($response.StatusCode)"
  }
}

function Read-JsonEndpoint {
  param(
    [string]$Url,
    [int]$TimeoutSec = 8
  )

  $response = Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec $TimeoutSec
  if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
    throw "$Url returned HTTP $($response.StatusCode)"
  }
  return $response.Content | ConvertFrom-Json
}

function Get-LocalPortListeners {
  param([int]$Port)

  try {
    return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
      Select-Object -Property LocalAddress, LocalPort, OwningProcess -Unique)
  } catch {
    $rows = netstat -ano -p tcp 2>$null | Select-String -Pattern "LISTENING"
    return @($rows | ForEach-Object {
      $parts = ($_ -replace "^\s+", "") -split "\s+"
      if ($parts.Count -ge 5 -and $parts[1] -match "[:.]$Port$") {
        [pscustomobject]@{
          LocalAddress = ($parts[1] -replace "[:.]$Port$", "")
          LocalPort = $Port
          OwningProcess = [int]$parts[4]
        }
      }
    } | Where-Object { $_ })
  }
}

function Get-ProcessCommandLine {
  param([int]$ProcessId)

  try {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    return [string]$process.CommandLine
  } catch {
    return ""
  }
}

function Test-ProjectLocalApiCommand {
  param([string]$CommandLine)

  if (-not $CommandLine) { return $false }
  $projectPattern = [regex]::Escape($projectRoot.ProviderPath)
  return $CommandLine -match $projectPattern -and $CommandLine -match "apps[/\\]api[/\\]src[/\\]server\.ts"
}

function Test-PodmanPreviewForwarderCommand {
  param([string]$CommandLine)

  if (-not $CommandLine) { return $false }
  return $CommandLine -match "podman-container-port-forwarder\.mjs" -and $CommandLine -match "jiying_jiying-web_1"
}

function Test-WslPortForwarderCommand {
  param([string]$CommandLine)

  if (-not $CommandLine) { return $false }
  return $CommandLine -match "--vm-id\s+\{[0-9a-fA-F-]+\}" -and $CommandLine -match "--handle\s+\d+"
}

Write-Host "JIYING development environment check"
Write-Host "Project: $projectRoot"
Write-Host ""

Write-Check "Podman CLI" {
  $podman = Get-Command podman -ErrorAction SilentlyContinue
  if (-not $podman) { throw "podman was not found in PATH." }
  Invoke-CheckedCommand -Name "podman --version" -FilePath $podman.Source -Arguments @("--version")
}

Write-PodmanCheck "Podman machine/info" {
  $podman = Get-Command podman -ErrorAction Stop
  Invoke-CheckedCommand -Name "podman info" -FilePath $podman.Source -Arguments @("info")
}

Write-PodmanCheck "Podman Compose services" {
  $podman = Get-Command podman -ErrorAction Stop
  Invoke-CheckedCommand -Name "podman ps postgres" -FilePath $podman.Source -Arguments @("ps", "--filter", "name=jiying_postgres_1", "--format", "{{.Names}} {{.Status}}")
  Invoke-CheckedCommand -Name "podman ps redis" -FilePath $podman.Source -Arguments @("ps", "--filter", "name=jiying_redis_1", "--format", "{{.Names}} {{.Status}}")
  Invoke-CheckedCommand -Name "podman ps web" -FilePath $podman.Source -Arguments @("ps", "--filter", "name=jiying_jiying-web_1", "--format", "{{.Names}} {{.Status}}")
  Invoke-CheckedCommand -Name "podman ps worker" -FilePath $podman.Source -Arguments @("ps", "--filter", "name=jiying_jiying-worker_1", "--format", "{{.Names}} {{.Status}}")
}

Write-Check "Preview port ownership" {
  $listeners = Get-LocalPortListeners -Port 3000
  if ($listeners.Count -eq 0) {
    throw "localhost:3000 is not listening."
  }
  $recognized = $false
  foreach ($listener in $listeners) {
    $processId = [int]$listener.OwningProcess
    $commandLine = Get-ProcessCommandLine -ProcessId $processId
    if (Test-ProjectLocalApiCommand -CommandLine $commandLine) {
      throw "The active preview port is owned by the local JIYING API process (PID $processId), not the Podman preview. Stop it and run scripts/start-podman-dev.ps1."
    }
    if (Test-PodmanPreviewForwarderCommand -CommandLine $commandLine) {
      $recognized = $true
      continue
    }
    if (Test-WslPortForwarderCommand -CommandLine $commandLine) {
      $recognized = $true
      continue
    }
    Write-Host "  WARN localhost:3000 is owned by PID $processId. Command: $commandLine" -ForegroundColor Yellow
  }
  if (-not $recognized) {
    Write-Host "  WARN no explicit Podman preview forwarder was detected. API/Web health checks will verify the endpoint." -ForegroundColor Yellow
  }
}

Write-Check "API health" {
  $health = Read-JsonEndpoint -Url "http://localhost:3000/api/health"
  if ($health.status -ne "ok") {
    throw "API health status is $($health.status)."
  }
}

Write-Check "API runtime source" {
  $health = Read-JsonEndpoint -Url "http://localhost:3000/api/health"
  if ($health.runtime.container -ne $true) {
    throw "localhost:3000 is not served by the Podman/container backend. Run scripts/start-podman-dev.ps1."
  }
}

Write-Check "Web preview" {
  Assert-HttpOk -Url "http://localhost:3000/"
}

Write-Check "Prisma migrate status" {
  $script = Join-Path $projectRoot "scripts\prisma-local.ps1"
  & powershell -ExecutionPolicy Bypass -File $script migrate status | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Prisma migrate status failed." }
}

if (-not $SkipLint) {
  Write-Check "TypeScript lint" {
    $env:NODE_OPTIONS = "--max-old-space-size=8192"
    Invoke-CheckedCommand -Name "npm run lint" -FilePath "npm.cmd" -Arguments @("run", "lint")
  }
}

if ($Browser) {
  Write-WarnCheck "Browser console" {
    Invoke-CheckedCommand -Name "browser console check" -FilePath "node" -Arguments @("scripts/browser-console-check.mjs", "http://localhost:3000/", "http://localhost:3000/pipeline")
  }
}

if ($ProductionAssets) {
  Write-Check "Production asset smoke suite" {
    Invoke-CheckedCommand -Name "npm run workflow:smoke:production-assets" -FilePath "npm.cmd" -Arguments @("run", "workflow:smoke:production-assets")
  }
}

Write-Host ""
if ($warnings.Count -gt 0) {
  Write-Host "Development check warnings:" -ForegroundColor Yellow
  foreach ($item in $warnings) {
    Write-Host " - $item" -ForegroundColor Yellow
  }
}

if ($failed.Count -gt 0) {
  Write-Host "Development check failed:" -ForegroundColor Red
  foreach ($item in $failed) {
    Write-Host " - $item" -ForegroundColor Red
  }
  exit 1
}

Write-Host "Development check passed. Realtime preview should be ready at http://localhost:3000/" -ForegroundColor Green
