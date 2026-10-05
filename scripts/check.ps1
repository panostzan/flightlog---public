$ErrorActionPreference = 'Stop'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$repo = Split-Path -Parent $PSScriptRoot
$sdk = Join-Path $repo '.tools\dotnet\dotnet.exe'
if (-not (Test-Path -LiteralPath $sdk)) { $sdk = 'dotnet' }
Push-Location $repo
try {
    & $sdk build backend
    if ($LASTEXITCODE) { throw 'Backend build failed' }
    & $sdk run --project backend --no-build -- --self-test
    if ($LASTEXITCODE) { throw 'Backend tests failed' }
    Push-Location extension
    try { npm test; if ($LASTEXITCODE) { throw 'Extension tests failed' } } finally { Pop-Location }
} finally { Pop-Location }
