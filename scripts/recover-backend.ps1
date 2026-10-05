param([Parameter(Mandatory=$true)][string]$DataDirectory)
$ErrorActionPreference = 'Stop'
# A graceful shutdown removes this marker. Do not undo an intentional stop.
if (-not (Test-Path -LiteralPath (Join-Path $DataDirectory 'backend-running.json'))) { return }
$taskName = 'Flightlog-' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task -and $task.State -eq 'Ready') {
    Start-ScheduledTask -TaskName $taskName
}
