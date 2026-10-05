param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$taskName = 'Flightlog-' + $identity.User.Value
$recoveryTaskName = $taskName + '-Recovery'
if ($Remove) {
    Unregister-ScheduledTask -TaskName $recoveryTaskName -Confirm:$false -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output 'Login startup removed. A running backend continues until scripts\stop.ps1 is used.'
    exit 0
}
$data = $env:FLIGHTLOG_DATA_DIR
if (-not $data) { $data = Join-Path $env:LOCALAPPDATA 'Flightlog' }
$data = [IO.Path]::GetFullPath($data)
$sdk = Join-Path $repo '.tools\dotnet\dotnet.exe'
if (-not (Test-Path -LiteralPath $sdk)) { $sdk = (Get-Command dotnet).Source }
# Publish before interrupting collection. Each deployment has its own directory.
$runtime = Join-Path $repo ('.tools\flightlog-runtime-' + [Guid]::NewGuid().ToString('N'))
& $sdk publish (Join-Path $repo 'backend\Flightlog.csproj') --no-restore -o $runtime
if ($LASTEXITCODE) { throw 'Backend publish failed; existing collector was not stopped.' }
$settingsPath = Join-Path $data 'settings.local.json'
if (Test-Path -LiteralPath $settingsPath) {
    $config = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    $headers = @{ Authorization = 'Bearer ' + $config.token }
    $running = $null
    try { $running = Invoke-RestMethod 'http://127.0.0.1:43123/api/v1/status' -Headers $headers -TimeoutSec 2 } catch { }
    if ($running) {
        Invoke-RestMethod 'http://127.0.0.1:43123/api/v1/shutdown' -Method Post -ContentType 'application/json' -Body '{}' -Headers $headers | Out-Null
        $deadline = (Get-Date).AddSeconds(20)
        do {
            Start-Sleep -Milliseconds 250
            $alive = $false
            try { Invoke-RestMethod 'http://127.0.0.1:43123/api/v1/status' -Headers $headers -TimeoutSec 1 | Out-Null; $alive = $true } catch { }
        } while ($alive -and (Get-Date) -lt $deadline)
        if ($alive) { throw 'Existing backend did not stop; task was not replaced.' }
    }
}
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$script = Join-Path $PSScriptRoot 'run-backend.ps1'
$dll = Join-Path $runtime 'Flightlog.dll'
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $script + '" -AppPath "' + $dll + '" -DataDirectory "' + $data + '"'
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $taskSettings -Description 'Flightlog local collector at this user login; no browser launch; no elevated privileges.' -Force | Out-Null
& (Join-Path $PSScriptRoot 'install-recovery.ps1') -DataDirectory $data
& (Join-Path $PSScriptRoot 'register-protocol.ps1') -DataDirectory $data
Start-ScheduledTask -TaskName $taskName
Write-Output ('Installed and started login task: ' + $taskName)
Write-Output 'Verify with scripts\health.ps1. Chrome must be open with the enrolled extension enabled.'
