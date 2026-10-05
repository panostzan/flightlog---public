param([Parameter(Mandatory=$true)][string]$DataDirectory)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$taskName = 'Flightlog-' + $identity.User.Value + '-Recovery'
# A console executable can flash before -WindowStyle Hidden takes effect.
# Compile a GUI host using Windows' installed .NET Framework; it starts the
# actual check with CreateNoWindow and returns its exit code to Task Scheduler.
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path -LiteralPath $compiler)) { throw 'The .NET Framework compiler is unavailable; existing recovery task was not changed.' }
$hostDirectory = Join-Path $repo ('.tools\recovery-host-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $hostDirectory -Force | Out-Null
$hostPath = Join-Path $hostDirectory 'FlightlogRecovery.exe'
& $compiler /nologo /target:winexe /optimize+ "/out:$hostPath" (Join-Path $PSScriptRoot 'RecoveryHost.cs')
if ($LASTEXITCODE -ne 0) { throw 'Recovery host build failed; existing recovery task was not changed.' }
$dataPath = [IO.Path]::GetFullPath($DataDirectory)
# Keep a trailing directory separator (including drive roots) and double it
# before the closing quote for Windows executable argument parsing.
$arguments = '"' + (Join-Path $PSScriptRoot 'recover-backend.ps1') + '" "' + $dataPath.TrimEnd('\') + '\\"'
$action = New-ScheduledTaskAction -Execute $hostPath -Argument $arguments -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Recover an unexpectedly stopped Flightlog collector every five minutes; preserve graceful stops.' -Force | Out-Null
Write-Output ('Installed recovery task: ' + $taskName)
