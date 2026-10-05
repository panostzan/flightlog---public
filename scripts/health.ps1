param([switch]$Json)
$ErrorActionPreference = 'Stop'
$data = $env:FLIGHTLOG_DATA_DIR
if (-not $data) { $data = Join-Path $env:LOCALAPPDATA 'Flightlog' }
try {
    $settings = Get-Content -LiteralPath (Join-Path $data 'settings.local.json') -Raw | ConvertFrom-Json
    $status = Invoke-RestMethod 'http://127.0.0.1:43123/api/v1/status' -Headers @{ Authorization = 'Bearer ' + $settings.token } -TimeoutSec 5
    if (-not $status.recording) { throw 'old_backend' }
    if ($Json) { $status | ConvertTo-Json -Depth 8 }
    else {
        Write-Output ('Backend: running (PID ' + $status.diagnostics.process_id + ') | logs: ' + $status.diagnostics.logging)
        foreach ($sensor in @('windows', 'chrome')) {
            $health = $status.recording.$sensor
            $last = 'none in this backend run'
            if ($null -ne $health.last_observed_at_ms) { $last = [DateTimeOffset]::FromUnixTimeMilliseconds($health.last_observed_at_ms).ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss zzz') }
            Write-Output ($sensor + ': ' + $health.state + ' | last observation: ' + $last)
        }
    }
    if ($status.recording.windows.actively_recording -and $status.recording.chrome.actively_recording -and $status.diagnostics.logging -eq 'ok') { exit 0 }
    exit 2
} catch {
    if ($Json) { @{ backend = 'unreachable_or_incompatible'; windows = 'unknown'; chrome = 'unknown' } | ConvertTo-Json }
    else { Write-Output 'Backend: unreachable or incompatible. Sensor recording is unknown. Run Flightlog.cmd; inspect backend.jsonl and launcher.jsonl in the data directory.' }
    exit 1
}
