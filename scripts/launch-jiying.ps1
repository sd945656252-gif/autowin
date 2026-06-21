param(
  [switch]$Build,
  [switch]$SkipHealthCheck,
  [switch]$SkipOpenBrowser,
  [int]$PreviewPort = 3000,
  [switch]$ExactPort,
  [string]$Url
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

function Wait-LauncherUrl {
  param(
    [string]$TargetUrl,
    [int]$TimeoutSec = 20
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest $TargetUrl -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
        return $true
      }
    } catch {
    }
    Start-Sleep -Seconds 2
  }

  return $false
}

function Test-PortAvailable {
  param([int]$Port)

  try {
    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
    return @($listeners).Count -eq 0
  } catch {
    return $true
  }
}

function Resolve-PreviewPort {
  param(
    [int]$RequestedPort,
    [switch]$RequireExact
  )

  if ($RequireExact) {
    return $RequestedPort
  }

  $candidate = $RequestedPort
  for ($i = 0; $i -lt 50; $i++) {
    if (Test-PortAvailable -Port $candidate) {
      return $candidate
    }
    $candidate++
  }

  throw "Could not find an available preview port starting at $RequestedPort."
}

Write-Host "Launching JIYING..." -ForegroundColor Cyan

$PreviewPort = Resolve-PreviewPort -RequestedPort $PreviewPort -RequireExact:$ExactPort
Write-Host "Using preview port $PreviewPort" -ForegroundColor DarkCyan

if (-not $Url) {
  $Url = "http://localhost:$PreviewPort/"
}

$startArgs = @{}
if ($Build) {
  $startArgs.Build = $true
}
if ($SkipHealthCheck) {
  $startArgs.SkipHealthCheck = $true
}
$startArgs.PreviewPort = $PreviewPort

& (Join-Path $PSScriptRoot "start-podman-dev.ps1") @startArgs

if (-not $SkipOpenBrowser) {
  if (Wait-LauncherUrl -TargetUrl $Url) {
    Write-Host "Opening $Url" -ForegroundColor Green
    Start-Process $Url | Out-Null
  } else {
    Write-Warning "JIYING started, but the launcher could not confirm $Url in time."
  }
}
