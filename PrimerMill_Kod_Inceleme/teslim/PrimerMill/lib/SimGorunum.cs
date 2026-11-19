// SimGorunum.cs - parca simulasyonu (PartFace, PartModel, SimRenderer, SimView).
// Eski panelin gorsel Add-Type blogundan BIREBIR alindi (EggButton, LuxProgress, Hayvanlar ve diger eski
// kontroller yeni arayuzde (ui/PrimerUI.cs) kullanilmadigi icin alinmadi). NcAnaliz: lib/NcAnaliz.cs.
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
