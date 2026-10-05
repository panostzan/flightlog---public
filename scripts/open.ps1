param([switch]$NoBrowser, [string]$DataDirectory)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$data = $DataDirectory
if (-not $data) { $data = $env:FLIGHTLOG_DATA_DIR }
if (-not $data) { $data = Join-Path $env:LOCALAPPDATA 'Flightlog' }
$settingsPath = Join-Path $data 'settings.local.json'
function Test-Flightlog {
    if (-not (Test-Path -LiteralPath $settingsPath)) { return $false }
    try {
        $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
        $status = Invoke-RestMethod -Uri 'http://127.0.0.1:43123/api/v1/status' -Headers @{ Authorization = "Bearer $($settings.token)" } -TimeoutSec 2
        return $null -ne $status.database
    } catch { return $false }
}
try {
    if (-not (Test-Flightlog)) {
        Write-Host 'Starting Flightlog...'
        & (Join-Path $PSScriptRoot 'start.ps1') -Background
        $deadline = (Get-Date).AddSeconds(30)
        while (-not (Test-Flightlog)) {
            if ((Get-Date) -gt $deadline) { throw 'Flightlog could not start. Another application may be using port 43123.' }
            Start-Sleep -Milliseconds 300
        }
    }
    if (-not $NoBrowser) {
        & (Join-Path $PSScriptRoot 'register-protocol.ps1') -DataDirectory $data
        $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
        # Fragments are not sent to the HTTP server. The page immediately removes it.
        Start-Process ('http://127.0.0.1:43123/galaxy/#token=' + [Uri]::EscapeDataString($settings.token))
    }
    Write-Host 'Flightlog is ready. You can close this window.'
} catch {
    Write-Host ('Could not open Flightlog: ' + $_.Exception.Message)
    exit 1
}
