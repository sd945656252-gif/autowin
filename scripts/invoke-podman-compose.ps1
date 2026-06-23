$ErrorActionPreference = "Stop"

$composeArgs = @($args)
$pipelineItems = @($input)

$podmanCommand = Get-Command podman -ErrorAction SilentlyContinue
if (-not $podmanCommand) {
  throw "Podman CLI was not found. Install Podman Desktop or Podman CLI, run `podman machine start`, then retry."
}

$podmanComposeCommand = Get-Command podman-compose -ErrorAction SilentlyContinue
if (-not $podmanComposeCommand) {
  $pythonScripts = Join-Path $env:APPDATA "Python\Python38\Scripts\podman-compose.exe"
  if (Test-Path -LiteralPath $pythonScripts) {
    $podmanComposeCommand = Get-Item -LiteralPath $pythonScripts
  }
}
if (-not $podmanComposeCommand) {
  throw "podman-compose was not found. Install it with `py -m pip install --user podman-compose`, then retry."
}

if ($composeArgs.Count -eq 0) {
  throw "No Podman Compose arguments were provided."
}

$providerPath = $podmanComposeCommand.Source
if (-not $providerPath) {
  $providerPath = $podmanComposeCommand.FullName
}
$env:PODMAN_COMPOSE_PROVIDER = $providerPath
$projectName = "jiying"

if ($pipelineItems.Count -gt 0) {
  $pipelineItems | & $podmanCommand.Source compose -p $projectName @composeArgs
} else {
  & $podmanCommand.Source compose -p $projectName @composeArgs
}
if ($LASTEXITCODE -ne 0) {
  throw "podman compose failed with exit code $LASTEXITCODE. Verify that `podman compose version` works, or install the Podman Compose provider."
}
