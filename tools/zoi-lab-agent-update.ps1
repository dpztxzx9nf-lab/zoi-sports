# Update the Zoi lab agent on this PC and restart it, hidden.
#
# Put the new zoi-lab-agent.mjs beside this script (or pass -Source), then:
#   powershell -NoProfile -ExecutionPolicy Bypass -File zoi-lab-agent-update.ps1
#
# Copies it into %LOCALAPPDATA%\Programs\zoi (old copy kept as .bak), checks it
# parses, stops only the node process running zoi-lab-agent.mjs, and starts it
# again through zoi-lab-agent-hidden.vbs. Touches no game, no game file, and
# never reads or prints the token in zoi-lab-agent.json.
param([string]$Source = (Join-Path $PSScriptRoot 'zoi-lab-agent.mjs'))
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'Programs\zoi'
$dest = Join-Path $dir 'zoi-lab-agent.mjs'
if (-not (Test-Path $Source)) { throw "No new agent at $Source" }
$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
if (-not (Test-Path $node)) { $node = 'node' }
& $node --check $Source
if ($LASTEXITCODE -ne 0) { throw 'The new agent does not parse; nothing was changed.' }
if ((Resolve-Path $Source).Path -ne $dest) {
  if (Test-Path $dest) { Copy-Item $dest "$dest.bak" -Force }
  Copy-Item $Source $dest -Force
}
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*zoi-lab-agent.mjs*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Seconds 2
Start-Process wscript.exe -ArgumentList ('"' + (Join-Path $dir 'zoi-lab-agent-hidden.vbs') + '"') -WindowStyle Hidden
Start-Sleep -Seconds 8
$running = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like '*zoi-lab-agent.mjs*' }
if ($running) { 'Zoi lab agent updated and running.' } else { 'Updated, but the agent did not start - check zoi-lab-agent.log.' }
Get-Content (Join-Path $dir 'zoi-lab-agent.log') -Tail 3 -ErrorAction SilentlyContinue
