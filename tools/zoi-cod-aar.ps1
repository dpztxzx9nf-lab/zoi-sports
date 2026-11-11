# Zoi lab: watch for a Call of Duty after-action report on the player's
# own screen and send one picture per match to the lab.
# Desktop blit only. No hooks, overlay, or injection. Frames that are not
# an AAR are dropped immediately and never written. F9 is a backup.
# Hidden: start with powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File this.

param(
  [switch]$Bench,
  [switch]$Once
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
    if ($cfg.detect_width -ge 320 -and $cfg.detect_width -le 1280) { $script:DetectWidth = [int]$cfg.detect_width }
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
  return @{ Score = $score; Hits = ($hits -join ',') }
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

function Send-Aar([string]$Path, [string]$Fingerprint) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  $b64 = [Convert]::ToBase64String($bytes)
  $taken = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $body = '{"taken_at":"' + $taken + '","fingerprint":"' + $Fingerprint + '","image":"data:image/jpeg;base64,' + $b64 + '"}'
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

function Capture-AndSend([System.Drawing.Rectangle]$Mon, [bool]$Force, [string]$Reason, [string]$Fingerprint, [string]$DetectText, [double]$Score, [string]$Hits) {
  if ($Bench -and -not $Force) {
    Write-ZoiLog $DetectLog ("bench hit score=" + $Score.ToString('0.0') + " reason=$Reason (not uploaded)")
    return
  }
  $full = [ZoiGrab]::Grab($Mon, 2560)
  if (-not $full) { Log "Couldn't capture the screen."; return }
  try {
    $name = (Get-Date).ToString('yyyyMMdd-HHmmss') + '-' + $Reason + '.jpg'
    $path = Join-Path $AarDir $name
    Save-Jpeg $full $path 80
    Write-ZoiLog $PositiveLog ("reason=$Reason score=" + $Score.ToString('0.0') + " hits=$Hits text=" + ((Normalize-Text $DetectText).Trim().Substring(0, [Math]::Min(400, ((Normalize-Text $DetectText).Trim().Length)))))
    if (-not (Send-Aar $path $Fingerprint)) {
      Log "Saved $path but the lab did not take it."
      return
    }
    $script:LastFingerprint = $Fingerprint
    $script:InAar = $true
    Log "Logged a Call of Duty scoreboard ($Reason)."
  } finally { $full.Dispose() }
}

$script:Http = New-Object System.Net.Http.HttpClient
$script:Http.Timeout = [TimeSpan]::FromSeconds(90)
$script:Busy = $false
$script:InAar = $false
$script:LastFingerprint = ''
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

function Invoke-Sample {
  if ($script:Busy) { return }
  $script:Busy = $true
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $small = $null
  try {
    if (-not (Get-CodProcess)) { $script:InAar = $false; return }
    $mon = Get-CodMonitor
    if (-not $mon) { return }
    $small = [ZoiGrab]::Grab($mon, $script:DetectWidth)
    if (-not $small) { return }
    $ocrWatch = [System.Diagnostics.Stopwatch]::StartNew()
    $text = Recognize-Bitmap $small
    $ocrMs = [int]$ocrWatch.ElapsedMilliseconds
    $scored = Score-Text $text
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
  Log 'Call of Duty scoreboard capture is on. It watches the screen while the game is running; F9 is a backup.'
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
