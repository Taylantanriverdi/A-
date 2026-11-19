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
