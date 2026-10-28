<#
  zoi-snapshot.ps1 - copy Fortnite's config off this PC so it can be read.

  Read-only. Copies two files into a folder next to this script; never writes to
  the Fortnite config, never changes a setting.

  1. GameUserSettings.ini  - display, graphics, audio (plain text)
  2. ClientSettings.Sav    - sensitivity, controller, bindings (binary)

  The parsing happens elsewhere, so this script can't get the numbers wrong.

  Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File zoi-snapshot.ps1
  Output: .\fortnite-config\GameUserSettings.ini and ClientSettings.Sav
#>
$ErrorActionPreference = 'Stop'

$cfgRoot = Join-Path $env:LOCALAPPDATA 'FortniteGame\Saved\Config'
$dest    = Join-Path $PSScriptRoot 'fortnite-config'

$files = @{
  'GameUserSettings.ini' = Join-Path $cfgRoot 'WindowsClient\GameUserSettings.ini'
  'ClientSettings.Sav'   = Join-Path $cfgRoot 'ClientSettings.Sav'
}

if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest -Force | Out-Null }

foreach ($name in $files.Keys) {
  $src = $files[$name]
  if (-not (Test-Path $src)) {
    Write-Output ("MISSING: " + $src)
    continue
  }
  Copy-Item -Path $src -Destination (Join-Path $dest $name) -Force
  $info = Get-Item $src
  Write-Output ("copied {0}  ({1:N0} bytes, game last wrote it {2})" -f $name, $info.Length, $info.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))
}

Write-Output ("output folder: " + $dest)
