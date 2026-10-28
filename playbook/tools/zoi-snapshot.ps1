<#
  zoi-snapshot.ps1 - read Fortnite settings off this PC and write them to JSON.

  Read-only. Never writes to the Fortnite config, never changes a setting.
  In-game / player-side settings only; PC and hardware tuning is Knexrig's lane.

  Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File zoi-snapshot.ps1
  Output: zoi-snapshot.json in the user profile folder
#>
$ErrorActionPreference = 'Stop'

$cfgRoot = Join-Path $env:LOCALAPPDATA 'FortniteGame\Saved\Config'
$iniPath = Join-Path $cfgRoot 'WindowsClient\GameUserSettings.ini'
$savPath = Join-Path $cfgRoot 'ClientSettings.Sav'
$outPath = Join-Path $env:USERPROFILE 'zoi-snapshot.json'

$result = [ordered]@{
  takenAt   = (Get-Date).ToString('yyyy-MM-dd HH:mm')
  iniMtime  = $null
  savMtime  = $null
  settings  = [ordered]@{}
  scalability = [ordered]@{}
  sensitivity = [ordered]@{}
  inputs    = @()
}

# --- INI: display, graphics, audio -------------------------------------
$iniKeys = @(
  'ResolutionSizeX','ResolutionSizeY','LastConfirmedFullscreenMode','FullscreenMode',
  'FrameRateLimit','bUseVSync','bMotionBlur','bShowGrass','bShowFPS','bUseDynamicResolution',
  'FortAntiAliasingMethod','DLSSQuality','bEnableDLSSFrameGeneration',
  'PotentiallyUpscaledResolutionQuality','bUseNanite','bRayTracing',
  'DesiredGlobalIlluminationQuality','DesiredReflectionQuality',
  'AudioQualityLevel','bUseHeadphoneMode','bDisableMouseAcceleration','bUseHDRDisplayOutput'
)

if (Test-Path $iniPath) {
  $result.iniMtime = (Get-Item $iniPath).LastWriteTime.ToString('yyyy-MM-dd HH:mm')
  foreach ($line in [System.IO.File]::ReadAllLines($iniPath)) {
    if ($line -notmatch '^([A-Za-z0-9_.]+)\s*=\s*(.*)$') { continue }
    $k = $matches[1]; $v = $matches[2].Trim()
    if ($k.StartsWith('sg.')) { $result.scalability[$k.Substring(3)] = $v }
    elseif ($iniKeys -contains $k) { $result.settings[$k] = $v }
  }
}

# --- ClientSettings.Sav: sensitivity + which input devices exist --------
if (Test-Path $savPath) {
  $result.savMtime = (Get-Item $savPath).LastWriteTime.ToString('yyyy-MM-dd HH:mm')
  $b = [System.IO.File]::ReadAllBytes($savPath)

  $fields = @(
    'MouseSensitivityX','MouseSensitivityY','ScopedSensitivityMultiplier',
    'UpgradedMouseSensitivityX','UpgradedMouseSensitivityY',
    'MouseSensitivity','MouseSensitivityDefaultVersion'
  )
  foreach ($name in $fields) {
    $needle = [System.Text.Encoding]::ASCII.GetBytes($name)
    $pos = -1
    $limit = $b.Length - $needle.Length
    for ($i = 0; $i -le $limit; $i++) {
      if ($b[$i] -ne $needle[0]) { continue }
      $hit = $true
      for ($j = 1; $j -lt $needle.Length; $j++) {
        if ($b[$i + $j] -ne $needle[$j]) { $hit = $false; break }
      }
      if ($hit) { $pos = $i; break }
    }
    if ($pos -lt 0) { continue }
    $scanEnd = [Math]::Min($pos + 64, $b.Length - 8)
    for ($q = $pos; $q -lt $scanEnd; $q++) {
      if ($b[$q] -eq 4 -and $b[$q+1] -eq 0 -and $b[$q+2] -eq 0 -and $b[$q+3] -eq 0) {
        $at = $q + 5
        if ($at + 4 -le $b.Length) {
          $raw = [System.BitConverter]::ToSingle($b, $at)
          if (-not [float]::IsNaN($raw) -and [Math]::Abs($raw) -lt 10000) {
            $result.sensitivity[$name] = [Math]::Round($raw, 6)
            break
          }
        }
      }
    }
  }

  # which input-device profiles the game has written
  $sb = New-Object System.Text.StringBuilder
  foreach ($byte in $b) {
    if ($byte -ge 32 -and $byte -lt 127) { [void]$sb.Append([char]$byte) } else { [void]$sb.Append("`n") }
  }
  $result.inputs = @($sb.ToString() -split "`n" |
    Where-Object { $_ -match '^EHardwareDevicePrimaryType::' } |
    Sort-Object -Unique)
}

$result | ConvertTo-Json -Depth 8 | Set-Content -Path $outPath -Encoding UTF8
Write-Output ("snapshot written: " + $outPath)
