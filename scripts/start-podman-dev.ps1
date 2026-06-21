param(
  [switch]$Build,
  [switch]$SkipHealthCheck,
  [int]$PreviewPort = 3000
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

$pythonScripts = Join-Path $env:APPDATA "Python\Python38\Scripts"
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") + ";" + $pythonScripts

$podman = Get-Command podman -ErrorAction SilentlyContinue
if (-not $podman) {
  throw "Podman CLI was not found. Install Podman Desktop and Podman CLI, then retry."
}

$podmanComposeProvider = Join-Path $env:APPDATA "Python\Python38\Scripts\podman-compose.exe"
if (-not (Test-Path -LiteralPath $podmanComposeProvider)) {
  throw "podman-compose provider was not found at $podmanComposeProvider. Install it with `py -m pip install --user podman-compose`, then retry."
}

function Ensure-PodmanProxyForwarder {
  $containerProxy = $env:CONTAINER_HTTPS_PROXY
  $envPath = Join-Path $projectRoot ".env"
  if (-not $containerProxy) {
    if (Test-Path -LiteralPath $envPath) {
      $containerProxy = (Get-Content -LiteralPath $envPath | Where-Object { $_ -match "^CONTAINER_HTTPS_PROXY=" } | Select-Object -First 1) -replace "^CONTAINER_HTTPS_PROXY=", ""
    }
  }
  if (-not $containerProxy -or $containerProxy -notmatch ":(\d+)$") {
    return
  }

  $listenPort = [int]$Matches[1]
  if ($containerProxy -match "host\.containers\.internal") {
    $hostIp = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
      Where-Object { $_.AddressFamily -eq "InterNetwork" -and $_.IPAddressToString -notlike "127.*" -and $_.IPAddressToString -notlike "169.254.*" } |
      Select-Object -First 1 -ExpandProperty IPAddressToString

    if ($hostIp -and (Test-Path -LiteralPath $envPath)) {
      $replacement = "http://${hostIp}:${listenPort}"
      $env:CONTAINER_HTTPS_PROXY = $replacement
      $env:CONTAINER_HTTP_PROXY = $replacement
      $env:CONTAINER_ALL_PROXY = $replacement
      $envLines = Get-Content -LiteralPath $envPath
      $envLines = $envLines | ForEach-Object {
        if ($_ -match "^CONTAINER_HTTPS_PROXY=") { "CONTAINER_HTTPS_PROXY=$replacement" }
        elseif ($_ -match "^CONTAINER_HTTP_PROXY=") { "CONTAINER_HTTP_PROXY=$replacement" }
        elseif ($_ -match "^CONTAINER_ALL_PROXY=") { "CONTAINER_ALL_PROXY=$replacement" }
        else { $_ }
      }
      Set-Content -LiteralPath $envPath -Value $envLines
      Write-Host "Updated Podman container proxy host to $replacement"
    }
  }

  $hostProxy = $env:HTTPS_PROXY
  if (-not $hostProxy) {
    $hostProxy = [Environment]::GetEnvironmentVariable("HTTPS_PROXY", "User")
  }
  if (-not $hostProxy) {
    $hostProxy = [Environment]::GetEnvironmentVariable("HTTPS_PROXY", "Machine")
  }
  if (-not $hostProxy -or $hostProxy -notmatch "127\.0\.0\.1:(\d+)") {
    Write-Host "CONTAINER_HTTPS_PROXY is set, but no local HTTPS_PROXY on 127.0.0.1 was found. Skipping proxy forwarder."
    return
  }

  $targetPort = [int]$Matches[1]
  $listener = Get-NetTCPConnection -LocalPort $listenPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    return
  }

  $forwarder = Join-Path $projectRoot "scripts\podman-proxy-forwarder.mjs"
  if (-not (Test-Path -LiteralPath $forwarder)) {
    throw "Proxy forwarder script was not found: $forwarder"
  }

  Write-Host "Starting Podman proxy forwarder: 0.0.0.0:$listenPort -> 127.0.0.1:$targetPort"
  Start-Process -FilePath "node" -ArgumentList @($forwarder, $listenPort, "127.0.0.1", $targetPort) -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 1
}

Ensure-PodmanProxyForwarder

$machineList = & $podman.Source machine list --format json 2>$null
if (-not $machineList -or $machineList.Trim() -eq "[]") {
  & $podman.Source machine init
}

$runningMachine = & $podman.Source machine list --format "{{.Name}} {{.Running}}" | Where-Object { $_ -match "\s+true$" } | Select-Object -First 1
if (-not $runningMachine) {
  & $podman.Source machine start
}

$env:COMPOSE_PROJECT_NAME = "jiying"
$env:PODMAN_COMPOSE_PROVIDER = $podmanComposeProvider
$env:JIYING_DEV_IMAGE = "localhost/jiying-dev:latest"
$composeProjectName = "jiying"

Write-Host "Starting JIYING Podman development stack..."

function Invoke-PodmanComposeCommand {
  param(
    [string[]]$Arguments,
    [string]$Description
  )

  $composeArgs = @("compose", "-p", $composeProjectName) + $Arguments
  $stdoutPath = Join-Path $env:TEMP "jiying-compose-stdout.log"
  $stderrPath = Join-Path $env:TEMP "jiying-compose-stderr.log"
  if (Test-Path -LiteralPath $stdoutPath) { Remove-Item -LiteralPath $stdoutPath -Force }
  if (Test-Path -LiteralPath $stderrPath) { Remove-Item -LiteralPath $stderrPath -Force }

  $process = Start-Process -FilePath $podman.Source -ArgumentList $composeArgs -NoNewWindow -PassThru -Wait `
    -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  $exitCode = $process.ExitCode

  foreach ($path in @($stdoutPath, $stderrPath)) {
    if (-not (Test-Path -LiteralPath $path)) {
      continue
    }
    foreach ($line in Get-Content -LiteralPath $path) {
      if ($line) {
        Write-Host $line
      }
    }
  }

  if ($exitCode -ne 0) {
    throw "$Description failed with exit code $exitCode."
  }
}

function Test-PodmanContainer {
  param([string]$Name)
  & $podman.Source container exists $Name 2>$null
  return $LASTEXITCODE -eq 0
}

function Get-ServiceContainerName {
  param([string]$Service)

  $filterArgs = @(
    "ps",
    "-a",
    "--filter", "label=com.docker.compose.project=$composeProjectName",
    "--filter", "label=com.docker.compose.service=$Service",
    "--format", "{{.Names}}"
  )
  $name = (& $podman.Source @filterArgs 2>$null | Select-Object -First 1)
  return [string]$name
}

function Start-PodmanContainerIfPresent {
  param([string]$Name)
  if (Test-PodmanContainer -Name $Name) {
    & $podman.Source start $Name | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to start container $Name."
    }
    return $true
  }
  return $false
}

function Test-LocalApiHealth {
  try {
    $response = Invoke-WebRequest "http://localhost:$PreviewPort/api/health" -UseBasicParsing -TimeoutSec 5
    return $response.StatusCode -eq 200
  } catch {
    return $false
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

function Invoke-StartupCheck {
  param(
    [string]$Name,
    [scriptblock]$Check
  )

  Write-Host "  Checking $Name..."
  try {
    & $Check
    Write-Host "  OK $Name" -ForegroundColor Green
  } catch {
    throw "$Name check failed: $($_.Exception.Message)"
  }
}

function Test-ContainerApiHealth {
  $script = "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"
  $webContainer = Get-ServiceContainerName -Service "jiying-web"
  if (-not $webContainer) {
    return $false
  }
  & $podman.Source exec $webContainer node -e $script 2>$null
  return $LASTEXITCODE -eq 0
}

function Test-LocalTcpPort {
  param(
    [string]$HostName,
    [int]$Port
  )

  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connect = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(800)) {
      return $false
    }
    $client.EndConnect($connect)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
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
  return $CommandLine -match "podman-container-port-forwarder\.mjs"
}

function Clear-StaleLocalPreviewServer {
  $listeners = Get-LocalPortListeners -Port $PreviewPort
  foreach ($listener in $listeners) {
    $processId = [int]$listener.OwningProcess
    $commandLine = Get-ProcessCommandLine -ProcessId $processId
    if (Test-ProjectLocalApiCommand -CommandLine $commandLine) {
      Write-Host "Stopping stale local JIYING API process on port $PreviewPort (PID $processId). Podman will provide the preview instead."
      Stop-Process -Id $processId -Force
      Start-Sleep -Seconds 1
    }
  }
}

function Assert-PreviewPortAvailableForPodman {
  $listeners = Get-LocalPortListeners -Port $PreviewPort
  foreach ($listener in $listeners) {
    $processId = [int]$listener.OwningProcess
    $commandLine = Get-ProcessCommandLine -ProcessId $processId
    if (Test-PodmanPreviewForwarderCommand -CommandLine $commandLine) {
      continue
    }
    if (Test-ProjectLocalApiCommand -CommandLine $commandLine) {
      throw "localhost:$PreviewPort is still owned by the local JIYING API process (PID $processId). Stop it and rerun this script so Podman can serve the preview."
    }
    throw "localhost:$PreviewPort is already in use by PID $processId. Command: $commandLine"
  }
}

function Start-PodmanTcpForwarder {
  param(
    [int]$ListenPort,
    [string]$ContainerName,
    [string]$TargetHost,
    [int]$TargetPort,
    [string]$Label
  )

  if (Test-LocalTcpPort -HostName "127.0.0.1" -Port $ListenPort) {
    return
  }

  $forwarder = Join-Path $projectRoot "scripts\podman-nc-port-forwarder.mjs"
  if (-not (Test-Path -LiteralPath $forwarder)) {
    throw "$Label forwarder script was not found: $forwarder"
  }

  Write-Host "Podman host port forwarding for $Label is not reachable. Starting Windows forwarder: 127.0.0.1:$ListenPort -> ${ContainerName}:${TargetHost}:$TargetPort"
  Start-Process -FilePath "node" -ArgumentList @($forwarder, $ListenPort, $ContainerName, $TargetHost, $TargetPort) -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 2

  if (-not (Test-LocalTcpPort -HostName "127.0.0.1" -Port $ListenPort)) {
    throw "$Label is healthy in Podman, but 127.0.0.1:$ListenPort is not reachable from Windows."
  }
}

function Start-PodmanPreviewForwarder {
  Clear-StaleLocalPreviewServer
  Assert-PreviewPortAvailableForPodman

  $listener = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort $PreviewPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    return
  }

  $forwarder = Join-Path $projectRoot "scripts\podman-container-port-forwarder.mjs"
  if (-not (Test-Path -LiteralPath $forwarder)) {
    throw "Preview forwarder script was not found: $forwarder"
  }

  $webContainer = Get-ServiceContainerName -Service "jiying-web"
  if (-not $webContainer) {
    throw "Preview container for service jiying-web was not found."
  }

  Write-Host "Podman host port forwarding is not reachable. Starting Windows preview forwarder: 127.0.0.1:$PreviewPort -> ${webContainer}:3000"
  Start-Process -FilePath "node" -ArgumentList @($forwarder, $PreviewPort, $webContainer, "127.0.0.1", "3000") -WindowStyle Hidden | Out-Null
  for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 1
    if (Test-LocalTcpPort -HostName "127.0.0.1" -Port $PreviewPort) {
      return
    }
  }
  throw "Windows preview forwarder could not bind 127.0.0.1:$PreviewPort."
}

Clear-StaleLocalPreviewServer

if ($Build) {
  Invoke-PodmanComposeCommand -Arguments @("build", "jiying-web") -Description "podman-compose build for jiying-web"
}

$hasWebImage = $false
& $podman.Source image exists $env:JIYING_DEV_IMAGE
if ($LASTEXITCODE -eq 0) {
  $hasWebImage = $true
}
if (-not $hasWebImage) {
  Invoke-PodmanComposeCommand -Arguments @("build", "jiying-web") -Description "podman-compose build for jiying-web"
}

$postgresContainer = Get-ServiceContainerName -Service "postgres"
$redisContainer = Get-ServiceContainerName -Service "redis"
$postgresStarted = $false
$redisStarted = $false
if ($postgresContainer) {
  $postgresStarted = Start-PodmanContainerIfPresent -Name $postgresContainer
}
if ($redisContainer) {
  $redisStarted = Start-PodmanContainerIfPresent -Name $redisContainer
}

if (-not $postgresStarted -or -not $redisStarted) {
  Invoke-PodmanComposeCommand -Arguments @("up", "-d", "postgres", "redis") -Description "podman-compose up for postgres/redis"
}

if (-not $postgresContainer) {
  $postgresContainer = Get-ServiceContainerName -Service "postgres"
}
if (-not $redisContainer) {
  $redisContainer = Get-ServiceContainerName -Service "redis"
}
Start-PodmanTcpForwarder -ListenPort 15432 -ContainerName $postgresContainer -TargetHost "127.0.0.1" -TargetPort 5432 -Label "Postgres"
Start-PodmanTcpForwarder -ListenPort 16379 -ContainerName $redisContainer -TargetHost "127.0.0.1" -TargetPort 6379 -Label "Redis"

foreach ($service in @("jiying-web", "jiying-worker", "migrate")) {
  $name = Get-ServiceContainerName -Service $service
  if (-not $name) {
    continue
  }
  if (Test-PodmanContainer -Name $name) {
    & $podman.Source rm -f $name | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to remove stale app container $name."
    }
  }
}

if ($Build) {
  & $podman.Source volume exists jiying_jiying_node_modules
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Refreshing node_modules volume after rebuild..."
    & $podman.Source volume rm jiying_jiying_node_modules | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to remove stale jiying_jiying_node_modules volume."
    }
  }
}

Invoke-PodmanComposeCommand -Arguments @("up", "-d", "--no-deps", "migrate") -Description "podman-compose up for migrate"

$migrateOk = $false
for ($i = 0; $i -lt 60; $i++) {
  $migrateContainer = Get-ServiceContainerName -Service "migrate"
  if (-not $migrateContainer) {
    Start-Sleep -Seconds 2
    continue
  }
  $migrateStatus = & $podman.Source inspect $migrateContainer --format "{{.State.Status}} {{.State.ExitCode}}" 2>$null
  if ($migrateStatus -match "^exited 0$") {
    $migrateOk = $true
    break
  }
  if ($migrateStatus -match "^exited ") {
    & $podman.Source logs --tail 120 $migrateContainer
    throw "Migration container exited unsuccessfully: $migrateStatus"
  }
  Start-Sleep -Seconds 2
}
if (-not $migrateOk) {
  throw "Migration container did not finish within 120 seconds."
}

$publicAppUrl = "http://localhost:$PreviewPort"
$allowedOrigins = "http://localhost:$PreviewPort,http://127.0.0.1:$PreviewPort"
[Environment]::SetEnvironmentVariable("PUBLIC_APP_URL", $publicAppUrl, "Process")
[Environment]::SetEnvironmentVariable("APP_URL", $publicAppUrl, "Process")
[Environment]::SetEnvironmentVariable("ALLOWED_ORIGINS", $allowedOrigins, "Process")
[Environment]::SetEnvironmentVariable("PREVIEW_PORT", [string]$PreviewPort, "Process")

Invoke-PodmanComposeCommand -Arguments @("up", "-d", "--no-deps", "jiying-web", "jiying-worker") -Description "podman-compose up for app services"

if (-not $SkipHealthCheck) {
  Write-Host "Waiting for API health..."
  $healthy = $false
  $forwarderAttempted = $false
  for ($i = 0; $i -lt 40; $i++) {
    if (Test-LocalApiHealth) {
      $healthy = $true
      break
    }
    if (-not $forwarderAttempted -and $i -ge 3 -and (Test-ContainerApiHealth)) {
      Start-PodmanPreviewForwarder
      $forwarderAttempted = $true
    }
    Start-Sleep -Seconds 3
  }
  if (-not $healthy -and -not $forwarderAttempted -and (Test-ContainerApiHealth)) {
    Start-PodmanPreviewForwarder
    for ($i = 0; $i -lt 10; $i++) {
      if (Test-LocalApiHealth) {
        $healthy = $true
        break
      }
      Start-Sleep -Seconds 2
    }
  }
  if (-not $healthy) {
    if (Test-ContainerApiHealth) {
      throw "API is healthy inside the container, but localhost:$PreviewPort is not reachable from Windows. Inspect the preview forwarder or Podman port forwarding."
    }
    $webContainer = Get-ServiceContainerName -Service "jiying-web"
    throw "API health check did not pass. Inspect logs with `podman logs --tail 120 $webContainer`."
  }
}

if (-not $SkipHealthCheck) {
  Write-Host "Running realtime preview checks..."
  Invoke-StartupCheck -Name "container API runtime" {
    $health = Read-JsonEndpoint -Url "http://localhost:$PreviewPort/api/health"
    if ($health.status -ne "ok") {
      throw "API health status is $($health.status)."
    }
    if ($health.runtime.container -ne $true) {
      throw "localhost:$PreviewPort is not served by the Podman/container backend."
    }
  }
  Invoke-StartupCheck -Name "web preview" {
    Assert-HttpOk -Url "http://localhost:$PreviewPort/"
  }
  Invoke-StartupCheck -Name "host Postgres port" {
    if (-not (Test-LocalTcpPort -HostName "127.0.0.1" -Port 15432)) {
      throw "127.0.0.1:15432 is not reachable."
    }
  }
  Invoke-StartupCheck -Name "host Redis port" {
    if (-not (Test-LocalTcpPort -HostName "127.0.0.1" -Port 16379)) {
      throw "127.0.0.1:16379 is not reachable."
    }
  }
}

& $podman.Source ps --filter "label=com.docker.compose.project=$composeProjectName" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

Write-Host ""
Write-Host "JIYING is ready:"
Write-Host "  http://localhost:$PreviewPort/"
Write-Host ""
Write-Host "Useful commands:"
$webContainer = Get-ServiceContainerName -Service "jiying-web"
$workerContainer = Get-ServiceContainerName -Service "jiying-worker"
if ($webContainer) {
  Write-Host "  podman logs -f $webContainer"
}
if ($workerContainer) {
  Write-Host "  podman logs -f $workerContainer"
}
