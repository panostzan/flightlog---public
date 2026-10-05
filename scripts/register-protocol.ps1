param([string]$DataDirectory)
$ErrorActionPreference = 'Stop'
if (-not $DataDirectory) { $DataDirectory = $env:FLIGHTLOG_DATA_DIR }
if (-not $DataDirectory) { $DataDirectory = Join-Path $env:LOCALAPPDATA 'Flightlog' }
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
$launcher = Join-Path $PSScriptRoot 'open.ps1'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
# Deliberately do not include %1 or any URI-provided arguments. An external
# website may request opening Flightlog, but cannot supply commands or tokens.
$command = '"' + $powershell + '" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" -DataDirectory "' + $DataDirectory + '"'
$key = 'HKCU:\Software\Classes\flightlog'
New-Item -Path $key -Force | Out-Null
Set-Item -LiteralPath $key -Value 'URL:Flightlog'
New-ItemProperty -LiteralPath $key -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
New-Item -Path ($key + '\shell\open\command') -Force | Out-Null
Set-Item -LiteralPath ($key + '\shell\open\command') -Value $command
Write-Output 'Flightlog secure app launcher registered for this Windows user.'
