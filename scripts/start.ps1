param([switch]$NoCollector, [switch]$Background)
$ErrorActionPreference = 'Stop'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$repo = Split-Path -Parent $PSScriptRoot
$sdk = Join-Path $repo '.tools\dotnet\dotnet.exe'
if (-not (Test-Path -LiteralPath $sdk)) { $sdk = 'dotnet' }
Push-Location $repo
try {
    if ($Background) {
        if (-not $NoCollector) {
            $taskName = 'Flightlog-' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
            $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
            if ($task) {
                Start-ScheduledTask -TaskName $taskName
                Write-Output 'Flightlog login task started.'
                return
            }
        }
        & $sdk build backend
        if ($LASTEXITCODE) { throw 'Backend build failed' }
        $dll = Join-Path $repo 'backend\bin\Debug\net10.0-windows\Flightlog.dll'
        $data = $env:FLIGHTLOG_DATA_DIR
        if (-not $data) { $data = Join-Path $env:LOCALAPPDATA 'Flightlog' }
        $launchArgs = @('-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $PSScriptRoot 'run-backend.ps1') + '"'), '-AppPath', ('"' + $dll + '"'), '-DataDirectory', ('"' + $data + '"'))
        if ($NoCollector) { $launchArgs += '-NoCollector' }
        $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $launchArgs -WorkingDirectory $repo -WindowStyle Hidden -PassThru
        Write-Output "Flightlog started (PID $($process.Id)). Open http://127.0.0.1:43123. Stop with scripts\stop.ps1."
        return
    }
    $arguments = @('run', '--project', 'backend')
    if ($NoCollector) { $arguments += @('--', '--no-collector') }
    & $sdk @arguments
} finally { Pop-Location }
