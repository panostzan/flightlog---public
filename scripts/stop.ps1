$ErrorActionPreference = 'Stop'
$data = $env:FLIGHTLOG_DATA_DIR
if (-not $data) { $data = Join-Path $env:LOCALAPPDATA 'Flightlog' }
$settings = Get-Content -LiteralPath (Join-Path $data 'settings.local.json') -Raw | ConvertFrom-Json
Invoke-RestMethod -Uri 'http://127.0.0.1:43123/api/v1/shutdown' -Method Post -ContentType 'application/json' -Headers @{ Authorization = "Bearer $($settings.token)" } -Body '{}' | Out-Null
Write-Output 'Backend stopped. Pause the Chrome extension separately to stop browser buffering.'
