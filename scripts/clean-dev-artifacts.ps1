param(
  [switch]$IncludeUserData
)

$ErrorActionPreference = "Stop"
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

$safeTargets = @(
  "dist",
  ".logs",
  ".vite-cache",
  ".dev-server.log",
  ".dev-server.out.log",
  ".dev-server.err.log",
  "server.js"
)

$userDataTargets = @(
  "uploads",
  "storage",
  "backups",
  "dump.rdb"
)

function Remove-ProjectPath {
  param([string]$RelativePath)

  $target = Join-Path $projectRoot $RelativePath
  if (-not (Test-Path -LiteralPath $target)) {
    return
  }

  $resolved = Resolve-Path -LiteralPath $target
  $rootPath = [string]$projectRoot
  $resolvedPath = [string]$resolved
  if ($resolvedPath -ne $rootPath -and -not $resolvedPath.StartsWith("$rootPath\")) {
    throw "Refusing to remove path outside project root: $resolvedPath"
  }

  try {
    Remove-Item -LiteralPath $resolvedPath -Recurse -Force
    Write-Host "Removed $RelativePath"
  } catch {
    Write-Warning "Skipped $RelativePath because it is in use or locked: $($_.Exception.Message)"
  }
}

foreach ($target in $safeTargets) {
  Remove-ProjectPath $target
}

if ($IncludeUserData) {
  foreach ($target in $userDataTargets) {
    Remove-ProjectPath $target
  }
} else {
  Write-Host "Skipped uploads/storage/backups/dump.rdb. Re-run with -IncludeUserData only when you intentionally want to remove local media and database dumps."
}
