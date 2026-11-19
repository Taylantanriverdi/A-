# ============================================================
#  Kazıma Paneli - DentMill X5 / Eding CNC V4.03
#  Primer Teknoloji
#  Dosya Seç | Başlat | Duraklat | Durdur | Frez Bırak | Temizlik
#  Eding'e P:\CNC\cncapi.dll üzerinden bağlanır (32 bit).
# ============================================================

# ---------------- AYARLAR ----------------
$EdingAdaylari  = @('P:\CNC')              # Makine (orijinal X5): Eding P:\CNC klasöründe
$EdingKlasor    = $EdingAdaylari[0]
$AktifIsAdi     = 'AKTIF_IS.nc'            # Son seçilen işin sabit adlı kopyası
$AyarliTakimlar = @(1,2,3,4,5,6)           # Konumu doğrulanan takımlar (hepsi G54 + #4000'den hesaplanır)
$script:Sade    = $true                    # sade akış (soru yok); frez modu Ayarlar › PANELden, makro türü otomatik algılanır
if ($script:Sade) { $EdingAdaylari = @('P:\CNC', 'C:\CNC_X5', 'C:\CNC4.03', 'C:\CNC4.04', 'C:\CNC4.02', 'C:\CNC'); $EdingKlasor = $EdingAdaylari[0] }
# -----------------------------------------

$ScriptKlasor = Split-Path -Parent $MyInvocation.MyCommand.Path
# Eding klasörünü bul
$adaylar = @($EdingAdaylari)
# Farklı bilgisayar (örn. dizüstü): PrimerMill klasöründeki eding_yolu.txt'ye yazılan klasör her şeyden önce kullanılır
try {
    $yoluDosyasi = [System.IO.Path]::Combine($ScriptKlasor, 'eding_yolu.txt')
    if ([System.IO.File]::Exists($yoluDosyasi)) {
        $ozelYol = ([System.IO.File]::ReadAllLines($yoluDosyasi) | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('#') } | Select-Object -First 1)
        if ($ozelYol) { $adaylar = @($ozelYol.Trim().TrimEnd('\')) + $adaylar }
    }
} catch { }
# (Makine sürümü: yalnızca P:\CNC kullanılır; dizüstü simülasyon klasörleri aranmaz)
$MakineBilgisayari = $false
foreach ($k in $adaylar) {
    if ([System.IO.File]::Exists([System.IO.Path]::Combine($k, 'cncapi.dll'))) { $EdingKlasor = $k; $MakineBilgisayari = $true; break }
}
$IsKlasor = [System.IO.Path]::Combine($EdingKlasor, 'isler')
if (-not $MakineBilgisayari) {
    $IsKlasor = [System.IO.Path]::Combine($ScriptKlasor, 'isler')
    if ([System.IO.File]::Exists([System.IO.Path]::Combine($ScriptKlasor, 'macro.cnc'))) { $EdingKlasor = $ScriptKlasor }
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Tek kopya: panel ikinci kez açılmasın (başlangıç görevi + kısayol aynı anda çalışırsa)
$script:TekYeni = $false
$script:TekMutex = New-Object System.Threading.Mutex($true, 'Local\PrimerMillPanel', [ref]$script:TekYeni)
if (-not $script:TekYeni) {
    # Arkada açık (görünmeyen / donmuş) bir kopya varsa sessizce çıkmak yerine sor
    $eski = @()
    try { $eski = @(Get-WmiObject Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'KazimaBaslat\.ps1' -and $_.ProcessId -ne $PID }) } catch { }
    $sahte = New-Object System.Windows.Forms.Form
    $sahte.TopMost = $true; $sahte.ShowInTaskbar = $false; $sahte.StartPosition = 'CenterScreen'; $sahte.Size = New-Object System.Drawing.Size(1, 1); $sahte.Show(); $sahte.Activate()
    $c = [System.Windows.Forms.MessageBox]::Show($sahte, "PrimerMill zaten açık (arkada çalışıyor$(if ($eski.Count) { ", $($eski.Count) kopya" })).`r`n`r`nEskisi kapatılıp PrimerMill yeniden açılsın mı?", 'PrimerMill', 'YesNo', 'Question')
    $sahte.Close()
    if ($c -ne 'Yes') { exit }
    foreach ($p in $eski) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { } }
    try { $script:TekYeni = $script:TekMutex.WaitOne(8000) } catch [System.Threading.AbandonedMutexException] { $script:TekYeni = $true } catch { }
    if (-not $script:TekYeni) { [System.Windows.Forms.MessageBox]::Show('Eski PrimerMill kapatılamadı. Bilgisayarı yeniden başlatın.', 'PrimerMill') | Out-Null; exit }
}
$script:Yonetici = $false
try { $script:Yonetici = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } catch { }

# ---------------- Görsel bileşenler ve NC analizi (C#) ----------------
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;
using System.Windows.Forms;

public static class Kayit {
    static StreamWriter w;
    static readonly object kilit = new object();
    public static string Dosya = "";
    public static void Ac(string klasor) {
        try {
            Directory.CreateDirectory(klasor);
            Dosya = Path.Combine(klasor, "Panel_" + DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss") + ".log");
            w = new StreamWriter(Dosya, true, new System.Text.UTF8Encoding(true));
            w.AutoFlush = true;
        } catch { w = null; }
    }
    public static void Yaz(string metin) {
        lock (kilit) {
            if (w == null) return;
            try { w.WriteLine(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "  " + (metin ?? "").Replace("\r\n", " | ").Replace("\n", " | ")); } catch { }
        }
    }
    // GV-05: mesaj penceresi açıkken de yazılım ACİL STOP'una ulaşılsın (PowerShell tarafı Acil-Stop'u bağlar)
    public static Action AcilStop;
    // Açık Kayit.Show pencere sayısı (uzaktan komutlar pencere açıkken reddedilir, K3)
    static int acikPencere = 0;
    public static int AcikPencere { get { return acikPencere; } }
    static void AcilCagir(Form f) {
        Yaz("PENCERE: ACİL STOP (Esc / düğme)");
        Action a = AcilStop;
        if (a != null) { try { a(); } catch (Exception ex) { Yaz("PENCERE: ACİL STOP hatası: " + ex.Message); } }
        try { f.DialogResult = DialogResult.Cancel; } catch { }
    }
    // Mesaj kutusu: kendi penceremiz (her zaman en önde, ekran ortasında, dokunmatiğe uygun büyük tuşlar). Metin ve cevap kaydedilir.
    // Varsayılan (Enter) her zaman güvenli seçenektir: HAYIR / VAZGEÇ. Esc = ACİL STOP.
    public static DialogResult Show(string text, string caption, MessageBoxButtons b, MessageBoxIcon i) {
        Yaz("PENCERE [" + caption + "] " + text);
        DialogResult r = DialogResult.None;
        acikPencere++;
        try {
        using (Form f = new Form()) {
            f.Text = caption; f.FormBorderStyle = FormBorderStyle.FixedDialog; f.MaximizeBox = false; f.MinimizeBox = false;
            f.StartPosition = FormStartPosition.CenterScreen; f.TopMost = true; f.ShowInTaskbar = false;
            f.BackColor = Color.FromArgb(24, 26, 31); f.ForeColor = Color.FromArgb(229, 231, 235);
            f.Font = new Font("Segoe UI", 11f);
            Color vurgu = i == MessageBoxIcon.Error ? Color.FromArgb(248, 113, 113) : i == MessageBoxIcon.Warning ? Color.FromArgb(240, 200, 90) : Color.FromArgb(240, 220, 150);
            Label bas = new Label(); bas.Text = caption; bas.ForeColor = vurgu; bas.Font = new Font("Segoe UI Semibold", 14f); bas.AutoSize = false; bas.SetBounds(22, 14, 560, 30); f.Controls.Add(bas);
            Label l = new Label(); l.Text = text; l.AutoSize = false; l.SetBounds(22, 52, 560, 10);
            Size olc = TextRenderer.MeasureText(text, f.Font, new Size(560, 2000), TextFormatFlags.WordBreak);
            l.Height = Math.Min(460, olc.Height + 8); f.Controls.Add(l);
            List<KeyValuePair<string, DialogResult>> tus = new List<KeyValuePair<string, DialogResult>>();
            if (b == MessageBoxButtons.YesNo || b == MessageBoxButtons.YesNoCancel) { tus.Add(new KeyValuePair<string, DialogResult>("EVET", DialogResult.Yes)); tus.Add(new KeyValuePair<string, DialogResult>("HAYIR", DialogResult.No)); }
            else if (b == MessageBoxButtons.OKCancel) { tus.Add(new KeyValuePair<string, DialogResult>("TAMAM", DialogResult.OK)); }
            else tus.Add(new KeyValuePair<string, DialogResult>("TAMAM", DialogResult.OK));
            if (b == MessageBoxButtons.YesNoCancel || b == MessageBoxButtons.OKCancel) tus.Add(new KeyValuePair<string, DialogResult>("VAZGEÇ", DialogResult.Cancel));
            int y = l.Bottom + 18, w = 150, x = 582 - tus.Count * (w + 10) + 10;
            Button son = null;
            foreach (KeyValuePair<string, DialogResult> t in tus) {
                Button bt = new Button(); bt.Text = t.Key; bt.DialogResult = t.Value; bt.FlatStyle = FlatStyle.Flat;
                bt.BackColor = Color.FromArgb(34, 38, 45); bt.ForeColor = t.Value == DialogResult.Yes || t.Value == DialogResult.OK ? vurgu : Color.FromArgb(200, 204, 212);
                bt.FlatAppearance.BorderColor = bt.ForeColor; bt.Font = new Font("Segoe UI Semibold", 12f);
                bt.SetBounds(x, y, w, 52); f.Controls.Add(bt); x += w + 10;
                son = bt;
            }
            // Küçük kırmızı ACİL STOP (yalnız panel bağladıysa)
            if (AcilStop != null) {
                Button ac = new Button(); ac.Text = "ACİL STOP"; ac.FlatStyle = FlatStyle.Flat; ac.TabStop = false;
                ac.BackColor = Color.FromArgb(150, 20, 20); ac.ForeColor = Color.White; ac.FlatAppearance.BorderColor = Color.FromArgb(230, 60, 60);
                ac.Font = new Font("Segoe UI Semibold", 9f); ac.SetBounds(22, y, 84, 52);
                ac.Click += delegate { AcilCagir(f); };
                f.Controls.Add(ac);
            }
            f.ClientSize = new Size(604, y + 52 + 18);
            // Enter = son tuş (tek tuşta TAMAM, çok tuşta HAYIR / VAZGEÇ: güvenli taraf). CancelButton yok: Esc = ACİL STOP.
            f.AcceptButton = son;
            f.ActiveControl = son;
            f.KeyPreview = true;
            f.KeyDown += delegate(object s2, KeyEventArgs e2) { if (e2.KeyCode == Keys.Escape) { e2.Handled = true; e2.SuppressKeyPress = true; AcilCagir(f); } };
            f.Shown += delegate { f.Activate(); f.BringToFront(); if (son != null) son.Focus(); };
            r = f.ShowDialog();
            if (r == DialogResult.Cancel && tus.Count == 1) r = DialogResult.OK;
            if (r == DialogResult.Cancel && (b == MessageBoxButtons.YesNo)) r = DialogResult.No;
            if (r == DialogResult.None) r = (tus.Count == 1) ? DialogResult.OK : (b == MessageBoxButtons.YesNo ? DialogResult.No : DialogResult.Cancel);
        }
        } finally { acikPencere--; }
        Yaz("CEVAP   [" + caption + "] " + r.ToString());
        return r;
    }
    public static void Kapat() { lock (kilit) { try { if (w != null) { w.Flush(); w.Close(); } } catch { } w = null; } }
}

public class EggButton : Control {
    public Color TopColor = Color.FromArgb(30, 58, 138);
    public Color BottomColor = Color.FromArgb(11, 23, 57);
    public string Icon = "";
    bool hover, down;

    public EggButton() {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
        BackColor = Color.Transparent;
        Cursor = Cursors.Hand;
        ForeColor = Color.White;
    }

    static GraphicsPath Egg(RectangleF r) {
        float x = r.X, y = r.Y, w = r.Width, h = r.Height;
        GraphicsPath p = new GraphicsPath();
        p.AddBezier(x + w / 2, y, x + w * 0.80f, y, x + w, y + h * 0.30f, x + w, y + h * 0.60f);
        p.AddBezier(x + w, y + h * 0.60f, x + w, y + h * 0.86f, x + w * 0.78f, y + h, x + w / 2, y + h);
        p.AddBezier(x + w / 2, y + h, x + w * 0.22f, y + h, x, y + h * 0.86f, x, y + h * 0.60f);
        p.AddBezier(x, y + h * 0.60f, x, y + h * 0.30f, x + w * 0.20f, y, x + w / 2, y);
        p.CloseFigure();
        return p;
    }

    protected override void OnResize(EventArgs e) {
        base.OnResize(e);
        using (GraphicsPath p = Egg(new RectangleF(0, 0, Width, Height))) { Region = new Region(p); }
    }
    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; down = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) { down = true; Invalidate(); base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { down = false; Invalidate(); base.OnMouseUp(e); }
    protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }
    protected override void OnTextChanged(EventArgs e) { Invalidate(); base.OnTextChanged(e); }

    static Color Mix(Color a, Color b, float t) {
        return Color.FromArgb((int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t));
    }

    protected override void OnPaint(PaintEventArgs e) {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.Clear(Parent != null ? Parent.BackColor : Color.Black);

        Color top = TopColor, bot = BottomColor;
        if (!Enabled) { top = Color.FromArgb(55, 58, 64); bot = Color.FromArgb(28, 30, 34); }
        else if (down) { top = Mix(top, Color.Black, 0.25f); bot = Mix(bot, Color.Black, 0.25f); }
        else if (hover) { top = Mix(top, Color.White, 0.12f); bot = Mix(bot, Color.White, 0.06f); }

        RectangleF outer = new RectangleF(1.5f, 1.5f, Width - 3f, Height - 3f);
        RectangleF inner = new RectangleF(6f, 6f, Width - 12f, Height - 12f);

        // Altın kenar
        using (GraphicsPath po = Egg(outer))
        using (LinearGradientBrush gold = new LinearGradientBrush(outer, Color.FromArgb(247, 226, 150), Color.FromArgb(150, 110, 30), 70f)) {
            ColorBlend cb = new ColorBlend();
            cb.Colors = new Color[] { Color.FromArgb(250, 235, 170), Color.FromArgb(212, 175, 55), Color.FromArgb(140, 100, 25), Color.FromArgb(230, 200, 110) };
            cb.Positions = new float[] { 0f, 0.35f, 0.75f, 1f };
            gold.InterpolationColors = cb;
            g.FillPath(Enabled ? (Brush)gold : new SolidBrush(Color.FromArgb(90, 90, 90)), po);
        }
        // Gövde
        using (GraphicsPath pi = Egg(inner))
        using (LinearGradientBrush body = new LinearGradientBrush(inner, top, bot, 90f)) {
            g.FillPath(body, pi);
            // Parlama
            RectangleF shine = new RectangleF(inner.X + inner.Width * 0.18f, inner.Y + inner.Height * 0.05f, inner.Width * 0.64f, inner.Height * 0.38f);
            using (GraphicsPath ps = new GraphicsPath()) {
                ps.AddEllipse(shine);
                using (LinearGradientBrush sb = new LinearGradientBrush(shine, Color.FromArgb(Enabled ? 80 : 30, 255, 255, 255), Color.FromArgb(0, 255, 255, 255), 90f)) {
                    g.FillPath(sb, ps);
                }
            }
        }
        // Simge ve yazı
        Color tc = Enabled ? Color.White : Color.FromArgb(140, 140, 140);
        StringFormat sf = new StringFormat(); sf.Alignment = StringAlignment.Center; sf.LineAlignment = StringAlignment.Center;
        if (Icon.Length > 0) {
            using (Font fi = new Font("Segoe MDL2 Assets", Height * 0.15f, GraphicsUnit.Pixel))
            using (SolidBrush b = new SolidBrush(Enabled ? Color.FromArgb(245, 222, 140) : tc)) {
                g.DrawString(Icon, fi, b, new RectangleF(0, Height * 0.24f, Width, Height * 0.24f), sf);
            }
        }
        using (Font ft = new Font("Segoe UI Semibold", Height * 0.085f, GraphicsUnit.Pixel))
        using (SolidBrush b = new SolidBrush(tc)) {
            g.DrawString(Text, ft, b, new RectangleF(0, Height * 0.52f, Width, Height * 0.20f), sf);
        }
    }
}

public class LuxProgress : Control {
    double val;
    public string Caption = "";
    public int BarHeight = 34;
    public int Animal = -1;          // -1: hayvan yok
    public bool Dancing = false;
    readonly Timer anim = new Timer();
    readonly DateTime t0 = DateTime.Now;
    public double Value { get { return val; } set { val = Math.Max(0, Math.Min(100, value)); Invalidate(); } }
    public LuxProgress() {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        anim.Interval = 40;
        anim.Tick += delegate { if (Animal >= 0) Invalidate(); };
        anim.Start();
    }
    protected override void Dispose(bool disposing) { if (disposing) anim.Dispose(); base.Dispose(disposing); }
    protected override void OnPaint(PaintEventArgs e) {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.Clear(Parent != null ? Parent.BackColor : Color.Black);
        int Height = BarHeight;
        RectangleF track = new RectangleF(1, base.Height - BarHeight - 2, Width - 3, BarHeight - 1);
        if (Animal >= 0) {
            float ah = base.Height - BarHeight - 4;
            float aw = ah * 0.9f;
            float ax = track.X + (float)(track.Width * val / 100.0);
            ax = Math.Max(track.X + aw / 2, Math.Min(track.Right - aw / 2, ax));
            double zaman = (DateTime.Now - t0).TotalSeconds;
            Hayvanlar.Ciz(g, Animal, ax, track.Y + 3, ah, zaman, Dancing ? 1f : 0.15f);
            g.SmoothingMode = SmoothingMode.AntiAlias;
        }
        using (GraphicsPath pt = Pill(track))
        using (SolidBrush tb = new SolidBrush(Color.FromArgb(28, 31, 38)))
        using (Pen rim = new Pen(Color.FromArgb(120, 212, 175, 55), 1.5f)) {
            g.FillPath(tb, pt);
            float w = (float)(track.Width * val / 100.0);
            if (w > 2) {
                RectangleF fill = new RectangleF(track.X, track.Y, Math.Max(w, Height - 3), track.Height);
                g.SetClip(pt);
                using (GraphicsPath pf = Pill(fill))
                using (LinearGradientBrush gb = new LinearGradientBrush(fill, Color.FromArgb(250, 230, 160), Color.FromArgb(170, 125, 30), 90f)) {
                    g.FillPath(gb, pf);
                }
                g.ResetClip();
            }
            g.DrawPath(rim, pt);
        }
        if (val <= 0 && Caption.Length == 0) return;
        StringFormat sf = new StringFormat(); sf.Alignment = StringAlignment.Center; sf.LineAlignment = StringAlignment.Center;
        string t = "%" + val.ToString("0", CultureInfo.InvariantCulture) + (Caption.Length > 0 ? "   " + Caption : "");
        using (Font f = new Font("Segoe UI Semibold", Height * 0.42f, GraphicsUnit.Pixel)) {
            using (SolidBrush sh = new SolidBrush(Color.FromArgb(160, 0, 0, 0))) g.DrawString(t, f, sh, new RectangleF(track.X + 1, track.Y + 1, track.Width, track.Height), sf);
            using (SolidBrush fb = new SolidBrush(Color.White)) g.DrawString(t, f, fb, track, sf);
        }
    }
    static GraphicsPath Pill(RectangleF r) {
        GraphicsPath p = new GraphicsPath();
        float d = r.Height;
        p.AddArc(r.X, r.Y, d, d, 90, 180);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 180);
        p.CloseFigure();
        return p;
    }
}

public static class Hayvanlar {
    public static readonly string[] Adlar = { "Maymun", "Fil", "Civciv", "Penguen", "Kedi", "Kurbağa", "Ayı", "Domuz", "Tavşan", "Panda" };

    static void E(Graphics g, Color c, float x, float y, float w, float h) {
        using (SolidBrush b = new SolidBrush(c)) g.FillEllipse(b, x, y, w, h);
        using (Pen p = new Pen(Color.FromArgb(150, 0, 0, 0), 1.1f)) g.DrawEllipse(p, x, y, w, h);
    }
    static void EF(Graphics g, Color c, float x, float y, float w, float h) {
        using (SolidBrush b = new SolidBrush(c)) g.FillEllipse(b, x, y, w, h);
    }
    static void Limb(Graphics g, Color c, float x, float y, float ang, float len, float th) {
        GraphicsState st = g.Save();
        g.TranslateTransform(x, y); g.RotateTransform(ang);
        using (SolidBrush b = new SolidBrush(c)) g.FillEllipse(b, -th / 2, 0, th, len);
        using (Pen p = new Pen(Color.FromArgb(150, 0, 0, 0), 1.1f)) g.DrawEllipse(p, -th / 2, 0, th, len);
        g.Restore(st);
    }
    static void Eyes(Graphics g, float y, float dx, float r) {
        EF(g, Color.FromArgb(30, 30, 30), -dx - r, y - r, 2 * r, 2 * r);
        EF(g, Color.FromArgb(30, 30, 30), dx - r, y - r, 2 * r, 2 * r);
        EF(g, Color.White, -dx - r * 0.3f, y - r * 0.8f, r * 0.8f, r * 0.8f);
        EF(g, Color.White, dx - r * 0.3f, y - r * 0.8f, r * 0.8f, r * 0.8f);
    }
    static void Smile(Graphics g, float y, float w) {
        using (Pen p = new Pen(Color.FromArgb(40, 20, 10), 1.4f)) g.DrawArc(p, -w / 2, y - w / 2, w, w * 0.8f, 20, 140);
    }
    static void Tri(Graphics g, Color c, PointF a, PointF b, PointF d) {
        PointF[] pts = { a, b, d };
        using (SolidBrush br = new SolidBrush(c)) g.FillPolygon(br, pts);
        using (Pen p = new Pen(Color.FromArgb(150, 0, 0, 0), 1.1f)) g.DrawPolygon(p, pts);
    }

    // (cx, baseY): ayakların bastığı nokta. h: toplam yükseklik. t: saniye. amp: 1 = dans, 0.15 = bekleme
    public static void Ciz(Graphics g, int tur, float cx, float baseY, float h, double t, float amp) {
        tur = ((tur % Adlar.Length) + Adlar.Length) % Adlar.Length;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        float s = h / 82f;   // 58 birim gövde + zıplama/kulak/eğilme payı
        float beat = (float)Math.Sin(t * 7.0);
        float bounce = Math.Abs(beat) * 7f * amp;
        float tilt = (float)Math.Sin(t * 3.5) * 14f * amp;
        float arm = beat * 55f * amp;
        float legL = Math.Max(0, beat) * 5f * amp, legR = Math.Max(0, -beat) * 5f * amp;

        GraphicsState st = g.Save();
        g.TranslateTransform(cx, baseY);
        g.ScaleTransform(s, s);
        // gölge
        EF(g, Color.FromArgb(70, 0, 0, 0), -13 + bounce * 0.3f, -2, 26 - bounce * 0.6f, 5);
        g.TranslateTransform(0, -bounce);
        g.RotateTransform(tilt);

        Color body, belly, dark;
        switch (tur) {
            case 0: // Maymun
                body = Color.FromArgb(140, 90, 50); belly = Color.FromArgb(235, 200, 160);
                using (Pen tp = new Pen(body, 3.2f)) g.DrawBezier(tp, 10, -10, 26, -8, 26, -30, 18, -28);
                E(g, body, -7, -9 - legL, 6, 10); E(g, body, 1, -9 - legR, 6, 10);
                Limb(g, body, -11, -28, 40 + arm, 15, 5); Limb(g, body, 11, -28, -40 - arm, 15, 5);
                E(g, body, -12, -32, 24, 25); EF(g, belly, -7, -27, 14, 16);
                E(g, belly, -21, -50, 9, 9); E(g, belly, 12, -50, 9, 9);
                E(g, body, -14, -60, 28, 26); E(g, belly, -10, -52, 20, 16);
                Eyes(g, -48, 4.5f, 2); Smile(g, -41, 8);
                break;
            case 1: // Fil
                body = Color.FromArgb(150, 160, 175); dark = Color.FromArgb(120, 130, 145);
                E(g, body, -10, -11 - legL, 8, 12); E(g, body, 2, -11 - legR, 8, 12);
                E(g, body, -14, -34, 28, 27);
                Limb(g, body, -12, -28, 35 + arm, 13, 6); Limb(g, body, 12, -28, -35 - arm, 13, 6);
                E(g, dark, -27, -60, 17, 22); E(g, dark, 10, -60, 17, 22);
                E(g, body, -13, -62, 26, 26);
                using (Pen tr = new Pen(body, 5f)) { tr.StartCap = LineCap.Round; tr.EndCap = LineCap.Round;
                    g.DrawBezier(tr, 0, -44, 0, -34, 4 + beat * 8 * amp, -30, 9 + beat * 10 * amp, -36); }
                Eyes(g, -52, 5, 1.8f);
                break;
            case 2: // Civciv
                body = Color.FromArgb(255, 214, 40);
                using (Pen f = new Pen(Color.FromArgb(240, 130, 20), 2f)) { g.DrawLine(f, -4, -6 - legL, -6, 0 - legL); g.DrawLine(f, 4, -6 - legR, 6, 0 - legR); }
                E(g, body, -16, -40, 32, 34);
                Limb(g, Color.FromArgb(245, 190, 20), -14, -26, 60 + arm, 11, 6); Limb(g, Color.FromArgb(245, 190, 20), 14, -26, -60 - arm, 11, 6);
                using (Pen tuft = new Pen(Color.FromArgb(230, 180, 20), 1.6f)) { g.DrawArc(tuft, -2, -46, 6, 8, 180, 180); g.DrawArc(tuft, -5, -45, 6, 8, 180, 180); }
                Eyes(g, -28, 5.5f, 2.2f);
                Tri(g, Color.FromArgb(245, 130, 20), new PointF(-3.5f, -23), new PointF(3.5f, -23), new PointF(0, -18));
                EF(g, Color.FromArgb(120, 255, 120, 120), -13, -24, 5, 3); EF(g, Color.FromArgb(120, 255, 120, 120), 8, -24, 5, 3);
                break;
            case 3: // Penguen
                body = Color.FromArgb(35, 40, 50);
                E(g, Color.FromArgb(245, 140, 30), -9, -4 - legL, 8, 4); E(g, Color.FromArgb(245, 140, 30), 1, -4 - legR, 8, 4);
                Limb(g, body, -13, -34, 30 + arm, 18, 6); Limb(g, body, 13, -34, -30 - arm, 18, 6);
                E(g, body, -14, -56, 28, 54); EF(g, Color.White, -9, -44, 18, 40); EF(g, Color.White, -10, -52, 9, 10); EF(g, Color.White, 1, -52, 9, 10);
                Eyes(g, -47, 4, 1.8f);
                Tri(g, Color.FromArgb(245, 140, 30), new PointF(-3, -43), new PointF(3, -43), new PointF(0, -38));
                break;
            case 4: // Kedi
                body = Color.FromArgb(240, 150, 60); belly = Color.FromArgb(255, 225, 190);
                using (Pen tp = new Pen(body, 3.5f)) { tp.EndCap = LineCap.Round; g.DrawBezier(tp, 10, -10, 24, -12, 18 + beat * 6 * amp, -34, 26, -38); }
                E(g, body, -8, -9 - legL, 6, 10); E(g, body, 2, -9 - legR, 6, 10);
                Limb(g, body, -10, -27, 40 + arm, 14, 5); Limb(g, body, 10, -27, -40 - arm, 14, 5);
                E(g, body, -11, -31, 22, 24); EF(g, belly, -6, -26, 12, 15);
                Tri(g, body, new PointF(-13, -50), new PointF(-4, -58), new PointF(-12, -64));
                Tri(g, body, new PointF(13, -50), new PointF(4, -58), new PointF(12, -64));
                E(g, body, -14, -58, 28, 25);
                Eyes(g, -47, 5, 2);
                Tri(g, Color.FromArgb(240, 110, 130), new PointF(-1.5f, -43), new PointF(1.5f, -43), new PointF(0, -41));
                using (Pen w = new Pen(Color.FromArgb(90, 60, 40), 0.8f)) { g.DrawLine(w, -5, -41, -15, -43); g.DrawLine(w, -5, -40, -15, -39); g.DrawLine(w, 5, -41, 15, -43); g.DrawLine(w, 5, -40, 15, -39); }
                break;
            case 5: // Kurbağa
                body = Color.FromArgb(80, 190, 90); belly = Color.FromArgb(200, 240, 170);
                E(g, body, -16, -8 - legL, 12, 8); E(g, body, 4, -8 - legR, 12, 8);
                Limb(g, body, -13, -24, 50 + arm, 13, 5); Limb(g, body, 13, -24, -50 - arm, 13, 5);
                E(g, body, -16, -34, 32, 28); EF(g, belly, -10, -26, 20, 18);
                E(g, body, -14, -44, 12, 12); E(g, body, 2, -44, 12, 12);
                E(g, Color.White, -12, -42, 8, 8); E(g, Color.White, 4, -42, 8, 8);
                EF(g, Color.Black, -10, -40, 4, 4); EF(g, Color.Black, 6, -40, 4, 4);
                using (Pen m = new Pen(Color.FromArgb(30, 90, 30), 1.4f)) g.DrawArc(m, -9, -36, 18, 8, 10, 160);
                break;
            case 6: // Ayı
                body = Color.FromArgb(150, 100, 60); belly = Color.FromArgb(215, 175, 130);
                E(g, body, -10, -11 - legL, 8, 12); E(g, body, 2, -11 - legR, 8, 12);
                Limb(g, body, -13, -30, 35 + arm, 15, 7); Limb(g, body, 13, -30, -35 - arm, 15, 7);
                E(g, body, -14, -35, 28, 28); EF(g, belly, -8, -29, 16, 18);
                E(g, body, -15, -64, 10, 10); E(g, body, 5, -64, 10, 10);
                E(g, body, -14, -62, 28, 27); E(g, belly, -7, -50, 14, 11);
                EF(g, Color.FromArgb(40, 25, 15), -3, -49, 6, 4);
                Eyes(g, -53, 5, 2);
                break;
            case 7: // Domuz
                body = Color.FromArgb(250, 170, 190); dark = Color.FromArgb(235, 130, 160);
                using (Pen tp = new Pen(dark, 2f)) g.DrawArc(tp, 11, -24, 8, 8, 0, 300);
                E(g, body, -9, -9 - legL, 7, 10); E(g, body, 2, -9 - legR, 7, 10);
                Limb(g, body, -12, -27, 40 + arm, 13, 6); Limb(g, body, 12, -27, -40 - arm, 13, 6);
                E(g, body, -14, -33, 28, 26);
                Tri(g, dark, new PointF(-13, -54), new PointF(-5, -58), new PointF(-14, -63));
                Tri(g, dark, new PointF(13, -54), new PointF(5, -58), new PointF(14, -63));
                E(g, body, -14, -60, 28, 26);
                E(g, dark, -6, -47, 12, 8); EF(g, Color.FromArgb(160, 70, 90), -3, -45, 2.5f, 3.5f); EF(g, Color.FromArgb(160, 70, 90), 1, -45, 2.5f, 3.5f);
                Eyes(g, -52, 6, 1.8f);
                break;
            case 8: // Tavşan
                body = Color.FromArgb(240, 240, 245); belly = Color.FromArgb(250, 200, 215);
                E(g, body, -9, -8 - legL, 8, 8); E(g, body, 1, -8 - legR, 8, 8);
                Limb(g, body, -11, -26, 40 + arm, 13, 5); Limb(g, body, 11, -26, -40 - arm, 13, 5);
                E(g, body, -12, -31, 24, 25);
                Limb(g, body, -5, -56, 180 - 12 + beat * 14 * amp, 22, 7); Limb(g, body, 5, -56, 180 + 12 - beat * 14 * amp, 22, 7);
                E(g, body, -12, -58, 24, 23);
                EF(g, belly, -2, -46, 4, 3);
                Eyes(g, -50, 4.5f, 1.8f);
                EF(g, Color.FromArgb(110, 255, 120, 150), -11, -46, 5, 3); EF(g, Color.FromArgb(110, 255, 120, 150), 6, -46, 5, 3);
                break;
            default: // Panda
                body = Color.White; dark = Color.FromArgb(30, 30, 35);
                E(g, dark, -10, -11 - legL, 8, 12); E(g, dark, 2, -11 - legR, 8, 12);
                Limb(g, dark, -13, -30, 35 + arm, 15, 7); Limb(g, dark, 13, -30, -35 - arm, 15, 7);
                E(g, body, -14, -35, 28, 28);
                E(g, dark, -15, -64, 10, 10); E(g, dark, 5, -64, 10, 10);
                E(g, body, -14, -62, 28, 27);
                EF(g, dark, -10, -55, 8, 9); EF(g, dark, 2, -55, 8, 9);
                EF(g, Color.White, -7, -52, 3, 3); EF(g, Color.White, 5, -52, 3, 3);
                EF(g, dark, -2.5f, -46, 5, 3.5f);
                Smile(g, -42, 6);
                break;
        }
        g.Restore(st);
    }
}

public class PartFace {
    public bool Ok;
    public int W, H;
    public float X0, Y0, Res, ZLo, ZHi;
    public float[] Hgt;     // yüzey yüksekliği (frezenin ulaştığı en derin nokta)
    public int[] Last;      // bu noktaya son dokunan satır
    public int[] ColFull, ColDim, ColDone, ColHot;   // önizleme, kazınacak, kazındı, yeni kazındı
}

public static class PartModel {
    // Parça yüzeyini frezeleme yollarından oluştur (top uçlu freze varsayımı)
    public static PartFace[] Build(NcAnaliz d, float res, float toolR) {
        PartFace[] faces = new PartFace[2];
        for (int f = 0; f < 2; f++) {
            PartFace p = new PartFace(); faces[f] = p;
            if (!d.BoundsOk[f]) continue;
            RectangleF b = d.Bounds[f];
            p.Res = res; p.X0 = b.X - toolR - res; p.Y0 = b.Y - toolR - res;
            p.W = (int)Math.Ceiling((b.Width + 2 * toolR) / res) + 3;
            p.H = (int)Math.Ceiling((b.Height + 2 * toolR) / res) + 3;
            p.Hgt = new float[p.W * p.H]; p.Last = new int[p.W * p.H];
            for (int i = 0; i < p.Hgt.Length; i++) { p.Hgt[i] = float.MaxValue; p.Last[i] = int.MaxValue; }
            p.Ok = true;
        }
        int rc = (int)Math.Ceiling(toolR / res);
        float[] prof = new float[(2 * rc + 1) * (2 * rc + 1)];
        for (int dy = -rc; dy <= rc; dy++) for (int dx = -rc; dx <= rc; dx++) {
            float dd = (float)Math.Sqrt(dx * dx + dy * dy) * res;
            prof[(dy + rc) * (2 * rc + 1) + dx + rc] = dd <= toolR ? toolR - (float)Math.Sqrt(toolR * toolR - dd * dd) : float.NaN;
        }
        for (int i = 1; i < d.PF.Length; i++) {
            int f = d.PF[i];
            if (f > 1 || !faces[f].Ok) continue;
            PartFace p = faces[f];
            float ax = d.PX[i - 1], ay = d.PY[i - 1], az = d.PZ[i - 1];
            float bx = d.PX[i], by = d.PY[i], bz = d.PZ[i];
            float len = (float)Math.Sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
            int n = Math.Max(1, (int)Math.Ceiling(len / res));
            for (int k = 0; k <= n; k++) {
                float t = (float)k / n;
                float x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
                int cx = (int)Math.Round((x - p.X0) / res), cy = (int)Math.Round((y - p.Y0) / res);
                for (int dy = -rc; dy <= rc; dy++) {
                    int yy = cy + dy; if (yy < 0 || yy >= p.H) continue;
                    int row = yy * p.W, prow = (dy + rc) * (2 * rc + 1) + rc;
                    for (int dx = -rc; dx <= rc; dx++) {
                        int xx = cx + dx; if (xx < 0 || xx >= p.W) continue;
                        float pr = prof[prow + dx]; if (float.IsNaN(pr)) continue;
                        int c = row + xx;
                        float hz = z + pr;
                        if (hz < p.Hgt[c]) p.Hgt[c] = hz;
                        p.Last[c] = i;
                    }
                }
            }
        }
        for (int f = 0; f < 2; f++) if (faces[f].Ok) Shade(faces[f]);
        return faces;
    }

    static int Argb(float r, float g, float b) {
        return (255 << 24) | ((int)Math.Max(0, Math.Min(255, r)) << 16) | ((int)Math.Max(0, Math.Min(255, g)) << 8) | (int)Math.Max(0, Math.Min(255, b));
    }

    static void Shade(PartFace p) {
        // yükseklik aralığı: dokunulan hücrelerin %2-%99'u
        List<float> zs = new List<float>();
        for (int i = 0; i < p.Hgt.Length; i += 7) if (p.Hgt[i] != float.MaxValue) zs.Add(p.Hgt[i]);
        zs.Sort();
        if (zs.Count == 0) { p.Ok = false; return; }
        p.ZLo = zs[(int)(zs.Count * 0.02)]; p.ZHi = zs[(int)(zs.Count * 0.995) - 1];
        float span = Math.Max(0.5f, p.ZHi - p.ZLo);
        p.ColFull = new int[p.Hgt.Length]; p.ColDim = new int[p.Hgt.Length];
        p.ColDone = new int[p.Hgt.Length]; p.ColHot = new int[p.Hgt.Length];
        // ışık yönü: sol üstten
        float lx = -0.45f, ly = 0.55f, lz = 0.70f;
        float ln = (float)Math.Sqrt(lx * lx + ly * ly + lz * lz); lx /= ln; ly /= ln; lz /= ln;
        for (int y = 0; y < p.H; y++) for (int x = 0; x < p.W; x++) {
            int c = y * p.W + x;
            float h = p.Hgt[c];
            if (h == float.MaxValue) { p.ColFull[c] = 0; p.ColDim[c] = 0; p.ColDone[c] = 0; p.ColHot[c] = 0; continue; }
            float hl = H(p, x - 1, y, h), hr = H(p, x + 1, y, h), hd = H(p, x, y - 1, h), hu = H(p, x, y + 1, h);
            float nx = -(hr - hl) / (2 * p.Res), ny = -(hu - hd) / (2 * p.Res), nz = 1f;
            float nn = (float)Math.Sqrt(nx * nx + ny * ny + nz * nz); nx /= nn; ny /= nn; nz /= nn;
            float dif = Math.Max(0, nx * lx + ny * ly + nz * lz);
            float spec = (float)Math.Pow(Math.Max(0, 2 * dif * nz - lz), 24) * 0.35f;
            float tH = Math.Max(0, Math.Min(1, (h - p.ZLo) / span));
            tH = tH * tH * (3 - 2 * tH);
            // zirkonya fildişi rengi; derin bölgeler koyu
            float br = 0.18f + 0.82f * tH;
            float light = 0.30f + 0.75f * dif;
            float r = 245 * light * br + 255 * spec, g = 238 * light * br + 255 * spec, bl = 222 * light * br + 255 * spec;
            float mix = 0.55f + 0.45f * tH;
            r = r * mix + 20 * (1 - mix); g = g * mix + 23 * (1 - mix); bl = bl * mix + 30 * (1 - mix);
            p.ColFull[c] = Argb(r, g, bl);
            float lum = (r * 0.3f + g * 0.59f + bl * 0.11f);
            // Kazınacak: soğuk koyu mavi-gri
            p.ColDim[c] = Argb(lum * 0.30f + 8, lum * 0.36f + 12, lum * 0.48f + 22);
            // Kazındı: sıcak altın
            p.ColDone[c] = Argb(lum * 1.02f + 18, lum * 0.80f + 8, lum * 0.36f);
            // Yeni kazındı: parlak sarı-beyaz
            p.ColHot[c] = Argb(lum * 0.9f + 70, lum * 0.9f + 60, lum * 0.55f + 25);
        }
    }
    static float H(PartFace p, int x, int y, float def) {
        if (x < 0 || y < 0 || x >= p.W || y >= p.H) return def;
        float v = p.Hgt[y * p.W + x];
        return v == float.MaxValue ? def : v;
    }
}

public class SimRenderer {
    public NcAnaliz Data;
    public System.Action Changed;
    public int CurrentLine = 0;
    PartFace[] faces;
    Bitmap[] bmp = new Bitmap[2];
    int composedFor = -2, lastFace = 0, gen = 0;
    volatile bool building = false;
    readonly object kilit = new object();
    Size size;
    static readonly Color Bg = Color.FromArgb(14, 16, 20), PanelBg = Color.FromArgb(20, 23, 29);
    static readonly string[] Etiket = { "Üst yüz", "Alt yüz" };

    public void SetData(NcAnaliz d) {
        lock (kilit) {
            Data = d; faces = null; gen++; composedFor = -2;
            for (int f = 0; f < 2; f++) if (bmp[f] != null) { bmp[f].Dispose(); bmp[f] = null; }
        }
        if (d == null || d.PF == null) return;
        int myGen = gen;
        building = true;
        System.Threading.ThreadPool.QueueUserWorkItem(delegate {
            try {
                PartFace[] pf = PartModel.Build(d, 0.12f, 0.5f);
                lock (kilit) { if (myGen == gen) { faces = pf; composedFor = -2; } }
            } catch { }
            finally { building = false; }
            Compose();
            if (Changed != null) Changed();
        });
    }

    public void Rebuild(Size s) { size = s; }

    // Kazınan yerler parlak, henüz kazınmayan yerler soluk
    public bool Advance() {
        if (Data == null || Data.PF == null) return false;
        int target = Math.Max(0, Math.Min(Data.PF.Length - 1, CurrentLine - 1));
        for (int i = target; i >= Math.Max(0, target - 5000); i--) if (Data.PF[i] <= 1) { lastFace = Data.PF[i]; break; }
        return Compose();
    }

    bool Compose() {
        lock (kilit) {
            if (faces == null) return false;
            int cur = CurrentLine <= 0 ? -1 : CurrentLine - 1;
            if (cur == composedFor) return false;
            int hot = Math.Max(2000, Data.PF.Length / 80);   // son ~%1.25 parlak
            for (int f = 0; f < 2; f++) {
                PartFace p = faces[f];
                if (p == null || !p.Ok) continue;
                if (bmp[f] == null) bmp[f] = new Bitmap(p.W, p.H, PixelFormat.Format32bppArgb);
                BitmapData bd = bmp[f].LockBits(new Rectangle(0, 0, p.W, p.H), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                int[] row = new int[p.W];
                for (int y = 0; y < p.H; y++) {
                    int src = y * p.W;
                    for (int x = 0; x < p.W; x++) {
                        int c = src + x;
                        int L = p.Last[c];
                        row[x] = cur < 0 ? p.ColFull[c]
                               : L > cur ? p.ColDim[c]
                               : (cur - L < hot ? p.ColHot[c] : p.ColDone[c]);
                    }
                    System.Runtime.InteropServices.Marshal.Copy(row, 0, new IntPtr(bd.Scan0.ToInt64() + (long)(p.H - 1 - y) * bd.Stride), p.W);
                }
                bmp[f].UnlockBits(bd);
            }
            composedFor = cur;
            return true;
        }
    }

    RectangleF[] Panels(out bool[] used) {
        used = new bool[2];
        RectangleF[] r = new RectangleF[2];
        if (faces == null) return r;
        used[0] = faces[0] != null && faces[0].Ok; used[1] = faces[1] != null && faces[1].Ok;
        int n = (used[0] ? 1 : 0) + (used[1] ? 1 : 0);
        if (n == 0) return r;
        float gap = 10, pw = n == 2 ? (size.Width - gap) / 2f : size.Width;
        int k = 0;
        for (int f = 0; f < 2; f++) if (used[f]) { r[f] = new RectangleF(k * (pw + gap), 0, pw, size.Height); k++; }
        return r;
    }

    public void Render(Graphics g, double t) {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.Clear(Bg);
        StringFormat sfc = new StringFormat(); sfc.Alignment = StringAlignment.Center; sfc.LineAlignment = StringAlignment.Center;
        lock (kilit) {
            if (Data == null || faces == null) {
                string msg = building ? "Parça hazırlanıyor..." : "Simülasyon için bir dosya seçin";
                using (Font f0 = new Font("Segoe UI Light", 11f))
                using (SolidBrush b0 = new SolidBrush(Color.FromArgb(110, 118, 130)))
                    g.DrawString(msg, f0, b0, new RectangleF(0, 0, size.Width, size.Height), sfc);
                return;
            }
            bool[] used;
            RectangleF[] pr = Panels(out used);
            for (int f = 0; f < 2; f++) {
                if (!used[f] || bmp[f] == null) continue;
                PartFace p = faces[f];
                RectangleF r = pr[f];
                bool aktif = CurrentLine > 0 && lastFace == f;
                using (GraphicsPath gp = Round(r, 12))
                using (LinearGradientBrush pb = new LinearGradientBrush(r, Color.FromArgb(26, 30, 38), Color.FromArgb(14, 16, 20), 90f))
                using (Pen rim = new Pen(aktif ? Color.FromArgb(150, 212, 175, 55) : Color.FromArgb(35, 255, 255, 255), 1f)) {
                    g.FillPath(pb, gp); g.DrawPath(rim, gp);
                }
                float iw = r.Width - 16, ih = r.Height - 30;
                float sc = Math.Min(iw / p.W, ih / p.H);
                float dw = p.W * sc, dh = p.H * sc;
                float dx = r.X + 8 + (iw - dw) / 2, dy = r.Y + 22 + (ih - dh) / 2;
                InterpolationMode im = g.InterpolationMode;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.DrawImage(bmp[f], dx, dy, dw, dh);
                g.InterpolationMode = im;
                using (Font lf = new Font("Segoe UI", 8.5f))
                using (SolidBrush lb = new SolidBrush(aktif ? Color.FromArgb(240, 220, 150) : Color.FromArgb(120, 128, 140)))
                    g.DrawString(Etiket[f], lf, lb, r.X + 10, r.Y + 5);

                // Frezenin anlık yeri
                if (aktif) {
                    int i = Math.Max(0, Math.Min(Data.PF.Length - 1, CurrentLine - 1));
                    while (i > 0 && Data.PF[i] != f) i--;
                    float mx = dx + (Data.PX[i] - p.X0) / p.Res * sc;
                    float my = dy + dh - (Data.PY[i] - p.Y0) / p.Res * sc;
                    float pulse = (float)(0.5 + 0.5 * Math.Sin(t * 6));
                    float rr = 4 + pulse * 6;
                    using (SolidBrush glow = new SolidBrush(Color.FromArgb((int)(90 * (1 - pulse)) + 30, 250, 215, 110)))
                        g.FillEllipse(glow, mx - rr, my - rr, rr * 2, rr * 2);
                    using (SolidBrush core = new SolidBrush(Color.FromArgb(255, 245, 210)))
                        g.FillEllipse(core, mx - 2.5f, my - 2.5f, 5, 5);
                }
            }
        }
    }

    static GraphicsPath Round(RectangleF r, float d) {
        GraphicsPath p = new GraphicsPath();
        p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d - 1, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d - 1, r.Bottom - d - 1, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d - 1, d, d, 90, 90);
        p.CloseFigure(); return p;
    }
}

public class SimView : Control {
    public readonly SimRenderer R = new SimRenderer();
    readonly Timer anim = new Timer();
    readonly DateTime t0 = DateTime.Now;
    public SimView() {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        anim.Interval = 50;
        anim.Tick += delegate { if (R.CurrentLine > 0) Invalidate(); };
        anim.Start();
        R.Changed = delegate { try { if (IsHandleCreated) BeginInvoke(new MethodInvoker(Invalidate)); } catch { } };
        Cursor = Cursors.Hand;
    }
    public void SetData(NcAnaliz d) { R.CurrentLine = 0; R.Rebuild(ClientSize); R.SetData(d); Invalidate(); }
    public void SetLine(int line) { R.CurrentLine = line; if (R.Advance()) Invalidate(); }
    protected override void OnResize(EventArgs e) { base.OnResize(e); R.Rebuild(ClientSize); Invalidate(); }
    protected override void OnPaint(PaintEventArgs e) { R.Render(e.Graphics, (DateTime.Now - t0).TotalSeconds); }
    protected override void Dispose(bool disposing) { if (disposing) anim.Dispose(); base.Dispose(disposing); }
}

public class EngravedTitle : Control {
    public float Skew = 0.18f;          // yatıklık
    public bool Grooves = true;         // freze izleri
    public bool Chrome = false;         // bombeli ayna krom
    public string FontName = "Segoe UI Black";
    public FontStyle Style = FontStyle.Bold;
    public float SizeRatio = 0.78f;
    public EngravedTitle() {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
    }
    protected override void OnTextChanged(EventArgs e) { Invalidate(); base.OnTextChanged(e); }
    protected override void OnPaint(PaintEventArgs e) {
        if (Chrome) RenderChrome(e.Graphics, ClientRectangle, Text, Parent != null ? Parent.BackColor : Color.Black, FontName, Style, SizeRatio, Skew);
        else Render(e.Graphics, ClientRectangle, Text, Parent != null ? Parent.BackColor : Color.Black, FontName, Style, SizeRatio, Skew, Grooves);
    }
    // Bombeli ayna krom: desen yok, pürüzsüz yansıma
    public static void RenderChrome(Graphics g, Rectangle r, string text, Color bg, string fontName, FontStyle style, float sizeRatio, float skew) {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(bg);
        FontFamily ff;
        try { ff = new FontFamily(fontName); } catch { ff = FontFamily.GenericSansSerif; }
        GraphicsPath tp = new GraphicsPath();
        tp.AddString(text, ff, (int)style, r.Height * sizeRatio, new PointF(0, 0), StringFormat.GenericTypographic);
        if (skew != 0) using (Matrix sk = new Matrix(1f, 0f, -skew, 1f, 0f, 0f)) tp.Transform(sk);
        RectangleF b = tp.GetBounds();
        using (Matrix mv = new Matrix()) { mv.Translate(r.X + (r.Width - b.Width) / 2f - b.X, r.Y + (r.Height - b.Height) / 2f - b.Y - 2); tp.Transform(mv); }
        b = tp.GetBounds();

        // 1) Yumuşak gölge
        for (int k = 6; k >= 1; k--) {
            using (GraphicsPath sh = (GraphicsPath)tp.Clone())
            using (Matrix m = new Matrix())
            using (Pen sp = new Pen(Color.FromArgb(14, 0, 0, 0), k * 1.6f)) {
                m.Translate(0, 3.5f); sh.Transform(m);
                sp.LineJoin = LineJoin.Round;
                g.DrawPath(sp, sh);
            }
        }
        // 2) Krom gövde: gökyüzü / ufuk / zemin yansıması
        using (LinearGradientBrush ch = new LinearGradientBrush(new RectangleF(b.X, b.Y - 1, b.Width, b.Height + 2), Color.White, Color.Black, 90f)) {
            ColorBlend cb = new ColorBlend();
            cb.Colors = new Color[] {
                Color.FromArgb(255, 255, 255), Color.FromArgb(232, 238, 246), Color.FromArgb(178, 186, 198),
                Color.FromArgb(62, 68, 80), Color.FromArgb(96, 104, 118), Color.FromArgb(170, 178, 190), Color.FromArgb(246, 248, 252) };
            cb.Positions = new float[] { 0f, 0.22f, 0.49f, 0.51f, 0.66f, 0.86f, 1f };
            ch.InterpolationColors = cb;
            g.FillPath(ch, tp);
        }
        Region old = g.Clip;
        g.SetClip(tp, CombineMode.Intersect);
        // 3) Bombe: üst yarıda kubbe şeklinde parlama
        RectangleF dome = new RectangleF(b.X - b.Width * 0.1f, b.Y - b.Height * 0.55f, b.Width * 1.2f, b.Height * 1.05f);
        using (GraphicsPath dp = new GraphicsPath()) {
            dp.AddEllipse(dome);
            using (LinearGradientBrush db = new LinearGradientBrush(new RectangleF(dome.X, b.Y, dome.Width, b.Height * 0.5f), Color.FromArgb(150, 255, 255, 255), Color.FromArgb(0, 255, 255, 255), 90f))
                g.FillPath(db, dp);
        }
        // 4) Kabartma: iç üst kenar ışık, iç alt kenar gölge
        using (GraphicsPath lo = (GraphicsPath)tp.Clone())
        using (Matrix m = new Matrix())
        using (Pen lp = new Pen(Color.FromArgb(150, 20, 24, 32), 2.4f)) { m.Translate(0, -1.6f); lo.Transform(m); g.DrawPath(lp, lo); }
        using (GraphicsPath hi = (GraphicsPath)tp.Clone())
        using (Matrix m = new Matrix())
        using (Pen hp = new Pen(Color.FromArgb(200, 255, 255, 255), 1.6f)) { m.Translate(0, 1.4f); hi.Transform(m); g.DrawPath(hp, hi); }
        g.Clip = old;
        // 5) İnce dış hat
        using (Pen edge = new Pen(Color.FromArgb(170, 70, 76, 88), 1f)) g.DrawPath(edge, tp);
        tp.Dispose();
    }

    public static void Render(Graphics g, Rectangle r, string text, Color bg) {
        Render(g, r, text, bg, "Segoe UI Black", FontStyle.Bold, 0.78f, 0.18f, true);
    }
    public static void Render(Graphics g, Rectangle r, string text, Color bg, string fontName, FontStyle style, float sizeRatio, float skew, bool grooves) {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(bg);
        FontFamily ff;
        try { ff = new FontFamily(fontName); } catch { ff = FontFamily.GenericSansSerif; }
        float em = r.Height * sizeRatio;
        GraphicsPath tp = new GraphicsPath();
        tp.AddString(text, ff, (int)style, em, new PointF(0, 0), StringFormat.GenericTypographic);
        if (skew != 0) using (Matrix sk = new Matrix(1f, 0f, -skew, 1f, 0f, 0f)) tp.Transform(sk);
        RectangleF b = tp.GetBounds();
        using (Matrix mv = new Matrix()) {
            mv.Translate(r.X + (r.Width - b.Width) / 2f - b.X, r.Y + (r.Height - b.Height) / 2f - b.Y);
            tp.Transform(mv);
        }
        b = tp.GetBounds();

        // 1) Oyuk gölgesi (metale gömülü görünüm)
        using (GraphicsPath sh = (GraphicsPath)tp.Clone())
        using (Matrix m = new Matrix()) {
            m.Translate(2.5f, 3f); sh.Transform(m);
            using (SolidBrush sb = new SolidBrush(Color.FromArgb(170, 0, 0, 0))) g.FillPath(sb, sh);
        }
        // 2) Altın dolgu
        using (LinearGradientBrush gold = new LinearGradientBrush(b, Color.White, Color.Black, 90f)) {
            ColorBlend cb = new ColorBlend();
            cb.Colors = new Color[] { Color.FromArgb(125, 130, 140), Color.FromArgb(255, 255, 255), Color.FromArgb(205, 210, 218), Color.FromArgb(120, 126, 136), Color.FromArgb(175, 180, 190), Color.FromArgb(245, 247, 250) };
            cb.Positions = new float[] { 0f, 0.3f, 0.5f, 0.68f, 0.85f, 1f };
            gold.InterpolationColors = cb;
            g.FillPath(gold, tp);
        }
        // 3) Freze izleri: harflerin içinde ince paralel yollar
        Region old = g.Clip;
        g.SetClip(tp, CombineMode.Intersect);
        using (Pen groove = new Pen(Color.FromArgb(60, 40, 45, 55), 1f))
        using (Pen shine = new Pen(Color.FromArgb(55, 255, 255, 255), 1f)) {
            for (float x = b.Left - b.Height; grooves && x < b.Right + b.Height; x += 3.2f) {
                g.DrawLine(groove, x, b.Bottom, x + b.Height * 0.55f, b.Top);
                g.DrawLine(shine, x + 1.2f, b.Bottom, x + 1.2f + b.Height * 0.55f, b.Top);
            }
        }
        // 4) İç gölge: üst kenar karanlık (oyuk derinliği)
        using (GraphicsPath inner = (GraphicsPath)tp.Clone())
        using (Matrix m = new Matrix())
        using (Pen ip = new Pen(Color.FromArgb(grooves ? 110 : 60, 30, 34, 42), grooves ? 2.2f : 1.2f)) {
            m.Translate(1.2f, 1.6f); inner.Transform(m);
            g.DrawPath(ip, inner);
        }
        g.Clip = old;
        // 5) Kesik kenar ışığı ve dış hat
        using (Pen edge = new Pen(Color.FromArgb(grooves ? 210 : 120, 255, 255, 255), 1f)) g.DrawPath(edge, tp);
        using (GraphicsPath o = (GraphicsPath)tp.Clone())
        using (Matrix m = new Matrix())
        using (Pen dp = new Pen(Color.FromArgb(grooves ? 140 : 70, 40, 44, 54), 1f)) {
            m.Translate(0.8f, 1f); o.Transform(m);
            g.DrawPath(dp, o);
        }
        tp.Dispose();
    }
}

public class EStopButton : Control {
    bool latched, blink, pressed;
    public bool Latched { get { return latched; } set { latched = value; Invalidate(); } }
    public bool Blink { get { return blink; } set { if (blink != value) { blink = value; Invalidate(); } } }
    public EStopButton() {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        Cursor = Cursors.Hand;
    }
    protected override void OnMouseDown(MouseEventArgs e) { pressed = true; Invalidate(); base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { pressed = false; Invalidate(); base.OnMouseUp(e); }
    protected override void OnPaint(PaintEventArgs e) {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
        g.Clear(Parent != null ? Parent.BackColor : Color.Black);
        float s = Math.Min(Width, Height) - 2;
        RectangleF o = new RectangleF((Width - s) / 2f, 1, s, s);
        // Sarı taban halkası
        using (LinearGradientBrush y = new LinearGradientBrush(o, Color.FromArgb(255, 222, 60), Color.FromArgb(200, 150, 0), 70f)) g.FillEllipse(y, o);
        using (Pen pe = new Pen(Color.FromArgb(120, 0, 0, 0), 1.2f)) g.DrawEllipse(pe, o);
        // Halka yazısı
        using (Font f = new Font("Segoe UI", Math.Max(6f, s * 0.085f), FontStyle.Bold, GraphicsUnit.Pixel))
        using (SolidBrush tb = new SolidBrush(Color.FromArgb(40, 30, 0))) {
            StringFormat sf = new StringFormat(); sf.Alignment = StringAlignment.Center;
            g.DrawString("ACİL STOP", f, tb, new RectangleF(o.X, o.Y + s * 0.035f, s, s * 0.14f), sf);
            g.DrawString(latched ? "RESET" : "Esc", f, tb, new RectangleF(o.X, o.Bottom - s * 0.15f, s, s * 0.14f), sf);
        }
        // Kırmızı mantar
        bool down = latched || pressed;
        float k = down ? 0.60f : 0.66f;
        RectangleF m = new RectangleF(o.X + s * (1 - k) / 2f, o.Y + s * (1 - k) / 2f + (down ? s * 0.02f : 0), s * k, s * k);
        using (SolidBrush sh = new SolidBrush(Color.FromArgb(90, 0, 0, 0))) g.FillEllipse(sh, m.X + s * 0.02f, m.Y + s * 0.04f, m.Width, m.Height);
        Color c1 = down ? Color.FromArgb(150, 10, 10) : Color.FromArgb(255, 70, 60);
        Color c2 = down ? Color.FromArgb(70, 0, 0) : Color.FromArgb(150, 0, 0);
        if (latched && blink) { c1 = Color.FromArgb(255, 110, 90); c2 = Color.FromArgb(190, 20, 10); }
        using (GraphicsPath gp = new GraphicsPath()) {
            gp.AddEllipse(m);
            using (PathGradientBrush pg = new PathGradientBrush(gp)) {
                pg.CenterPoint = new PointF(m.X + m.Width * 0.4f, m.Y + m.Height * 0.35f);
                pg.CenterColor = c1; pg.SurroundColors = new Color[] { c2 };
                g.FillEllipse(pg, m);
            }
        }
        RectangleF hl = new RectangleF(m.X + m.Width * 0.22f, m.Y + m.Height * 0.08f, m.Width * 0.5f, m.Height * 0.3f);
        using (LinearGradientBrush hb = new LinearGradientBrush(hl, Color.FromArgb(down ? 50 : 120, 255, 255, 255), Color.FromArgb(0, 255, 255, 255), 90f)) g.FillEllipse(hb, hl);
        using (Font f2 = new Font("Segoe UI", Math.Max(7f, s * 0.13f), FontStyle.Bold, GraphicsUnit.Pixel))
        using (SolidBrush wb = new SolidBrush(Color.FromArgb(235, 255, 255, 255))) {
            StringFormat sf = new StringFormat(); sf.Alignment = StringAlignment.Center; sf.LineAlignment = StringAlignment.Center;
            g.DrawString(latched ? "BASILI" : "STOP", f2, wb, m, sf);
        }
    }
}

public class Cip : Control {
    // Ana ekranın alt satırındaki yuvarlak köşeli küçük tuş: simge + yazı (+ isteğe bağlı renkli nokta)
    public string Glyph = "";
    Color vurgu = Color.Empty;
    public Color Vurgu { get { return vurgu; } set { vurgu = value; Invalidate(); } }
    protected bool hover;
    public Cip() {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
        Cursor = Cursors.Hand;
        ForeColor = Color.FromArgb(229, 231, 235);
    }
    protected override void OnTextChanged(EventArgs e) { base.OnTextChanged(e); Invalidate(); }
    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
    protected static GraphicsPath Hap(RectangleF r) {
        float d = r.Height; var gp = new GraphicsPath();
        gp.AddArc(r.X, r.Y, d, d, 90, 180); gp.AddArc(r.Right - d, r.Y, d, d, 270, 180); gp.CloseFigure(); return gp;
    }
    protected void Zemin(Graphics g, RectangleF r) {
        using (var gp = Hap(r)) {
            using (var lb = new LinearGradientBrush(r, hover ? Color.FromArgb(44, 48, 58) : Color.FromArgb(30, 33, 40), hover ? Color.FromArgb(30, 33, 40) : Color.FromArgb(20, 22, 27), 90f)) g.FillPath(lb, gp);
            using (var pen = new Pen(Color.FromArgb(hover ? 230 : 120, 212, 175, 55), 1.2f)) g.DrawPath(pen, gp);
        }
    }
    protected override void OnPaint(PaintEventArgs e) {
        Graphics g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        g.Clear(Parent != null ? Parent.BackColor : Color.Black);
        var r = new RectangleF(1, 1, Width - 3, Height - 3);
        Zemin(g, r);
        float x = r.X + r.Height * 0.55f;
        if (vurgu != Color.Empty) {
            float d = r.Height * 0.28f;
            using (var b = new SolidBrush(vurgu)) g.FillEllipse(b, x, r.Y + (r.Height - d) / 2, d, d);
            x += d + 7;
        } else if (Glyph.Length > 0) {
            using (var f = new Font("Segoe MDL2 Assets", r.Height * 0.36f, GraphicsUnit.Pixel))
            using (var b = new SolidBrush(Color.FromArgb(240, 214, 140))) {
                var sz = g.MeasureString(Glyph, f);
                g.DrawString(Glyph, f, b, x - 2, r.Y + (r.Height - sz.Height) / 2 + 1);
                x += sz.Width + 2;
            }
        }
        using (var f = new Font("Segoe UI Semibold", r.Height * 0.40f, GraphicsUnit.Pixel))
        using (var b = new SolidBrush(ForeColor)) {
            var sz = g.MeasureString(Text, f);
            g.DrawString(Text, f, b, x, r.Y + (r.Height - sz.Height) / 2);
        }
    }
}

public class HizCip : Cip {
    // [ −  %100  + ]  · ortaya tıklayınca %100
    public event EventHandler Azalt, Arttir, Sifirla;
    int bolge = -1;
    protected override void OnMouseMove(MouseEventArgs e) { int b = e.X < Height ? 0 : (e.X > Width - Height ? 2 : 1); if (b != bolge) { bolge = b; Invalidate(); } base.OnMouseMove(e); }
    protected override void OnMouseLeave(EventArgs e) { bolge = -1; base.OnMouseLeave(e); }
    protected override void OnMouseClick(MouseEventArgs e) {
        if (e.X < Height) { if (Azalt != null) Azalt(this, EventArgs.Empty); }
        else if (e.X > Width - Height) { if (Arttir != null) Arttir(this, EventArgs.Empty); }
        else if (Sifirla != null) Sifirla(this, EventArgs.Empty);
        base.OnMouseClick(e);
    }
    protected override void OnPaint(PaintEventArgs e) {
        Graphics g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        g.Clear(Parent != null ? Parent.BackColor : Color.Black);
        var r = new RectangleF(1, 1, Width - 3, Height - 3);
        Zemin(g, r);
        var sf = new StringFormat(); sf.Alignment = StringAlignment.Center; sf.LineAlignment = StringAlignment.Center;
        using (var fb = new Font("Segoe UI", r.Height * 0.55f, FontStyle.Bold, GraphicsUnit.Pixel)) {
            for (int i = 0; i < 2; i++) {
                var kr = i == 0 ? new RectangleF(r.X, r.Y, r.Height, r.Height) : new RectangleF(r.Right - r.Height, r.Y, r.Height, r.Height);
                if (bolge == (i == 0 ? 0 : 2)) using (var hb = new SolidBrush(Color.FromArgb(60, 212, 175, 55))) g.FillEllipse(hb, kr.X + 3, kr.Y + 3, kr.Width - 6, kr.Height - 6);
                using (var b = new SolidBrush(Color.FromArgb(240, 214, 140))) g.DrawString(i == 0 ? "−" : "+", fb, b, kr, sf);
            }
        }
        var orta = new RectangleF(r.X + r.Height, r.Y, r.Width - 2 * r.Height, r.Height);
        using (var f = new Font("Segoe UI Semibold", r.Height * 0.42f, GraphicsUnit.Pixel))
        using (var b = new SolidBrush(ForeColor)) g.DrawString(Text, f, b, orta, sf);
    }
}

public class StatusLamp : Control {
    Color lamp = Color.FromArgb(90, 90, 90);
    public Color LampColor { get { return lamp; } set { lamp = value; Invalidate(); } }
    public StatusLamp() {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
    }
    protected override void OnPaint(PaintEventArgs e) {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Parent != null ? Parent.BackColor : Color.Black);
        float s = Math.Min(Width, Height) - 2;
        RectangleF o = new RectangleF(1, 1, s, s);
        // Metal halka
        using (LinearGradientBrush ring = new LinearGradientBrush(o, Color.FromArgb(235, 215, 150), Color.FromArgb(110, 80, 20), 60f)) g.FillEllipse(ring, o);
        RectangleF i2 = new RectangleF(o.X + s * 0.07f, o.Y + s * 0.07f, s * 0.86f, s * 0.86f);
        using (SolidBrush dark = new SolidBrush(Color.FromArgb(20, 20, 24))) g.FillEllipse(dark, i2);
        // Işık
        RectangleF l = new RectangleF(o.X + s * 0.11f, o.Y + s * 0.11f, s * 0.78f, s * 0.78f);
        using (GraphicsPath gp = new GraphicsPath()) {
            gp.AddEllipse(l);
            using (PathGradientBrush pg = new PathGradientBrush(gp)) {
                pg.CenterPoint = new PointF(l.X + l.Width * 0.42f, l.Y + l.Height * 0.38f);
                pg.CenterColor = Color.FromArgb(Math.Min(255, lamp.R + 90), Math.Min(255, lamp.G + 90), Math.Min(255, lamp.B + 90));
                pg.SurroundColors = new Color[] { Color.FromArgb(lamp.R / 2, lamp.G / 2, lamp.B / 2) };
                g.FillEllipse(pg, l);
            }
        }
        RectangleF sh = new RectangleF(l.X + l.Width * 0.2f, l.Y + l.Height * 0.08f, l.Width * 0.6f, l.Height * 0.36f);
        using (LinearGradientBrush sb = new LinearGradientBrush(sh, Color.FromArgb(110, 255, 255, 255), Color.FromArgb(0, 255, 255, 255), 90f)) g.FillEllipse(sb, sh);
    }
}

public class NcAnaliz {
    public int Satir;
    public List<int> Takimlar = new List<int>();
    public List<string> Hatalar = new List<string>();
    public HashSet<string> AltProgramlar = new HashSet<string>();
    public bool M30;
    public double[] Kumulatif;   // her satırın sonundaki tahmini süre (sn)
    public float[] PX, PY, PZ;   // her satırın sonundaki takım konumu
    public byte[] PF;            // 0: üst yüz kesme, 1: alt yüz kesme, 255: kesme yok
    public RectangleF[] Bounds = new RectangleF[2];
    public bool[] BoundsOk = new bool[2];
    public double Toplam { get { return Kumulatif == null || Kumulatif.Length == 0 ? 0 : Kumulatif[Kumulatif.Length - 1]; } }

    static readonly Regex Tok = new Regex(@"([A-Z])\s*(-?\d*\.?\d+)", RegexOptions.Compiled);
    static readonly Regex TakimRx = new Regex(@"T(\d+)\s*M0?6", RegexOptions.Compiled);
    static readonly Regex GosubRx = new Regex(@"GOSUB\s+(\w+)", RegexOptions.Compiled);

    public static NcAnaliz Oku(string yol, double hizliMmDk) {
        NcAnaliz a = new NcAnaliz();
        List<double> kum = new List<double>(1000000);
        List<float> lx = new List<float>(1000000), ly = new List<float>(1000000), lz = new List<float>(1000000);
        List<byte> lf = new List<byte>(1000000);
        float[] mnx = { 1e9f, 1e9f }, mny = { 1e9f, 1e9f }, mxx = { -1e9f, -1e9f }, mxy = { -1e9f, -1e9f };
        double x = 0, y = 0, z = 0, A = 0, B = 0, F = 1000, t = 0;
        int mode = 0; bool rel = false;
        foreach (string ham in File.ReadLines(yol)) {
            a.Satir++;
            string u = ham.ToUpperInvariant();
            int sc = u.IndexOf(';'); if (sc >= 0) u = u.Substring(0, sc);
            int pr = u.IndexOf('('); if (pr >= 0) u = u.Substring(0, pr);

            if (u.Contains("GOSUB")) {
                Match gm = GosubRx.Match(u);
                if (gm.Success) a.AltProgramlar.Add(gm.Groups[1].Value.ToLowerInvariant());
                t += 3; kum.Add(t); lx.Add((float)x); ly.Add((float)y); lz.Add((float)z); lf.Add(255); continue;
            }
            Match tm = TakimRx.Match(u);
            if (tm.Success) { a.Takimlar.Add(int.Parse(tm.Groups[1].Value)); t += 45; kum.Add(t); lx.Add((float)x); ly.Add((float)y); lz.Add((float)z); lf.Add(255); continue; }
            if (u.Contains("[")) { kum.Add(t); lx.Add((float)x); ly.Add((float)y); lz.Add((float)z); lf.Add(255); continue; }

            double nx = x, ny = y, nz = z, nA = A, nB = B;
            foreach (Match m in Tok.Matches(u)) {
                char L = m.Groups[1].Value[0];
                double v = double.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture);
                switch (L) {
                    case 'G':
                        if (v == 0) mode = 0; else if (v == 1 || v == 2 || v == 3) mode = 1;
                        else if (v == 90) rel = false; else if (v == 91) rel = true;
                        else if (v == 92) a.Hatalar.Add("Satır " + a.Satir + ": G92 var (parça sıfırını kaydırır): " + ham.Trim());
                        else if (v == 10) a.Hatalar.Add("Satır " + a.Satir + ": G10 var (G54 değerlerini değiştirir): " + ham.Trim());
                        else if (v == 4) { Match pm = Regex.Match(u, @"P\s*(\d*\.?\d+)"); if (pm.Success) t += double.Parse(pm.Groups[1].Value, CultureInfo.InvariantCulture); }
                        break;
                    case 'M':
                        if (v == 30) a.M30 = true;
                        else if (v == 100) { a.AltProgramlar.Add("m100"); t += 20; }
                        else if (v == 101) a.AltProgramlar.Add("m101");
                        break;
                    case 'F': if (v > 0) F = v; break;
                    case 'X': nx = rel ? x + v : v; break;
                    case 'Y': ny = rel ? y + v : v; break;
                    case 'Z': nz = rel ? z + v : v; break;
                    case 'A': nA = rel ? A + v : v; break;
                    case 'B': nB = rel ? B + v : v; break;
                }
            }
            double dx = nx - x, dy = ny - y, dz = nz - z;
            double d = Math.Sqrt(dx * dx + dy * dy + dz * dz);
            double rot = Math.Max(Math.Abs(nA - A), Math.Abs(nB - B));
            if (mode == 0) t += d / hizliMmDk * 60.0 + rot / 3600.0 * 60.0;
            else t += (d > 0 ? d : rot) / F * 60.0;
            bool hareket = d > 0 || rot > 0;
            byte face = 255;
            if (mode == 1 && hareket) {
                double bb = nB % 360.0; if (bb < 0) bb += 360.0;
                face = (byte)((bb < 90 || bb > 270) ? 0 : 1);
                mnx[face] = Math.Min(mnx[face], (float)nx); mxx[face] = Math.Max(mxx[face], (float)nx);
                mny[face] = Math.Min(mny[face], (float)ny); mxy[face] = Math.Max(mxy[face], (float)ny);
            }
            x = nx; y = ny; z = nz; A = nA; B = nB;
            kum.Add(t); lx.Add((float)x); ly.Add((float)y); lz.Add((float)z); lf.Add(face);
        }
        a.Kumulatif = kum.ToArray();
        a.PX = lx.ToArray(); a.PY = ly.ToArray(); a.PZ = lz.ToArray(); a.PF = lf.ToArray();
        for (int f = 0; f < 2; f++) {
            a.BoundsOk[f] = mxx[f] > mnx[f];
            if (a.BoundsOk[f]) a.Bounds[f] = new RectangleF(mnx[f], mny[f], mxx[f] - mnx[f], mxy[f] - mny[f]);
        }
        return a;
    }
}
'@

# ---------------- Kayıt (log) dosyası ----------------
[Kayit]::Ac([System.IO.Path]::Combine($ScriptKlasor, 'loglar'))
[Kayit]::Yaz("=== PANEL BAŞLADI ===  Bilgisayar: $env:COMPUTERNAME  Kullanıcı: $env:USERNAME  PowerShell: $($PSVersionTable.PSVersion)  32bit: $([IntPtr]::Size -eq 4)")
[Kayit]::Yaz("Eding klasörü: $EdingKlasor   Kayıt klasörü: $IsKlasor   Eding bulundu: $MakineBilgisayari")
$script:HataSayisi = 0
function Hatalari-Kaydet {
    if ($global:Error.Count -gt $script:HataSayisi) {
        $yeni = $global:Error.Count - $script:HataSayisi
        for ($i = $yeni - 1; $i -ge 0; $i--) {
            $h = $global:Error[$i]
            # "işlem bulunamadı" (Get-Process ... SilentlyContinue) zararsız; Windows dili ne olursa olsun atla
            if ("$($h.FullyQualifiedErrorId)" -like 'NoProcessFoundForGivenName*' -or "$($h.Exception.Message)" -like '*Cannot find a process*') { continue }
            [Kayit]::Yaz("PROGRAM HATASI: $($h.Exception.Message)  @ $($h.InvocationInfo.PositionMessage)")
        }
        $script:HataSayisi = $global:Error.Count
    }
}

# ---------------- Eding API (cncapi.dll, stdcall) ----------------
$script:ApiHazir = $false
$script:Bagli    = $false
if ($MakineBilgisayari) {
    if ([IntPtr]::Size -ne 4) {
        [Kayit]::Show("Program 32 bit çalışmalı. Lütfen KazimaBaslat.bat ile aç.", 'Kazıma Paneli', 'OK', 'Error') | Out-Null
        exit
    }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)]
public struct Cart { public double X, Y, Z, A, B, C; }

public static class Eding {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool SetDllDirectory(string path);

    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    public static extern int CncConnectServer(string iniFile);
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncDisConnectServer();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    public static extern int CncLoadJobA(string fileName);
    // Yazılım acil stopu basılıyken hareket komutları Eding'e gitmez
    public static volatile bool AcilKilit = false;
    [DllImport("cncapi.dll", EntryPoint = "CncRunOrResumeJob", CallingConvention = CallingConvention.StdCall)]
    static extern int _CncRunOrResumeJob();
    public static int CncRunOrResumeJob() { if (AcilKilit) return -1; return _CncRunOrResumeJob(); }
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncPauseJob();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncAbortJob();
    [DllImport("cncapi.dll", EntryPoint = "CncRunSingleLine", CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    static extern int _CncRunSingleLine(string line);
    public static int CncRunSingleLine(string line) { if (AcilKilit) return -1; return _CncRunSingleLine(line); }
    // Sadece acil stop rutini kullanır (M5 / M9 gibi güvenli kapatma satırları)
    public static int CncRunSingleLineZorla(string line) { return _CncRunSingleLine(line); }
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncSetOutput(int ioId, int value);
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetState();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern IntPtr CncGetStateText(int state);
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern IntPtr CncGetRCText(int rc);
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetAllAxesHomed();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetCurrentToolNumber();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern double CncGetActualSpeed();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetOutput(int ioId);
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetInput(int ioId);
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetRunningStatus();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetPauseStatus();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetEMStopActive();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetCurExecLine();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncReset();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern double CncGetVariable(int varNr);
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncGetSimulationMode();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern int CncSetFeedOverride(double factor);
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern double CncGetActualFeedOverride();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern Cart CncGetMachinePosition();
    [DllImport("cncapi.dll", CallingConvention = CallingConvention.StdCall)]
    public static extern Cart CncGetWorkPosition();

    public static Cart WorkPos() {
        try { return CncGetWorkPosition(); }
        catch {
            Cart c = new Cart();
            c.X = CncGetVariable(5001); c.Y = CncGetVariable(5002); c.Z = CncGetVariable(5003);
            c.A = CncGetVariable(5004); c.B = CncGetVariable(5005);
            return c;
        }
    }

    // Makine konumu; okunamazsa iş konumu + ofsetlerden hesaplanır
    public static Cart MachinePos() {
        try { return CncGetMachinePosition(); }
        catch {
            Cart c = new Cart();
            c.X = CncGetVariable(5001) + CncGetVariable(5221) + CncGetVariable(5211);
            c.Y = CncGetVariable(5002) + CncGetVariable(5222) + CncGetVariable(5212);
            c.Z = CncGetVariable(5003) + CncGetVariable(5223) + CncGetVariable(5213);
            c.A = CncGetVariable(5004) + CncGetVariable(5224) + CncGetVariable(5214);
            c.B = CncGetVariable(5005) + CncGetVariable(5225) + CncGetVariable(5215);
            return c;
        }
    }

    public static string StateText(int s) { IntPtr p = CncGetStateText(s); return p == IntPtr.Zero ? s.ToString() : Marshal.PtrToStringAnsi(p); }
    public static string RCText(int rc)   { IntPtr p = CncGetRCText(rc);   return p == IntPtr.Zero ? rc.ToString() : Marshal.PtrToStringAnsi(p); }
}
'@
    [void][Eding]::SetDllDirectory($EdingKlasor)
    [System.IO.Directory]::SetCurrentDirectory($EdingKlasor)
    Set-Location -LiteralPath $EdingKlasor
    $script:ApiHazir = $true
}

# ---------------- Eding'i otomatik başlat ----------------
$AyarDosyasi = [System.IO.Path]::Combine($ScriptKlasor, 'ayarlar.txt')

function Eding-Exe-Bul {
    # 1) Daha önce kaydedilen yol
    if ([System.IO.File]::Exists($AyarDosyasi)) {
        $kayitli = ([System.IO.File]::ReadAllText($AyarDosyasi)).Trim()
        if ($kayitli -and [System.IO.File]::Exists($kayitli) -and $kayitli.StartsWith($EdingKlasor, [System.StringComparison]::OrdinalIgnoreCase)) { return $kayitli }
    }
    # 2) Eding klasöründe arayüz programını ara (sunucu ve kurulum dosyaları hariç)
    $aday = [System.IO.Path]::Combine($EdingKlasor, 'cnc.exe')
    if ([System.IO.File]::Exists($aday)) { return $aday }
    $exeler = @(Get-ChildItem -LiteralPath $EdingKlasor -Filter '*.exe' -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch '(?i)server|setup|unins|update|install|driver|vcredist|python|notepad' })
    if ($exeler.Count -eq 1) { return $exeler[0].FullName }
    # 3) Bulunamazsa bir kez kullanıcıya sor
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Title = 'Eding CNC programını seç (bir kez sorulur)'
    $dlg.Filter = 'Programlar (*.exe)|*.exe'
    $dlg.InitialDirectory = $EdingKlasor
    if ($dlg.ShowDialog($form) -eq 'OK') { return $dlg.FileName }
    return $null
}

$script:EdingExeAd = 'cnc'
try { if ([System.IO.File]::Exists($AyarDosyasi)) { $kx = ([System.IO.File]::ReadAllText($AyarDosyasi)).Trim(); if ($kx) { $script:EdingExeAd = [System.IO.Path]::GetFileNameWithoutExtension($kx) } } } catch { }
function Eding-Pencere-Acik { return [bool](Get-Process -Name $script:EdingExeAd -ErrorAction SilentlyContinue) }
function Eding-Sunucu-Acik { return [bool](Get-Process -Name 'CncServer' -ErrorAction SilentlyContinue) }

# Pencere olmadan kalan sunucuyu temizle (önceki oturumdan kalan, POWERUP'ta takılı sunucu)
function Eding-Temizle {
    try { [void][Eding]::CncDisConnectServer() } catch { }
    $script:Bagli = $false
    $kill = [System.IO.Path]::Combine($EdingKlasor, 'KillCNC.exe')
    if ([System.IO.File]::Exists($kill)) {
        Yaz 'Eding: geride kalan sunucu kapatılıyor (KillCNC).'
        Start-Process -FilePath $kill -WorkingDirectory $EdingKlasor -Wait -WindowStyle Hidden
    } else {
        Get-Process -Name 'CncServer' -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Kill() } catch { } }
    }
    Start-Sleep -Seconds 1
}

# Dokunmatik ekran klavyesi: herhangi bir yazı kutusuna dokununca açılır (Windows osk 32 bit PowerShell'den açılamadığı için kendi klavyemiz)
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Windows.Forms;
public class DokunKlavye : Form, IMessageFilter {
    public static bool Acik = true;
    static DokunKlavye aktif;
    static DokunKlavye filtre;
    TextBox hedef; Label onizle; bool buyuk = true;
    System.Collections.Generic.List<Button> harfler = new System.Collections.Generic.List<Button>();
    static readonly Color Zemin = Color.FromArgb(24, 26, 30), Tus = Color.FromArgb(44, 48, 56), Yazi = Color.FromArgb(235, 235, 235), Altin = Color.FromArgb(240, 220, 150), Yesil = Color.FromArgb(120, 210, 140);
    const int K = 64, A = 6;

    public static void Kur() { if (filtre == null) { filtre = new DokunKlavye(true); Application.AddMessageFilter(filtre); } }
    DokunKlavye(bool sadeceFiltre) { }

    public bool PreFilterMessage(ref Message m) {
        if (m.Msg != 0x0202 || !Acik) return false;          // WM_LBUTTONUP (dokunma da bunu üretir)
        TextBox tb = Control.FromHandle(m.HWnd) as TextBox;
        if (tb == null || tb.ReadOnly || !tb.Enabled) return false;
        if (tb.FindForm() is DokunKlavye) return false;
        TextBox t2 = tb;
        tb.BeginInvoke(new MethodInvoker(delegate { Ac(t2); }));
        return false;
    }

    public static void Ac(TextBox tb) {
        Form sahip = tb.FindForm();
        if (aktif != null && !aktif.IsDisposed && aktif.Owner == sahip) { aktif.Hedefle(tb); return; }
        Kapat();
        aktif = new DokunKlavye(tb);
        aktif.Show(sahip);
        aktif.Konumla();
    }
    public static void Kapat() { if (aktif != null && !aktif.IsDisposed) { try { aktif.Close(); } catch { } } aktif = null; }

    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get { CreateParams cp = base.CreateParams; cp.ExStyle |= 0x08000000 | 0x00000008; return cp; } }  // NOACTIVATE + TOPMOST

    DokunKlavye(TextBox tb) {
        FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true; StartPosition = FormStartPosition.Manual;
        BackColor = Zemin; Padding = new Padding(8);
        string[] satir = { "1234567890", "QWERTYUIOP", "ASDFGHJKL-", "ZXCVBNM.,/" };
        int y = 52;
        onizle = new Label(); onizle.SetBounds(8, 8, 11 * (K + A) - A, 38); onizle.ForeColor = Altin; onizle.BackColor = Tus;
        onizle.Font = new Font("Consolas", 16f); onizle.TextAlign = ContentAlignment.MiddleLeft; Controls.Add(onizle);
        for (int r = 0; r < satir.Length; r++) {
            int x = 8 + (r == 2 ? K / 3 : r == 3 ? 2 * K / 3 : 0);
            foreach (char c in satir[r]) {
                Button b = Yap(c.ToString(), x, y, K, Yazi);
                string ch = c.ToString();
                b.Click += delegate { Yaz(buyuk ? ch : ch.ToLowerInvariant()); };
                if (char.IsLetter(c)) harfler.Add(b);
                x += K + A;
            }
            if (r == 0) { Button sil = Yap("⌫", x, y, K, Altin); sil.Click += delegate { Sil(); }; }
            if (r == 1) { Button bh = Yap("abc", x, y, K, Altin); bh.Click += delegate { buyuk = !buyuk; foreach (Button hb in harfler) hb.Text = buyuk ? hb.Text.ToUpperInvariant() : hb.Text.ToLowerInvariant(); bh.Text = buyuk ? "abc" : "ABC"; }; }
            y += K + A - 8;
        }
        int bx = 8;
        Button tem = Yap("Temizle", bx, y, 2 * K + A, Altin); tem.Click += delegate { if (hedef != null) { hedef.Text = ""; Guncelle(); } }; bx += 2 * K + 2 * A;
        Button sol = Yap("◀", bx, y, K, Yazi); sol.Click += delegate { if (hedef != null && hedef.SelectionStart > 0) { hedef.SelectionStart--; hedef.SelectionLength = 0; Guncelle(); } }; bx += K + A;
        Button bos = Yap("Boşluk", bx, y, 4 * K + 3 * A, Yazi); bos.Click += delegate { Yaz(" "); }; bx += 4 * K + 4 * A;
        Button sag = Yap("▶", bx, y, K, Yazi); sag.Click += delegate { if (hedef != null && hedef.SelectionStart < hedef.TextLength) { hedef.SelectionStart++; hedef.SelectionLength = 0; Guncelle(); } }; bx += K + A;
        Button tm = Yap("TAMAM", bx, y, 11 * (K + A) - A + 8 - bx, Yesil); tm.Click += delegate { Kapat(); };
        ClientSize = new Size(11 * (K + A) - A + 16, y + K - 8 + 8);
        Hedefle(tb);
    }
    Button Yap(string t, int x, int y, int w, Color renk) {
        Button b = new Button(); b.Text = t; b.SetBounds(x, y, w, K - 8); b.FlatStyle = FlatStyle.Flat; b.BackColor = Tus; b.ForeColor = renk;
        b.FlatAppearance.BorderColor = Color.FromArgb(70, 75, 85); b.Font = new Font("Segoe UI Semibold", 15f); b.TabStop = false;
        Controls.Add(b); return b;
    }
    void Hedefle(TextBox tb) {
        hedef = tb;
        try { tb.Focus(); if (tb.SelectionLength == 0) tb.SelectionStart = tb.TextLength; } catch { }
        Guncelle();
    }
    void Guncelle() { if (hedef == null) return; string t = hedef.Text; int i = Math.Min(hedef.SelectionStart, t.Length); onizle.Text = " " + t.Substring(0, i) + "|" + t.Substring(i); }
    void Yaz(string s) {
        if (hedef == null || hedef.IsDisposed) return;
        if (hedef.MaxLength > 0 && hedef.TextLength - hedef.SelectionLength + s.Length > hedef.MaxLength) return;
        hedef.SelectedText = s; Guncelle();
    }
    void Sil() {
        if (hedef == null || hedef.IsDisposed) return;
        if (hedef.SelectionLength > 0) hedef.SelectedText = "";
        else if (hedef.SelectionStart > 0) { int i = hedef.SelectionStart; hedef.Text = hedef.Text.Remove(i - 1, 1); hedef.SelectionStart = i - 1; }
        Guncelle();
    }
    void Konumla() {
        Rectangle ek = Screen.FromControl(hedef).WorkingArea;
        Rectangle kutu = hedef.RectangleToScreen(hedef.ClientRectangle);
        int x = Math.Max(ek.Left, Math.Min(kutu.Left + kutu.Width / 2 - Width / 2, ek.Right - Width));
        int y = kutu.Bottom + 8;
        if (y + Height > ek.Bottom) y = kutu.Top - Height - 8;   // altta yer yoksa kutunun üstüne
        if (y < ek.Top) y = ek.Bottom - Height;
        Location = new Point(x, y);
    }
}
'@

# Uzaktan erişim: aynı ağdaki bilgisayarlar tarayıcıdan izler, dosya yükler, başlatır (arka plan iş parçacığı; komutlar panelde çalışır)
Add-Type -ReferencedAssemblies System.Drawing, System.Windows.Forms -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class UzakIstek {
    public string Ad, Arg, Ip, Sonuc;
    public ManualResetEvent Bitti = new ManualResetEvent(false);
}
public static class WebSunucu {
    public static string Pin = "";
    public static string SayfaYolu = "";
    public static string IsKlasor = "";
    public static volatile string DurumJson = "{}";
    public static int Port = 0;
    public static string SonHata = "";
    static TcpListener dinleyici;
    static Thread kabulIs;
    static volatile bool calis;
    static readonly Queue<UzakIstek> kuyruk = new Queue<UzakIstek>();
    public static DateTime SonUzakGirdi = DateTime.MinValue;

    // ---- Ekran yansıtma: makinedeki ekranın aynısı (JPEG), tıklama ve tuşlar makineye gider ----
    [DllImport("user32.dll")] static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] i, int size);
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint data; public uint flags; public uint time; public IntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTU { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTU u; }
    static readonly object ekranKilit = new object();
    static byte[] sonKare; static DateTime sonKareAni = DateTime.MinValue;
    static ImageCodecInfo jpeg;
    public static byte[] Ekran() {
        lock (ekranKilit) {
            if (sonKare != null && (DateTime.Now - sonKareAni).TotalMilliseconds < 150) return sonKare;
            Rectangle r = Screen.PrimaryScreen.Bounds;
            using (Bitmap b = new Bitmap(r.Width, r.Height, PixelFormat.Format24bppRgb)) {
                using (Graphics g = Graphics.FromImage(b)) g.CopyFromScreen(r.Left, r.Top, 0, 0, r.Size);
                int w = Math.Min(r.Width, 1600), h = r.Height * w / r.Width;
                using (Bitmap k = new Bitmap(w, h, PixelFormat.Format24bppRgb)) {
                    using (Graphics g2 = Graphics.FromImage(k)) { g2.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear; g2.DrawImage(b, 0, 0, w, h); }
                    if (jpeg == null) foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") jpeg = c;
                    EncoderParameters ep = new EncoderParameters(1); ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 72L);
                    using (MemoryStream ms = new MemoryStream()) { k.Save(ms, jpeg, ep); sonKare = ms.ToArray(); }
                }
            }
            sonKareAni = DateTime.Now; return sonKare;
        }
    }
    public static void Tikla(double nx, double ny) {
        SonUzakGirdi = DateTime.Now;
        int ax = (int)Math.Round(Math.Max(0, Math.Min(1, nx)) * 65535), ay = (int)Math.Round(Math.Max(0, Math.Min(1, ny)) * 65535);
        mouse_event(0x8001, ax, ay, 0, UIntPtr.Zero);            // MOVE | ABSOLUTE
        Thread.Sleep(30);
        mouse_event(0x8002, ax, ay, 0, UIntPtr.Zero); Thread.Sleep(40);   // LEFTDOWN
        mouse_event(0x8004, ax, ay, 0, UIntPtr.Zero);            // LEFTUP
        lock (ekranKilit) sonKare = null;
    }
    static void Tus(ushort vk, ushort scan, uint flags) {
        INPUT[] i = new INPUT[2];
        i[0].type = 1; i[0].u.ki.wVk = vk; i[0].u.ki.wScan = scan; i[0].u.ki.dwFlags = flags;
        i[1] = i[0]; i[1].u.ki.dwFlags = flags | 2;  // KEYUP
        SendInput(2, i, Marshal.SizeOf(typeof(INPUT)));
    }
    public static void Yazi(string t, string ozel) {
        SonUzakGirdi = DateTime.Now;
        if (!string.IsNullOrEmpty(ozel)) {
            ushort vk = 0;
            switch (ozel) { case "Enter": vk = 0x0D; break; case "Backspace": vk = 0x08; break; case "Escape": vk = 0x1B; break; case "Tab": vk = 0x09; break;
                case "Delete": vk = 0x2E; break; case "ArrowLeft": vk = 0x25; break; case "ArrowRight": vk = 0x27; break; case "ArrowUp": vk = 0x26; break; case "ArrowDown": vk = 0x28; break; }
            if (vk != 0) Tus(vk, 0, 0);
        }
        if (!string.IsNullOrEmpty(t)) foreach (char c in t) Tus(0, c, 4);   // KEYEVENTF_UNICODE
        lock (ekranKilit) sonKare = null;
    }

    public static bool Baslat(int port) {
        int[] portlar = { port, port + 1, port + 2, port + 3, port + 4, 18080, 28080 };
        foreach (int p in portlar) {
            try {
                dinleyici = new TcpListener(IPAddress.Any, p);
                dinleyici.Start();
                Port = p; calis = true;
                kabulIs = new Thread(Kabul); kabulIs.IsBackground = true; kabulIs.Start();
                return true;
            } catch (Exception ex) { SonHata = ex.Message; dinleyici = null; }
        }
        return false;
    }
    public static void Durdur() { calis = false; try { if (dinleyici != null) dinleyici.Stop(); } catch { } }

    public static UzakIstek Al() { lock (kuyruk) { return kuyruk.Count > 0 ? kuyruk.Dequeue() : null; } }

    public static string[] Adresler() {
        List<string> l = new List<string>();
        try {
            foreach (IPAddress a in Dns.GetHostAddresses(Dns.GetHostName()))
                if (a.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(a)) l.Add(a.ToString());
        } catch { }
        return l.ToArray();
    }

    static void Kabul() {
        while (calis) {
            try {
                TcpClient c = dinleyici.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(delegate(object o) { Isle((TcpClient)o); }, c);
            } catch { if (!calis) return; Thread.Sleep(200); }
        }
    }

    static string SatirOku(Stream s) {
        StringBuilder sb = new StringBuilder();
        while (true) {
            int b = s.ReadByte();
            if (b < 0) return sb.Length > 0 ? sb.ToString() : null;
            if (b == '\n') break;
            if (b != '\r') sb.Append((char)b);
            if (sb.Length > 8192) return null;
        }
        return sb.ToString();
    }

    static void Gonder(Stream s, int kod, string tur, byte[] govde) {
        string durum = kod == 200 ? "OK" : kod == 204 ? "No Content" : kod == 401 ? "Unauthorized" : kod == 404 ? "Not Found" : "Error";
        string h = "HTTP/1.1 " + kod + " " + durum + "\r\nContent-Type: " + tur + "\r\nContent-Length: " + govde.Length +
                   "\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: X-Pin, Content-Type\r\n" +
                   "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Private-Network: true\r\nConnection: close\r\n\r\n";
        byte[] hb = Encoding.ASCII.GetBytes(h);
        s.Write(hb, 0, hb.Length); s.Write(govde, 0, govde.Length); s.Flush();
    }
    static void Json(Stream s, int kod, string json) { Gonder(s, kod, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json)); }
    static string Kacis(string t) {
        StringBuilder sb = new StringBuilder();
        foreach (char ch in t ?? "") {
            if (ch == '"' || ch == '\\') { sb.Append('\\'); sb.Append(ch); }
            else if (ch < 32) sb.Append("\\u" + ((int)ch).ToString("x4"));
            else sb.Append(ch);
        }
        return sb.ToString();
    }

    static void Isle(TcpClient c) {
        try {
            c.ReceiveTimeout = 30000; c.SendTimeout = 30000;
            using (NetworkStream s = c.GetStream()) {
                string ilk = SatirOku(s);
                if (ilk == null) return;
                string[] p = ilk.Split(' ');
                if (p.Length < 2) return;
                string yontem = p[0].ToUpperInvariant(), yol = p[1], sorgu = "";
                int q = yol.IndexOf('?'); if (q >= 0) { sorgu = yol.Substring(q + 1); yol = yol.Substring(0, q); }
                Dictionary<string, string> bas = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                string l;
                while ((l = SatirOku(s)) != null && l.Length > 0) { int i = l.IndexOf(':'); if (i > 0) bas[l.Substring(0, i).Trim()] = l.Substring(i + 1).Trim(); }
                Dictionary<string, string> par = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (string kv in sorgu.Split('&')) {
                    if (kv.Length == 0) continue;
                    int e = kv.IndexOf('=');
                    string k = e >= 0 ? kv.Substring(0, e) : kv, v = e >= 0 ? kv.Substring(e + 1) : "";
                    par[Uri.UnescapeDataString(k.Replace('+', ' '))] = Uri.UnescapeDataString(v.Replace('+', ' '));
                }
                long uzunluk = 0; string cl; if (bas.TryGetValue("Content-Length", out cl)) long.TryParse(cl, out uzunluk);
                string ip = ((IPEndPoint)c.Client.RemoteEndPoint).Address.ToString();

                // Tarayıcı ön kontrolü (başka cihazın portal sayfasından gelen istekler)
                if (yontem == "OPTIONS") { Gonder(s, 204, "text/plain", new byte[0]); return; }
                if (yol == "/" || yol == "/index.html" || yol == "/portal" || yol == "/tek") {
                    string ad = yol == "/tek" ? "uzak.html" : "portal.html";
                    string sp = Path.Combine(Path.GetDirectoryName(SayfaYolu), ad);
                    byte[] sayfa = File.Exists(sp) ? File.ReadAllBytes(sp) : Encoding.UTF8.GetBytes(ad + " yok");
                    Gonder(s, 200, "text/html; charset=utf-8", sayfa); return;
                }
                if (!yol.StartsWith("/api/")) { Gonder(s, 404, "text/plain", Encoding.ASCII.GetBytes("yok")); return; }
                string pin; bas.TryGetValue("X-Pin", out pin);
                if (string.IsNullOrEmpty(pin)) par.TryGetValue("pin", out pin);
                if (Pin.Length > 0 && pin != Pin) { Json(s, 401, "{\"hata\":\"PIN yanlis\"}"); return; }

                if (yol == "/api/durum") { Json(s, 200, DurumJson); return; }
                if (yol == "/api/ekran") {
                    byte[] k;
                    try { k = Ekran(); } catch (Exception ex) { Json(s, 500, "{\"hata\":\"Ekran alinamadi (makine kilitli olabilir): " + Kacis(ex.Message) + "\"}"); return; }
                    Gonder(s, 200, "image/jpeg", k); return;
                }
                if (yol == "/api/tikla" && yontem == "POST") {
                    string xs, ys; double x, y;
                    par.TryGetValue("x", out xs); par.TryGetValue("y", out ys);
                    if (double.TryParse(xs, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out x) &&
                        double.TryParse(ys, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out y)) Tikla(x, y);
                    Json(s, 200, "{\"sonuc\":\"OK\"}"); return;
                }
                if (yol == "/api/tus" && yontem == "POST") {
                    string t, o; par.TryGetValue("t", out t); par.TryGetValue("k", out o);
                    Yazi(t, o); Json(s, 200, "{\"sonuc\":\"OK\"}"); return;
                }
                if (yol == "/api/dosyalar") {
                    StringBuilder sb = new StringBuilder("[");
                    if (Directory.Exists(IsKlasor)) {
                        List<FileInfo> fl = new List<FileInfo>();
                        foreach (string f in Directory.GetFiles(IsKlasor, "*.nc")) {
                            string ad = Path.GetFileName(f);
                            if (ad.Equals("AKTIF_IS.nc", StringComparison.OrdinalIgnoreCase) || ad.StartsWith("PM_") || ad.Contains("_blok")) continue;
                            fl.Add(new FileInfo(f));
                        }
                        fl.Sort(delegate(FileInfo a, FileInfo b) { return b.LastWriteTime.CompareTo(a.LastWriteTime); });
                        for (int i = 0; i < fl.Count && i < 60; i++) {
                            if (i > 0) sb.Append(',');
                            sb.Append("{\"ad\":\"" + Kacis(fl[i].Name) + "\",\"kb\":" + (fl[i].Length / 1024) + ",\"tarih\":\"" + fl[i].LastWriteTime.ToString("dd.MM HH:mm") + "\"}");
                        }
                    }
                    sb.Append(']'); Json(s, 200, sb.ToString()); return;
                }
                if (yol == "/api/yukle" && yontem == "POST") {
                    string ad; par.TryGetValue("ad", out ad);
                    ad = Path.GetFileName(ad ?? "");
                    if (!ad.EndsWith(".nc", StringComparison.OrdinalIgnoreCase) || ad.Length < 4) { Json(s, 400, "{\"hata\":\"Sadece .nc dosyasi yuklenebilir\"}"); return; }
                    if (uzunluk <= 0 || uzunluk > 200L * 1024 * 1024) { Json(s, 400, "{\"hata\":\"Dosya bos ya da cok buyuk\"}"); return; }
                    Directory.CreateDirectory(IsKlasor);
                    string gecici = Path.Combine(IsKlasor, ad + ".yukleniyor");
                    using (FileStream fs = new FileStream(gecici, FileMode.Create)) {
                        byte[] tampon = new byte[65536]; long kalan = uzunluk;
                        while (kalan > 0) { int n = s.Read(tampon, 0, (int)Math.Min(tampon.Length, kalan)); if (n <= 0) break; fs.Write(tampon, 0, n); kalan -= n; }
                        if (kalan > 0) { fs.Close(); File.Delete(gecici); Json(s, 400, "{\"hata\":\"Yukleme yarim kaldi\"}"); return; }
                    }
                    string hedef = Path.Combine(IsKlasor, ad);
                    if (File.Exists(hedef)) File.Delete(hedef);
                    File.Move(gecici, hedef);
                    Json(s, 200, "{\"sonuc\":\"OK: " + Kacis(ad) + " yuklendi\",\"ad\":\"" + Kacis(ad) + "\"}"); return;
                }
                if (yol == "/api/komut" && yontem == "POST") {
                    UzakIstek ist = new UzakIstek();
                    par.TryGetValue("ad", out ist.Ad); par.TryGetValue("arg", out ist.Arg); ist.Ip = ip;
                    if (ist.Arg == null) ist.Arg = "";
                    lock (kuyruk) kuyruk.Enqueue(ist);
                    string sonuc = ist.Bitti.WaitOne(45000) ? ist.Sonuc : "HATA: Panel cevap vermedi (makinedeki ekranda bir pencere acik olabilir)";
                    Json(s, 200, "{\"sonuc\":\"" + Kacis(sonuc) + "\"}"); return;
                }
                Gonder(s, 404, "text/plain", Encoding.ASCII.GetBytes("yok"));
            }
        } catch { }
        finally { try { c.Close(); } catch { } }
    }
}
'@

# Eding penceresini arka planda tut: Eding'in arayüzü çalışmak zorunda (sunucu onsuz POWERUP'ta kalır),
# ama ekranda ve görev çubuğunda görünmez. Hata/uyarı kutuları (#32770) gizlenmez.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Pencere {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    // Eding'i düzgün kapat (gizliyken de): başlığı "CNC" ile başlayan ana pencereye WM_CLOSE.
    // Eding kapanırken G54 ve kalıcı değişkenleri kaydeder; zorla öldürmek bunları kaybettirebilir.
    public static int Kapat(int pid) {
        var l = new List<IntPtr>();
        EnumWindows(delegate (IntPtr h, IntPtr x) {
            uint p; GetWindowThreadProcessId(h, out p);
            if (p == (uint)pid) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); if (sb.ToString().StartsWith("CNC")) l.Add(h); }
            return true;
        }, IntPtr.Zero);
        foreach (var h in l) PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
        return l.Count;
    }
    static readonly HashSet<IntPtr> gizli = new HashSet<IntPtr>();
    static List<IntPtr> Bul(int pid, bool gorunur) {
        var l = new List<IntPtr>();
        EnumWindows(delegate (IntPtr h, IntPtr x) {
            uint p; GetWindowThreadProcessId(h, out p);
            if (p == (uint)pid && IsWindowVisible(h) == gorunur) l.Add(h);
            return true;
        }, IntPtr.Zero);
        return l;
    }
    public static string SonGizlenen = "";
    public static string Gizlenemedi = "";
    public static int Gizle(int pid) {
        int n = 0;
        foreach (var h in Bul(pid, true)) {
            var sc = new StringBuilder(64); GetClassName(h, sc, 64);
            var st = new StringBuilder(256); GetWindowText(h, st, 256);
            string sinif = sc.ToString(), baslik = st.ToString();
            // Eding'in ana penceresi bir iletişim kutusu sınıfı (#32770) olabilir: başlığı "CNC" ile başlıyorsa her durumda gizle.
            // Başka başlıklı #32770 kutuları (hata / uyarı mesajları) görünür kalsın.
            // Bu makinede ana pencerenin başlığı farklı olabilir: büyük pencereler (ana ekran, açılış ekranı) de gizlenir.
            RECT rc; GetWindowRect(h, out rc);
            bool buyuk = (rc.R - rc.L) > 560 && (rc.B - rc.T) > 360;
            bool ana = baslik.StartsWith("CNC") || buyuk;
            if (!ana && sinif == "#32770" && baslik.Length > 0) continue;
            ShowWindow(h, 0); gizli.Add(h); n++;
            if (IsWindowVisible(h)) Gizlenemedi = "'" + baslik + "'";
            SonGizlenen = "'" + baslik + "' [" + sinif + "]";
        }
        return n;
    }
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
    // Eding'in kendi uyarı/hata kutuları (gizlenmeyen küçük pencereler) panelin ÜSTÜNE alınır; yoksa panel TopMost olduğu için arkada kalırlar
    public static int UyarilariOneAl(int pid) {
        int n = 0;
        foreach (var h in Bul(pid, true)) {
            if (gizli.Contains(h)) continue;
            SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);   // HWND_TOPMOST, NOSIZE|NOMOVE|NOACTIVATE
            n++;
        }
        return n;
    }
    public static int Goster(int pid) {
        int n = 0; IntPtr son = IntPtr.Zero;
        foreach (var h in Bul(pid, false)) { if (gizli.Contains(h)) { ShowWindow(h, 9); gizli.Remove(h); son = h; n++; } }
        if (son != IntPtr.Zero) SetForegroundWindow(son);
        return n;
    }
}
'@

$script:EdingGosteriliyor = $false
function Eding-Kapat-Nazik {
    foreach ($pr in @(Get-Process -Name $script:EdingExeAd -ErrorAction SilentlyContinue)) {
        $n = 0; try { $n = [Pencere]::Kapat($pr.Id) } catch { }
        if ($n -eq 0) { try { $pr.CloseMainWindow() | Out-Null } catch { } }
    }
}

function Eding-Gizle-Tik {
    if ($script:Tercih.EdingGizli -eq '0' -or $script:EdingGosteriliyor) { return }
    try {
        foreach ($pr in @(Get-Process -Name $script:EdingExeAd -ErrorAction SilentlyContinue)) {
            $n = [Pencere]::Gizle($pr.Id)
            [void][Pencere]::UyarilariOneAl($pr.Id)
            if ($n -gt 0) {
                if (-not $script:EdingGizlendiYazildi) {
                    [Kayit]::Yaz("EDING: pencere arka plana alındı: $([Pencere]::SonGizlenen)  (panel yönetici: $script:Yonetici)")
                    if ([Pencere]::Gizlenemedi) { Yaz "Eding penceresi gizlenemedi $([Pencere]::Gizlenemedi): YoneticiKurulum.bat bir kez çalıştırılmalı. PrimerMill yine de en önde kalır." }
                    $script:EdingGizlendiYazildi = $true
                }
                # Eding öne çıkmışsa panel tekrar öne gelsin
                # Açık bir soru penceresi (blok, frez modu vb.) varsa onu öne al; paneli değil (yoksa pencere tıklanamaz olur)
                try {
                    $acik = @([System.Windows.Forms.Application]::OpenForms | Where-Object { $_ -ne $form -and $_.Visible -and $_.Modal })
                    if ($acik.Count -gt 0) { $acik[$acik.Count - 1].Activate() }
                    elseif ($form.Visible -and $form.WindowState -ne 'Minimized' -and $form.Enabled) { $form.Activate() }
                } catch { }
            }
        }
    } catch { }
}
$edingGizleZaman = New-Object System.Windows.Forms.Timer
$edingGizleZaman.Interval = 250
$edingGizleZaman.Add_Tick({ Eding-Gizle-Tik })

function Eding-Baslat {
    if (-not $MakineBilgisayari) { return }
    if (Eding-Pencere-Acik) { return }   # zaten açık
    if (Eding-Sunucu-Acik) { Eding-Temizle }
    $exe = Eding-Exe-Bul
    if (-not $exe) { Yaz "Eding CNC programı bulunamadı; elle açın."; return }
    try { [System.IO.File]::WriteAllText($AyarDosyasi, $exe) } catch { }
    $script:EdingExeAd = [System.IO.Path]::GetFileNameWithoutExtension($exe)
    $script:SonEdingBaslatma = Get-Date
    Yaz "Eding CNC başlatılıyor: $exe"
    $script:EdingGizlendiYazildi = $false
    $stil = if ($script:Tercih.EdingGizli -ne '0' -and -not $script:EdingGosteriliyor) { 'Hidden' } else { 'Minimized' }
    Start-Process -FilePath $exe -WorkingDirectory ([System.IO.Path]::GetDirectoryName($exe)) -WindowStyle $stil
    $script:MakroYamaBekliyor = $false   # Eding yeni açıldı: macro.cnc baştan okunur
    $script:MakroKontrolTamam = $false
}

# Eding durumu: IDLE, READY, ABORTED, RUNNING, AXISJOG, IPJOG, SEARCHING, PAUSE
# Açılışta: Eding açıksa kapat (iş yapmıyorsa), 15 sn bekle, temiz aç
function Acilis-Eding-Sifirla {
    if (-not $MakineBilgisayari) { return }
    if ((Eding-Pencere-Acik) -or (Eding-Sunucu-Acik)) {
        if ((Eding-Pencere-Acik) -and (Eding-Sunucu-Acik) -and (Baglan)) {
            $d = Eding-Durum
            if ((Mesgul $d) -or $d -eq 'PAUSE') {
                Yaz "Açılış: Eding şu an çalışıyor ($d), sıfırlanmadı."
                return
            }
        }
        Yaz 'Açılış: Eding kapatılıyor (sıfırlama)...'
        Durum-Yaz 'Eding sıfırlanıyor...' $cAltinAc
        try { [void][Eding]::CncDisConnectServer() } catch { }
        $script:Bagli = $false
        Eding-Kapat-Nazik
        $son = (Get-Date).AddSeconds(10)
        while ((Eding-Pencere-Acik) -and (Get-Date) -lt $son) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 200 }
        Get-Process -Name $script:EdingExeAd -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Kill() } catch { } }
        Eding-Temizle
    }
    for ($i = 15; $i -ge 1; $i--) {
        Durum-Yaz "Eding $i sn sonra açılacak..." $cAltinAc
        $son = (Get-Date).AddSeconds(1)
        while ((Get-Date) -lt $son) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
    }
    Yaz 'Açılış: Eding açılıyor.'
    Durum-Yaz 'Eding açılıyor...' $cAltinAc
}

function Eding-Durum { try { return ([Eding]::StateText([Eding]::CncGetState())).Trim().ToUpper() } catch { return '' } }
function Durakli-Mi { return ((Eding-Durum) -like 'PAUSE*') }
# Görülen durumlar: IDLE, READY, ABORTED, RUNNING, RUN-SUB, SEARCHING, AXISJOG, IPJOG, PAUSE, INT-ERR
function Mesgul([string]$d) { return ($d -like 'RUN*' -or @('SEARCHING', 'AXISJOG', 'IPJOG') -contains $d) }
function Hatali([string]$d) { return ($d -like '*ERR*') }
function Calisiyor-Mu { return (Mesgul (Eding-Durum)) }
# K1 (GV-01): duraklatılmış iş de "sürüyor" sayılır. İş sürerken ya da duraklıyken yalnız DEVAM, DURDUR, ACİL STOP ve hız serbest;
# jog, M6, pens, MDI, G54/#4000-#4199 yazma, iş yükleme, Eding'i yeniden başlatma yasak (iş mili duraklamada dönmeye devam eder).
function Is-Suruyor {
    if ($script:IsAktif) { return $true }
    if (-not $script:ApiHazir -or -not $script:Bagli) { return $false }
    $d = Eding-Durum
    if ((Mesgul $d) -or $d -like 'PAUSE*') { return $true }
    try { if ([Eding]::CncGetPauseStatus() -ne 0) { return $true } } catch { }
    return $false
}
function Is-Suruyor-Uyari([string]$islem) {
    if (-not (Is-Suruyor)) { return $false }
    [Kayit]::Yaz("ENGEL: '$islem' iş sürerken / duraklıyken reddedildi")
    [Kayit]::Show("Bir iş çalışıyor ya da DURAKLATILMIŞ bekliyor.`r`n`r`nİş sürerken ve duraklıyken yalnız DEVAM, DURDUR, ACİL STOP ve hız ayarı kullanılabilir (duraklamada iş mili dönmeye devam eder).`r`nBu işlem için önce işin bitmesini bekle ya da DURDUR.", $islem, 'OK', 'Warning') | Out-Null
    return $true
}

# Eding hata ya da iptal durumundaysa komut kabul etmez: önce sıfırla
function Hata-Temizle([string]$islem) {
    $d = Eding-Durum
    if ((Hatali $d) -or $d -eq 'ABORTED') {
        Yaz "$islem : Eding '$d' durumunda, sıfırlanıyor: $([Eding]::RCText([Eding]::CncReset()))"
        Start-Sleep -Milliseconds 800
    }
}

# ---------------- Bağlantı bekçisi ----------------
$script:SonSunucuKontrol = [datetime]::MinValue
$script:SonEdingBaslatma = [datetime]::MinValue
$script:PowerupBas = $null
function Baglanti-Bekcisi {
    if (-not $script:ApiHazir) { return }
    if (((Get-Date) - $script:SonSunucuKontrol).TotalSeconds -lt 2) { return }
    $script:SonSunucuKontrol = Get-Date
    $pencere = Eding-Pencere-Acik
    $sunucu = Eding-Sunucu-Acik
    if ($pencere -and $sunucu) {
        # POWERUP'ta takılı kalırsa yeniden başlat
        if ($script:Bagli -and (Eding-Durum) -eq 'POWERUP') {
            if ($null -eq $script:PowerupBas) { $script:PowerupBas = Get-Date }
            elseif (((Get-Date) - $script:PowerupBas).TotalSeconds -gt 30) {
                Yaz 'Eding 30 sn POWERUP durumunda kaldı, yeniden başlatılıyor.'
                $script:PowerupBas = $null
                Eding-Kapat-Nazik
                Start-Sleep -Seconds 2
                Eding-Temizle
                $script:SonEdingBaslatma = [datetime]::MinValue
            }
        } else { $script:PowerupBas = $null }
        if ($script:Bagli) { return }
        return
    }
    if ($script:Bagli) {
        Yaz 'Eding kapandı: bağlantı kesildi.'
        try { [void][Eding]::CncDisConnectServer() } catch { }
        $script:Bagli = $false
        $script:MakroKontrolTamam = $false
        if ($script:IsAktif) { $script:IsAktif = $false; $bar.Dancing = $false; $lblSure.Text = 'Eding kapandı'; $lblSure.ForeColor = $cKirmizi }
    }
    if (((Get-Date) - $script:SonEdingBaslatma).TotalSeconds -ge 30) {
        Eding-Baslat
        if ($script:Tercih.OtomatikHazirlik -eq '1') { $script:AcilisDurum = 'bekliyor' }
    }
}

function Rc-Tamam([int]$rc) { return ($rc -eq 0 -or $rc -eq 7) }   # 0 = OK, 7 = zaten bağlı

function Baglan {
    if (-not $script:ApiHazir) { return $false }
    if ($script:Bagli) { return $true }
    # Sunucu kapalıysa bağlanma; yoksa DLL Eding'i arayüzsüz başlatabilir
    if (-not (Get-Process -Name 'CncServer' -ErrorAction SilentlyContinue)) { return $false }
    if (-not (Eding-Pencere-Acik)) { return $false }
    try {
        $rc = [Eding]::CncConnectServer('')
        # 0 = OK, 6 = sunucu zaten çalışıyor, 7 = zaten bağlı: hepsi bağlantı demek
        $script:Bagli = ($rc -eq 0 -or $rc -eq 6 -or $rc -eq 7)
        if (-not $script:Bagli) { Yaz ("Eding'e bağlanılamadı: " + [Eding]::RCText($rc)) }
    } catch { Yaz "Bağlantı hatası: $($_.Exception.Message)"; $script:Bagli = $false }
    return $script:Bagli
}

function Komut-Sonucu([string]$ad, [int]$rc) {
    if (Rc-Tamam $rc) { Yaz "$ad : tamam"; return $true }
    if ([Eding]::AcilKilit) {
        Yaz "$ad : ACİL STOP basılı, komut gönderilmedi."
        [Kayit]::Show("ACİL STOP basılı. Komut gönderilmedi.`r`n`r`nKaldırmak için RESET'e (ya da ACİL STOP butonuna) bas.", 'Acil stop', 'OK', 'Warning') | Out-Null
        return $false
    }
    $t = [Eding]::RCText($rc)
    Yaz "$ad : HATA ($t)"
    [Kayit]::Show("$ad başarısız:`r`n$t", 'Kazıma Paneli', 'OK', 'Error') | Out-Null
    return $false
}

# ED-02: durum okunamazsa ('' = bağlantı koptu / API hatası), Eding hata verirse ya da süre dolarsa $false döner;
# "bitti" yalnız Eding açıkça meşgul değil ve hatasız durumdayken sayılır. Güvenlik kararı veren her çağıran $false'ta durmalı.
function Hareket-Bitene-Kadar-Bekle([int]$saniye) {
    $son = (Get-Date).AddSeconds($saniye)
    Start-Sleep -Milliseconds 400
    while ((Get-Date) -lt $son) {
        [System.Windows.Forms.Application]::DoEvents()
        $d = Eding-Durum
        if ($d -eq '') { Yaz 'Eding durumu okunamadı (bağlantı koptu?): hareket bitti sayılmadı.'; return $false }
        if (-not (Mesgul $d)) {
            Start-Sleep -Milliseconds 200
            $d = Eding-Durum
            if ($d -eq '') { Yaz 'Eding durumu okunamadı (bağlantı koptu?): hareket bitti sayılmadı.'; return $false }
            if (Hatali $d) { Yaz "Eding hata verdi ($d). Açıklaması Eding penceresinin mesaj kısmında."; return $false }
            if (-not (Mesgul $d)) { return $true }
        }
        Start-Sleep -Milliseconds 200
    }
    [Kayit]::Yaz("BEKLEME: $saniye sn içinde hareket bitmedi (durum $(Eding-Durum))")
    return $false
}

# ---------------- Yardımcılar ----------------
$script:SeciliDosya = $null
$script:Analiz      = $null
$script:Engel       = $true
$script:Uyarilar    = @()
$script:IsAktif     = $false      # bu panelden başlatılan iş sürüyor mu
$script:Gecen       = [TimeSpan]::Zero
$script:SonTik      = $null

$script:SonMesajlar = New-Object System.Collections.Generic.List[string]
function Yaz([string]$metin) {
    [Kayit]::Yaz($metin)
    $script:SonMesajlar.Add((Get-Date -Format 'HH:mm:ss') + '  ' + $metin); while ($script:SonMesajlar.Count -gt 40) { $script:SonMesajlar.RemoveAt(0) }
    $kutu.AppendText((Get-Date -Format 'HH:mm:ss') + '   ' + $metin + "`r`n")
    [System.Windows.Forms.Application]::DoEvents()
}

function Sure([double]$sn) {
    if ($sn -lt 0) { $sn = 0 }
    $ts = [TimeSpan]::FromSeconds([math]::Round($sn))
    return ('{0:00}:{1:00}:{2:00}' -f [math]::Floor($ts.TotalHours), $ts.Minutes, $ts.Seconds)
}

function Makro-AltProgramlari {
    $yol = [System.IO.Path]::Combine($EdingKlasor, 'macro.cnc')
    $isimler = @{}
    $script:MakroDurum = ''
    if (-not [System.IO.File]::Exists($yol)) { $script:MakroDurum = "macro.cnc bulunamadı: $yol"; return $isimler }
    try {
        # Eding dosyayı açık tutuyor olabilir: paylaşımlı okuma
        $fs = New-Object System.IO.FileStream($yol, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $sr = New-Object System.IO.StreamReader($fs)
        while ($null -ne ($s = $sr.ReadLine())) {
            $m = [regex]::Match($s, '^\s*sub\s+(\w+)', 'IgnoreCase')
            if ($m.Success) { $isimler[$m.Groups[1].Value.ToLower()] = $true }
        }
        $sr.Close()
        if ($isimler.Count -eq 0) { $script:MakroDurum = "macro.cnc okundu ama içinde alt program (sub) yok: $yol" }
    } catch { $script:MakroDurum = "macro.cnc okunamadı ($($_.Exception.Message)): $yol" }
    return $isimler
}

function Dosyayi-Kontrol-Et([string]$yol) {
    Yaz "Kontrol ediliyor ve süre hesaplanıyor, lütfen bekle..."
    $a = [NcAnaliz]::Oku($yol, 4000.0)
    $script:Analiz = $a

    $hatalar  = New-Object System.Collections.ArrayList
    $uyarilar = New-Object System.Collections.ArrayList
    foreach ($h in $a.Hatalar) { [void]$hatalar.Add($h) }
    if ($a.Satir -lt 10) { [void]$hatalar.Add('Dosya boş ya da çok kısa.') }
    if (-not $a.M30)     { [void]$hatalar.Add('Dosyanın sonunda M30 yok; dosya yarım kaydedilmiş olabilir.') }

    $kullanilan = @($a.Takimlar | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
    Yaz ("Satır: {0:N0}   |   Frezeler: {1}   |   Tahmini süre: {2}" -f $a.Satir, (($kullanilan | ForEach-Object { "T$_" }) -join ', '), (Sure $a.Toplam))
    foreach ($tk in $kullanilan) {
        if ($tk -gt 6) { [void]$hatalar.Add("T$tk kullanılıyor ama makinede sadece T1-T6 var.") }
        elseif ($AyarliTakimlar -notcontains $tk) { [void]$uyarilar.Add("T$tk konumu HENÜZ AYARLANMADI. Alırken kırılabilir.") }
    }
    $makro = Makro-AltProgramlari
    if ($makro.Count -eq 0) { [void]$uyarilar.Add("$($script:MakroDurum). Alt program kontrolü yapılamadı.") }
    else { foreach ($s in $a.AltProgramlar) { if (-not $makro.ContainsKey($s)) { [void]$hatalar.Add("Dosya '$s' alt programını çağırıyor ama macro.cnc'de yok.") } } }

    foreach ($h in ($hatalar | Select-Object -First 20)) { Yaz "  ✖  HATA: $h" }
    foreach ($w in $uyarilar) { Yaz "  !  UYARI: $w" }
    if ($hatalar.Count -eq 0 -and $uyarilar.Count -eq 0) { Yaz 'Dosyada sorun bulunmadı.' }

    $script:Engel    = ($hatalar.Count -gt 0)
    $script:SonHatalar = @($hatalar | Select-Object -First 5)
    $script:Uyarilar = @($uyarilar)
    $bar.Value = 0
    $bar.Caption = ''
    $bar.Dancing = $false
    $bar.Animal = if ($script:Tercih.Dansci -eq '1') { Get-Random -Minimum 0 -Maximum ([Hayvanlar]::Adlar.Length) } else { -1 }
    $sim.SetData($a)
    $simBuyuk.SetData($a)
    if ($bar.Animal -ge 0) { Yaz "Bu işin dansçısı: $([Hayvanlar]::Adlar[$bar.Animal])" }
    Dosya-Ozeti
}

function Hazir-Mi([string]$islem) {
    if ([Eding]::AcilKilit) { [Kayit]::Show("ACİL STOP basılı.`r`nKaldırmak için RESET'e (ya da ACİL STOP butonuna) bas.", $islem, 'OK', 'Warning') | Out-Null; return $false }
    if (-not (Baglan)) {
        [Kayit]::Show("Eding CNC'ye bağlanılamadı. Önce Eding CNC programını aç.", $islem, 'OK', 'Warning') | Out-Null
        return $false
    }
    if (Is-Suruyor-Uyari $islem) { return $false }
    if ([Eding]::CncGetEMStopActive() -ne 0) {
        # EXTERR / acil stop sinyali: makineden gelir (hava basıncı düşük, iş mili sürücüsü hatası, acil stop butonu)
        if (-not (Onay "Makine hata sinyali veriyor (EXTERR / acil stop).`r`n`r`nEn sık sebep: hava basıncı düşük (kompresör kapalı ya da basınç yetersiz).`r`nDiğerleri: iş mili sürücüsü hatası, acil stop butonu basılı.`r`n`r`nKompresörü ve basıncı kontrol ettiysen RESET yapılsın mı?" $islem)) { return $false }
        Yaz "$islem : RESET: $([Eding]::RCText([Eding]::CncReset()))"
        Start-Sleep -Milliseconds 1200
        if ([Eding]::CncGetEMStopActive() -ne 0) {
            [Kayit]::Show("RESET sonrası hata sinyali hâlâ var.`r`nKompresör basıncını, makinedeki acil stop butonunu ve iş mili sürücüsünü kontrol et.", $islem, 'OK', 'Warning') | Out-Null
            return $false
        }
    }
    if ([Eding]::CncGetAllAxesHomed() -eq 0) {
        [Kayit]::Show("Makine home alınmamış. Önce HOME butonuna bas.", $islem, 'OK', 'Warning') | Out-Null
        return $false
    }
    if (-not (Calisiyor-Mu)) { Hata-Temizle $islem }
    return $true
}

function Onay([string]$metin, [string]$baslik) {
    return ([Kayit]::Show($metin, $baslik, 'YesNo', 'Question') -eq 'Yes')
}

# ---------------- Butonlar ----------------
function Btn-DosyaSec {
    if ((Is-Suruyor)) { [Kayit]::Show('Kazıma sürerken yeni dosya seçilemez.', 'Dosya Seç', 'OK', 'Warning') | Out-Null; return }
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Filter = 'NC dosyaları (*.nc)|*.nc|Tüm dosyalar (*.*)|*.*'
    $dlg.Title  = 'Kazınacak .nc dosyasını seç'
    $sonuc = $dlg.ShowDialog($form)
    [Kayit]::Yaz("DOSYA SEÇİMİ: $sonuc  $($dlg.FileName)")
    if ($sonuc -ne 'OK') { return }

    $form.Cursor = 'WaitCursor'
    try {
        [void][System.IO.Directory]::CreateDirectory($IsKlasor)
        $ad    = [System.IO.Path]::GetFileName($dlg.FileName)
        $hedef = [System.IO.Path]::Combine($IsKlasor, $ad)
        if ($dlg.FileName -ne $hedef) { [System.IO.File]::Copy($dlg.FileName, $hedef, $true) }
        [System.IO.File]::Copy($hedef, [System.IO.Path]::Combine($IsKlasor, $AktifIsAdi), $true)
        $script:SeciliDosya = $hedef
        $lblDosya.Text = [System.IO.Path]::GetFileNameWithoutExtension($ad)
        $lblDosya.ForeColor = $cYazi
        Yaz "Kaydedildi: $hedef"
        Dosyayi-Kontrol-Et $hedef
    } catch {
        Yaz "HATA: $($_.Exception.Message)"
        [Kayit]::Show("Hata: $($_.Exception.Message)", 'Dosya Seç', 'OK', 'Error') | Out-Null
    } finally { $form.Cursor = 'Default' }
}

# ================= MANUEL FREZ DEĞİŞİMİ =================
# #4030 = 1 iken macro frezi magazinden almaz: iş mili değişim noktasına gelir, M0 ile bekler,
# panel operatöre ne yapacağını söyler, onayla devam ettirir (önce pens açılır, sonra kapanır, sonra ölçülür).
$script:ManuelSonSeq = ''
$script:ManuelStabil = 0
$script:ManuelSonPos = $null
$script:ManuelDiyalogAcik = $false

function Frez-Manuel-Mi { try { return ([Eding]::CncGetVariable(4030) -eq 1) } catch { return $false } }

function Frez-Modu-Yaz([bool]$manuel) {
    if (Is-Suruyor-Uyari 'Frez modu') { return $false }
    $v = if ($manuel) { 1 } else { 0 }
    $ok = Degisken-Yaz 4030 $v
    if ($ok) { Yaz "Frez değişimi: $(if ($manuel) { 'MANUEL (elle)' } else { 'OTOMATİK (magazin)' })" }
    Frez-Modu-Goster
    return $ok
}

function Frez-Modu-Goster {
    if ($script:Sade) { return }
    if (-not $script:ApiHazir -or -not $script:Bagli) { $lnkMod.Text = 'Frez: —'; return }
    $m = Frez-Manuel-Mi
    $lnkMod.Text = if ($m) { 'Frez: Manuel' } else { 'Frez: Otomatik' }
    $lnkMod.Vurgu = if ($m) { $cYesil } else { $cAltin }
}

function Frez-Modu-Sor {
    # BAŞLAT'ta: manuel mi otomatik mi? Seçilen döner ('MANUEL' / 'OTOMATIK') ya da $null (vazgeç)
    $simdi = Frez-Manuel-Mi
    $f = New-Object System.Windows.Forms.Form
    $f.Text = 'Frez değişimi'; $f.StartPosition = 'CenterParent'; $f.FormBorderStyle = 'FixedDialog'
    $f.MaximizeBox = $false; $f.MinimizeBox = $false; $f.BackColor = $cZemin; $f.ClientSize = New-Object System.Drawing.Size(560, 250)
    $l = New-Object System.Windows.Forms.Label
    $l.Text = "Bu işte frezeler nasıl değişsin?`r`nŞu anki ayar: $(if ($simdi) { 'MANUEL' } else { 'OTOMATİK' })"
    $l.ForeColor = $cYazi; $l.Font = New-Object System.Drawing.Font('Segoe UI', 13); $l.SetBounds(24, 18, 512, 60)
    $f.Controls.Add($l)
    $mk = {
        param($t, $alt, $x, $renk, $deger)
        $b = New-Object System.Windows.Forms.Button
        $b.Text = "$t`r`n$alt"; $b.FlatStyle = 'Flat'; $b.BackColor = $cPanel; $b.ForeColor = $renk
        $b.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 12)
        $b.FlatAppearance.BorderColor = $renk; $b.FlatAppearance.BorderSize = 2
        $b.SetBounds($x, 92, 246, 100)
        $b.Tag = $deger
        $b.Add_Click({ param($s2, $e2) $fm = $s2.FindForm(); $fm.Tag = $s2.Tag; [Kayit]::Yaz("TUŞ: Frez modu -> $($s2.Tag)"); $fm.Close() })
        $f.Controls.Add($b); return $b
    }
    $bo = & $mk 'OTOMATİK' '(magazinden alır / bırakır)' 24 $cAltinAc 'OTOMATIK'
    $bm = & $mk 'MANUEL' '(frezeleri ben takarım)' 290 $cYesil 'MANUEL'
    $iptal = New-Object System.Windows.Forms.Button
    $iptal.Text = 'Vazgeç'; $iptal.FlatStyle = 'Flat'; $iptal.ForeColor = $cSoluk; $iptal.BackColor = $cZemin
    $iptal.SetBounds(440, 204, 96, 30); $iptal.Add_Click({ param($s2, $e2) $s2.FindForm().Close() })
    $f.Controls.Add($iptal)
    $f.AcceptButton = if ($simdi) { $bm } else { $bo }
    $f.Add_Shown({ param($s2, $e2) $s2.Activate(); $s2.AcceptButton.Focus() })
    [void]$f.ShowDialog($form)
    if ($f.Tag) { return [string]$f.Tag } else { return $null }
}

# Manuel mod sadece yeni macro.cnc Eding'e YÜKLÜYSE çalışır. Eski macro yüklüyse makine frezi magazinden almaya kalkar.
function Manuel-Macro-Kontrol {
    $yol = [System.IO.Path]::Combine($EdingKlasor, 'macro.cnc')
    $metin = ''
    try {
        $fs = New-Object System.IO.FileStream($yol, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $sr = New-Object System.IO.StreamReader($fs); $metin = $sr.ReadToEnd(); $sr.Close()
    } catch { }
    if ($metin -notmatch '(?im)^\s*sub\s+manual_change\b' -or $metin -notmatch '(?im)^\s*sub\s+pm_surum\b') {
        [Kayit]::Yaz("MANUEL: $yol manuel değişimi desteklemiyor (eski macro)")
        [Kayit]::Show("Manuel frez değişimi için yeni macro.cnc gerekli, ama şu dosya eski:`r`n$yol`r`n`r`n1. Eding'i kapat`r`n2. Paketteki macro.cnc'yi bu klasöre kopyala (eskisini yedekle)`r`n3. Paneli yeniden aç`r`n`r`nİş başlatılmadı.", 'Manuel frez', 'OK', 'Warning') | Out-Null
        return $false
    }
    # Dosya yeni; Eding de yeni macro'yu mu kullanıyor? (macro Eding açılırken okunur). K6: sürüm tam olarak beklenen olmalı.
    $surum = Makro-Surum-Oku
    $yuklu = ($surum -eq $BeklenenMakroSurum)
    if (-not $yuklu) {
        [Kayit]::Yaz("MANUEL: Eding'deki makro sürümü $surum, beklenen $BeklenenMakroSurum")
        Hata-Temizle 'Manuel kontrol'
        if (Onay "Eding'de yüklü makro sürümü $surum, panelin beklediği $BeklenenMakroSurum (Eding macro'yu sadece açılırken okur).`r`nBu haliyle makine frezi magazinden almaya çalışabilir.`r`n`r`nEding şimdi yeniden başlatılsın mı? (Sonra home alır; işi yeniden BAŞLAT ile başlatırsın.)" 'Manuel frez') { Eding-Yeniden }
        return $false
    }
    return $true
}

# ================= MAKRO SÜRÜMÜ VE #4039 BAYRAĞI (K6) =================
# macro.cnc 'sub pm_surum' -> #4038 = 4. Makroda değişiklik yapılırsa ikisi birlikte güncellenir.
$BeklenenMakroSurum = 4
$script:MakroKontrolTamam = $false   # bu Eding bağlantısında sürüm kontrolü ve bayrak sıfırlama yapıldı mı
$script:MakroSurumUyumsuz = $false
$script:MakroKontrolSon = [datetime]::MinValue
$script:MakroYamaBekliyor = $false   # orijinal makroya yama yapıldı ama Eding henüz yeniden açılmadı
function Makro-Surum-Oku {
    # Eding'e YÜKLÜ makronun sürümü (dosyanın değil). Okunamazsa -1.
    try {
        if (-not (Rc-Tamam ([Eding]::CncRunSingleLine('#4038=0')))) { return -1 }
        if (-not (Hareket-Bitene-Kadar-Bekle 5)) { return -1 }
        if ([Eding]::CncGetVariable(4038) -ne 0) { return -1 }
        $rc = [Eding]::CncRunSingleLine('gosub pm_surum')
        if (-not (Rc-Tamam $rc)) { Hata-Temizle 'Makro sürümü'; return 0 }   # pm_surum yok: eski makro
        if (-not (Hareket-Bitene-Kadar-Bekle 5)) { return -1 }
        return [int][Eding]::CncGetVariable(4038)
    } catch { return -1 }
}
function Bayrak-Sifirla([string]$islem) {
    # MC-04/GV-04: hareketsiz takım bildirimi bayrağı kalıcıdır; 1 kalırsa sonraki işin M6'sı frez almadan/ölçmeden geçer.
    $nr = if ($script:OzelMakro) { 4039 } else { 4900 }
    $rc = [Eding]::CncRunSingleLine("#$nr=0")
    if (Rc-Tamam $rc) { [void](Hareket-Bitene-Kadar-Bekle 3) }
    $v = [double]::NaN; try { $v = [Eding]::CncGetVariable($nr) } catch { }
    if (-not (Rc-Tamam $rc) -or $v -ne 0) {
        [Kayit]::Yaz("BAYRAK: #$nr sıfırlanamadı ($islem): rc $rc, okunan $v")
        return $false
    }
    [Kayit]::Yaz("BAYRAK: #$nr = 0 ($islem)")
    return $true
}
function Makro-Baslangic-Kontrol {
    # Bağlantı kurulunca bir kez (ana zamanlayıcıdan): #4039/#4900 sıfırlanır, PrimerMill makrosunun Eding'deki sürümü denetlenir
    if ($script:MakroKontrolTamam -or [Eding]::AcilKilit) { return }
    if (((Get-Date) - $script:MakroKontrolSon).TotalSeconds -lt 30) { return }   # okunamadıysa 30 sn'de bir dene
    $script:MakroKontrolSon = Get-Date
    $script:MakroKontrolTamam = $true
    if (-not (Bayrak-Sifirla 'açılış')) { Yaz 'Açılış: takım bildirim bayrağı (#4039) sıfırlanamadı; iş başlatılırken yeniden denenecek.' }
    if (-not $script:OzelMakro) { return }
    $s = Makro-Surum-Oku
    if ($s -eq -1) { $script:MakroKontrolTamam = $false; return }   # okunamadı: sonra tekrar
    $script:MakroSurumUyumsuz = ($s -ne $BeklenenMakroSurum)
    if ($script:MakroSurumUyumsuz) {
        Yaz "UYARI: Eding'de yüklü makro sürümü $s, panelin beklediği $BeklenenMakroSurum. Eding yeniden başlatılmalı."
        [Kayit]::Show("Eding'de yüklü macro.cnc sürümü $s, panelin beklediği $BeklenenMakroSurum.`r`n`r`nmacro.cnc güncellendiyse Eding'i yeniden başlat (Ayarlar › PANEL › Eding'i yeniden başlat).`r`nO zamana kadar iş başlatılamaz.", 'Makro sürümü', 'OK', 'Warning') | Out-Null
    } else { [Kayit]::Yaz("MAKRO: Eding'deki sürüm $s (beklenen)") }
}
function Makro-Hazir-Mi([string]$islem) {
    # BAŞLAT / takım bildirimi öncesi: PrimerMill makrosu Eding'de beklenen sürümde mi (uyumsuzsa yeniden okunur)
    if (-not $script:OzelMakro) { return $true }
    if ($script:MakroKontrolTamam -and -not $script:MakroSurumUyumsuz) { return $true }
    $s = Makro-Surum-Oku
    $script:MakroSurumUyumsuz = ($s -ne $BeklenenMakroSurum); $script:MakroKontrolTamam = $true
    if (-not $script:MakroSurumUyumsuz) { return $true }
    [Kayit]::Yaz("MAKRO: $islem reddedildi, Eding'deki sürüm $s (beklenen $BeklenenMakroSurum)")
    if (Onay "Eding'de yüklü macro.cnc sürümü $(if ($s -lt 0) { 'okunamadı' } else { $s }), panelin beklediği $BeklenenMakroSurum.`r`n$islem yapılmadı.`r`n`r`nEding şimdi yeniden başlatılsın mı? (macro.cnc yeniden okunur; sonra HOME gerekir)" $islem) { Eding-Yeniden }
    return $false
}
function Takim-Bildir([int]$n, [string]$islem) {
    # Eding'e iş milindeki frezi HAREKETSİZ bildirir: #4039 = 1 (orijinal makroda #4900) -> M6 Tn -> #4039 = 0.
    # Her adım denetlenir; bir şey ters giderse $false (çağıran durmalı).
    $bayrak = if ($script:OzelMakro) { 4039 } else { 4900 }
    if ($script:OzelMakro) {
        $s = Makro-Surum-Oku
        if ($s -ne $BeklenenMakroSurum) {
            [Kayit]::Show("Eding'de yüklü macro.cnc sürümü $(if ($s -lt 0) { 'okunamadı' } else { $s }), beklenen $BeklenenMakroSurum.`r`nBu haliyle M6 T$n gerçek takım değişimi yapabilir; frez Eding'e bildirilmedi.`r`n`r`nEding'i yeniden başlat (Ayarlar › PANEL), sonra tekrar dene. $islem yapılmadı.", $islem, 'OK', 'Warning') | Out-Null
            return $false
        }
    } else {
        $yamali = $false
        try { $yamali = ([System.IO.File]::ReadAllText([System.IO.Path]::Combine($EdingKlasor, 'macro.cnc')) -match '(?im)^\s*sub\s+pm_pens_t0\b') } catch { }
        if (-not $yamali -or $script:MakroYamaBekliyor) {
            [Kayit]::Show("Orijinal macro.cnc'nin hareketsiz takım bildirimi eki Eding'e yüklü değil (Eding yeniden başlatılmalı).`r`nBu haliyle M6 T$n gerçek takım değişimi yapar. $islem yapılmadı.", $islem, 'OK', 'Warning') | Out-Null
            return $false
        }
    }
    Yaz "$islem : Eding'e iş milindeki frez T$n bildiriliyor (hareket yok)."
    $hata = ''
    $rc = [Eding]::CncRunSingleLine("#$bayrak=1")
    if (-not (Rc-Tamam $rc)) { $hata = "#$bayrak=1 gönderilemedi ($([Eding]::RCText($rc)))" }
    elseif (-not (Hareket-Bitene-Kadar-Bekle 5)) { $hata = "#$bayrak=1 sonrası Eding hazır olmadı" }
    elseif ([Eding]::CncGetVariable($bayrak) -ne 1) { $hata = "#$bayrak geri okunduğunda 1 değil ($([Eding]::CncGetVariable($bayrak)))" }
    if ($hata) {
        [void](Bayrak-Sifirla $islem)
        [Kayit]::Yaz("TAKIM BİLDİR: $hata")
        [Kayit]::Show("Frez Eding'e bildirilemedi: $hata.`r`nM6 gönderilmedi. $islem yapılmadı.", $islem, 'OK', 'Warning') | Out-Null
        return $false
    }
    $rc = [Eding]::CncRunSingleLine("M6 T$n")
    $bitti = $false
    if (Rc-Tamam $rc) { $bitti = Hareket-Bitene-Kadar-Bekle 20 } else { $hata = "M6 T$n gönderilemedi ($([Eding]::RCText($rc)))" }
    $sifir = Bayrak-Sifirla $islem
    $tk = -1; try { $tk = [Eding]::CncGetCurrentToolNumber() } catch { }
    if (-not $hata -and -not $bitti) { $hata = "M6 T$n bitmedi ya da Eding hata verdi" }
    if (-not $hata -and $tk -ne $n) { $hata = "Eding'deki takım T$tk (beklenen T$n)" }
    if (-not $hata -and -not $sifir) { $hata = "#$bayrak tekrar 0 yapılamadı" }
    if ($hata) {
        [Kayit]::Yaz("TAKIM BİLDİR: $hata")
        [Kayit]::Show("Frez Eding'e bildirilemedi: $hata.`r`nEding eski macro ile açık olabilir: Eding'i yeniden başlat. $islem yapılmadı.", $islem, 'OK', 'Warning') | Out-Null
        return $false
    }
    [Kayit]::Yaz("TAKIM BİLDİR: Eding'deki takım T$n")
    return $true
}

function Manuel-Istek {
    # Bekleyen operatör isteği: @{ Faz = 1 (pens açılacak) | 2 (tak, pens kapanacak) | 3 (hava bekleniyor); T; Eski; Seq } ya da $null
    # #4034 iş başlarken ve RESET'te sıfırlanır, bu yüzden 1000+ değer hep o anki işe aittir.
    $faz = [int][Eding]::CncGetVariable(4034)
    if ($faz -lt 1000) { return $null }
    return @{ Faz = [int][math]::Floor($faz / 1000); T = $faz % 1000; Eski = [int][Eding]::CncGetVariable(4036); Seq = [Eding]::CncGetVariable(4037) }
}

# Değişken okunamazsa / panel isteği kaçırırsa: Eding duraklamış + manuel mod + iş mili değişim noktasında ise
# istenen frezi Eding'in kendi takım değişkenlerinden çıkar (#5011 yeni, #5008 eski; pens çıkışı açıksa 2. adım)
function Manuel-Istek-Tahmin {
    if (-not (Frez-Manuel-Mi)) { return $null }
    $p = [Eding]::MachinePos()
    $dx = [Eding]::CncGetVariable(4031); $dy = [Eding]::CncGetVariable(4032)
    if ([math]::Abs($p.X - $dx) -gt 0.05 -or [math]::Abs($p.Y - $dy) -gt 0.05) { return $null }
    $pensAcik = $false; try { $pensAcik = ([Eding]::CncGetOutput(9) -ne 0) } catch { }
    return @{ Faz = $(if ($pensAcik) { 2 } else { 1 }); T = [int][Eding]::CncGetVariable(5011); Eski = [int][Eding]::CncGetVariable(5008); Seq = -2 }
}

function Manuel-Devam {
    $son = (Get-Date).AddSeconds(8)
    do {
        $rc = [Eding]::CncRunOrResumeJob()
        if (Rc-Tamam $rc) { [Kayit]::Yaz("MANUEL: devam -> $([Eding]::RCText($rc))"); return $true }
        [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $son)
    [void](Komut-Sonucu 'Manuel frez: devam' $rc)
    return $false
}

function Manuel-Diyalog($ist) {
    $script:ManuelDiyalogAcik = $true
    try {
        $eski = $ist.Eski; $yeni = $ist.T
        if ($ist.Faz -eq 4) {
            $baslik = "T$yeni HAZIR  ·  SON ONAY"
            $metin = "T$yeni takıldı ve sensörde ölçüldü.`r`n`r`n1.  Elini makineden çek, kapağı kapat.`r`n2.  KAZIMAYI BAŞLAT'a bas."
            $tamam = 'KAZIMAYI BAŞLAT'
        } elseif ($ist.Faz -eq 1) {
            $baslik = "FREZ DEĞİŞİMİ   T$eski  →  T$yeni"
            $metin = if ($eski -gt 0) { "1.  İş milindeki T$eski frezini parmaklarınla tut.`r`n2.  PENS'İ AÇ'a bas: pens havayla açılır, frezi çıkar.`r`n`r`nSonra takılacak frez:  T$yeni" } else { "1.  T$yeni frezini eline al.`r`n2.  PENS'İ AÇ'a bas: pens havayla açılır.`r`n`r`nKompresör açık olmalı." }
            $tamam = "PENS'İ AÇ"
        } else {
            $baslik = if ($yeni -gt 0) { "T$yeni FREZİNİ TAK" } else { "FREZİ ÇIKAR" }
            $metin = if ($yeni -gt 0) { "1.  Eski frezi çıkar (varsa).`r`n2.  T$yeni frezini sonuna kadar it ve tut.`r`n3.  TAKTIM'a bas: pens kapanır, makine frezi sensörde ölçer ve kazımaya devam eder." } else { "1.  Frezi çıkar.`r`n2.  ÇIKARDIM'a bas: pens kapanır." }
            $tamam = if ($yeni -gt 0) { "TAKTIM  ·  PENS'İ KAPAT" } else { "ÇIKARDIM  ·  PENS'İ KAPAT" }
        }
        [Kayit]::Yaz("MANUEL: istek faz $($ist.Faz)  T$eski -> T$yeni")
        [System.Media.SystemSounds]::Exclamation.Play()
        $f = New-Object System.Windows.Forms.Form
        $f.Text = 'Manuel frez değişimi'; $f.StartPosition = 'CenterScreen'; $f.FormBorderStyle = 'FixedDialog'; $f.TopMost = $true
        $f.MaximizeBox = $false; $f.MinimizeBox = $false; $f.ControlBox = $false
        $f.BackColor = $cZemin; $f.ClientSize = New-Object System.Drawing.Size(640, 340)
        $lb = New-Object System.Windows.Forms.Label
        $lb.Text = $baslik; $lb.ForeColor = $cAltinAc; $lb.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 20)
        $lb.SetBounds(24, 16, 592, 44); $f.Controls.Add($lb)
        $lm = New-Object System.Windows.Forms.Label
        $lm.Text = $metin; $lm.ForeColor = $cYazi; $lm.Font = New-Object System.Drawing.Font('Segoe UI', 13)
        $lm.SetBounds(24, 70, 592, 150); $f.Controls.Add($lm)
        $sonuc = @{ V = '' }
        $bt = New-Object System.Windows.Forms.Button
        $bt.Text = $tamam; $bt.FlatStyle = 'Flat'; $bt.BackColor = $cPanel; $bt.ForeColor = $cYesil
        $bt.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 14); $bt.FlatAppearance.BorderColor = $cYesil; $bt.FlatAppearance.BorderSize = 2
        $bt.SetBounds(24, 236, 392, 80); $bt.Add_Click({ $sonuc.V = 'tamam'; $f.Close() }.GetNewClosure()); $f.Controls.Add($bt)
        $bd = New-Object System.Windows.Forms.Button
        $bd.Text = if ($ist.Faz -eq 2) { "İşi durdur`r`n(pens AÇIK kalır)" } else { 'İşi durdur' }
        $bd.FlatStyle = 'Flat'; $bd.BackColor = $cZemin; $bd.ForeColor = $cKirmizi; $bd.FlatAppearance.BorderColor = $cKirmizi
        $bd.SetBounds(432, 236, 184, 80); $bd.Add_Click({ $sonuc.V = 'durdur'; $f.Close() }.GetNewClosure()); $f.Controls.Add($bd)
        $f.KeyPreview = $true
        $f.Add_KeyDown({ param($s, $e) if ($e.KeyCode -eq 'Escape') { $e.Handled = $true; $sonuc.V = 'acil'; $f.Close() } }.GetNewClosure())
        $f.Add_Shown({ $f.Activate() })
        [void]$f.ShowDialog($form)
        [Kayit]::Yaz("MANUEL: operatör -> $($sonuc.V)")
        if ($sonuc.V -eq 'acil') { Acil-Stop 'Esc (manuel frez)'; return }
        if ($sonuc.V -eq 'durdur') {
            if (Onay 'İş durdurulsun mu?' 'Manuel frez') { Btn-Durdur; return }
            $script:ManuelSonSeq = ''; return   # tekrar sorulsun
        }
        if ($sonuc.V -eq 'tamam') { [void](Manuel-Devam) }
    } finally { $script:ManuelDiyalogAcik = $false; $script:ManuelSusTo = (Get-Date).AddSeconds(4); $script:ManuelStabil = 0 }
}

$script:ManuelSonIz = ''
$script:ManuelSusTo = Get-Date
function Manuel-Izle {
    if ($script:ManuelDiyalogAcik -or -not $script:ApiHazir -or -not $script:Bagli -or [Eding]::AcilKilit) { return }
    if ((Get-Date) -lt $script:ManuelSusTo) { return }   # onaydan hemen sonra pencere tekrar açılmasın
    try {
        $d = Eding-Durum
        $ist = Manuel-Istek
        # Teşhis kaydı: değiştikçe yaz
        $iz = "faz=$([Eding]::CncGetVariable(4034)) seq=$([Eding]::CncGetVariable(4037)) durum=$d mod=$([Eding]::CncGetVariable(4030)) T$([Eding]::CncGetVariable(5008))->T$([Eding]::CncGetVariable(5011))"
        if ($iz -ne $script:ManuelSonIz -and ((Frez-Manuel-Mi) -or $ist)) { [Kayit]::Yaz("MANUEL-İZ: $iz"); $script:ManuelSonIz = $iz }
        $p = [Eding]::MachinePos()
        $ayni = ($script:ManuelSonPos -and [math]::Abs($p.X - $script:ManuelSonPos.X) -lt 0.001 -and [math]::Abs($p.Y - $script:ManuelSonPos.Y) -lt 0.001 -and [math]::Abs($p.Z - $script:ManuelSonPos.Z) -lt 0.001)
        $script:ManuelSonPos = $p
        if ($ayni) { $script:ManuelStabil++ } else { $script:ManuelStabil = 0 }
        $durakli = ($d -like 'PAUSE*') -or ([Eding]::CncGetPauseStatus() -ne 0)
        if ($null -eq $ist) {
            # Yedek yol: macro değişkeni görünmüyorsa ama Eding değişim noktasında bekliyorsa
            if (($durakli -or $script:ManuelStabil -ge 6) -and ((Mesgul $d) -or $durakli)) {
                $t = Manuel-Istek-Tahmin
                if ($t -and $script:ManuelSonSeq -ne "tahmin$($t.Faz)-$($t.T)") {
                    [Kayit]::Yaz("MANUEL: istek değişkenden okunamadı, Eding takım bilgisinden çıkarıldı: faz $($t.Faz) T$($t.Eski)->T$($t.T)")
                    $script:ManuelSonSeq = "tahmin$($t.Faz)-$($t.T)"; $script:ManuelStabil = 0
                    Manuel-Diyalog $t
                }
            }
            return
        }
        if ($ist.Faz -eq 3) { return }   # hava bekleniyor: durum satırında yazılıyor
        if ("$($ist.Seq)" -eq "$script:ManuelSonSeq") { return }
        if ($durakli -or $script:ManuelStabil -ge 4) {
            $script:ManuelSonSeq = "$($ist.Seq)"
            $script:ManuelStabil = 0
            Manuel-Diyalog $ist
        }
    } catch { [Kayit]::Yaz("MANUEL-İZ hata: $($_.Exception.Message)") }
}

# ================= YENİ BLOK NUMARASI =================
# Yeni takılan bloğun üst yüzüne, kenara yakın bir yay üzerine numara / isim kazınır (işten önce, aynı programın başında).
# Tek çizgili yazı tipi: 4 x 6 birimlik ızgara, her harf bir ya da birkaç çizgi.
$BlokFont = @{
    '0' = @(,@(@(1,0),@(3,0),@(4,1),@(4,5),@(3,6),@(1,6),@(0,5),@(0,1),@(1,0)))
    '1' = @(@(@(1,5),@(2,6),@(2,0)), @(@(1,0),@(3,0)))
    '2' = @(,@(@(0,5),@(1,6),@(3,6),@(4,5),@(4,4),@(0,0),@(4,0)))
    '3' = @(,@(@(0,6),@(4,6),@(2,3.5),@(3,3.5),@(4,2.5),@(4,1),@(3,0),@(1,0),@(0,1)))
    '4' = @(,@(@(3,0),@(3,6),@(0,2),@(4,2)))
    '5' = @(,@(@(4,6),@(0,6),@(0,3.5),@(3,3.5),@(4,2.5),@(4,1),@(3,0),@(0,0)))
    '6' = @(,@(@(4,6),@(1,6),@(0,5),@(0,1),@(1,0),@(3,0),@(4,1),@(4,2.5),@(3,3.5),@(0,3.5)))
    '7' = @(,@(@(0,6),@(4,6),@(1.5,0)))
    '8' = @(,@(@(1,3.5),@(0,4.5),@(0,5),@(1,6),@(3,6),@(4,5),@(4,4.5),@(3,3.5),@(1,3.5),@(0,2.5),@(0,1),@(1,0),@(3,0),@(4,1),@(4,2.5),@(3,3.5)))
    '9' = @(,@(@(4,3),@(1,3),@(0,4),@(0,5),@(1,6),@(3,6),@(4,5),@(4,1),@(3,0),@(0,0)))
    'A' = @(@(@(0,0),@(0,4),@(2,6),@(4,4),@(4,0)), @(@(0,2.5),@(4,2.5)))
    'B' = @(@(@(0,0),@(0,6),@(3,6),@(4,5),@(4,4),@(3,3),@(0,3)), @(@(3,3),@(4,2),@(4,1),@(3,0),@(0,0)))
    'C' = @(,@(@(4,5),@(3,6),@(1,6),@(0,5),@(0,1),@(1,0),@(3,0),@(4,1)))
    'D' = @(,@(@(0,0),@(0,6),@(2.5,6),@(4,4.5),@(4,1.5),@(2.5,0),@(0,0)))
    'E' = @(@(@(4,6),@(0,6),@(0,0),@(4,0)), @(@(0,3),@(3,3)))
    'F' = @(@(@(4,6),@(0,6),@(0,0)), @(@(0,3),@(3,3)))
    'G' = @(,@(@(4,5),@(3,6),@(1,6),@(0,5),@(0,1),@(1,0),@(3,0),@(4,1),@(4,3),@(2,3)))
    'H' = @(@(@(0,0),@(0,6)), @(@(4,0),@(4,6)), @(@(0,3),@(4,3)))
    'I' = @(@(@(1,6),@(3,6)), @(@(2,6),@(2,0)), @(@(1,0),@(3,0)))
    'J' = @(,@(@(4,6),@(4,1),@(3,0),@(1,0),@(0,1)))
    'K' = @(@(@(0,0),@(0,6)), @(@(4,6),@(0,2.5)), @(@(1.5,3.5),@(4,0)))
    'L' = @(,@(@(0,6),@(0,0),@(4,0)))
    'M' = @(,@(@(0,0),@(0,6),@(2,3),@(4,6),@(4,0)))
    'N' = @(,@(@(0,0),@(0,6),@(4,0),@(4,6)))
    'O' = @(,@(@(1,0),@(3,0),@(4,1),@(4,5),@(3,6),@(1,6),@(0,5),@(0,1),@(1,0)))
    'P' = @(,@(@(0,0),@(0,6),@(3,6),@(4,5),@(4,4),@(3,3),@(0,3)))
    'Q' = @(@(@(1,0),@(3,0),@(4,1),@(4,5),@(3,6),@(1,6),@(0,5),@(0,1),@(1,0)), @(@(2.5,1.5),@(4,0)))
    'R' = @(@(@(0,0),@(0,6),@(3,6),@(4,5),@(4,4),@(3,3),@(0,3)), @(@(2,3),@(4,0)))
    'S' = @(,@(@(4,5),@(3,6),@(1,6),@(0,5),@(0,4),@(1,3),@(3,3),@(4,2),@(4,1),@(3,0),@(1,0),@(0,1)))
    'T' = @(@(@(0,6),@(4,6)), @(@(2,6),@(2,0)))
    'U' = @(,@(@(0,6),@(0,1),@(1,0),@(3,0),@(4,1),@(4,6)))
    'V' = @(,@(@(0,6),@(2,0),@(4,6)))
    'W' = @(,@(@(0,6),@(1,0),@(2,3),@(3,0),@(4,6)))
    'X' = @(@(@(0,0),@(4,6)), @(@(0,6),@(4,0)))
    'Y' = @(@(@(0,6),@(2,3),@(4,6)), @(@(2,3),@(2,0)))
    'Z' = @(,@(@(0,6),@(4,6),@(0,0),@(4,0)))
    '-' = @(,@(@(1,3),@(3,3)))
    '.' = @(,@(@(2,0),@(2,0.4)))
    '/' = @(,@(@(0,0),@(4,6)))
}
$BlokKonumAci = @{ '12' = -90.0; '3' = 0.0; '6' = 90.0; '9' = 180.0 }

function Blok-Metin-Temizle([string]$t) {
    $t = $t.ToUpper([System.Globalization.CultureInfo]::GetCultureInfo('tr-TR'))
    $t = $t.Replace('Ç', 'C').Replace('Ğ', 'G').Replace('İ', 'I').Replace('I', 'I').Replace('Ö', 'O').Replace('Ş', 'S').Replace('Ü', 'U')
    $c = ($t.ToCharArray() | Where-Object { $BlokFont.ContainsKey([string]$_) -or $_ -eq ' ' }) -join ''
    return $c.Trim()
}

$BlokDalma = 40; $BlokIlerleme = 200   # mm/dk: yavaş dalma, sakin ilerleme (temiz, hassas yazı)
function Blok-Kazima-NC([string]$metin, [double]$T, [int]$takim, [double]$yuk, [string]$konum, [double]$derin = 0.2, [bool]$refCizgi = $true) {
    # Kenara yakın yay: yazı tabanı r = 41.5 mm, yükseklik $yuk (dışa doğru). Saat 12'de önden okunur.
    $ci = [System.Globalization.CultureInfo]::InvariantCulture
    $f = { param($v) ([double]$v).ToString('0.###', $ci) }
    $s = $yuk / 6.0; $adimHarf = 6 * $s; $r0 = 41.5
    $uzun = $metin.Length * $adimHarf - 2 * $s
    $phi0 = $BlokKonumAci[$konum] * [math]::PI / 180
    $yuz = $T / 2; $zKes = $yuz - $derin; $zGuv = $yuz + 3
    $L = New-Object System.Collections.Generic.List[string]
    $L.Add("(PrimerMill blok numarasi: $metin)")
    $L.Add('G0 G17 G40 G49 G54 G80 G90')
    $L.Add('M5')
    $L.Add('GOSUB Z_SAFE')
    $L.Add('GOSUB AZXY_SAFE')
    $L.Add('G0 B0.0')
    $L.Add("T$takim M6")
    $L.Add('S24000 M3')
    $L.Add('GOSUB Z_SAFE')
    $L.Add('G0 A0.0')
    $L.Add('GOSUB AZXY_SAFE')
    $L.Add('G00 G90 B0.0 A0.0')
    $script:BlokIlkHareket = $true
    for ($i = 0; $i -lt $metin.Length; $i++) {
        $ch = [string]$metin[$i]
        if (-not $BlokFont.ContainsKey($ch)) { continue }
        foreach ($cizgi in $BlokFont[$ch]) {
            $ilk = $true
            # Hassas kazıma: her çizgi 0.25 mm'lik parçalara bölünür, yay eğrisini tam takip eder
            $noktalar = New-Object System.Collections.Generic.List[double[]]
            $onceki = $null
            foreach ($nk in $cizgi) {
                $u1 = -$uzun / 2 + $i * $adimHarf + $nk[0] * $s; $v1 = $nk[1] * $s
                if ($onceki) {
                    $n = [math]::Max(1, [int][math]::Ceiling([math]::Sqrt(($u1 - $onceki[0]) * ($u1 - $onceki[0]) + ($v1 - $onceki[1]) * ($v1 - $onceki[1])) / 0.25))
                    for ($q = 1; $q -le $n; $q++) { $noktalar.Add([double[]]@(($onceki[0] + ($u1 - $onceki[0]) * $q / $n), ($onceki[1] + ($v1 - $onceki[1]) * $q / $n))) }
                } else { $noktalar.Add([double[]]@($u1, $v1)) }
                $onceki = [double[]]@($u1, $v1)
            }
            foreach ($nk in $noktalar) {
                $u = $nk[0]      # yay boyunca
                $v = $nk[1]      # dışa doğru
                # Makinede ilk deneme ayna görüntüsü çıktı: yazı yay boyunca ters yönde ilerletilir
                if ($konum -eq '6') {
                    # Saat 6 (ön): yazının üstü merkeze bakar
                    $phi = $phi0 + $u / ($r0 + $yuk); $rr = $r0 + $yuk - $v
                } else {
                    # Diğer yerlerde yazının üstü diskin dışına bakar
                    $phi = $phi0 - $u / $r0; $rr = $r0 + $v
                }
                $x = $rr * [math]::Cos($phi); $y = $rr * [math]::Sin($phi)
                if ($ilk) {
                    if ($script:BlokIlkHareket) { $L.Add("G0 X$(& $f $x) Y$(& $f $y)"); $script:BlokIlkHareket = $false }
                    $L.Add("G0 X$(& $f $x) Y$(& $f $y) Z$(& $f $zGuv)")
                    $L.Add("G1 Z$(& $f $zKes) F$BlokDalma")
                    $ilk = $false
                } else { $L.Add("G1 X$(& $f $x) Y$(& $f $y) F$BlokIlerleme") }
            }
            $L.Add("G0 Z$(& $f ($yuz + 1))")
        }
    }
    if ($refCizgi) {
        # Referans çizgisi: yazının ortasından diskin KENARINA doğru radyal çizgi (r 45.5 → 48.7).
        # Tutucudaki çizgiyle (holder) hizalamak için blok sınırına kadar uzanır. İç ucunda 3 mm'lik kısa dik çizgi.
        $L.Add('(referans cizgisi - kenara kadar)')
        $c = [math]::Cos($phi0); $sn = [math]::Sin($phi0)
        $ri = [math]::Max(45.5, $r0 + $yuk + 1.0); $ro = 48.7
        $L.Add("G0 X$(& $f ($ri * $c)) Y$(& $f ($ri * $sn)) Z$(& $f $zGuv)")
        $L.Add("G1 Z$(& $f $zKes) F$BlokDalma")
        $L.Add("G1 X$(& $f ($ro * $c)) Y$(& $f ($ro * $sn)) F$BlokIlerleme")
        $L.Add("G0 Z$(& $f ($yuz + 1))")
        $tx = -$sn; $ty = $c
        $L.Add("G0 X$(& $f ($ri * $c - 1.5 * $tx)) Y$(& $f ($ri * $sn - 1.5 * $ty))")
        $L.Add("G1 Z$(& $f $zKes) F$BlokDalma")
        $L.Add("G1 X$(& $f ($ri * $c + 1.5 * $tx)) Y$(& $f ($ri * $sn + 1.5 * $ty)) F$BlokIlerleme")
        $L.Add("G0 Z$(& $f ($yuz + 1))")
    }
    $L.Add("G0 Z$(& $f $zGuv)")
    $L.Add('M5')
    $L.Add('GOSUB Z_SAFE')
    $L.Add('(blok numarasi bitti)')
    return $L
}

$BlokKayit = [System.IO.Path]::Combine($ScriptKlasor, 'bloklar.csv')
function Blok-Sonraki-No {
    $son = 0
    try {
        if ([System.IO.File]::Exists($BlokKayit)) {
            foreach ($l in [System.IO.File]::ReadAllLines($BlokKayit)) { $p = $l.Split(';'); if ($p.Count -gt 1) { $n = 0; if ([int]::TryParse($p[1], [ref]$n) -and $n -gt $son) { $son = $n } } }
        }
    } catch { }
    return ($son + 1)
}

function Blok-Sor {
    # Döner: $null (vazgeç) · 'eski' · @{ Metin; T; Takim; Cap; Yuk; Konum }
    $f = New-Object System.Windows.Forms.Form
    $f.Text = 'Blok'; $f.StartPosition = 'CenterScreen'; $f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false
    $f.TopMost = $true; $f.ShowInTaskbar = $false; $f.KeyPreview = $true
    $f.BackColor = $cZemin; $f.ForeColor = $cYazi; $f.Font = New-Object System.Drawing.Font('Segoe UI', 10.5)
    $f.ClientSize = New-Object System.Drawing.Size(600, 396)
    $et = { param($t, $x, $y, $w) $l = New-Object System.Windows.Forms.Label; $l.Text = $t; $l.ForeColor = $cSoluk; $l.SetBounds($x, $y + 4, $w, 24); $f.Controls.Add($l); $l }
    $kt = { param($t, $x, $y, $w) $b = New-Object System.Windows.Forms.TextBox; $b.Text = $t; $b.BackColor = $cPanel; $b.ForeColor = $cYazi; $b.BorderStyle = 'FixedSingle'; $b.Font = New-Object System.Drawing.Font('Consolas', 12); $b.SetBounds($x, $y, $w, 28); $f.Controls.Add($b); $b }
    $lb = New-Object System.Windows.Forms.Label
    $lb.Text = 'Takılı blok yeni mi?'; $lb.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 15); $lb.ForeColor = $cAltinAc; $lb.SetBounds(24, 14, 552, 34); $f.Controls.Add($lb)
    $la = New-Object System.Windows.Forms.Label
    $la.Text = "Yeni blokta önce numarası kazınır (üst yüz, kenara yakın, ~0.2 mm), sonra iş başlar."; $la.ForeColor = $cSoluk; $la.SetBounds(24, 50, 552, 24); $f.Controls.Add($la)
    [void](& $et 'Numara / isim' 24 92 150)
    $tNo = & $kt "$(Blok-Sonraki-No)" 180 92 160
    $tNo.MaxLength = 10
    [void](& $et 'Disk kalınlığı (mm)' 24 132 150)
    $tT = & $kt $(if ($script:Tercih.KalT) { $script:Tercih.KalT } else { '18.00' }) 180 132 80
    [void](& $et 'Kazıyan frez' 24 172 150)
    $cT = New-Object System.Windows.Forms.ComboBox; $cT.DropDownStyle = 'DropDownList'; $cT.BackColor = $cPanel; $cT.ForeColor = $cYazi; $cT.FlatStyle = 'Flat'
    foreach ($n in 1..6) { [void]$cT.Items.Add("T$n") }
    $tk0 = 3; try { $tk0 = [int]$script:Tercih.BlokTakim } catch { }; if ($tk0 -lt 1 -or $tk0 -gt 6) { $tk0 = 3 }
    $cT.SelectedIndex = $tk0 - 1; $cT.SetBounds(180, 172, 80, 28); $f.Controls.Add($cT)
    [void](& $et 'çapı' 272 172 40)
    $tCap = & $kt $(if ($script:Tercih.BlokCap) { $script:Tercih.BlokCap } else { '1.00' }) 316 172 70
    [void](& $et 'Yazı yüksekliği (mm)' 24 212 150)
    $tYuk = & $kt $(if ($script:Tercih.BlokYuk) { $script:Tercih.BlokYuk } else { '3.0' }) 180 212 70
    [void](& $et 'Yeri' 272 212 40)
    $cK = New-Object System.Windows.Forms.ComboBox; $cK.DropDownStyle = 'DropDownList'; $cK.BackColor = $cPanel; $cK.ForeColor = $cYazi; $cK.FlatStyle = 'Flat'
    foreach ($k in @('saat 12 (arka)', 'saat 3 (sağ)', 'saat 6 (ön)', 'saat 9 (sol)')) { [void]$cK.Items.Add($k) }
    $ks = @('12', '3', '6', '9'); $ki = [array]::IndexOf($ks, [string]$script:Tercih.BlokKonum); if ($ki -lt 0) { $ki = 0 }
    $cK.SelectedIndex = $ki; $cK.SetBounds(316, 212, 150, 28); $f.Controls.Add($cK)
    $chC = New-Object System.Windows.Forms.CheckBox
    $chC.Text = 'Referans çizgisi de kazı (yazının ortasından blok kenarına kadar)'; $chC.ForeColor = $cYazi
    $chC.Checked = ($script:Tercih.BlokCizgi -ne '0'); $chC.SetBounds(24, 246, 552, 24); $f.Controls.Add($chC)
    $ln = New-Object System.Windows.Forms.Label
    $ln.Text = "Yazı + çizgi merkezden 41.5 mm'den kenara kadar. HyperDENT'te parçaları bu dış banda yerleştirme."
    $ln.ForeColor = $cSoluk; $ln.Font = New-Object System.Drawing.Font('Segoe UI', 9); $ln.SetBounds(24, 272, 552, 24); $f.Controls.Add($ln)
    $f.Tag = $null
    $mk = { param($t, $x, $w, $renk, $deger)
        $b = New-Object System.Windows.Forms.Button; $b.Text = $t; $b.FlatStyle = 'Flat'; $b.BackColor = $cPanel; $b.ForeColor = $renk
        $b.FlatAppearance.BorderColor = $renk; $b.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 11)
        $b.SetBounds($x, 304, $w, 72); $b.Tag = $deger
        $b.Add_Click({ param($s2, $e2) $fm = $s2.FindForm(); $fm.Tag = $s2.Tag; $fm.Close() })
        $f.Controls.Add($b); $b }
    $bEski = & $mk "KULLANILMIŞ BLOK`r`n(numara kazıma)" 24 230 $cAltinAc 'eski'
    $bYeni = & $mk "YENİ BLOK`r`nnumarayı kazı, sonra işe başla" 266 230 $cYesil 'yeni'
    [void](& $mk 'Vazgeç' 508 68 $cSoluk 'iptal')
    $f.AcceptButton = $bEski
    $f.Add_Shown({ param($s2, $e2) [Kayit]::Yaz('BLOK: pencere açıldı'); $s2.Activate(); $s2.BringToFront(); $tNo.Focus(); $tNo.SelectAll() })
    [void]$f.ShowDialog($form)
    $sec = [string]$f.Tag
    [Kayit]::Yaz("BLOK: seçim '$sec'  no '$($tNo.Text)'")
    if ($sec -eq 'eski') { return 'eski' }
    if ($sec -ne 'yeni') { return $null }
    $metin = Blok-Metin-Temizle $tNo.Text
    $T = Metin-Sayi $tT.Text; $cap = Metin-Sayi $tCap.Text; $yuk = Metin-Sayi $tYuk.Text
    if (-not $metin) { [Kayit]::Show('Kazınacak numara / isim boş (sadece rakam, harf, - . / kullanılabilir).', 'Blok', 'OK', 'Warning') | Out-Null; return $null }
    if ($null -eq $T -or $T -lt 10 -or $T -gt 30) { [Kayit]::Show('Disk kalınlığını yaz (10–30 mm).', 'Blok', 'OK', 'Warning') | Out-Null; return $null }
    if ($null -eq $yuk -or $yuk -lt 2 -or $yuk -gt 5) { [Kayit]::Show('Yazı yüksekliği 2–5 mm olmalı.', 'Blok', 'OK', 'Warning') | Out-Null; return $null }
    if ($null -eq $cap -or $cap -le 0 -or $cap -gt $yuk / 2) { [Kayit]::Show("Frez çapı yazı yüksekliğine göre çok büyük (en fazla $(Sayi ($yuk / 2)) mm). İnce bir frez seç ya da yazıyı büyüt.", 'Blok', 'OK', 'Warning') | Out-Null; return $null }
    $uzun = $metin.Length * $yuk
    if ($uzun -gt 60) { [Kayit]::Show('Yazı çok uzun; daha kısa bir numara / isim yaz.', 'Blok', 'OK', 'Warning') | Out-Null; return $null }
    $script:Tercih.KalT = $tT.Text; $script:Tercih.BlokTakim = "$($cT.SelectedIndex + 1)"; $script:Tercih.BlokCap = $tCap.Text
    $script:Tercih.BlokYuk = $tYuk.Text; $script:Tercih.BlokKonum = $ks[$cK.SelectedIndex]; $script:Tercih.BlokCizgi = $(if ($chC.Checked) { '1' } else { '0' }); Tercih-Yaz
    return @{ Metin = $metin; T = $T; Takim = $cT.SelectedIndex + 1; Cap = $cap; Yuk = $yuk; Konum = $ks[$cK.SelectedIndex]; Cizgi = $chC.Checked }
}

function Blok-Birlesik-Uret([string]$isDosyasi, $b) {
    # Numara kazıma + asıl iş tek programda. İşin başındaki CHECK_EMPTY_TOOL kaldırılır (milde kazıyan frez var).
    $satirlar = [System.IO.File]::ReadAllLines($isDosyasi)
    $derin = 0.2; if ($b.Derin) { $derin = [double]$b.Derin }
    $kaz = Blok-Kazima-NC $b.Metin $b.T $b.Takim $b.Yuk $b.Konum $derin ($b.Cizgi -ne $false)
    $cikti = New-Object System.Collections.Generic.List[string]
    $eklendi = $false; $kontrolSilindi = $false
    foreach ($l in $satirlar) {
        $t = $l.Trim()
        if (-not $eklendi -and $t -ne '%' -and -not $t.StartsWith('(')) {
            if ($t -match '^(?i)GOSUB\s+CHECK_EMPTY_TOOL') { $cikti.Add($l); foreach ($x in $kaz) { $cikti.Add([string]$x) }; $eklendi = $true; $kontrolSilindi = $true; continue }
            $cikti.Add('GOSUB CHECK_EMPTY_TOOL'); foreach ($x in $kaz) { $cikti.Add([string]$x) }; $eklendi = $true
        }
        if ($eklendi -and -not $kontrolSilindi -and $t -match '^(?i)GOSUB\s+CHECK_EMPTY_TOOL') { $kontrolSilindi = $true; continue }
        $cikti.Add($l)
    }
    $hedef = [System.IO.Path]::Combine($IsKlasor, ([System.IO.Path]::GetFileNameWithoutExtension($isDosyasi) + "_blok$($b.Metin -replace '[^A-Za-z0-9\-]', '').nc"))
    [System.IO.File]::WriteAllLines($hedef, $cikti)
    return $hedef
}

function Blok-Kaydet($b, [string]$isDosyasi) {
    try {
        if (-not [System.IO.File]::Exists($BlokKayit)) { [System.IO.File]::WriteAllText($BlokKayit, "tarih;no;ilk_is;disk_mm`r`n", [System.Text.Encoding]::UTF8) }
        [System.IO.File]::AppendAllText($BlokKayit, "$(Get-Date -Format 'yyyy-MM-dd HH:mm');$($b.Metin);$([System.IO.Path]::GetFileName($isDosyasi));$(Sayi $b.T)`r`n", [System.Text.Encoding]::UTF8)
    } catch { }
}

# ================= SADE SÜRÜM: YENİ BLOK =================
# Alt satırdaki "Yeni blok" → isim yaz → saat 9 yönüne T2 ile isim + referans çentiği, sonra iş durmadan devam eder.
$script:BekleyenBlok = $null
$script:BlokHazir = $false     # makinede "blok takıldı" onayı (uzaktan BAŞLAT bunu ister, her işte sıfırlanır)
function Blok-Cip-Guncelle {
    if (-not $script:Sade) { return }
    if ($script:BekleyenBlok) { $lnkMod.Text = "Blok: $($script:BekleyenBlok.Metin)$(if ($script:BlokHazir) { ' ✓' })"; $lnkMod.Vurgu = $cYesil }
    elseif ($script:BlokHazir) { $lnkMod.Text = 'Blok hazır ✓'; $lnkMod.Vurgu = $cYesil }
    else { $lnkMod.Text = 'Blok takıldı'; $lnkMod.Vurgu = $cAltin }
    $lnkMod.Invalidate()
}
function Yeni-Blok {
    if (Is-Suruyor-Uyari 'Yeni blok') { return }
    $f = New-Object System.Windows.Forms.Form
    $f.Text = 'Yeni blok'; $f.StartPosition = 'CenterScreen'; $f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false
    $f.TopMost = $true; $f.ShowInTaskbar = $false
    $f.BackColor = $cZemin; $f.ForeColor = $cYazi; $f.Font = New-Object System.Drawing.Font('Segoe UI', 11)
    $f.ClientSize = New-Object System.Drawing.Size(560, 380)
    $lb = New-Object System.Windows.Forms.Label
    $lb.Text = 'Blok takıldı'; $lb.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 16); $lb.ForeColor = $cAltinAc; $lb.SetBounds(24, 14, 500, 34); $f.Controls.Add($lb)
    $la = New-Object System.Windows.Forms.Label
    $la.Text = 'İsim ve referans çentiği saat 9 yönüne, T2 frezle kazınır.'; $la.ForeColor = $cSoluk; $la.SetBounds(24, 50, 520, 24); $f.Controls.Add($la)
    $e1 = New-Object System.Windows.Forms.Label; $e1.Text = 'Blok ismi'; $e1.ForeColor = $cSoluk; $e1.SetBounds(24, 98, 150, 26); $f.Controls.Add($e1)
    $tAd = New-Object System.Windows.Forms.TextBox; $tAd.BackColor = $cPanel; $tAd.ForeColor = $cYazi; $tAd.BorderStyle = 'FixedSingle'
    $tAd.Font = New-Object System.Drawing.Font('Consolas', 16); $tAd.MaxLength = 10; $tAd.SetBounds(180, 92, 220, 34); $tAd.Text = "$(Blok-Sonraki-No)"; $f.Controls.Add($tAd)
    $e2 = New-Object System.Windows.Forms.Label; $e2.Text = 'Blok kalınlığı (mm)'; $e2.ForeColor = $cSoluk; $e2.SetBounds(24, 146, 150, 26); $f.Controls.Add($e2)
    $tT = New-Object System.Windows.Forms.TextBox; $tT.BackColor = $cPanel; $tT.ForeColor = $cYazi; $tT.BorderStyle = 'FixedSingle'
    $tT.Font = New-Object System.Drawing.Font('Consolas', 16); $tT.SetBounds(180, 140, 100, 34)
    $tT.Text = $(if ($script:Tercih.SadeKalinlik) { $script:Tercih.SadeKalinlik } else { '18' }); $f.Controls.Add($tT)
    $e3 = New-Object System.Windows.Forms.Label; $e3.Text = 'Derinlik (mm)'; $e3.ForeColor = $cSoluk; $e3.SetBounds(300, 146, 110, 26); $f.Controls.Add($e3)
    $tD = New-Object System.Windows.Forms.TextBox; $tD.BackColor = $cPanel; $tD.ForeColor = $cYazi; $tD.BorderStyle = 'FixedSingle'
    $tD.Font = New-Object System.Drawing.Font('Consolas', 16); $tD.SetBounds(414, 140, 100, 34)
    $tD.Text = $(if ($script:Tercih.SadeDerinlik) { $script:Tercih.SadeDerinlik } else { '0.15' }); $f.Controls.Add($tD)
    $f.Tag = $null
    $mk = { param($t, $x, $w, $renk, $deger)
        $b = New-Object System.Windows.Forms.Button; $b.Text = $t; $b.FlatStyle = 'Flat'; $b.BackColor = $cPanel; $b.ForeColor = $renk
        $b.FlatAppearance.BorderColor = $renk; $b.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 11)
        $b.SetBounds($x, 200, $w, 76); $b.Tag = $deger
        $b.Add_Click({ param($s2, $e2) $fm = $s2.FindForm(); $fm.Tag = $s2.Tag; $fm.Close() })
        $f.Controls.Add($b); $b }
    $isVar = [bool]$script:SeciliDosya
    $bIs = & $mk $(if ($isVar) { "KAZI VE İŞE BAŞLA`r`n$([System.IO.Path]::GetFileName($script:SeciliDosya))" } else { "Önce iş dosyasını seç`r`n(DOSYA SEÇ)" }) 24 250 $cYesil 'is'
    $bIs.Enabled = $isVar
    [void](& $mk "SADECE`r`nİSMİ KAZI" 284 150 $cAltinAc 'tek')
    [void](& $mk 'Vazgeç' 444 92 $cSoluk 'iptal')
    $bH = & $mk "YENİ BLOK HAZIR`r`n(işi bilgisayardan başlatacağım)" 24 250 $cYesil 'hazir'; $bH.Top = 286; $bH.Height = 70
    $bE = & $mk "KULLANILMIŞ BLOK`r`n(isim yok) hazır" 284 252 $cAltinAc 'eski'; $bE.Top = 286; $bE.Height = 70
    if ($script:BekleyenBlok) {
        $bk = & $mk 'Bekleyen bloğu iptal et' 24 160 $cKirmizi 'sil'; $bk.SetBounds(414, 92, 130, 34); $bk.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
    }
    $f.Add_Shown({ param($s2, $e2) $s2.Activate(); $tAd.Focus(); $tAd.SelectAll() })
    [void]$f.ShowDialog($form)
    $sec = [string]$f.Tag
    [Kayit]::Yaz("YENİ BLOK: seçim '$sec'  isim '$($tAd.Text)'")
    if ($sec -eq 'sil') { $script:BekleyenBlok = $null; Blok-Cip-Guncelle; Yaz 'Bekleyen blok iptal edildi.'; return }
    if ($sec -eq 'eski') { $script:BekleyenBlok = $null; $script:BlokHazir = $true; Blok-Cip-Guncelle; Yaz 'Kullanılmış blok takıldı: iş uzaktan başlatılabilir.'; return }
    if (@('is', 'tek', 'hazir') -notcontains $sec) { return }
    $metin = Blok-Metin-Temizle $tAd.Text
    $T = Metin-Sayi $tT.Text
    if (-not $metin) { [Kayit]::Show('Blok ismi boş (rakam, harf, - . / kullanılabilir).', 'Yeni blok', 'OK', 'Warning') | Out-Null; return }
    if ($null -eq $T -or $T -lt 10 -or $T -gt 30) { [Kayit]::Show('Blok kalınlığını yaz (10–30 mm).', 'Yeni blok', 'OK', 'Warning') | Out-Null; return }
    $D = Metin-Sayi $tD.Text
    if ($null -eq $D -or $D -lt 0.05 -or $D -gt 0.5) { [Kayit]::Show('Derinlik 0.05–0.5 mm arası olmalı.', 'Yeni blok', 'OK', 'Warning') | Out-Null; return }
    $script:Tercih.SadeKalinlik = $tT.Text; $script:Tercih.SadeDerinlik = $tD.Text; Tercih-Yaz
    $taraf = if ($script:Tercih.SadeTaraf -eq '3') { '3' } else { '9' }
    $b = @{ Metin = $metin; T = $T; Takim = 2; Cap = 1.0; Yuk = 4.0; Konum = $taraf; Cizgi = $true; Derin = $D }
    $script:BlokHazir = $true
    if ($sec -eq 'hazir') { $script:BekleyenBlok = $b; Blok-Cip-Guncelle; Yaz "Yeni blok '$metin' takıldı: iş başlayınca önce ismi kazınacak (uzaktan başlatılabilir)."; return }
    if ($sec -eq 'is') {
        $script:BekleyenBlok = $b; Blok-Cip-Guncelle
        Btn-Baslat
        return
    }
    # Sadece isim: kendi küçük programı, sonunda frezi magazine bırakır (T0)
    if (-not (Hazir-Hareket 'Yeni blok')) { return }
    try {
        $L = New-Object System.Collections.Generic.List[string]
        $L.Add('%'); $L.Add('GOSUB CHECK_EMPTY_TOOL')
        foreach ($x in (Blok-Kazima-NC $b.Metin $b.T $b.Takim $b.Yuk $b.Konum $b.Derin $true)) { $L.Add([string]$x) }
        $L.Add('T0 M6'); $L.Add('M30'); $L.Add('%')
        if (-not [System.IO.Directory]::Exists($IsKlasor)) { [void][System.IO.Directory]::CreateDirectory($IsKlasor) }
        $yol = [System.IO.Path]::Combine($IsKlasor, "PM_blok_$($metin -replace '[^A-Za-z0-9\-]', '').nc")
        [System.IO.File]::WriteAllLines($yol, $L)
    } catch { [Kayit]::Show("Program yazılamadı: $($_.Exception.Message)", 'Yeni blok', 'OK', 'Error') | Out-Null; return }
    Hata-Temizle 'Yeni blok'
    if (-not (Makro-Hazir-Mi 'Yeni blok')) { return }
    if (-not (Bayrak-Sifirla 'Yeni blok')) { [Kayit]::Show("Takım bildirim bayrağı (#4039) sıfırlanamadı. Blok ismi kazınmadı.", 'Yeni blok', 'OK', 'Warning') | Out-Null; return }
    if (-not (Komut-Sonucu 'Blok ismi yükle' ([Eding]::CncLoadJobA($yol)))) { return }
    if (Komut-Sonucu 'Blok ismi kazı' ([Eding]::CncRunOrResumeJob())) {
        Blok-Kaydet $b '(sadece isim)'; Blok-Cip-Guncelle
        Yaz "Blok '$metin' kazınıyor (T2, saat 9). Bitince frez magazine bırakılır."
    }
}

# PENS AÇ → T0 için orijinal macro.cnc'ye küçük ek (bir kez, yedek alınarak; Eding açılmadan önce)
function Macro-Pens-Yamasi {
    $yol = [System.IO.Path]::Combine($EdingKlasor, 'macro.cnc')
    if (-not [System.IO.File]::Exists($yol)) { return }
    $enc = [System.Text.Encoding]::GetEncoding(1252)
    $m = [System.IO.File]::ReadAllText($yol, $enc)
    $nl = if ($m.Contains("`r`n")) { "`r`n" } else { "`n" }
    $ilk = $m
    if ($m -match '(?im)^\s*sub\s+pm_pens_t0\b') { if ($m -ne $ilk) { Macro-Yaz $yol $m $enc 'macro' }; return }
    $bas = [regex]::Match($m, '(?im)^[ \t]*sub[ \t]+change_tool\b[^\r\n]*\r?\n')
    if (-not $bas.Success) { [Kayit]::Yaz('MACRO: change_tool bulunamadı, yama yapılmadı'); return }
    $son = [regex]::Match($m.Substring($bas.Index + $bas.Length), '(?im)^[ \t]*endsub\b')
    if (-not $son.Success) { [Kayit]::Yaz('MACRO: change_tool sonu bulunamadı, yama yapılmadı'); return }
    $sonIdx = $bas.Index + $bas.Length + $son.Index
    $ust = "`t;PrimerMill: pens panelden acildi (gosub pm_pens_t0) -> hareket yok, sadece takim no = T0$nl" +
           "`tif [#4900 == 1]$nl`t`t#4900 = 0$nl`t`tmsg `"PrimerMill: collet opened, tool set to T0`"$nl`t`tm6t[#5011]$nl`telse$nl"
    $alt = "`t;PrimerMill: pm_pens_t0 sonu$nl`tendif$nl"
    $ek = "$nl;PrimerMill: panelden PENS AC -> pens acilir, takim T0 olur (hareket yok)$nl" +
          "sub pm_pens_t0$nl`tM54 P2$nl`t#4900 = 1$nl`tM6 T0$nl`t#4900 = 0$nl`tmsg `"PrimerMill: collet open, tool T0`"$nl" + "endsub$nl"
    $yeni = $m.Substring(0, $bas.Index + $bas.Length) + $ust + $m.Substring($bas.Index + $bas.Length, $sonIdx - $bas.Index - $bas.Length) + $alt + $m.Substring($sonIdx).TrimEnd() + $nl + $ek
    Macro-Yaz $yol $yeni $enc 'PENS AÇ → T0'
}
function Macro-Yaz([string]$yol, [string]$metin, $enc, [string]$ne) {
    $yedek = [System.IO.Path]::Combine($EdingKlasor, "macro_yedek_$(Get-Date -Format 'yyyyMMdd_HHmmss').cnc")
    [System.IO.File]::Copy($yol, $yedek, $true)
    [System.IO.File]::WriteAllText($yol, $metin, $enc)
    [Kayit]::Yaz("MACRO: $ne eki yapıldı (yedek: $yedek)")
    if (@(Get-Process -Name $script:EdingExeAd -ErrorAction SilentlyContinue).Count -gt 0) { $script:MakroYamaBekliyor = $true; Yaz "macro.cnc güncellendi ($ne). Eding kapatılıp açılınca etkin olur (EdingKapat.bat, sonra KazimaBaslat.bat)." }
}

# ================= UZAKTAN ERİŞİM =================
function Uzak-Is-Sec([string]$ad) {
    $hedef = [System.IO.Path]::Combine($IsKlasor, [System.IO.Path]::GetFileName($ad))
    if (-not [System.IO.File]::Exists($hedef)) { return "HATA: $ad bulunamadı" }
    [System.IO.File]::Copy($hedef, [System.IO.Path]::Combine($IsKlasor, $AktifIsAdi), $true)
    $script:SeciliDosya = $hedef
    $lblDosya.Text = [System.IO.Path]::GetFileNameWithoutExtension($hedef); $lblDosya.ForeColor = $cYazi
    Dosyayi-Kontrol-Et $hedef
    if ($script:Engel) { return "HATA: $ad seçildi ama dosyada hata var: $($script:SonHatalar -join ' · ')" }
    return "OK: $ad seçildi"
}
function Uzak-Komut([string]$ad, [string]$arg, [string]$ip) {
    [Kayit]::Yaz("UZAK ($ip): $ad $arg")
    switch ($ad) {
        'sec' {
            if ((Is-Suruyor)) { return 'HATA: Kazıma sürerken / duraklıyken iş değiştirilemez' }
            Yaz "Uzaktan ($ip) iş seçildi: $arg"
            return (Uzak-Is-Sec $arg)
        }
        'baslat' {
            if ([Eding]::AcilKilit) { return 'HATA: ACİL STOP basılı (makinede RESET gerekli)' }
            if (-not (Baglan)) { return 'HATA: Eding bağlı değil' }
            if ([Eding]::CncGetEMStopActive() -ne 0) { return 'HATA: Acil stop basılı' }
            if ([Eding]::CncGetAllAxesHomed() -eq 0) { return 'HATA: Makine home alınmamış' }
            if ((Durakli-Mi)) {
                Yaz "Uzaktan ($ip): DEVAM"
                if (Rc-Tamam ([Eding]::CncRunOrResumeJob())) { return 'OK: Devam ediyor' } else { return 'HATA: Devam ettirilemedi' }
            }
            if ((Calisiyor-Mu)) { return 'HATA: Makine zaten çalışıyor' }
            if (-not $script:SeciliDosya) { return 'HATA: Önce bir iş seç' }
            if ($script:Engel) { return 'HATA: Dosyada hata var, başlatılmadı' }
            if ($script:Tercih.UzakKilit -ne '0' -and -not $script:BlokHazir) { return 'HATA: Makinede "Blok takıldı" onayı yok. Bloğu takınca makinedeki Blok takıldı düğmesine bas.' }
            Yaz "Uzaktan ($ip): BAŞLAT  $([System.IO.Path]::GetFileName($script:SeciliDosya))"
            Btn-Baslat
            if ($script:IsAktif) { return 'OK: Kazıma başladı' } else { return 'HATA: Başlatılamadı (makinedeki mesajlara bak)' }
        }
        'duraklat' {
            if (-not (Baglan) -or -not (Calisiyor-Mu)) { return 'HATA: Çalışan iş yok' }
            Yaz "Uzaktan ($ip): DURAKLAT"
            if (Rc-Tamam ([Eding]::CncPauseJob())) { return 'OK: Duraklatıldı' } else { return 'HATA: Duraklatılamadı' }
        }
        'durdur' {
            if (-not (Baglan) -or (-not (Calisiyor-Mu) -and -not (Durakli-Mi))) { return 'HATA: Çalışan iş yok' }
            Yaz "Uzaktan ($ip): DURDUR"
            Btn-Durdur
            return 'OK: Durduruldu'
        }
        'blok' {
            $p = $arg.Split('|')
            $metin = Blok-Metin-Temizle $p[0]
            $T = Metin-Sayi $(if ($p.Length -gt 1) { $p[1] } else { '' }); $D = Metin-Sayi $(if ($p.Length -gt 2) { $p[2] } else { '' })
            if (-not $metin) { return 'HATA: Blok ismi boş (rakam, harf, - . /)' }
            if ($null -eq $T -or $T -lt 10 -or $T -gt 30) { return 'HATA: Kalınlık 10–30 mm olmalı' }
            if ($null -eq $D -or $D -lt 0.05 -or $D -gt 0.5) { return 'HATA: Derinlik 0.05–0.5 mm olmalı' }
            if ((Is-Suruyor)) { return 'HATA: Kazıma sürerken / duraklıyken blok ismi değiştirilemez' }
            $script:Tercih.SadeKalinlik = "$T"; $script:Tercih.SadeDerinlik = "$D"; Tercih-Yaz
            $taraf = if ($script:Tercih.SadeTaraf -eq '3') { '3' } else { '9' }
            $script:BekleyenBlok = @{ Metin = $metin; T = $T; Takim = 2; Cap = 1.0; Yuk = 4.0; Konum = $taraf; Cizgi = $true; Derin = $D }
            Blok-Cip-Guncelle
            Yaz "Uzaktan ($ip): sıradaki işten önce '$metin' kazınacak"
            return "OK: '$metin' sıradaki işten önce kazınacak"
        }
        'blokiptal' { $script:BekleyenBlok = $null; Blok-Cip-Guncelle; return 'OK: Bekleyen blok ismi iptal edildi' }
    }
    return "HATA: bilinmeyen komut '$ad'"
}
function Uzak-Durum {
    $d = Eding-Durum
    $tk = 0; try { if ($script:Bagli) { $tk = [Eding]::CncGetCurrentToolNumber() } } catch { }
    $acil = [Eding]::AcilKilit; try { if ($script:Bagli -and [Eding]::CncGetEMStopActive() -ne 0) { $acil = $true } } catch { }
    $o = [ordered]@{
        durum = $d; durumMetin = ($lblDurum.Text -replace '^[●\s]+', ''); calisiyor = [bool](Mesgul $d); durakli = ($d -like 'PAUSE*'); acil = [bool]$acil
        dosya = $(if ($script:SeciliDosya) { $lblDosya.Text } else { '' }); dosyaAd = $(if ($script:SeciliDosya) { [System.IO.Path]::GetFileName($script:SeciliDosya) } else { '' })
        takim = [int]$tk; yuzde = [int]$bar.Value; sure = $lblSure.Text
        hazir = [bool]$script:BlokHazir; kilit = ($script:Tercih.UzakKilit -ne '0')
        bekleyenBlok = $(if ($script:BekleyenBlok) { $script:BekleyenBlok.Metin } else { '' })
        engel = [bool]($script:SeciliDosya -and $script:Engel); hatalar = @($script:SonHatalar); uyarilar = @($script:Uyarilar)
        mesajlar = @($script:SonMesajlar | Select-Object -Last 12)
        kalinlik = $(if ($script:Tercih.SadeKalinlik) { $script:Tercih.SadeKalinlik } else { '18' })
        derinlik = $(if ($script:Tercih.SadeDerinlik) { $script:Tercih.SadeDerinlik } else { '0.15' })
        sonrakiNo = "$(Blok-Sonraki-No)"
        ad = [string]$script:Tercih.MakineAdi; mod = [string]$script:Tercih.FrezModu
    }
    [WebSunucu]::DurumJson = (ConvertTo-Json $o -Compress -Depth 3)
}
$script:UzakMesgul = $false; $script:UzakSayac = 0
$uzakZaman = New-Object System.Windows.Forms.Timer
$uzakZaman.Interval = 200
$uzakZaman.Add_Tick({
    if ($script:UzakMesgul) { return }
    $script:UzakMesgul = $true
    try {
        $ist = [WebSunucu]::Al()
        if ($ist) {
            try { $ist.Sonuc = Uzak-Komut $ist.Ad $ist.Arg $ist.Ip } catch { $ist.Sonuc = "HATA: $($_.Exception.Message)" }
            finally { [void]$ist.Bitti.Set() }
            $script:UzakSayac = 99
        }
        $script:UzakSayac++
        if ($script:UzakSayac -ge 5) { $script:UzakSayac = 0; try { Uzak-Durum } catch { } }
    } finally { $script:UzakMesgul = $false }
})
function Uzak-Baslat {
    if ($script:Tercih.Uzak -ne '1' -or -not $MakineBilgisayari) { return }
    [WebSunucu]::Pin = [string]$script:Tercih.WebPin
    [WebSunucu]::SayfaYolu = [System.IO.Path]::Combine($ScriptKlasor, 'uzak.html')
    [WebSunucu]::IsKlasor = $IsKlasor
    if ([WebSunucu]::Baslat(8080)) {
        $adr = @([WebSunucu]::Adresler() | ForEach-Object { "http://$($_):$([WebSunucu]::Port)" }) -join '   '
        $script:UzakAdres = $adr
        Yaz "Uzaktan erişim açık: $adr   (PIN $($script:Tercih.WebPin))"
        $uzakZaman.Start()
    } else { $script:UzakAdres = ''; $script:UzakHata = [WebSunucu]::SonHata; Yaz "Uzaktan erişim açılamadı: $([WebSunucu]::SonHata)" }
    Uzak-Etiket-Guncelle
}
function Uzak-Etiket-Guncelle {
    try {
        $lblUzak.Text = if ($script:Tercih.Uzak -ne '1') { 'Kapalı' } elseif ($script:UzakAdres) { "Adres:  $($script:UzakAdres)`r`nPIN:  $(if ($script:Tercih.WebPin) { $script:Tercih.WebPin } else { 'yok (sorulmaz)' })" } else { "Açılamadı: $($script:UzakHata)`r`nYoneticiKurulum.bat bir kez çalıştırılıp bilgisayar yeniden başlatılmalı" }
    } catch { }
}

# ================= KALDIĞI YERDEN DEVAM =================
# Elektrik kesilirse / basınç düşüp iş yarıda kalırsa: panel işin hangi satırda olduğunu sürekli devam.json'a yazar.
# Sonra BAŞLAT'ta "kaldığı yerden" seçilince işin o noktasından devam eden yeni bir program üretilir.
$DevamDosyasi = [System.IO.Path]::Combine($ScriptKlasor, 'devam.json')
$script:DevamHarita = $null      # devam programı çalışırken: @{ Bas = devam dosyasında asıl işin başladığı satır; Orijinal = asıl dosyadaki karşılığı }
$script:DevamSonYazma = [DateTime]::MinValue
function Devam-Oku {
    try {
        if (-not [System.IO.File]::Exists($DevamDosyasi)) { return $null }
        $k = [System.IO.File]::ReadAllText($DevamDosyasi) | ConvertFrom-Json
        if (-not $k.Kaynak -or -not [System.IO.File]::Exists([string]$k.Kaynak) -or [int]$k.Satir -lt 1) { return $null }
        return $k
    } catch { return $null }
}
function Devam-Sil { try { if ([System.IO.File]::Exists($DevamDosyasi)) { [System.IO.File]::Delete($DevamDosyasi) } } catch { } }
function Devam-Kaydet([int]$satir, [string]$durum, [double]$yuzde) {
    if (-not $script:DevamKaynak -or $satir -lt 1) { return }
    if ($script:DevamHarita) { $satir = $script:DevamHarita.Orijinal + ($satir - $script:DevamHarita.Bas); if ($satir -lt $script:DevamHarita.Orijinal) { $satir = $script:DevamHarita.Orijinal } }
    $tk = 0; try { $tk = [Eding]::CncGetCurrentToolNumber() } catch { }
    $o = [ordered]@{ Dosya = $script:DevamDosya; Kaynak = $script:DevamKaynak; Satir = $satir; Takim = $tk; Yuzde = [math]::Round($yuzde, 1); Zaman = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'); Durum = $durum }
    try {
        $gecici = $DevamDosyasi + '.tmp'
        [System.IO.File]::WriteAllText($gecici, (ConvertTo-Json $o -Compress))
        if ([System.IO.File]::Exists($DevamDosyasi)) { [System.IO.File]::Replace($gecici, $DevamDosyasi, $null) } else { [System.IO.File]::Move($gecici, $DevamDosyasi) }
    } catch { }
    $script:DevamSonYazma = Get-Date
}

# Asıl programdan devam programı üretir. $mod: 'guvenli' (son geri çekilme noktasından) ya da 'yakin' (~1 dk geriden)
function Devam-NC-Uret([string]$kaynak, [int]$satir, [string]$mod, $analiz) {
    $L = [System.IO.File]::ReadAllLines($kaynak)
    $idx = [math]::Min($L.Length - 1, [math]::Max(0, $satir - 1))
    # 1) güvenli başlangıç: durduğu satırdan önceki son GOSUB Z_SAFE
    $r = 0
    for ($i = $idx; $i -ge 0; $i--) { if ($L[$i] -match '(?i)^\s*(N\d+\s*)?GOSUB\s+Z_SAFE\b') { $r = $i; break } }
    $q = -1
    if ($mod -eq 'yakin' -and $analiz -and $analiz.Kumulatif.Length -eq $L.Length) {
        $hedef = $analiz.Kumulatif[$idx] - 60
        for ($i = $r + 1; $i -le $idx; $i++) { if ($analiz.Kumulatif[$i] -ge $hedef) { $q = $i; break } }
    }
    $son = if ($q -gt $r) { $q } else { $r }      # bu satıra kadar (hariç) modal durum toplanır
    # 2) modal durum: frez, devir, iş mili, soğutma, ilerleme, A/B, X/Y/Z, hareket kipi
    $frez = 0; $S = 0; $milAcik = $false; $m7 = $false; $m8 = $false; $ilerle = 1000.0; $A = 0.0; $B = 0.0; $X = $null; $Y = $null; $Z = $null; $G = 0
    $ci = [System.Globalization.CultureInfo]::InvariantCulture
    for ($i = 0; $i -lt $son; $i++) {
        $ln = ($L[$i] -replace '\(.*?\)', '' -replace ';.*$', '').Trim().ToUpperInvariant()
        if (-not $ln -or $ln -match '^(N\d+\s*)?(GOSUB|SUB|MSG|IF|ENDIF|ELSE|%)') { continue }
        $kelimeler = [regex]::Matches($ln, '([A-Z])\s*(-?\d*\.?\d+)')
        $m6 = $false; $tYeni = $null
        foreach ($k in $kelimeler) {
            $h = $k.Groups[1].Value; $v = [double]::Parse($k.Groups[2].Value, $ci)
            switch ($h) {
                'G' { $gi = [int]$v; if ($gi -le 3 -and $v -eq [math]::Floor($v)) { $G = $gi } }
                'M' { switch ([int]$v) { 3 { $milAcik = $true } 4 { $milAcik = $true } 5 { $milAcik = $false } 6 { $m6 = $true } 7 { $m7 = $true } 8 { $m8 = $true } 9 { $m7 = $false; $m8 = $false } } }
                'T' { $tYeni = [int]$v }
                'S' { $S = $v }
                'F' { $ilerle = $v }
                'A' { $A = $v } 'B' { $B = $v } 'X' { $X = $v } 'Y' { $Y = $v } 'Z' { $Z = $v }
            }
        }
        if ($m6 -and $null -ne $tYeni) { $frez = $tYeni }
    }
    $fmt = { param($v) ([double]$v).ToString('0.####', $ci) }
    $C = New-Object System.Collections.Generic.List[string]
    $C.Add('%')
    $C.Add("(PrimerMill DEVAM: $([System.IO.Path]::GetFileName($kaynak)) satir $($son + 1) / $($L.Length), mod $mod)")
    $C.Add('G0 G17 G40 G49 G54 G80 G90')
    $C.Add('M9'); $C.Add('M5')
    $C.Add('GOSUB Z_SAFE'); $C.Add('GOSUB AZXY_SAFE')
    $C.Add('G0 B0.0')
    if ($frez -gt 0) { $C.Add("T$frez M6") }
    if ($milAcik -and $S -gt 0) { $C.Add("S$(& $fmt $S) M3") }
    if ($m7) { $C.Add('M7') }; if ($m8) { $C.Add('M8') }
    $C.Add('GOSUB Z_SAFE'); $C.Add('GOSUB AZXY_SAFE')
    $C.Add("G0 A$(& $fmt $A) B$(& $fmt $B)")
    $C.Add("G90 F$(& $fmt $ilerle)")
    if ($q -gt $r -and $null -ne $X -and $null -ne $Y -and $null -ne $Z) {
        # Yakın nokta: iş mili yukarıdayken X/Y'ye gider, sonra yavaşça kaldığı Z'ye iner
        $C.Add("G0 X$(& $fmt $X) Y$(& $fmt $Y)")
        $C.Add("G1 Z$(& $fmt $Z) F$(& $fmt ([math]::Min($ilerle, 600)))")
        $C.Add("G$G Z$(& $fmt $Z) F$(& $fmt $ilerle)")
        $bas = $q
    } else { $bas = $r }
    $harita = @{ Bas = $C.Count + 1; Orijinal = $bas + 1 }
    for ($i = $bas; $i -lt $L.Length; $i++) { $C.Add($L[$i]) }
    $hedef = [System.IO.Path]::Combine($IsKlasor, ([System.IO.Path]::GetFileNameWithoutExtension($kaynak) -replace '_devam\d*$', '') + '_devam.nc')
    [System.IO.File]::WriteAllLines($hedef, $C)
    $tekrar = 0; if ($analiz -and $analiz.Kumulatif.Length -eq $L.Length) { $tekrar = $analiz.Kumulatif[$idx] - $analiz.Kumulatif[[math]::Max(0, $bas - 1)] }
    return @{ Yol = $hedef; Harita = $harita; Takim = $frez; Satir = $bas + 1; Tekrar = $tekrar }
}

function Devam-Diyalog($k) {
    $f = New-Object System.Windows.Forms.Form
    $f.Text = 'Yarım kalan iş'; $f.StartPosition = 'CenterScreen'; $f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false
    $f.TopMost = $true; $f.ShowInTaskbar = $false
    $f.BackColor = $cZemin; $f.ForeColor = $cYazi; $f.Font = New-Object System.Drawing.Font('Segoe UI', 11)
    $f.ClientSize = New-Object System.Drawing.Size(620, 400)
    $neden = switch ([string]$k.Durum) { 'calisiyor' { 'iş sürerken panel/elektrik kapandı' } 'hata' { 'Eding hatasıyla durdu (basınç / acil stop vb.)' } 'durduruldu' { 'DURDUR ile durduruldu' } default { 'yarıda kaldı' } }
    $lb = New-Object System.Windows.Forms.Label; $lb.Text = 'Yarım kalan iş'; $lb.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 16); $lb.ForeColor = $cAltinAc; $lb.SetBounds(24, 14, 570, 34); $f.Controls.Add($lb)
    $li = New-Object System.Windows.Forms.Label; $li.ForeColor = $cYazi; $li.SetBounds(24, 54, 570, 72)
    $li.Text = "$([System.IO.Path]::GetFileNameWithoutExtension([string]$k.Dosya))   ·   %$($k.Yuzde) yapılmıştı`r`n$($k.Zaman)  ·  $neden`r`nSatır $($k.Satir)"
    $f.Controls.Add($li)
    $lt = New-Object System.Windows.Forms.Label; $lt.Text = 'İş milinde şu an takılı frez:'; $lt.ForeColor = $cSoluk; $lt.SetBounds(24, 136, 230, 26); $f.Controls.Add($lt)
    $cT = New-Object System.Windows.Forms.ComboBox; $cT.DropDownStyle = 'DropDownList'; $cT.BackColor = $cPanel; $cT.ForeColor = $cYazi; $cT.FlatStyle = 'Flat'
    foreach ($n in 0..6) { [void]$cT.Items.Add($(if ($n -eq 0) { 'Yok (T0)' } else { "T$n" })) }
    $t0 = [int]$k.Takim; if ($t0 -lt 0 -or $t0 -gt 6) { $t0 = 0 }; $cT.SelectedIndex = $t0; $cT.SetBounds(260, 132, 120, 30); $f.Controls.Add($cT)
    $ln = New-Object System.Windows.Forms.Label; $ln.Text = 'Kapağı açıp iş milindeki frezi kontrol et; listeden doğrusunu seç.'; $ln.ForeColor = $cSoluk; $ln.Font = New-Object System.Drawing.Font('Segoe UI', 9.5); $ln.SetBounds(24, 166, 570, 22); $f.Controls.Add($ln)
    $f.Tag = $null
    $mk = { param($t, $x, $y, $w, $h, $renk, $deger)
        $b = New-Object System.Windows.Forms.Button; $b.Text = $t; $b.FlatStyle = 'Flat'; $b.BackColor = $cPanel; $b.ForeColor = $renk
        $b.FlatAppearance.BorderColor = $renk; $b.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 11)
        $b.SetBounds($x, $y, $w, $h); $b.Tag = $deger
        $b.Add_Click({ param($s2, $e2) $fm = $s2.FindForm(); $fm.Tag = $s2.Tag; $fm.Close() })
        $f.Controls.Add($b); $b }
    [void](& $mk "KALDIĞI YERDEN DEVAM`r`n(son güvenli noktadan, önerilen)" 24 200 300 80 $cYesil 'guvenli')
    [void](& $mk "YAKIN NOKTADAN`r`n(~1 dk geriden, yukarıdan iner)" 334 200 262 80 $cAltinAc 'yakin')
    [void](& $mk 'BAŞTAN BAŞLAT' 24 296 300 56 $cSoluk 'bastan')
    [void](& $mk 'Vazgeç' 334 296 262 56 $cSoluk 'iptal')
    $lu = New-Object System.Windows.Forms.Label; $lu.Text = 'Blok tutucudan sökülmediyse devam doğru yerden kesilir.'; $lu.ForeColor = $cSoluk; $lu.Font = New-Object System.Drawing.Font('Segoe UI', 9.5); $lu.SetBounds(24, 362, 570, 24); $f.Controls.Add($lu)
    [void]$f.ShowDialog($form)
    return @{ Sec = [string]$f.Tag; Takim = $cT.SelectedIndex }
}

function Devam-Baslat($k, [string]$mod, [int]$takimSimdi) {
    if (-not (Hazir-Mi 'Devam')) { return }
    if ((Calisiyor-Mu)) { [Kayit]::Show('Makine şu an çalışıyor.', 'Devam', 'OK', 'Warning') | Out-Null; return }
    $form.Cursor = 'WaitCursor'
    try {
        # Eding'in bildiği frez, gerçekte takılı olanla aynı olsun (hareketsiz; macro'daki pens/T0 eki ile)
        # K6/GV-04: önce Eding'deki makro sürümü (#4038), sonra bayrak (#4039 / #4900) yazılıp geri okunur; her adım denetlenir
        $script:MakroKontrolTamam = $false   # Devam'da sürüm her seferinde Eding'den yeniden okunur
        if (-not (Makro-Hazir-Mi 'Devam')) { return }
        $tkE = [Eding]::CncGetCurrentToolNumber()
        if ($tkE -ne $takimSimdi) {
            Yaz "Devam: Eding'deki frez T$tkE, iş milinde T$takimSimdi."
            if (-not (Takim-Bildir $takimSimdi 'Devam')) { return }
        }
        $an = $null; try { $an = [NcAnaliz]::Oku([string]$k.Kaynak, 4000.0) } catch { }
        $d = Devam-NC-Uret ([string]$k.Kaynak) ([int]$k.Satir) $mod $an
        Yaz "Devam programı: $($d.Yol)  (asıl dosyada satır $($d.Satir)'den, T$($d.Takim); tekrar edilecek kısım ~$(Sade-Sure $d.Tekrar))"
        Dosyayi-Kontrol-Et $d.Yol
        if ($script:Engel) { [Kayit]::Show("Devam programı kontrolden geçemedi:`r`n$($script:SonHatalar -join "`r`n")", 'Devam', 'OK', 'Error') | Out-Null; return }
        Hata-Temizle 'Devam'
        if (-not (Bayrak-Sifirla 'Devam')) { [Kayit]::Show("Takım bildirim bayrağı (#4039) sıfırlanamadı. Devam başlatılmadı.", 'Devam', 'OK', 'Warning') | Out-Null; return }
        if (-not (Komut-Sonucu 'Devam programı yükleme' ([Eding]::CncLoadJobA($d.Yol)))) { return }
        $rc = Is-Calistir
        if (Komut-Sonucu 'Devam başlat' $rc) {
            $script:DevamDosya = [string]$k.Dosya; $script:DevamKaynak = [string]$k.Kaynak; $script:DevamHarita = $d.Harita
            $script:BlokHazir = $false; if ($script:Sade) { Blok-Cip-Guncelle }
            $script:TakipSonu = ''; $script:IsAktif = $true; $script:Gecen = [TimeSpan]::Zero; $script:SonTik = Get-Date
            $script:BaslamaAni = Get-Date; $script:SonGecerliSatir = 0; $script:CalistiGoruldu = $false
            Yaz "Kaldığı yerden devam ediyor: $([System.IO.Path]::GetFileName([string]$k.Dosya))"
        }
    } finally { $form.Cursor = 'Default' }
}

# Açılışta yarım iş varsa dosyasını seçili getir (BAŞLAT'a basınca "kaldığı yerden" sorulur)
function Devam-Acilis {
    $k = Devam-Oku
    if (-not $k) { return }
    $dosya = [string]$k.Dosya
    if (-not [System.IO.File]::Exists($dosya)) { $dosya = [string]$k.Kaynak }
    try {
        $script:SeciliDosya = $dosya
        $lblDosya.Text = [System.IO.Path]::GetFileNameWithoutExtension($dosya); $lblDosya.ForeColor = $cYazi
        Dosyayi-Kontrol-Et $dosya
        Yaz "YARIM KALAN İŞ: $([System.IO.Path]::GetFileName($dosya))  %$($k.Yuzde)  ($($k.Zaman)). Kaldığı yerden devam için BAŞLAT'a bas."
        $lblSure.Text = "Yarım kalan iş  ·  %$($k.Yuzde)  ·  devam için BAŞLAT"; $lblSure.ForeColor = $cAltinAc
    } catch { }
}

# Yüklenen işi çalıştır: Eding hazır olana kadar kısa süre dener; Eding hata verirse HEMEN bırakır (eskiden 60 sn deniyordu → panel kilitli görünüyordu)
function Is-Calistir {
    $son = (Get-Date).AddSeconds(15)
    $rc = -1
    do {
        [System.Windows.Forms.Application]::DoEvents()
        $rc = [Eding]::CncRunOrResumeJob()
        if (Rc-Tamam $rc) { break }
        $d = Eding-Durum
        if ((Hatali $d) -or $d -eq 'ABORTED') { [Kayit]::Yaz("BAŞLAT: Eding '$d' durumunda, tekrar denenmiyor (rc $rc)"); break }
        Start-Sleep -Milliseconds 400
    } while ((Get-Date) -lt $son)
    return $rc
}

# Orijinal program (CHECK_EMPTY_TOOL) iş milinde frez varken başlamaz: başlamadan önce sor, istenirse frezi yuvasına bırak
function Bos-Ismili-Hazirla {
    $tk = 0; try { $tk = [Eding]::CncGetCurrentToolNumber() } catch { }
    if ($tk -eq 0) { return $true }
    if ($script:Manuel) {
        [Kayit]::Show("İş milinde T$tk takılı görünüyor; iş boş iş miliyle başlar.`r`n`r`nFrezi tut, PENS AÇ'a bas ve frezi çıkar (takım T0 olur), PENS KAPAT, sonra tekrar BAŞLAT.", 'Başlat', 'OK', 'Information') | Out-Null
        return $false
    }
    if (-not (Onay "İş milinde T$tk takılı görünüyor.`r`nMakinenin programı işe boş iş miliyle başlar (yoksa hata verip durur).`r`n`r`nT$tk kendi yuvasına bırakılsın mı?`r`n(Yuvası boş olmalı.)" 'Başlat')) { return $false }
    Yaz "Başlat öncesi: T$tk yuvasına bırakılıyor (M6 T0)..."
    if (-not (Komut-Sonucu 'Frez bırak (M6 T0)' ([Eding]::CncRunSingleLine('M6 T0')))) { return $false }
    if (-not (Hareket-Bitene-Kadar-Bekle 120)) { Yaz 'Frez bırakma bitmedi.'; return $false }
    if ([Eding]::CncGetCurrentToolNumber() -ne 0) { [Kayit]::Show('Frez bırakılamadı; iş başlatılmadı.', 'Başlat', 'OK', 'Warning') | Out-Null; return $false }
    return $true
}

# BAŞLAT çift basılmasın: işlem sürerken (dosya kontrolü, yükleme) gelen ikinci basış yok sayılır
$script:BaslatMesgul = $false
function Btn-Baslat {
    if ($script:BaslatMesgul) { [Kayit]::Yaz('BAŞLAT: önceki basış hâlâ işleniyor, yok sayıldı'); return }
    $script:BaslatMesgul = $true
    try { Btn-Baslat-Ic } finally { $script:BaslatMesgul = $false }
}
function Btn-Baslat-Ic {
    if ($script:Manuel -and $script:Bagli -and $script:ApiHazir) {
        $ist = $null; try { $ist = Manuel-Istek; if ($ist -and $ist.Faz -eq 3) { $ist = $null } } catch { }
        if (-not $ist -and (Durakli-Mi)) { try { $ist = Manuel-Istek-Tahmin } catch { } }
        if ($ist) { Manuel-Diyalog $ist; return }   # manuel frez beklerken BAŞLAT = o adımı onayla
    }
    if ($script:Bagli -and (Durakli-Mi)) {
        if (-not $script:Sade -and -not (Onay "Duraklatılan kazımaya devam edilsin mi?" 'Devam')) { return }
        [void](Komut-Sonucu 'Devam' ([Eding]::CncRunOrResumeJob()))
        return
    }
    if ($script:Sade -and $script:Tercih.UzakKilit -ne '0' -and -not $script:BlokHazir -and ((Get-Date) - [WebSunucu]::SonUzakGirdi).TotalSeconds -lt 5) {
        # Başka bilgisayardan basıldı: makinede bloğun takıldığı onaylanmadan uzaktan başlatılmaz
        Yaz 'Uzaktan BAŞLAT reddedildi: makinede "Blok takıldı" onayı yok.'
        [Kayit]::Show("Uzaktan başlatmak için önce makinede bloğu takıp`r`nalttaki ""Blok takıldı"" düğmesine basılmalı.", 'Başlat', 'OK', 'Warning') | Out-Null; return
    }
    if (-not $script:SeciliDosya) { [Kayit]::Show('Önce DOSYA SEÇ ile bir .nc dosyası seç.', 'Başlat', 'OK', 'Information') | Out-Null; return }
    if ($script:Engel) { [Kayit]::Show('Dosyada hata var (aşağıdaki listeye bak). Kazıma başlatılmadı.', 'Başlat', 'OK', 'Error') | Out-Null; return }
    if (-not (Hazir-Mi 'Başlat')) { return }
    if ((Calisiyor-Mu)) { [Kayit]::Show('Makine şu an çalışıyor.', 'Başlat', 'OK', 'Warning') | Out-Null; return }
    if (-not (Makro-Hazir-Mi 'Başlat')) { return }

    # Bu dosyanın yarım kalmış kaydı varsa: kaldığı yerden mi, baştan mı?
    $dk = Devam-Oku
    if ($dk -and ([string]$dk.Dosya -eq $script:SeciliDosya -or [string]$dk.Kaynak -eq $script:SeciliDosya) -and -not $script:BekleyenBlok) {
        $ds = Devam-Diyalog $dk
        if ($ds.Sec -eq 'guvenli' -or $ds.Sec -eq 'yakin') { Devam-Baslat $dk $ds.Sec $ds.Takim; return }
        if ($ds.Sec -ne 'bastan') { return }
        Devam-Sil
    }

    if (-not $script:Sade -and $script:Uyarilar.Count -gt 0) {
        $m = "DİKKAT:`r`n`r`n" + ($script:Uyarilar -join "`r`n") + "`r`n`r`nYine de devam edilsin mi?"
        if ([Kayit]::Show($m, 'Uyarı', 'YesNo', 'Warning') -ne 'Yes') { return }
    }
    $tk = [Eding]::CncGetCurrentToolNumber()
    if ($script:Tercih.ModSor -ne '0' -and $script:SeciliDosya -ne $script:ModOnayliDosya) {
        $mod = Frez-Modu-Sor
        if (-not $mod) { return }
        if (-not (Frez-Modu-Yaz ($mod -eq 'MANUEL'))) { return }
        Start-Sleep -Milliseconds 300
        if ((Frez-Manuel-Mi) -ne ($mod -eq 'MANUEL')) {
            [Kayit]::Show("Frez modu Eding'e yazılamadı (#4030 = $([Eding]::CncGetVariable(4030))). İş başlatılmadı.", 'Frez modu', 'OK', 'Error') | Out-Null
            return
        }
    }
    # Frez modu Ayarlar'da seçilir; Eding'deki değer (#4030) seçimle aynı yapılır
    $manuel = $false
    if ($script:Manuel -and -not $script:OzelMakro) {
        [Kayit]::Show("Frez değişimi MANUEL seçili ama bu makinenin macro.cnc'si manuel değişimi desteklemiyor.`r`nAyarlar › PANEL'den OTOMATİK seç ya da PrimerMill makrosunu kur.", 'Başlat', 'OK', 'Warning') | Out-Null; return
    }
    if ($script:OzelMakro) {
        if ((Frez-Manuel-Mi) -ne $script:Manuel) {
            if (-not (Frez-Modu-Yaz $script:Manuel)) { return }
            Start-Sleep -Milliseconds 300
            if ((Frez-Manuel-Mi) -ne $script:Manuel) { [Kayit]::Show("Frez modu Eding'e yazılamadı (#4030). İş başlatılmadı.", 'Başlat', 'OK', 'Error') | Out-Null; return }
        }
        $manuel = $script:Manuel
    }
    if ($manuel -and -not (Manuel-Macro-Kontrol)) { return }
    # Yeni blok mu? (kalibrasyon testlerinde sorulmaz)
    $yuklenecek = $script:SeciliDosya
    $blok = $null
    if ($script:Sade -and $script:BekleyenBlok) {
        $blok = $script:BekleyenBlok
        try { $yuklenecek = Blok-Birlesik-Uret $script:SeciliDosya $blok; Dosyayi-Kontrol-Et $yuklenecek }
        catch { [Kayit]::Show("Blok ismi programa eklenemedi: $($_.Exception.Message)", 'Blok', 'OK', 'Error') | Out-Null; return }
        if ($script:Engel) {
            Dosyayi-Kontrol-Et $script:SeciliDosya
            [Kayit]::Show("Blok ismi eklenince program kontrolden geçemedi:`r`n$($script:SonHatalar -join "`r`n")`r`n`r`nKazıma başlatılmadı.", 'Blok', 'OK', 'Error') | Out-Null; return
        }
        Yaz "Yeni blok: önce '$($blok.Metin)' + referans çentiği kazınacak (T$($blok.Takim), saat $($blok.Konum)), sonra iş durmadan devam eder."
    }
    elseif ($script:Tercih.BlokSor -ne '0' -and [System.IO.Path]::GetFileName($script:SeciliDosya) -notlike 'PM_kalibrasyon*') {
        $blok = Blok-Sor
        if ($null -eq $blok) { return }
        if ($blok -ne 'eski') {
            try { $yuklenecek = Blok-Birlesik-Uret $script:SeciliDosya $blok; Dosyayi-Kontrol-Et $yuklenecek }
            catch { [Kayit]::Show("Blok numarası programa eklenemedi: $($_.Exception.Message)", 'Blok', 'OK', 'Error') | Out-Null; return }
            Yaz "Yeni blok: önce '$($blok.Metin)' kazınacak (T$($blok.Takim)), sonra iş. Program: $yuklenecek"
        }
    }
    $k = "Kazıma başlatılacak:`r`n$([System.IO.Path]::GetFileName($script:SeciliDosya))`r`n`r`n" +
         $(if ($blok -and $blok -ne 'eski') { "YENİ BLOK: önce '$($blok.Metin)' kazınacak (T$($blok.Takim), saat $($blok.Konum) yönünde, kenara yakın)`r`n`r`n" } else { '' }) +
         "Frez değişimi: $(if ($manuel) { 'MANUEL - her frezde panel sana hangisini takacağını söyleyecek' } else { 'OTOMATİK (magazin)' })`r`n`r`n" +
         "Kontrol et:`r`n" +
         "1. İş milinde freze YOK (şimdi yazılımdaki takım: T$tk)`r`n" +
         "2. $(if ($manuel) { 'Kullanılacak frezeler elinin altında' } else { 'Kullanılan frezeler yuvalarında' })`r`n" +
         "3. Blok takılı ve sıkıldı`r`n" +
         "4. Kompresör açık, kapak kapalı`r`n" +
         "5. Elin acil stop butonunda`r`n`r`nBAŞLATILSIN MI?"
    if (-not $script:Sade) { if (-not (Onay $k 'Kazımayı başlat')) { return } }
    if ($script:Sade -and -not (Bos-Ismili-Hazirla)) { return }

    $form.Cursor = 'WaitCursor'
    try {
        Hata-Temizle 'Başlat'
        try { if ([Eding]::CncGetVariable(4034) -ne 0) { [void][Eding]::CncRunSingleLine('#4034=0'); [void](Hareket-Bitene-Kadar-Bekle 3) } } catch { }
        if (-not (Bayrak-Sifirla 'Başlat')) { [Kayit]::Show("Takım bildirim bayrağı (#4039) sıfırlanamadı. Kazıma başlatılmadı.", 'Başlat', 'OK', 'Warning') | Out-Null; return }
        $script:ManuelSonSeq = ''
        Yaz "Eding'e yükleniyor: $($script:SeciliDosya)"
        if (-not (Komut-Sonucu 'Dosya yükleme' ([Eding]::CncLoadJobA($yuklenecek)))) { return }
        $rc = Is-Calistir
        if (Komut-Sonucu 'Başlat' $rc) {
            if ($blok -and $blok -ne 'eski') { Blok-Kaydet $blok $script:SeciliDosya }
            if ($script:Sade -and $script:BekleyenBlok) { $script:BekleyenBlok = $null }
            $script:BlokHazir = $false; if ($script:Sade) { Blok-Cip-Guncelle }
            $script:DevamDosya = $script:SeciliDosya; $script:DevamKaynak = $yuklenecek; $script:DevamHarita = $null
            Devam-Kaydet 1 'calisiyor' 0
            $script:ModOnayliDosya = $null
            $script:TakipSonu = ''
            $script:IsAktif = $true
            $script:Gecen   = [TimeSpan]::Zero
            $script:SonTik  = Get-Date
            $script:BaslamaAni = Get-Date
            $script:SonGecerliSatir = 0
            $script:CalistiGoruldu = $false
        }
    } finally { $form.Cursor = 'Default' }
}

function Btn-Duraklat {
    if (-not (Baglan)) { return }
    if (-not (Calisiyor-Mu)) { [Kayit]::Show('Şu an çalışan bir iş yok.', 'Duraklat', 'OK', 'Information') | Out-Null; return }
    [void](Komut-Sonucu 'Duraklat' ([Eding]::CncPauseJob()))
}

function Btn-Durdur([bool]$sor = $false) {
    if (-not (Baglan)) { return }
    # KU-02: ana ekrandaki DURDUR iş sürerken / duraklıyken onay ister (varsayılan HAYIR). Uzaktan ve manuel diyalogdan gelen çağrı sormaz.
    if ($sor -and (Is-Suruyor)) {
        if (-not (Onay "Kazıma DURDURULACAK (iş iptal edilir).`r`n`r`nKaldığı yerden devam ancak BAŞLAT › KALDIĞI YERDEN DEVAM ile yapılabilir.`r`nAcil bir durumsa ACİL STOP'a bas.`r`n`r`nDurdurulsun mu?" 'Durdur')) { return }
    }
    if (Komut-Sonucu 'Durdur' ([Eding]::CncAbortJob())) {
        if ($script:IsAktif) { Devam-Kaydet $script:SonGecerliSatir 'durduruldu' $bar.Value }
        $script:TakipSonu = 'kullanici'
        $script:IsAktif = $false
        $lblSure.Text = 'Durduruldu'
        $lblSure.ForeColor = $cSoluk
    }
}

function Btn-FrezBirak {
    if (-not (Hazir-Mi 'Frez Bırak')) { return }
    if ((Calisiyor-Mu)) { [Kayit]::Show('Makine çalışırken frez bırakılamaz. Önce DURDUR.', 'Frez Bırak', 'OK', 'Warning') | Out-Null; return }
    $tk = [Eding]::CncGetCurrentToolNumber()
    if ($tk -eq 0) { [Kayit]::Show('Yazılıma göre iş milinde freze yok (T0).', 'Frez Bırak', 'OK', 'Information') | Out-Null; return }
    if (-not (Onay "İş milindeki T$tk kendi yuvasına bırakılacak.`r`n`r`nT$tk yuvası BOŞ mu ve kompresör açık mı?" 'Frez Bırak')) { return }
    [void](Komut-Sonucu 'Frez Bırak (M6 T0)' ([Eding]::CncRunSingleLine('M6 T0')))
}

function Btn-Home([bool]$sor = $true) {
    if ([Eding]::AcilKilit) { [Kayit]::Show("ACİL STOP basılı.`r`nKaldırmak için RESET'e (ya da ACİL STOP butonuna) bas.", 'Home', 'OK', 'Warning') | Out-Null; return }
    if (-not (Baglan)) { [Kayit]::Show("Makineye bağlanılamadı. Eding birkaç saniye içinde açılmazsa programı yeniden başlat.", 'Home', 'OK', 'Warning') | Out-Null; return }
    if ([Eding]::CncGetEMStopActive() -ne 0) { [Kayit]::Show('Önce makinedeki acil stop butonunu bırak.', 'Home', 'OK', 'Warning') | Out-Null; return }
    if (Is-Suruyor-Uyari 'Home') { return }
    if ($sor -and -not $script:Sade -and -not (Onay "Makine home alacak: önce iş mili yukarı, sonra C kol düz, sonra X, Y, A, B.`r`n`r`nİş milinde freze olmamalı, kapak kapalı olmalı.`r`nDevam edilsin mi?" 'Home')) { return }

    $form.Cursor = 'WaitCursor'
    try {
        # Sürücüleri aç (Eding'deki RESET ile aynı)
        Yaz "Home: sürücüler açılıyor (reset): $([Eding]::RCText([Eding]::CncReset()))"
        Start-Sleep -Milliseconds 800

        # Home: makinenin orijinal home_all makrosu (orijinal yazılımdaki gibi)
        Yaz 'Home: makinenin home_all makrosu çalışıyor...'
        $rc = [Eding]::CncRunSingleLine('gosub home_all')
        if (-not (Rc-Tamam $rc)) { [void](Komut-Sonucu 'Home (gosub home_all)' $rc); return }
        if (-not (Hareket-Bitene-Kadar-Bekle 240)) {
            [Kayit]::Show("Home sırasında Eding hata verdi ya da hareket bitmedi.`r`nDetaylar kaydına bak.", 'Home', 'OK', 'Error') | Out-Null
            return
        }
        if ([Eding]::CncGetAllAxesHomed() -ne 0 -and -not (Hatali (Eding-Durum))) { Yaz 'Home tamamlandı.' }
        else { Yaz 'Home tamamlanmadı; Detaylar kaydına bak.'; [Kayit]::Show('Home tamamlanamadı. Detaylar penceresindeki kayda bak.', 'Home', 'OK', 'Warning') | Out-Null }
    } finally { $form.Cursor = 'Default' }
}

# ---------------- Kazıma hızı (Eding feed override) ----------------
$script:HizOran = $true          # Eding değeri 1.0 = %100 mü (true) yoksa 100 = %100 mü (false)
$script:HizUyarildi = $false
function Hiz-Oku {
    $v = [Eding]::CncGetActualFeedOverride()
    if ($v -gt 5) { $script:HizOran = $false; return [math]::Round($v) }
    $script:HizOran = $true
    return [math]::Round($v * 100)
}
function Hiz-Ayarla([int]$yuzde) {
    if (-not (Baglan)) { return }
    $yuzde = [math]::Max(30, [math]::Min(150, $yuzde))
    if ($yuzde -gt 120 -and -not $script:HizUyarildi) {
        $m = "Kazıma hızı %$yuzde yapılacak.`r`n`r`nHyperDent'in hızları malzeme ve frezeye göre hesaplanır. %120'nin üstü freze kırılması ve yüzey kalitesi için risklidir; özellikle zirkonya dışı sert malzemelerde.`r`n`r`nDevam edilsin mi?"
        if (-not (Onay $m 'Kazıma hızı')) { return }
        $script:HizUyarildi = $true
    }
    [void](Hiz-Oku)
    $deger = if ($script:HizOran) { $yuzde / 100.0 } else { [double]$yuzde }
    $rc = [Eding]::CncSetFeedOverride($deger)
    Start-Sleep -Milliseconds 300
    $okunan = Hiz-Oku
    Yaz "Kazıma hızı: %$yuzde istendi -> $([Eding]::RCText($rc)), Eding'deki değer: %$okunan"
    if ([math]::Abs($okunan - $yuzde) -gt 2) {
        [Kayit]::Show("Eding hız ayarını kabul etmedi (şu an %$okunan).`r`nEding'in ayarlarında hız kaynağı (feed override source) panel yerine başka bir kaynağa (örneğin makinedeki düğmeye) bağlı olabilir.", 'Kazıma hızı', 'OK', 'Warning') | Out-Null
    }
    $lblHiz.Text = "%$okunan"
}

# ---------------- Açılışta otomatik hazırlık ----------------
$script:AcilisDurum = 'bekliyor'   # bekliyor -> acilstop -> tamam / iptal

function Geri-Sayim([int]$saniye, [string]$metin) {
    $f = New-Object System.Windows.Forms.Form
    $f.Text = 'PrimerMill'
    $f.ClientSize = New-Object System.Drawing.Size(460, 190)
    $f.StartPosition = 'CenterParent'
    $f.FormBorderStyle = 'FixedDialog'
    $f.ControlBox = $false
    $f.TopMost = $true
    $f.BackColor = $cZemin; $f.ForeColor = $cYazi
    $f.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $l = New-Object System.Windows.Forms.Label
    $l.SetBounds(20, 16, 420, 70); $l.Text = $metin
    $f.Controls.Add($l)
    $sayac = New-Object System.Windows.Forms.Label
    $sayac.SetBounds(20, 86, 420, 40); $sayac.TextAlign = 'MiddleCenter'
    $sayac.Font = New-Object System.Drawing.Font('Segoe UI Light', 22); $sayac.ForeColor = $cAltinAc
    $sayac.Text = "$saniye"
    $f.Controls.Add($sayac)
    $iptal = New-Object System.Windows.Forms.Button
    $iptal.Text = 'İptal'; $iptal.SetBounds(240, 138, 100, 34); $iptal.FlatStyle = 'Flat'
    $iptal.ForeColor = $cYazi; $iptal.BackColor = $cPanel; $iptal.DialogResult = 'Cancel'
    $f.Controls.Add($iptal)
    $simdi = New-Object System.Windows.Forms.Button
    $simdi.Text = 'Şimdi başla'; $simdi.SetBounds(120, 138, 110, 34); $simdi.FlatStyle = 'Flat'
    $simdi.ForeColor = $cAltinAc; $simdi.BackColor = $cPanel; $simdi.DialogResult = 'OK'
    $f.Controls.Add($simdi)
    $f.CancelButton = $iptal
    $script:GsKalan = $saniye
    $t = New-Object System.Windows.Forms.Timer
    $t.Interval = 1000
    $t.Add_Tick({ $script:GsKalan--; $sayac.Text = "$($script:GsKalan)"; if ($script:GsKalan -le 0) { $f.DialogResult = 'OK' } })
    $t.Start()
    $r = $f.ShowDialog($form)
    $t.Stop(); $t.Dispose(); $f.Dispose()
    [Kayit]::Yaz("GERİ SAYIM [$($metin.Split("`n")[0])] -> $r")
    return ($r -eq 'OK')
}

# Zamanlayıcıdan çağrılır: bağlantı kurulduktan sonra bir kez çalışır
function Acilis-Hazirla {
    if ($script:AcilisDurum -eq 'tamam' -or $script:AcilisDurum -eq 'iptal' -or $script:AcilisDurum -eq 'calisiyor') { return }
    if ([Eding]::AcilKilit) { Yaz 'Açılış: ACİL STOP basılı, otomatik hazırlık (reset + home) yapılmadı.'; $script:AcilisDurum = 'iptal'; return }
    $d = Eding-Durum
    if ($d -eq '' -or $d -eq 'POWERUP') { return }   # Eding henüz açılıyor
    if ([Eding]::CncGetEMStopActive() -ne 0) {
        if ($script:AcilisDurum -ne 'acilstop') { Yaz 'Açılış: acil stop basılı. Bırakınca hazırlık otomatik devam edecek.'; $script:AcilisDurum = 'acilstop' }
        return
    }
    if ((Mesgul $d) -or $d -like 'PAUSE*') { Yaz "Açılış: Eding meşgul ya da duraklı ($d), otomatik hazırlık atlandı."; $script:AcilisDurum = 'tamam'; return }
    $script:AcilisDurum = 'calisiyor'
    try {
        Yaz 'Açılış: otomatik hazırlık başladı.'
        Yaz "Açılış: reset -> $([Eding]::RCText([Eding]::CncReset()))"
        Start-Sleep -Milliseconds 800
        if ([Eding]::CncGetAllAxesHomed() -ne 0) {
            Yaz 'Açılış: makine zaten home alınmış.'
        } else {
            $m = "Makine home alacak: Z, X, Y, A ve B eksenleri sırayla hareket edecek.`r`nKabinde elin olmasın, kapak kapalı olsun."
            $gs = [int]$script:Tercih.GeriSayim
            if ($gs -le 0 -or (Geri-Sayim $gs $m)) { Btn-Home $false }
            else { Yaz 'Açılış: home iptal edildi. HOME butonuyla elle başlatabilirsin.'; $script:AcilisDurum = 'iptal'; return }
        }
        if ([Eding]::CncGetAllAxesHomed() -ne 0 -and -not (Hatali (Eding-Durum))) {
            Yaz 'Açılış: makine hazır. Dosya seçip kazımaya başlayabilirsin.'
            if (-not $script:SeciliDosya) { $lblDosya.Text = 'Makine hazır  ·  bir dosya seçin' }
        }
    } finally { if ($script:AcilisDurum -eq 'calisiyor') { $script:AcilisDurum = 'tamam' } }
}

# Paneli yeni açılmış hale getir
function Panel-Sifirla {
    $script:TakipSonu = 'kullanici'
    $script:IsAktif = $false
    try { if ($script:Bagli -and [Eding]::CncGetVariable(4034) -ne 0) { [void][Eding]::CncRunSingleLine('#4034=0') } } catch { }
    $script:ManuelSonSeq = ''
    $script:Gecen = [TimeSpan]::Zero
    $script:SonTik = $null
    $script:SeciliDosya = $null
    $script:Analiz = $null
    $script:Engel = $true
    $script:Uyarilar = @()
    $script:DetayIlerleme = ''
    $script:SonYuzdeLog = -1
    $script:SonGecerliSatir = 0
    $bar.Dancing = $false
    $bar.Animal = -1
    $bar.Caption = ''
    $bar.Value = 0
    $lblSure.Text = ''
    $lblSure.ForeColor = $cSoluk
    $lblDosya.Text = 'Bir dosya seçin'
    $lblDosya.ForeColor = $cSoluk
    $sim.SetData($null)
    $simBuyuk.SetData($null)
    Yaz 'Panel sıfırlandı.'
}

# ================= YAZILIM ACİL STOPU =================
# Fiziksel buton yok: panel işi keser, iş milini ve havayı kapatır, kilitlenir.
# Kilit kalkana kadar panelden hiçbir hareket komutu Eding'e gitmez; Eding'de biri BAŞLAT'a basarsa iş yine kesilir.
function Acil-Stop([string]$kaynak) {
    $ilk = -not [Eding]::AcilKilit
    [Eding]::AcilKilit = $true
    $estop.Latched = $true
    if ($ilk) { [Kayit]::Yaz("!!! ACİL STOP ($kaynak) !!!") }
    $script:Tercih.AcilStop = '1'; try { Tercih-Yaz } catch { }
    if ($script:ApiHazir -and $script:Bagli) {
        try { [Kayit]::Yaz("ACİL STOP: işi kes -> $([Eding]::RCText([Eding]::CncAbortJob()))") } catch { }
        try { [void][Eding]::CncSetOutput(4, 0) } catch { }    # iş mili çıkışı
        try { [void][Eding]::CncSetOutput(11, 0) } catch { }   # hava üfleme (AUX4)
        Start-Sleep -Milliseconds 250
        try { [void][Eding]::CncAbortJob() } catch { }
        try {
            [void][Eding]::CncReset()
            foreach ($l in @('M5', 'M9', 'M55 P4')) { [Kayit]::Yaz("ACİL STOP: $l -> $([Eding]::RCText([Eding]::CncRunSingleLineZorla($l)))") }
        } catch { }
    } else {
        [Kayit]::Yaz('ACİL STOP: Eding bağlı değil, sadece panel kilitlendi')
    }
    $script:IsAktif = $false
    $script:TakipSonu = 'kullanici'
    $bar.Dancing = $false
    $lblSure.Text = 'ACİL STOP ile durduruldu'; $lblSure.ForeColor = $cKirmizi
    Durum-Yaz 'ACİL STOP  ·  kaldırmak için RESET' $cKirmizi
    $lamba.LampColor = [System.Drawing.Color]::FromArgb(230, 20, 20)
}

function Acil-Stop-Kaldir {
    if (-not [Eding]::AcilKilit) { return }
    if (-not (Onay "ACİL STOP kaldırılacak.`r`n`r`n• Makinenin içinde el, alet ya da sıkışmış parça yok mu?`r`n• Kapak kapalı mı?`r`n`r`nKaldırınca makine kendiliğinden HAREKET ETMEZ; işe yeniden BAŞLAT ile başlarsın." 'Acil stop kaldır')) { return }
    [Eding]::AcilKilit = $false
    $estop.Latched = $false
    $script:Tercih.AcilStop = '0'; try { Tercih-Yaz } catch { }
    [Kayit]::Yaz('ACİL STOP kaldırıldı')
    if (Baglan) {
        try { [Kayit]::Yaz("ACİL STOP kaldır: reset -> $([Eding]::RCText([Eding]::CncReset()))") } catch { }
    }
    $script:PensAcik = $false
    $btnPens.Text = 'PENS AÇ'
    Panel-Sifirla
    Yaz 'Acil stop kaldırıldı. Makine hazır.'
}

# GV-05: Kayit.Show pencerelerinde Esc ve kırmızı ACİL STOP düğmesi bu işlevi çağırır
[Kayit]::AcilStop = [System.Action]{ Acil-Stop 'diyalog' }

function Btn-Reset {
    if ([Eding]::AcilKilit) { Acil-Stop-Kaldir; return }
    if (-not (Baglan)) { [Kayit]::Show("Eding CNC'ye bağlanılamadı.", 'Reset', 'OK', 'Warning') | Out-Null; return }
    if ([Eding]::CncGetEMStopActive() -ne 0) { [Kayit]::Show('Önce makinedeki acil stop butonunu bırak, sonra RESET.', 'Reset', 'OK', 'Warning') | Out-Null; return }
    if ((Is-Suruyor)) {
        if (-not (Onay 'Makine çalışıyor ya da duraklatılmış bir iş var. RESET işi durdurur. Devam edilsin mi?' 'Reset')) { return }
    }
    if (Komut-Sonucu 'Reset' ([Eding]::CncReset())) {
        $script:PensAcik = $false
        $btnPens.Text = 'PENS AÇ'
        Panel-Sifirla
    }
}

$script:PensAcik = $false
function Btn-Pens {
    if (-not (Hazir-Mi 'Pens')) { return }
    if ((Calisiyor-Mu)) { [Kayit]::Show('Makine çalışırken pens açılamaz.', 'Pens', 'OK', 'Warning') | Out-Null; return }
    if (-not $script:PensAcik) {
        # Onay Pens-Ac-T0 içinde (K2: bütün "Pens aç" düğmeleri aynı onayı ve M5 beklemesini kullanır)
        if (Pens-Ac-T0 'Pens aç') { $script:PensAcik = $true; $btnPens.Text = 'PENS KAPAT' }
    } else {
        if (Komut-Sonucu 'Pens kapat (M55 P2)' ([Eding]::CncRunSingleLine('M55 P2'))) { $script:PensAcik = $false; $btnPens.Text = 'PENS AÇ' }
    }
}

function Mdi-Gonder {
    $komut = $txtMdi.Text.Trim()
    if (-not $komut) { return }
    if (-not (Baglan)) { Yaz 'MDI: makine bağlı değil.'; return }
    if ((Is-Suruyor)) { Yaz 'MDI: iş sürerken ya da duraklıyken komut gönderilemez.'; return }
    # KU-03: MDI satırı makineyi doğrudan hareket ettirebilir; tam satır gösterilip onay alınır (varsayılan HAYIR)
    if (-not (Onay "Şu satır Eding'e gönderilecek (MDI):`r`n`r`n    $komut`r`n`r`nMakine bu satırı hemen çalıştırır. Gönderilsin mi?" 'MDI')) { Yaz "MDI: vazgeçildi ($komut)"; return }
    Yaz "MDI> $komut"
    $rc = [Eding]::CncRunSingleLine($komut)
    Yaz ("     " + [Eding]::RCText($rc))
    $txtMdi.Clear()
}

$script:TemizlikDuz = $false
function Btn-Temizlik {
    # 1. basış: iş mili yukarı, C kol yatay (temizlik).  2. basış: iş mili yukarı, park konumu (G30, home sonrası durduğu yer).
    if (-not (Hazir-Mi 'Temizlik')) { return }
    if ((Calisiyor-Mu)) { [Kayit]::Show('Makine çalışıyor. Önce DURDUR.', 'Temizlik', 'OK', 'Warning') | Out-Null; return }
    $form.Cursor = 'WaitCursor'
    try {
        if (-not (Komut-Sonucu 'Z en üste' ([Eding]::CncRunSingleLine('G53 G0 Z[#5163]')))) { return }
        if (-not (Hareket-Bitene-Kadar-Bekle 30)) { Yaz 'Z hareketi bitmedi, kol döndürülmedi.'; return }
        if (-not $script:TemizlikDuz) {
            if (Komut-Sonucu 'Kol yatay' ([Eding]::CncRunSingleLine('G53 G0 A[#5224] B[#5225]'))) {
                if (-not (Hareket-Bitene-Kadar-Bekle 30)) { Yaz 'Kol hareketi bitmedi ya da durum okunamadı.'; return }
                $script:TemizlikDuz = $true; $btnTemizlik.Text = 'PARK'
                Yaz 'Temizlik: kol yatay. Bitince PARK''a bas.'
            }
        } else {
            if (Komut-Sonucu 'Park konumu (G30)' ([Eding]::CncRunSingleLine('G30'))) {
                if (-not (Hareket-Bitene-Kadar-Bekle 60)) { Yaz 'Park hareketi bitmedi ya da durum okunamadı.'; return }
                $script:TemizlikDuz = $false; $btnTemizlik.Text = 'TEMİZLİK'
                Yaz 'Park konumuna dönüldü.'
            }
        }
    } finally { $form.Cursor = 'Default'; $btnTemizlik.Invalidate() }
}

# ---------------- Renkler ----------------
$cZemin   = [System.Drawing.Color]::FromArgb(14, 16, 20)
$cPanel   = [System.Drawing.Color]::FromArgb(21, 24, 30)
$cAltin   = [System.Drawing.Color]::FromArgb(212, 175, 55)
$cAltinAc = [System.Drawing.Color]::FromArgb(240, 220, 150)
$cYazi    = [System.Drawing.Color]::FromArgb(229, 231, 235)
$cSoluk   = [System.Drawing.Color]::FromArgb(140, 146, 158)
$cYesil   = [System.Drawing.Color]::FromArgb(52, 211, 153)
$cKirmizi = [System.Drawing.Color]::FromArgb(248, 113, 113)

# ---------------- Pencere ----------------
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Primer Teknoloji'
$form.ClientSize = New-Object System.Drawing.Size(1000, 640)
$form.StartPosition = 'CenterScreen'
$form.BackColor = $cZemin
$form.ForeColor = $cYazi
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false

function Etiket([string]$yazi, [string]$font, [float]$boyut, [System.Drawing.Color]$renk, [int]$y, [int]$h, [int]$x = 100, [int]$w = 800) {
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $yazi
    $l.Font = New-Object System.Drawing.Font($font, $boyut)
    $l.ForeColor = $renk
    $l.BackColor = [System.Drawing.Color]::Transparent
    $l.TextAlign = 'MiddleCenter'
    $l.AutoEllipsis = $true
    $l.SetBounds($x, $y, $w, $h)
    $form.Controls.Add($l)
    return $l
}

$baslik = New-Object EngravedTitle
$baslik.Text = 'PrimerMill'
$baslik.Grooves = $false
$baslik.Chrome = $true
$baslik.SetBounds(220, 10, 560, 86)
$form.Controls.Add($baslik)

$lamba = New-Object StatusLamp
$lamba.SetBounds(40, 16, 72, 72)

# Yazılım ACİL STOP butonu (sağ üst). Basınca hemen durur; tekrar basınca / RESET ile kaldırılır.
$estop = New-Object EStopButton
$estop.SetBounds(878, 4, 104, 104)
$estop.Add_MouseDown({ param($s, $e)
    if ($e.Button -ne 'Left') { return }
    if ([Eding]::AcilKilit) { Acil-Stop-Kaldir } else { Acil-Stop 'buton' }
})
$form.Controls.Add($estop)
$tip = New-Object System.Windows.Forms.ToolTip
$tip.SetToolTip($estop, 'ACİL STOP (klavye: Esc). Kaldırmak için RESET ya da bu butona tekrar bas.')
$form.Controls.Add($lamba)

function Yumurta([string]$yazi, [string]$ikon, [int]$sira, [int[]]$ust, [int[]]$alt, [scriptblock]$is) {
    $b = New-Object EggButton
    $b.Text = $yazi
    $b.Icon = $ikon
    $b.TopColor    = [System.Drawing.Color]::FromArgb($ust[0], $ust[1], $ust[2])
    $b.BottomColor = [System.Drawing.Color]::FromArgb($alt[0], $alt[1], $alt[2])
    $b.SetBounds(24 + $sira * 106, 112, 100, 144)
    $b.Add_Click({ [Kayit]::Yaz("TUŞ: " + $this.Text) })
    $b.Add_Click($is)
    $form.Controls.Add($b)
    return $b
}

$btnHome     = Yumurta 'HOME'       ([string][char]0xE80F) 1 @(80, 100, 135) @(20, 28, 48)  { Btn-Home }
$btnDosya    = Yumurta 'DOSYA SEÇ'  ([string][char]0xE8B7) 0 @(37, 70, 160) @(10, 22, 60)  { Btn-DosyaSec }
$btnBaslat   = Yumurta 'BAŞLAT'     ([string][char]0xE768) 2 @(16, 140, 95) @(3, 44, 30)   { Btn-Baslat }
$btnDuraklat = Yumurta 'DURAKLAT'   ([string][char]0xE769) 3 @(200, 120, 20) @(70, 32, 4)  { Btn-Duraklat }
$btnDurdur   = Yumurta 'DURDUR'     ([string][char]0xE71A) 4 @(200, 35, 35) @(70, 10, 10)  { Btn-Durdur $true }
$btnReset    = Yumurta 'RESET'      ([string][char]0xE72C) 5 @(190, 160, 60) @(70, 55, 10)  { Btn-Reset }
$btnFrez     = Yumurta 'FREZ BIRAK' ([string][char]0xE896) 6 @(95, 105, 120) @(17, 24, 39) { Btn-FrezBirak }
$btnPens     = Yumurta 'PENS AÇ'    ([string][char]0xE785) 7 @(14, 116, 144) @(8, 47, 73)   { Btn-Pens }
$btnTemizlik = Yumurta 'TEMİZLİK'   ([string][char]0xE7AD) 8 @(124, 58, 237) @(46, 16, 101) { Btn-Temizlik }

# Simülasyon (solda) ve sade bilgi alanı (sağda)
$sim = New-Object SimView
$sim.SetBounds(40, 284, 440, 232)
$sim.Add_Click({ [Kayit]::Yaz('TUŞ: Simülasyon (büyük görünüm)'); $simForm.TopMost = $form.TopMost; $simForm.Show(); $simBuyuk.SetLine($sim.R.CurrentLine); $simForm.Activate() })
$form.Controls.Add($sim)

$lblDosya = Etiket 'Bir dosya seçin' 'Segoe UI Light' 14 $cSoluk 284 30 500 460

$bar = New-Object LuxProgress
$bar.SetBounds(500, 316, 460, 96)
$form.Controls.Add($bar)

$lblSure = Etiket '' 'Segoe UI' 10.5 $cSoluk 416 24 500 460
$lblDurum = Etiket '●  Hazır' 'Segoe UI' 11 $cSoluk 444 26 500 460

# Alt satır: [⚙ Ayarlar] [☰ Detaylar] [● Frez: Manuel] [− %100 +]  — eşit yükseklikte, sağ sütuna hizalı
function Cip-Ekle([string]$metin, [string]$glyph, [int]$x, [int]$w) {
    $c = New-Object Cip
    $c.Text = $metin; $c.Glyph = $glyph
    $c.SetBounds($x, 476, $w, 32)
    $form.Controls.Add($c); return $c
}
$lnkAyar  = Cip-Ekle 'Ayarlar'  ([string][char]0xE713) 500 104
$lnkDetay = Cip-Ekle 'Detaylar' ([string][char]0xE8FD) 610 112
$lnkMod   = Cip-Ekle 'Frez: —'  '' 728 128
$lnkMod.Vurgu = $cAltin
$lblHiz = New-Object HizCip
$lblHiz.Text = '%100'; $lblHiz.ForeColor = $cAltinAc
$lblHiz.SetBounds(862, 476, 98, 32)
$form.Controls.Add($lblHiz)
$tipCip = New-Object System.Windows.Forms.ToolTip
$tipCip.SetToolTip($lblHiz, 'Kazıma hızı: − / + 10 · ortasına tıkla: %100')
$tipCip.SetToolTip($lnkMod, $(if ($script:Sade) { 'Yeni blok: ismini ve referans çentiğini kazı' } else { 'Frez değişimi: manuel / otomatik' }))
if ($script:Sade) { $lnkMod.Text = 'Blok takıldı'; $lnkMod.Glyph = [string][char]0xE710 }

$lnkDetay.Add_Click({ [Kayit]::Yaz('TUŞ: Detaylar'); $detay.TopMost = $form.TopMost; $detay.Show(); $detay.BringToFront(); $detay.Activate() })
$lnkAyar.Add_Click({
    [Kayit]::Yaz('TUŞ: Ayarlar')
    if (-not $script:ApiHazir) { [Kayit]::Show('Ayarlar sadece makinenin bilgisayarında kullanılabilir.', 'Ayarlar', 'OK', 'Information') | Out-Null; return }
    $ayar.TopMost = $form.TopMost; $ayar.Show(); $ayar.BringToFront(); $ayar.Activate()
})
$lnkMod.Add_Click({
    if ($script:Sade) { [Kayit]::Yaz('TUŞ: Yeni blok'); Yeni-Blok; return }
    [Kayit]::Yaz('TUŞ: Frez modu')
    if (-not (Baglan)) { return }
    if ((Calisiyor-Mu) -or (Durakli-Mi)) { [Kayit]::Show('İş sürerken frez değişim modu değiştirilemez.', 'Frez modu', 'OK', 'Information') | Out-Null; return }
    $mod = Frez-Modu-Sor
    if ($mod) { if ((Frez-Modu-Yaz ($mod -eq 'MANUEL')) -and $mod -eq 'MANUEL') { [void](Manuel-Macro-Kontrol) } }
})
$lblHiz.add_Azalt({ [Kayit]::Yaz('TUŞ: Hız −'); Hiz-Ayarla ([int]($lblHiz.Text.TrimStart('%')) - 10) })
$lblHiz.add_Arttir({ [Kayit]::Yaz('TUŞ: Hız +'); Hiz-Ayarla ([int]($lblHiz.Text.TrimStart('%')) + 10) })
$lblHiz.add_Sifirla({ [Kayit]::Yaz('TUŞ: Hız %100'); Hiz-Ayarla 100 })

# Taban: Primer Teknoloji
$cizgi = New-Object System.Windows.Forms.Label
$cizgi.BackColor = [System.Drawing.Color]::FromArgb(110, 200, 205, 215)
$cizgi.SetBounds(350, 526, 300, 1)
$form.Controls.Add($cizgi)
$marka = New-Object EngravedTitle
$marka.Text = 'P R İ M E R     T E K N O L O J İ'
$marka.FontName = 'Segoe UI Semibold'
$marka.Style = [System.Drawing.FontStyle]::Regular
$marka.SizeRatio = 0.62
$marka.Skew = 0
$marka.Grooves = $false
$marka.SetBounds(250, 534, 500, 38)
$form.Controls.Add($marka)

# ---------------- Anlık eksen değerleri (butonların altında) ----------------
# Alttaki her şeyi 40 px aşağı kaydır, araya koordinat satırını koy
foreach ($c in @($form.Controls)) { if ($c.Top -ge 270) { $c.Top += 40 } }
$script:KoordMakine = $false
$lblKoordTur = New-Object System.Windows.Forms.Label
$lblKoordTur.Text = 'İŞ'
$lblKoordTur.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 8)
$lblKoordTur.ForeColor = $cAltin
$lblKoordTur.TextAlign = 'MiddleLeft'
$lblKoordTur.SetBounds(40, 272, 70, 28)
$lblKoordTur.Cursor = [System.Windows.Forms.Cursors]::Hand
$form.Controls.Add($lblKoordTur)
$script:KoordLbl = @{}
$eks = @('X', 'Y', 'Z', 'A', 'B')
for ($i = 0; $i -lt 5; $i++) {
    $h = New-Object System.Windows.Forms.Label
    $h.Text = $eks[$i]
    $h.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 11)
    $h.ForeColor = $cAltin
    $h.TextAlign = 'MiddleRight'
    $h.SetBounds(110 + $i * 170, 272, 26, 28)
    $h.Cursor = [System.Windows.Forms.Cursors]::Hand
    $form.Controls.Add($h)
    $v = New-Object System.Windows.Forms.Label
    $v.Text = '—'
    $v.Font = New-Object System.Drawing.Font('Consolas', 14)
    $v.ForeColor = [System.Drawing.Color]::FromArgb(225, 230, 238)
    $v.TextAlign = 'MiddleRight'
    $v.SetBounds(136 + $i * 170, 272, 120, 28)
    $v.Cursor = [System.Windows.Forms.Cursors]::Hand
    $form.Controls.Add($v)
    $script:KoordLbl[$eks[$i]] = $v
    foreach ($k in @($h, $v)) { $k.Add_Click({ Koord-Degistir }) }
}
$lblKoordTur.Add_Click({ Koord-Degistir })
$koordCizgi = New-Object System.Windows.Forms.Label
$koordCizgi.BackColor = [System.Drawing.Color]::FromArgb(45, 255, 255, 255)
$koordCizgi.SetBounds(40, 304, 920, 1)
$form.Controls.Add($koordCizgi)

function Koord-Degistir {
    $script:KoordMakine = -not $script:KoordMakine
    $lblKoordTur.Text = if ($script:KoordMakine) { 'MAKİNE' } else { 'İŞ' }
    [Kayit]::Yaz("TUŞ: Koordinat görünümü -> $($lblKoordTur.Text)")
}

function Koord-Guncelle {
    if (-not $script:ApiHazir -or -not $script:Bagli) { foreach ($k in $script:KoordLbl.Keys) { $script:KoordLbl[$k].Text = '—' }; return }
    try {
        $p = if ($script:KoordMakine) { [Eding]::MachinePos() } else { [Eding]::WorkPos() }
        $ci = [System.Globalization.CultureInfo]::InvariantCulture
        $yeni = @{ X = $p.X.ToString('0.000', $ci); Y = $p.Y.ToString('0.000', $ci); Z = $p.Z.ToString('0.000', $ci); A = $p.A.ToString('0.000', $ci); B = $p.B.ToString('0.000', $ci) }
        foreach ($k in $script:KoordLbl.Keys) { if ($script:KoordLbl[$k].Text -ne $yeni[$k]) { $script:KoordLbl[$k].Text = $yeni[$k] } }
    } catch { }
}

$koordZaman = New-Object System.Windows.Forms.Timer
$koordZaman.Interval = 50
$koordZaman.Add_Tick({ Koord-Guncelle })

# ---------------- Büyük simülasyon penceresi ----------------
$simForm = New-Object System.Windows.Forms.Form
$simForm.Text = 'Simülasyon  ·  PrimerMill'
$simForm.ClientSize = New-Object System.Drawing.Size(1100, 680)
$simForm.StartPosition = 'CenterScreen'
$simForm.BackColor = $cZemin
$simForm.Padding = New-Object System.Windows.Forms.Padding(16)
$simForm.Owner = $form
$simBuyuk = New-Object SimView
$simBuyuk.Dock = 'Fill'
$simBuyuk.Cursor = [System.Windows.Forms.Cursors]::Default
$simForm.Controls.Add($simBuyuk)
$simForm.Add_FormClosing({ param($s, $e) if ($e.CloseReason -eq 'UserClosing') { $e.Cancel = $true; $simForm.Hide() } })



# ---------------- Ayarlar penceresi ----------------
$script:AdimMm = 1.0
$script:Hiz    = 300
$script:SonYuva = $null

function Sayi([double]$v) { return $v.ToString('0.000', [System.Globalization.CultureInfo]::InvariantCulture) }

function Metin-Sayi([string]$t) {
    $v = 0.0
    if ([double]::TryParse($t.Replace(',', '.'), [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$v)) { return $v }
    return $null
}

# --- Yuva geometrisi: macro.cnc'den okunur (bulunamazsa Bloomden X5 değerleri) ---
$script:YuvaX = 72.25
$TakimY = [ordered]@{ 'T1' = -39; 'T2' = -27; 'T3' = -15; 'Sensör' = 0; 'T4' = 15; 'T5' = 27; 'T6' = 39 }
$script:YuvaMutlak = @{}   # macro'da G53 ile sabit yazılmış yuvalar: T1 -> @{X;Y;A;B}
function Yuva-Geometrisi-Oku {
    $yol = [System.IO.Path]::Combine($EdingKlasor, 'macro.cnc')
    if (-not [System.IO.File]::Exists($yol)) { return 'macro.cnc bulunamadı, varsayılan değerler kullanılıyor.' }
    try {
        $fs = New-Object System.IO.FileStream($yol, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $sr = New-Object System.IO.StreamReader($fs); $metin = $sr.ReadToEnd(); $sr.Close()
    } catch { return "macro.cnc okunamadı: $($_.Exception.Message)" }
    $mx = [regex]::Match($metin, '#5221\s*-\s*([0-9.]+)')
    if ($mx.Success) { $script:YuvaX = [double]::Parse($mx.Groups[1].Value, [System.Globalization.CultureInfo]::InvariantCulture) }
    for ($n = 1; $n -le 6; $n++) {
        $blok = [regex]::Match($metin, "(?ism)^[ \t]*sub\s+PickTool$n\b(.*?)^[ \t]*endsub")
        if ($blok.Success) {
            $ci = [System.Globalization.CultureInfo]::InvariantCulture
            $mxy = [regex]::Match($blok.Groups[1].Value, '(?i)g53[^\r\n]*?\bx(-?[0-9.]+)\s*y(-?[0-9.]+)')
            $mab = [regex]::Match($blok.Groups[1].Value, '(?i)g53[^\r\n]*?\ba(-?[0-9.]+)\s*b(-?[0-9.]+)')
            if ($mxy.Success) {
                $script:YuvaMutlak["T$n"] = @{ X = [double]::Parse($mxy.Groups[1].Value, $ci); Y = [double]::Parse($mxy.Groups[2].Value, $ci)
                    A = $(if ($mab.Success) { [double]::Parse($mab.Groups[1].Value, $ci) } else { $null }); B = $(if ($mab.Success) { [double]::Parse($mab.Groups[2].Value, $ci) } else { $null }) }
                continue
            }
            $my = [regex]::Match($blok.Groups[1].Value, '#5222\s*([+-])\s*([0-9.]+)')
            if ($my.Success) {
                $v = [double]::Parse($my.Groups[2].Value, [System.Globalization.CultureInfo]::InvariantCulture)
                $TakimY["T$n"] = if ($my.Groups[1].Value -eq '-') { -$v } else { $v }
            }
        }
    }
    $yaz = foreach ($k in $TakimY.Keys) { if ($script:YuvaMutlak[$k]) { "$k G53 Y$($script:YuvaMutlak[$k].Y)" } else { "$k $($TakimY[$k])" } }
    return ("macro.cnc'den okundu:  X mesafesi {0}   ·   " -f $script:YuvaX) + ($yaz -join '  ')
}

# --- Panel tercihleri: panel_ayarlar.ini ---
$TercihDosyasi = [System.IO.Path]::Combine($ScriptKlasor, 'panel_ayarlar.ini')
$script:Tercih = @{ OtomatikHazirlik = '1'; GeriSayim = '5'; Dansci = '1'; Koordinat = 'IS'; ModSor = '1'; EdingSifirla = '1'; EdingGizli = '1'; BlokSor = '1'; SanalKlavye = '1'; TamEkran = '1'; WinBaslangic = '1' }
function Tercih-Oku {
    if (-not [System.IO.File]::Exists($TercihDosyasi)) { return }
    foreach ($l in [System.IO.File]::ReadAllLines($TercihDosyasi)) {
        $m = [regex]::Match($l, '^\s*(\w+)\s*=\s*(.*?)\s*$')
        if ($m.Success) { $script:Tercih[$m.Groups[1].Value] = $m.Groups[2].Value }
    }
}
function Tercih-Yaz {
    try { [System.IO.File]::WriteAllLines($TercihDosyasi, @($script:Tercih.Keys | Sort-Object | ForEach-Object { "$_=$($script:Tercih[$_])" })) } catch { }
}
Tercih-Oku
if ($script:Sade) { $script:Tercih.ModSor = '0'; $script:Tercih.BlokSor = '0'; $script:Tercih.EdingSifirla = '0' }
if (-not $script:Tercih.ContainsKey('Uzak')) { $script:Tercih.Uzak = $(if ($script:Sade) { '1' } else { '0' }) }
if (-not $script:Tercih.ContainsKey('UzakKilit')) { $script:Tercih.UzakKilit = '1' }
if (-not $script:Tercih.ContainsKey('WebPin')) { $script:Tercih.WebPin = "$(Get-Random -Minimum 1000 -Maximum 9999)"; Tercih-Yaz }
# Frez değişimi: OTOMATİK (magazin) / MANUEL (frezleri elle takarım) — Ayarlar › PANEL'den bir kez seçilir, kayıtlı kalır
if (@('OTOMATIK', 'MANUEL') -notcontains [string]$script:Tercih.FrezModu) { $script:Tercih.FrezModu = 'OTOMATIK' }
$script:Manuel = ($script:Tercih.FrezModu -eq 'MANUEL')
if (-not $script:Tercih.MakineAdi) { $script:Tercih.MakineAdi = "$env:COMPUTERNAME" }
# Bu makinenin macro.cnc'si PrimerMill'in özel makrosu mu (manuel değişim, yuva/sensör ayarları)? Orijinal makroda bu bölümler gizlenir.
$script:OzelMakro = $false
try {
    $mt = [System.IO.File]::ReadAllText([System.IO.Path]::Combine($EdingKlasor, 'macro.cnc'))
    $script:OzelMakro = ($mt -match '(?im)^\s*sub\s+manual_change\b')
} catch { }
if ($script:Tercih.AcilStop -eq '1') { [Eding]::AcilKilit = $true; $script:AcilisDurum = 'iptal' }
if ($script:Tercih.OtomatikHazirlik -ne '1') { $script:AcilisDurum = 'iptal' }

function Hazir-Hareket([string]$islem) {
    if (-not (Hazir-Mi $islem)) { return $false }
    if ((Calisiyor-Mu)) { [Kayit]::Show('Makine çalışıyor. Önce DURDUR.', $islem, 'OK', 'Warning') | Out-Null; return $false }
    return $true
}

function Satirlar-Gonder([string]$ad, [string[]]$satirlar, [int]$bekle = 60) {
    foreach ($l in $satirlar) {
        $rc = [Eding]::CncRunSingleLine($l)
        [Kayit]::Yaz("KOMUT> $l   -> $([Eding]::RCText($rc))")
        if (-not (Rc-Tamam $rc)) { [void](Komut-Sonucu "$ad ($l)" $rc); return $false }
        if (-not (Hareket-Bitene-Kadar-Bekle $bekle)) { Yaz "$ad : '$l' zamanında bitmedi."; return $false }
    }
    Yaz "$ad : tamam"
    return $true
}

# --- HAREKET ---
function Jog([string]$eksen, [int]$yon) {
    if (-not (Hazir-Hareket 'Elle hareket')) { return }
    $adim = $script:AdimMm * $yon
    if ($eksen -eq 'Z' -and $yon -lt 0 -and $script:AdimMm -ge 10) {
        if (-not (Onay "Z ekseni $($script:AdimMm) mm AŞAĞI inecek. Altında bir şey olmadığından emin misin?" 'Elle hareket')) { return }
    }
    $hiz = if ($eksen -in @('A', 'B')) { [math]::Max(50, [math]::Min(1000, $script:Hiz)) } else { $script:Hiz }
    [void](Satirlar-Gonder "Jog $eksen$(Sayi $adim)" @("G91 G1 $eksen$(Sayi $adim) F$hiz", 'G90') 120)
}

function Konuma-Git([string]$ad, [string[]]$satirlar, [string]$soru) {
    if (-not (Hazir-Hareket $ad)) { return }
    if ($soru -and -not (Onay $soru $ad)) { return }
    if (Satirlar-Gonder $ad $satirlar 120) { $lblYuva.Text = "Konum: $ad" }
}

# --- TAKIM ---
function Yuvaya-Git([string]$ad) {
    if (-not (Hazir-Hareket 'Freze yuvası')) { return }
    $mut = $script:YuvaMutlak[$ad]
    $rn = [regex]::Match($ad, '^T(\d)$')
    if ($ad -eq 'Sensör' -and [Eding]::CncGetVariable(4020) -ne 0 -and [Eding]::CncGetVariable(4021) -ne 0) {
        $ok = Satirlar-Gonder "$ad üstüne git" @('G90 G53 G0 Z[#5163]', 'G53 G0 A[#5224] B[#5225]', 'G53 G0 X[#4020] Y[#4021]') 90
    } elseif ($rn.Success -and [Eding]::CncGetVariable(4010) -ne 0 -and [Eding]::CncGetVariable(4010 + [int]$rn.Groups[1].Value) -ne 0) {
        $k = [int]$rn.Groups[1].Value
        $ok = Satirlar-Gonder "$ad üstüne git" @('G90 G53 G0 Z[#5163]', 'G53 G0 A[#4017] B[#4018]', "G53 G0 X[#4010] Y[#$(4010 + $k)]") 90
    } elseif ($mut) {
        # macro'daki sabit (G53) konum: frez alırken kullanılan nokta ile birebir aynı
        $ab = if ($null -ne $mut.A) { "G53 G0 A$(Sayi $mut.A) B$(Sayi $mut.B)" } else { 'G53 G0 A[#5224] B[#5225]' }
        $ok = Satirlar-Gonder "$ad üstüne git" @('G90 G53 G0 Z[#5163]', $ab, "G53 G0 X$(Sayi $mut.X) Y$(Sayi $mut.Y)") 90
    } else {
        $ofs = $TakimY[$ad]
        $ofsTxt = if ($ofs -lt 0) { "$ofs" } else { "+$ofs" }
        $ok = Satirlar-Gonder "$ad üstüne git" @(
            'G90 G53 G0 Z[#5163]',
            'G53 G0 A[#5224] B[#5225]',
            "G53 G0 X[#5221-$($script:YuvaX)] Y[#5222$ofsTxt]") 90
    }
    if ($ok) { $script:SonYuva = $ad; $lblYuva.Text = "İş mili $ad üstünde (yukarıda)" }
}

function Yuvaya-Yaklas {
    if (-not $script:SonYuva) { [Kayit]::Show('Önce bir yuvanın üstüne git.', 'Yaklaş', 'OK', 'Information') | Out-Null; return }
    if (-not (Hazir-Hareket 'Yaklaş')) { return }
    if ([Eding]::CncGetCurrentToolNumber() -ne 0) { [Kayit]::Show('İş milinde freze varken yuvaya yaklaşılamaz (çarpar). Önce FREZ BIRAK.', 'Yaklaş', 'OK', 'Warning') | Out-Null; return }
    if (-not (Onay "İş mili $($script:SonYuva) yuvasının yaklaşma yüksekliğine (#4001) inecek.`r`nFrezeye değmeden üstünde duracak. Devam?" 'Yaklaş')) { return }
    if (Satirlar-Gonder 'Yaklaş' @('G90 G53 G1 Z[#4001] F300') 60) { $lblYuva.Text = "İş mili $($script:SonYuva) üstünde, yaklaşma yüksekliğinde" }
}

function Yukari-Kaldir {
    if (-not (Hazir-Hareket 'Yukarı')) { return }
    if (Satirlar-Gonder 'Z en üste' @('G90 G53 G0 Z[#5163]') 60) { $lblYuva.Text = 'İş mili en üstte' }
}

function Takim-Degistir([int]$n) {
    if (-not (Hazir-Hareket 'Takım değiştir')) { return }
    $simdiki = [Eding]::CncGetCurrentToolNumber()
    $m = if ($n -eq 0) { "İş milindeki T$simdiki yuvasına bırakılacak.`r`nYuvası boş mu?" } else { "İş milindeki T$simdiki bırakılıp T$n alınacak, sonra boyu ölçülecek.`r`nT$n yuvasında freze var mı, T$simdiki'in yuvası boş mu?" }
    if (-not (Onay $m 'Takım değiştir')) { return }
    [void](Satirlar-Gonder "M6 T$n" @("M6 T$n") 180)
}

function Takim-Olc {
    if (-not (Hazir-Hareket 'Takım boyu ölç')) { return }
    if ([Eding]::CncGetCurrentToolNumber() -eq 0) { [Kayit]::Show('İş milinde freze yok (T0). Önce bir takım al.', 'Takım boyu ölç', 'OK', 'Information') | Out-Null; return }
    if (-not (Onay 'İş mili sensöre gidip takım boyunu ölçecek (G92 Z güncellenir). Devam?' 'Takım boyu ölç')) { return }
    [void](Satirlar-Gonder 'Takım boyu ölç' @('gosub user_1') 120)
}

function Asinma-Kontrol {
    if (-not (Hazir-Hareket 'Aşınma kontrolü')) { return }
    if ([Eding]::CncGetCurrentToolNumber() -eq 0) { [Kayit]::Show('İş milinde freze yok (T0).', 'Aşınma kontrolü', 'OK', 'Information') | Out-Null; return }
    if (Satirlar-Gonder 'Aşınma kontrolü' @('M100') 120) {
        $as = [Eding]::CncGetVariable(4002) - [Eding]::CncGetVariable(5063)
        Yaz "Aşınma: $(Sayi $as) mm (sınır #4005 = $(Sayi ([Eding]::CncGetVariable(4005))))"
        [Kayit]::Show("Ölçülen aşınma: $(Sayi $as) mm`r`nSınır (#4005): $(Sayi ([Eding]::CncGetVariable(4005))) mm`r`n`r`nAyrıntı Eding mesajlarında.", 'Aşınma kontrolü', 'OK', 'Information') | Out-Null
    }
}

function Bos-Mu {
    if (-not (Hazir-Hareket 'İş mili boş mu')) { return }
    if (-not (Onay 'İş mili sensöre inip boş olup olmadığını kontrol edecek. Devam?' 'İş mili boş mu')) { return }
    if (Satirlar-Gonder 'İş mili boş mu' @('gosub is_empty_tool') 120) { [Kayit]::Show('İş mili boş.', 'İş mili boş mu', 'OK', 'Information') | Out-Null }
}

# --- İŞ MİLİ VE HAVA ---
function Ismili-Calistir {
    if (-not (Hazir-Hareket 'İş mili')) { return }
    $d = Metin-Sayi $txtDevir.Text
    if ($null -eq $d -or $d -lt 1000 -or $d -gt 24000) { [Kayit]::Show('Devir 1000 ile 24000 arasında olmalı.', 'İş mili', 'OK', 'Warning') | Out-Null; return }
    if ([Eding]::CncGetCurrentToolNumber() -eq 0) {
        if (-not (Onay "İş milinde freze yok. Boş pensle döndürmek pense zarar verebilir.`r`nYine de $([int]$d) devirde çalıştırılsın mı?" 'İş mili')) { return }
    } elseif (-not (Onay "İş mili $([int]$d) devirde dönecek.`r`nKapak kapalı mı, frezenin çevresi boş mu?" 'İş mili')) { return }
    [void](Komut-Sonucu "İş mili S$([int]$d) M3" ([Eding]::CncRunSingleLine("S$([int]$d) M3")))
}

function Hava-Ufle {
    if (-not (Hazir-Hareket 'Hava')) { return }
    [void](Komut-Sonucu 'Hava üfle' ([Eding]::CncRunSingleLine('M54 P4')))
    Start-Sleep -Milliseconds 700
    [void](Komut-Sonucu 'Hava kapat' ([Eding]::CncRunSingleLine('M55 P4')))
}

# K2 (GV-02/KU-01): pens açılmadan önce iş mili durdurulur (M5) ve durduğu Eding'den okunur (en fazla 8 sn).
# MAKİNEDE DOĞRULA: CncGetActualSpeed'in birimi (devir/dk mı, oran mı) ve M5 sonrası gerçekten 0'a indiği.
function Ismili-Durdur-Bekle([string]$ad) {
    $rc = [Eding]::CncRunSingleLine('M5')
    [Kayit]::Yaz("PENS: önce iş mili durduruluyor: M5 -> $([Eding]::RCText($rc))")
    if (-not (Rc-Tamam $rc)) { [void](Komut-Sonucu "$ad (M5)" $rc); return $false }
    [void](Hareket-Bitene-Kadar-Bekle 5)
    $son = (Get-Date).AddSeconds(8); $hiz = [double]::NaN
    do {
        [System.Windows.Forms.Application]::DoEvents()
        try { $hiz = [double][Eding]::CncGetActualSpeed() } catch { $hiz = [double]::NaN }
        if (-not [double]::IsNaN($hiz) -and [math]::Abs($hiz) -lt 1) { [Kayit]::Yaz("PENS: iş mili durdu (hız $hiz)"); return $true }
        Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $son)
    [Kayit]::Yaz("PENS: iş mili 8 sn içinde durmadı / hız okunamadı (son okunan $hiz), pens AÇILMADI")
    [Kayit]::Show("İş mili durdurulamadı ya da durduğu okunamadı (Eding'in bildirdiği hız: $hiz).`r`n`r`nPens AÇILMADI. İş milinin tamamen durduğunu gözünle kontrol et, sonra tekrar dene.", $ad, 'OK', 'Warning') | Out-Null
    return $false
}

function Pens-Ac-T0([string]$ad = 'Pens aç') {
    if (Is-Suruyor-Uyari $ad) { return $false }
    if (-not (Onay "Pens hava ile AÇILACAK ve takım T0 yapılacak.`r`nÖnce iş mili durdurulur (M5) ve durması beklenir.`r`n`r`nİş milinde freze varsa düşebilir, elinle tut.`r`nDevam edilsin mi?" $ad)) { return $false }
    if (-not (Ismili-Durdur-Bekle $ad)) { return $false }
    # Pens açılınca frez elle çıkarılır: Eding'deki takım numarası da T0 yapılır (macro: gosub pm_pens_t0, hareket yok).
    $yol = [System.IO.Path]::Combine($EdingKlasor, 'macro.cnc'); $var = $false
    try {
        $fs = New-Object System.IO.FileStream($yol, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $sr = New-Object System.IO.StreamReader($fs); $var = ($sr.ReadToEnd() -match '(?im)^\s*sub\s+pm_pens_t0\b'); $sr.Close()
    } catch { }
    if (-not $var) {
        [Kayit]::Yaz('PENS: macro.cnc içinde pm_pens_t0 yok, sadece pens açılıyor (takım no değişmez)')
        return (Komut-Sonucu "$ad (M54 P2)" ([Eding]::CncRunSingleLine('M54 P2')))
    }
    $once = 0; try { $once = [Eding]::CncGetCurrentToolNumber() } catch { }
    $rc = [Eding]::CncRunSingleLine('gosub pm_pens_t0')
    if (-not (Rc-Tamam $rc)) {
        # Eding macro'yu açılışta okur: yeni macro henüz yüklenmemişse sadece pensi aç
        [Kayit]::Yaz("PENS: gosub pm_pens_t0 çalışmadı (rc $rc), sadece pens açılıyor")
        Hata-Temizle 'Pens'
        Yaz 'Pens açıldı. Takımın kendiliğinden T0 olması için Eding bir kez kapatılıp açılmalı.'
        return (Komut-Sonucu "$ad (M54 P2)" ([Eding]::CncRunSingleLine('M54 P2')))
    }
    $ok = $true
    if ($ok) {
        [void](Hareket-Bitene-Kadar-Bekle 5)
        $sonra = -1; try { $sonra = [Eding]::CncGetCurrentToolNumber() } catch { }
        [Kayit]::Yaz("PENS: açıldı, takım T$once -> T$sonra")
        if ($sonra -ne 0) {
            [Kayit]::Show("Pens açıldı ama Eding takımı T0 yapmadı (şu an T$sonra).`r`nEding eski macro.cnc ile çalışıyor olabilir: Eding'i kapatıp açınca düzelir.", 'Pens', 'OK', 'Warning') | Out-Null
        }
    }
    return $ok
}

function Tek-Komut([string]$ad, [string]$komut) {
    if (-not (Hazir-Hareket $ad)) { return }
    [void](Komut-Sonucu "$ad ($komut)" ([Eding]::CncRunSingleLine($komut)))
}

# --- KALİBRASYON ---
$ParamTanim = [ordered]@{
    4000 = 'Alma Z (pens kapanır)'; 4001 = 'Yaklaşma Z'; 4002 = 'Sensör yüksekliği'; 4003 = 'Sensöre yavaş yaklaşma Z'
    4004 = 'Sensör ölçüm alt sınırı'; 4005 = 'Aşınma sınırı (mm)'; 4006 = 'Takım algılama (1 açık / 0 kapalı)' }
$script:G54Kutu = @{}
$script:ParamKutu = @{}

function Ayar-Oku {
    if (-not (Baglan)) { return }
    foreach ($k in @('X', 'Y', 'Z', 'A', 'B')) {
        $nr = @{ X = 5221; Y = 5222; Z = 5223; A = 5224; B = 5225 }[$k]
        $script:G54Kutu[$k].Text = Sayi ([Eding]::CncGetVariable($nr))
    }
    foreach ($nr in $ParamTanim.Keys) { $script:ParamKutu[$nr].Text = Sayi ([Eding]::CncGetVariable([int]$nr)) }
    $g92 = @(5211, 5212, 5213, 5214, 5215 | ForEach-Object { Sayi ([Eding]::CncGetVariable($_)) })
    $lblG92.Text = "G92 kaydırması:  X $($g92[0])   Y $($g92[1])   Z $($g92[2])   A $($g92[3])   B $($g92[4])   (Z, takım boyu ölçümünden gelir)"
    $g92xyab = @(5211, 5212, 5214, 5215 | Where-Object { [math]::Abs([Eding]::CncGetVariable($_)) -gt 0.0005 })
    if ($g92xyab.Count -gt 0) { $lblG92.Text += "   ·   DİKKAT: X/Y/A/B'de G92 var, kazıma konumu kayar"; $lblG92.ForeColor = $cKirmizi } else { $lblG92.ForeColor = $cSoluk }
    try { $lblRaf.Text = Raf-Metni } catch { }
    try {
        $fk = G54-Uretici-Fark
        $lblUretici.Text = if ($fk.Count) { "G54 üretici değerinden farklı:  " + ($fk -join '   ·   ') } else { 'G54 üretici değerlerinde.' }
        $lblUretici.ForeColor = if ($fk.Count) { $cAltinAc } else { $cSoluk }
    } catch { }
}

function Ayar-Kaydet {
    if (-not (Hazir-Hareket 'Ayar kaydet')) { return }
    $g = @{}
    foreach ($k in @('X', 'Y', 'Z', 'A', 'B')) { $g[$k] = Metin-Sayi $script:G54Kutu[$k].Text }
    $p = @{}
    foreach ($nr in $ParamTanim.Keys) { $p[$nr] = Metin-Sayi $script:ParamKutu[$nr].Text }
    if ($null -in @($g.Values) -or $null -in @($p.Values)) { [Kayit]::Show('Değerlerden biri sayı değil.', 'Ayar kaydet', 'OK', 'Warning') | Out-Null; return }
    $m = "Şu değerler kaydedilecek:`r`n`r`nG54  X $(Sayi $g.X)   Y $(Sayi $g.Y)   Z $(Sayi $g.Z)   A $(Sayi $g.A)   B $(Sayi $g.B)`r`n" +
         (($ParamTanim.Keys | ForEach-Object { "#$_ $($ParamTanim[$_]): $(Sayi $p[$_])" }) -join "`r`n") +
         "`r`n`r`nBu değerler takım değişimini VE parça kazımayı etkiler. Devam?"
    if (-not (Onay $m 'Ayar kaydet')) { return }
    $ok = (Komut-Sonucu 'G54' ([Eding]::CncRunSingleLine("G10 L2 P1 X$(Sayi $g.X) Y$(Sayi $g.Y) Z$(Sayi $g.Z) A$(Sayi $g.A) B$(Sayi $g.B)")))
    foreach ($nr in $ParamTanim.Keys) { if ($ok) { $ok = (Komut-Sonucu "#$nr" ([Eding]::CncRunSingleLine("#$nr=$(Sayi $p[$nr])"))) } }
    Start-Sleep -Milliseconds 500
    Ayar-Oku
}

# --- FREZ YUVALARI: macro.cnc bunları kalıcı değişkenlerden okur (G53 makine koordinatı) ---
#   #4010 X (hepsi)  #4011..#4016 T1..T6 Y  #4017 A  #4018 B  ·  alma Z = #4000, bırakma = #4000+1
$RafTanim = [ordered]@{ 4010 = 'Yuva X'; 4011 = 'T1 Y'; 4012 = 'T2 Y'; 4013 = 'T3 Y'; 4014 = 'T4 Y'; 4015 = 'T5 Y'; 4016 = 'T6 Y'; 4017 = 'Yuva A'; 4018 = 'Yuva B'; 4020 = 'Sensör X'; 4021 = 'Sensör Y'; 4030 = 'Frez modu (1 manuel)'; 4031 = 'Değişim X'; 4032 = 'Değişim Y'; 4033 = 'Değişim Z (0 en üst)' }
# Yuva aralığı (T1'e göre, mm): Bloomden X5 magazini
$RafAralik = @{ 1 = 0; 2 = 12; 3 = 24; 4 = 54; 5 = 66; 6 = 78 }
# İlk kurulumda yazılacak değerler: 22.10.2026'da makinede doğrulanan T1 noktası
$RafVarsayilan = @{ X = -125.557; Y1 = -89.166; A = 23.0; B = 0.0; AlmaZ = -45.0 }
$script:RafKontrolTamam = $false

function Degisken-Yaz([int]$nr, [double]$v) {
    if ((Is-Suruyor)) { [Kayit]::Yaz("DEĞİŞKEN> #$nr yazılmadı: iş sürüyor / duraklı (K1)"); return $false }
    $rc = [Eding]::CncRunSingleLine("#$nr=$(Sayi $v)")
    [Kayit]::Yaz("DEĞİŞKEN> #$nr=$(Sayi $v)   -> $([Eding]::RCText($rc))")
    return (Rc-Tamam $rc)
}

function Raf-Metni {
    $v = @{}; foreach ($nr in $RafTanim.Keys) { $v[$nr] = [Eding]::CncGetVariable([int]$nr) }
    if ($v[4010] -eq 0 -or $v[4011] -eq 0) { return 'Frez yuvaları henüz kaydedilmemiş.' }
    $t = "X $(Sayi $v[4010])   A $(Sayi $v[4017])   B $(Sayi $v[4018])   alma Z $(Sayi ([Eding]::CncGetVariable(4000)))`r`n"
    $t += (@(1..6 | ForEach-Object { "T$_ Y $(Sayi $v[4010 + $_])" }) -join '    ')
    $t += if ($v[4020] -ne 0 -and $v[4021] -ne 0) { "`r`nSensör  X $(Sayi $v[4020])   Y $(Sayi $v[4021])   (A = G54 A)" } else { "`r`nSensör kaydedilmemiş" }
    return $t
}

# Açılışta bir kez: yuva değişkenleri boşsa doğrulanmış değerleri yaz (macro artık bunları kullanıyor)
function Raf-Kontrol {
    if ($script:RafKontrolTamam) { return }
    try {
        $ok = $true
        # Sensör: boşsa bugünkü yerini (G54 X-72.25, G54 Y) yaz; ölçüm aynen eskisi gibi devam eder
        if ([Eding]::CncGetVariable(4020) -eq 0 -or [Eding]::CncGetVariable(4021) -eq 0) {
            $sx = [Eding]::CncGetVariable(5221) - 72.25; $sy = [Eding]::CncGetVariable(5222)
            [Kayit]::Yaz("SENSÖR: #4020/#4021 boş, mevcut konum yazılıyor: X $(Sayi $sx) Y $(Sayi $sy)")
            $ok = (Degisken-Yaz 4020 $sx) -and (Degisken-Yaz 4021 $sy)
        }
        # Manuel frez değişim noktası: boşsa makinenin ortası, en üstte
        if ($ok -and ([Eding]::CncGetVariable(4031) -eq 0 -or [Eding]::CncGetVariable(4032) -eq 0)) {
            [Kayit]::Yaz('MANUEL: değişim noktası boş, makinenin ortası yazılıyor (X -64.25 Y -52, Z en üst)')
            $ok = (Degisken-Yaz 4031 -64.25) -and (Degisken-Yaz 4032 -52.0) -and (Degisken-Yaz 4033 0)
        }
        if ([Eding]::CncGetVariable(4010) -ne 0 -and [Eding]::CncGetVariable(4011) -ne 0) { if ($ok) { $script:RafKontrolTamam = $true }; return }
        [Kayit]::Yaz('YUVALAR: #4010-#4018 boş, doğrulanmış T1 değerleri yazılıyor')
        if ($ok) { $ok = (Degisken-Yaz 4010 $RafVarsayilan.X) }
        for ($n = 1; $n -le 6; $n++) { if ($ok) { $ok = (Degisken-Yaz (4010 + $n) ($RafVarsayilan.Y1 + $RafAralik[$n])) } }
        if ($ok) { $ok = (Degisken-Yaz 4017 $RafVarsayilan.A) }
        if ($ok) { $ok = (Degisken-Yaz 4018 $RafVarsayilan.B) }
        if ($ok) { $ok = (Degisken-Yaz 4000 $RafVarsayilan.AlmaZ) }
        if ($ok) { $script:RafKontrolTamam = $true; Yaz "Frez yuvaları kaydedildi: $((Raf-Metni) -replace "`r`n", '  ·  ')" }
    } catch { [Kayit]::Yaz("YUVALAR: yazılamadı: $($_.Exception.Message)") }
}

function Konumu-Sensor-Yap {
    if (-not (Hazir-Hareket 'Sensör kaydet')) { return }
    $p = [Eding]::MachinePos()
    $gA = [Eding]::CncGetVariable(5224); $gB = [Eding]::CncGetVariable(5225)
    if ([math]::Abs($p.A - $gA) -gt 0.05) {
        [Kayit]::Show("Frez boyu sensörde G54 A açısında ölçülür (A $(Sayi $gA)).`r`nŞu an A $(Sayi $p.A).`r`n`r`nÖnce TAKIM sekmesinde 'Sensör' ile sensörün üstüne git (A doğru açıya gelir), sonra X/Y ile ortala.", 'Sensör kaydet', 'OK', 'Warning') | Out-Null
        return
    }
    $eX = [Eding]::CncGetVariable(4020); $eY = [Eding]::CncGetVariable(4021)
    $m = "İş mili şu an frez boyu sensörünün tam ortasında mı?`r`n`r`nYeni sensör konumu:  X $(Sayi $p.X)   Y $(Sayi $p.Y)`r`n(eski: X $(Sayi $eX)   Y $(Sayi $eY))`r`n`r`n" +
         "Frez yuvaları ve G54 (disk sıfırı) değişmez.`r`nKaydedilsin mi?"
    if (-not (Onay $m 'Sensör kaydet')) { return }
    Ayar-Yedekle $true
    $ok = (Degisken-Yaz 4020 $p.X) -and (Degisken-Yaz 4021 $p.Y)
    Start-Sleep -Milliseconds 300
    Ayar-Oku
    if ($ok) {
        Yaz "Sensör kaydedildi: X $(Sayi $p.X) Y $(Sayi $p.Y)"
        [Kayit]::Show("Sensör kaydedildi. Bir sonraki frez ölçümünde kullanılır.`r`n`r`nÖnemli: sensör yeri değiştiği için bir sonraki frez değişiminde boy yeniden ölçülecek. İlk kazımadan önce bir frez değişimi (örneğin T1 M6) yap.", 'Sensör kaydet', 'OK', 'Information') | Out-Null
    } else {
        [Kayit]::Show("Kaydetme tamamlanamadı. Eding hazır durumda mı?", 'Sensör kaydet', 'OK', 'Warning') | Out-Null
    }
}

function Konumu-Yuva-Yap([int]$n) {
    if (-not (Hazir-Hareket "T$n kaydet")) { return }
    $p = [Eding]::MachinePos()
    $eskiY = [Eding]::CncGetVariable(4010 + $n)
    $yaklas = [Eding]::CncGetVariable(4001)
    if ($n -eq 1) {
        $dy = if ($eskiY -ne 0) { $p.Y - $eskiY } else { 0 }
        $m = "İş mili şu an T1'in tam ortasında ve kol düz mü?`r`n`r`n" +
             "Kaydedilecek (makine koordinatı):`r`n   Yuva X $(Sayi $p.X)    T1 Y $(Sayi $p.Y)    A $(Sayi $p.A)    B $(Sayi $p.B)`r`n`r`n" +
             "X, A ve B bütün yuvalarda ortaktır.`r`n" +
             "EVET: T2-T6 da aynı miktarda kaysın (Y farkı $(Sayi $dy) mm, yuva aralıkları korunur)`r`n" +
             "HAYIR: sadece T1 kaydedilsin`r`nİPTAL: vazgeç"
        $c = [Kayit]::Show($m, 'T1 kaydet', 'YesNoCancel', 'Question')
        if ("$c" -eq 'Cancel') { return }
        $hepsi = ("$c" -eq 'Yes')
    } else {
        $m = "İş mili şu an T$n yuvasının tam ortasında mı?`r`n`r`nT$n Y = $(Sayi $p.Y)   (eski: $(Sayi $eskiY))`r`n`r`n" +
             "Not: X, A, B ortaktır ve T1 kaydedilirken alınır. Şu anki X $(Sayi $p.X), A $(Sayi $p.A), B $(Sayi $p.B).`r`nKaydedilsin mi?"
        if (-not (Onay $m "T$n kaydet")) { return }
    }
    $zDe = $false
    if ($p.Z -lt ($yaklas - 3)) {
        $zDe = Onay "İş mili alma yüksekliğinde görünüyor (Z $(Sayi $p.Z)).`r`nBu Z, alma yüksekliği (#4000) olarak da kaydedilsin mi?`r`nBırakma 1 mm yukarıda yapılır." "T$n kaydet"
    }
    Ayar-Yedekle $true
    if ($n -eq 1) {
        $ok = (Degisken-Yaz 4010 $p.X) -and (Degisken-Yaz 4011 $p.Y) -and (Degisken-Yaz 4017 $p.A) -and (Degisken-Yaz 4018 $p.B)
        if ($ok -and $hepsi) {
            for ($k = 2; $k -le 6; $k++) {
                $eski = [Eding]::CncGetVariable(4010 + $k)
                $yeni = if ($eski -ne 0 -and $eskiY -ne 0) { $eski + ($p.Y - $eskiY) } else { $p.Y + $RafAralik[$k] }
                if ($ok) { $ok = (Degisken-Yaz (4010 + $k) $yeni) }
            }
        }
    } else {
        $ok = (Degisken-Yaz (4010 + $n) $p.Y)
    }
    if ($ok -and $zDe) { $ok = (Degisken-Yaz 4000 $p.Z) }
    Start-Sleep -Milliseconds 300
    Ayar-Oku
    if ($ok) {
        Yaz "T$n kaydedildi. $((Raf-Metni) -replace "`r`n", '  ·  ')"
        [Kayit]::Show("T$n kaydedildi. Bir sonraki frez değişiminde kullanılır (Eding'i yeniden başlatmak gerekmez).`r`n`r`n$(Raf-Metni)", "T$n kaydet", 'OK', 'Information') | Out-Null
    } else {
        [Kayit]::Show("Kaydetme tamamlanamadı. Eding hazır durumda mı (çalışmıyor, hata yok)?", "T$n kaydet", 'OK', 'Warning') | Out-Null
    }
}

function Z-Alma-Yap {
    if (-not (Hazir-Hareket 'Alma yüksekliği')) { return }
    $p = [Eding]::MachinePos()
    if (-not (Onay "Şu anki Z ($(Sayi $p.Z)) frezeyi alma yüksekliği (#4000) olarak kaydedilsin mi?`r`nPens bu yükseklikte frezeyi kavrar." 'Alma yüksekliği')) { return }
    if (Komut-Sonucu '#4000' ([Eding]::CncRunSingleLine("#4000=$(Sayi $p.Z)"))) { Start-Sleep -Milliseconds 500; Ayar-Oku }
}

# Üretici disk kalibrasyonu: makinenin kendi P:\CNC\cnc.ini dosyasında kayıtlıydı (G54 = disk merkezi ve A/B sıfırı)
$UreticiG54 = [ordered]@{ X = -53.4925; Y = -53.456; Z = 208.8975; A = 20.209; B = -2.3508 }

function G54-Uretici-Fark {
    $f = @()
    foreach ($k in $UreticiG54.Keys) {
        $nr = @{ X = 5221; Y = 5222; Z = 5223; A = 5224; B = 5225 }[$k]
        $v = [Eding]::CncGetVariable($nr)
        if ([math]::Abs($v - $UreticiG54[$k]) -gt 0.01) { $f += "$k $(Sayi $v) (üretici $(Sayi $UreticiG54[$k]))" }
    }
    return $f
}

function G54-Ureticiye-Don {
    if (-not (Hazir-Hareket 'Üretici disk kalibrasyonu')) { return }
    $fark = G54-Uretici-Fark
    $g92 = @(5211, 5212, 5214, 5215 | Where-Object { [math]::Abs([Eding]::CncGetVariable($_)) -gt 0.0005 })
    if ($fark.Count -eq 0 -and $g92.Count -eq 0) { [Kayit]::Show('G54 zaten üretici değerlerinde, G92 kaydırması da yok.', 'Üretici kalibrasyonu', 'OK', 'Information') | Out-Null; return }
    $m = "Disk sıfırı (G54) makinenin kendi cnc.ini dosyasındaki ÜRETİCİ değerlerine dönecek:`r`n`r`n" +
         "X $(Sayi $UreticiG54.X)   Y $(Sayi $UreticiG54.Y)   Z $(Sayi $UreticiG54.Z)   A $(Sayi $UreticiG54.A)   B $(Sayi $UreticiG54.B)`r`n`r`n" +
         "Şu an farklı olanlar:`r`n" + $(if ($fark.Count) { ($fark -join "`r`n") } else { '(yok)' }) + "`r`n`r`n" +
         "G92 kaydırmaları da sıfırlanır (frez boyu bir sonraki frez değişiminde yeniden ölçülür).`r`n" +
         "Frez yuvaları değişmez. Önce otomatik yedek alınır. Devam?"
    if (-not (Onay $m 'Üretici kalibrasyonu')) { return }
    Ayar-Yedekle $true
    $ok = Komut-Sonucu 'G54 üretici' ([Eding]::CncRunSingleLine("G10 L2 P1 X$(Sayi $UreticiG54.X) Y$(Sayi $UreticiG54.Y) Z$(Sayi $UreticiG54.Z) A$(Sayi $UreticiG54.A) B$(Sayi $UreticiG54.B)"))
    if ($ok) { $ok = Hareket-Bitene-Kadar-Bekle 5 }
    if ($ok) { $ok = Komut-Sonucu 'G92 sıfırla' ([Eding]::CncRunSingleLine('G92.1')) }
    if ($ok) { $ok = Hareket-Bitene-Kadar-Bekle 5 }
    if ($ok) {
        $sx = $UreticiG54.X - 72.25; $sy = $UreticiG54.Y
        if (Onay "Frez boyu sensörü de üreticinin konumuna dönsün mü?`r`n(X $(Sayi $sx)  Y $(Sayi $sy), şu an X $(Sayi ([Eding]::CncGetVariable(4020)))  Y $(Sayi ([Eding]::CncGetVariable(4021))))`r`n`r`nSensör ölçümü G54 A açısında yapıldığı için üretici A ile birlikte önerilir." 'Üretici kalibrasyonu') {
            $ok = (Degisken-Yaz 4020 $sx) -and (Degisken-Yaz 4021 $sy)
        }
    }
    Start-Sleep -Milliseconds 300
    Ayar-Oku
    if ($ok) {
        Yaz 'Disk sıfırı üretici değerlerine döndü.'
        [Kayit]::Show("Disk sıfırı üretici değerlerine döndü.`r`n`r`nŞimdi:`r`n1. Bir frez değişimi yap (frez boyu yeniden ölçülsün)`r`n2. Bir deneme bloğu kaz ve iki yüzü kontrol et`r`n`r`nBeğenmezsen: KALİBRASYON > Yedekten yükle ile eski hale dönersin.", 'Üretici kalibrasyonu', 'OK', 'Information') | Out-Null
    }
}

function G92-Sifirla {
    if (-not (Hazir-Hareket 'G92 sıfırla')) { return }
    if (-not (Onay "Tüm G92 kaydırmaları sıfırlanacak (G92.1).`r`nTakım boyu ölçümü de silinir; bir sonraki takım değişiminde yeniden ölçülür. Devam?" 'G92 sıfırla')) { return }
    if (Komut-Sonucu 'G92 sıfırla (G92.1)' ([Eding]::CncRunSingleLine('G92.1'))) { Start-Sleep -Milliseconds 400; Ayar-Oku }
}

$YedekKlasoru = [System.IO.Path]::Combine($ScriptKlasor, 'yedekler')
function Ayar-Yedekle([bool]$sessiz = $false) {
    if (-not (Baglan)) { return }
    [void][System.IO.Directory]::CreateDirectory($YedekKlasoru)
    $dosya = [System.IO.Path]::Combine($YedekKlasoru, 'ayar_' + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + '.txt')
    $satirlar = @("; PrimerMill ayar yedeği  $(Get-Date)  Eding: $EdingKlasor")
    foreach ($nr in @(5221, 5222, 5223, 5224, 5225) + @($ParamTanim.Keys | ForEach-Object { [int]$_ }) + @($RafTanim.Keys | ForEach-Object { [int]$_ }) + @(5161, 5162, 5163, 5164, 5165, 5181, 5182, 5183, 5184, 5185)) {
        $satirlar += "#$nr=$(Sayi ([Eding]::CncGetVariable($nr)))"
    }
    [System.IO.File]::WriteAllLines($dosya, $satirlar)
    Yaz "Ayarlar yedeklendi: $dosya"
    if (-not $sessiz) { [Kayit]::Show("Ayarlar yedeklendi:`r`n$dosya", 'Yedekle', 'OK', 'Information') | Out-Null }
}

function Ayar-Geri-Yukle {
    if (-not (Hazir-Hareket 'Yedekten yükle')) { return }
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.InitialDirectory = $YedekKlasoru; $dlg.Filter = 'Ayar yedeği (*.txt)|*.txt'
    if ($dlg.ShowDialog($form) -ne 'OK') { return }
    $d = @{}
    foreach ($l in [System.IO.File]::ReadAllLines($dlg.FileName)) {
        $m = [regex]::Match($l, '^#(\d+)=(-?[0-9.]+)')
        if ($m.Success) { $d[[int]$m.Groups[1].Value] = $m.Groups[2].Value }
    }
    if (-not ($d.ContainsKey(5221) -and $d.ContainsKey(5225))) { [Kayit]::Show('Dosya geçerli bir ayar yedeği değil.', 'Yedekten yükle', 'OK', 'Warning') | Out-Null; return }
    $m = "Yedekten yüklenecek (G54 ve takım değiştirici parametreleri):`r`n`r`nG54  X $($d[5221])  Y $($d[5222])  Z $($d[5223])  A $($d[5224])  B $($d[5225])`r`n" +
         (($ParamTanim.Keys | Where-Object { $d.ContainsKey([int]$_) } | ForEach-Object { "#$_ = $($d[[int]$_])" }) -join '   ') + "`r`n`r`nDevam?"
    if (-not (Onay $m 'Yedekten yükle')) { return }
    $ok = (Komut-Sonucu 'G54' ([Eding]::CncRunSingleLine("G10 L2 P1 X$($d[5221]) Y$($d[5222]) Z$($d[5223]) A$($d[5224]) B$($d[5225])")))
    foreach ($nr in @($ParamTanim.Keys) + @($RafTanim.Keys)) { if ($ok -and $d.ContainsKey([int]$nr)) { $ok = (Komut-Sonucu "#$nr" ([Eding]::CncRunSingleLine("#$nr=$($d[[int]$nr])"))) } }
    Start-Sleep -Milliseconds 500; Ayar-Oku
}

# --- PANEL ---
function Klasor-Ac([string]$yol) {
    try { [void][System.IO.Directory]::CreateDirectory($yol); Start-Process explorer.exe $yol } catch { Yaz "Klasör açılamadı: $yol" }
}
function Eding-Goster {
    $script:EdingGosteriliyor = $true
    $form.TopMost = $false
    $n = 0
    foreach ($pr in @(Get-Process -Name $script:EdingExeAd -ErrorAction SilentlyContinue)) { $n += [Pencere]::Goster($pr.Id) }
    if ($n -eq 0) {
        $sh = New-Object -ComObject WScript.Shell
        if (-not $sh.AppActivate('CNC V4')) { [Kayit]::Show('Eding penceresi bulunamadı (Eding kapalı olabilir).', 'Eding', 'OK', 'Information') | Out-Null }
    }
    [Kayit]::Yaz('EDING: pencere gösterildi')
}
function Eding-Gizle {
    $script:EdingGosteriliyor = $false
    if ($script:Tercih.TamEkran -ne '0') { $form.TopMost = $true }
    $script:EdingGizlendiYazildi = $false
    Eding-Gizle-Tik
    [Kayit]::Yaz('EDING: pencere tekrar arka planda')
}
function Eding-Yeniden {
    if (Is-Suruyor-Uyari 'Eding yeniden başlat') { return }
    if (-not (Onay "Eding tamamen kapatılıp yeniden açılacak (macro.cnc ve cnc.ini yeniden okunur).`r`nSonra makine yeniden home alır. Devam?" 'Eding yeniden başlat')) { return }
    try { [void][Eding]::CncDisConnectServer() } catch { }
    $script:Bagli = $false
    $kill = [System.IO.Path]::Combine($EdingKlasor, 'KillCNC.exe')
    Eding-Kapat-Nazik
    Start-Sleep -Seconds 2
    if ([System.IO.File]::Exists($kill)) { Start-Process -FilePath $kill -WorkingDirectory $EdingKlasor -Wait -WindowStyle Hidden }
    $script:Bagli = $false
    Start-Sleep -Seconds 1
    Yaz 'Eding yeniden başlatılıyor...'
    Eding-Baslat
    $script:AcilisDurum = 'bekliyor'
}

# ================= Pencere =================
$ayar = New-Object System.Windows.Forms.Form
$ayar.Text = 'Ayarlar  ·  PrimerMill'
$ayar.ClientSize = New-Object System.Drawing.Size(980, 660)
$ayar.StartPosition = 'CenterScreen'
$ayar.BackColor = $cZemin
$ayar.ForeColor = $cYazi
$ayar.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$ayar.FormBorderStyle = 'FixedSingle'
$ayar.MaximizeBox = $false
$ayar.Owner = $form
$ayar.Add_FormClosing({ param($s, $e) if ($e.CloseReason -eq 'UserClosing') { $e.Cancel = $true; $ayar.Hide() } })

$script:Hedef = $ayar
function A-Baslik([string]$t, [int]$x, [int]$y) {
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $t; $l.ForeColor = $cAltin
    $l.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 9.5)
    $l.SetBounds($x, $y, 600, 22)
    $script:Hedef.Controls.Add($l)
}
function A-Etiket([string]$t, [int]$x, [int]$y, [int]$w = 120) {
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $t; $l.ForeColor = $cSoluk
    $l.SetBounds($x, $y + 4, $w, 22)
    $script:Hedef.Controls.Add($l); return $l
}
function A-Buton([string]$t, [int]$x, [int]$y, [int]$w, [int]$h, [scriptblock]$is) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $t
    $b.FlatStyle = 'Flat'
    $b.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(120, 212, 175, 55)
    $b.FlatAppearance.MouseOverBackColor = [System.Drawing.Color]::FromArgb(40, 44, 54)
    $b.BackColor = $cPanel
    $b.ForeColor = $cYazi
    $b.SetBounds($x, $y, $w, $h)
    $b.Add_Click({ [Kayit]::Yaz("TUŞ (Ayarlar): " + $this.Text) })
    $b.Add_Click($is)
    $script:Hedef.Controls.Add($b); return $b
}
function A-Kutu([int]$x, [int]$y, [int]$w = 110) {
    $t = New-Object System.Windows.Forms.TextBox
    $t.BackColor = $cPanel; $t.ForeColor = $cYazi; $t.BorderStyle = 'FixedSingle'
    $t.Font = New-Object System.Drawing.Font('Consolas', 11)
    $t.SetBounds($x, $y, $w, 26)
    $script:Hedef.Controls.Add($t); return $t
}
function A-Secim([string]$t, [int]$x, [int]$y, [int]$w, [bool]$deger, [scriptblock]$is) {
    $c = New-Object System.Windows.Forms.CheckBox
    $c.Text = $t; $c.Checked = $deger; $c.ForeColor = $cYazi; $c.FlatStyle = 'Flat'
    $c.SetBounds($x, $y, $w, 26)
    $c.Add_CheckedChanged($is)
    $script:Hedef.Controls.Add($c); return $c
}

# Anlık konum (her sekmede görünür)
$lblKonum = New-Object System.Windows.Forms.Label
$lblKonum.Font = New-Object System.Drawing.Font('Consolas', 11)
$lblKonum.ForeColor = [System.Drawing.Color]::FromArgb(225, 230, 238)
$lblKonum.SetBounds(24, 4, 930, 40)
$ayar.Controls.Add($lblKonum)

# Sekme çubuğu
$sekmeAdlari = @('HAREKET', 'TAKIM', 'YUVA AYARI', 'İŞ MİLİ VE HAVA', 'KALİBRASYON', 'DİSK KALİBRASYONU', 'OTO KALİBRASYON', 'PANEL')
$script:Sekmeler = @{}
$script:SekmeButon = @{}
function Sekme-Goster([string]$ad) {
    foreach ($k in $script:Sekmeler.Keys) { $script:Sekmeler[$k].Visible = ($k -eq $ad) }
    foreach ($k in $script:SekmeButon.Keys) {
        $b = $script:SekmeButon[$k]
        $b.ForeColor = if ($k -eq $ad) { $cAltinAc } else { $cSoluk }
        $b.FlatAppearance.BorderColor = if ($k -eq $ad) { $cAltin } else { [System.Drawing.Color]::FromArgb(50, 255, 255, 255) }
    }
    if ($ad -eq 'KALİBRASYON') { Ayar-Oku }
    if ($ad -eq 'YUVA AYARI') { Yuva-Liste-Yenile }
    if ($ad -eq 'DİSK KALİBRASYONU') { Kal-Degerleri-Goster }
    if ($ad -eq 'OTO KALİBRASYON') { OtoKal-Goster }
}
for ($i = 0; $i -lt $sekmeAdlari.Count; $i++) {
    $ad = $sekmeAdlari[$i]
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $ad; $b.FlatStyle = 'Flat'; $b.BackColor = $cZemin
    $b.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 8)
    $b.SetBounds(12 + $i * 120, 48, 116, 34)
    $b.Add_Click([scriptblock]::Create("[Kayit]::Yaz('TUŞ (Ayarlar): sekme $ad'); Sekme-Goster '$ad'"))
    $ayar.Controls.Add($b)
    $script:SekmeButon[$ad] = $b
    $p = New-Object System.Windows.Forms.Panel
    $p.SetBounds(0, 92, 980, 568); $p.BackColor = $cZemin; $p.Visible = $false
    $ayar.Controls.Add($p)
    $script:Sekmeler[$ad] = $p
}

if ($script:Sade -and -not $script:OzelMakro) {
    # Orijinal makrolu makinede magazin/sensör/disk kalibrasyonu yok (orijinal yazılımın ayarları kullanılır)
    $gx = 0
    foreach ($ad in $sekmeAdlari) {
        if (@('YUVA AYARI', 'KALİBRASYON', 'DİSK KALİBRASYONU', 'OTO KALİBRASYON') -contains $ad) { $script:SekmeButon[$ad].Visible = $false; continue }
        $script:SekmeButon[$ad].Left = 12 + $gx * 120; $gx++
    }
}

# ---- Sekme 1: HAREKET ----
$script:Hedef = $script:Sekmeler['HAREKET']
A-Baslik 'ELLE HAREKET (JOG)' 24 8
[void](A-Etiket 'Adım' 24 34 50)
$script:AdimButonlari = @()
$adimlar = @(0.01, 0.1, 1, 10)
for ($i = 0; $i -lt $adimlar.Count; $i++) {
    $v = $adimlar[$i]
    $b = A-Buton ("{0}" -f $v) (80 + $i * 62) 34 56 28 ([scriptblock]::Create("`$script:AdimMm = $v; Adim-Isaretle"))
    $b.Tag = $v; $script:AdimButonlari += $b
}
[void](A-Etiket 'Hız' 340 34 40)
$hizlar = [ordered]@{ 'Yavaş' = 100; 'Orta' = 300; 'Hızlı' = 1000 }
$script:HizButonlari = @()
$k = 0
foreach ($h in $hizlar.Keys) {
    $b = A-Buton $h (384 + $k * 72) 34 66 28 ([scriptblock]::Create("`$script:Hiz = $($hizlar[$h]); Adim-Isaretle"))
    $b.Tag = $hizlar[$h]; $script:HizButonlari += $b; $k++
}
function Adim-Isaretle {
    foreach ($b in $script:AdimButonlari) { $b.FlatAppearance.BorderSize = if ([double]$b.Tag -eq $script:AdimMm) { 2 } else { 1 }; $b.ForeColor = if ([double]$b.Tag -eq $script:AdimMm) { $cAltinAc } else { $cYazi } }
    foreach ($b in $script:HizButonlari) { $b.FlatAppearance.BorderSize = if ([int]$b.Tag -eq $script:Hiz) { 2 } else { 1 }; $b.ForeColor = if ([int]$b.Tag -eq $script:Hiz) { $cAltinAc } else { $cYazi } }
}
$eksenler = @(@('X', 'X−  sol', 'X+  sağ'), @('Y', 'Y−  arka', 'Y+  ön'), @('Z', 'Z−  aşağı', 'Z+  yukarı'), @('A', 'A−  kol', 'A+  kol'), @('B', 'B−  disk', 'B+  disk'))
for ($i = 0; $i -lt $eksenler.Count; $i++) {
    $e = $eksenler[$i]; $x = 24 + $i * 124
    [void](A-Buton $e[1] $x 74 116 40 ([scriptblock]::Create("Jog '$($e[0])' -1")))
    [void](A-Buton $e[2] $x 118 116 40 ([scriptblock]::Create("Jog '$($e[0])' 1")))
}
[void](A-Etiket 'mm / derece. Her basışta seçili adım kadar gider.' 650 80 300)

A-Baslik 'HAZIR KONUMLAR' 24 182
[void](A-Buton 'İş mili en üste' 24 208 170 40 { Yukari-Kaldir })
[void](A-Buton 'Kol düz (takım alma)' 200 208 170 40 { Konuma-Git 'Kol düz' @('G90 G53 G0 Z[#5163]', 'G53 G0 A[#5224] B[#5225]') '' })
[void](A-Buton 'Takım alanı' 376 208 170 40 { Konuma-Git 'Takım alanı' @('gosub azxy_safe') '' })
[void](A-Buton 'Blok değiştirme' 552 208 170 40 { Konuma-Git 'Blok değiştirme' @('G90 G53 G0 Z[#5163]', 'G53 G0 A[#5224] B[#5225]', 'gosub ClearPos') '' })
[void](A-Buton 'Park (G30)' 728 208 170 40 { Konuma-Git 'Park (G30)' @('G90 G53 G0 Z[#5163]', 'G30') '' })
[void](A-Etiket 'Her konumda önce iş mili en üste çıkar. "Blok değiştirme", bloğu takıp çıkarmak için kolu öne getirir.' 24 256 880)
$lblYuva = A-Etiket '' 24 290 880
$lblYuva.ForeColor = $cAltinAc

# ---- Sekme 2: TAKIM ----
$script:Hedef = $script:Sekmeler['TAKIM']
A-Baslik 'TAKIM DEĞİŞTİR (tam otomatik: bırak, al, boyunu ölç)' 24 8
for ($n = 1; $n -le 6; $n++) { [void](A-Buton "T$n al" (24 + ($n - 1) * 110) 34 100 40 ([scriptblock]::Create("Takim-Degistir $n"))) }
[void](A-Buton 'Bırak (T0)' 694 34 120 40 { Takim-Degistir 0 })

A-Baslik 'YUVALARA GİT (frezeye dokunmadan, üstünde durur)' 24 96
$k = 0
foreach ($ad in $TakimY.Keys) { [void](A-Buton $ad (24 + $k * 90) 122 84 38 ([scriptblock]::Create("Yuvaya-Git '$ad'"))); $k++ }
[void](A-Buton 'Yaklaş' 660 122 90 38 { Yuvaya-Yaklas })
[void](A-Buton 'Yukarı' 756 122 90 38 { Yukari-Kaldir })

A-Baslik 'ÖLÇÜM VE KONTROL' 24 184
[void](A-Buton 'Takım boyunu ölç' 24 210 190 40 { Takim-Olc })
[void](A-Buton 'Aşınma kontrolü' 220 210 190 40 { Asinma-Kontrol })
[void](A-Buton 'İş mili boş mu?' 416 210 190 40 { Bos-Mu })
[void](A-Etiket 'Takım boyu ölçümü takım değişiminde kendiliğinden yapılır; burada elle tekrar edebilirsin.' 24 258 880)

A-Baslik 'YUVA GEOMETRİSİ' 24 296
$lblGeometri = A-Etiket '' 24 320 900
$lblGeometri.Text = Yuva-Geometrisi-Oku
[void](A-Buton "macro.cnc'den yeniden oku" 24 352 220 34 { $lblGeometri.Text = Yuva-Geometrisi-Oku; Yaz $lblGeometri.Text })
[void](A-Etiket 'Kendi makinende yuva düzeni farklıysa macro.cnc''deki PickTool değerlerini değiştir; panel buradan okur.' 24 392 880)

# ---- Sekme: YUVA AYARI (frez alma kalibrasyonu sihirbazı) ----
# Değerler önce burada toplanır (yeni), KAYDET'e basınca hepsi birden Eding'e yazılır.
$script:YuvaAdlari = @('T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'Sensör', 'Değişim')
$script:YuvaYeni = @{}
$script:YuvaSecili = 'T1'

function Yuva-Kayitli([string]$ad) {
    # Eding'deki kayıtlı değer (makine koordinatı); kayıt yoksa doğrulanmış varsayılan
    $x = [Eding]::CncGetVariable(4010); $a = [Eding]::CncGetVariable(4017); $b = [Eding]::CncGetVariable(4018)
    if ($ad -eq 'Değişim') {
        $dx = [Eding]::CncGetVariable(4031); $dy = [Eding]::CncGetVariable(4032)
        return @{ X = $dx; Y = $dy; Z = [Eding]::CncGetVariable(4033); A = [Eding]::CncGetVariable(5224); B = [Eding]::CncGetVariable(5225); Var = ($dx -ne 0 -and $dy -ne 0) }
    }
    if ($ad -eq 'Sensör') {
        $sx = [Eding]::CncGetVariable(4020); $sy = [Eding]::CncGetVariable(4021)
        return @{ X = $sx; Y = $sy; A = [Eding]::CncGetVariable(5224); B = [Eding]::CncGetVariable(5225); Var = ($sx -ne 0 -and $sy -ne 0) }
    }
    $n = [int]$ad.Substring(1)
    $y = [Eding]::CncGetVariable(4010 + $n)
    if ($x -eq 0 -or $y -eq 0) { return @{ X = $RafVarsayilan.X; Y = $RafVarsayilan.Y1 + $RafAralik[$n]; A = $RafVarsayilan.A; B = $RafVarsayilan.B; Var = $false } }
    return @{ X = $x; Y = $y; A = $a; B = $b; Var = $true }
}

function Yuva-Hedef([string]$ad) {
    # Gidilecek nokta: yeni alınmışsa o; T1 yeni alınmışsa diğerleri onunla birlikte kaydırılmış tahmin
    if ($script:YuvaYeni.ContainsKey($ad)) {
        $k = Yuva-Kayitli $ad; $y = $script:YuvaYeni[$ad]
        $t1 = if ($script:YuvaYeni.ContainsKey('T1')) { $script:YuvaYeni['T1'] } else { $null }
        if ($ad -eq 'Sensör') { return @{ X = $y.X; Y = $y.Y; A = $k.A; B = $k.B } }
        if ($ad -eq 'Değişim') { return @{ X = $y.X; Y = $y.Y; Z = $y.Z; A = $k.A; B = $k.B } }
        if ($ad -eq 'T1') { return @{ X = $y.X; Y = $y.Y; A = $y.A; B = $y.B } }
        $ref = if ($t1) { $t1 } else { $k }
        return @{ X = $ref.X; Y = $y.Y; A = $ref.A; B = $ref.B }
    }
    $k = Yuva-Kayitli $ad
    if ($ad -ne 'Sensör' -and $ad -ne 'Değişim' -and $ad -ne 'T1' -and $script:YuvaYeni.ContainsKey('T1')) {
        $t1 = $script:YuvaYeni['T1']; $k1 = Yuva-Kayitli 'T1'
        return @{ X = $t1.X; Y = $k.Y + ($t1.Y - $k1.Y); A = $t1.A; B = $t1.B }
    }
    return $k
}

function Yuva-Liste-Yenile {
    if (-not $script:ApiHazir -or -not $script:Bagli) { return }
    try {
        $lvYuva.BeginUpdate()
        $lvYuva.Items.Clear()
        foreach ($ad in $script:YuvaAdlari) {
            $k = Yuva-Kayitli $ad
            $kTxt = if ($k.Var) { "X $(Sayi $k.X)  Y $(Sayi $k.Y)" } else { 'kayıt yok' }
            $yTxt = '—'; $dTxt = 'ölçülmedi'
            if ($script:YuvaYeni.ContainsKey($ad)) {
                $y = $script:YuvaYeni[$ad]
                $yTxt = if ($ad -eq 'T1' -or $ad -eq 'Sensör' -or $ad -eq 'Değişim') { "X $(Sayi $y.X)  Y $(Sayi $y.Y)" } else { "Y $(Sayi $y.Y)" }
                if ($k.Var) { $dTxt = "ΔY $(Sayi ($y.Y - $k.Y))" } else { $dTxt = 'yeni' }
            }
            $it = New-Object System.Windows.Forms.ListViewItem($ad)
            [void]$it.SubItems.Add($kTxt); [void]$it.SubItems.Add($yTxt); [void]$it.SubItems.Add($dTxt)
            if ($script:YuvaYeni.ContainsKey($ad)) { $it.ForeColor = $cYesil }
            [void]$lvYuva.Items.Add($it)
            if ($ad -eq $script:YuvaSecili) { $it.Selected = $true }
        }
        $lvYuva.EndUpdate()
        $t1 = Yuva-Kayitli 'T1'
        $lblYuvaOrtak.Text = "Kayıtlı ortak değerler:  A $(Sayi $t1.A)   B $(Sayi $t1.B)   alma Z $(Sayi ([Eding]::CncGetVariable(4000)))   yaklaşma Z $(Sayi ([Eding]::CncGetVariable(4001)))" +
                             $(if ($script:YuvaYeni.Count -gt 0) { "      ·      $($script:YuvaYeni.Count) yeni değer KAYDEDİLMEDİ" } else { '' })
        $lblYuvaOrtak.ForeColor = if ($script:YuvaYeni.Count -gt 0) { $cAltinAc } else { $cSoluk }
        $lblYuvaSecili.Text = "Seçili: $script:YuvaSecili"
        $btnYuvaAl.Text = "BU KONUMU AL  ($script:YuvaSecili)"
    } catch { try { $lvYuva.EndUpdate() } catch { } }
}

function Yuva-Git {
    if (-not (Hazir-Hareket 'Yuvaya git')) { return }
    $ad = $script:YuvaSecili
    if ($ad -ne 'Sensör' -and $ad -ne 'Değişim' -and [Eding]::CncGetCurrentToolNumber() -ne 0) {
        if (-not (Onay "İş milinde freze var (T$([Eding]::CncGetCurrentToolNumber())). $ad yuvasında freze varsa çarpabilir; iş mili en üstte gidecek ve üstünde duracak. Devam?" 'Yuvaya git')) { return }
    }
    $h = Yuva-Hedef $ad
    $sat = @('G90 G53 G0 Z[#5163]', "G53 G0 A$(Sayi $h.A) B$(Sayi $h.B)", "G53 G0 X$(Sayi $h.X) Y$(Sayi $h.Y)")
    if ($ad -eq 'Değişim' -and $h.Z -and $h.Z -ne 0) { $sat += "G53 G0 Z$(Sayi $h.Z)" }
    $ok = Satirlar-Gonder "$ad noktasına git" $sat 90
    if ($ok) { $lblYuvaDurum.Text = "İş mili $ad üstünde (en üstte). Şimdi X/Y ile ortala, gerekirse aşağı in." }
}

function Yuva-Yaklas {
    if (-not (Hazir-Hareket 'Yaklaş')) { return }
    if ($script:YuvaSecili -ne 'Sensör' -and [Eding]::CncGetCurrentToolNumber() -ne 0) { [Kayit]::Show('İş milinde freze varken yuvaya inilemez (çarpar). Önce bırak (T0) ya da pensi açıp frezi elle çıkar.', 'Yaklaş', 'OK', 'Warning') | Out-Null; return }
    $z = [Eding]::CncGetVariable(4001)
    if (-not (Onay "İş mili yaklaşma yüksekliğine (Z $(Sayi $z)) yavaşça inecek ve frezeye değmeden duracak. Devam?" 'Yaklaş')) { return }
    if (Satirlar-Gonder 'Yaklaş' @("G90 G53 G1 Z$(Sayi $z) F300") 60) { $lblYuvaDurum.Text = "Yaklaşma yüksekliğinde. İnce ayar için 0.1 / 0.01 adımla Z− kullan." }
}

function Yuva-Al {
    if (-not (Baglan)) { return }
    if ([Eding]::AcilKilit) { [Kayit]::Show('ACİL STOP basılı.', 'Konumu al', 'OK', 'Warning') | Out-Null; return }
    if ((Calisiyor-Mu)) { [Kayit]::Show('Makine hareket ediyor, durmasını bekle.', 'Konumu al', 'OK', 'Information') | Out-Null; return }
    $ad = $script:YuvaSecili
    $p = [Eding]::MachinePos()
    if ($ad -eq 'Değişim') {
        $zTop = [Eding]::CncGetVariable(5163)
        $z = if ([math]::Abs($p.Z - $zTop) -lt 0.5) { 0 } else { $p.Z }
        $script:YuvaYeni[$ad] = @{ X = $p.X; Y = $p.Y; Z = $z }
    } elseif ($ad -eq 'Sensör') {
        $gA = [Eding]::CncGetVariable(5224)
        if ([math]::Abs($p.A - $gA) -gt 0.05) { [Kayit]::Show("Sensör G54 A açısında ölçülür (A $(Sayi $gA)), şu an A $(Sayi $p.A).`r`nÖnce 'Yuvaya git' ile sensörün üstüne git, sonra sadece X/Y ile ortala.", 'Konumu al', 'OK', 'Warning') | Out-Null; return }
        $script:YuvaYeni[$ad] = @{ X = $p.X; Y = $p.Y }
    } elseif ($ad -eq 'T1') {
        $e = @{ X = $p.X; Y = $p.Y; A = $p.A; B = $p.B }
        if ($chkYuvaZ.Checked) {
            if ($p.Z -gt ([Eding]::CncGetVariable(4001) - 3)) {
                if (-not (Onay "Z $(Sayi $p.Z) alma yüksekliği için fazla yukarıda görünüyor.`r`nYine de alma yüksekliği olarak alınsın mı?" 'Konumu al')) { return }
            }
            $e.Z = $p.Z
        }
        $script:YuvaYeni[$ad] = $e
    } else {
        $ref = if ($script:YuvaYeni.ContainsKey('T1')) { $script:YuvaYeni['T1'] } else { Yuva-Kayitli 'T1' }
        $uyar = @()
        if ([math]::Abs($p.X - $ref.X) -gt 0.3) { $uyar += "X $(Sayi $p.X) (T1: $(Sayi $ref.X))" }
        if ([math]::Abs($p.A - $ref.A) -gt 0.05) { $uyar += "A $(Sayi $p.A) (T1: $(Sayi $ref.A))" }
        if ($uyar.Count -gt 0) {
            if (-not (Onay ("Bütün yuvalar T1'in X, A ve B değerini kullanır. Bu konum farklı:`r`n" + ($uyar -join "`r`n") + "`r`n`r`nSadece Y alınacak. Devam?") 'Konumu al')) { return }
        }
        $script:YuvaYeni[$ad] = @{ Y = $p.Y }
    }
    [Kayit]::Yaz("YUVA AYARI: $ad alındı (kaydedilmedi): X $(Sayi $p.X) Y $(Sayi $p.Y) Z $(Sayi $p.Z) A $(Sayi $p.A) B $(Sayi $p.B)")
    $lblYuvaDurum.Text = "$ad alındı. Diğer yuvalara geç ya da KAYDET."
    # Sıradakini seç
    $i = [array]::IndexOf($script:YuvaAdlari, $ad)
    if ($i -ge 0 -and $i -lt $script:YuvaAdlari.Count - 1) { $script:YuvaSecili = $script:YuvaAdlari[$i + 1] }
    Yuva-Liste-Yenile
}

function Yuva-Kaydet {
    if ($script:YuvaYeni.Count -eq 0) { [Kayit]::Show('Kaydedilecek yeni değer yok. Önce yuvaları "BU KONUMU AL" ile ölç.', 'Kaydet', 'OK', 'Information') | Out-Null; return }
    if (-not (Hazir-Hareket 'Yuva kaydet')) { return }
    $kT1 = Yuva-Kayitli 'T1'
    $yaz = [ordered]@{}
    $kaydir = $false
    if ($script:YuvaYeni.ContainsKey('T1')) {
        $t1 = $script:YuvaYeni['T1']
        $yaz[4010] = $t1.X; $yaz[4011] = $t1.Y; $yaz[4017] = $t1.A; $yaz[4018] = $t1.B
        if ($t1.ContainsKey('Z')) { $yaz[4000] = $t1.Z }
        $eksik = @(2..6 | Where-Object { -not $script:YuvaYeni.ContainsKey("T$_") })
        if ($eksik.Count -gt 0) {
            $c = [Kayit]::Show("T1 değişti (ΔY $(Sayi ($t1.Y - $kT1.Y)) mm). Ölçülmeyen yuvalar: $((($eksik | ForEach-Object { "T$_" }) -join ', ')).`r`n`r`nEVET: bunlar da T1 ile aynı miktarda kaysın (önerilen)`r`nHAYIR: eski değerlerinde kalsınlar`r`nİPTAL: vazgeç", 'Kaydet', 'YesNoCancel', 'Question')
            if ("$c" -eq 'Cancel') { return }
            $kaydir = ("$c" -eq 'Yes')
        }
    }
    for ($n = 2; $n -le 6; $n++) {
        if ($script:YuvaYeni.ContainsKey("T$n")) { $yaz[4010 + $n] = $script:YuvaYeni["T$n"].Y }
        elseif ($kaydir) { $yaz[4010 + $n] = (Yuva-Kayitli "T$n").Y + ($script:YuvaYeni['T1'].Y - $kT1.Y) }
    }
    if ($script:YuvaYeni.ContainsKey('Sensör')) { $yaz[4020] = $script:YuvaYeni['Sensör'].X; $yaz[4021] = $script:YuvaYeni['Sensör'].Y }
    if ($script:YuvaYeni.ContainsKey('Değişim')) { $yaz[4031] = $script:YuvaYeni['Değişim'].X; $yaz[4032] = $script:YuvaYeni['Değişim'].Y; $yaz[4033] = $script:YuvaYeni['Değişim'].Z }
    $ad = @{ 4000 = 'alma Z'; 4010 = 'yuva X'; 4011 = 'T1 Y'; 4012 = 'T2 Y'; 4013 = 'T3 Y'; 4014 = 'T4 Y'; 4015 = 'T5 Y'; 4016 = 'T6 Y'; 4017 = 'yuva A'; 4018 = 'yuva B'; 4020 = 'sensör X'; 4021 = 'sensör Y'; 4031 = 'değişim X'; 4032 = 'değişim Y'; 4033 = 'değişim Z' }
    $ozet = (@($yaz.Keys | ForEach-Object { "{0,-10} {1,10}   (eski {2})" -f $ad[[int]$_], (Sayi $yaz[$_]), (Sayi ([Eding]::CncGetVariable([int]$_))) }) -join "`r`n")
    if (-not (Onay "Şu değerler kaydedilecek:`r`n`r`n$ozet`r`n`r`nÖnce otomatik yedek alınır. Kaydedilsin mi?" 'Yuva kaydet')) { return }
    Ayar-Yedekle $true
    $ok = $true
    foreach ($nr in $yaz.Keys) { if ($ok) { $ok = (Degisken-Yaz ([int]$nr) ([double]$yaz[$nr])) } }
    if ($ok) {
        $script:YuvaYeni = @{}
        $script:RafKontrolTamam = $true
        Yaz 'Yuva kalibrasyonu kaydedildi.'
        [Kayit]::Show("Kaydedildi. Bir sonraki frez değişiminde kullanılır (Eding'i yeniden başlatmak gerekmez).`r`n`r`nŞimdi 'Test: seçili yuvadan al' ile dene.", 'Yuva kaydet', 'OK', 'Information') | Out-Null
    } else {
        [Kayit]::Show('Kaydetme yarıda kaldı. Eding hazır durumda mı? Yedekten geri dönebilirsin (KALİBRASYON > Yedekten yükle).', 'Yuva kaydet', 'OK', 'Warning') | Out-Null
    }
    Yuva-Liste-Yenile
}

function Yuva-Sifirla {
    if ($script:YuvaYeni.Count -gt 0 -and -not (Onay "Alınan $($script:YuvaYeni.Count) değer silinecek, kalibrasyona baştan başlanacak.`r`nEding'deki kayıtlı değerler DEĞİŞMEZ. Devam?" 'Baştan başla')) { return }
    $script:YuvaYeni = @{}
    $script:YuvaSecili = 'T1'
    $lblYuvaDurum.Text = 'Baştan başlandı. T1 seçili: "Yuvaya git" ile başla.'
    [Kayit]::Yaz('YUVA AYARI: baştan başlandı')
    Yuva-Liste-Yenile
}

function Yuva-Varsayilan {
    if (-not (Hazir-Hareket 'Doğrulanmış değerler')) { return }
    $m = "Frez yuvaları 22.10.2026'da doğrulanan değerlere dönecek:`r`n`r`nX $(Sayi $RafVarsayilan.X)   T1 Y $(Sayi $RafVarsayilan.Y1)   A $(Sayi $RafVarsayilan.A)   B $(Sayi $RafVarsayilan.B)   alma Z $(Sayi $RafVarsayilan.AlmaZ)`r`nT2..T6: T1'e göre +12 / +24 / +54 / +66 / +78 mm`r`n`r`nSensör değişmez. Önce otomatik yedek alınır. Devam?"
    if (-not (Onay $m 'Doğrulanmış değerler')) { return }
    Ayar-Yedekle $true
    $ok = (Degisken-Yaz 4010 $RafVarsayilan.X)
    for ($n = 1; $n -le 6; $n++) { if ($ok) { $ok = (Degisken-Yaz (4010 + $n) ($RafVarsayilan.Y1 + $RafAralik[$n])) } }
    if ($ok) { $ok = (Degisken-Yaz 4017 $RafVarsayilan.A) }
    if ($ok) { $ok = (Degisken-Yaz 4018 $RafVarsayilan.B) }
    if ($ok) { $ok = (Degisken-Yaz 4000 $RafVarsayilan.AlmaZ) }
    $script:YuvaYeni = @{}
    Yaz $(if ($ok) { 'Yuvalar doğrulanmış değerlere döndü.' } else { 'Doğrulanmış değerler yazılamadı.' })
    Yuva-Liste-Yenile
}

function Yuva-Test([int]$n) {
    if ($script:YuvaYeni.Count -gt 0) { [Kayit]::Show('Kaydedilmemiş değerler var. Test kayıtlı değerlerle yapılır; önce KAYDET.', 'Test', 'OK', 'Information') | Out-Null; return }
    Takim-Degistir $n
}

$script:Hedef = $script:Sekmeler['YUVA AYARI']
A-Baslik 'FREZ ALMA KALİBRASYONU   1 yuvayı seç   2 git   3 ortala   4 al   5 KAYDET' 24 6

$lvYuva = New-Object System.Windows.Forms.ListView
$lvYuva.View = 'Details'; $lvYuva.FullRowSelect = $true; $lvYuva.MultiSelect = $false; $lvYuva.HideSelection = $false
$lvYuva.HeaderStyle = 'Nonclickable'
$lvYuva.BackColor = $cPanel; $lvYuva.ForeColor = $cYazi; $lvYuva.BorderStyle = 'FixedSingle'
$lvYuva.Font = New-Object System.Drawing.Font('Consolas', 11)
[void]$lvYuva.Columns.Add('Yuva', 70)
[void]$lvYuva.Columns.Add('Kayıtlı (makine)', 190)
[void]$lvYuva.Columns.Add('Yeni alınan', 170)
[void]$lvYuva.Columns.Add('Fark', 100)
$lvYuva.SetBounds(24, 36, 540, 214)
$lvYuva.Font = New-Object System.Drawing.Font('Consolas', 10.5)
$lvYuva.Add_SelectedIndexChanged({
    if ($lvYuva.SelectedItems.Count -gt 0) {
        $script:YuvaSecili = $lvYuva.SelectedItems[0].Text
        $lblYuvaSecili.Text = "Seçili: $script:YuvaSecili"; $btnYuvaAl.Text = "BU KONUMU AL  ($script:YuvaSecili)"
    }
})
$script:Hedef.Controls.Add($lvYuva)

$lblYuvaSecili = A-Etiket 'Seçili: T1' 580 32 380
$lblYuvaSecili.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 14); $lblYuvaSecili.ForeColor = $cAltinAc; $lblYuvaSecili.Height = 32
[void](A-Buton 'Yuvaya git' 580 72 120 38 { Yuva-Git })
[void](A-Buton 'Yaklaş (#4001)' 706 72 130 38 { Yuva-Yaklas })
[void](A-Buton 'Yukarı' 842 72 110 38 { Yukari-Kaldir })

[void](A-Etiket 'Adım' 580 118 44)
foreach ($v in @(0.01, 0.05, 0.1, 0.5, 1)) {
    $i = [array]::IndexOf(@(0.01, 0.05, 0.1, 0.5, 1), $v)
    $b = A-Buton ("{0}" -f $v) (626 + $i * 66) 116 60 28 ([scriptblock]::Create("`$script:AdimMm = $v; Adim-Isaretle"))
    $b.Tag = $v; $script:AdimButonlari += $b
}
$jogY = @(@('X', 'X−', 'X+'), @('Y', 'Y− arka', 'Y+ ön'), @('Z', 'Z− aşağı', 'Z+ yukarı'), @('A', 'A−', 'A+'), @('B', 'B−', 'B+'))
for ($i = 0; $i -lt $jogY.Count; $i++) {
    $e = $jogY[$i]
    [void](A-Buton $e[1] 580 (152 + $i * 40) 184 36 ([scriptblock]::Create("Jog '$($e[0])' -1")))
    [void](A-Buton $e[2] 770 (152 + $i * 40) 184 36 ([scriptblock]::Create("Jog '$($e[0])' 1")))
}

$lblYuvaOrtak = A-Etiket '' 24 256 540
$lblYuvaOrtak.Height = 40
[void](A-Buton 'Pens aç' 24 300 100 34 { if (Hazir-Hareket 'Pens aç') { [void](Pens-Ac-T0 'Pens aç') } })
[void](A-Buton 'Pens kapat' 130 300 100 34 { Tek-Komut 'Pens kapat' 'M55 P2' })
[void](A-Buton 'Hava üfle' 236 300 100 34 { Hava-Ufle })
$chkYuvaZ = New-Object System.Windows.Forms.CheckBox
$chkYuvaZ.Text = "T1 alınırken Z'yi alma yüksekliği (#4000) olarak da al"
$chkYuvaZ.ForeColor = $cYazi; $chkYuvaZ.BackColor = $cZemin
$chkYuvaZ.SetBounds(24, 344, 540, 24)
$script:Hedef.Controls.Add($chkYuvaZ)

$btnYuvaAl = A-Buton 'BU KONUMU AL  (T1)' 24 376 540 50 { Yuva-Al }
$btnYuvaAl.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 12); $btnYuvaAl.ForeColor = $cAltinAc

$btnYuvaKaydet2 = A-Buton 'KAYDET (hepsi)' 580 360 184 66 { Yuva-Kaydet }
$btnYuvaKaydet2.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 12); $btnYuvaKaydet2.ForeColor = $cYesil
[void](A-Buton 'Baştan başla (sıfırla)' 770 360 184 30 { Yuva-Sifirla })
[void](A-Buton 'Doğrulanmış değerlere dön' 770 396 184 30 { Yuva-Varsayilan })

A-Baslik 'TEST (kayıtlı değerlerle, kazıma hızını %30 yap, el ACİL STOP''ta)' 24 436
for ($n = 1; $n -le 6; $n++) { [void](A-Buton "T$n al" (24 + ($n - 1) * 92) 462 86 34 ([scriptblock]::Create("Yuva-Test $n"))) }
[void](A-Buton 'Bırak (T0)' 580 462 120 34 { Yuva-Test 0 })
$lblYuvaDurum = A-Etiket 'Önce "Baştan başla", sonra T1 seçili iken "Yuvaya git".' 24 504 930
$lblYuvaDurum.ForeColor = $cAltinAc

# ================= DİSK KALİBRASYONU (X Y Z A B) =================
# Bir diske 4 test sığar. Test k: dıştaki 4 cep (r=38) saat 3-6-9-12'den k*45 dk döndürülür,
# içteki grup (Z cebi, pencere, A±20 cepleri, k adet nokta) diskin farklı bir yerine kazılır.
# Formüller (eğim ve konum işaretleri ölçülen yüzey eğimiyle düzeltilir; sadece A, B, Y'nin dönüş yönü bilinmez):
#   eğim : s_u = (d[Ø5] - d[Ø7]) / 76,  s_v = (d[Ø8] - d[Ø4]) / 76
#          s_x = s_u cos(th) - s_v sin(th),  s_y = s_u sin(th) + s_v cos(th)        th = (k-1)*22.5°
#   B    : dB = atan(s_x)                 G54B += sB*dB
#   A    : dA = atan(s_y)                 G54A += sA*dA
#   X    : pencere (üstten -4..+4, alttan 0..+8)   w = 4 - 2*dx  -> dx = (4 - w)/2        G54X += dx
#   Z    : web = T - d1 - d2 ;  h = 1 - web/2 - s_y*cy          #4002 -= h
#   Y    : dy = (d[A+20] - d[A-20] - s_x*18) / (2 sin20)          G54Y += sY*dy
$KalGruplar = @{ 1 = @(15.5, 3.0); 2 = @(-15.5, -2.0); 3 = @(-2.5, 21.0); 4 = @(10.5, -21.0) }
$KalGrupYer = @{ 1 = 'merkezin sağı'; 2 = 'merkezin solu'; 3 = 'merkezin önü (saat 6 tarafı)'; 4 = 'merkezin arkası, sağa yakın' }
$KalHalkaR = 38.0

function Kal-Saat([double]$derece) {
    # Saat 3'ten saat yönünde (öne doğru) derece -> "3:45" gibi
    $dk = [int][math]::Round((3 * 60 + $derece * 2) % 720)
    $s = [math]::Floor($dk / 60); if ($s -eq 0) { $s = 12 }
    return ('{0}:{1:00}' -f $s, ($dk % 60))
}

function Kal-Duzen([int]$k) {
    # Test k'nın bütün ceplerinin disk üzerindeki yeri (disk koordinatı, ön = Y+)
    $th = ($k - 1) * 22.5
    $r = $KalHalkaR
    $kol = { param($a) @([math]::Round($r * [math]::Cos($a * [math]::PI / 180), 3), [math]::Round($r * [math]::Sin($a * [math]::PI / 180), 3)) }
    $g = $KalGruplar[$k]; $cx = $g[0]; $cy = $g[1]
    $p5 = & $kol $th; $p8 = & $kol ($th + 90); $p7 = & $kol ($th + 180); $p4 = & $kol ($th + 270)
    return [ordered]@{
        Th = $th; Cx = $cx; Cy = $cy
        Orta  = @{ X = $cx;      Y = $cy; R = 3.0; A = 0 }
        Sag   = @{ X = $p5[0];   Y = $p5[1]; R = 2.5; A = 0; Saat = (Kal-Saat $th) }
        On    = @{ X = $p8[0];   Y = $p8[1]; R = 4.0; A = 0; Saat = (Kal-Saat ($th + 90)) }
        Sol   = @{ X = $p7[0];   Y = $p7[1]; R = 3.5; A = 0; Saat = (Kal-Saat ($th + 180)) }
        Arka  = @{ X = $p4[0];   Y = $p4[1]; R = 2.0; A = 0; Saat = (Kal-Saat ($th + 270)) }
        Aarti = @{ X = $cx + 9;  Y = $cy; R = 4.0; A = 20 }
        Aeksi = @{ X = $cx - 9;  Y = $cy; R = 3.5; A = -20 }
    }
}

function Kal-Nokta([double]$x, [double]$y, [double]$z, [double]$a, [bool]$ters) {
    # Disk noktası -> program koordinatı. B180 tarafında z o yüzden bakışla verilir; sadece x ters döner.
    if ($ters) { $x = -$x }
    $r = $a * [math]::PI / 180
    $y2 = $y * [math]::Cos($r) + $z * [math]::Sin($r)
    $z2 = -$y * [math]::Sin($r) + $z * [math]::Cos($r)
    return @($x, $y2, $z2)
}

function Kal-NC-Uret([double]$T, [double]$D, [int]$k = 1) {
    $ci = [System.Globalization.CultureInfo]::InvariantCulture
    $f = { param($v) ([double]$v).ToString('0.###', $ci) }
    $dz = Kal-Duzen $k
    $rt = $D / 2
    $ust = $T / 2 + 0.3
    $guv = $T / 2 + 5
    $adim = 0.4
    $sb = New-Object System.Text.StringBuilder
    $L = { param($s) [void]$sb.AppendLine($s) }
    & $L '%'
    & $L "(PrimerMill disk kalibrasyon testi $k/4  disk $(& $f $T) mm  T1 O$(& $f $D) mm  $(Get-Date -Format 'yyyy-MM-dd HH:mm'))"
    & $L 'GOSUB CHECK_EMPTY_TOOL'
    & $L 'G0 G17 G40 G49 G54 G80 G90'
    & $L 'G0 B0.0'
    & $L 'T1 M6'
    & $L 'M3 S18000'
    $cep = {
        param($c, [bool]$ters, [double]$hedefZ)
        $rmax = [math]::Max(0.0, $c.R - $rt)   # 0.0 (KL-03): tamsayı Max cep çapını yuvarlıyordu
        $halkalar = @(); $rr = $rmax; while ($rr -gt 0.05) { $halkalar += $rr; $rr -= [math]::Max(0.3, $D * 0.4) }; $halkalar += 0
        $p0 = Kal-Nokta $c.X $c.Y $guv $c.A $ters
        & $L "G0 X$(& $f $p0[0]) Y$(& $f $p0[1]) Z$(& $f $p0[2])"
        $z = $ust
        while ($true) {
            $z = [math]::Max($hedefZ, $z - $adim)
            foreach ($h in $halkalar) {
                $n = if ($h -lt 0.05) { 1 } else { [math]::Max(12, [int](2 * [math]::PI * $h / 0.4)) }
                for ($i = 0; $i -le $n; $i++) {
                    $t = 2 * [math]::PI * $i / $n
                    $q = Kal-Nokta ($c.X + $h * [math]::Cos($t)) ($c.Y + $h * [math]::Sin($t)) $z $c.A $ters
                    $fd = if ($i -eq 0) { ' F150' } else { ' F500' }
                    & $L "G1 X$(& $f $q[0]) Y$(& $f $q[1]) Z$(& $f $q[2])$fd"
                    if ($h -lt 0.05) { break }
                }
            }
            if ($z -le $hedefZ + 1e-6) { break }
        }
        $p1 = Kal-Nokta $c.X $c.Y $guv $c.A $ters
        & $L "G0 X$(& $f $p1[0]) Y$(& $f $p1[1]) Z$(& $f $p1[2])"
    }
    $kanal = {
        param([double]$x1, [double]$x2, [double]$y1, [double]$y2, [bool]$ters, [double]$hedefZ)
        $xa = $x1 + $rt; $xb = $x2 - $rt; $ya = $y1 + $rt; $yb = $y2 - $rt
        $p0 = Kal-Nokta $xa $ya $guv 0 $ters
        & $L "G0 X$(& $f $p0[0]) Y$(& $f $p0[1]) Z$(& $f $p0[2])"
        $z = $ust
        while ($true) {
            $z = [math]::Max($hedefZ, $z - $adim)
            $yy = $ya; $yon = 1; $ilk = $true
            while ($true) {
                $q1 = Kal-Nokta $(if ($yon -gt 0) { $xa } else { $xb }) $yy $z 0 $ters
                $q2 = Kal-Nokta $(if ($yon -gt 0) { $xb } else { $xa }) $yy $z 0 $ters
                $fd = if ($ilk) { ' F150' } else { ' F500' }; $ilk = $false
                & $L "G1 X$(& $f $q1[0]) Y$(& $f $q1[1]) Z$(& $f $q1[2])$fd"
                & $L "G1 X$(& $f $q2[0]) Y$(& $f $q2[1]) Z$(& $f $q2[2]) F500"
                if ($yy -ge $yb - 1e-6) { break }
                $yy = [math]::Min($yb, $yy + [math]::Max(0.3, $D * 0.4)); $yon = -$yon
            }
            foreach ($kk in @(@($xa, $ya), @($xb, $ya), @($xb, $yb), @($xa, $yb), @($xa, $ya))) {
                $q = Kal-Nokta $kk[0] $kk[1] $z 0 $ters; & $L "G1 X$(& $f $q[0]) Y$(& $f $q[1]) Z$(& $f $q[2]) F500"
            }
            if ($z -le $hedefZ + 1e-6) { break }
        }
        $p1 = Kal-Nokta $xa $ya $guv 0 $ters
        & $L "G0 X$(& $f $p1[0]) Y$(& $f $p1[1]) Z$(& $f $p1[2])"
    }
    $cx = $dz.Cx; $cy = $dz.Cy
    # --- ÜST YÜZ (B0, A0)
    & $L "(UST YUZ B0 - test $k)"
    & $L 'GOSUB Z_SAFE'
    & $L 'G0 A0.0 B0.0'
    & $L '(Z cebi)'; & $cep $dz.Orta $false 1.0
    foreach ($ad in @('Sag', 'On', 'Sol', 'Arka')) { & $L "($ad)"; & $cep $dz[$ad] $false ($T / 2 - 4) }
    & $L "(test no: $k nokta)"
    for ($i = 0; $i -lt $k; $i++) {
        $px = $cx - 3 + 2 * $i; $py = $cy + 5
        & $L "G0 X$(& $f $px) Y$(& $f $py) Z$(& $f $guv)"
        & $L "G1 Z$(& $f ($T / 2 - 0.6)) F150"
        & $L "G0 Z$(& $f $guv)"
    }
    & $L '(PENCERE UST)'
    & $kanal ($cx - 4) ($cx + 4) ($cy - 11) ($cy - 7) $false -1.0
    foreach ($ad in @('Aarti', 'Aeksi')) {
        $c = $dz[$ad]
        & $L "($ad A$($c.A))"
        & $L 'GOSUB Z_SAFE'
        & $L "G0 A$(& $f $c.A) B0.0"
        & $cep $c $false ($T / 2 - 3.5)
    }
    # --- ALT YÜZ (B180, A0)
    & $L '(ALT YUZ B180)'
    & $L 'GOSUB Z_SAFE'
    & $L 'G0 A0.0'
    & $L 'GOSUB AZXY_SAFE'
    & $L 'G0 B180.0'
    & $L '(Z cebi alt)'; & $cep $dz.Orta $true 1.0
    & $L '(PENCERE ALT)'
    & $kanal $cx ($cx + 8) ($cy - 11) ($cy - 7) $true -1.0
    & $L 'GOSUB Z_SAFE'
    & $L 'G0 A0.0'
    & $L 'GOSUB AZXY_SAFE'
    & $L 'G0 B0.0'
    & $L 'M5'
    & $L 'T0 M6'
    & $L 'G30'
    & $L 'M30'
    & $L '%'
    return $sb.ToString()
}


# ---- Sekme: DİSK KALİBRASYONU ----
$KalGecmis = [System.IO.Path]::Combine($ScriptKlasor, 'kalibrasyon_gecmisi.csv')
$script:KalSonuc = $null
$KalOlcumTanim = [ordered]@{
    'w'   = @('1  Pencere genişliği (X yönü, boydan boya açık kısım)', '4.00')
    'd1'  = @('2  Z cebi Ø6 derinliği  ÜSTTEN', '')
    'd2'  = @('3  Z cebi Ø6 derinliği  ALTTAN', '')
    'dR'  = @('4  Dış Ø5 cebi derinliği', '')
    'dL'  = @('5  Dış Ø7 cebi derinliği', '')
    'dF'  = @('6  Dış Ø8 cebi derinliği', '')
    'dK'  = @('7  Dış Ø4 cebi derinliği', '')
    'dAp' = @('8  İç Ø8 cebi (A+20) derinliği, ortası', '')
    'dAm' = @('9  İç Ø7 cebi (A−20) derinliği, ortası', '')
}
$script:KalKutu = @{}

function Kal-Degerleri-Goster {
    if (-not $script:ApiHazir -or -not $script:Bagli) { $lblKalSimdi.Text = 'Eding bağlı değil'; return }
    $g = @(5221, 5222, 5223, 5224, 5225 | ForEach-Object { Sayi ([Eding]::CncGetVariable($_)) })
    $lblKalSimdi.Text = "Şu an  G54  X $($g[0])  Y $($g[1])  Z $($g[2])  A $($g[3])  B $($g[4])   ·   #4002 $(Sayi ([Eding]::CncGetVariable(4002)))"
}

function Kal-Test-Hazirla {
    $T = Metin-Sayi $txtKalT.Text; $D = Metin-Sayi $txtKalD.Text
    if ($null -eq $T -or $T -lt 10 -or $T -gt 30) { [Kayit]::Show('Disk kalınlığını kumpasla ölçüp yaz (10–30 mm).', 'Test bloğu', 'OK', 'Warning') | Out-Null; return }
    if ($null -eq $D -or $D -lt 0.5 -or $D -gt 3) { [Kayit]::Show('T1 frez çapını yaz (genelde 2.0 mm).', 'Test bloğu', 'OK', 'Warning') | Out-Null; return }
    if (Is-Suruyor-Uyari 'Test bloğu') { return }
    $k = $cmbKalTest.SelectedIndex + 1
    $dzK = Kal-Duzen $k
    $m = "Kalibrasyon testi $k / 4 hazırlanacak ve seçilecek:`r`n`r`n" +
         "• T1 (Ø$(Sayi $D)) ile, disk $(Sayi $T) mm`r`n• Bir diske 4 test sığar. Test ${k}: dış cepler saat $($dzK.Sag.Saat)'ten başlar, iç grup $($KalGrupYer[$k])`r`n" +
         "• Bu disk $(if ($k -eq 1) { 'YENİ (boş) olmalı' } else { "daha önce test 1..$($k - 1) için kullanılmış olabilir; aynı yüz üstte olmalı" })`r`n" +
         "• En derin kesim yüzeyden $(Sayi ($T / 2 + 1)) mm: frezin boyu yetmeli`r`n• Süre: yaklaşık 15 dakika`r`n`r`nSonra ana ekranda BAŞLAT'a bas. Devam?"
    if (-not (Onay $m 'Test bloğu')) { return }
    # Frez nasıl takılacak? (manuel modda T1'i makine ortaya gelince elle takarsın, sonunda elle çıkarırsın)
    if (-not (Baglan)) { [Kayit]::Show("Eding'e bağlanılamadı.", 'Test bloğu', 'OK', 'Warning') | Out-Null; return }
    $mod = Frez-Modu-Sor
    if (-not $mod) { return }
    if (-not (Frez-Modu-Yaz ($mod -eq 'MANUEL'))) { return }
    if ($mod -eq 'MANUEL' -and -not (Manuel-Macro-Kontrol)) { return }
    try {
        $metin = Kal-NC-Uret $T $D $k
        [void][System.IO.Directory]::CreateDirectory($IsKlasor)
        $hedef = [System.IO.Path]::Combine($IsKlasor, "PM_kalibrasyon_testi_$k.nc")
        [System.IO.File]::WriteAllText($hedef, $metin)
        [System.IO.File]::Copy($hedef, [System.IO.Path]::Combine($IsKlasor, $AktifIsAdi), $true)
        $script:SeciliDosya = $hedef
        $lblDosya.Text = "PM_kalibrasyon_testi_$k"; $lblDosya.ForeColor = $cYazi
        Yaz "Kalibrasyon testi hazırlandı: $hedef  (disk $(Sayi $T), T1 Ø$(Sayi $D))"
        Dosyayi-Kontrol-Et $hedef
        $script:Tercih.KalT = $txtKalT.Text; $script:Tercih.KalD = $txtKalD.Text; $script:Tercih.KalTest = "$k"; Tercih-Yaz
        $script:ModOnayliDosya = $hedef
        $lblKalDurum.Text = if ($mod -eq 'MANUEL') { "Test $k seçildi, frez MANUEL. Ana ekranda BAŞLAT: iş mili ortaya gelince T1'i tak, sonunda çıkar. Bitince diski çıkar, ölç." } else { "Test $k seçildi, frez OTOMATİK. Ana ekranda BAŞLAT. Bitince diski çıkar, ölç, değerleri sağa yaz." }
    } catch { [Kayit]::Show("Test programı yazılamadı: $($_.Exception.Message)", 'Test bloğu', 'OK', 'Error') | Out-Null }
}

function Kal-Hesapla {
    $T = Metin-Sayi $txtKalT.Text
    $o = @{}
    foreach ($k in $KalOlcumTanim.Keys) {
        $v = Metin-Sayi $script:KalKutu[$k].Text
        if ($null -eq $v) { [Kayit]::Show("Ölçüm eksik: $($KalOlcumTanim[$k][0])", 'Hesapla', 'OK', 'Warning') | Out-Null; return }
        $o[$k] = $v
    }
    if ($null -eq $T) { [Kayit]::Show('Disk kalınlığı eksik.', 'Hesapla', 'OK', 'Warning') | Out-Null; return }
    $sA = if ($chkKalA.Checked) { -1 } else { 1 }; $sB = if ($chkKalB.Checked) { -1 } else { 1 }; $sY = if ($chkKalY.Checked) { -1 } else { 1 }
    $k = $cmbKalTest.SelectedIndex + 1
    $dz = Kal-Duzen $k
    $th = $dz.Th * [math]::PI / 180
    # (PowerShell değişken adları büyük/küçük harf ayırmaz: eğimler $egX/$egY, yön işaretleri $sA/$sB/$sY)
    # Yüzey eğimi doğrudan ölçülen derinliklerden (yön bilgisi gerekmez); test döndürülmüşse X/Y'ye çevrilir
    $su = ($o.dR - $o.dL) / (2 * $KalHalkaR); $sv = ($o.dF - $o.dK) / (2 * $KalHalkaR)
    $egX = $su * [math]::Cos($th) - $sv * [math]::Sin($th)
    $egY = $su * [math]::Sin($th) + $sv * [math]::Cos($th)
    $dx = (4.0 - $o.w) / 2
    $web = $T - $o.d1 - $o.d2
    $h = 1.0 - $web / 2 - $egY * $dz.Cy
    $dB = [math]::Atan($egX) * 180 / [math]::PI
    $dA = [math]::Atan($egY) * 180 / [math]::PI
    $dy = ($o.dAp - $o.dAm - $egX * 18.0) / (2 * [math]::Sin(20 * [math]::PI / 180))
    $mOrta = $o.d1 - $T / 2 + 1 - ($egX * $dz.Cx + $egY * $dz.Cy) - $h
    $g = @{ X = [Eding]::CncGetVariable(5221); Y = [Eding]::CncGetVariable(5222); A = [Eding]::CncGetVariable(5224); B = [Eding]::CncGetVariable(5225) }
    $p4002 = [Eding]::CncGetVariable(4002)
    $script:KalSonuc = @{
        X = $g.X + $dx; Y = $g.Y + $sY * $dy; A = $g.A + $sA * $dA; B = $g.B + $sB * $dB; P4002 = $p4002 - $h
        dx = $dx; dy = $sY * $dy; h = $h; dA = $sA * $dA; dB = $sB * $dB; m = $mOrta; web = $web; O = $o; T = $T; Test = $k
        Eski = "X $(Sayi $g.X) Y $(Sayi $g.Y) A $(Sayi $g.A) B $(Sayi $g.B) #4002 $(Sayi $p4002)"
    }
    $iyi = { param($v, $s) if ([math]::Abs($v) -le $s) { '✓' } else { '' } }
    $sonucMetni = "X  düzeltme $(Sayi $dx) mm   →  G54 X $(Sayi $script:KalSonuc.X)  $(& $iyi $dx 0.02)`r`n" +
         "Y  düzeltme $(Sayi ($sY * $dy)) mm   →  G54 Y $(Sayi $script:KalSonuc.Y)  $(& $iyi $dy 0.02)`r`n" +
         "Z  düzeltme $(Sayi (-$h)) mm   →  #4002 $(Sayi $script:KalSonuc.P4002)   (web $(Sayi $web), olması gereken 2.000)  $(& $iyi $h 0.02)`r`n" +
         "A  düzeltme $(Sayi ($sA * $dA))°   →  G54 A $(Sayi $script:KalSonuc.A)  $(& $iyi $dA 0.05)`r`n" +
         "B  düzeltme $(Sayi ($sB * $dB))°   →  G54 B $(Sayi $script:KalSonuc.B)  $(& $iyi $dB 0.05)"
    if ([math]::Abs($mOrta) -gt 0.1) { $sonucMetni += "`r`n`r`nNOT: disk ortası B ekseninden $(Sayi $mOrta) mm kaçık. Bu yazılımla düzeltilemez: disk tutucuya tam oturmuş mu, kalınlığı CAM'deki ile aynı mı?" }
    $buyuk = ([math]::Abs($dx) -gt 2 -or [math]::Abs($dy) -gt 3 -or [math]::Abs($h) -gt 2 -or [math]::Abs($dA) -gt 4 -or [math]::Abs($dB) -gt 4)
    if ($buyuk) { $sonucMetni += "`r`n`r`nDİKKAT: düzeltmelerden biri çok büyük. Ölçümleri ve cepleri (çaplarına göre) tekrar kontrol et." }
    $lblKalSonuc.Text = $sonucMetni
    $lblKalSonuc.ForeColor = if ($buyuk) { $cKirmizi } else { $cYazi }
    $btnKalUygula.Enabled = $true
    [Kayit]::Yaz("DİSK KALİBRASYONU hesap (test $k): dx $(Sayi $dx) dy $(Sayi ($sY*$dy)) h $(Sayi $h) dA $(Sayi ($sA*$dA)) dB $(Sayi ($sB*$dB)) m $(Sayi $mOrta)  ölçümler: " + (($KalOlcumTanim.Keys | ForEach-Object { "$_=$($o[$_])" }) -join ' '))
}

function Kal-Uygula {
    $r = $script:KalSonuc
    if (-not $r) { [Kayit]::Show('Önce ölçümleri yaz ve HESAPLA''ya bas.', 'Disk kalibrasyonu', 'OK', 'Information') | Out-Null; return }
    if (-not (Hazir-Hareket 'Disk kalibrasyonu')) { return }
    $g92 = @(5211, 5212, 5214, 5215 | Where-Object { [math]::Abs([Eding]::CncGetVariable($_)) -gt 0.0005 })
    $m = "Yeni disk kalibrasyonu kaydedilecek:`r`n`r`nG54  X $(Sayi $r.X)   Y $(Sayi $r.Y)   A $(Sayi $r.A)   B $(Sayi $r.B)`r`n#4002 (Z sıfırı) $(Sayi $r.P4002)`r`n`r`nEski: $($r.Eski)`r`n`r`n" +
         $(if ($g92.Count) { "X/Y/A/B'deki G92 kaydırmaları da sıfırlanacak.`r`n" } else { '' }) +
         "Önce otomatik yedek alınır. Sonra bir frez değişimi yap (Z yeniden ölçülsün). Devam?"
    if (-not (Onay $m 'Disk kalibrasyonu')) { return }
    Ayar-Yedekle $true
    $ok = $true
    if ($g92.Count) { $ok = Komut-Sonucu 'G92 sıfırla' ([Eding]::CncRunSingleLine('G92.1')); if ($ok) { $ok = Hareket-Bitene-Kadar-Bekle 5 } }
    if ($ok) { $ok = Komut-Sonucu 'G54' ([Eding]::CncRunSingleLine("G10 L2 P1 X$(Sayi $r.X) Y$(Sayi $r.Y) A$(Sayi $r.A) B$(Sayi $r.B)")); if ($ok) { $ok = Hareket-Bitene-Kadar-Bekle 5 } }
    if ($ok) { $ok = Degisken-Yaz 4002 $r.P4002 }
    try {
        if (-not [System.IO.File]::Exists($KalGecmis)) {
            [System.IO.File]::WriteAllText($KalGecmis, "tarih;test;disk;pencere;d1;d2;sag;sol;on;arka;A+20;A-20;dX;dY;dZ;dA;dB;disk_kacik;eski;yeni_X;yeni_Y;yeni_A;yeni_B;yeni_4002;uygulandi`r`n", [System.Text.Encoding]::UTF8)
        }
        $o = $r.O
        $satir = (@((Get-Date -Format 'yyyy-MM-dd HH:mm'), $r.Test, (Sayi $r.T), $o.w, $o.d1, $o.d2, $o.dR, $o.dL, $o.dF, $o.dK, $o.dAp, $o.dAm,
                   (Sayi $r.dx), (Sayi $r.dy), (Sayi (-$r.h)), (Sayi $r.dA), (Sayi $r.dB), (Sayi $r.m), $r.Eski,
                   (Sayi $r.X), (Sayi $r.Y), (Sayi $r.A), (Sayi $r.B), (Sayi $r.P4002), $(if ($ok) { 'evet' } else { 'HATA' })) -join ';')
        [System.IO.File]::AppendAllText($KalGecmis, $satir + "`r`n", [System.Text.Encoding]::UTF8)
    } catch { }
    Kal-Degerleri-Goster
    try { Ayar-Oku } catch { }
    if ($ok) {
        Yaz "Disk kalibrasyonu kaydedildi: G54 X $(Sayi $r.X) Y $(Sayi $r.Y) A $(Sayi $r.A) B $(Sayi $r.B), #4002 $(Sayi $r.P4002)"
        $script:KalSonuc = $null
        [Kayit]::Show("Kaydedildi (geçmiş: kalibrasyon_gecmisi.csv).`r`n`r`n1. Bir frez değişimi yap ya da 'Frez boyunu ölç'`r`n2. YENİ bir diskte testi tekrar kaz`r`n3. Bütün satırlarda ✓ görünene kadar tekrarla`r`n`r`nBir eksenin hatası küçülmek yerine büyüdüyse o eksenin 'yönü ters' kutusunu işaretle.", 'Disk kalibrasyonu', 'OK', 'Information') | Out-Null
    } else {
        [Kayit]::Show('Kaydetme yarıda kaldı. KALİBRASYON > Yedekten yükle ile geri dönebilirsin.', 'Disk kalibrasyonu', 'OK', 'Warning') | Out-Null
    }
}

$script:Hedef = $script:Sekmeler['DİSK KALİBRASYONU']
A-Baslik 'DİSK KALİBRASYONU (X Y Z A B)    1 başla   2 test kaz   3 kumpasla ölç   4 hesapla   5 kaydet   · tekrarla' 24 6
$lblKalSimdi = A-Etiket '' 24 30 930
$lblKalSimdi.ForeColor = $cAltinAc

A-Baslik '1  BAŞLANGIÇ' 24 60
[void](A-Buton 'Üretici değerlerine dön (sıfırla)' 24 84 260 34 { G54-Ureticiye-Don; Kal-Degerleri-Goster })
[void](A-Etiket 'İlk kalibrasyonda bir kere: bilinen iyi değerden başla.' 24 122 440)

A-Baslik '2  TEST BLOĞU (T1, boş PMMA disk)' 24 152
[void](A-Etiket 'Disk kalınlığı (kumpas)' 24 178 170)
$txtKalT = A-Kutu 200 178 80
$txtKalT.Text = if ($script:Tercih.KalT) { $script:Tercih.KalT } else { '16.00' }
[void](A-Etiket 'T1 çapı' 290 178 60)
$txtKalD = A-Kutu 352 178 70
$txtKalD.Text = if ($script:Tercih.KalD) { $script:Tercih.KalD } else { '2.00' }
[void](A-Etiket 'Test no' 24 212 70)
$cmbKalTest = New-Object System.Windows.Forms.ComboBox
$cmbKalTest.DropDownStyle = 'DropDownList'; $cmbKalTest.BackColor = $cPanel; $cmbKalTest.ForeColor = $cYazi; $cmbKalTest.FlatStyle = 'Flat'
$cmbKalTest.Font = New-Object System.Drawing.Font('Segoe UI', 10.5)
foreach ($i in 1..4) { [void]$cmbKalTest.Items.Add("$i / 4") }
$cmbKalTest.SetBounds(100, 212, 80, 28)
$script:Hedef.Controls.Add($cmbKalTest)
[void](A-Buton 'Yeni disk (test 1)' 190 210 170 30 { $cmbKalTest.SelectedIndex = 0 })
[void](A-Buton 'Test programını hazırla' 24 246 260 34 { Kal-Test-Hazirla })
$lblKalYerlesim = A-Etiket '' 24 284 460
function Kal-Yerlesim-Yaz {
    $k = $cmbKalTest.SelectedIndex + 1; if ($k -lt 1) { return }
    $dz = Kal-Duzen $k
    $lblKalYerlesim.Text = "Test $k (üstten bakış, ön = saat 6)`r`n" +
        "Dış cepler, kenara yakın:`r`n" +
        "   Ø5 saat $($dz.Sag.Saat)   Ø8 saat $($dz.On.Saat)   Ø7 saat $($dz.Sol.Saat)   Ø4 saat $($dz.Arka.Saat)`r`n" +
        "İç grup, $($KalGrupYer[$k]):`r`n" +
        "   Ø7 (A−20)  ·  Ø6 Z cebi + $k nokta  ·  Ø8 (A+20)`r`n" +
        "   pencere, Z cebinin arkasında`r`n" +
        "Derinliği kumpasın derinlik ucuyla cebin ortasından ölç."
}
$lblKalYerlesim.Height = 126; $lblKalYerlesim.Font = New-Object System.Drawing.Font('Consolas', 9)
$cmbKalTest.Add_SelectedIndexChanged({ Kal-Yerlesim-Yaz })
$kt = 1; try { $kt = [int]$script:Tercih.KalTest + 1 } catch { }; if ($kt -lt 1 -or $kt -gt 4) { $kt = 1 }
$cmbKalTest.SelectedIndex = $kt - 1
$lblKalDurum = A-Etiket '' 24 414 460
$lblKalDurum.Height = 40; $lblKalDurum.ForeColor = $cAltinAc

A-Baslik '3  ÖLÇÜMLER (mm)' 500 60
$k = 0
foreach ($ad in $KalOlcumTanim.Keys) {
    [void](A-Etiket $KalOlcumTanim[$ad][0] 500 (84 + $k * 30) 340)
    $script:KalKutu[$ad] = A-Kutu 850 (84 + $k * 30) 90
    $script:KalKutu[$ad].Text = $KalOlcumTanim[$ad][1]
    $k++
}
$chkKalA = New-Object System.Windows.Forms.CheckBox; $chkKalA.Text = 'A yönü ters'; $chkKalA.ForeColor = $cSoluk; $chkKalA.SetBounds(500, 356, 120, 24); $chkKalA.Checked = ($script:Tercih.KalSA -eq '1')
$chkKalB = New-Object System.Windows.Forms.CheckBox; $chkKalB.Text = 'B yönü ters'; $chkKalB.ForeColor = $cSoluk; $chkKalB.SetBounds(626, 356, 120, 24); $chkKalB.Checked = ($script:Tercih.KalSB -eq '1')
$chkKalY = New-Object System.Windows.Forms.CheckBox; $chkKalY.Text = 'Y yönü ters'; $chkKalY.ForeColor = $cSoluk; $chkKalY.SetBounds(752, 356, 120, 24); $chkKalY.Checked = ($script:Tercih.KalSY -eq '1')
foreach ($c in @($chkKalA, $chkKalB, $chkKalY)) {
    $c.Add_CheckedChanged({ $script:Tercih.KalSA = if ($chkKalA.Checked) { '1' } else { '0' }; $script:Tercih.KalSB = if ($chkKalB.Checked) { '1' } else { '0' }; $script:Tercih.KalSY = if ($chkKalY.Checked) { '1' } else { '0' }; Tercih-Yaz })
    $script:Hedef.Controls.Add($c)
}
[void](A-Buton '4  HESAPLA' 500 384 140 36 { Kal-Hesapla })
$btnKalUygula = A-Buton '5  UYGULA VE KAYDET' 646 384 200 36 { Kal-Uygula }
$btnKalUygula.ForeColor = $cYesil
[void](A-Buton 'Geçmiş' 852 384 90 36 { if ([System.IO.File]::Exists($KalGecmis)) { Start-Process notepad.exe $KalGecmis } else { [Kayit]::Show('Henüz kayıt yok.', 'Geçmiş', 'OK', 'Information') | Out-Null } })
$lblKalSonuc = A-Etiket '' 500 426 460
$lblKalSonuc.Height = 136; $lblKalSonuc.Font = New-Object System.Drawing.Font('Consolas', 9.5)
[void](A-Buton 'Frez boyunu ölç' 24 470 160 34 { Takim-Olc })
[void](A-Etiket 'Bitti: X Y Z farkı ≤ 0.02 mm, A B farkı ≤ 0.05°. Bir diske 4 test sığar.' 24 512 460)


# ================= OTOMATİK KALİBRASYON (iletken temas, titanyum disk) =================
# Titanyum disk tutucudan izole edilir ve prob girişine bağlanır; iş milindeki pim (veya T1) diske değince devre kapanır.
# Kumpas yok, kesim yok: makine diske dokunarak ölçer, değerleri hesaplar, onayla G54 ve #4002'ye yazar.
# Ölçüm (hepsi iş koordinatında, Z ucu ile, G38.2):
#   B0 A0  üst yüz  5 nokta (0,0) (±R,0) (0,±R)    -> yüz düzlemi: eğim X/Y
#   A±θ    üst yüz  (0,±d)                          -> iki eğik çizginin kesişimi = A ekseninin Y'si   (uç şekli birbirini götürür)
#   B±θ    üst yüz  (±d,0)                          -> kesişim = B ekseninin X'i; çizgi açıları = A/B açı ölçeği ve yönü
#   B180   alt yüz  5 nokta                         -> B sıfırı = (üst eğim + alt eğim)/2 (disk takma eğikliği ayrılır)
#                                                      Z ekseni = (z_üst + z_alt' - T)/2 ;  #4002 -= Z ekseni
#   Tekrarlanabilirlik: merkez 5 kez yavaş ölçülür.
# Sonuçlar #4100..#4145 (kalıcı), #4199 = ölçüm kimliği, #4100 = 1 bittiğinde.
$OkTeta = 15.0; $OkD = 8.0; $OkR = 25.0
$OkNoktalar = @(
    @{ Ad = 'ust merkez';  X = 0;     Y = 0;     Grup = 'U' }   # 0
    @{ Ad = 'ust X+';      X = $OkR;  Y = 0;     Grup = 'U' }   # 1
    @{ Ad = 'ust X-';      X = -$OkR; Y = 0;     Grup = 'U' }   # 2
    @{ Ad = 'ust Y+';      X = 0;     Y = $OkR;  Grup = 'U' }   # 3
    @{ Ad = 'ust Y-';      X = 0;     Y = -$OkR; Grup = 'U' }   # 4
    @{ Ad = 'A+ Y-';       X = 0;     Y = -$OkD; Grup = 'Ap' }  # 5
    @{ Ad = 'A+ Y+';       X = 0;     Y = $OkD;  Grup = 'Ap' }  # 6
    @{ Ad = 'A- Y-';       X = 0;     Y = -$OkD; Grup = 'Am' }  # 7
    @{ Ad = 'A- Y+';       X = 0;     Y = $OkD;  Grup = 'Am' }  # 8
    @{ Ad = 'B+ X-';       X = -$OkD; Y = 0;     Grup = 'Bp' }  # 9
    @{ Ad = 'B+ X+';       X = $OkD;  Y = 0;     Grup = 'Bp' }  # 10
    @{ Ad = 'B- X-';       X = -$OkD; Y = 0;     Grup = 'Bm' }  # 11
    @{ Ad = 'B- X+';       X = $OkD;  Y = 0;     Grup = 'Bm' }  # 12
    @{ Ad = 'alt merkez';  X = 0;     Y = 0;     Grup = 'L' }   # 13
    @{ Ad = 'alt X+';      X = $OkR;  Y = 0;     Grup = 'L' }   # 14
    @{ Ad = 'alt X-';      X = -$OkR; Y = 0;     Grup = 'L' }   # 15
    @{ Ad = 'alt Y+';      X = 0;     Y = $OkR;  Grup = 'L' }   # 16
    @{ Ad = 'alt Y-';      X = 0;     Y = -$OkR; Grup = 'L' }   # 17
)
$OkGecmis = [System.IO.Path]::Combine($ScriptKlasor, 'oto_kalibrasyon_gecmisi.csv')
$script:OkSonuc = $null

function OtoKal-NC-Uret([double]$T, [int]$kimlik) {
    $ci = [System.Globalization.CultureInfo]::InvariantCulture
    $f = { param($v) ([double]$v).ToString('0.###', $ci) }
    $sb = New-Object System.Text.StringBuilder
    $L = { param($s) [void]$sb.AppendLine($s) }
    $kontrol = {
        param($ad)
        & $L 'if [#5067 == 0]'
        & $L "  errmsg ""PM KALIBRASYON: temas yok - $ad - kablo, izolasyon, disk kalinligi"""
        & $L 'endif'
    }
    # Bir nokta: hızlı yaklaş (F120 / uzun: F200), 2 kez yavaş (F10) ölç, ikisini sakla
    $nokta = {
        param([int]$i, [string]$zBas, [string]$zSon, [bool]$uzun)
        $n = $OkNoktalar[$i]; $v1 = 4101 + 2 * $i; $v2 = $v1 + 1
        & $L "(P$i $($n.Ad))"
        & $L "G0 X$(& $f $n.X) Y$(& $f $n.Y)"
        if (-not $uzun) { & $L "G0 Z$zBas" }
        & $L "G38.2 Z$zSon F$(if ($uzun) { 200 } else { 120 })"
        & $kontrol $n.Ad
        # temas başlangıç noktasında olduysa prob baştan aktifti (disk şaseye değiyor)
        if ($uzun) { & $L "if [#5063 > [$zSon + 12]]" } else { & $L "if [#5063 > [$zBas - 0.02]]" }
        & $L "  errmsg ""PM KALIBRASYON: prob baslangicta aktif - $($n.Ad) - disk sasede degiyor olabilir"""
        & $L 'endif'
        & $L 'G0 Z[#5063 + 0.4]'
        & $L 'G38.2 Z[#5063 - 0.8] F10'
        & $kontrol $n.Ad
        & $L "#$v1 = #5063"
        & $L 'G0 Z[#5063 + 0.4]'
        & $L 'G38.2 Z[#5063 - 0.8] F10'
        & $kontrol $n.Ad
        & $L "#$v2 = #5063"
        if ($uzun) { & $L 'G0 Z[#5063 + 6]' } else { & $L "G0 Z$zBas" }
    }
    & $L '%'
    & $L "(PrimerMill OTOMATIK KALIBRASYON  disk $(& $f $T) mm  kimlik $kimlik  $(Get-Date -Format 'yyyy-MM-dd HH:mm'))"
    & $L '(Iletken temas: titanyum disk prob girisine bagli ve tutucudan izole, is mili sasede)'
    & $L '(IS MILI DONMEZ. T1 istenince kalibrasyon pimini veya T1 frezini tak.)'
    & $L '#4100 = 0'
    & $L "#4199 = $kimlik"
    & $L 'GOSUB CHECK_EMPTY_TOOL'
    & $L 'G0 G17 G40 G49 G54 G80 G90'
    & $L 'M5'
    & $L 'M9'
    & $L 'G0 B0.0'
    & $L 'T1 M6'
    & $L 'M5'
    & $L '(takim boyu: sensor)'
    & $L 'GOSUB user_1'
    & $L 'M5'
    # --- B0 A0 üst yüz
    & $L '(UST YUZ B0 A0)'
    & $L 'GOSUB Z_SAFE'
    & $L 'G0 A0.0 B0.0'
    & $nokta 0 '' "$(& $f ($T / 2 - 6))" $true
    & $L '(tekrarlanabilirlik: merkez 5 kez)'
    for ($k = 1; $k -le 5; $k++) {
        & $L 'G0 Z[#4101 + 0.4]'
        & $L 'G38.2 Z[#4101 - 0.8] F10'
        & $kontrol 'tekrar'
        & $L "#$(4140 + $k) = #5063"
    }
    & $L 'G0 Z[#4101 + 6]'
    foreach ($i in 1..4) { & $nokta $i '[#4101 + 6]' '[#4101 - 6]' $false }
    # --- A ± θ
    foreach ($a in @(@($OkTeta, 5, 6), @(-$OkTeta, 7, 8))) {
        & $L "(A$(& $f $a[0]) B0)"
        & $L 'GOSUB Z_SAFE'
        & $L "G0 A$(& $f $a[0]) B0.0"
        & $nokta $a[1] '[#4101 + 6]' '[#4101 - 6]' $false
        & $nokta $a[2] '[#4101 + 6]' '[#4101 - 6]' $false
    }
    # --- B ± θ
    foreach ($b in @(@($OkTeta, 9, 10), @(-$OkTeta, 11, 12))) {
        & $L "(B$(& $f $b[0]) A0)"
        & $L 'GOSUB Z_SAFE'
        & $L 'G0 A0.0'
        & $L 'GOSUB AZXY_SAFE'
        & $L "G0 B$(& $f $b[0])"
        & $nokta $b[1] '[#4101 + 6]' '[#4101 - 6]' $false
        & $nokta $b[2] '[#4101 + 6]' '[#4101 - 6]' $false
    }
    # --- B180 alt yüz (ilk nokta yukarıdan uzun yaklaşma ile: alt yüzün yüksekliği bilinmiyor)
    & $L '(ALT YUZ B180)'
    & $L 'GOSUB Z_SAFE'
    & $L 'G0 A0.0'
    & $L 'GOSUB AZXY_SAFE'
    & $L 'G0 B180.0'
    & $nokta 13 '' "$(& $f ($T / 2 - 6))" $true
    foreach ($i in 14..17) { & $nokta $i '[#4127 + 6]' '[#4127 - 6]' $false }
    & $L '(bitti)'
    & $L 'GOSUB Z_SAFE'
    & $L 'G0 A0.0'
    & $L 'GOSUB AZXY_SAFE'
    & $L 'G0 B0.0'
    & $L '#4100 = 1'
    & $L 'msg "PM KALIBRASYON: olcum bitti - PrimerMill > Ayarlar > OTO KALIBRASYON > SONUCLARI OKU"'
    & $L 'M5'
    & $L 'T0 M6'
    & $L 'G30'
    & $L 'M30'
    & $L '%'
    return $sb.ToString()
}

function OkRot([double[]]$p, [string]$eksen, [double]$derece, [double[]]$m) {
    # p noktasını, m'den geçen X ya da Y eksenine paralel doğru etrafında döndürür
    $t = $derece * [math]::PI / 180; $cs = [math]::Cos($t); $sn = [math]::Sin($t)
    $x = $p[0] - $m[0]; $y = $p[1] - $m[1]; $z = $p[2] - $m[2]
    if ($eksen -eq 'Y') { return @(($x * $cs + $z * $sn + $m[0]), ($y + $m[1]), ((-$x) * $sn + $z * $cs + $m[2])) }
    return @(($x + $m[0]), ($y * $cs - $z * $sn + $m[1]), ($y * $sn + $z * $cs + $m[2]))
}

function OkModel([double[]]$q, [int]$i, [double]$T, [string]$ucTip, [double]$ucR) {
    # Makine modeli -> nokta i'de beklenen temas Z'si.
    # q: 0 xb  1 ya  2 zb  3 eA  4 eB  5 gA  6 gB  7 m (disk ortası)  8 wx (yüzler arası açı, X yönü)  9 c (disk takma eğikliği, X ekseni)
    #    Diskin Y etrafında rijit eğikliği B sıfırından ayırt edilemez; o yüzden B düzeltmesine dahildir (istenen de budur).
    # Zincir: B (çevirme, Y ekseni) içte, A (eğme, X ekseni) dışta; iki eksen aynı Z'de kesişir.
    $n = $OkNoktalar[$i]
    $Ak = 0.0; $Bk = 0.0; $ust = $true
    switch ($n.Grup) { 'Ap' { $Ak = $OkTeta } 'Am' { $Ak = -$OkTeta } 'Bp' { $Bk = $OkTeta } 'Bm' { $Bk = -$OkTeta } 'L' { $Bk = 180.0; $ust = $false } }
    $h = if ($ust) { $T / 2 + $q[7] } else { -$T / 2 + $q[7] }
    $nv = if ($ust) { @(0.0, 0.0, 1.0) } else { @(0.0, 0.0, -1.0) }
    $o = @(0.0, 0.0, 0.0)
    $w = if ($ust) { $q[8] / 2 } else { -$q[8] / 2 }
    $pt = OkRot (OkRot @(0.0, 0.0, $h) 'Y' $w $o) 'X' $q[9] $o
    $nv = OkRot (OkRot $nv 'Y' $w $o) 'X' $q[9] $o
    $pt = @(($pt[0] + $q[0]), ($pt[1] + $q[1]), ($pt[2] + $q[2]))
    # B180 çevirmesinde ölçek uygulanmaz (±15°'den 180°'ye taşımak gürültüyü 12 kat büyütür): çevirme açısı hatası 'kama' içinde görünür
    $bA = $(if ($Bk -eq 180.0) { 180.0 * [math]::Sign($q[6]) } else { $q[6] * $Bk }) + $q[4]; $aA = $q[5] * $Ak + $q[3]
    $pt = OkRot $pt 'Y' $bA @($q[0], 0.0, $q[2]); $nv = OkRot $nv 'Y' $bA $o
    $pt = OkRot $pt 'X' $aA @(0.0, $q[1], $q[2]); $nv = OkRot $nv 'X' $aA $o
    if ($nv[2] -le 0.2) { throw "model: yüz yukarı bakmıyor (nokta $i)" }
    $zc = $pt[2] - ($nv[0] * ($n.X - $pt[0]) + $nv[1] * ($n.Y - $pt[1])) / $nv[2]
    if ($ucTip -eq 'kure') { return $zc + $ucR * (1 / $nv[2] - 1) }
    return $zc + $ucR * [math]::Sqrt($nv[0] * $nv[0] + $nv[1] * $nv[1]) / $nv[2]
}

function OkCoz([double[][]]$M, [double[]]$v) {
    # Küçük doğrusal sistem: Gauss eleme (kısmi pivot). PowerShell 5.1 için iki boyutlu dizi yerine satır dizileri.
    $k = $v.Count
    $a = New-Object 'double[][]' $k
    for ($i = 0; $i -lt $k; $i++) { $a[$i] = New-Object 'double[]' ($k + 1); for ($j = 0; $j -lt $k; $j++) { $a[$i][$j] = $M[$i][$j] }; $a[$i][$k] = $v[$i] }
    for ($c = 0; $c -lt $k; $c++) {
        $p = $c
        for ($i = $c + 1; $i -lt $k; $i++) { $ai = $a[$i]; $ap = $a[$p]; if ([math]::Abs($ai[$c]) -gt [math]::Abs($ap[$c])) { $p = $i } }
        $ap = $a[$p]
        if ([math]::Abs($ap[$c]) -lt 1e-12) { throw 'model çözülemedi (ölçümler yetersiz)' }
        if ($p -ne $c) { $tmp = $a[$c]; $a[$c] = $a[$p]; $a[$p] = $tmp }
        $rc = $a[$c]
        for ($i = 0; $i -lt $k; $i++) {
            if ($i -eq $c) { continue }
            $ri = $a[$i]
            $fk = $ri[$c] / $rc[$c]
            for ($j = $c; $j -le $k; $j++) { $ri[$j] = $ri[$j] - $fk * $rc[$j] }
        }
    }
    $s = New-Object 'double[]' $k
    for ($i = 0; $i -lt $k; $i++) { $ri = $a[$i]; $s[$i] = $ri[$k] / $ri[$i] }
    return , $s
}

function OtoKal-Hesapla-Ic([hashtable]$z, [double]$T, [hashtable]$ofs, [double]$p4002, [double[]]$tekrar, [double]$farkMax, [string]$ucTip = 'duz', [double]$ucR = 1.5) {
    # Saf hesap (Eding'siz test edilebilir). $z[i] = nokta i'nin ortalama Z'si (iş koordinatı)
    $rad = [math]::PI / 180
    $R = $OkR; $d = $OkD; $teta = $OkTeta
    # --- 1) Kapalı form başlangıç tahmini
    $ust = @{ C = (($z[0] + $z[1] + $z[2] + $z[3] + $z[4]) / 5); SX = (($z[1] - $z[2]) / (2 * $R)); SY = (($z[3] - $z[4]) / (2 * $R)) }
    $alt = @{ C = (($z[13] + $z[14] + $z[15] + $z[16] + $z[17]) / 5); SX = (($z[14] - $z[15]) / (2 * $R)); SY = (($z[16] - $z[17]) / (2 * $R)) }
    $sAp = ($z[6] - $z[5]) / (2 * $d); $sAm = ($z[8] - $z[7]) / (2 * $d)
    $sBp = ($z[10] - $z[9]) / (2 * $d); $sBm = ($z[12] - $z[11]) / (2 * $d)
    if ([math]::Abs($sAp - $sAm) -lt 0.2 -or [math]::Abs($sBp - $sBm) -lt 0.2) { throw 'A/B eğik ölçümleri birbirine çok yakın: eksen dönmedi mi, temas noktası mı kaydı?' }
    $ya0 = -$d + ($z[7] - $z[5]) / ($sAp - $sAm)
    $xb0 = -$d + ($z[11] - $z[9]) / ($sBp - $sBm)
    $gA0 = (([math]::Atan($sAp) - [math]::Atan($sAm)) / $rad / 2) / $teta
    $gB0 = (([math]::Atan($sBp) - [math]::Atan($sBm)) / $rad / 2) / $teta
    $t0 = [math]::Atan($ust.SX) / $rad; $t180 = [math]::Atan($alt.SX) / $rad
    $u0 = [math]::Atan($ust.SY) / $rad; $u180 = [math]::Atan($alt.SY) / $rad
    $zu = $ust.C + $ust.SX * $xb0 + $ust.SY * $ya0; $zl = $alt.C + $alt.SX * $xb0 + $alt.SY * $ya0
    # Yönler modelin dönme işaretine göre: Y etrafında +açı x-eğimini (-) yapar, X etrafında +açı y-eğimini (+) yapar
    $q = [double[]]@($xb0, $ya0, (($zu + $zl - $T) / 2), (($u0 + $u180) / 2), (-($t0 + $t180) / 2), $gA0, (-$gB0), (($zu - $zl) / 2), (-($t0 - $t180)), (($u0 - $u180) / 2))
    # --- 2) Model uydurma (Gauss-Newton, 18 ölçüm / 10 bilinmeyen)
    $N = $OkNoktalar.Count; $P = $q.Count
    $adim = @(1e-4, 1e-4, 1e-4, 1e-3, 1e-3, 1e-5, 1e-5, 1e-4, 1e-3, 1e-3)
    $model = { param($qq) $out = New-Object 'double[]' $N; for ($i = 0; $i -lt $N; $i++) { $out[$i] = OkModel $qq $i $T $ucTip $ucR }; , $out }
    $rms = 0
    for ($it = 0; $it -lt 12; $it++) {
        $f0 = & $model $q
        $res = New-Object 'double[]' $N; $ss = 0
        for ($i = 0; $i -lt $N; $i++) { $res[$i] = $z[$i] - $f0[$i]; $ss += $res[$i] * $res[$i] }
        $rms = [math]::Sqrt($ss / $N)
        $jak = New-Object 'double[][]' $P
        for ($j = 0; $j -lt $P; $j++) {
            $q2 = [double[]]$q.Clone(); $q2[$j] += $adim[$j]
            $f1 = & $model $q2
            $jak[$j] = New-Object 'double[]' $N
            for ($i = 0; $i -lt $N; $i++) { $jak[$j][$i] = ($f1[$i] - $f0[$i]) / $adim[$j] }
        }
        $M = New-Object 'double[][]' $P; $v = New-Object 'double[]' $P
        for ($a1 = 0; $a1 -lt $P; $a1++) {
            $M[$a1] = New-Object 'double[]' $P
            for ($b1 = 0; $b1 -lt $P; $b1++) { $s = 0; for ($i = 0; $i -lt $N; $i++) { $s += $jak[$a1][$i] * $jak[$b1][$i] }; $M[$a1][$b1] = $s }
            $s = 0; for ($i = 0; $i -lt $N; $i++) { $s += $jak[$a1][$i] * $res[$i] }; $v[$a1] = $s
        }
        $dq = OkCoz $M $v
        $buyukAdim = 0.0   # 0.0: [math]::Max(0, double) tamsayı aşırı yüklemesini seçer (KL-02)
        for ($j = 0; $j -lt $P; $j++) { $q[$j] += $dq[$j]; $buyukAdim = [math]::Max($buyukAdim, [math]::Abs($dq[$j])) }
        if ($buyukAdim -lt 1e-7) { break }
    }
    $f0 = & $model $q; $ss = 0; $artikMax = 0.0
    for ($i = 0; $i -lt $N; $i++) { $e = $z[$i] - $f0[$i]; $ss += $e * $e; $artikMax = [math]::Max($artikMax, [math]::Abs($e)) }
    $rms = [math]::Sqrt($ss / $N)
    # --- 3) Düzeltmeler (iş koordinatından G54'e)
    #  A sıfırı: B0'da üst yüz düz olacak şekilde (eA + c); her iki kinematik zincirde de doğru tanım
    $xb = $q[0]; $ya = $q[1]; $zEksen = $q[2]
    $dA = ($q[3] + $q[9]) / $q[5]          # komut biriminde: yeni sıfır = eski - dA
    $dB = $q[4] / $q[6]
    $tekrarAralik = if ($tekrar.Count) { ($tekrar | Measure-Object -Maximum).Maximum - ($tekrar | Measure-Object -Minimum).Minimum } else { 0 }
    return @{
        dX = $xb; dY = $ya; dZ = $zEksen; dA = $dA; dB = $dB
        X = ($ofs.X + $xb); Y = ($ofs.Y + $ya); A = ($ofs.A - $dA); B = ($ofs.B - $dB); P4002 = ($p4002 - $zEksen)
        OlcA = [math]::Abs($q[5]); OlcB = [math]::Abs($q[6]); M = $q[7]; Kama = $q[8]; DiskEgikA = $q[9]
        Rms = $rms; ArtikMax = $artikMax; Tekrar = $tekrarAralik; Fark = $farkMax; T = $T; Q = $q
    }
}

function OtoKal-Sim-Uret([string]$nc, [double]$T) {
    # Gerçek ölçüm programını satır satır "çalıştırır" ve X5 Canlı Simülasyon'un okuyabileceği düz G-koda çevirir:
    #  #değişken ve [ifade] -> sayı, G38.2 -> ideal makinede temas Z'sine G1, if/errmsg -> yorum, GOSUB user_1 -> M100.
    # Satır sırası ve hareketler gerçek programla birebir aynıdır (senkron).
    # Simülasyonun eksen yönleri: A ve B bu modelin tersine döner -> gA = gB = -1. Simülasyondaki uç sivri -> yarıçap 0.
    $ci = [System.Globalization.CultureInfo]::InvariantCulture
    $f = { param($v) ([double]$v).ToString('0.###', $ci) }
    $ideal = [double[]]@(0, 0, 0, 0, 0, -1, -1, 0, 0, 0)
    $deg = @{ 5063 = 0.0; 5067 = 0.0 }
    $dt = New-Object System.Data.DataTable
    $hesap = {
        param([string]$s)
        $s2 = [regex]::Replace($s, '#(\d+)', { param($m) $k = [int]$m.Groups[1].Value; if ($deg.ContainsKey($k)) { '(' + ([double]$deg[$k]).ToString('R', $ci) + ')' } else { '0' } })
        $s2 = $s2.Replace('[', '(').Replace(']', ')')
        return [double]$dt.Compute($s2, '')
    }
    $nokta = 0; $sb = New-Object System.Text.StringBuilder
    $L = { param($s) [void]$sb.AppendLine($s) }
    $satirlar = $nc -split "`r?`n"
    for ($k = 0; $k -lt $satirlar.Count; $k++) {
        $ln = $satirlar[$k].TrimEnd(); $u = $ln.Trim()
        if ($k -eq 1 -and $u -like '(PrimerMill OTOMATIK*') { & $L ($u -replace '^\(', '(SIMULASYON - ') ; & $L '(X5 Canli Simulasyon icin: G38.2 yerine ideal makinede temas noktasina G1, degiskenler sayiya cevrildi)'; continue }
        $pm = [regex]::Match($u, '^\(P(\d+) '); if ($pm.Success) { $nokta = [int]$pm.Groups[1].Value }
        if ($u -match '^#(\d+)\s*=\s*(.+)$') { $deg[[int]$Matches[1]] = & $hesap $Matches[2]; & $L "($u  ->  $(& $f $deg[[int]$Matches[1]]))"; continue }
        if ($u -match '^(if\s|endif|errmsg|msg\s)') { continue }
        if ($u -match '^GOSUB\s+user_1') { & $L 'M100 (GOSUB user_1: takim boyu sensorde)'; continue }
        # [ifade] -> sayı
        $u2 = [regex]::Replace($u, '\[[^\[\]]*(\[[^\[\]]*\][^\[\]]*)*\]', { param($m) & $f (& $hesap $m.Value) })
        $g = [regex]::Match($u2, '^G38\.2\s+Z(-?[\d.]+)\s+F([\d.]+)')
        if ($g.Success) {
            $hedef = [double]::Parse($g.Groups[1].Value, $ci); $fd = $g.Groups[2].Value
            $temas = OkModel $ideal $nokta $T 'duz' 0
            if ($temas -ge $hedef) { & $L "G1 Z$(& $f $temas) F$fd (G38.2 Z$(& $f $hedef) -> TEMAS P$nokta)"; $deg[5063] = $temas; $deg[5067] = 1 }
            else { & $L "G1 Z$(& $f $hedef) F$fd (G38.2 -> TEMAS YOK)"; $deg[5063] = $hedef; $deg[5067] = 0 }
            continue
        }
        & $L $u2
    }
    return $sb.ToString()
}

function OtoKal-Goster {
    if (-not $script:ApiHazir -or -not $script:Bagli) { $lblOkSimdi.Text = 'Eding bağlı değil'; return }
    $g = @(5221, 5222, 5223, 5224, 5225 | ForEach-Object { Sayi ([Eding]::CncGetVariable($_)) })
    $lblOkSimdi.Text = "Şu an  G54  X $($g[0])  Y $($g[1])  Z $($g[2])  A $($g[3])  B $($g[4])   ·   #4002 $(Sayi ([Eding]::CncGetVariable(4002)))"
    $id = [int]([Eding]::CncGetVariable(4199))
    if (-not $script:OkSonuc -and $script:Tercih.OkKimlik -and "$id" -eq "$($script:Tercih.OkKimlik)" -and [Eding]::CncGetVariable(4100) -eq 1) {
        $lblOkDurum.Text = 'Bitmiş bir ölçüm var: SONUÇLARI OKU''ya bas.'
    }
}

# ---- Prob testi: hangi giriş değişiyor? (Eding ekranı gizli olduğu için buradan izlenir)
$script:OkProbTaban = $null
$tmrProb = New-Object System.Windows.Forms.Timer
$tmrProb.Interval = 120
$tmrProb.Add_Tick({
    try {
        if (-not $ayar.Visible -or -not $script:Bagli) { $tmrProb.Stop(); $btnOkProb.Text = 'Prob testini başlat'; return }
        $durum = @{}; foreach ($i in 1..160) { $durum[$i] = [Eding]::CncGetInput($i) }
        if (-not $script:OkProbTaban) { $script:OkProbTaban = $durum; return }
        $id = 0; [void][int]::TryParse("$($script:Tercih.ProbIo)", [ref]$id)
        if ($id -le 0) {
            $degisen = @(1..160 | Where-Object { $durum[$_] -ne $script:OkProbTaban[$_] })
            if ($degisen.Count -ge 1) {
                $id = $degisen[0]
                $script:Tercih.ProbIo = "$id"; $script:Tercih.ProbAktif = "$($durum[$id])"; Tercih-Yaz
                Yaz "Prob girişi öğrenildi: giriş $id (temasta değer $($durum[$id]))"
            } else { $lblOkProb.Text = 'Kablonun ucunu iş miline / pime değdir...'; $lblOkProb.ForeColor = $cAltinAc; return }
        }
        $temas = ("$($durum[$id])" -eq "$($script:Tercih.ProbAktif)")
        $lblOkProb.Text = if ($temas) { "TEMAS VAR   (giriş $id)" } else { "TEMAS YOK   (giriş $id)" }
        $lblOkProb.ForeColor = if ($temas) { $cYesil } else { $cSoluk }
    } catch { $tmrProb.Stop(); $lblOkProb.Text = "Giriş okunamadı: $($_.Exception.Message)"; $lblOkProb.ForeColor = $cKirmizi }
})

function OtoKal-Prob-Testi {
    if (-not (Baglan)) { [Kayit]::Show("Eding'e bağlanılamadı.", 'Prob testi', 'OK', 'Warning') | Out-Null; return }
    if ($tmrProb.Enabled) { $tmrProb.Stop(); $btnOkProb.Text = 'Prob testini başlat'; return }
    $script:OkProbTaban = $null
    $btnOkProb.Text = 'Testi durdur'
    $tmrProb.Start()
}

function OtoKal-Prob-Aktif-Mi {
    # Öğrenilmiş giriş varsa: şu an temas var mı? (bilinmiyorsa $null)
    $id = 0; if (-not [int]::TryParse("$($script:Tercih.ProbIo)", [ref]$id) -or $id -le 0) { return $null }
    try { return ("$([Eding]::CncGetInput($id))" -eq "$($script:Tercih.ProbAktif)") } catch { return $null }
}

function OtoKal-Hazirla {
    $T = Metin-Sayi $txtOkT.Text
    $ucD = Metin-Sayi $txtOkUcD.Text
    if ($null -eq $ucD -or $ucD -lt 0.5 -or $ucD -gt 6) { [Kayit]::Show('Temas ucunun çapını yaz (pim genelde 3.00, frez 2.00).', 'Otomatik kalibrasyon', 'OK', 'Warning') | Out-Null; return }
    if ($null -eq $T -or $T -lt 8 -or $T -gt 30) { [Kayit]::Show('Titanyum diskin kalınlığını mikrometreyle ölçüp yaz (ör. 10.02).', 'Otomatik kalibrasyon', 'OK', 'Warning') | Out-Null; return }
    if (Is-Suruyor-Uyari 'Otomatik kalibrasyon') { return }
    if (-not (Baglan)) { [Kayit]::Show("Eding'e bağlanılamadı.", 'Otomatik kalibrasyon', 'OK', 'Warning') | Out-Null; return }
    $aktif = OtoKal-Prob-Aktif-Mi
    if ($aktif -eq $true) {
        [Kayit]::Show("Prob ŞU AN temas gösteriyor ama pim diske değmiyor.`r`n`r`nDisk tutucuya / şaseye değiyor (izolasyon bozuk) ya da kablo kısa devre. Düzeltmeden ölçüm başlatılamaz.", 'Otomatik kalibrasyon', 'OK', 'Error') | Out-Null; return
    }
    $manuel = Frez-Manuel-Mi
    $m = "Otomatik kalibrasyon ölçümü hazırlanacak ve seçilecek:`r`n`r`n" +
         "• Titanyum disk $(Sayi $T) mm, tutucudan İZOLE, kablosu prob girişinde`r`n" +
         "• İş mili DÖNMEZ; makine diske 18 noktada dokunur (A ±$OkTeta°, B ±$OkTeta°, B180)`r`n" +
         $(if ($manuel) { "• Frez MANUEL: 'T1 tak' denince KALİBRASYON PİMİNİ tak (en az 20 mm dışarıda), sonunda çıkar`r`n" } else { "• Frez OTOMATİK: magazindeki T1 ile ölçülür (ucu sağlam olmalı)`r`n" }) +
         $(if ($null -eq $aktif) { "• Prob testi yapılmadı: önce 'Prob testini başlat' ile kabloyu dene (önerilir)`r`n" } else { '' }) +
         "• Süre: yaklaşık 10 dakika. Hiçbir ayar değişmez; değerleri sonra sen onaylarsın.`r`n`r`nSonra ana ekranda BAŞLAT'a bas. Devam?"
    if (-not (Onay $m 'Otomatik kalibrasyon')) { return }
    if ($manuel -and -not (Manuel-Macro-Kontrol)) { return }
    try {
        $kimlik = Get-Random -Minimum 10000 -Maximum 99999
        $metin = OtoKal-NC-Uret $T $kimlik
        [void][System.IO.Directory]::CreateDirectory($IsKlasor)
        $hedef = [System.IO.Path]::Combine($IsKlasor, 'PM_kalibrasyon_otomatik.nc')
        [System.IO.File]::WriteAllText($hedef, $metin)
        [System.IO.File]::Copy($hedef, [System.IO.Path]::Combine($IsKlasor, $AktifIsAdi), $true)
        # Aynı programın simülasyon kopyası (X5 Canlı Simülasyon'da izlemek için, satır satır senkron)
        try { [System.IO.File]::WriteAllText([System.IO.Path]::Combine($IsKlasor, 'PM_kalibrasyon_otomatik_SIM.nc'), (OtoKal-Sim-Uret $metin $T)) } catch { }
        $script:SeciliDosya = $hedef
        $lblDosya.Text = 'PM_kalibrasyon_otomatik'; $lblDosya.ForeColor = $cYazi
        Dosyayi-Kontrol-Et $hedef
        $script:Tercih.OkT = $txtOkT.Text; $script:Tercih.OkKimlik = "$kimlik"
        $script:Tercih.OkUc = if ($cmbOkUc.SelectedIndex -eq 1) { 'kure' } else { 'duz' }; $script:Tercih.OkUcD = $txtOkUcD.Text; Tercih-Yaz
        $script:ModOnayliDosya = $hedef
        $script:OkSonuc = $null; $lblOkSonuc.Text = ''; $btnOkUygula.Enabled = $false
        Yaz "Otomatik kalibrasyon ölçümü hazırlandı: $hedef (disk $(Sayi $T), kimlik $kimlik)"
        $lblOkDurum.Text = "Hazır. Ana ekranda BAŞLAT. Bitince buraya dön: SONUÇLARI OKU."
    } catch { [Kayit]::Show("Ölçüm programı yazılamadı: $($_.Exception.Message)", 'Otomatik kalibrasyon', 'OK', 'Error') | Out-Null }
}

function OtoKal-Oku {
    if (-not (Baglan)) { [Kayit]::Show("Eding'e bağlanılamadı.", 'Otomatik kalibrasyon', 'OK', 'Warning') | Out-Null; return }
    if ((Calisiyor-Mu)) { [Kayit]::Show('Ölçüm hâlâ çalışıyor. Bitmesini bekle.', 'Otomatik kalibrasyon', 'OK', 'Information') | Out-Null; return }
    $id = [int]([Eding]::CncGetVariable(4199))
    if (-not $script:Tercih.OkKimlik -or "$id" -ne "$($script:Tercih.OkKimlik)") { [Kayit]::Show('Bu ölçüme ait sonuç yok. Önce ölçümü hazırla ve BAŞLAT ile çalıştır.', 'Otomatik kalibrasyon', 'OK', 'Information') | Out-Null; return }
    if ([Eding]::CncGetVariable(4100) -ne 1) { [Kayit]::Show('Ölçüm yarıda kalmış (hata ya da durdurma). Eding mesajına bak, sorunu gider, BAŞLAT ile tekrar çalıştır.', 'Otomatik kalibrasyon', 'OK', 'Warning') | Out-Null; return }
    $T = Metin-Sayi $script:Tercih.OkT
    $z = @{}; $farkMax = 0.0
    for ($i = 0; $i -lt $OkNoktalar.Count; $i++) {
        $a = [Eding]::CncGetVariable(4101 + 2 * $i); $b = [Eding]::CncGetVariable(4102 + 2 * $i)
        $z[$i] = ($a + $b) / 2; $farkMax = [math]::Max($farkMax, [math]::Abs($a - $b))
    }
    $tekrar = @(1..5 | ForEach-Object { [Eding]::CncGetVariable(4140 + $_) })
    $ofs = @{
        X = [Eding]::CncGetVariable(5221) + [Eding]::CncGetVariable(5211); Y = [Eding]::CncGetVariable(5222) + [Eding]::CncGetVariable(5212)
        A = [Eding]::CncGetVariable(5224) + [Eding]::CncGetVariable(5214); B = [Eding]::CncGetVariable(5225) + [Eding]::CncGetVariable(5215)
    }
    $p4002 = [Eding]::CncGetVariable(4002)
    $ucTip = if ($script:Tercih.OkUc -eq 'kure') { 'kure' } else { 'duz' }
    $ucD = Metin-Sayi $script:Tercih.OkUcD; if ($null -eq $ucD) { $ucD = 3.0 }
    try { $r = OtoKal-Hesapla-Ic $z $T $ofs $p4002 $tekrar $farkMax $ucTip ($ucD / 2) }
    catch { [Kayit]::Show("Hesaplanamadı: $($_.Exception.Message)", 'Otomatik kalibrasyon', 'OK', 'Error') | Out-Null; return }
    $r.Eski = "X $(Sayi ([Eding]::CncGetVariable(5221))) Y $(Sayi ([Eding]::CncGetVariable(5222))) A $(Sayi ([Eding]::CncGetVariable(5224))) B $(Sayi ([Eding]::CncGetVariable(5225))) #4002 $(Sayi $p4002)"
    $r.Z = $z; $r.Kimlik = $id
    $script:OkSonuc = $r
    $iyi = { param($v, $s) if ([math]::Abs($v) -le $s) { '✓' } else { '' } }
    $metin = "X  düzeltme $(Sayi $r.dX) mm  →  G54 X $(Sayi $r.X)  $(& $iyi $r.dX 0.01)`r`n" +
         "Y  düzeltme $(Sayi $r.dY) mm  →  G54 Y $(Sayi $r.Y)  $(& $iyi $r.dY 0.01)`r`n" +
         "Z  düzeltme $(Sayi (-$r.dZ)) mm  →  #4002 $(Sayi $r.P4002)  $(& $iyi $r.dZ 0.01)`r`n" +
         "A  düzeltme $(Sayi (-$r.dA))°  →  G54 A $(Sayi $r.A)  $(& $iyi $r.dA 0.02)`r`n" +
         "B  düzeltme $(Sayi (-$r.dB))°  →  G54 B $(Sayi $r.B)  $(& $iyi $r.dB 0.02)`r`n`r`n" +
         "Ölçüm kalitesi: tekrar $(Sayi $r.Tekrar) mm · çift ölçüm farkı ≤ $(Sayi $r.Fark) mm`r`n" +
         "Model uyumu: ortalama $(Sayi $r.Rms) · en büyük $(Sayi $r.ArtikMax) mm`r`n" +
         "Açı ölçeği: A %$('{0:0.0}' -f (100 * $r.OlcA)) · B %$('{0:0.0}' -f (100 * $r.OlcB))  (100 olmalı)`r`n" +
         "Disk: ortası B ekseninden $(Sayi $r.M) mm · iki yüz arası açı $(Sayi $r.Kama)° · takma eğikliği $(Sayi $r.DiskEgikA)°"
    $uyari = @()
    if ($r.Tekrar -gt 0.01 -or $r.Fark -gt 0.01) { $uyari += 'Temas tekrarlanabilirliği zayıf (>0.01 mm): temas noktalarını alkolle sil, kablo / şase bağlantısını sıkılaştır.' }
    if ([math]::Abs($r.OlcA - 1) -gt 0.01 -or [math]::Abs($r.OlcB - 1) -gt 0.01) { $uyari += 'A/B açı ölçeği %1''den fazla sapıyor: cnc.ini adım/derece ayarı ya da kayış/dişli boşluğu. G54 ile düzelmez.' }
    if ([math]::Abs($r.M) -gt 0.1) { $uyari += 'Disk ortası B ekseninden kaçık: kalınlık doğru mu, disk tutucuya tam oturmuş mu?' }
    if ([math]::Abs($r.Kama) -gt 0.1 -or [math]::Abs($r.DiskEgikA) -gt 0.05) { $uyari += 'Disk yüzleri paralel değil ya da disk eğik oturmuş (bant buruşuk?). B çevirmesi 180° değilse de burada görünür.' }
    if ($r.ArtikMax -gt 0.01) { $uyari += 'Ölçümler makine modeline tam uymuyor (>0.01 mm): bir noktada kir / çapak ya da eksen boşluğu olabilir.' }
    $buyuk = ([math]::Abs($r.dX) -gt 2 -or [math]::Abs($r.dY) -gt 2 -or [math]::Abs($r.dZ) -gt 2 -or [math]::Abs($r.dA) -gt 3 -or [math]::Abs($r.dB) -gt 3 -or
              [math]::Abs($r.OlcA - 1) -gt 0.1 -or [math]::Abs($r.OlcB - 1) -gt 0.1 -or $r.Tekrar -gt 0.05 -or $r.ArtikMax -gt 0.05)
    if ($buyuk) { $uyari += 'DİKKAT: sonuç beklenenden çok büyük ya da ölçüm güvenilmez. Kurulumu kontrol et, ölçümü tekrarla.' }
    $r.Buyuk = $buyuk
    if ($uyari.Count) { $metin += "`r`n`r`n" + ($uyari -join "`r`n") }
    $lblOkSonuc.Text = $metin
    $lblOkSonuc.ForeColor = if ($buyuk) { $cKirmizi } elseif ($uyari.Count) { $cAltinAc } else { $cYazi }
    $btnOkUygula.Enabled = $true
    $lblOkDurum.Text = 'Sonuç hazır. Uygunsa UYGULA VE KAYDET.'
    [Kayit]::Yaz("OTO KALİBRASYON sonuç (kimlik $id): dX $(Sayi $r.dX) dY $(Sayi $r.dY) dZ $(Sayi $r.dZ) dA $(Sayi $r.dA) dB $(Sayi $r.dB) ölçek A $(Sayi $r.OlcA) B $(Sayi $r.OlcB) tekrar $(Sayi $r.Tekrar) z: " + ((0..($OkNoktalar.Count - 1) | ForEach-Object { Sayi $z[$_] }) -join ' '))
}

function OtoKal-Uygula {
    $r = $script:OkSonuc
    if (-not $r) { [Kayit]::Show('Önce SONUÇLARI OKU.', 'Otomatik kalibrasyon', 'OK', 'Information') | Out-Null; return }
    if (-not (Hazir-Hareket 'Otomatik kalibrasyon')) { return }
    $m = "Yeni kalibrasyon kaydedilecek:`r`n`r`nG54  X $(Sayi $r.X)   Y $(Sayi $r.Y)   A $(Sayi $r.A)   B $(Sayi $r.B)`r`n#4002 (Z sıfırı) $(Sayi $r.P4002)`r`n`r`nEski: $($r.Eski)`r`n`r`n" +
         "G92 kaydırmaları sıfırlanır (frez boyu yeniden ölçülmeli). Önce otomatik yedek alınır. Devam?"
    if (-not (Onay $m 'Otomatik kalibrasyon')) { return }
    if ($r.Buyuk -and -not (Onay "Sonuç beklenenden büyük ya da ölçüm güvenilmez görünüyor.`r`nYine de kaydedilsin mi? (Yanlışsa: KALİBRASYON > Yedekten yükle)" 'Otomatik kalibrasyon')) { return }
    Ayar-Yedekle $true
    $ok = Komut-Sonucu 'G92 sıfırla' ([Eding]::CncRunSingleLine('G92.1')); if ($ok) { $ok = Hareket-Bitene-Kadar-Bekle 5 }
    if ($ok) { $ok = Komut-Sonucu 'G54' ([Eding]::CncRunSingleLine("G10 L2 P1 X$(Sayi $r.X) Y$(Sayi $r.Y) A$(Sayi $r.A) B$(Sayi $r.B)")); if ($ok) { $ok = Hareket-Bitene-Kadar-Bekle 5 } }
    if ($ok) { $ok = Degisken-Yaz 4002 $r.P4002 }
    if ($ok) { [void](Degisken-Yaz 4100 0) }
    try {
        if (-not [System.IO.File]::Exists($OkGecmis)) {
            [System.IO.File]::WriteAllText($OkGecmis, "tarih;kimlik;disk;dX;dY;dZ;dA;dB;olcekA;olcekB;tekrar;fark;m;kama;eski;yeni_X;yeni_Y;yeni_A;yeni_B;yeni_4002;uygulandi;z0..z17`r`n", [System.Text.Encoding]::UTF8)
        }
        $satir = (@((Get-Date -Format 'yyyy-MM-dd HH:mm'), $r.Kimlik, (Sayi $r.T), (Sayi $r.dX), (Sayi $r.dY), (Sayi (-$r.dZ)), (Sayi (-$r.dA)), (Sayi (-$r.dB)),
                   (Sayi $r.OlcA), (Sayi $r.OlcB), (Sayi $r.Tekrar), (Sayi $r.Fark), (Sayi $r.M), (Sayi $r.Kama), $r.Eski,
                   (Sayi $r.X), (Sayi $r.Y), (Sayi $r.A), (Sayi $r.B), (Sayi $r.P4002), $(if ($ok) { 'evet' } else { 'HATA' })) +
                  @(0..($OkNoktalar.Count - 1) | ForEach-Object { Sayi $r.Z[$_] })) -join ';'
        [System.IO.File]::AppendAllText($OkGecmis, $satir + "`r`n", [System.Text.Encoding]::UTF8)
    } catch { }
    OtoKal-Goster
    try { Ayar-Oku } catch { }
    if ($ok) {
        Yaz "Otomatik kalibrasyon kaydedildi: G54 X $(Sayi $r.X) Y $(Sayi $r.Y) A $(Sayi $r.A) B $(Sayi $r.B), #4002 $(Sayi $r.P4002)"
        $script:OkSonuc = $null; $btnOkUygula.Enabled = $false
        $lblOkDurum.Text = 'Kaydedildi. Doğrulamak için ölçümü bir kez daha çalıştır: düzeltmeler ~0 çıkmalı.'
        [Kayit]::Show("Kaydedildi (geçmiş: oto_kalibrasyon_gecmisi.csv).`r`n`r`n1. Doğrulama: ölçümü bir kez daha çalıştır; bütün satırlarda ✓ görmelisin`r`n2. Disk kablosunu sök, izolasyon bandını çıkar`r`n3. İlk işten önce frez boyu ölçülür (frez değişiminde otomatik)", 'Otomatik kalibrasyon', 'OK', 'Information') | Out-Null
    } else {
        [Kayit]::Show('Kaydetme yarıda kaldı. KALİBRASYON > Yedekten yükle ile geri dönebilirsin.', 'Otomatik kalibrasyon', 'OK', 'Warning') | Out-Null
    }
}

# ---- Sekme: OTO KALİBRASYON ----
$script:Hedef = $script:Sekmeler['OTO KALİBRASYON']
A-Baslik 'OTOMATİK KALİBRASYON (X Y Z A B)  ·  iletken temas, titanyum disk  ·  1 hazırla  2 prob testi  3 ölç  4 oku  5 kaydet' 24 6
$lblOkSimdi = A-Etiket '' 24 30 930
$lblOkSimdi.ForeColor = $cAltinAc

A-Baslik '1  KURULUM' 24 60
$lblOkKurulum = A-Etiket ("• Titanyum disk: tutucuya değen kenarı Kapton bantla izole`r`n" +
    "• Disk kablosu (bakır bant) → prob girişi · şase → GND`r`n" +
    "• İş milinde pim yok (program 'T1 tak' deyince pimi tak)`r`n" +
    "• Makine home almış, disk temiz (alkol)") 24 84 460
$lblOkKurulum.Height = 84
[void](A-Etiket 'Disk kalınlığı (mikrometre)' 24 172 200)
$txtOkT = A-Kutu 230 172 90
$txtOkT.Text = if ($script:Tercih.OkT) { $script:Tercih.OkT } else { '10.00' }
[void](A-Etiket '10 · 12 · 18 · 20' 330 172 150)
[void](A-Etiket 'Temas ucu' 24 202 200)
$cmbOkUc = New-Object System.Windows.Forms.ComboBox
$cmbOkUc.DropDownStyle = 'DropDownList'; $cmbOkUc.BackColor = $cPanel; $cmbOkUc.ForeColor = $cYazi; $cmbOkUc.FlatStyle = 'Flat'
$cmbOkUc.Font = New-Object System.Drawing.Font('Segoe UI', 10)
[void]$cmbOkUc.Items.Add('Düz uçlu pim'); [void]$cmbOkUc.Items.Add('Küresel frez (T1)')
$cmbOkUc.SetBounds(230, 202, 160, 28)
$cmbOkUc.SelectedIndex = if ($script:Tercih.OkUc -eq 'kure') { 1 } else { 0 }
$script:Hedef.Controls.Add($cmbOkUc)
$txtOkUcD = A-Kutu 398 202 62
$txtOkUcD.Text = if ($script:Tercih.OkUcD) { $script:Tercih.OkUcD } else { '3.00' }
[void](A-Etiket 'Ø' 462 202 20)

A-Baslik '2  PROB TESTİ (hareket yok)' 24 238
$btnOkProb = A-Buton 'Prob testini başlat' 24 262 200 34 { OtoKal-Prob-Testi }
[void](A-Buton 'Girişi yeniden öğren' 232 262 170 34 { $script:Tercih.ProbIo = ''; $script:Tercih.ProbAktif = ''; Tercih-Yaz; $script:OkProbTaban = $null; if (-not $tmrProb.Enabled) { OtoKal-Prob-Testi } })
$lblOkProb = A-Etiket '—' 24 302 460
$lblOkProb.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 13); $lblOkProb.Height = 30
$lblOkProbNot = A-Etiket "Kabloyu pime / iş miline değdir → TEMAS VAR.  Bırak → TEMAS YOK.`r`nDisk takılıyken ve pim diske değmiyorken TEMAS YOK olmalı." 24 334 460
$lblOkProbNot.Height = 40

A-Baslik '3  ÖLÇÜM' 24 384
[void](A-Buton 'Ölçüm programını hazırla' 24 408 240 36 { OtoKal-Hazirla })
[void](A-Etiket "→ ana ekranda BAŞLAT (≈10 dk)" 272 414 220)
$lblOkDurum = A-Etiket '' 24 452 460
$lblOkDurum.Height = 40; $lblOkDurum.ForeColor = $cAltinAc
[void](A-Buton 'Frez boyunu ölç' 24 498 160 34 { Takim-Olc })

A-Baslik '4  SONUÇ' 500 60
[void](A-Buton '4  SONUÇLARI OKU' 500 84 200 36 { OtoKal-Oku })
$btnOkUygula = A-Buton '5  UYGULA VE KAYDET' 708 84 200 36 { OtoKal-Uygula }
$btnOkUygula.ForeColor = $cYesil; $btnOkUygula.Enabled = $false
$lblOkSonuc = A-Etiket '' 500 128 460
$lblOkSonuc.Height = 330; $lblOkSonuc.Font = New-Object System.Drawing.Font('Consolas', 9.5)
[void](A-Buton 'Geçmiş' 500 470 90 34 { if ([System.IO.File]::Exists($OkGecmis)) { Start-Process notepad.exe $OkGecmis } else { [Kayit]::Show('Henüz kayıt yok.', 'Geçmiş', 'OK', 'Information') | Out-Null } })
[void](A-Etiket 'Bitti: X Y Z ≤ 0.01 mm, A B ≤ 0.02°. Kaydettikten sonra bir kez daha ölç.' 598 476 370)

# ---- Sekme 3: İŞ MİLİ VE HAVA ----
$script:Hedef = $script:Sekmeler['İŞ MİLİ VE HAVA']
A-Baslik 'İŞ MİLİ (test için)' 24 8
[void](A-Etiket 'Devir' 24 34 50)
$txtDevir = A-Kutu 80 34 100
$txtDevir.Text = '10000'
[void](A-Buton 'Çalıştır (M3)' 192 32 140 34 { Ismili-Calistir })
[void](A-Buton 'Durdur (M5)' 338 32 140 34 { Tek-Komut 'İş mili durdur' 'M5' })
[void](A-Etiket 'Makinenin üst sınırı 24000 devir. Kapak kapalıyken çalıştır.' 492 38 420)

A-Baslik 'PENS VE HAVA' 24 96
[void](A-Buton 'Pens aç (→ T0)' 24 122 170 38 { if (Hazir-Hareket 'Pens aç') { [void](Pens-Ac-T0 'Pens aç') } })
[void](A-Buton 'Pens kapat (M55 P2)' 200 122 170 38 { Tek-Komut 'Pens kapat' 'M55 P2' })
[void](A-Buton 'Hava üfle (M54 P4)' 376 122 170 38 { Hava-Ufle })

A-Baslik 'SOĞUTMA / HAVA ÇIKIŞLARI' 24 184
[void](A-Buton 'M7 aç' 24 210 120 38 { Tek-Komut 'M7' 'M7' })
[void](A-Buton 'M8 aç' 150 210 120 38 { Tek-Komut 'M8' 'M8' })
[void](A-Buton 'Hepsini kapat (M9)' 276 210 170 38 { Tek-Komut 'M9' 'M9' })


# ---- Sekme 4: KALİBRASYON ----
$script:Hedef = $script:Sekmeler['KALİBRASYON']
A-Baslik 'G54 (takım sırasının yeri, blok sıfırı, kol ve disk açısı)' 24 8
$eks5 = @('X', 'Y', 'Z', 'A', 'B')
for ($i = 0; $i -lt 5; $i++) {
    [void](A-Etiket "G54 $($eks5[$i])" (24 + $i * 184) 34 54)
    $script:G54Kutu[$eks5[$i]] = A-Kutu (80 + $i * 184) 34 110
}
A-Baslik 'TAKIM DEĞİŞTİRİCİ PARAMETRELERİ' 24 82
$k = 0
foreach ($nr in $ParamTanim.Keys) {
    $sut = $k % 2; $sat = [math]::Floor($k / 2)
    [void](A-Etiket "#$nr  $($ParamTanim[$nr])" (24 + $sut * 470) (108 + $sat * 34) 300)
    $script:ParamKutu[$nr] = A-Kutu (330 + $sut * 470) (108 + $sat * 34) 110
    $k++
}
$lblG92 = A-Etiket '' 24 248 920
[void](A-Buton 'Değerleri oku' 24 284 130 38 { Ayar-Oku })
[void](A-Buton 'Kaydet' 160 284 100 38 { Ayar-Kaydet })
$cmbYuva = New-Object System.Windows.Forms.ComboBox
$cmbYuva.DropDownStyle = 'DropDownList'
$cmbYuva.Font = New-Object System.Drawing.Font('Segoe UI', 12)
$cmbYuva.BackColor = $cPanel; $cmbYuva.ForeColor = $cYazi; $cmbYuva.FlatStyle = 'Flat'
foreach ($n in 1..6) { [void]$cmbYuva.Items.Add("T$n") }
[void]$cmbYuva.Items.Add('Sensör')
$cmbYuva.SelectedIndex = 0
$cmbYuva.SetBounds(266, 288, 64, 30)
$cmbYuva.DropDownWidth = 100
$script:Hedef.Controls.Add($cmbYuva)
$btnYuvaKaydet = A-Buton 'Şu anki konum = T1' 334 284 190 38 { if ($cmbYuva.SelectedIndex -eq 6) { Konumu-Sensor-Yap } else { Konumu-Yuva-Yap ($cmbYuva.SelectedIndex + 1) } }
$cmbYuva.Add_SelectedIndexChanged({ $btnYuvaKaydet.Text = "Şu anki konum = $($cmbYuva.SelectedItem)" })
[void](A-Buton 'Şu anki Z = alma yüksekliği' 530 284 200 38 { Z-Alma-Yap })
[void](A-Buton 'G92 sıfırla' 736 284 120 38 { G92-Sifirla })
A-Baslik 'YEDEK' 24 340
[void](A-Buton 'Ayarları yedekle' 24 366 170 38 { Ayar-Yedekle })
[void](A-Buton 'Yedekten yükle' 200 366 170 38 { Ayar-Geri-Yukle })
[void](A-Buton 'Yedek klasörü' 376 366 150 38 { Klasor-Ac $YedekKlasoru })
[void](A-Buton 'Disk sıfırı: üretici değerine dön' 560 366 300 38 { G54-Ureticiye-Don })
$lblUretici = A-Etiket '' 120 338 840
A-Baslik 'FREZ YUVALARI VE SENSÖR (makine koordinatı · macro bu değerleri kullanır · G54 değişse de kaymaz)' 24 404
$lblRaf = A-Etiket '' 24 426 930
$lblRaf.Height = 58; $lblRaf.ForeColor = $cYazi; $lblRaf.Font = New-Object System.Drawing.Font('Consolas', 10)
$n1 = A-Etiket 'Yuva ayarı: TAKIM sekmesinde yuvaya git, HAREKET ile tam ortala (gerekirse Z ile alma yüksekliğine in), sonra listeden yuvayı ya da Sensör''ü seç ve "Şu anki konum". Önce otomatik yedek alınır.' 24 490 930
$n1.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$n2 = A-Etiket 'G54 artık sadece disk/blok sıfırıdır; yuvalar ondan bağımsız. Değiştirmeden önce "Ayarları yedekle"ye bas.' 24 514 930
$n2.Font = New-Object System.Drawing.Font('Segoe UI', 9); $n2.ForeColor = $cKirmizi

# ---- Sekme 5: PANEL ----
$script:Hedef = $script:Sekmeler['PANEL']
A-Baslik 'AÇILIŞ' 24 8
[void](A-Etiket 'Makine adı' 460 6 100)
$txtMakAd = A-Kutu 564 6 220
$txtMakAd.Text = $script:Tercih.MakineAdi
$txtMakAd.Add_Leave({ $v = $txtMakAd.Text.Trim(); if ($v) { $script:Tercih.MakineAdi = $v; Tercih-Yaz } else { $txtMakAd.Text = $script:Tercih.MakineAdi } })
[void](A-Secim 'Dokunmatik ekran klavyesi' 740 34 220 ($script:Tercih.SanalKlavye -ne '0') { $script:Tercih.SanalKlavye = if ($this.Checked) { '1' } else { '0' }; [DokunKlavye]::Acik = $this.Checked; Tercih-Yaz })
[void](A-Secim 'Açılışta otomatik hazırlık (reset + home)' 24 34 420 ($script:Tercih.OtomatikHazirlik -eq '1') { $script:Tercih.OtomatikHazirlik = if ($this.Checked) { '1' } else { '0' }; Tercih-Yaz })
[void](A-Etiket 'Home öncesi geri sayım (sn)' 460 34 200)
$txtGs = A-Kutu 664 34 60
$txtGs.Text = $script:Tercih.GeriSayim
$txtGs.Add_Leave({ $v = Metin-Sayi $txtGs.Text; if ($null -ne $v -and $v -ge 0 -and $v -le 60) { $script:Tercih.GeriSayim = "$([int]$v)"; Tercih-Yaz } else { $txtGs.Text = $script:Tercih.GeriSayim } })


$chSifirla = (A-Secim 'Açılışta Eding''i sıfırla (kapat, 15 sn bekle, aç)' 24 56 420 ($script:Tercih.EdingSifirla -ne '0') { $script:Tercih.EdingSifirla = if ($this.Checked) { '1' } else { '0' }; Tercih-Yaz })
if ($script:Sade) {
    $chSifirla.Visible = $false
    [void](A-Secim 'Blok ismi sağda (saat 3) çıkıyorsa işaretle: tarafı çevir' 24 56 420 ($script:Tercih.SadeTaraf -eq '3') { $script:Tercih.SadeTaraf = if ($this.Checked) { '3' } else { '9' }; Tercih-Yaz })
}
[void](A-Secim 'Frez değişimi MANUEL (frezleri elle takarım)' 460 56 460 $script:Manuel {
    if ($this.Checked -and -not $script:OzelMakro) {
        [Kayit]::Show("Bu makinenin macro.cnc'si manuel frez değişimini desteklemiyor (orijinal makro).`r`nManuel için PrimerMill makrosu (P_CNC_icin\macro.cnc) kurulu olmalı.", 'Frez değişimi', 'OK', 'Warning') | Out-Null
        $this.Checked = $false; return
    }
    $script:Manuel = $this.Checked
    $script:Tercih.FrezModu = if ($this.Checked) { 'MANUEL' } else { 'OTOMATIK' }; Tercih-Yaz
    Yaz "Frez değişimi: $($script:Tercih.FrezModu) (kaydedildi)"
    if ($script:OzelMakro -and $script:Bagli -and -not (Is-Suruyor)) { try { [void](Frez-Modu-Yaz $script:Manuel) } catch { } }
})

A-Baslik 'GÖRÜNÜM' 24 80
[void](A-Secim 'Dans eden hayvan göster' 24 106 300 ($script:Tercih.Dansci -eq '1') { $script:Tercih.Dansci = if ($this.Checked) { '1' } else { '0' }; Tercih-Yaz; if (-not $this.Checked) { $bar.Animal = -1 } })
[void](A-Secim 'Koordinatları makine koordinatı olarak göster' 340 106 420 ($script:Tercih.Koordinat -eq 'MAKINE') { $script:Tercih.Koordinat = if ($this.Checked) { 'MAKINE' } else { 'IS' }; Tercih-Yaz; $script:KoordMakine = $this.Checked; $lblKoordTur.Text = if ($this.Checked) { 'MAKİNE' } else { 'İŞ' } })

[void](A-Secim 'Tam ekran (panel yeniden açılınca)' 24 128 300 ($script:Tercih.TamEkran -ne '0') { $script:Tercih.TamEkran = if ($this.Checked) { '1' } else { '0' }; Tercih-Yaz })
[void](A-Secim 'Windows açılınca PrimerMill kendiliğinden başlasın' 340 128 460 ($script:Tercih.WinBaslangic -ne '0') { $script:Tercih.WinBaslangic = if ($this.Checked) { '1' } else { '0' }; Tercih-Yaz; Windows-Baslangic-Ayarla })

A-Baslik 'KLASÖRLER' 24 152
[void](A-Buton 'İşler' 24 178 140 38 { Klasor-Ac $IsKlasor })
[void](A-Buton 'Loglar' 170 178 140 38 { Klasor-Ac ([System.IO.Path]::Combine($ScriptKlasor, 'loglar')) })
[void](A-Buton 'Yedekler' 316 178 140 38 { Klasor-Ac $YedekKlasoru })
[void](A-Buton 'Eding klasörü' 462 178 160 38 { Klasor-Ac $EdingKlasor })

A-Baslik 'EDING' 24 236
[void](A-Buton 'Eding penceresini göster' 24 262 220 38 { Eding-Goster })
[void](A-Buton 'Eding''i gizle' 250 262 160 38 { Eding-Gizle })
[void](A-Buton 'Eding''i yeniden başlat' 416 262 220 38 { Eding-Yeniden })
[void](A-Secim 'Eding arka planda çalışsın (görünmesin)' 650 268 300 ($script:Tercih.EdingGizli -ne '0') { $script:Tercih.EdingGizli = if ($this.Checked) { '1' } else { '0' }; Tercih-Yaz; if ($this.Checked) { Eding-Gizle } else { Eding-Goster } })
[void](A-Etiket 'macro.cnc ya da cnc.ini değiştirildikten sonra Eding yeniden başlatılmalı.' 24 308 900)

A-Baslik 'BİLGİ' 24 346
$lblBilgi = A-Etiket '' 24 372 930
$lblBilgi.Height = 90
$lblBilgi.Text = "Eding klasörü: $EdingKlasor`r`nİş klasörü: $IsKlasor`r`nPanel klasörü: $ScriptKlasor`r`nLog: $([Kayit]::Dosya)"
$lblBilgi.Height = 88
A-Baslik 'UZAKTAN ERİŞİM (aynı ağdaki bilgisayarlar tarayıcıdan bağlanır)' 24 462
$lblUzak = A-Etiket '' 24 486 560
$lblUzak.Height = 50; $lblUzak.ForeColor = $cAltinAc; $lblUzak.Font = New-Object System.Drawing.Font('Consolas', 12)
[void](A-Secim 'Uzaktan erişim açık (panel yeniden açılınca)' 600 484 360 ($script:Tercih.Uzak -eq '1') { $script:Tercih.Uzak = if ($this.Checked) { '1' } else { '0' }; Tercih-Yaz })
[void](A-Secim 'Uzaktan başlatmak için "Blok takıldı" onayı iste' 600 510 360 ($script:Tercih.UzakKilit -ne '0') { $script:Tercih.UzakKilit = if ($this.Checked) { '1' } else { '0' }; Tercih-Yaz })
[void](A-Etiket 'PIN' 600 536 40)
$txtPin = A-Kutu 644 536 110
$txtPin.Text = [string]$script:Tercih.WebPin
[void](A-Buton 'PIN kaydet' 762 534 130 30 {
    $v = $txtPin.Text.Trim()
    if ($v -and $v -notmatch '^\d{4,8}$') { [Kayit]::Show('PIN 4–8 rakam olmalı (boş bırakılırsa PIN sorulmaz).', 'PIN', 'OK', 'Warning') | Out-Null; return }
    $script:Tercih.WebPin = $v; Tercih-Yaz; [WebSunucu]::Pin = $v; Uzak-Etiket-Guncelle
    Yaz $(if ($v) { "Uzaktan erişim PIN'i değiştirildi." } else { 'Uzaktan erişim PIN''siz (aynı ağdaki herkes bağlanabilir).' })
})
Uzak-Etiket-Guncelle

Adim-Isaretle
Sekme-Goster 'HAREKET'
$script:KoordMakine = ($script:Tercih.Koordinat -eq 'MAKINE')
$lblKoordTur.Text = if ($script:KoordMakine) { 'MAKİNE' } else { 'İŞ' }
$ayar.Add_VisibleChanged({ if ($ayar.Visible) { Ayar-Oku; $lblGeometri.Text = Yuva-Geometrisi-Oku } })


# ---------------- Detay penceresi (tıklayınca açılır) ----------------
$detay = New-Object System.Windows.Forms.Form
$detay.Text = 'Detaylar'
$detay.ClientSize = New-Object System.Drawing.Size(820, 520)
$detay.StartPosition = 'CenterParent'
$detay.BackColor = $cZemin
$detay.ForeColor = $cYazi
$detay.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$detay.Owner = $form
$detay.Add_FormClosing({ param($s, $e) if ($e.CloseReason -eq 'UserClosing') { $e.Cancel = $true; $detay.Hide() } })

$lblTeknik = New-Object System.Windows.Forms.Label
$lblTeknik.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$lblTeknik.ForeColor = $cYazi
$lblTeknik.SetBounds(20, 16, 780, 70)
$detay.Controls.Add($lblTeknik)

$kutu = New-Object System.Windows.Forms.TextBox
$kutu.Multiline = $true
$kutu.ScrollBars = 'Vertical'
$kutu.ReadOnly = $true
$kutu.BorderStyle = 'None'
$kutu.BackColor = $cPanel
$kutu.ForeColor = [System.Drawing.Color]::FromArgb(201, 206, 214)
$kutu.Font = New-Object System.Drawing.Font('Consolas', 9.5)
$kutu.SetBounds(20, 96, 780, 360)
$detay.Controls.Add($kutu)

$lblMdi = New-Object System.Windows.Forms.Label
$lblMdi.Text = 'MDI'
$lblMdi.ForeColor = $cAltin
$lblMdi.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 10)
$lblMdi.SetBounds(20, 474, 40, 26)
$detay.Controls.Add($lblMdi)

$txtMdi = New-Object System.Windows.Forms.TextBox
$txtMdi.BackColor = $cPanel
$txtMdi.ForeColor = $cYazi
$txtMdi.BorderStyle = 'FixedSingle'
$txtMdi.Font = New-Object System.Drawing.Font('Consolas', 11)
$txtMdi.SetBounds(64, 472, 620, 28)
$txtMdi.Add_KeyDown({ param($s, $e) if ($e.KeyCode -eq 'Enter') { $e.SuppressKeyPress = $true; [Kayit]::Yaz('TUŞ: MDI Enter'); Mdi-Gonder } })
$detay.Controls.Add($txtMdi)

$btnMdi = New-Object System.Windows.Forms.Button
$btnMdi.Text = 'Gönder'
$btnMdi.FlatStyle = 'Flat'
$btnMdi.FlatAppearance.BorderColor = $cAltin
$btnMdi.ForeColor = $cAltinAc
$btnMdi.BackColor = $cPanel
$btnMdi.SetBounds(694, 471, 106, 30)
$btnMdi.Add_Click({ [Kayit]::Yaz('TUŞ: MDI Gönder'); Mdi-Gonder })
$detay.Controls.Add($btnMdi)

# ---------------- Durum ve ilerleme ----------------
function Sade-Sure([double]$sn) {
    if ($sn -lt 0) { $sn = 0 }
    $dk = [math]::Ceiling($sn / 60)
    if ($dk -lt 60) { return "$dk dk" }
    return ('{0} sa {1} dk' -f [math]::Floor($dk / 60), ($dk % 60))
}

$script:SonDurum = ''
function Durum-Yaz([string]$metin, [System.Drawing.Color]$renk) {
    if ($metin -ne $script:SonDurum) { [Kayit]::Yaz("DURUM: $metin"); $script:SonDurum = $metin }
    $lblDurum.Text = "●  $metin"
    $lblDurum.ForeColor = $renk
}

function Dosya-Ozeti {
    # Dosya seçildikten sonra ana ekrandaki sade özet
    if (-not $script:Analiz) { $lblSure.Text = ''; return }
    if ($script:Engel) { $lblSure.Text = 'Dosya uygun değil  ·  ayrıntı için Detaylar'; $lblSure.ForeColor = $cKirmizi; return }
    $lblSure.ForeColor = $cSoluk
    $ek = if ($script:Uyarilar.Count -gt 0) { '   ·   dikkat gerektiriyor' } else { '' }
    $lblSure.Text = "Tahmini süre  $(Sade-Sure $script:Analiz.Toplam)$ek"
}

function Ilerleme-Guncelle([bool]$calisiyor, [bool]$durakli) {
    $a = $script:Analiz
    # Takip erken bırakıldıysa (iş aslında sürüyorsa) kendiliğinden yeniden başla
    if (-not $script:IsAktif -and $a -and $a.Toplam -gt 0 -and $script:TakipSonu -eq 'durdu' -and $calisiyor) {
        $h0 = [Eding]::CncGetCurExecLine()
        if ($h0 -ge 1 -and $h0 -le $a.Kumulatif.Length -and $h0 -gt $script:SonGecerliSatir) {
            [Kayit]::Yaz("İLERLEME: iş sürüyor (satır $h0), bar ve simülasyon takibi yeniden başladı")
            $script:IsAktif = $true; $script:SonTik = Get-Date; $script:TakipSonu = ''; $script:BitisSayac = 0
        }
    }
    if (-not $script:IsAktif -or -not $a -or $a.Toplam -le 0) { return }

    $simdi = Get-Date
    # Manuel frez değişiminde Eding M0'da bekler; durum yazısı ne olursa olsun iş bitmiş sayılmaz
    $manuelBekliyor = $false; try { $manuelBekliyor = ($null -ne (Manuel-Istek)) } catch { }
    if ($manuelBekliyor) { $durakli = $true }
    if ($calisiyor -or $durakli) { $script:CalistiGoruldu = $true; $script:BitisSayac = 0 }
    if ($calisiyor -and -not $durakli -and $script:SonTik) { $script:Gecen += ($simdi - $script:SonTik) }
    $script:SonTik = $simdi

    # Eding'in bildirdiği satır: makro (takım değişimi vb.) sırasında geçersiz olabilir
    $ham = [Eding]::CncGetCurExecLine()
    $toplamSatir = $a.Kumulatif.Length
    $maxAtlama = [math]::Max(5000, [int]($toplamSatir * 0.03))
    if ((Eding-Durum) -ne 'RUN-SUB' -and $ham -ge 1 -and $ham -le $toplamSatir -and
        $ham -ge $script:SonGecerliSatir) {
        if (($ham - $script:SonGecerliSatir) -le $maxAtlama) { $script:SonGecerliSatir = $ham; $script:AdaySayac = 0 }
        else {
            # Büyük sıçrama: 3 saniye boyunca ileri gitmeye devam ederse gerçektir (örn. panel iş sırasında açıldı)
            if ($ham -gt $script:AdayHam) { $script:AdaySayac++ } else { $script:AdaySayac = 0 }   # sabit kalan sahte değeri kabul etme
            $script:AdayHam = $ham
            if ($script:AdaySayac -ge 3) { $script:SonGecerliSatir = $ham; $script:AdaySayac = 0 }
        }
    }
    $satir = $script:SonGecerliSatir
    $sim.SetLine($satir)
    if ($simForm.Visible) { $simBuyuk.SetLine($satir) }
    $i = [math]::Max(0, [math]::Min($a.Kumulatif.Length - 1, $satir - 1))
    $yapilan = $a.Kumulatif[$i]
    $yuzde = 100.0 * $yapilan / $a.Toplam

    $kalan = $a.Toplam - $yapilan
    if (($calisiyor -or $durakli) -and ($simdi - $script:DevamSonYazma).TotalSeconds -ge 2) { Devam-Kaydet $satir 'calisiyor' $yuzde }
    if ($yapilan -gt 60 -and $script:Gecen.TotalSeconds -gt 60) {
        $oran = [math]::Max(0.3, [math]::Min(5.0, $script:Gecen.TotalSeconds / $yapilan))
        $kalan = $kalan * $oran
    }

    # Teşhis: 30 sn'de bir ilerleme kaydı
    if (-not $script:SonIlerlemeIz -or ($simdi - $script:SonIlerlemeIz).TotalSeconds -ge 30) {
        $script:SonIlerlemeIz = $simdi
        [Kayit]::Yaz("İLERLEME-İZ: durum=$(Eding-Durum) ham=$ham geçerli=$satir / $toplamSatir  yüzde=$([math]::Round($yuzde,1))  manuelBekliyor=$manuelBekliyor")
    }

    if (-not $calisiyor -and -not $durakli) {
        if (-not $script:CalistiGoruldu -and ($simdi - $script:BaslamaAni).TotalSeconds -lt 20) { return }
        # Hemen "bitti" deme: Eding 5 sn boyunca çalışmıyorsa iş gerçekten bitmiş/durmuştur
        $script:BitisSayac++
        $sonDurum0 = Eding-Durum
        if ($script:BitisSayac -lt 5 -and -not (Hatali $sonDurum0) -and $sonDurum0 -ne 'ABORTED') {
            $bar.Value = $yuzde
            return
        }
        [Kayit]::Yaz("İLERLEME: iş sonu algılandı (durum=$sonDurum0, satır $satir / $toplamSatir, yüzde $([math]::Round($yuzde,1)))")
        $script:BitisSayac = 0
        $script:IsAktif = $false
        $script:TakipSonu = if ($yuzde -gt 97) { 'tamam' } else { 'durdu' }
        $sonDurum = Eding-Durum
        $disHata = $false; try { $disHata = ([Eding]::CncGetEMStopActive() -ne 0) } catch { }
        if ($yuzde -gt 97 -and -not (Hatali $sonDurum) -and -not $disHata) { Devam-Sil; $script:DevamHarita = $null }
        else { Devam-Kaydet $satir $(if ((Hatali $sonDurum) -or $disHata) { 'hata' } else { 'durduruldu' }) $yuzde; Yaz 'İş yarım kaldı: kaldığı yerden devam için BAŞLAT''a bas (aynı dosya seçiliyken).' }
        if ($disHata -and -not [Eding]::AcilKilit) {
            $bar.Dancing = $false; $lblSure.Text = 'Makine hata sinyali (EXTERR)  ·  basıncı kontrol et, RESET'; $lblSure.ForeColor = $cKirmizi
            Yaz "Kazıma makinenin hata sinyaliyle (EXTERR / acil stop) durdu, satır $satir. En sık sebep: hava basıncı düşük."
            [Kayit]::Show("Kazıma makinenin HATA SİNYALİYLE durdu (EXTERR).`r`n`r`nEn sık sebep: hava basıncı düşük (kompresör kapalı ya da basınç yetersiz).`r`nDiğerleri: iş mili sürücüsü hatası, acil stop butonu.`r`n`r`n1. Kompresörü / basıncı kontrol et.`r`n2. RESET'e bas.`r`n3. BAŞLAT → KALDIĞI YERDEN DEVAM.", 'Makine hatası', 'OK', 'Error') | Out-Null
            return
        }
        if (Hatali $sonDurum) {
            $script:IsAktif = $false; $bar.Dancing = $false
            $lblSure.Text = 'Eding hatası ile durdu'
            $lblSure.ForeColor = $cKirmizi
            $fark = [Eding]::CncGetVariable(4099); $sinir = [Eding]::CncGetVariable(4005); $tk = [Eding]::CncGetCurrentToolNumber()
            if ($fark -gt $sinir -and $sinir -gt 0) {
                $lblSure.Text = "Freze hatası  ·  T$tk"
                Yaz "FREZE HATASI: T$tk boyu $(Sayi $fark) mm değişmiş (sınır $(Sayi $sinir) mm), satır $satir. Kazıma durduruldu."
                [Kayit]::Show("FREZE HATASI`r`n`r`nT$tk frezesinin boyu iş sonrası ölçümde $(Sayi $fark) mm değişmiş (izin verilen: $(Sayi $sinir) mm).`r`nFreze kırılmış, aşınmış ya da pensin içinde kaymış olabilir.`r`n`r`nKazıma bir sonraki frezeye geçmeden durduruldu.`r`n`r`n1. Frezeyi kontrol et, gerekirse değiştir.`r`n2. RESET'e bas.`r`n3. Parçayı kontrol et; kaldığı yerden devam için Eding'de satır arama gerekir.", 'Freze hatası', 'OK', 'Error') | Out-Null
                return
            }
            Yaz "Kazıma Eding hatasıyla durdu ($sonDurum), satır $satir. Hatanın açıklaması Eding penceresinin mesaj kısmında yazar."
            [Kayit]::Show("Kazıma Eding hatasıyla durdu (satır $satir).`r`n`r`nHatanın açıklaması Eding penceresinin alt kısmındaki mesajlarda yazar (Ayarlar › PANEL › Eding penceresini göster).`r`nSık sebep: Eding, macro.cnc değiştirildikten sonra yeniden başlatılmadı.`r`n`r`nDevam etmek için RESET'e bas.", 'Eding hatası', 'OK', 'Error') | Out-Null
            return
        }
        if ($yuzde -gt 97) {
            $bar.Value = 100; $bar.Caption = ''; $bar.Dancing = $true
            $lblSure.Text = "Tamamlandı  ·  $(Sade-Sure $script:Gecen.TotalSeconds)"
            Yaz "Kazıma tamamlandı. Süre: $(Sure $script:Gecen.TotalSeconds)"
        } else {
            $bar.Dancing = $false
            $lblSure.Text = 'Durdu'
            Yaz "Kazıma durdu (satır $satir)."
        }
        return
    }
    $bar.Value = $yuzde
    $bar.Caption = ''
    $dilim = [math]::Floor($yuzde / 5) * 5
    if ($dilim -ne $script:SonYuzdeLog) { $script:SonYuzdeLog = $dilim; [Kayit]::Yaz("İLERLEME: %$dilim  satır $satir  geçen $(Sure $script:Gecen.TotalSeconds)  kalan ~$(Sure $kalan)") }
    $bar.Dancing = ($calisiyor -and -not $durakli)
    $lblSure.ForeColor = $cSoluk
    $bitis = (Get-Date).AddSeconds($kalan).ToString('HH:mm')
    $gecenTxt = Sade-Sure $script:Gecen.TotalSeconds
    $lblSure.Text = if ($durakli) { "Duraklatıldı   ·   Kazıma  $gecenTxt" } else { "Kazıma  $gecenTxt   ·   Kalan  $(Sade-Sure $kalan)   ·   Bitiş  $bitis" }
    $script:DetayIlerleme = "Satır: $satir / $($a.Kumulatif.Length)   ·   Geçen: $(Sure $script:Gecen.TotalSeconds)   ·   Kalan (tahmini): $(Sure $kalan)"
}

$script:DetayIlerleme = ''
$script:SonYuzdeLog = -1
$script:SonGecerliSatir = 0
$script:AdayHam = 0
$script:AdaySayac = 0
$script:SonEdingDurum = ''
$zamanlayici = New-Object System.Windows.Forms.Timer
$zamanlayici.Interval = 1000
$zamanlayici.Add_Tick({
    Hatalari-Kaydet
    Baglanti-Bekcisi
    if (-not $script:ApiHazir) { Durum-Yaz 'Önizleme modu' $cSoluk; $lblTeknik.Text = "Bu bilgisayarda $EdingKlasor\cncapi.dll yok. Sadece dosya kontrolü yapılabilir."; return }
    if (-not (Baglan)) { Durum-Yaz 'Makine bağlı değil' $cKirmizi; $lamba.LampColor = [System.Drawing.Color]::FromArgb(90, 90, 90); $lblTeknik.Text = "Eding CNC kapalı ya da bağlanılamadı."; return }
    try {
        $durum     = Eding-Durum
        if ($durum -ne $script:SonEdingDurum) { [Kayit]::Yaz("EDING DURUMU: $script:SonEdingDurum -> $durum"); $script:SonEdingDurum = $durum }
        $durakli   = ($durum -like 'PAUSE*')
        $calisiyor = (Mesgul $durum)
        $hatali    = (Hatali $durum)
        $acil      = ([Eding]::CncGetEMStopActive() -ne 0)
        $homeTamam      = ([Eding]::CncGetAllAxesHomed() -ne 0)
        $takim     = [Eding]::CncGetCurrentToolNumber()

        $tStr = if ($takim -gt 0) { "   ·   T$takim" } else { '' }
        if ([Eding]::AcilKilit) {
            if ($calisiyor) { [Kayit]::Yaz("ACİL STOP basılıyken Eding hareket etti ($durum): tekrar kesiliyor"); Acil-Stop 'bekçi' }
            Durum-Yaz 'ACİL STOP  ·  kaldırmak için RESET' $cKirmizi
            $script:EstopBlink = -not $script:EstopBlink; $estop.Blink = $script:EstopBlink
            $lamba.LampColor = if ($script:EstopBlink) { [System.Drawing.Color]::FromArgb(230, 20, 20) } else { [System.Drawing.Color]::FromArgb(90, 10, 10) }
        }
        elseif ($hatali -and -not $acil) { Durum-Yaz 'Eding hatası  ·  RESET' $cKirmizi; $lamba.LampColor = [System.Drawing.Color]::FromArgb(220, 30, 30) }
        elseif ($acil)      { Durum-Yaz 'Makine hata sinyali (EXTERR)  ·  RESET' $cKirmizi;              $lamba.LampColor = [System.Drawing.Color]::FromArgb(220, 30, 30) }
        elseif ($durakli)   { Durum-Yaz "Duraklatıldı$tStr" $cAltinAc;    $lamba.LampColor = [System.Drawing.Color]::FromArgb(230, 160, 0) }
        elseif ($calisiyor) { Durum-Yaz $(if ($script:IsAktif) { "Kazınıyor$tStr" } else { "Hareket ediyor$tStr" }) $cYesil;         $lamba.LampColor = [System.Drawing.Color]::FromArgb(20, 200, 90) }
        elseif (-not $homeTamam) { Durum-Yaz 'Home alınmadı' $cAltinAc;          $lamba.LampColor = [System.Drawing.Color]::FromArgb(230, 160, 0) }
        else                { Durum-Yaz "Hazır$tStr" $cSoluk;             $lamba.LampColor = [System.Drawing.Color]::FromArgb(235, 210, 0) }

        $btnBaslat.Text = if ($durakli) { 'DEVAM' } else { 'BAŞLAT' }
        try { $hz = Hiz-Oku; $lblHiz.Text = "%$hz"; $lblHiz.ForeColor = if ($hz -gt 120) { $cKirmizi } elseif ($hz -ne 100) { $cYesil } else { $cAltinAc } } catch { }
        $sim2 = $false; try { $sim2 = ([Eding]::CncGetSimulationMode() -ne 0) } catch { }
        $form.Text = if ($sim2) { 'Primer Teknoloji  ·  SİMÜLASYON' } else { 'Primer Teknoloji' }
        if ($sim2) { $lblDurum.Text += '   ·   simülasyon' }

        $lblTeknik.Text = "Eding: $([Eding]::StateText([Eding]::CncGetState()))   ·   Home: $(if ($homeTamam) {'tamam'} else {'alınmadı'})   ·   Takım: T$takim   ·   Acil stop: $(if ($acil) {'BASILI'} else {'yok'})`r`n" +
                          "Ayarlı frezeler: $((($AyarliTakimlar | ForEach-Object { "T$_" }) -join ', '))   ·   Kayıt klasörü: $IsKlasor`r`n" + $script:DetayIlerleme
        if ($ayar.Visible) {
            try {
                $mp = [Eding]::MachinePos(); $wp = [Eding]::WorkPos()
                $f = "{0,-7} X {1,9}   Y {2,9}   Z {3,9}   A {4,9}   B {5,9}"
                $lblKonum.Text = ($f -f 'MAKİNE', (Sayi $mp.X), (Sayi $mp.Y), (Sayi $mp.Z), (Sayi $mp.A), (Sayi $mp.B)) + "   ·   T$takim" + $(if (-not $homeTamam) { '   ·   home alınmadı' } else { '' }) + "`r`n" +
                                 ($f -f 'İŞ', (Sayi $wp.X), (Sayi $wp.Y), (Sayi $wp.Z), (Sayi $wp.A), (Sayi $wp.B))
            } catch { $lblKonum.Text = 'Konum okunamadı' }
        }
        if (-not $script:IsAktif) { $script:DetayIlerleme = "Güncel satır: $([Eding]::CncGetCurExecLine())" }
        Ilerleme-Guncelle $calisiyor $durakli
        Frez-Modu-Goster
        $ist = $null; try { $ist = Manuel-Istek } catch { }
        if ($ist -and -not [Eding]::AcilKilit) {
            $mt = switch ($ist.Faz) { 1 { "MANUEL FREZ: T$($ist.Eski) → T$($ist.T)  ·  frezi tut, PENS'İ AÇ" } 2 { "MANUEL FREZ: T$($ist.T) TAK  ·  sonra TAKTIM" } 4 { "MANUEL FREZ: T$($ist.T) hazır  ·  KAZIMAYI BAŞLAT onayı bekleniyor" } default { "MANUEL FREZ: hava basıncı yok  ·  KOMPRESÖRÜ AÇ (pens havayla açılır)" } }
            Durum-Yaz $mt $(if ($ist.Faz -eq 3) { $cKirmizi } else { $cAltinAc })
        }
        if ($script:OzelMakro -and -not $script:RafKontrolTamam -and -not $calisiyor -and -not $hatali -and $durum -ne 'POWERUP') { Raf-Kontrol }
        if ($script:AcilisDurum -ne 'tamam' -and $script:AcilisDurum -ne 'iptal' -and $script:AcilisDurum -ne 'calisiyor') { Acilis-Hazirla }
        elseif (-not $script:MakroKontrolTamam -and -not $calisiyor -and -not $durakli -and -not $hatali -and $durum -ne 'POWERUP' -and $durum -ne '' -and -not $script:IsAktif) { Makro-Baslangic-Kontrol }
    } catch { Durum-Yaz 'Durum okunamadı' $cKirmizi; $lblTeknik.Text = $_.Exception.Message }
})

# Esc = ACİL STOP (ana pencere, Ayarlar, Detaylar, Simülasyon)
foreach ($fx in @($form, $ayar, $detay, $simForm)) {
    $fx.KeyPreview = $true
    $fx.Add_KeyDown({ param($s, $e) if ($e.KeyCode -eq 'Escape') { $e.Handled = $true; $e.SuppressKeyPress = $true; Acil-Stop 'Esc tuşu' } })
}

$manuelZaman = New-Object System.Windows.Forms.Timer
$manuelZaman.Interval = 400
$manuelZaman.Add_Tick({ Manuel-Izle })

$form.Add_Shown({
    $edingGizleZaman.Start()
    if ([Eding]::AcilKilit) {
        $estop.Latched = $true
        Yaz 'Panel ACİL STOP basılıyken kapanmıştı: kilit devam ediyor, otomatik home yapılmadı. Kaldırmak için RESET.'
        Durum-Yaz 'ACİL STOP  ·  kaldırmak için RESET' $cKirmizi
    }
    if (-not $MakineBilgisayari) {
        foreach ($b in @($btnHome, $btnBaslat, $btnDuraklat, $btnDurdur, $btnReset, $btnFrez, $btnPens, $btnTemizlik)) { $b.Enabled = $false }
    }
    Yaz "Eding klasörü: $EdingKlasor   ·   Kayıt: $IsKlasor"
    Yaz "Log dosyası: $([Kayit]::Dosya)"
    if ($script:Tercih.EdingSifirla -ne '0') { Acilis-Eding-Sifirla }
    if ($script:Sade) { try { Macro-Pens-Yamasi } catch { [Kayit]::Yaz("MACRO yaması: $($_.Exception.Message)") } }
    Eding-Baslat
    $zamanlayici.Start()
    $koordZaman.Start()
    if ($script:OzelMakro) { $manuelZaman.Start() }
    try { Uzak-Baslat } catch { Yaz "Uzaktan erişim hatası: $($_.Exception.Message)" }
    try { Devam-Acilis } catch { [Kayit]::Yaz("DEVAM açılış: $($_.Exception.Message)") }
})
$form.Add_FormClosing({
    $edingGizleZaman.Stop()
    try { $uzakZaman.Stop(); [WebSunucu]::Durdur() } catch { }
    # Panel kapanınca Eding görünmez kalmasın
    try { foreach ($pr in @(Get-Process -Name $script:EdingExeAd -ErrorAction SilentlyContinue)) { [void][Pencere]::Goster($pr.Id) } } catch { }
    $zamanlayici.Stop()
    $koordZaman.Stop()
    Hatalari-Kaydet
    [Kayit]::Yaz('=== PANEL KAPATILDI ===')
    [Kayit]::Kapat()
})

# ================= WINDOWS BAŞLANGICI ve TAM EKRAN =================
# Windows'un Başlangıç klasörüne KazimaBaslat.bat kısayolu: oturum açılınca panel (ve onunla Eding) kendiliğinden başlar
function Windows-Baslangic-Ayarla {
    try {
        $klasor = [Environment]::GetFolderPath('Startup')
        $lnk = [System.IO.Path]::Combine($klasor, 'PrimerMill.lnk')
        # YoneticiKurulum.bat ile kurulan "PrimerMill" zamanlanmış görevi varsa (yönetici olarak açar) kısayol gerekmez
        $gorev = $false
        try { & schtasks.exe /query /tn 'PrimerMill' 2>$null | Out-Null; $gorev = ($LASTEXITCODE -eq 0) } catch { }
        if ($gorev) {
            if ([System.IO.File]::Exists($lnk)) { [System.IO.File]::Delete($lnk); [Kayit]::Yaz('BAŞLANGIÇ: yönetici görevi var, kısayol kaldırıldı') }
            if ($script:Tercih.WinBaslangic -eq '0') { & schtasks.exe /delete /tn 'PrimerMill' /f 2>$null | Out-Null }
            return
        }
        if ($script:Tercih.WinBaslangic -ne '0') {
            $bat = [System.IO.Path]::Combine($ScriptKlasor, 'KazimaBaslat.bat')
            $ws = New-Object -ComObject WScript.Shell
            $k = $ws.CreateShortcut($lnk)
            if ($k.TargetPath -ne $bat -or -not [System.IO.File]::Exists($lnk)) {
                $k.TargetPath = $bat
                $k.WorkingDirectory = $ScriptKlasor
                $k.WindowStyle = 7
                $k.Description = 'PrimerMill paneli (Primer Teknoloji)'
                $k.Save()
                [Kayit]::Yaz("BAŞLANGIÇ: Windows açılışına eklendi: $lnk -> $bat")
            }
        } elseif ([System.IO.File]::Exists($lnk)) {
            [System.IO.File]::Delete($lnk)
            [Kayit]::Yaz("BAŞLANGIÇ: Windows açılışından çıkarıldı: $lnk")
        }
    } catch { [Kayit]::Yaz("BAŞLANGIÇ: ayarlanamadı: $($_.Exception.Message)") }
}
Windows-Baslangic-Ayarla

# Eding Windows açılışında kendisi başlıyorsa önce o görünür; Eding'i panel gizli açar, bu yüzden Eding'in başlangıç kaydı kaldırılır (yedeklenir)
function Eding-Baslangic-Kaldir {
    if (-not $MakineBilgisayari -or $script:Tercih.EdingGizli -eq '0') { return }
    $yedekK = [System.IO.Path]::Combine($ScriptKlasor, 'baslangic_yedek')
    $ek = [System.IO.Path]::GetFullPath($EdingKlasor).TrimEnd('\')
    $ws = $null; try { $ws = New-Object -ComObject WScript.Shell } catch { }
    foreach ($kl in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup'))) {
        if (-not $kl -or -not [System.IO.Directory]::Exists($kl)) { continue }
        foreach ($d in [System.IO.Directory]::GetFiles($kl)) {
            $ad = [System.IO.Path]::GetFileName($d)
            if ($ad -like 'PrimerMill*') { continue }
            $hedef = ''
            if ($d -like '*.lnk' -and $ws) { try { $hedef = [string]$ws.CreateShortcut($d).TargetPath } catch { } }
            $eding = ($hedef -and ($hedef.StartsWith($ek, [StringComparison]::OrdinalIgnoreCase) -or [System.IO.Path]::GetFileName($hedef) -ieq "$($script:EdingExeAd).exe")) -or ($ad -match '(?i)eding|^cnc[\s\.]')
            if (-not $eding) { continue }
            try {
                [void][System.IO.Directory]::CreateDirectory($yedekK)
                [System.IO.File]::Move($d, [System.IO.Path]::Combine($yedekK, $ad))
                [Kayit]::Yaz("BAŞLANGIÇ: Eding'in kendi açılış kısayolu kaldırıldı (panel gizli açar): $d  → yedek: $yedekK")
            } catch { [Kayit]::Yaz("BAŞLANGIÇ: $d kaldırılamadı (yönetici izni gerekebilir): $($_.Exception.Message)") }
        }
    }
    foreach ($kok in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run')) {
        try {
            $k = Get-ItemProperty -Path $kok -ErrorAction Stop
            foreach ($pr in $k.PSObject.Properties) {
                if ($pr.Name -like 'PS*') { continue }
                $v = [string]$pr.Value
                if ($v -and ($v.IndexOf($ek, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or $v -match "(?i)\\$($script:EdingExeAd)\.exe")) {
                    try {
                        Add-Content -Path ([System.IO.Path]::Combine($ScriptKlasor, 'baslangic_yedek_kayit.txt')) -Value "$kok | $($pr.Name) | $v"
                        Remove-ItemProperty -Path $kok -Name $pr.Name -ErrorAction Stop
                        [Kayit]::Yaz("BAŞLANGIÇ: Eding'in Run kaydı kaldırıldı: $kok\$($pr.Name) = $v")
                    } catch { [Kayit]::Yaz("BAŞLANGIÇ: Run kaydı kaldırılamadı ($kok\$($pr.Name)): $($_.Exception.Message)") }
                }
            }
        } catch { }
    }
}
try { Eding-Baslangic-Kaldir } catch { [Kayit]::Yaz("BAŞLANGIÇ: Eding kaydı kontrol edilemedi: $($_.Exception.Message)") }

function Tam-Ekran-Uygula {
    $ekran = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $f = [math]::Min($ekran.Width / 1000.0, $ekran.Height / 640.0)
    if ([math]::Abs($f - 1) -gt 0.01) {
        # Tasarım 1000x640: ekrana sığacak kadar büyüt / küçült (konumlar, boyutlar, yazılar)
        $form.Scale((New-Object System.Drawing.SizeF($f, $f)))
        $olcekle = $null
        $olcekle = { param($kap)
            foreach ($c in $kap.Controls) {
                try { $c.Font = New-Object System.Drawing.Font($c.Font.FontFamily, [float]($c.Font.Size * $f), $c.Font.Style) } catch { }
                if ($c.Controls.Count -gt 0) { & $olcekle $c }
            }
        }
        & $olcekle $form
    }
    $form.FormBorderStyle = 'None'
    $form.StartPosition = 'Manual'
    $form.Bounds = $ekran
    $form.TopMost = $true      # Eding ya da başka bir pencere PrimerMill'in önüne geçemez
    # Ölçeklenen tasarımı ekranın ortasına al
    $dx = [int](($ekran.Width - 1000 * $f) / 2); $dy = [int](($ekran.Height - 640 * $f) / 2)
    if ($dx -ne 0 -or $dy -ne 0) { foreach ($c in @($form.Controls)) { $c.Left += $dx; $c.Top += $dy } }
    # Çerçeve olmadığı için köşede küçük "simge durumu" ve "kapat"
    foreach ($b in @(@('—', 'Simge durumuna küçült', 0), @('✕', 'PrimerMill''i kapat', 1))) {
        $l = New-Object System.Windows.Forms.Label
        $l.Text = $b[0]; $l.ForeColor = $cSoluk; $l.BackColor = $cZemin; $l.Cursor = [System.Windows.Forms.Cursors]::Hand
        $l.Font = New-Object System.Drawing.Font('Segoe UI', 12)
        $l.TextAlign = 'MiddleCenter'
        $l.SetBounds(8 + $b[2] * 40, $ekran.Height - 40, 34, 32)
        $tt = New-Object System.Windows.Forms.ToolTip; $tt.SetToolTip($l, $b[1])
        if ($b[2] -eq 0) { $l.Add_Click({ [Kayit]::Yaz('TUŞ: simge durumu'); $form.WindowState = 'Minimized' }) }
        else { $l.Add_Click({
            [Kayit]::Yaz('TUŞ: kapat')
            $msg = if ((Calisiyor-Mu)) { "Makine ÇALIŞIYOR. Panel kapanırsa takip durur (Eding işi sürdürür).`r`n`r`nYine de kapatılsın mı?" } else { "PrimerMill kapatılsın mı?" }
            if (Onay $msg 'Kapat') { $form.Close() }
        }) }
        $form.Controls.Add($l); $l.BringToFront()
    }
    [Kayit]::Yaz("TAM EKRAN: $($ekran.Width)x$($ekran.Height), ölçek $([math]::Round($f, 3))")
}
if ($script:Tercih.TamEkran -ne '0') { try { Tam-Ekran-Uygula } catch { [Kayit]::Yaz("TAM EKRAN uygulanamadı: $($_.Exception.Message)") } }

[DokunKlavye]::Acik = ($script:Tercih.SanalKlavye -ne '0')
try { [DokunKlavye]::Kur() } catch { [Kayit]::Yaz("KLAVYE kurulamadı: $($_.Exception.Message)") }
try { Eding-Gizle-Tik } catch { }
[void]$form.ShowDialog()
