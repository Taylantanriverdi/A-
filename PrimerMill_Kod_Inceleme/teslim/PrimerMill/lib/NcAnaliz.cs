// NcAnaliz.cs - NC dosyasi on kontrolu ve sure tahmini.
// Eski panelin gorsel Add-Type blogundan BIREBIR alindi (WinForms gerektirmez; RectangleF icin System.Drawing).
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;

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
    // KD-01: virgüllü ondalık (X1,5): Tok "X1" okur, ",5" kaybolur; Eding'in yorumu bilinmiyor -> hata (iş başlatılmaz)
    static readonly Regex VirgulRx = new Regex(@"\d\s*,\s*\d", RegexOptions.Compiled);

    public static NcAnaliz Oku(string yol, double hizliMmDk) {
        NcAnaliz a = new NcAnaliz();
        List<double> kum = new List<double>(1000000);
        List<float> lx = new List<float>(1000000), ly = new List<float>(1000000), lz = new List<float>(1000000);
        List<byte> lf = new List<byte>(1000000);
        float[] mnx = { 1e9f, 1e9f }, mny = { 1e9f, 1e9f }, mxx = { -1e9f, -1e9f }, mxy = { -1e9f, -1e9f };
        double x = 0, y = 0, z = 0, A = 0, B = 0, F = 1000, t = 0;
        int mode = 0; bool rel = false; int virgul = 0;
        foreach (string ham in File.ReadLines(yol)) {
            a.Satir++;
            string u = ham.ToUpperInvariant();
            int sc = u.IndexOf(';'); if (sc >= 0) u = u.Substring(0, sc);
            int pr = u.IndexOf('('); if (pr >= 0) u = u.Substring(0, pr);
            if (u.IndexOf(',') >= 0 && VirgulRx.IsMatch(Regex.Replace(u, "\"[^\"]*\"", ""))) { virgul++; if (virgul <= 5) a.Hatalar.Add("Satır " + a.Satir + ": virgüllü ondalık sayı (nokta olmalı, örn. X1.5): " + ham.Trim()); }

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
        if (virgul > 5) a.Hatalar.Add("Toplam " + virgul + " satırda virgüllü ondalık sayı var: CAM çıktısının ondalık ayırıcısı nokta olmalı.");
        a.Kumulatif = kum.ToArray();
        a.PX = lx.ToArray(); a.PY = ly.ToArray(); a.PZ = lz.ToArray(); a.PF = lf.ToArray();
        for (int f = 0; f < 2; f++) {
            a.BoundsOk[f] = mxx[f] > mnx[f];
            if (a.BoundsOk[f]) a.Bounds[f] = new RectangleF(mnx[f], mny[f], mxx[f] - mnx[f], mxy[f] - mny[f]);
        }
        return a;
    }
}

// ---------------------------------------------------------------------------------------------
// CarpismaAnaliz - takım / disk-tutucu çarpışma taraması (PrimerMill çarpışma incelemesi, makro sürüm 6).
// Takım hep dik (makine Z); disk A (eğme) ve B (çevirme, B180 = ters yüz) ile eğilir. İş koordinatı: disk merkezi X0 Y0,
// A0 B0 = disk düz. Her satır için takımın disk/tutucu bölgesinde (merkeze uzaklık <= BolgeR) iken diskin düzden en büyük
// eğimi bulunur; satırın gereksinimi bu eğimdir (bölge dışındaysa 0). A ya da B dönüşü 90°'yi (dikey) geçerse eğim 90.
// KalanEgim[i]: i. satırdan bu takımın son satırına (sonraki M6 dahil) kadar en büyük eğim. Panel bunu takımın uç boşluğuyla
// (güvenli Z'de uç yüksekliği) karşılaştırır: R·sin(eğim) + H·cos(eğim) + pay > uç boşluğu ise iş duraklatılır.
// Makro davranışı (sürüm 6): AZXY_SAFE = A düz (yerinde), sonra sensör X/Y; M6 = A düz (yerinde), sensör X/Y, B düz, sonra
// sensörde biter; M100 = Z üst, eğim değişmeden sensör X/Y; G30 = hepsi aynı anda G30 noktasına.
// MAKİNEDE DOĞRULA: bölge yarıçapı ve tutucu yüksekliği ölçülmeli (INCELEME_RAPORU.md Çarpışma incelemesi).
public class CarpismaAnaliz {
    public double[] Egim;        // satırın kendi gereksinimi (°)
    public double[] KalanEgim;   // satırdan takımın son satırına kadar en büyük gereksinim (°)
    public int[] KalanSatir;     // o gereksinimin satırı (1 tabanlı, 0 = yok)
    public int[] Takim;          // satırda etkin takım (-1 = programın başındaki, iş milindeki takım)
    public double EnBuyukEgim;
    public int EnBuyukSatir;
    public double BolgeR;

    static readonly Regex Tok = new Regex(@"([A-Z])\s*(-?\d*\.?\d+)", RegexOptions.Compiled);
    static readonly Regex GosubRx = new Regex(@"GOSUB\s+(\w+)", RegexOptions.Compiled);

    public static double EgimAci(double a, double b) {
        double c = Math.Abs(Math.Cos(a * Math.PI / 180.0)) * Math.Abs(Math.Cos(b * Math.PI / 180.0));
        if (c > 1) c = 1;
        return Math.Acos(c) * 180.0 / Math.PI;
    }
    // a0'dan a1'e dönerken 90 + k·180 (disk dikey) geçiliyor mu
    public static bool DikeyGecer(double a0, double a1) {
        double lo = Math.Min(a0, a1), hi = Math.Max(a0, a1);
        if (hi - lo < 1e-9) return false;
        double v = 90.0 + 180.0 * Math.Ceiling((lo - 90.0) / 180.0);
        return v <= hi;
    }
    public static double YolEgim(double a0, double b0, double a1, double b1) {
        if (DikeyGecer(a0, a1) || DikeyGecer(b0, b1)) return 90.0;
        return Math.Max(EgimAci(a0, b0), EgimAci(a1, b1));   // |cos| çarpımı log-içbükey: en küçüğü uçlarda
    }

    sealed class Nokta { public double X, Y; public bool Bilinen, Disarida; public Nokta(double x, double y, bool b, bool d) { X = x; Y = y; Bilinen = b; Disarida = d; } }

    double r;
    bool Icerde(Nokta p) { if (p.Bilinen) return Math.Sqrt(p.X * p.X + p.Y * p.Y) <= r; return !p.Disarida; }
    bool YolIcerde(Nokta p, Nokta q) {
        if (p.Bilinen && q.Bilinen) {
            double dx = q.X - p.X, dy = q.Y - p.Y, L2 = dx * dx + dy * dy, t = 0;
            if (L2 > 1e-12) { t = -(p.X * dx + p.Y * dy) / L2; if (t < 0) t = 0; if (t > 1) t = 1; }
            double cx = p.X + t * dx, cy = p.Y + t * dy;
            return Math.Sqrt(cx * cx + cy * cy) <= r;
        }
        if (!p.Bilinen && !p.Disarida) return true;
        if (!q.Bilinen && !q.Disarida) return true;
        if (p.Disarida && !p.Bilinen && q.Disarida && !q.Bilinen) return false;
        return Icerde(p.Bilinen ? p : q);
    }

    // satirlar: NC programı. bolgeR: disk/tutucu yarıçapı + pay (iş XY). sensorX/Y: sensörün iş koordinatı (NaN = bilinmiyor, disk dışı sayılır).
    // g30*: G30 noktası iş koordinatında (A/B iş açısı). g54*: G53 satırlarını iş koordinatına çevirmek için G54 X Y A B.
    // aMin/aMax: A'nın iş koordinatında ulaşabildiği aralık (cnc.ini sınırı - G54 A); aMax <= aMin ise kırpılmaz.
    public static CarpismaAnaliz Tara(string[] satirlar, double bolgeR, double sensorX, double sensorY,
                                      double g30X, double g30Y, double g30A, double g30B,
                                      double g54X, double g54Y, double g54A, double g54B, double aMin, double aMax) {
        CarpismaAnaliz c = new CarpismaAnaliz();
        c.BolgeR = bolgeR; c.r = bolgeR;
        int n = satirlar.Length;
        c.Egim = new double[n]; c.KalanEgim = new double[n]; c.KalanSatir = new int[n]; c.Takim = new int[n];
        bool sensorVar = !(double.IsNaN(sensorX) || double.IsNaN(sensorY));
        Nokta sensor = sensorVar ? new Nokta(sensorX, sensorY, true, false) : new Nokta(0, 0, false, true);
        Nokta g30 = new Nokta(g30X, g30Y, true, false);
        Nokta p = new Nokta(0, 0, false, false);   // başlangıç: bilinmiyor (disk üstünde sayılır)
        double a = 0, b = 0; bool rel = false; int takim = -1, sonT = -1;
        bool[] m6 = new bool[n];
        for (int i = 0; i < n; i++) {
            c.Takim[i] = takim;
            string u = (satirlar[i] ?? "").ToUpperInvariant();
            int sc = u.IndexOf(';'); if (sc >= 0) u = u.Substring(0, sc);
            u = Regex.Replace(u, @"\([^)]*\)", "").Trim();
            if (u.Length == 0 || u == "%") continue;
            double req = 0;
            Match gm = GosubRx.Match(u);
            if (gm.Success) {
                string ad = gm.Groups[1].Value;
                if (ad == "AZXY_SAFE") {
                    if (c.Icerde(p)) req = EgimAci(a, b);                       // A düzleşir (yerinde): eğim azalır
                    if (c.YolIcerde(p, sensor)) req = Math.Max(req, EgimAci(0, b));
                    a = 0; p = sensor;
                } else if (ad == "PM_PARK") {
                    if (c.Icerde(p)) req = EgimAci(a, b);
                    if (c.YolIcerde(p, g30)) req = Math.Max(req, EgimAci(0, b));
                    p = g30; if (c.Icerde(p)) req = Math.Max(req, YolEgim(0, b, g30A, g30B));
                    a = g30A; b = g30B;
                }
                c.Egim[i] = req; continue;
            }
            if (u.IndexOf('[') >= 0) {
                // panelin ürettiği G53 [#...] satırları (sıralı park): A[#5224] = düz, X[#5181] = G30 köşesi, X[#4020] = sensör, A[#5184] = G30 açıları
                if (u.Contains("A[#5224]")) { if (c.Icerde(p)) req = EgimAci(a, b); a = 0; }
                if (u.Contains("X[#5181]")) { if (c.YolIcerde(p, g30)) req = Math.Max(req, EgimAci(a, b)); p = g30; }
                if (u.Contains("X[#4020]")) { if (c.YolIcerde(p, sensor)) req = Math.Max(req, EgimAci(a, b)); p = sensor; }
                if (u.Contains("A[#5184]")) { if (c.Icerde(p)) req = Math.Max(req, YolEgim(a, b, g30A, g30B)); a = g30A; b = g30B; }
                c.Egim[i] = req; continue;
            }
            bool g53 = false, g30Var = false, mYuz = false, m6Var = false; int tYeni = -1;
            double? X = null, Y = null, Z = null, A = null, B = null;
            foreach (Match m in Tok.Matches(u)) {
                char L = m.Groups[1].Value[0];
                double v;
                if (!double.TryParse(m.Groups[2].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out v)) continue;
                switch (L) {
                    case 'G':
                        if (v == 53) g53 = true; else if (v == 30) g30Var = true;
                        else if (v == 90) rel = false; else if (v == 91) rel = true;
                        break;
                    case 'M': if (v == 6) m6Var = true; else if (v == 100) mYuz = true; break;
                    case 'T': tYeni = (int)v; break;
                    case 'X': X = v; break; case 'Y': Y = v; break; case 'Z': Z = v; break;
                    case 'A': A = v; break; case 'B': B = v; break;
                }
            }
            if (tYeni >= 0) sonT = tYeni;
            if (m6Var) {
                // change_tool (sürüm 6): Z üst, A düz yerinde, sensör X/Y, B düz sensörde; sensörde biter (A0 B0)
                if (c.Icerde(p)) req = EgimAci(a, b);
                if (c.YolIcerde(p, sensor)) req = Math.Max(req, EgimAci(0, b));
                if (c.Icerde(sensor)) req = Math.Max(req, YolEgim(0, b, 0, 0));
                a = 0; b = 0; p = sensor;
                c.Egim[i] = req; m6[i] = true; takim = sonT; continue;
            }
            if (mYuz) {
                if (c.YolIcerde(p, sensor)) req = EgimAci(a, b);
                p = sensor; c.Egim[i] = req; continue;
            }
            if (g30Var && X == null && Y == null && Z == null && A == null && B == null) {
                if (c.YolIcerde(p, g30)) req = YolEgim(a, b, g30A, g30B);
                p = g30; a = g30A; b = g30B; c.Egim[i] = req; continue;
            }
            if (X == null && Y == null && Z == null && A == null && B == null) continue;
            Nokta q = new Nokta(p.X, p.Y, p.Bilinen, p.Disarida);
            double na = a, nb = b;
            if (g53) {
                if (X != null || Y != null) {
                    if (X != null && Y != null) q = new Nokta(X.Value - g54X, Y.Value - g54Y, true, false);
                    else if (p.Bilinen) q = new Nokta(X != null ? X.Value - g54X : p.X, Y != null ? Y.Value - g54Y : p.Y, true, false);
                    else q = new Nokta(0, 0, false, false);
                }
                if (A != null) na = A.Value - g54A;
                if (B != null) nb = B.Value - g54B;
            } else {
                if (X != null || Y != null) {
                    if (rel) { if (p.Bilinen) q = new Nokta(p.X + (X ?? 0), p.Y + (Y ?? 0), true, false); else q = new Nokta(0, 0, false, false); }
                    else if (X != null && Y != null) q = new Nokta(X.Value, Y.Value, true, false);
                    else if (p.Bilinen) q = new Nokta(X ?? p.X, Y ?? p.Y, true, false);
                    else q = new Nokta(0, 0, false, false);
                }
                if (A != null) na = rel ? a + A.Value : A.Value;
                if (B != null) nb = rel ? b + B.Value : B.Value;
            }
            // A ekseni yumuşak sınırların ötesine gidemez (Eding sınırda durur): A180 gibi değerler sınıra kırpılır
            if (aMax > aMin) { if (na < aMin) na = aMin; if (na > aMax) na = aMax; }
            if (c.YolIcerde(p, q)) req = YolEgim(a, b, na, nb);
            p = q; a = na; b = nb; c.Egim[i] = req;
        }
        // takım parçası boyunca geriye doğru en büyük (M6 satırı eski takımın parçasının son satırı)
        double mx = 0; int ms = 0;
        for (int i = n - 1; i >= 0; i--) {
            if (m6[i]) { mx = 0; ms = 0; }
            if (c.Egim[i] > 0 && c.Egim[i] >= mx) { mx = c.Egim[i]; ms = i + 1; }   // eşitse en erken satır
            c.KalanEgim[i] = mx; c.KalanSatir[i] = ms;
            if (c.Egim[i] > c.EnBuyukEgim) { c.EnBuyukEgim = c.Egim[i]; c.EnBuyukSatir = i + 1; }
        }
        return c;
    }
    public static CarpismaAnaliz Oku(string yol, double bolgeR, double sensorX, double sensorY,
                                     double g30X, double g30Y, double g30A, double g30B,
                                     double g54X, double g54Y, double g54A, double g54B, double aMin, double aMax) {
        return Tara(File.ReadAllLines(yol), bolgeR, sensorX, sensorY, g30X, g30Y, g30A, g30B, g54X, g54Y, g54A, g54B, aMin, aMax);
    }
}
