# Zoi lab: watch for a Call of Duty after-action report, and for ROB RUN
# city-shift HUD values, on the player's own screen.
# Desktop blit only. No hooks, overlay, or injection. COD frames that are
# not an AAR are dropped immediately. ROB RUN HUD samples are sent only
# when a value changes, or when a shift starts or ends. F9 is a COD backup.
# Hidden: start with powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File this.

param(
  [switch]$Bench,
  [switch]$Once,
  [string]$File,
  [int]$RereadId = 0,
  [switch]$RobRun,
  [switch]$RobBackfill
)

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$AgentLog = Join-Path $Here 'zoi-lab-agent.log'
$AarDir = Join-Path $Here 'aar'
$DetectLog = Join-Path $AarDir 'detector.log'
$PositiveLog = Join-Path $AarDir 'positive.log'
$ConfigPath = Join-Path $Here 'zoi-lab-agent.json'
$DetectPath = Join-Path $Here 'zoi-cod-aar.json'
New-Item -ItemType Directory -Force -Path $AarDir | Out-Null

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.Runtime.WindowsRuntime

Add-Type -ReferencedAssemblies System.Drawing,System.dll -TypeDefinition @"
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public static class ZoiGrab {
  const uint SRCCOPY = 0x00CC0020;
  const uint CAPTUREBLT = 0x40000000;
  const uint MONITOR_DEFAULTTONEAREST = 2;
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fs, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hWnd);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr hdc);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int w, int h);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hdc);
  [DllImport("gdi32.dll")] static extern bool StretchBlt(IntPtr hdcDest, int xDest, int yDest, int wDest, int hDest, IntPtr hdcSrc, int xSrc, int ySrc, int wSrc, int hSrc, uint rop);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  public static Rectangle MonitorFromHwnd(IntPtr hwnd) {
    IntPtr mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    if (mon == IntPtr.Zero) return Rectangle.Empty;
    MONITORINFO info = new MONITORINFO();
    info.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(mon, ref info)) return Rectangle.Empty;
    return Rectangle.FromLTRB(info.rcMonitor.Left, info.rcMonitor.Top, info.rcMonitor.Right, info.rcMonitor.Bottom);
  }
  public static Bitmap Grab(Rectangle bounds, int maxWidth) {
    int w = bounds.Width, h = bounds.Height;
    if (w <= 0 || h <= 0) return null;
    int dw = w, dh = h;
    if (maxWidth > 0 && w > maxWidth) { dw = maxWidth; dh = Math.Max(1, (int)((long)h * maxWidth / w)); }
    IntPtr hdcSrc = GetDC(IntPtr.Zero);
    if (hdcSrc == IntPtr.Zero) return null;
    IntPtr hdcDst = CreateCompatibleDC(hdcSrc);
    IntPtr hBmp = CreateCompatibleBitmap(hdcSrc, dw, dh);
    IntPtr old = SelectObject(hdcDst, hBmp);
    try {
      StretchBlt(hdcDst, 0, 0, dw, dh, hdcSrc, bounds.X, bounds.Y, w, h, SRCCOPY | CAPTUREBLT);
      return Image.FromHbitmap(hBmp);
    } finally {
      SelectObject(hdcDst, old);
      DeleteObject(hBmp);
      DeleteDC(hdcDst);
      ReleaseDC(IntPtr.Zero, hdcSrc);
    }
  }
}
"@

function Write-ZoiLog([string]$Path, [string]$Line) {
  $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' ' + $Line
  try { Add-Content -LiteralPath $Path -Value $stamp -Encoding UTF8 } catch {}
}
function Log([string]$Line) { Write-ZoiLog $AgentLog $Line }

$script:PollMs = 2500
$script:DetectWidth = 2560
$script:MinScore = 3
$script:NearMiss = 1
$script:PlayerName = 'Kneczi'
$script:Keywords = New-Object System.Collections.Generic.List[object]
function Add-Kw([string]$Text, [double]$Score) {
  $script:Keywords.Add([pscustomobject]@{ Text = (Normalize-Text $Text).Trim(); Score = $Score })
}
function Load-Defaults {
  $script:Keywords.Clear()
  Add-Kw 'after action report' 3
  Add-Kw 'after action' 2.5
  Add-Kw 'match summary' 3
  Add-Kw 'failed to extract' 2.5
  Add-Kw 'you extracted' 2.5
  Add-Kw 'extraction failed' 2.5
  Add-Kw 'mission results' 2
  Add-Kw 'match results' 2
  Add-Kw 'resurgence' 2
  Add-Kw 'your stats' 2
  Add-Kw 'total damage' 1.5
  Add-Kw 'xp summary' 1.5
  Add-Kw 'victory' 1.5
  Add-Kw 'defeat' 1.5
  Add-Kw 'extracted' 1
  Add-Kw 'placement' 1
  Add-Kw 'scoreboard' 1
}
function Normalize-Text([string]$Text) {
  if ([string]::IsNullOrEmpty($Text)) { return ' ' }
  $s = $Text.ToLowerInvariant().Replace('-', ' ')
  $s = [regex]::Replace($s, '[^a-z0-9]+', ' ')
  return ' ' + $s.Trim() + ' '
}

Load-Defaults
if (Test-Path $DetectPath) {
  try {
    $cfg = Get-Content -LiteralPath $DetectPath -Raw | ConvertFrom-Json
    if ($cfg.poll_ms -ge 1000 -and $cfg.poll_ms -le 10000) { $script:PollMs = [int]$cfg.poll_ms }
    if ($cfg.detect_width -ge 320 -and $cfg.detect_width -le 3840) { $script:DetectWidth = [int]$cfg.detect_width }
    if ($cfg.min_score -gt 0) { $script:MinScore = [double]$cfg.min_score }
    if ($cfg.near_miss -gt 0) { $script:NearMiss = [double]$cfg.near_miss }
    if ($cfg.keywords) {
      $script:Keywords.Clear()
      foreach ($k in $cfg.keywords) { Add-Kw ([string]$k.text) ([double]$k.score) }
    }
  } catch { Log "Couldn't read zoi-cod-aar.json; using built-in keywords." }
}

if (-not (Test-Path $ConfigPath)) { Log "No config file at $ConfigPath."; exit 1 }
try { $agent = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json } catch { Log "The lab config is not valid JSON."; exit 1 }
$script:Token = [string]$agent.token
$endpoint = [string]$agent.endpoint
if (-not $script:Token -or -not $endpoint) { Log 'The lab config is missing a token or endpoint.'; exit 1 }
if ($endpoint -match '/api/lab-sync$') { $script:Endpoint = $endpoint -replace '/api/lab-sync$','/api/lab-cod-aar' }
elseif ($endpoint -notmatch '/api/lab-cod-aar') { $script:Endpoint = ([Uri]$endpoint).GetLeftPart([System.UriPartial]::Authority) + '/api/lab-cod-aar' }
else { $script:Endpoint = $endpoint }
$script:RobEndpoint = $script:Endpoint -replace '/api/lab-cod-aar$','/api/lab-robrun-aar' 

# WinRT OCR
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
try { $script:OcrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() } catch { $script:OcrEngine = $null }
if (-not $script:OcrEngine) { Log "Couldn't start Windows OCR. Automatic detection is off; F9 still works while Call of Duty is running." }

function Wait-WinRt($Async, [type]$ResultType) {
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
  } | Select-Object -First 1
  $net = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Async))
  $null = $net.Wait(-1)
  return $net.Result
}

function Recognize-Bitmap([System.Drawing.Bitmap]$Bmp) {
  if (-not $script:OcrEngine -or -not $Bmp) { return '' }
  $ms = New-Object System.IO.MemoryStream
  try {
    $jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.FormatID -eq [System.Drawing.Imaging.ImageFormat]::Jpeg.Guid }
    $enc = New-Object System.Drawing.Imaging.EncoderParameters 1
    $enc.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [long]70)
    $Bmp.Save($ms, $jpeg, $enc)
    $ms.Position = 0
    $ras = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
    $decoder = Wait-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $software = Wait-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    if ($software.BitmapPixelFormat -ne [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8 -and
        $software.BitmapPixelFormat -ne [Windows.Graphics.Imaging.BitmapPixelFormat]::Gray8) {
      $software = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($software, [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8)
    }
    $result = Wait-WinRt ($script:OcrEngine.RecognizeAsync($software)) ([Windows.Media.Ocr.OcrResult])
    if ($result -and $result.Text) { return [string]$result.Text }
    return ''
  } catch { return '' } finally { $ms.Dispose() }
}


function Recognize-Words([System.Drawing.Bitmap]$Bmp) {
  $words = New-Object System.Collections.Generic.List[object]
  if (-not $script:OcrEngine -or -not $Bmp) { return @{ Text = ''; Words = $words } }
  $ms = New-Object System.IO.MemoryStream
  try {
    $jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.FormatID -eq [System.Drawing.Imaging.ImageFormat]::Jpeg.Guid }
    $enc = New-Object System.Drawing.Imaging.EncoderParameters 1
    $enc.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [long]90)
    $Bmp.Save($ms, $jpeg, $enc)
    $ms.Position = 0
    $ras = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
    $decoder = Wait-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $software = Wait-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    if ($software.BitmapPixelFormat -ne [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8 -and
        $software.BitmapPixelFormat -ne [Windows.Graphics.Imaging.BitmapPixelFormat]::Gray8) {
      $software = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($software, [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8)
    }
    $result = Wait-WinRt ($script:OcrEngine.RecognizeAsync($software)) ([Windows.Media.Ocr.OcrResult])
    $text = ''
    if ($result -and $result.Text) { $text = [string]$result.Text }
    if ($result -and $result.Lines) {
      foreach ($line in $result.Lines) {
        foreach ($word in $line.Words) {
          $r = $word.BoundingRect
          $words.Add([pscustomobject]@{
            Text = [string]$word.Text
            X = [double]$r.X; Y = [double]$r.Y
            W = [double]$r.Width; H = [double]$r.Height
            CX = [double]$r.X + [double]$r.Width / 2
            CY = [double]$r.Y + [double]$r.Height / 2
          })
        }
      }
    }
    return @{ Text = $text; Words = $words }
  } catch {
    return @{ Text = ''; Words = $words }
  } finally { $ms.Dispose() }
}

function Offset-Words($Result, [double]$Ox, [double]$Oy, [double]$Scale) {
  if (-not $Result) { return }
  foreach ($w in $Result.Words) {
    $w.X = $Ox + $w.X / $Scale
    $w.Y = $Oy + $w.Y / $Scale
    $w.W = $w.W / $Scale
    $w.H = $w.H / $Scale
    $w.CX = $w.X + $w.W / 2
    $w.CY = $w.Y + $w.H / 2
  }
}

function Scale-Bitmap([System.Drawing.Bitmap]$Src, [int]$Mult) {
  $b = New-Object System.Drawing.Bitmap ($Src.Width * $Mult), ($Src.Height * $Mult)
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g.DrawImage($Src, 0, 0, $b.Width, $b.Height)
  $g.Dispose()
  return $b
}

function Crop-Frac([System.Drawing.Bitmap]$Bmp, [double]$X, [double]$Y, [double]$W, [double]$H) {
  $cx = [int]([Math]::Max(0, $X * $Bmp.Width))
  $cy = [int]([Math]::Max(0, $Y * $Bmp.Height))
  $cw = [int]([Math]::Min($Bmp.Width - $cx, [Math]::Ceiling($W * $Bmp.Width)))
  $ch = [int]([Math]::Min($Bmp.Height - $cy, [Math]::Ceiling($H * $Bmp.Height)))
  if ($cw -lt 8 -or $ch -lt 8) { return $null }
  $r = New-Object System.Drawing.Rectangle $cx, $cy, $cw, $ch
  return $Bmp.Clone($r, $Bmp.PixelFormat)
}

function Jpeg-DataUrl([System.Drawing.Bitmap]$Bmp, [long]$Quality) {
  $ms = New-Object System.IO.MemoryStream
  try {
    Save-JpegToStream $Bmp $ms $Quality
    return 'data:image/jpeg;base64,' + [Convert]::ToBase64String($ms.ToArray())
  } finally { $ms.Dispose() }
}

function Save-JpegToStream([System.Drawing.Bitmap]$Bmp, [IO.Stream]$Stream, [long]$Quality) {
  $jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.FormatID -eq [System.Drawing.Imaging.ImageFormat]::Jpeg.Guid }
  $enc = New-Object System.Drawing.Imaging.EncoderParameters 1
  $enc.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, $Quality)
  $Bmp.Save($Stream, $jpeg, $enc)
}

function Add-Words($Target, $Source) {
  foreach ($w in $Source) { $Target.Add($w) }
}

function Find-Label($Words, [string[]]$Names) {
  foreach ($w in $Words) {
    $n = $w.Text.ToLowerInvariant()
    foreach ($name in $Names) {
      if ($n -eq $name) { return $w }
    }
  }
  return $null
}

function Number-ForLabel($Words, $Label) {
  if (-not $Label) { return $null }
  $best = $null
  $bestScore = [double]::PositiveInfinity
  foreach ($w in $Words) {
    if ($w.Text -notmatch '^\d{1,6}$') { continue }
    $overlap = [Math]::Min($w.X + $w.W, $Label.X + $Label.W) - [Math]::Max($w.X, $Label.X)
    $close = [Math]::Abs($w.CX - $Label.CX)
    $above = $w.CY -lt ($Label.Y + 8)
    if (-not $above) { continue }
    if ($overlap -le 0 -and $close -gt [Math]::Max($Label.W, 48)) { continue }
    $score = $close + [Math]::Max(0, $Label.Y - ($w.Y + $w.H))
    if ($score -lt $bestScore) { $bestScore = $score; $best = $w }
  }
  if (-not $best) { return $null }
  return [int]$best.Text
}

function Read-CellNumber([System.Drawing.Bitmap]$Bmp, $Label) {
  if (-not $Bmp -or -not $Label) { return $null }
  $pad = [Math]::Max(20, $Label.W * 0.35)
  $x = [int][Math]::Max(0, $Label.X - $pad)
  $y = [int][Math]::Max(0, $Label.Y - 130)
  $w = [int][Math]::Min($Bmp.Width - $x, $Label.W + 2 * $pad)
  $h = [int][Math]::Min($Bmp.Height - $y, ($Label.Y + $Label.H + 8) - $y)
  if ($w -lt 8 -or $h -lt 8) { return $null }
  $c = $null
  try {
    $c = $Bmp.Clone((New-Object System.Drawing.Rectangle $x, $y, $w, $h), $Bmp.PixelFormat)
    $r = Recognize-Words $c
    foreach ($word in $r.Words) {
      if ($word.Text -match '^\d{1,6}$') { return [int]$word.Text }
    }
    if ($r.Text -match '(?<!\d)(\d{1,6})(?!\d)') { return [int]$Matches[1] }
  } catch {} finally { if ($c) { $c.Dispose() } }
  return $null
}


function Remember-Mode([string]$Text, $Fields) {
  if ($Fields -and $Fields.mode) {
    $script:LastMode = [string]$Fields.mode
    return
  }
  $n = Normalize-Text $Text
  if ($n -match 'resurgence' -or $n -match 'rebirth') { $script:LastMode = 'resurgence'; return }
  if ($n -match 'battle royale' -or $n -match ' warzone ' -or $n -match ' br solos') { $script:LastMode = 'warzone'; return }
  if ($n -match ' dmz ' -or $n -match 'you extracted' -or $n -match 'failed to extract') { $script:LastMode = 'dmz'; return }
}

function Ratio-ForLabel($Words, $Label) {
  if (-not $Label) { return $null }
  $best = $null
  $bestScore = [double]::PositiveInfinity
  foreach ($w in $Words) {
    if ($w.Text -notmatch '^\d+(\.\d+)?$') { continue }
    $overlap = [Math]::Min($w.X + $w.W, $Label.X + $Label.W) - [Math]::Max($w.X, $Label.X)
    $close = [Math]::Abs($w.CX - $Label.CX)
    $above = $w.CY -lt ($Label.Y + 8)
    if (-not $above) { continue }
    if ($overlap -le 0 -and $close -gt [Math]::Max($Label.W, 48)) { continue }
    $score = $close + [Math]::Max(0, $Label.Y - ($w.Y + $w.H))
    if ($score -lt $bestScore) { $bestScore = $score; $best = $w }
  }
  if (-not $best) { return $null }
  return [double]$best.Text
}

function Parse-BrTiles([System.Drawing.Bitmap]$Bmp, $Words, [string]$Text) {
  $fields = @{}
  $n = Normalize-Text $Text
  if ($n -match '(\d+)\s*(st|nd|rd|th)\s+place') { $fields.placement = [int]$Matches[1] }
  $killsLab = Find-Label $Words @('kills','kill')
  $ratioLab = Find-Label $Words @('ratio','e/d','ed')
  if (-not $ratioLab) {
    foreach ($w in $Words) {
      if ($w.Text -match 'ratio' -or $w.Text -match '^e/?d$' -or $w.Text -match 'e/d') { $ratioLab = $w; break }
    }
  }
  $dmgLab = Find-Label $Words @('damage')
  $conLab = Find-Label $Words @('contracts','contract')
  $wsLab = $null
  foreach ($w in $Words) {
    $tl = $w.Text.ToLowerInvariant()
    if ($tl -match 'winstrea' -or $tl -match 'winstreak') { $wsLab = $w; break }
  }
  $k = Number-ForLabel $Words $killsLab
  if ($k -eq $null -and $killsLab) { $k = Read-CellNumber $Bmp $killsLab }
  if ($k -ne $null) { $fields.kills = $k }
  $ed = Ratio-ForLabel $Words $ratioLab
  if ($ed -eq $null -and $Text -match '(\d+\.\d+)') { $ed = [double]$Matches[1] }
  if ($ed -ne $null) { $fields.ed_ratio = $ed }
  $d = Number-ForLabel $Words $dmgLab
  if ($d -eq $null -and $dmgLab) { $d = Read-CellNumber $Bmp $dmgLab }
  if ($d -ne $null) { $fields.damage = $d }
  $c = Number-ForLabel $Words $conLab
  if ($c -eq $null -and $conLab) { $c = Read-CellNumber $Bmp $conLab }
  if ($c -ne $null) { $fields.contracts = $c }
  $w = Number-ForLabel $Words $wsLab
  if ($w -eq $null -and $wsLab) { $w = Read-CellNumber $Bmp $wsLab }
  if ($w -ne $null) { $fields.winstreaks = $w }
  if ($fields.ContainsKey('placement')) {
    if ($fields.placement -eq 1) { $fields.won = 1 } else { $fields.won = 0 }
  }
  if ($fields.ContainsKey('placement') -and $fields.placement -ge 50) { $fields.mode = 'warzone'; $fields.mode_label = 'WARZONE' }
  return $fields
}

function Parse-WarzoneStats([System.Drawing.Bitmap]$Bmp, $FooterWords, [string]$HeaderText, [string]$FooterText) {
  $fields = @{}
  $allText = ((Normalize-Text ($HeaderText + ' ' + $FooterText)).Trim())
  if ($allText -match 'resurgence' -or $allText -match 'rebirth') { $fields.mode = 'resurgence'; $fields.mode_label = 'RESURGENCE SOLOS' }
  elseif ($allText -match 'warzone' -or $allText -match 'battle royale') { $fields.mode = 'warzone'; $fields.mode_label = 'WARZONE' }
  if ($FooterText -match '(\d+)\s*(ST|ND|RD|TH)\s*PLACE') {
    $fields.placement = [int]$Matches[1]
  } else {
    $best = $null
    foreach ($w in $FooterWords) {
      if ($w.Text -match '^(\d+)(ST|ND|RD|TH)$') {
        if (-not $best -or $w.H -gt $best.H) {
          $best = $w
          $fields.placement = [int]$Matches[1]
        }
      }
    }
  }
  $labelSets = @{
    contracts = @('contracts','contract')
    kills = @('kills','kill')
    deaths = @('deaths','death')
    assists = @('assists','assist')
  }
  foreach ($key in @('contracts','kills','deaths','assists')) {
    $lab = Find-Label $FooterWords $labelSets[$key]
    $n = Number-ForLabel $FooterWords $lab
    if ($n -eq $null -and $lab) { $n = Read-CellNumber $Bmp $lab }
    if ($n -ne $null) { $fields[$key] = $n }
  }
  $total = Find-Label $FooterWords @('total')
  $dmgLab = Find-Label $FooterWords @('damage')
  $use = $null
  if ($total -and $dmgLab) {
    $use = [pscustomobject]@{
      Text = 'total damage'
      X = [Math]::Min($total.X, $dmgLab.X)
      Y = [Math]::Min($total.Y, $dmgLab.Y)
      W = ([Math]::Max($total.X + $total.W, $dmgLab.X + $dmgLab.W) - [Math]::Min($total.X, $dmgLab.X))
      H = [Math]::Max($total.H, $dmgLab.H)
      CX = 0; CY = 0
    }
    $use.CX = $use.X + $use.W / 2
    $use.CY = $use.Y + $use.H / 2
  } elseif ($dmgLab) { $use = $dmgLab }
  elseif ($total) { $use = $total }
  $damage = Number-ForLabel $FooterWords $use
  if ($damage -eq $null -and $use) { $damage = Read-CellNumber $Bmp $use }
  if ($damage -ne $null) { $fields.damage = $damage }
  if ($fields.ContainsKey('placement')) {
    if ($fields.placement -eq 1) { $fields.won = 1 } else { $fields.won = 0 }
  }
  elseif ($allText -match 'victory') { $fields.won = 1 }
  elseif ($allText -match 'defeat') { $fields.won = 0 }
  if ($HeaderText -match 'REBIRTH\s+ISLAND') { $fields.map = 'Rebirth Island' }
  return $fields
}

function Parse-GenericStats([string]$Text) {
  $fields = @{}
  $n = Normalize-Text $Text
  if ($n -match 'resurgence') { $fields.mode = 'resurgence' }
  elseif ($n -match ' dmz ' -or $n -match 'extracted' -or $n -match 'extraction') { $fields.mode = 'dmz' }
  elseif ($n -match 'warzone' -or $n -match 'battle royale') { $fields.mode = 'warzone' }
  if ($n -match 'you extracted' -or $n -match 'extracted successfully') { $fields.extracted = 1 }
  if ($n -match 'failed to extract' -or $n -match 'extraction failed') { $fields.extracted = 0 }
  if ($n -match 'victory') { $fields.won = 1 }
  if ($n -match 'defeat') { $fields.won = 0 }
  if ($n -match '(\d+)\s*(st|nd|rd|th)\s+place') { $fields.placement = [int]$Matches[1] }
  if ($n -match '(\d+)\s+kills') { $fields.kills = [int]$Matches[1] }
  if ($n -match '(\d+)\s+deaths') { $fields.deaths = [int]$Matches[1] }
  if ($n -match '(\d+)\s+assists') { $fields.assists = [int]$Matches[1] }
  return $fields
}

function Read-FrameStats([System.Drawing.Bitmap]$Bmp, [string]$HintText) {
  $header = $null; $footer = $null; $footer2x = $null; $tiles = $null; $tiles2x = $null
  try {
    $header = Crop-Frac $Bmp 0 0 0.55 0.16
    $footer = Crop-Frac $Bmp 0 0.80 1 0.20
    $tiles = Crop-Frac $Bmp 0 0.55 1 0.35
    $headerRead = if ($header) { Recognize-Words $header } else { @{ Text = ''; Words = @() } }
    if ($header) { Offset-Words $headerRead 0 0 1 }
    $footerRead = if ($footer) { Recognize-Words $footer } else { @{ Text = ''; Words = @() } }
    if ($footer) { Offset-Words $footerRead 0 ($Bmp.Height * 0.80) 1 }
    $tilesRead = if ($tiles) { Recognize-Words $tiles } else { @{ Text = ''; Words = @() } }
    if ($tiles) { Offset-Words $tilesRead 0 ($Bmp.Height * 0.55) 1 }
    $tileWords = New-Object System.Collections.Generic.List[object]
    Add-Words $tileWords $tilesRead.Words
    if ($tiles) {
      $tiles2x = Scale-Bitmap $tiles 2
      $upTiles = Recognize-Words $tiles2x
      Offset-Words $upTiles 0 ($Bmp.Height * 0.55) 2
      Add-Words $tileWords $upTiles.Words
    }
    $allWords = New-Object System.Collections.Generic.List[object]
    Add-Words $allWords $footerRead.Words
    if ($footer) {
      $footer2x = Scale-Bitmap $footer 2
      $up = Recognize-Words $footer2x
      Offset-Words $up 0 ($Bmp.Height * 0.80) 2
      Add-Words $allWords $up.Words
    }
    $headerText = [string]$headerRead.Text
    $footerText = [string]$footerRead.Text
    $tilesText = [string]$tilesRead.Text
    $layoutText = Normalize-Text ($headerText + ' ' + $footerText + ' ' + $tilesText + ' ' + $HintText)
    $isSting = $layoutText.Contains('winstrea') -or $layoutText.Contains('winstreak') -or $layoutText.Contains('e d ratio') -or $layoutText.Contains('e/d') -or ($layoutText.Contains(' ratio') -and $layoutText.Contains('kills'))
    $isWz = $layoutText.Contains('place') -or $layoutText.Contains('your stats') -or $layoutText.Contains('total damage') -or $layoutText.Contains('resurgence') -or $layoutText.Contains('match summary')
    if ($isSting) {
      $fields = Parse-BrTiles $Bmp $tileWords ($tilesText + ' ' + $HintText)
      $layout = 'br-sting'
    } elseif ($isWz) {
      $fields = Parse-WarzoneStats $Bmp $allWords $headerText $footerText
      $layout = 'warzone'
    } else {
      $full = Recognize-Bitmap $Bmp
      $fields = Parse-GenericStats ($headerText + ' ' + $footerText + ' ' + $tilesText + ' ' + $full + ' ' + $HintText)
      $layout = 'other'
    }
    if ($fields -and -not $fields.ContainsKey('placement') -and $HintText -match '(\d+)\s*(st|nd|rd|th)\s+place') {
      $fields.placement = [int]$Matches[1]
      if ($fields.placement -eq 1) { $fields.won = 1 } else { $fields.won = 0 }
    }
    Remember-Mode ($headerText + ' ' + $footerText + ' ' + $tilesText + ' ' + $HintText) $fields
    $text = ($headerText + ' ' + $footerText + ' ' + $tilesText).Trim()
    return @{ Fields = $fields; Text = $text; Layout = $layout }
  } finally {
    if ($header) { $header.Dispose() }
    if ($footer) { $footer.Dispose() }
    if ($footer2x) { $footer2x.Dispose() }
    if ($tiles) { $tiles.Dispose() }
    if ($tiles2x) { $tiles2x.Dispose() }
  }
}

function New-Crops([System.Drawing.Bitmap]$Bmp) {
  $crops = @{}
  $header = Crop-Frac $Bmp 0 0 0.62 0.18
  $footer = Crop-Frac $Bmp 0 0.80 1 0.20
  $tiles = Crop-Frac $Bmp 0 0.55 1 0.35
  $place = Crop-Frac $Bmp 0 0.78 0.32 0.22
  $banner = Crop-Frac $Bmp 0.15 0.20 0.70 0.45
  try {
    if ($header) { $crops.header = Jpeg-DataUrl $header 80 }
    if ($footer) { $crops.footer = Jpeg-DataUrl $footer 85 }
    if ($tiles) { $crops.tiles = Jpeg-DataUrl $tiles 85 }
    if ($place) { $crops.place = Jpeg-DataUrl $place 85 }
    if ($banner) { $crops.banner = Jpeg-DataUrl $banner 85 }
  } finally {
    if ($header) { $header.Dispose() }
    if ($footer) { $footer.Dispose() }
    if ($tiles) { $tiles.Dispose() }
    if ($place) { $place.Dispose() }
    if ($banner) { $banner.Dispose() }
  }
  return $crops
}

function Score-Text([string]$Text) {
  $n = Normalize-Text $Text
  $score = 0.0
  $hits = @()
  foreach ($k in $script:Keywords) {
    if ($k.Text -and $n.Contains($k.Text)) { $score += $k.Score; $hits += $k.Text }
  }
  if ($n.Contains('kills') -and $n.Contains('deaths')) { $score += 0.5; $hits += 'kills+deaths' }
  # Warzone / Resurgence AAR: "31ST PLACE" is the distinctive line. 640px OCR
  # often gets this even when it misses RESURGENCE and MATCH SUMMARY.
  if ([regex]::IsMatch($n, '\d+\s*(st|nd|rd|th)\s+place')) { $score += 3; $hits += 'nth-place' }
  $joined = ($hits -join ',')
  $hasResult = [regex]::IsMatch($joined, 'nth-place|your stats|total damage|kills\+deaths|you extracted|failed to extract|after action|match results|mission results')
  # A Victory / squad / enemy-operators sting without the stats bar is the same
  # match, not a new one.
  if (-not $hasResult) { $score = [Math]::Min($score, $script:NearMiss - 0.1) }
  return @{ Score = $score; Hits = $joined }
}

function Get-Fingerprint([string]$Text) {
  $n = [regex]::Replace((Normalize-Text $Text), '\s+', '')
  if (-not $n) { return '' }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($n))
    return ([BitConverter]::ToString($hash[0..15])).Replace('-', '').ToLowerInvariant()
  } finally { $sha.Dispose() }
}

function Get-CodProcess { Get-Process -Name 'cod' -ErrorAction SilentlyContinue | Select-Object -First 1 }
function Get-CodMonitor {
  $p = Get-CodProcess
  if (-not $p) { return $null }
  $hwnd = $p.MainWindowHandle
  if ($hwnd -eq [IntPtr]::Zero) { return $null }
  $r = [ZoiGrab]::MonitorFromHwnd($hwnd)
  if ($r.Width -le 0) { return $null }
  return $r
}

function Save-Jpeg([System.Drawing.Bitmap]$Bmp, [string]$Path, [long]$Quality) {
  $jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.FormatID -eq [System.Drawing.Imaging.ImageFormat]::Jpeg.Guid }
  $enc = New-Object System.Drawing.Imaging.EncoderParameters 1
  $enc.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, $Quality)
  $Bmp.Save($Path, $jpeg, $enc)
}

function Send-Aar([string]$Path, [string]$Fingerprint, $LocalOcr, $Crops) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  $b64 = [Convert]::ToBase64String($bytes)
  $taken = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $payload = [ordered]@{
    taken_at = $taken
    fingerprint = $Fingerprint
    image = 'data:image/jpeg;base64,' + $b64
  }
  if ($RereadId -gt 0) { $payload.reread_id = $RereadId }
  if ($LocalOcr) { $payload.local_ocr = $LocalOcr }
  if ($Crops) { $payload.crops = $Crops }
  if ($script:LastMode) { $payload.last_mode = $script:LastMode }
  $body = $payload | ConvertTo-Json -Depth 8 -Compress
  try {
    $req = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, $script:Endpoint)
    $req.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $script:Token)
    $req.Content = [System.Net.Http.StringContent]::new($body, [Text.Encoding]::UTF8, 'application/json')
    $res = $script:Http.SendAsync($req).GetAwaiter().GetResult()
    $code = [int]$res.StatusCode
    $text = $res.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if ($code -eq 200 -or $code -eq 201) {
      if ($text -match '"duplicate"\s*:\s*true') { Log 'The lab already had this scoreboard; the extra copy was ignored.' }
      return $true
    }
    Log "Lab returned HTTP $code for a scoreboard upload."
    return $false
  } catch {
    Log ("Couldn't reach the lab: " + $_.Exception.Message)
    return $false
  }
}

function New-LocalOcr($FrameReads) {
  $frames = @()
  foreach ($r in $FrameReads) {
    $frames += [pscustomobject]@{ text = $r.Text; fields = $r.Fields; layout = $r.Layout }
  }
  $fields = @{}
  if ($FrameReads.Count -gt 0) { $fields = $FrameReads[0].Fields }
  return [pscustomobject]@{
    layout = $(if ($FrameReads.Count -gt 0) { $FrameReads[0].Layout } else { 'other' })
    fields = $fields
    frames = $frames
  }
}

function Capture-AndSend([System.Drawing.Rectangle]$Mon, [bool]$Force, [string]$Reason, [string]$Fingerprint, [string]$DetectText, [double]$Score, [string]$Hits) {
  if ($Bench -and -not $Force) {
    Write-ZoiLog $DetectLog ("bench hit score=" + $Score.ToString('0.0') + " reason=$Reason (not uploaded)")
    return
  }
  $bitmaps = New-Object System.Collections.Generic.List[System.Drawing.Bitmap]
  $reads = New-Object System.Collections.Generic.List[object]
  try {
    for ($i = 0; $i -lt 3; $i++) {
      if ($i -gt 0) { Start-Sleep -Milliseconds 400 }
      $bmp = [ZoiGrab]::Grab($Mon, 2560)
      if (-not $bmp) { continue }
      $bitmaps.Add($bmp)
      $reads.Add((Read-FrameStats $bmp $DetectText))
    }
    if ($bitmaps.Count -eq 0) { Log "Couldn't capture the screen."; return }
    $best = $bitmaps[0]
    $name = (Get-Date).ToString('yyyyMMdd-HHmmss') + '-' + $Reason + '.jpg'
    $path = Join-Path $AarDir $name
    Save-Jpeg $best $path 80
    Write-ZoiLog $PositiveLog ("reason=$Reason score=" + $Score.ToString('0.0') + " hits=$Hits text=" + ((Normalize-Text $DetectText).Trim().Substring(0, [Math]::Min(400, ((Normalize-Text $DetectText).Trim().Length)))))
    $crops = New-Crops $best
    $local = New-LocalOcr $reads
    if (-not (Send-Aar $path $Fingerprint $local $crops)) {
      Log "Saved $path but the lab did not take it."
      return
    }
    $script:LastFingerprint = $Fingerprint
    $script:InAar = $true
    Log "Logged a Call of Duty scoreboard ($Reason)."
  } finally {
    foreach ($b in $bitmaps) { $b.Dispose() }
  }
}

function Invoke-FileCapture([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { Log "No screenshot at $Path."; exit 1 }
  $bmp = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $read = Read-FrameStats $bmp ''
    $crops = New-Crops $bmp
    $local = New-LocalOcr @($read)
    $fp = Get-Fingerprint $read.Text
    $tmp = Join-Path $AarDir ('reread-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '.jpg')
    if ([IO.Path]::GetExtension($Path).ToLowerInvariant() -ne '.jpg' -and [IO.Path]::GetExtension($Path).ToLowerInvariant() -ne '.jpeg') {
      Save-Jpeg $bmp $tmp 80
      $sendPath = $tmp
    } else {
      $sendPath = $Path
    }
    Write-ZoiLog $PositiveLog ("reason=file hits=reread text=" + ((Normalize-Text $read.Text).Trim()))
    if (-not (Send-Aar $sendPath $fp $local $crops)) {
      Log "The lab did not take the reread."
      exit 2
    }
    Log "Reread the saved scoreboard for the lab."
  } finally { $bmp.Dispose() }
}

$script:Http = New-Object System.Net.Http.HttpClient
$script:Http.Timeout = [TimeSpan]::FromSeconds(180)
$script:Busy = $false
$script:InAar = $false
$script:LastMode = ''
$script:LastFingerprint = ''
$script:RobWasRunning = $false
$script:RobInShift = $false
$script:RobLastSig = ''
$script:RobLastOcrAt = [DateTime]::MinValue
$script:RobLastSendAt = [DateTime]::MinValue
$script:RobAwaySince = [DateTime]::MinValue
$script:RobForce = $false
$script:SampleMs = New-Object System.Collections.Generic.List[int]
$script:OcrMs = New-Object System.Collections.Generic.List[int]
$script:Samples = 0
$script:LastCpu = [TimeSpan]::Zero
$script:LastCpuAt = [DateTime]::MinValue

function Write-Perf([string]$Why, [bool]$Final) {
  if ($script:SampleMs.Count -eq 0) {
    Log "No samples yet ($Why). Call of Duty may not have been on screen."
    return
  }
  $cores = [Math]::Max(1, [Environment]::ProcessorCount)
  $cpu = [System.Diagnostics.Process]::GetCurrentProcess().TotalProcessorTime
  $now = [DateTime]::UtcNow
  $pct = 0.0
  if ($script:LastCpuAt -ne [DateTime]::MinValue -and $now -gt $script:LastCpuAt) {
    $pct = (($cpu - $script:LastCpu).TotalMilliseconds / ($now - $script:LastCpuAt).TotalMilliseconds / $cores) * 100.0
  }
  $script:LastCpu = $cpu
  $script:LastCpuAt = $now
  $sorted = $script:SampleMs.ToArray(); [Array]::Sort($sorted)
  $osorted = $script:OcrMs.ToArray(); [Array]::Sort($osorted)
  function Pct($arr, $p) { $arr[[int](($p/100.0)*($arr.Length-1))] }
  $line = "$Why`: $($script:SampleMs.Count) samples, capture+ocr p50=$(Pct $sorted 50)ms p95=$(Pct $sorted 95)ms, ocr p50=$(Pct $osorted 50)ms, helper CPU ~$([string]::Format('{0:0.0}', $pct))% of the machine ($cores logical processors)."
  Log $line
  if ($Final) { try { Set-Content -LiteralPath (Join-Path $AarDir 'bench.log') -Value $line } catch {} }
}


function Get-RobRunProcess { Get-Process -Name 'ROB RUN' -ErrorAction SilentlyContinue | Select-Object -First 1 }
function Get-RobRunMonitor {
  $p = Get-RobRunProcess
  if (-not $p) { return $null }
  $hwnd = $p.MainWindowHandle
  if ($hwnd -ne [IntPtr]::Zero) {
    $r = [ZoiGrab]::MonitorFromHwnd($hwnd)
    if ($r.Width -gt 0) { return $r }
  }
  $s = [System.Windows.Forms.Screen]::PrimaryScreen
  if ($s) { return $s.Bounds }
  return [System.Drawing.Rectangle]::new(0, 0, 2560, 1440)
}

function Parse-RobRunHud([string]$Text) {
  $fields = [ordered]@{
    layout = 'other'; player_name = $null; role = $null; notoriety = $null
    party = $null; bonuses = @(); banner = $null; banner_seconds = $null
    chat = @(); cash = $null; shift_remaining_s = $null
  }
  if ([string]::IsNullOrEmpty($Text)) { return $fields }
  $n = [regex]::Replace($Text, '\s+', ' ').Trim()
  if ($Text -match '(?i)ADD MARKER' -and $Text -match '(?i)LOOTY\s*BAY') { $fields.layout = 'city_map' }
  elseif ($Text -match '(?i)\bFPS' -or $Text -match '(?i)\bSOLO\b' -or $Text -match '(?i)(?:^|[^A-Za-z0-9])[lI1|][vV][lI1|]\s*\.?\s*\d{1,2}\b' -or $Text -match '(?i)BECOME A CRIMINAL') { $fields.layout = 'world_hud' }
  if ($Text -match '(?i)LEAVE THE CITY BEFORE THE FEDS' -or $Text -match '(?i)\bYOU\s+(DIED|WERE ARRESTED)\b' -or $Text -match '(?i)\bSHIFT\s+(REPORT|SUMMARY|COMPLETE|ENDED)\b') {
    $fields.layout = 'summary'
  }
  if ($Text -match '(?i)BECOME A CRIMINAL|put on a mask to become a criminal') { $fields.role = 'civilian' }
  elseif ($Text -match '(?i)(?:^|[^A-Za-z0-9])[lI1|][vV][lI1|]\s*\.?\s*\d{1,2}\b') { $fields.role = 'criminal' }
  if ($n -match '(?i)(?:^|[^A-Za-z0-9])[lI1|][vV][lI1|]\s*\.?\s*(\d{1,2})\b') {
    $v = [int]$Matches[1]
    if ($v -ge 1 -and $v -le 20) { $fields.notoriety = $v }
  }
  if ($Text -match '(?i)\b(SOLO|DUO|TRIO|SQUAD)\b') { $fields.party = $Matches[1].ToUpper() }
  $pct = [regex]::Matches($Text, '\+(\d+)%')
  foreach ($m in $pct) { $fields.bonuses += [int]$m.Groups[1].Value }
  $deny = @('FPS','PING','LOSS','TAB','SOLO','DUO','TRIO','SQUAD','CITY','LOOTY','BAY','ESC','BACK','SCALE','CHAT','ALARM')
  if ($Text -match '(?i)\b([A-Za-z][A-Za-z0-9_]{2,20})\s+(SOLO|DUO|TRIO|SQUAD)\b' -and ($deny -notcontains $Matches[1].ToUpper())) { $fields.player_name = $Matches[1] }
  $chatRe = [regex]::Matches($Text, '(\d{1,2}:\d{2})\s+(?:\[[^\]]+\]\s+)?(\S.*?)\s+(was arrested|died)!')
  foreach ($m in $chatRe) {
    $kind = if ($m.Groups[3].Value -match '(?i)died') { 'died' } else { 'arrested' }
    $nm = $m.Groups[2].Value.Trim()
    if (@($fields.chat | Where-Object { $_.at -eq $m.Groups[1].Value -and $_.name -eq $nm -and $_.kind -eq $kind }).Count -eq 0) {
      $fields.chat += @{ at = $m.Groups[1].Value; name = $nm; kind = $kind }
    }
  }
  if ($Text -match '(?i)ALARM\s+GOES\s+OFF\s+IN') {
    $fields.banner = 'alarm'
    $tail = [regex]::Replace($Text, '(?is)^.*ALARM\s+GOES\s+OFF\s+IN', ' ')
    if ($tail -match '\b(\d{1,3})\b') {
      $s = [int]$Matches[1]
      if ($s -ge 0 -and $s -le 600) { $fields.banner_seconds = $s }
    }
  } elseif ($Text -match '(?i)LEAVE THE CITY BEFORE THE FEDS') {
    $fields.banner = 'leave_city'
  }
  if ($Text -match '(?i)(?:CASH|MONEY|WALLET)\s*[:$]?\s*\$?\s*([\d,]{2,})') {
    $v = [int]($Matches[1] -replace ',', '')
    if ($v -ge 0) { $fields.cash = $v }
  }
  return $fields
}

function Rob-HudSig($Fields) {
  if (-not $Fields) { return '' }
  $bits = @(
    [string]$Fields.layout
    [string]$Fields.role
    [string]$Fields.notoriety
    [string]$Fields.party
    [string]$Fields.player_name
    [string]$Fields.banner
    [string]$Fields.banner_seconds
    [string]$Fields.cash
    (($Fields.bonuses | ForEach-Object { $_ }) -join ',')
    (($Fields.chat | ForEach-Object { $_.at + $_.kind + $_.name }) -join ',')
  )
  return ($bits -join '|')
}

function Send-RobRun($Payload) {
  $body = $Payload | ConvertTo-Json -Depth 8 -Compress
  try {
    $req = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, $script:RobEndpoint)
    $req.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $script:Token)
    $req.Content = [System.Net.Http.StringContent]::new($body, [Text.Encoding]::UTF8, 'application/json')
    $res = $script:Http.SendAsync($req).GetAwaiter().GetResult()
    $code = [int]$res.StatusCode
    $text = $res.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if ($code -eq 200 -or $code -eq 201) { return $true }
    Log "Lab returned HTTP $code for a ROB RUN sample."
    return $false
  } catch {
    Log ("Couldn't reach the lab for ROB RUN: " + $_.Exception.Message)
    return $false
  }
}

# Capture time from the file name (yyyyMMdd-HHmmss, local) or its write time.
function Get-RobCaptureTime([string]$Path) {
  $n = [IO.Path]::GetFileNameWithoutExtension($Path)
  if ($n -match '(\d{8})-(\d{6})') {
    $d = [DateTime]::ParseExact($Matches[1] + $Matches[2], 'yyyyMMddHHmmss', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeLocal)
    return $d.ToUniversalTime()
  }
  return (Get-Item -LiteralPath $Path).LastWriteTimeUtc
}

function Invoke-RobRunFile([string]$Path) {
  $script:RobFileOk = $false
  if (-not (Test-Path -LiteralPath $Path)) { Log "No screenshot at $Path."; return }
  $bmp = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $text, $fields = Read-RobRunFrame $bmp
    $tmp = Join-Path $AarDir ('robrun-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '.jpg')
    Save-Jpeg $bmp $tmp 80
    $payload = New-RobPayload $tmp $text $fields 'sample'
    $payload.taken_at = (Get-RobCaptureTime $Path).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    if ($RobBackfill) { $payload.backfill = $true }
    if (Send-RobRun $payload) { $script:RobFileOk = $true } else { Log "The lab did not take the ROB RUN screenshot." }
  } finally { $bmp.Dispose() }
}

function Read-RobRunFrame([System.Drawing.Bitmap]$Bmp) {
  $parts = New-Object System.Collections.Generic.List[string]
  $full = Recognize-Bitmap $Bmp
  if ($full) { [void]$parts.Add($full) }
  $bands = @(
    @(0.0, 0.0, 1.0, 0.28),
    @(0.0, 0.55, 0.40, 0.35),
    @(0.0, 0.70, 0.70, 0.30)
  )
  foreach ($b in $bands) {
    $crop = Crop-Frac $Bmp $b[0] $b[1] $b[2] $b[3]
    if (-not $crop) { continue }
    try {
      $hi = Scale-Bitmap $crop 2
      try {
        $t = Recognize-Bitmap $(if ($hi) { $hi } else { $crop })
        if ($t) { [void]$parts.Add($t) }
      } finally { if ($hi) { $hi.Dispose() } }
    } finally { $crop.Dispose() }
  }
  $text = [string]::Join("`n", $parts)
  $fields = Parse-RobRunHud $text
  return @($text, $fields)
}

function Get-TzOffsetMin { return [int][TimeZoneInfo]::Local.GetUtcOffset([DateTime]::Now).TotalMinutes }

function New-RobPayload([string]$Path, [string]$Text, $Fields, [string]$Event) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  $b64 = [Convert]::ToBase64String($bytes)
  $taken = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $local = [ordered]@{ text = $Text; fields = $Fields }
  return [ordered]@{
    taken_at = $taken
    tz_offset_min = (Get-TzOffsetMin)
    event = $Event
    image = 'data:image/jpeg;base64,' + $b64
    local_ocr = $local
    fingerprint = Get-Fingerprint ($Text + '|' + (Rob-HudSig $Fields))
  }
}

function New-RobPayloadNoImage([string]$Text, $Fields, [string]$Event) {
  $taken = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  return [ordered]@{
    taken_at = $taken
    tz_offset_min = (Get-TzOffsetMin)
    event = $Event
    local_ocr = [ordered]@{ text = $Text; fields = $Fields }
    fingerprint = Get-Fingerprint ($Text + '|' + (Rob-HudSig $Fields))
  }
}

function Invoke-RobRunSample {
  $mon = Get-RobRunMonitor
  if (-not $mon) { return }
  $now = [DateTime]::UtcNow
  if ($script:RobLastOcrAt -ne [DateTime]::MinValue -and ($now - $script:RobLastOcrAt).TotalMilliseconds -lt 5000 -and -not $script:RobForce) {
    return
  }
  $script:RobLastOcrAt = $now
  $bmp = $null
  try {
    $bmp = [ZoiGrab]::Grab($mon, 2560)
    if (-not $bmp) { return }
    $text, $fields = Read-RobRunFrame $bmp
    $inCity = $fields.layout -eq 'world_hud' -or $fields.layout -eq 'city_map' -or $fields.layout -eq 'summary'
    $sig = Rob-HudSig $fields
    $changed = $sig -ne $script:RobLastSig
    $event = 'sample'
    if ($inCity -and -not $script:RobInShift) { $event = 'sample'; $script:RobInShift = $true; $changed = $true }
    if ($fields.layout -eq 'summary' -and $fields.banner -eq 'leave_city') { $event = 'leave_city'; $changed = $true }
    if (-not $inCity) {
      if ($script:RobInShift) {
        if ($script:RobAwaySince -eq [DateTime]::MinValue) { $script:RobAwaySince = $now }
        elseif (($now - $script:RobAwaySince).TotalMinutes -ge 3) {
          $event = 'shift_end'
          $changed = $true
          $script:RobInShift = $false
          $script:RobAwaySince = [DateTime]::MinValue
        }
      }
    } else {
      $script:RobAwaySince = [DateTime]::MinValue
    }
    $heartbeat = $script:RobLastSendAt -ne [DateTime]::MinValue -and ($now - $script:RobLastSendAt).TotalSeconds -ge 60 -and $inCity
    $wantImage = $changed -or $event -ne 'sample' -or $script:RobLastSig -eq ''
    if (-not $changed -and -not $heartbeat -and $event -eq 'sample') { return }
    $name = (Get-Date).ToString('yyyyMMdd-HHmmss') + '-robrun.jpg'
    $path = Join-Path $AarDir $name
    $payload = $null
    if ($wantImage) {
      Save-Jpeg $bmp $path 80
      $payload = New-RobPayload $path $text $fields $event
    } else {
      $payload = New-RobPayloadNoImage $text $fields $event
    }
    if (Send-RobRun $payload) {
      $script:RobLastSig = $sig
      $script:RobLastSendAt = $now
      if ($event -ne 'sample') { Log "Logged a ROB RUN $event." }
    }
  } finally {
    if ($bmp) { $bmp.Dispose() }
  }
}

function Invoke-Sample {
  if ($script:Busy) { return }
  $script:Busy = $true
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $small = $null
  try {
    if (-not (Get-CodProcess)) {
      $script:InAar = $false
      $script:LastMode = ''
      if (Get-RobRunProcess) {
        $script:RobWasRunning = $true
        Invoke-RobRunSample
      } elseif ($script:RobWasRunning) {
        $script:RobWasRunning = $false
        if ($script:RobInShift) {
          $end = New-RobPayloadNoImage '' @{ layout = 'other' } 'process_exit'
          [void](Send-RobRun $end)
          $script:RobInShift = $false
          Log 'ROB RUN closed; the open city shift was ended.'
        }
      }
      return
    }
    $mon = Get-CodMonitor
    if (-not $mon) { return }
    $small = [ZoiGrab]::Grab($mon, $script:DetectWidth)
    if (-not $small) { return }
    $ocrWatch = [System.Diagnostics.Stopwatch]::StartNew()
    $text = Recognize-Bitmap $small
    $ocrMs = [int]$ocrWatch.ElapsedMilliseconds
    $scored = Score-Text $text
    if (-not $script:InAar) { Remember-Mode $text $null }
    $isAar = $scored.Score -ge $script:MinScore
    $near = (-not $isAar) -and ($scored.Score -ge $script:NearMiss)
    if ($near -or ($scored.Score -gt 0 -and -not $isAar)) {
      $snip = ((Normalize-Text $text).Trim())
      if ($snip.Length -gt 300) { $snip = $snip.Substring(0,300) }
      $kind = if ($near) { 'near-miss' } else { 'weak' }
      Write-ZoiLog $DetectLog ("$kind score=" + $scored.Score.ToString('0.0') + " hits=$($scored.Hits) text=$snip")
    }
    if ($isAar -and -not $script:InAar) {
      $script:InAar = $true
      $fp = Get-Fingerprint $text
      if ($fp -and $fp -eq $script:LastFingerprint) {
        Write-ZoiLog $DetectLog 'dedupe fingerprint match; not capturing again'
      } else {
        Capture-AndSend $mon $false 'auto' $fp $text $scored.Score $scored.Hits
      }
    } elseif ((-not $isAar) -and $script:InAar -and ($scored.Score -lt $script:NearMiss)) {
      $script:InAar = $false
$script:LastMode = ''
    }
    $script:Samples++
    $script:SampleMs.Add([int]$sw.ElapsedMilliseconds)
    $script:OcrMs.Add($ocrMs)
    if ($script:Samples % 20 -eq 0) { Write-Perf 'sample' $false }
  } catch {
    Log ("Scoreboard sample failed: " + $_.Exception.Message)
  } finally {
    if ($small) { $small.Dispose() }
    $script:Busy = $false
  }
}

function Invoke-ForceCapture([string]$Reason) {
  if (-not (Get-CodProcess)) {
    Log "$Reason pressed, but Call of Duty is not running. Nothing was captured."
    return
  }
  $mon = Get-CodMonitor
  if (-not $mon) { Log "Couldn't find the Call of Duty window's screen."; return }
  $small = $null
  try {
    $small = [ZoiGrab]::Grab($mon, $script:DetectWidth)
    $text = if ($small) { Recognize-Bitmap $small } else { '' }
    $scored = Score-Text $text
    $script:Busy = $true
    Capture-AndSend $mon $true $Reason (Get-Fingerprint $text) $text $scored.Score $scored.Hits
  } finally {
    if ($small) { $small.Dispose() }
    $script:Busy = $false
  }
}

if ($File) {
  if ($RobRun) {
    $paths = @($File -split ';' | Where-Object { $_ })
    $bad = 0
    foreach ($fp in $paths) { [void](Invoke-RobRunFile $fp); if (-not $script:RobFileOk) { $bad++ } }
    Log ("Sent " + ($paths.Count - $bad) + " of " + $paths.Count + " ROB RUN screenshots to the lab.")
    if ($bad) { exit 2 } else { exit 0 }
  }
  Invoke-FileCapture $File
  exit 0
}
if ($Once) { Invoke-ForceCapture 'once'; exit 0 }

if ($Bench) {
  Log 'Measuring scoreboard-sample cost for 15 seconds (downscaled desktop blit + Windows OCR, no files kept).'
  $script:LastCpu = [System.Diagnostics.Process]::GetCurrentProcess().TotalProcessorTime
  $script:LastCpuAt = [DateTime]::UtcNow
  $end = [DateTime]::UtcNow.AddSeconds(15)
  while ([DateTime]::UtcNow -lt $end) {
    Invoke-Sample
    Start-Sleep -Milliseconds $script:PollMs
  }
  Write-Perf 'bench' $true
  exit 0
}

$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\ZoiLabCodAar', [ref]$created)
if (-not $created) { exit 0 }
try {
  Log 'Call of Duty scoreboard capture and ROB RUN HUD sampling are on. They watch the screen only while those games are running. F9 is a Call of Duty backup.'
  $form = New-Object System.Windows.Forms.Form
  $form.ShowInTaskbar = $false
  $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow
  $form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
  $form.Opacity = 0
  $form.Size = [Drawing.Size]::new(0,0)
  $form.add_Load({ $form.Hide() })
  $null = [ZoiGrab]::RegisterHotKey($form.Handle, 1, 0, 0x78)
  $form.Add_KeyDown({}) # no-op
  $native = $form.GetType().GetMethod('DefWndProc', [Reflection.BindingFlags]'Instance,NonPublic')
  # Use NativeWindow-style via WndProc override is hard in PS; poll F9 via RegisterHotKey + Application filter
  $filter = [System.Windows.Forms.IMessageFilter]
  Add-Type -ReferencedAssemblies System.Windows.Forms,System.dll -TypeDefinition @"
using System;
using System.Windows.Forms;
public class ZoiHotkeyFilter : IMessageFilter {
  public Action OnF9;
  public bool PreFilterMessage(ref Message m) {
    if (m.Msg == 0x0312 && m.WParam.ToInt32() == 1) { if (OnF9 != null) OnF9(); }
    return false;
  }
}
"@
  $hk = New-Object ZoiHotkeyFilter
  $hk.OnF9 = { Invoke-ForceCapture 'f9' }
  [System.Windows.Forms.Application]::AddMessageFilter($hk)
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = $script:PollMs
  $timer.add_Tick({ Invoke-Sample })
  $timer.Start()
  [System.Windows.Forms.Application]::Run($form)
  $timer.Stop()
  [ZoiGrab]::UnregisterHotKey($form.Handle, 1)
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
