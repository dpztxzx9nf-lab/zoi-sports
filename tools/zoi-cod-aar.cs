// Zoi lab: watch for a Call of Duty after-action report on the player's
// own screen and send one picture per match to the lab.
//
// The only capture path is a desktop / monitor blit (StretchBlt). Nothing
// here hooks, injects into, or overlays cod.exe. Sampling runs only while
// a process named "cod" exists; a frame that is not an AAR is dropped
// immediately and never written to disk. F9 is an optional backup if the
// detector misses a screen.
//
// C# 5 / .NET 4.x, compiled on the machine with csc.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using System.Runtime.InteropServices.WindowsRuntime;

internal sealed class MessageWindow : Form
{
    public event Action Hotkey;
    public MessageWindow()
    {
        ShowInTaskbar = false;
        FormBorderStyle = FormBorderStyle.FixedToolWindow;
        WindowState = FormWindowState.Minimized;
        Opacity = 0;
        Size = new Size(0, 0);
    }
    protected override void SetVisibleCore(bool value)
    {
        base.SetVisibleCore(false);
    }
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == 0x0312 && m.WParam.ToInt32() == 1)
        {
            if (Hotkey != null) Hotkey();
        }
        base.WndProc(ref m);
    }
}

internal static class Program
{
    const int VK_F9 = 0x78;
    const int HOTKEY_ID = 1;
    const uint SRCCOPY = 0x00CC0020;
    const uint CAPTUREBLT = 0x40000000;
    const uint MONITOR_DEFAULTTONEAREST = 2;

    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hWnd, int id);
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

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    static readonly HttpClient Http = new HttpClient();
    static string Here;
    static string AgentLog;
    static string DetectLog;
    static string PositiveLog;
    static string AarDir;
    static string Token;
    static string Endpoint;
    static int PollMs = 2500;
    static int DetectWidth = 640;
    static double MinScore = 3;
    static double NearMiss = 1.5;
    static List<Keyword> Keywords = new List<Keyword>();
    static List<string[]> PairBonus = new List<string[]>();
    static int Busy;
    static bool InAar;
    static string LastFingerprint = "";
    static OcrEngine Engine;
    static readonly object LogLock = new object();
    static bool Bench;
    static bool Once;
    static readonly List<int> SampleMs = new List<int>();
    static readonly List<int> OcrMs = new List<int>();
    static TimeSpan LastCpu;
    static DateTime LastCpuAt;
    static int Samples;

    struct Keyword
    {
        public string Text;
        public double Score;
    }

    [STAThread]
    static int Main(string[] args)
    {
        Http.Timeout = TimeSpan.FromSeconds(90);
        Here = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        AgentLog = Path.Combine(Here, "zoi-lab-agent.log");
        AarDir = Path.Combine(Here, "aar");
        DetectLog = Path.Combine(AarDir, "detector.log");
        PositiveLog = Path.Combine(AarDir, "positive.log");
        try { Directory.CreateDirectory(AarDir); } catch { }

        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (string.Equals(a, "--bench", StringComparison.OrdinalIgnoreCase)) Bench = true;
            else if (string.Equals(a, "--once", StringComparison.OrdinalIgnoreCase)) Once = true;
        }

        LoadDefaults();
        LoadDetectorConfig();
        if (!LoadAgentConfig()) return 1;

        try { Engine = OcrEngine.TryCreateFromUserProfileLanguages(); }
        catch { Engine = null; }
        if (Engine == null)
        {
            Log("Couldn't start Windows OCR. Automatic scoreboard detection is off; F9 still works while Call of Duty is running.");
        }

        if (Once)
        {
            CaptureAndSend(true, "once");
            return 0;
        }

        if (Bench)
        {
            RunBench();
            return 0;
        }

        bool created;
        using (Mutex mutex = new Mutex(true, "Local\\ZoiLabCodAar", out created))
        {
            if (!created) return 0;
            MessageWindow wnd = new MessageWindow();
            if (!RegisterHotKey(wnd.Handle, HOTKEY_ID, 0, (uint)VK_F9))
            {
                Log("Couldn't register F9 as a backup scoreboard capture key.");
            }
            else
            {
                wnd.Hotkey += OnHotkey;
            }
            Log("Call of Duty scoreboard capture is on. It watches the screen while the game is running; F9 is a backup.");
            System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
            timer.Interval = PollMs;
            timer.Tick += OnTick;
            timer.Start();
            Application.Run(wnd);
            timer.Stop();
            UnregisterHotKey(wnd.Handle, HOTKEY_ID);
        }
        return 0;
    }

    static void OnHotkey()
    {
        if (CodProcess() == null)
        {
            Log("F9 pressed, but Call of Duty is not running. Nothing was captured.");
            return;
        }
        ThreadPool.QueueUserWorkItem(delegate { CaptureAndSend(true, "f9"); });
    }

    static void OnTick(object sender, EventArgs e)
    {
        ThreadPool.QueueUserWorkItem(delegate { Sample(); });
    }

    static void RunBench()
    {
        Log("Measuring scoreboard-sample cost for " + 15 + " seconds (downscaled desktop blit + Windows OCR, no files kept).");
        DateTime end = DateTime.UtcNow.AddSeconds(15);
        LastCpu = Process.GetCurrentProcess().TotalProcessorTime;
        LastCpuAt = DateTime.UtcNow;
        while (DateTime.UtcNow < end)
        {
            Sample();
            Thread.Sleep(PollMs);
        }
        WritePerf("bench", true);
    }

    static void Sample()
    {
        if (Interlocked.CompareExchange(ref Busy, 1, 0) != 0) return;
        Stopwatch sw = Stopwatch.StartNew();
        int ocrMs = 0;
        Bitmap small = null;
        try
        {
            if (CodProcess() == null) { InAar = false; return; }
            Rectangle mon;
            if (!CodMonitor(out mon)) return;

            small = Grab(mon, DetectWidth);
            if (small == null) return;

            Stopwatch ocrWatch = Stopwatch.StartNew();
            string text = Recognize(small);
            ocrMs = (int)ocrWatch.ElapsedMilliseconds;

            // Non-AAR frames are never written. The bitmap is disposed below.
            double score;
            string hits;
            ScoreText(text, out score, out hits);
            bool isAar = score >= MinScore;
            bool near = !isAar && score >= NearMiss;

            if (near)
            {
                DetectLogLine("near-miss score=" + score.ToString("0.0") + " hits=" + hits + " text=" + OneLine(text, 300));
            }

            if (isAar && !InAar)
            {
                InAar = true;
                string fp = Fingerprint(text);
                if (fp.Length > 0 && fp == LastFingerprint)
                {
                    DetectLogLine("dedupe fingerprint match; not capturing again");
                }
                else
                {
                    CaptureAndSendCore(mon, false, "auto", fp, text, score, hits);
                }
            }
            else if (!isAar && InAar && score < NearMiss)
            {
                InAar = false;
            }

            Samples++;
            SampleMs.Add((int)sw.ElapsedMilliseconds);
            OcrMs.Add(ocrMs);
            if (Samples % 20 == 0) WritePerf("sample", false);
        }
        catch (Exception ex)
        {
            Log("Scoreboard sample failed: " + ex.Message);
        }
        finally
        {
            if (small != null) small.Dispose();
            Interlocked.Exchange(ref Busy, 0);
        }
    }

    static void CaptureAndSend(bool force, string reason)
    {
        if (Interlocked.CompareExchange(ref Busy, 1, 0) != 0 && !force) return;
        try
        {
            Rectangle mon;
            if (!CodMonitor(out mon))
            {
                Log("Couldn't find the Call of Duty window's screen.");
                return;
            }
            Bitmap small = null;
            try
            {
                small = Grab(mon, DetectWidth);
                string text = small != null ? Recognize(small) : "";
                double score;
                string hits;
                ScoreText(text, out score, out hits);
                CaptureAndSendCore(mon, force, reason, Fingerprint(text), text, score, hits);
            }
            finally
            {
                if (small != null) small.Dispose();
            }
        }
        catch (Exception ex)
        {
            Log("Scoreboard capture failed: " + ex.Message);
        }
        finally
        {
            Interlocked.Exchange(ref Busy, 0);
        }
    }

    static void CaptureAndSendCore(Rectangle mon, bool force, string reason, string fingerprint, string detectText, double score, string hits)
    {
        if (Bench && !force)
        {
            DetectLogLine("bench hit score=" + score.ToString("0.0") + " reason=" + reason + " (not uploaded)");
            return;
        }

        Bitmap full = Grab(mon, 2560);
        if (full == null)
        {
            Log("Couldn't capture the screen.");
            return;
        }
        string path = null;
        try
        {
            string name = DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + reason + ".jpg";
            path = Path.Combine(AarDir, name);
            SaveJpeg(full, path, 80L);
            if (!File.Exists(path)) return;

            PositiveLogLine("reason=" + reason + " score=" + score.ToString("0.0") + " hits=" + hits + " text=" + OneLine(detectText, 400));
            if (!Upload(path, fingerprint))
            {
                // Keep the local JPEG so it can be retried; say so.
                Log("Saved " + path + " but the lab did not take it.");
                return;
            }
            LastFingerprint = fingerprint;
            InAar = true;
            Log("Logged a Call of Duty scoreboard (" + reason + ").");
        }
        finally
        {
            full.Dispose();
        }
    }

    static bool Upload(string path, string fingerprint)
    {
        byte[] bytes = File.ReadAllBytes(path);
        string b64 = Convert.ToBase64String(bytes);
        string taken = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
        StringBuilder sb = new StringBuilder();
        sb.Append("{\"taken_at\":\"");
        sb.Append(taken);
        sb.Append("\",\"fingerprint\":\"");
        sb.Append(Esc(fingerprint));
        sb.Append("\",\"image\":\"data:image/jpeg;base64,");
        sb.Append(b64);
        sb.Append("\"}");
        HttpRequestMessage req = new HttpRequestMessage(HttpMethod.Post, Endpoint);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        req.Content = new StringContent(sb.ToString(), Encoding.UTF8, "application/json");
        try
        {
            HttpResponseMessage res = Http.SendAsync(req).GetAwaiter().GetResult();
            string body = res.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            int code = (int)res.StatusCode;
            if (code == 200 || code == 201)
            {
                if (body != null && body.IndexOf("\"duplicate\":true", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    Log("The lab already had this scoreboard; the extra copy was ignored.");
                }
                return true;
            }
            Log("Lab returned HTTP " + code + " for a scoreboard upload.");
            return false;
        }
        catch (Exception ex)
        {
            Log("Couldn't reach the lab: " + ex.Message);
            return false;
        }
    }

    static string Recognize(Bitmap bmp)
    {
        if (Engine == null || bmp == null) return "";
        MemoryStream ms = null;
        try
        {
            ms = new MemoryStream();
            SaveJpeg(bmp, ms, 70L);
            ms.Position = 0;
            var ras = ms.AsRandomAccessStream();
            var decoder = BitmapDecoder.CreateAsync(ras).AsTask().GetAwaiter().GetResult();
            var software = decoder.GetSoftwareBitmapAsync().AsTask().GetAwaiter().GetResult();
            if (software.BitmapPixelFormat != BitmapPixelFormat.Bgra8 &&
                software.BitmapPixelFormat != BitmapPixelFormat.Gray8)
            {
                software = SoftwareBitmap.Convert(software, BitmapPixelFormat.Bgra8);
            }
            var result = Engine.RecognizeAsync(software).AsTask().GetAwaiter().GetResult();
            return result != null && result.Text != null ? result.Text : "";
        }
        catch
        {
            return "";
        }
        finally
        {
            if (ms != null) ms.Dispose();
        }
    }

    static void ScoreText(string text, out double score, out string hits)
    {
        score = 0;
        StringBuilder hit = new StringBuilder();
        string n = Normalize(text);
        for (int i = 0; i < Keywords.Count; i++)
        {
            Keyword k = Keywords[i];
            if (k.Text.Length == 0) continue;
            if (n.IndexOf(k.Text) >= 0)
            {
                score += k.Score;
                if (hit.Length > 0) hit.Append(",");
                hit.Append(k.Text);
            }
        }
        for (int i = 0; i < PairBonus.Count; i++)
        {
            string[] pair = PairBonus[i];
            bool all = true;
            for (int j = 0; j < pair.Length; j++)
            {
                if (n.IndexOf(pair[j]) < 0) { all = false; break; }
            }
            if (all)
            {
                score += 0.5;
                if (hit.Length > 0) hit.Append(",");
                hit.Append("kills+deaths");
            }
        }
        hits = hit.ToString();
    }

    static string Normalize(string text)
    {
        if (string.IsNullOrEmpty(text)) return "";
        string s = text.ToLowerInvariant();
        s = s.Replace("-", " ");
        s = Regex.Replace(s, "[^a-z0-9]+", " ");
        return " " + s.Trim() + " ";
    }

    static string Fingerprint(string text)
    {
        string n = Regex.Replace(Normalize(text), "\\s+", "");
        if (n.Length == 0) return "";
        SHA256 sha = SHA256.Create();
        try
        {
            byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(n));
            StringBuilder hex = new StringBuilder(32);
            for (int i = 0; i < 16; i++) hex.Append(hash[i].ToString("x2"));
            return hex.ToString();
        }
        finally { sha.Dispose(); }
    }

    static Process CodProcess()
    {
        Process[] list = Process.GetProcessesByName("cod");
        try
        {
            if (list == null || list.Length == 0) return null;
            return list[0];
        }
        finally
        {
            if (list != null)
            {
                for (int i = 0; i < list.Length; i++)
                {
                    if (list[0] != null && i == 0) continue;
                    try { list[i].Dispose(); } catch { }
                }
            }
        }
    }

    static bool CodMonitor(out Rectangle bounds)
    {
        bounds = Rectangle.Empty;
        Process proc = CodProcess();
        if (proc == null) return false;
        IntPtr hwnd = IntPtr.Zero;
        try { hwnd = proc.MainWindowHandle; } catch { }
        try { proc.Dispose(); } catch { }
        if (hwnd == IntPtr.Zero) return false;
        IntPtr mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if (mon == IntPtr.Zero) return false;
        MONITORINFO info = new MONITORINFO();
        info.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
        if (!GetMonitorInfo(mon, ref info)) return false;
        bounds = Rectangle.FromLTRB(info.rcMonitor.Left, info.rcMonitor.Top, info.rcMonitor.Right, info.rcMonitor.Bottom);
        return bounds.Width > 0 && bounds.Height > 0;
    }

    static Bitmap Grab(Rectangle bounds, int maxWidth)
    {
        int w = bounds.Width;
        int h = bounds.Height;
        if (w <= 0 || h <= 0) return null;
        int dw = w;
        int dh = h;
        if (maxWidth > 0 && w > maxWidth)
        {
            dw = maxWidth;
            dh = Math.Max(1, (int)((long)h * maxWidth / w));
        }
        IntPtr hdcSrc = GetDC(IntPtr.Zero);
        if (hdcSrc == IntPtr.Zero) return null;
        IntPtr hdcDst = CreateCompatibleDC(hdcSrc);
        IntPtr hBmp = CreateCompatibleBitmap(hdcSrc, dw, dh);
        IntPtr old = SelectObject(hdcDst, hBmp);
        Bitmap bmp = null;
        try
        {
            StretchBlt(hdcDst, 0, 0, dw, dh, hdcSrc, bounds.X, bounds.Y, w, h, SRCCOPY | CAPTUREBLT);
            bmp = Image.FromHbitmap(hBmp);
        }
        finally
        {
            SelectObject(hdcDst, old);
            DeleteObject(hBmp);
            DeleteDC(hdcDst);
            ReleaseDC(IntPtr.Zero, hdcSrc);
        }
        return bmp;
    }

    static void SaveJpeg(Bitmap bmp, string path, long quality)
    {
        using (FileStream fs = File.Create(path))
        {
            SaveJpeg(bmp, fs, quality);
        }
    }

    static void SaveJpeg(Bitmap bmp, Stream stream, long quality)
    {
        ImageCodecInfo jpeg = null;
        ImageCodecInfo[] encoders = ImageCodecInfo.GetImageEncoders();
        for (int i = 0; i < encoders.Length; i++)
        {
            if (encoders[i].FormatID == ImageFormat.Jpeg.Guid) { jpeg = encoders[i]; break; }
        }
        if (jpeg == null)
        {
            bmp.Save(stream, ImageFormat.Jpeg);
            return;
        }
        EncoderParameters p = new EncoderParameters(1);
        p.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
        bmp.Save(stream, jpeg, p);
        p.Dispose();
    }

    static void WritePerf(string why, bool final)
    {
        if (SampleMs.Count == 0)
        {
            Log("No samples yet (" + why + "). Call of Duty may not have been on screen.");
            return;
        }
        int cores = Math.Max(1, Environment.ProcessorCount);
        Process proc = Process.GetCurrentProcess();
        TimeSpan cpu = proc.TotalProcessorTime;
        DateTime now = DateTime.UtcNow;
        double cpuPct = 0;
        if (LastCpuAt != default(DateTime) && now > LastCpuAt)
        {
            cpuPct = (cpu - LastCpu).TotalMilliseconds / (now - LastCpuAt).TotalMilliseconds / cores * 100.0;
        }
        LastCpu = cpu;
        LastCpuAt = now;
        string line = why + ": " + SampleMs.Count + " samples, capture+ocr p50=" + Percentile(SampleMs, 50) +
            "ms p95=" + Percentile(SampleMs, 95) + "ms, ocr p50=" + Percentile(OcrMs, 50) +
            "ms, helper CPU ~" + cpuPct.ToString("0.0") + "% of the machine (" + cores + " logical processors).";
        Log(line);
        if (final)
        {
            try { File.WriteAllText(Path.Combine(AarDir, "bench.log"), line + Environment.NewLine); } catch { }
        }
    }

    static int Percentile(List<int> values, int p)
    {
        if (values.Count == 0) return 0;
        int[] copy = values.ToArray();
        Array.Sort(copy);
        int i = (int)((p / 100.0) * (copy.Length - 1));
        if (i < 0) i = 0;
        if (i >= copy.Length) i = copy.Length - 1;
        return copy[i];
    }

    static void LoadDefaults()
    {
        Keywords.Clear();
        AddKw("after action report", 3);
        AddKw("after action", 2.5);
        AddKw("failed to extract", 2.5);
        AddKw("you extracted", 2.5);
        AddKw("extraction failed", 2.5);
        AddKw("mission results", 2);
        AddKw("match results", 2);
        AddKw("xp summary", 1.5);
        AddKw("victory", 1.5);
        AddKw("defeat", 1.5);
        AddKw("extracted", 1);
        AddKw("placement", 1);
        AddKw("scoreboard", 1);
        PairBonus.Clear();
        PairBonus.Add(new string[] { "kills", "deaths" });
    }

    static void AddKw(string text, double score)
    {
        Keyword k;
        k.Text = Normalize(text).Trim();
        k.Score = score;
        Keywords.Add(k);
    }

    static void LoadDetectorConfig()
    {
        string path = Path.Combine(Here, "zoi-cod-aar.json");
        if (!File.Exists(path)) return;
        string json;
        try { json = File.ReadAllText(path); }
        catch { return; }
        int poll = IntFromJson(json, "poll_ms");
        if (poll >= 1000 && poll <= 10000) PollMs = poll;
        int width = IntFromJson(json, "detect_width");
        if (width >= 320 && width <= 1280) DetectWidth = width;
        double min = DblFromJson(json, "min_score");
        if (min > 0) MinScore = min;
        double near = DblFromJson(json, "near_miss");
        if (near > 0) NearMiss = near;
        // Keywords in the file replace the defaults when present.
        if (json.IndexOf("\"keywords\"", StringComparison.OrdinalIgnoreCase) >= 0)
        {
            Keywords.Clear();
            MatchCollection ms = Regex.Matches(json, "\\{\\s*\"text\"\\s*:\\s*\"([^\"]+)\"\\s*,\\s*\"score\"\\s*:\\s*([0-9.]+)\\s*\\}");
            for (int i = 0; i < ms.Count; i++)
            {
                double s;
                if (double.TryParse(ms[i].Groups[2].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out s))
                    AddKw(Unescape(ms[i].Groups[1].Value), s);
            }
        }
    }

    static int IntFromJson(string json, string key)
    {
        Match m = Regex.Match(json, "\"" + key + "\"\\s*:\\s*(-?[0-9]+)");
        int v;
        if (m.Success && int.TryParse(m.Groups[1].Value, out v)) return v;
        return -1;
    }

    static double DblFromJson(string json, string key)
    {
        Match m = Regex.Match(json, "\"" + key + "\"\\s*:\\s*(-?[0-9.]+)");
        double v;
        if (m.Success && double.TryParse(m.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out v)) return v;
        return -1;
    }

    static bool LoadAgentConfig()
    {
        string path = Path.Combine(Here, "zoi-lab-agent.json");
        if (!File.Exists(path))
        {
            Log("No config file at " + path + ".");
            return false;
        }
        string json;
        try { json = File.ReadAllText(path); }
        catch (Exception ex)
        {
            Log("Couldn't read the lab config: " + ex.Message);
            return false;
        }
        Token = JsonString(json, "token");
        string endpoint = JsonString(json, "endpoint");
        if (string.IsNullOrEmpty(Token) || string.IsNullOrEmpty(endpoint))
        {
            Log("The lab config is missing a token or endpoint.");
            return false;
        }
        Endpoint = endpoint.Trim();
        if (Endpoint.EndsWith("/api/lab-sync", StringComparison.OrdinalIgnoreCase))
            Endpoint = Endpoint.Substring(0, Endpoint.Length - "/api/lab-sync".Length) + "/api/lab-cod-aar";
        else if (Endpoint.IndexOf("/api/lab-cod-aar", StringComparison.OrdinalIgnoreCase) < 0)
        {
            try
            {
                Uri u = new Uri(Endpoint);
                Endpoint = u.GetLeftPart(UriPartial.Authority) + "/api/lab-cod-aar";
            }
            catch
            {
                Log("The lab endpoint could not be read.");
                return false;
            }
        }
        return true;
    }

    static string JsonString(string json, string key)
    {
        Match m = Regex.Match(json, "\"" + key + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        if (!m.Success) return "";
        return Unescape(m.Groups[1].Value).Trim();
    }

    static string Unescape(string s)
    {
        return s.Replace("\\\\", "\\").Replace("\\\"", "\"").Replace("\\n", "\n");
    }

    static string Esc(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }

    static string OneLine(string s, int max)
    {
        if (string.IsNullOrEmpty(s)) return "";
        string t = Regex.Replace(s, "\\s+", " ").Trim();
        if (t.Length > max) t = t.Substring(0, max);
        return t;
    }

    static void Log(string line)
    {
        WriteLine(AgentLog, line);
    }

    static void DetectLogLine(string line)
    {
        WriteLine(DetectLog, line);
    }

    static void PositiveLogLine(string line)
    {
        WriteLine(PositiveLog, line);
    }

    static void WriteLine(string path, string line)
    {
        string stamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + line;
        lock (LogLock)
        {
            try { File.AppendAllText(path, stamp + Environment.NewLine); } catch { }
        }
    }
}
