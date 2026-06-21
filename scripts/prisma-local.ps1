param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$PrismaArgs = @("validate")
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $projectRoot
try {
  $env:DATABASE_URL = "postgresql://jiying:jiying_dev_password@localhost:15432/jiying?schema=public"
  & npx.cmd prisma @PrismaArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Prisma command failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}
