// EdingSim.cs - PrimerMill demo modu için sahte Eding CNC API'si (cncapi.dll yerine).
//
// KazimaBaslat.ps1 içindeki gerçek [Eding] sınıfıyla AYNI ADLI ve AYNI ÜYELİ (aynı imzalar).
// Gerçek DLL yüklenmez; makine bellekte simüle edilir:
//   - durum makinesi: POWERUP -> (bağlan) READY, RUNNING, RUN-SUB, PAUSE, ABORTED, INT-ERR
//   - eksenler (G0/G1/G53/G90/G91, G38.2), takım (M6 Tn), iş mili (M3/M5 S), çıkışlar (M54/M55 P)
//   - değişkenler: cnc.ini [VARIABLES] değerleriyle dolu (#4000-#4199, #5xxx), #50xx konumlar
//   - iş: CncLoadJobA satırları sayar, CncRunOrResumeJob çalıştırır, satır zamanla ilerler
// Zaman: iş parçacığı / zamanlayıcı YOK. Her API çağrısında Stopwatch okunur ve simülasyon
// o ana kadar ilerletilir (Tick). Tüm durum tek bir kilit altında.
//
// C# 5 (PowerShell 5.1 Add-Type / .NET Framework 4.x csc). Yalnız System ve System.Core.
// Derleme denetimi: mcs -langversion:5 -target:library lib/EdingSim.cs
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

[StructLayout(LayoutKind.Sequential)]
public struct Cart { public double X, Y, Z, A, B, C; }

public static class Eding {
    // ------------------------------------------------------------ demo bayrakları
    public static bool Demo = true;
    // Gerçek sınıftaki gibi: yazılım acil stopu basılıyken hareket komutları gitmez
    public static volatile bool AcilKilit = false;
    // Test/demo ayarları (gerçek sınıfta yok)
    public static double SimHizCarpani = 1.0;     // simüle zamanın hızı (testlerde büyütülür)
    public static int SimMakroSurum = 4;          // gosub pm_surum -> #4038
    public static int SimSimulasyonModu = 0;      // CncGetSimulationMode() dönüşü
    public static double SimSatirHizi = 400.0;    // iş: saniyede satır (%100 hızda)

    // ------------------------------------------------------------ durum kodları
    public const int ST_IDLE = 0, ST_POWERUP = 1, ST_READY = 2, ST_RUNNING = 3, ST_RUNSUB = 4,
        ST_PAUSE = 5, ST_SEARCHING = 6, ST_AXISJOG = 7, ST_IPJOG = 8, ST_ABORTED = 9, ST_INTERR = 10;
    static readonly string[] DurumMetni = { "IDLE", "POWERUP", "READY", "RUNNING", "RUN-SUB",
        "PAUSE", "SEARCHING", "AXISJOG", "IPJOG", "ABORTED", "INT-ERR" };

    // ------------------------------------------------------------ dönüş kodları
    public const int RC_OK = 0, RC_HATA = 1, RC_BAGLI_DEGIL = 2, RC_MESGUL = 3, RC_GECERSIZ_DURUM = 4,
        RC_DOSYA_YOK = 5, RC_SUNUCU_ACIK = 6, RC_ZATEN_BAGLI = 7, RC_SOZDIZIMI = 8, RC_ACIL_STOP = 9;
    static readonly string[] RcMetni = { "CNC_RC_OK", "CNC_RC_ERR", "CNC_RC_ERR_NOT_CONNECTED", "CNC_RC_BUSY",
        "CNC_RC_ERR_STATE", "CNC_RC_ERR_FILE", "CNC_RC_SERVER_RUNNING", "CNC_RC_ALREADY_CONNECTED",
        "CNC_RC_ERR_SYNTAX", "CNC_RC_ERR_EMSTOP" };

    // cnc.ini [VARIABLES] içindeki sıfır olmayan değerler (makinenin gerçek ayarları, 2025 kopyası).
    // Listede olmayan #4000-#4199 ve #5221-#5225 dahil tüm değişkenler 0'dır.
    static readonly int[] IniNo = {
        4000, 4001, 4002, 4003, 4004, 4005, 4006,
        5161, 5162, 5163, 5164, 5165, 5181, 5182, 5183, 5184, 5185,
        5213, 5220, 5221, 5222, 5223, 5224, 5225,
        5241, 5242, 5243, 5244, 5245, 5261, 5262, 5263, 5264, 5265 };
    static readonly double[] IniDeger = {
        -46.9, -26.0, 32.265, -1.0, -14.0, 0.2, 1.0,
        0.4, 0.9, 3.8, 20.209, -2.3508, 0.4, 0.9, 3.8, -4.8372, -2.3508,
        -247.5345, 1.0, -53.1425, -53.456, 208.8975, 20.209, -2.3508,
        -50.93065, -50.78365, 4.0, 18.3542, -4.773, -50.93065, -50.78365, 4.0, 18.3542, -4.773 };

    // ------------------------------------------------------------ iç durum
    static readonly object kilit = new object();
    static readonly Stopwatch saat = Stopwatch.StartNew();
    static readonly CultureInfo IC = CultureInfo.InvariantCulture;
    static readonly Dictionary<string, IntPtr> metinBellek = new Dictionary<string, IntPtr>();

    static double sonZaman;           // simüle saniye (son Tick)
    static bool bagli, homed;
    static int takim;
    static Dictionary<int, double> deg = new Dictionary<int, double>();
    static Dictionary<int, int> cikis = new Dictionary<int, int>();
    static Dictionary<int, int> giris = new Dictionary<int, int>();
    static double ovr = 1.0;
    static bool acilBasili, hataVar, abortKalici;
    static double abortBitis = -1;

    // eksenler (makine koordinatı): hareket başlangıcı/sonu, doğrusal ara değer
    static double[] mBas = new double[5], mSon = new double[5];
    static double hBas, hSure;        // hareket başlangıç zamanı ve süresi (0 = hareket yok)
    static bool g91;                  // modal artımlı
    static int gHareket;              // modal 0 / 1
    static double fModal = 1000;

    // MDI meşguliyeti (hareket / alt program / bekleme)
    static double mdiBitis = -1; static bool mdiAlt;
    static int bekleyenTakim = -1; static bool bekleyenHome; static bool probBekliyor;

    // iş mili
    static double sBas, sHedef, sZaman;

    // iş (job)
    static string[] isSatir = new string[0];
    static string isDosya = "";
    static bool isAktif, isDurakli;
    static double isKonum;            // ilerleme (satır, kesirli)
    static int isUygulanan;           // uygulanan son satır (1 tabanlı)
    static double isAltKalan;         // iş içinde takım değişimi (RUN-SUB) kalan süre

    static Eding() { Sifirla(); }

    static void Sifirla() {
        sonZaman = Simdi();
        bagli = false; homed = false; takim = 0;
        deg = new Dictionary<int, double>();
        for (int i = 0; i < IniNo.Length; i++) deg[IniNo[i]] = IniDeger[i];
        cikis = new Dictionary<int, int>(); giris = new Dictionary<int, int>();
        ovr = 1.0; acilBasili = false; hataVar = false; abortKalici = false; abortBitis = -1;
        mBas = new double[5]; mSon = new double[5]; hSure = 0; g91 = false; gHareket = 0; fModal = 1000;
        mdiBitis = -1; mdiAlt = false; bekleyenTakim = -1; bekleyenHome = false; probBekliyor = false;
        sBas = 0; sHedef = 0; sZaman = 0;
        isSatir = new string[0]; isDosya = ""; isAktif = false; isDurakli = false; isKonum = 0; isUygulanan = 0; isAltKalan = 0;
        AcilKilit = false;
    }

    static double Simdi() { return saat.Elapsed.TotalSeconds * SimHizCarpani; }

    // ------------------------------------------------------------ zaman ilerletme
    static void Tick() {
        double simdi = Simdi();
        double dt = simdi - sonZaman;
        if (dt < 0) dt = 0;
        sonZaman = simdi;

        if (abortBitis >= 0 && simdi >= abortBitis) abortBitis = -1;
        if (hSure > 0 && simdi >= hBas + hSure) { Array.Copy(mSon, mBas, 5); hSure = 0; }
        if (mdiBitis >= 0 && simdi >= mdiBitis) MdiBitir();

        if (isAktif && !isDurakli && dt > 0) {
            if (isAltKalan > 0) {
                double kul = Math.Min(isAltKalan, dt); isAltKalan -= kul; dt -= kul;
            }
            if (dt > 0 && isAltKalan <= 0) {
                isKonum += dt * SimSatirHizi * ovr;
                int hedef = (int)Math.Floor(isKonum);
                if (hedef > isSatir.Length) hedef = isSatir.Length;
                while (isUygulanan < hedef && isAktif && !isDurakli && isAltKalan <= 0) {
                    isUygulanan++;
                    IsSatiriUygula(isSatir[isUygulanan - 1]);
                }
                if (isDurakli || isAltKalan > 0) isKonum = isUygulanan;
                if (isAktif && isUygulanan >= isSatir.Length && isAltKalan <= 0 && !isDurakli) {
                    isAktif = false; isKonum = isSatir.Length;
                }
            }
        }
    }

    static void MdiBitir() {
        mdiBitis = -1; mdiAlt = false;
        if (hSure > 0) { Array.Copy(mSon, mBas, 5); hSure = 0; }
        if (bekleyenTakim >= 0) { takim = bekleyenTakim; deg[5008] = takim; bekleyenTakim = -1; }
        if (bekleyenHome) { homed = true; bekleyenHome = false; }
        if (probBekliyor) { ProbSonucYaz(); probBekliyor = false; }
    }

    static void ProbSonucYaz() {
        double[] w = IsKonumu(mBas);
        deg[5061] = w[0]; deg[5062] = w[1]; deg[5063] = w[2]; deg[5064] = w[3]; deg[5065] = w[4];
        deg[5067] = 1;
    }

    // ------------------------------------------------------------ yardımcılar
    static double V(int n) { double v; return deg.TryGetValue(n, out v) ? v : 0.0; }
    static double Ofset(int i) { return V(5221 + i) + V(5211 + i); }
    static double[] Konum() {   // şu anki makine konumu
        double[] p = new double[5];
        double t = 1;
        if (hSure > 0) { t = (sonZaman - hBas) / hSure; if (t < 0) t = 0; if (t > 1) t = 1; }
        for (int i = 0; i < 5; i++) p[i] = mBas[i] + (mSon[i] - mBas[i]) * t;
        return p;
    }
    static double[] IsKonumu(double[] m) { double[] w = new double[5]; for (int i = 0; i < 5; i++) w[i] = m[i] - Ofset(i); return w; }
    static bool Mesgul() { return mdiBitis >= 0 || isAktif; }
    static bool HataliDurum() { return hataVar || acilBasili || abortKalici || abortBitis >= 0; }

    static int Durum() {
        if (!bagli) return ST_POWERUP;
        if (hataVar) return ST_INTERR;
        if (acilBasili || abortKalici || abortBitis >= 0) return ST_ABORTED;
        if (isAktif) { if (isDurakli) return ST_PAUSE; if (isAltKalan > 0) return ST_RUNSUB; return ST_RUNNING; }
        if (mdiBitis >= 0) return mdiAlt ? ST_RUNSUB : ST_RUNNING;
        return ST_READY;
    }

    static IntPtr Metin(string s) {
        IntPtr p;
        if (!metinBellek.TryGetValue(s, out p)) { p = Marshal.StringToHGlobalAnsi(s); metinBellek[s] = p; }
        return p;
    }

    static void HepsiniDurdur() {
        double[] p = Konum(); Array.Copy(p, mBas, 5); Array.Copy(p, mSon, 5); hSure = 0;
        mdiBitis = -1; mdiAlt = false; bekleyenTakim = -1; bekleyenHome = false; probBekliyor = false;
        isAktif = false; isDurakli = false; isAltKalan = 0;
        IsMiliAyarla(0);
    }

    static void IsMiliAyarla(double hedef) {
        double simdiki = IsMiliHizi();
        sBas = simdiki; sHedef = hedef; sZaman = sonZaman;
    }
    static double IsMiliHizi() {
        double t = (sonZaman - sZaman) / 0.8;   // 0.8 sn'de hedefe
        if (t >= 1) return sHedef; if (t < 0) t = 0;
        return sBas + (sHedef - sBas) * t;
    }

    // ------------------------------------------------------------ G-kod ayrıştırma
    // Kelimeler: harf + sayı | harf + [ifade] | harf + #n. Yorumlar ( ... ) ve ; sonrası atılır.
    sealed class Kelime { public char H; public double D; }

    static string YorumSil(string s) {
        StringBuilder b = new StringBuilder(); int d = 0;
        foreach (char c in s) {
            if (c == '(') { d++; continue; }
            if (c == ')') { if (d > 0) d--; continue; }
            if (d > 0) continue;
            if (c == ';') break;
            b.Append(c);
        }
        return b.ToString().Trim();
    }

    // [#5221 - 1.5] gibi ifadeler: + - * /, köşeli parantez, #n, tekli eksi
    sealed class Ifade {
        string s; int i;
        public Ifade(string t) { s = t; i = 0; }
        void Bos() { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; }
        public double Hepsi() { double v = Topla(); Bos(); if (i != s.Length) throw new FormatException("ifade: " + s); return v; }
        double Topla() {
            double v = Carp();
            while (true) { Bos(); if (i < s.Length && (s[i] == '+' || s[i] == '-')) { char o = s[i++]; double r = Carp(); v = o == '+' ? v + r : v - r; } else return v; }
        }
        double Carp() {
            double v = Tekli();
            while (true) { Bos(); if (i < s.Length && (s[i] == '*' || s[i] == '/')) { char o = s[i++]; double r = Tekli(); v = o == '*' ? v * r : v / r; } else return v; }
        }
        double Tekli() {
            Bos();
            if (i < s.Length && s[i] == '-') { i++; return -Tekli(); }
            if (i < s.Length && s[i] == '+') { i++; return Tekli(); }
            if (i < s.Length && (s[i] == '[' || s[i] == '(')) {
                char kapa = s[i] == '[' ? ']' : ')'; i++;
                double v = Topla(); Bos();
                if (i >= s.Length || s[i] != kapa) throw new FormatException("parantez: " + s);
                i++; return v;
            }
            if (i < s.Length && s[i] == '#') {
                i++; int b = i; while (i < s.Length && char.IsDigit(s[i])) i++;
                if (b == i) throw new FormatException("#: " + s);
                return V(int.Parse(s.Substring(b, i - b), IC));
            }
            int bas = i;
            while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '.')) i++;
            if (bas == i) throw new FormatException("sayı: " + s);
            return double.Parse(s.Substring(bas, i - bas), NumberStyles.Float, IC);
        }
    }

    static double Hesapla(string t) { return new Ifade(t).Hepsi(); }

    static List<Kelime> Kelimeler(string s) {
        List<Kelime> l = new List<Kelime>(); int i = 0;
        while (i < s.Length) {
            char c = s[i];
            if (char.IsWhiteSpace(c)) { i++; continue; }
            if (!char.IsLetter(c)) throw new FormatException("beklenmeyen: " + s.Substring(i));
            i++;
            while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
            int bas = i;
            if (i < s.Length && s[i] == '[') {
                int d = 0;
                while (i < s.Length) { if (s[i] == '[') d++; else if (s[i] == ']') { d--; if (d == 0) { i++; break; } } i++; }
            } else if (i < s.Length && s[i] == '#') {
                i++; while (i < s.Length && char.IsDigit(s[i])) i++;
            } else {
                while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '.' || s[i] == '-' || s[i] == '+')) i++;
            }
            if (bas == i) throw new FormatException("değer yok: " + c);
            Kelime k = new Kelime(); k.H = char.ToUpperInvariant(c); k.D = Hesapla(s.Substring(bas, i - bas));
            l.Add(k);
        }
        return l;
    }

    // Satırın etkisi. anlik=true: iş içinden (süre yok, takım değişimi iş alt programı).
    // Dönüş: rc. MDI için süre gerekiyorsa sure/alt ayarlanır.
    static int SatirIsle(string ham, bool anlik, out double sure, out bool alt) {
        sure = 0; alt = false;
        string s = YorumSil(ham);
        if (s.Length == 0 || s == "%") return RC_OK;
        string k = s.ToLowerInvariant();

        if (k.StartsWith("gosub")) {
            string ad = k.Substring(5).Trim();
            if (ad == "pm_surum") deg[4038] = SimMakroSurum;
            if (ad == "home_all" || ad == "home_x" || ad == "home_z") {
                double[] bas = anlik ? (double[])mSon.Clone() : Konum();
                if (anlik) { for (int j = 0; j < 5; j++) { mSon[j] = 0; mBas[j] = 0; } hSure = 0; homed = true; }
                else { HareketBaslat(bas, new double[5], 2.5); bekleyenHome = true; }
                sure = 2.5; alt = true; return RC_OK;
            }
            sure = ad == "pm_surum" ? 0.3 : 1.0; alt = true; return RC_OK;
        }
        if (k.StartsWith("msg") || k.StartsWith("warnmsg") || k.StartsWith("dlgmsg") || k.StartsWith("errmsg")
            || k.StartsWith("if") || k.StartsWith("else") || k.StartsWith("endif") || k.StartsWith("while")
            || k.StartsWith("endwhile") || k.StartsWith("sub") || k.StartsWith("endsub")) return RC_OK;
        if (k[0] == '#') {
            int e = k.IndexOf('=');
            if (e < 0) return RC_SOZDIZIMI;
            int nr; if (!int.TryParse(k.Substring(1, e - 1).Trim(), NumberStyles.Integer, IC, out nr)) return RC_SOZDIZIMI;
            double v; try { v = Hesapla(k.Substring(e + 1)); } catch (FormatException) { return RC_SOZDIZIMI; }
            deg[nr] = v; return RC_OK;
        }

        List<Kelime> ks;
        try { ks = Kelimeler(s); } catch (FormatException) { return RC_SOZDIZIMI; }
        bool g53 = false, artimli = g91, prob = false, dwell = false, m6 = false, g10 = false; int hareket = gHareket;
        double? T = null, S = null, P = null, F = null, Lk = null;
        double?[] eks = new double?[5];
        List<int> mler = new List<int>();
        foreach (Kelime w in ks) {
            switch (w.H) {
                case 'G':
                    double g = Math.Round(w.D, 1);
                    if (g == 0) hareket = 0; else if (g == 1 || g == 2 || g == 3) hareket = 1;
                    else if (g == 4) dwell = true; else if (g == 53) g53 = true;
                    else if (g == 90) artimli = false; else if (g == 91) artimli = true;
                    else if (g == 38.2) prob = true; else if (g == 10) g10 = true;
                    break;
                case 'M': mler.Add((int)Math.Round(w.D)); break;
                case 'T': T = w.D; break;
                case 'S': S = w.D; break;
                case 'P': P = w.D; break;
                case 'F': F = w.D; break;
                case 'L': Lk = w.D; break;
                case 'X': eks[0] = w.D; break;
                case 'Y': eks[1] = w.D; break;
                case 'Z': eks[2] = w.D; break;
                case 'A': eks[3] = w.D; break;
                case 'B': eks[4] = w.D; break;
            }
        }
        g91 = artimli; gHareket = hareket; if (F.HasValue && F.Value > 0) fModal = F.Value;
        if (g10) {
            // G10 L2 P1 X.. : G54 (#5221-#5225) mutlak değer; L2 P2.. diğer iş koordinatları (#5241..)
            if (!Lk.HasValue || Math.Round(Lk.Value) != 2 || !P.HasValue) return RC_SOZDIZIMI;
            int taban = 5221 + 20 * ((int)Math.Round(P.Value) - 1);
            for (int j = 0; j < 5; j++) if (eks[j].HasValue) deg[taban + j] = eks[j].Value;
            return RC_OK;
        }
        if (T.HasValue) deg[5011] = T.Value;
        foreach (int m in mler) {
            if (m == 6) m6 = true;
            else if (m == 3 || m == 4) IsMiliAyarla(S.HasValue ? S.Value : 10000);
            else if (m == 5) IsMiliAyarla(0);
            else if (m == 54 && P.HasValue) cikis[(int)P.Value] = 1;
            else if (m == 55 && P.HasValue) cikis[(int)P.Value] = 0;
            else if (m == 0 || m == 1) { if (anlik) isDurakli = true; }
            else if (m == 30 || m == 2) { if (anlik) { isAktif = false; isDurakli = false; } }
        }
        if (S.HasValue && !mler.Contains(3) && !mler.Contains(4) && sHedef > 0) IsMiliAyarla(S.Value);

        double[] simdi = anlik ? (double[])mSon.Clone() : Konum();
        bool hareketVar = false; double mesafe = 0;
        double[] hedef = (double[])simdi.Clone();
        for (int j = 0; j < 5; j++) {
            if (!eks[j].HasValue) continue;
            hareketVar = true;
            if (artimli && !g53) hedef[j] = simdi[j] + eks[j].Value;
            else if (g53) hedef[j] = eks[j].Value;
            else hedef[j] = eks[j].Value + Ofset(j);
            mesafe += (hedef[j] - simdi[j]) * (hedef[j] - simdi[j]);
        }
        mesafe = Math.Sqrt(mesafe);

        if (m6) {
            int yeni = T.HasValue ? (int)Math.Round(T.Value) : (int)Math.Round(V(5011));
            if (anlik) { takim = yeni; deg[5008] = yeni; isAltKalan = 1.5; return RC_OK; }
            bekleyenTakim = yeni; sure = 1.5; alt = true; return RC_OK;
        }
        if (dwell) { sure = P.HasValue ? Math.Min(5.0, Math.Max(0.0, P.Value)) : 0; return RC_OK; }
        if (hareketVar) {
            if (anlik) { Array.Copy(hedef, mBas, 5); Array.Copy(hedef, mSon, 5); hSure = 0; if (prob) { ProbSonucYaz(); } return RC_OK; }
            double hiz = hareket == 0 ? 5000 : fModal; if (prob) hiz = Math.Min(hiz, 300);
            double t = mesafe / hiz * 60.0;
            if (hareket != 0 && ovr > 0.01) t = t / ovr;
            if (t < 0.3) t = 0.3; if (t > 4.0) t = 4.0;
            HareketBaslat(simdi, hedef, t);
            if (prob) probBekliyor = true;
            sure = t; return RC_OK;
        }
        return RC_OK;
    }

    static void HareketBaslat(double[] bas, double[] son, double t) { Array.Copy(bas, mBas, 5); Array.Copy(son, mSon, 5); hBas = sonZaman; hSure = t; }

    static void IsSatiriUygula(string satir) {
        double s; bool a;
        try { SatirIsle(satir, true, out s, out a); } catch (Exception) { }
    }

    // ================================================================== GERÇEK SINIFLA AYNI ÜYELER
    public static bool SetDllDirectory(string path) { return true; }

    public static int CncConnectServer(string iniFile) {
        lock (kilit) { Tick(); if (bagli) return RC_ZATEN_BAGLI; bagli = true; return RC_OK; }
    }
    public static int CncDisConnectServer() {
        lock (kilit) { Tick(); if (!bagli) return RC_BAGLI_DEGIL; bagli = false; return RC_OK; }
    }
    public static int CncLoadJobA(string fileName) {
        lock (kilit) {
            Tick();
            if (!bagli) return RC_BAGLI_DEGIL;
            if (isAktif) return RC_MESGUL;
            if (string.IsNullOrEmpty(fileName) || !File.Exists(fileName)) return RC_DOSYA_YOK;
            try { isSatir = File.ReadAllLines(fileName); } catch (IOException) { return RC_DOSYA_YOK; } catch (UnauthorizedAccessException) { return RC_DOSYA_YOK; }
            isDosya = fileName; isKonum = 0; isUygulanan = 0;
            return RC_OK;
        }
    }
    public static int CncRunOrResumeJob() {
        if (AcilKilit) return -1;
        lock (kilit) {
            Tick();
            if (!bagli) return RC_BAGLI_DEGIL;
            if (acilBasili) return RC_ACIL_STOP;
            if (HataliDurum()) return RC_GECERSIZ_DURUM;
            if (isAktif) { if (isDurakli) { isDurakli = false; return RC_OK; } return RC_MESGUL; }
            if (mdiBitis >= 0) return RC_MESGUL;
            if (isSatir.Length == 0) return RC_GECERSIZ_DURUM;
            isAktif = true; isDurakli = false; isKonum = 0; isUygulanan = 0; isAltKalan = 0;
            return RC_OK;
        }
    }
    public static int CncPauseJob() {
        lock (kilit) {
            Tick();
            if (!bagli) return RC_BAGLI_DEGIL;
            if (isAktif && !isDurakli) { isDurakli = true; isKonum = isUygulanan; return RC_OK; }
            return RC_OK;
        }
    }
    public static int CncAbortJob() {
        lock (kilit) {
            Tick();
            if (!bagli) return RC_BAGLI_DEGIL;
            HepsiniDurdur();
            abortBitis = sonZaman + 0.5;
            return RC_OK;
        }
    }
    public static int CncRunSingleLine(string line) { if (AcilKilit) return -1; return TekSatir(line, false); }
    // Sadece acil stop rutini kullanır (M5 / M9 gibi güvenli kapatma satırları)
    public static int CncRunSingleLineZorla(string line) { return TekSatir(line, true); }

    static int TekSatir(string line, bool zorla) {
        lock (kilit) {
            Tick();
            if (!bagli) return RC_BAGLI_DEGIL;
            if (line == null) return RC_SOZDIZIMI;
            string s = YorumSil(line);
            bool hareketli = HareketliMi(s);
            if (isAktif && !zorla) return RC_MESGUL;
            if (hareketli) {
                if (acilBasili) return RC_ACIL_STOP;
                if (HataliDurum()) return RC_GECERSIZ_DURUM;
                if (Mesgul()) return RC_MESGUL;
            }
            double sure; bool alt;
            int rc = SatirIsle(line, false, out sure, out alt);
            if (rc == RC_OK && sure > 0) { mdiBitis = sonZaman + sure; mdiAlt = alt; }
            return rc;
        }
    }

    // Süre gerektiren (makineyi oynatan / meşgul eden) satır mı? Atama, M5, M9, M54/M55, msg anlıktır.
    static bool HareketliMi(string s) {
        string k = s.ToLowerInvariant();
        if (k.Length == 0 || k[0] == '#' || k.StartsWith("msg") || k.StartsWith("warnmsg") || k.StartsWith("dlgmsg") || k.StartsWith("errmsg")) return false;
        if (k.StartsWith("gosub")) return true;
        try {
            foreach (Kelime w in Kelimeler(s)) {
                if (w.H == 'G' && Math.Round(w.D) == 10) return false;
                if (w.H == 'X' || w.H == 'Y' || w.H == 'Z' || w.H == 'A' || w.H == 'B') return true;
                if (w.H == 'G' && Math.Round(w.D) == 4) return true;
                if (w.H == 'M' && Math.Round(w.D) == 6) return true;
            }
        } catch (FormatException) { }
        return false;
    }

    public static int CncSetOutput(int ioId, int value) { lock (kilit) { Tick(); cikis[ioId] = value; return RC_OK; } }
    public static int CncGetState() { lock (kilit) { Tick(); return Durum(); } }
    public static IntPtr CncGetStateText(int state) {
        lock (kilit) {
            if (state >= 0 && state < DurumMetni.Length) return Metin(DurumMetni[state]);
            return Metin("UNKNOWN-" + state.ToString(IC));
        }
    }
    public static IntPtr CncGetRCText(int rc) {
        lock (kilit) {
            if (rc >= 0 && rc < RcMetni.Length) return Metin(RcMetni[rc]);
            if (rc == -1) return Metin("ACIL STOP KILIDI (panel)");
            return Metin("CNC_RC_" + rc.ToString(IC));
        }
    }
    public static int CncGetAllAxesHomed() { lock (kilit) { Tick(); return homed ? 1 : 0; } }
    public static int CncGetCurrentToolNumber() { lock (kilit) { Tick(); return takim; } }
    public static double CncGetActualSpeed() { lock (kilit) { Tick(); return IsMiliHizi(); } }
    public static int CncGetOutput(int ioId) { lock (kilit) { Tick(); int v; return cikis.TryGetValue(ioId, out v) ? v : 0; } }
    public static int CncGetInput(int ioId) { lock (kilit) { Tick(); int v; return giris.TryGetValue(ioId, out v) ? v : 0; } }
    public static int CncGetRunningStatus() { lock (kilit) { Tick(); return isAktif ? 1 : 0; } }
    public static int CncGetPauseStatus() { lock (kilit) { Tick(); return (isAktif && isDurakli) ? 1 : 0; } }
    public static int CncGetEMStopActive() { lock (kilit) { Tick(); return acilBasili ? 1 : 0; } }
    public static int CncGetCurExecLine() {
        lock (kilit) { Tick(); if (isSatir.Length == 0) return 0; int n = isUygulanan; if (n < 1) n = 1; return n; }
    }
    public static int CncReset() {
        lock (kilit) {
            Tick();
            if (!bagli) return RC_BAGLI_DEGIL;
            HepsiniDurdur();
            if (acilBasili) return RC_ACIL_STOP;
            hataVar = false; abortKalici = false; abortBitis = -1;
            return RC_OK;
        }
    }
    public static double CncGetVariable(int varNr) {
        lock (kilit) {
            Tick();
            if (varNr >= 5001 && varNr <= 5005) return IsKonumu(Konum())[varNr - 5001];
            if (varNr >= 5021 && varNr <= 5025) return Konum()[varNr - 5021];
            if (varNr == 5008) return takim;
            return V(varNr);
        }
    }
    public static int CncGetSimulationMode() { return SimSimulasyonModu; }
    public static int CncSetFeedOverride(double factor) {
        lock (kilit) {
            Tick();
            double f = factor > 5 ? factor / 100.0 : factor;
            if (f < 0) f = 0; if (f > 2) f = 2;
            ovr = f; return RC_OK;
        }
    }
    public static double CncGetActualFeedOverride() { lock (kilit) { Tick(); return ovr; } }
    public static Cart CncGetMachinePosition() {
        lock (kilit) { Tick(); double[] p = Konum(); return Kart(p); }
    }
    public static Cart CncGetWorkPosition() {
        lock (kilit) { Tick(); return Kart(IsKonumu(Konum())); }
    }
    static Cart Kart(double[] p) { Cart c = new Cart(); c.X = p[0]; c.Y = p[1]; c.Z = p[2]; c.A = p[3]; c.B = p[4]; return c; }

    public static Cart WorkPos() { return CncGetWorkPosition(); }
    public static Cart MachinePos() { return CncGetMachinePosition(); }

    public static string StateText(int s) { IntPtr p = CncGetStateText(s); return p == IntPtr.Zero ? s.ToString() : Marshal.PtrToStringAnsi(p); }
    public static string RCText(int rc)   { IntPtr p = CncGetRCText(rc);   return p == IntPtr.Zero ? rc.ToString() : Marshal.PtrToStringAnsi(p); }

    // ================================================================== YALNIZ SİMÜLASYONDA OLAN ÜYELER
    // Tanı metni (tek satır, InvariantCulture)
    public static string SimDurum() {
        lock (kilit) {
            Tick();
            double[] m = Konum(); double[] w = IsKonumu(m);
            return string.Format(IC,
                "DEMO durum={0} bagli={1} home={2} T{3} mak=X{4:0.000} Y{5:0.000} Z{6:0.000} A{7:0.000} B{8:0.000} is=X{9:0.000} Y{10:0.000} Z{11:0.000} satir={12}/{13} hiz={14:0.00} S={15:0} acil={16} dosya={17}",
                DurumMetni[Durum()], bagli, homed, takim, m[0], m[1], m[2], m[3], m[4], w[0], w[1], w[2],
                isUygulanan, isSatir.Length, ovr, IsMiliHizi(), acilBasili, Path.GetFileName(isDosya));
        }
    }
    // Makinedeki acil stop butonu (basılıyken iş/hareket durur, CncReset temizleyemez)
    public static void SimAcilStop(bool basili) {
        lock (kilit) { Tick(); acilBasili = basili; if (basili) { HepsiniDurdur(); abortKalici = true; } }
    }
    // Eding iç hatası (INT-ERR); CncReset temizler
    public static void SimHata() { lock (kilit) { Tick(); HepsiniDurdur(); hataVar = true; } }
    public static void SimGiris(int ioId, int value) { lock (kilit) { Tick(); giris[ioId] = value; } }
    public static void SimDegiskenYaz(int varNr, double value) { lock (kilit) { Tick(); deg[varNr] = value; } }
    public static int SimToplamSatir() { lock (kilit) { return isSatir.Length; } }
    // Her şeyi açılış durumuna döndür (testler için)
    public static void SimSifirla() { lock (kilit) { Sifirla(); } }
}
