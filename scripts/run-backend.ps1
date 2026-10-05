param([Parameter(Mandatory=$true)][string]$AppPath, [Parameter(Mandatory=$true)][string]$DataDirectory, [switch]$NoCollector)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$env:FLIGHTLOG_DATA_DIR = $DataDirectory
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
function Write-LaunchLog([string]$Code, [int]$ExitCode = 0) {
    # No exception messages or process output: these can contain local activity or credentials.
    try {
        [IO.Directory]::CreateDirectory($DataDirectory) | Out-Null
        $path = Join-Path $DataDirectory 'launcher.jsonl'
        if ((Test-Path -LiteralPath $path) -and (Get-Item -LiteralPath $path).Length -gt 1MB) {
            Move-Item -LiteralPath $path -Destination ($path + '.1') -Force
        }
        @{ at = [DateTimeOffset]::UtcNow.ToString('o'); code = $Code; exit_code = $ExitCode } |
            ConvertTo-Json -Compress | Add-Content -LiteralPath $path -Encoding UTF8
    } catch { Write-Error 'Flightlog launcher_log_write_failed' -ErrorAction Continue }
}
try {
    Write-LaunchLog 'launcher_start'
    $sdk = Join-Path $repo '.tools\dotnet\dotnet.exe'
    if (-not (Test-Path -LiteralPath $sdk)) { $sdk = (Get-Command dotnet -ErrorAction Stop).Source }
    if (-not (Test-Path -LiteralPath $AppPath)) { throw 'missing_runtime' }
    $runArguments = @($AppPath, '--contentRoot', (Join-Path $repo 'backend'))
    if ($NoCollector) { $runArguments += '--no-collector' }
    & $sdk @runArguments 2>&1 | Out-Null
    $result = $LASTEXITCODE
    Write-LaunchLog 'launcher_exit' $result
    exit $result
} catch {
    Write-LaunchLog 'launcher_error' 1
    exit 1
}
