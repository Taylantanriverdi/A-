// PrimerMill 2 — operatör arayüzü (görünüm katmanı)
// ---------------------------------------------------------------------------
// Bu dosya yalnız GÖRÜNÜM içerir: Eding çağrısı, G-kod üretimi, dosya işlemi YOK.
// Denetleyici (PowerShell) her ~200 ms'de Kabuk.Uygula(MakineDurumu) çağırır;
// kullanıcı eylemleri Kabuk.Komut olayıyla (KomutArgs: Ad, Arg) dışarı verilir.
// İzinler Kabuk.IzinleriUygula(...) ile gelir; görünüm hiçbir eyleme kendi karar vermez.
//
// Derleme kısıtı: C# 5 (Windows PowerShell 5.1 Add-Type), .NET Framework 4.x.
// Başvurular: System, System.Drawing, System.Windows.Forms, System.Core.
// Ayrıntılı sözleşme: ui/ARAYUZ_API.md
// ---------------------------------------------------------------------------
using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Windows.Forms;

namespace PrimerUI
{
    // Veri sözleşmesi (MakineDurumu, KomutArgs, ...) ui/PrimerVeri.cs içindedir (WinForms gerektirmez;
    // denetleyici testleri pwsh ile yalnız onu derler). Add-Type iki dosyayı birlikte derler.

    // =====================================================================
    //  BİÇİM
    // =====================================================================
    public static class Bicim
    {
        public static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
        public static readonly CultureInfo Tr = TrKultur();

        static CultureInfo TrKultur()
        {
            try { return new CultureInfo("tr-TR"); } catch { return CultureInfo.InvariantCulture; }
        }

        public static string Sayi(double v, int ondalik)
        {
            if (double.IsNaN(v)) return "—";
            return v.ToString("F" + ondalik, Inv);
        }
        public static string Sayi(double v) { return Sayi(v, 3); }

        public static string Sure(int sn)
        {
            if (sn < 0) sn = 0;
            int s = sn / 3600, d = (sn / 60) % 60, n = sn % 60;
            return s.ToString(Inv) + ":" + d.ToString("00", Inv) + ":" + n.ToString("00", Inv);
        }

        /// <summary>44812 → "44 812"</summary>
        public static string Binlik(int v)
        {
            string s = Math.Abs(v).ToString(Inv);
            var sb = new StringBuilder();
            for (int i = 0; i < s.Length; i++)
            {
                if (i > 0 && (s.Length - i) % 3 == 0) sb.Append(' ');
                sb.Append(s[i]);
            }
            return (v < 0 ? "-" : "") + sb.ToString();
        }

        /// <summary>Kullanıcı girdisini (virgül ya da nokta) InvariantCulture ile ayrıştırır.</summary>
        public static bool Ayristir(string metin, out double deger)
        {
            deger = 0;
            if (metin == null) return false;
            string t = metin.Trim().Replace(',', '.').Replace(" ", "").Replace(" ", "");
            if (t.Length == 0 || t == "-" || t == ".") return false;
            return double.TryParse(t, NumberStyles.Float, Inv, out deger);
        }

        public static string BuyukHarf(string s)
        {
            if (s == null) return "";
            return s.ToUpper(Tr);
        }
    }

    // =====================================================================
    //  TEMA
    // =====================================================================

    /// <summary>Düğme / öğe renk rolü.</summary>
    public enum Rol { Normal, Basari, Uyari, Tehlike, TehlikeCizgi, Vurgu, Bilgi, Sessiz }

    /// <summary>Tema modu: Koyu, Açık ve iki ilerleme teması (koyu taban; yüzeyler işin ilerlemesine göre kayar):
    /// Geçişli (maviden yeşile), Şafak (gece çivitinden şafak bakırına).</summary>
    public enum TemaModu { Koyu, Acik, Gecisli, Safak }

    /// <summary>İlerleme teması: yüzey belirteçlerinin iki uç paleti (t = 0 ve t = 1) ve ara renk yolu.
    /// Sıra: Zemin, Kart, KartKenar, Dugme, DugmeKenar, Menu, Ayrac, Secili, Golge.</summary>
    public class IlerlemePaleti
    {
        public readonly string Ad;
        public readonly string[] Bas, Son;
        /// <summary>true: OKLCh'de (ton açısı kısa yoldan döner; zıt tonlarda ara renk griye düşmez). false: OKLab'da doğrusal.</summary>
        public readonly bool TonYolu;
        internal double[][] LabA, LabB;
        public IlerlemePaleti(string ad, string[] bas, string[] son, bool tonYolu) { Ad = ad; Bas = bas; Son = son; TonYolu = tonYolu; }
    }

    public static class Tema
    {
        /// <summary>Koyu taban mı (Koyu, Geçişli, Şafak: true). Karışım oranları buna bakar.</summary>
        public static bool Koyu = true;
        public static TemaModu Mod = TemaModu.Koyu;
        /// <summary>İlerleme teması mı (Geçişli, Şafak): yüzeyler GecisT'ye göre hesaplanır, Kabuk yumuşak geçiş zamanlayıcısını çalıştırır.</summary>
        public static bool Ilerlemeli { get { return IlerlemeliMi(Mod); } }
        public static bool IlerlemeliMi(TemaModu m) { return m == TemaModu.Gecisli || m == TemaModu.Safak; }
        /// <summary>İlerleme temasında o an çizilen konum (0 = iş yok / başında, 1 = iş bitti).</summary>
        public static float GecisT;
        /// <summary>Yerleşim katsayısı (1024×768 = 1.0, 1920×1080 ≈ 1.4).</summary>
        public static float S = 1f;
        /// <summary>Ekran DPI / 96.</summary>
        public static float Dpi = 1f;
        public static readonly bool Mono = Type.GetType("Mono.Runtime") != null;

        public static Color Zemin, Kart, KartKenar, Yazi, Soluk, Marka;
        public static Color Hazir, Calisiyor, Duraklatildi, Alarm, Hazirlik, Pasif;
        /// <summary>Türetilmiş: düğme dolgusu, kenar menü zemini, ayraç/iz, seçili zemin.</summary>
        public static Color Dugme, DugmeKenar, Menu, Ayrac, Secili, Golge;

        public static string ArayuzAilesi = "Segoe UI";
        public static string SayiAilesi = "Consolas";

        public static event EventHandler Degisti;

        static Tema()
        {
            AileleriBul();
            Uygula(true);
        }

        static Color H(string hex)
        {
            int v = int.Parse(hex.TrimStart('#'), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
            return Color.FromArgb(255, (v >> 16) & 255, (v >> 8) & 255, v & 255);
        }

        /// <summary>Ayar değeri ("koyu", "acik", "gecisli", "safak"; bilinmeyen = koyu) → mod.</summary>
        public static TemaModu ModCoz(string s)
        {
            string v = (s ?? "").Trim().ToLowerInvariant();
            if (v == "acik" || v == "açık") return TemaModu.Acik;
            if (v == "gecisli" || v == "geçişli") return TemaModu.Gecisli;
            if (v == "safak" || v == "şafak") return TemaModu.Safak;
            return TemaModu.Koyu;
        }
        /// <summary>Mod → ayar değeri ("koyu", "acik", "gecisli", "safak").</summary>
        public static string ModAdi(TemaModu m)
        {
            switch (m)
            {
                case TemaModu.Acik: return "acik";
                case TemaModu.Gecisli: return "gecisli";
                case TemaModu.Safak: return "safak";
                default: return "koyu";
            }
        }

        // ---------- İlerleme temaları (TASARIM.md §5). Yazı/kart kontrastı her noktada Koyu temadakinden düşük değil
        // (Yazi #F3F4F6, Soluk #A0A7B4 ile). Yeni bir ilerleme teması = yeni bir uç paleti çifti.
        /// <summary>Geçişli: mavi (iş yok / başında) → camgöbeği → yeşil (iş bitti); OKLab'da doğrusal.</summary>
        public static readonly IlerlemePaleti GecisliPalet = new IlerlemePaleti("Geçişli",
            new[] { "#08142D", "#0F1F42", "#1E3466", "#16284F", "#27407A", "#0B1836", "#1A2D5A", "#152752", "#040A18" },
            new[] { "#071A11", "#0C281A", "#1B4D33", "#112F21", "#22593D", "#091F15", "#174230", "#123A27", "#030D08" }, false);
        /// <summary>Şafak: gece çiviti/mor (iş yok / başında) → erik → şafak bakırı (iş bitti; marka altınıyla uyumlu); OKLCh'de
        /// (çivit ve bakır zıt tonlar: OKLab'da ortası griye düşerdi, ton açısı erik/kızıl üzerinden döner).</summary>
        public static readonly IlerlemePaleti SafakPalet = new IlerlemePaleti("Şafak",
            new[] { "#0E0B26", "#18133B", "#2C2563", "#211B4A", "#362E72", "#120E2F", "#272056", "#221C4D", "#06041A" },
            new[] { "#1B1007", "#2A1A0D", "#57381C", "#352112", "#64421F", "#22150A", "#4A2F17", "#3A2513", "#0D0703" }, true);

        /// <summary>Etkin modun ilerleme paleti (ilerleme teması değilse null).</summary>
        public static IlerlemePaleti EtkinPalet { get { return Mod == TemaModu.Safak ? SafakPalet : Mod == TemaModu.Gecisli ? GecisliPalet : null; } }

        /// <summary>İlerleme temasında yüzey belirteçlerini t'ye (0..1) göre etkin paletin iki ucu arasından hesaplar (ara renklerin hepsi).
        /// Olay (Degisti) tetiklemez; çağıran yeniden boyar. Dönüş: 8 bitlik renklerden biri değişti mi (değişmediyse boyamaya gerek yok).</summary>
        public static bool GecisAyarla(float t)
        {
            if (t < 0) t = 0; if (t > 1) t = 1;
            GecisT = t;
            var c = PaletRenkleri(EtkinPalet, t);
            if (c == null) return false;
            bool degisti = Zemin != c[0] || Kart != c[1] || KartKenar != c[2] || Dugme != c[3] || DugmeKenar != c[4] || Menu != c[5] || Ayrac != c[6] || Secili != c[7] || Golge != c[8];
            Zemin = c[0]; Kart = c[1]; KartKenar = c[2]; Dugme = c[3]; DugmeKenar = c[4]; Menu = c[5]; Ayrac = c[6]; Secili = c[7]; Golge = c[8];
            return degisti;
        }

        /// <summary>İlerleme teması (Geçişli, Şafak) eşlemesi: iş bitti → 1; iş sürüyor / duraklatıldı → Yuzde/100; değilse 0.</summary>
        public static float GecisHedefi(MakineDurumu d)
        {
            if (d == null) return 0f;
            if (d.IsTamamlandi) return 1f;
            if (d.IsAktif && (d.Durum == Durum.Calisiyor || d.Durum == Durum.Duraklatildi))
            {
                double y = d.Yuzde / 100.0;
                if (double.IsNaN(y) || y < 0) y = 0; if (y > 1) y = 1;
                return (float)y;
            }
            return 0f;
        }

        /// <summary>Paletin t noktasındaki 9 yüzey rengi (saf hesap; WinForms gerektirmez).</summary>
        public static Color[] PaletRenkleri(IlerlemePaleti p, float t)
        {
            if (p == null) return null;
            if (t < 0) t = 0; if (t > 1) t = 1;
            if (p.LabA == null)
            {
                var la = new double[p.Bas.Length][]; var lb = new double[p.Son.Length][];
                for (int i = 0; i < la.Length; i++) { la[i] = OkLab(H(p.Bas[i])); lb[i] = OkLab(H(p.Son[i])); }
                p.LabB = lb; p.LabA = la;
            }
            var c = new Color[p.Bas.Length];
            for (int i = 0; i < c.Length; i++)
            {
                double[] a = p.LabA[i], b = p.LabB[i];
                double L = a[0] + (b[0] - a[0]) * t, x, y;
                if (p.TonYolu)
                {
                    double ca = Math.Sqrt(a[1] * a[1] + a[2] * a[2]), cb = Math.Sqrt(b[1] * b[1] + b[2] * b[2]);
                    double ha = Math.Atan2(a[2], a[1]), hb = Math.Atan2(b[2], b[1]);
                    double dh = hb - ha;
                    while (dh > Math.PI) dh -= 2 * Math.PI;
                    while (dh < -Math.PI) dh += 2 * Math.PI;
                    double C = ca + (cb - ca) * t, h = ha + dh * t;
                    x = C * Math.Cos(h); y = C * Math.Sin(h);
                }
                else { x = a[1] + (b[1] - a[1]) * t; y = a[2] + (b[2] - a[2]) * t; }
                c[i] = OkLabRenk(L, x, y);
            }
            return c;
        }

        static double[] OkLab(Color c)
        {
            double r = Lin(c.R), g = Lin(c.G), b = Lin(c.B);
            double l = Math.Pow(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 1.0 / 3);
            double m = Math.Pow(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 1.0 / 3);
            double s = Math.Pow(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b, 1.0 / 3);
            return new[] {
                0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
                1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
                0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s };
        }
        static Color OkLabRenk(double L, double a, double b)
        {
            double l = L + 0.3963377774 * a + 0.2158037573 * b; l = l * l * l;
            double m = L - 0.1055613458 * a - 0.0638541728 * b; m = m * m * m;
            double s = L - 0.0894841775 * a - 1.2914855480 * b; s = s * s * s;
            return Color.FromArgb(255,
                Sifrele(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
                Sifrele(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
                Sifrele(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s));
        }
        static int Sifrele(double v)
        {
            if (v < 0) v = 0; if (v > 1) v = 1;
            v = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.Pow(v, 1 / 2.4) - 0.055;
            return Math.Max(0, Math.Min(255, (int)Math.Round(v * 255)));
        }

        public static void Uygula(bool koyu) { Uygula(koyu ? TemaModu.Koyu : TemaModu.Acik); }

        public static void Uygula(TemaModu mod)
        {
            Mod = mod;
            bool koyu = mod != TemaModu.Acik;
            Koyu = koyu;
            if (koyu)
            {
                Zemin = H("#0E1014"); Kart = H("#171A21"); KartKenar = H("#262B35");
                Yazi = H("#E5E7EB"); Soluk = H("#8C929E"); Marka = H("#D4AF37");
                Hazir = H("#22C55E"); Calisiyor = H("#3B82F6"); Duraklatildi = H("#F59E0B");
                Alarm = H("#EF4444"); Hazirlik = H("#A78BFA"); Pasif = H("#6B7280");
                Dugme = H("#1E222B"); DugmeKenar = H("#2F3541"); Menu = H("#12151B");
                Ayrac = H("#232833"); Secili = H("#202530"); Golge = H("#08090C");
            }
            else
            {
                Zemin = H("#F3F4F6"); Kart = H("#FFFFFF"); KartKenar = H("#E5E7EB");
                Yazi = H("#111827"); Soluk = H("#4B5563"); Marka = H("#A16207");
                Hazir = H("#15803D"); Calisiyor = H("#1D4ED8"); Duraklatildi = H("#B45309");
                Alarm = H("#B91C1C"); Hazirlik = H("#6D28D9"); Pasif = H("#6B7280");
                Dugme = H("#F9FAFB"); DugmeKenar = H("#D1D5DB"); Menu = H("#FFFFFF");
                Ayrac = H("#E5E7EB"); Secili = H("#EEF0F3"); Golge = H("#D1D5DB");
            }
            if (IlerlemeliMi(mod))
            {
                // Koyu temanın yazı/durum/marka renkleri; yazı bir tık parlak (renkli yüzeyde kontrast Koyu'dan düşmesin)
                Yazi = H("#F3F4F6"); Soluk = H("#A0A7B4");
                GecisAyarla(GecisT);
            }
            var h = Degisti; if (h != null) h(null, EventArgs.Empty);
        }

        public static Color DurumRengi(Durum d)
        {
            switch (d)
            {
                case Durum.Hazir: return Hazir;
                case Durum.Calisiyor: return Calisiyor;
                case Durum.Duraklatildi: return Duraklatildi;
                case Durum.Alarm: return Alarm;
                case Durum.Hazirlik: return Hazirlik;
                default: return Pasif;
            }
        }

        public static string DurumAdi(Durum d)
        {
            switch (d)
            {
                case Durum.Hazir: return "HAZIR";
                case Durum.Calisiyor: return "ÇALIŞIYOR";
                case Durum.Duraklatildi: return "DURAKLATILDI";
                case Durum.Alarm: return "ALARM";
                case Durum.Hazirlik: return "HAZIRLIK";
                default: return "PASİF";
            }
        }

        public static Color TurRengi(MesajTuru t)
        {
            switch (t)
            {
                case MesajTuru.Basari: return Hazir;
                case MesajTuru.Uyari: return Duraklatildi;
                case MesajTuru.Hata: return Alarm;
                default: return Soluk;
            }
        }

        public static Color RolRengi(Rol r)
        {
            switch (r)
            {
                case Rol.Basari: return Hazir;
                case Rol.Uyari: return Duraklatildi;
                case Rol.Tehlike:
                case Rol.TehlikeCizgi: return Alarm;
                case Rol.Vurgu: return Marka;
                case Rol.Bilgi: return Calisiyor;
                default: return Yazi;
            }
        }

        public static Color Karistir(Color a, Color b, float t)
        {
            if (t < 0) t = 0; if (t > 1) t = 1;
            return Color.FromArgb(255,
                (int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t));
        }

        public static Color Koyulastir(Color c, float f) { return Karistir(c, Color.Black, f); }
        public static Color Acilastir(Color c, float f) { return Karistir(c, Color.White, f); }
        public static Color Alfa(Color c, int a) { return Color.FromArgb(Math.Max(0, Math.Min(255, a)), c.R, c.G, c.B); }

        /// <summary>Basılı durum: koyu temada 1 kademe koyu, açık temada 1 kademe koyu.</summary>
        public static Color Basili(Color c) { return Koyulastir(c, 0.18f); }

        /// <summary>Dolgu üzerindeki yazı rengi (kontrasta göre siyah ya da beyaz).</summary>
        public static Color UstYazi(Color dolgu)
        {
            double l = 0.2126 * Lin(dolgu.R) + 0.7152 * Lin(dolgu.G) + 0.0722 * Lin(dolgu.B);
            return l > 0.30 ? H("#0B0D10") : Color.White;
        }
        static double Lin(int c) { double v = c / 255.0; return v <= 0.03928 ? v / 12.92 : Math.Pow((v + 0.055) / 1.055, 2.4); }

        /// <summary>Pasif görünüm: renk %35 opaklıkla yüzeyin üstünde.</summary>
        public static Color Pasiflestir(Color c, Color yuzey) { return Karistir(yuzey, c, 0.35f); }

        // ---------- ölçek
        public static int Px(float v) { return (int)Math.Round(v * S * Dpi); }
        public static float PxF(float v) { return v * S * Dpi; }

        /// <summary>İstemci boyutundan (piksel) yerleşim katsayısını hesaplar.</summary>
        public static float KatsayiHesapla(int genislik, int yukseklik)
        {
            float g = genislik / Dpi, y = yukseklik / Dpi;
            float s = Math.Min(g / 1024f, y / 768f);
            if (s < 0.80f) s = 0.80f;
            if (s > 1.70f) s = 1.70f;
            return (float)Math.Round(s, 2);
        }

        // ---------- yazı tipleri
        static readonly Dictionary<string, Font> onbellek = new Dictionary<string, Font>();

        static void AileleriBul()
        {
            try
            {
                var adlar = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                using (var ifc = new InstalledFontCollection())
                    foreach (var f in ifc.Families) adlar.Add(f.Name);
                ArayuzAilesi = Ilk(adlar, new[] { "Segoe UI", "DejaVu Sans", "Arial" }, FontFamily.GenericSansSerif.Name);
                SayiAilesi = Ilk(adlar, new[] { "Consolas", "DejaVu Sans Mono", "Courier New" }, FontFamily.GenericMonospace.Name);
            }
            catch { ArayuzAilesi = FontFamily.GenericSansSerif.Name; SayiAilesi = FontFamily.GenericMonospace.Name; }
        }
        static string Ilk(HashSet<string> adlar, string[] adaylar, string yedek)
        {
            foreach (var a in adaylar) if (adlar.Contains(a)) return a;
            return yedek;
        }

        static Font Al(string aile, float pt, FontStyle st)
        {
            float boy = (float)Math.Round(pt * S, 1);
            if (boy < 6) boy = 6;
            string k = aile + "|" + boy.ToString(CultureInfo.InvariantCulture) + "|" + (int)st;
            Font f;
            if (!onbellek.TryGetValue(k, out f))
            {
                try { f = new Font(aile, boy, st, GraphicsUnit.Point); }
                catch { f = new Font(FontFamily.GenericSansSerif, boy, st, GraphicsUnit.Point); }
                onbellek[k] = f;
            }
            return f;
        }

        /// <summary>Arayüz yazı tipi (pt, 1024×768 tabanında; ölçekle büyür).</summary>
        public static Font F(float pt) { return Al(ArayuzAilesi, pt, FontStyle.Regular); }
        public static Font F(float pt, bool kalin) { return Al(ArayuzAilesi, pt, kalin ? FontStyle.Bold : FontStyle.Regular); }
        /// <summary>Sabit genişlikli sayı yazı tipi.</summary>
        public static Font Sayi(float pt) { return Al(SayiAilesi, pt, FontStyle.Regular); }
        public static Font Sayi(float pt, bool kalin) { return Al(SayiAilesi, pt, kalin ? FontStyle.Bold : FontStyle.Regular); }
        /// <summary>Ölçekten bağımsız (mutlak) boyutlu yazı tipi.</summary>
        public static Font Mutlak(float pt, bool kalin, bool sayi)
        {
            float eski = S; S = 1f;
            try { return Al(sayi ? SayiAilesi : ArayuzAilesi, pt, kalin ? FontStyle.Bold : FontStyle.Regular); }
            finally { S = eski; }
        }

        // ---------- çizim yardımcıları
        public static GraphicsPath Yuvarlak(RectangleF r, float yaricap)
        {
            var p = new GraphicsPath();
            float d = Math.Min(yaricap * 2, Math.Min(r.Width, r.Height));
            if (d <= 1) { p.AddRectangle(r); return p; }
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        public static void Hazirla(Graphics g)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.TextRenderingHint = Mono ? TextRenderingHint.AntiAlias : TextRenderingHint.ClearTypeGridFit;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        }

        public static void YuvarlakDoldur(Graphics g, RectangleF r, float yr, Color dolgu)
        {
            using (var p = Yuvarlak(r, yr)) using (var b = new SolidBrush(dolgu)) g.FillPath(b, p);
        }
        public static void YuvarlakCiz(Graphics g, RectangleF r, float yr, Color kenar, float kalinlik)
        {
            using (var p = Yuvarlak(r, yr)) using (var pen = new Pen(kenar, kalinlik)) g.DrawPath(pen, p);
        }

        /// <summary>Metni dikdörtgene yazar. tekSatir=true ise taşan kısım "…" olur.</summary>
        public static void Yaz(Graphics g, string s, Font f, Color c, RectangleF r, StringAlignment yatay, StringAlignment dikey, bool tekSatir)
        {
            if (string.IsNullOrEmpty(s) || r.Width <= 2 || r.Height <= 2) return;
            // Olc() ile aynı biçim (GenericTypographic): Windows GDI+ varsayılan biçimi her iki yana dolgu ekler,
            // ölçülen kutuya sığmaz ve 'HOME' -> 'HO...' kesilirdi (Mono'da görünmez).
            using (var sf = new StringFormat(StringFormat.GenericTypographic))
            using (var b = new SolidBrush(c))
            {
                sf.Alignment = yatay; sf.LineAlignment = dikey;
                sf.Trimming = StringTrimming.EllipsisCharacter;
                // GenericTypographic'in LineLimit/NoClip/FitBlackBox bayraklari atilir (dolgusuz yerlesim kalir):
                // LineLimit tek satirda kutu yuksekligi satirdan azsa metni hic cizmez.
                sf.FormatFlags = tekSatir ? StringFormatFlags.NoWrap : StringFormatFlags.LineLimit;
                g.DrawString(s, f, b, r, sf);
            }
        }
        public static void Yaz(Graphics g, string s, Font f, Color c, RectangleF r)
        {
            Yaz(g, s, f, c, r, StringAlignment.Near, StringAlignment.Center, true);
        }

        public static SizeF Olc(Graphics g, string s, Font f)
        {
            if (string.IsNullOrEmpty(s)) return SizeF.Empty;
            using (var sf = new StringFormat(StringFormat.GenericTypographic))
            {
                sf.FormatFlags |= StringFormatFlags.MeasureTrailingSpaces;
                var z = g.MeasureString(s, f, new PointF(0, 0), sf);
                return z;
            }
        }
        public static SizeF Olc(Graphics g, string s, Font f, int genislik)
        {
            if (string.IsNullOrEmpty(s)) return SizeF.Empty;
            return g.MeasureString(s, f, Math.Max(1, genislik));
        }

        /// <summary>Metni sığdıracak en büyük yazı boyunu bulur (enBuyuk pt'den aşağı).</summary>
        public static Font Sigdir(Graphics g, string s, bool sayi, bool kalin, float enBuyukPt, float enKucukPt, SizeF alan)
        {
            float pt = enBuyukPt;
            while (true)
            {
                Font f = sayi ? Sayi(pt, kalin) : F(pt, kalin);
                var z = Olc(g, s, f);
                if ((z.Width <= alan.Width && z.Height <= alan.Height * 1.08f) || pt <= enKucukPt) return f;
                pt -= Math.Max(0.5f, pt * 0.08f);
                if (pt < enKucukPt) pt = enKucukPt;
            }
        }
    }

    // =====================================================================
    //  SİMGELER (vektörel; simge yazı tipine bağımlı değil)
    // =====================================================================
    public enum Simge
    {
        Yok, Oynat, Duraklat, Durdur, Klasor, Takim, Temizlik, Ev, Park, Ayar, Liste, Hedef, Uzak,
        Uretim, Uyari, Bilgi, Kilit, KilitAcik, Arti, Eksi, Sol, Sag, Yukari, Asagi, Tamam, Kapat,
        Klavye, Buyut, Disk, Olcum, Pens, Hava, Yenile, Prob, Kaydet, Terminal, Telefon, IsMili, Yedek,
        Saat, Blok, Konum, Hiz, Guc
    }

    public static class Ikon
    {
        public static void Ciz(Graphics g, Simge s, RectangleF r, Color c)
        {
            if (s == Simge.Yok) return;
            float m = Math.Min(r.Width, r.Height);
            var q = new RectangleF(r.X + (r.Width - m) / 2, r.Y + (r.Height - m) / 2, m, m);
            float w = Math.Max(1.4f, m * 0.085f);
            var eski = g.SmoothingMode;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var p = new Pen(c, w))
            using (var b = new SolidBrush(c))
            {
                p.StartCap = LineCap.Round; p.EndCap = LineCap.Round; p.LineJoin = LineJoin.Round;
                float x = q.X, y = q.Y;
                Func<float, float> X = t => x + t * m;
                Func<float, float> Y = t => y + t * m;
                switch (s)
                {
                    case Simge.Oynat:
                        g.FillPolygon(b, new[] { new PointF(X(.26f), Y(.16f)), new PointF(X(.84f), Y(.5f)), new PointF(X(.26f), Y(.84f)) });
                        break;
                    case Simge.Duraklat:
                        Tema.YuvarlakDoldur(g, new RectangleF(X(.22f), Y(.16f), m * .2f, m * .68f), m * .05f, c);
                        Tema.YuvarlakDoldur(g, new RectangleF(X(.58f), Y(.16f), m * .2f, m * .68f), m * .05f, c);
                        break;
                    case Simge.Durdur:
                        Tema.YuvarlakDoldur(g, new RectangleF(X(.2f), Y(.2f), m * .6f, m * .6f), m * .08f, c);
                        break;
                    case Simge.Klasor:
                        g.DrawLines(p, new[] { new PointF(X(.1f), Y(.8f)), new PointF(X(.1f), Y(.22f)), new PointF(X(.38f), Y(.22f)),
                            new PointF(X(.46f), Y(.32f)), new PointF(X(.9f), Y(.32f)), new PointF(X(.9f), Y(.8f)), new PointF(X(.1f), Y(.8f)) });
                        g.DrawLine(p, X(.1f), Y(.44f), X(.9f), Y(.44f));
                        break;
                    case Simge.Takim:
                        g.DrawLine(p, X(.15f), Y(.36f), X(.82f), Y(.36f));
                        g.DrawLines(p, new[] { new PointF(X(.66f), Y(.2f)), new PointF(X(.84f), Y(.36f)), new PointF(X(.66f), Y(.52f)) });
                        g.DrawLine(p, X(.85f), Y(.66f), X(.18f), Y(.66f));
                        g.DrawLines(p, new[] { new PointF(X(.34f), Y(.5f)), new PointF(X(.16f), Y(.66f)), new PointF(X(.34f), Y(.82f)) });
                        break;
                    case Simge.Temizlik:
                        Yildiz(g, b, X(.38f), Y(.42f), m * .3f);
                        Yildiz(g, b, X(.74f), Y(.26f), m * .16f);
                        Yildiz(g, b, X(.72f), Y(.72f), m * .2f);
                        break;
                    case Simge.Ev:
                        g.DrawLines(p, new[] { new PointF(X(.12f), Y(.48f)), new PointF(X(.5f), Y(.14f)), new PointF(X(.88f), Y(.48f)) });
                        g.DrawLines(p, new[] { new PointF(X(.22f), Y(.4f)), new PointF(X(.22f), Y(.86f)), new PointF(X(.78f), Y(.86f)), new PointF(X(.78f), Y(.4f)) });
                        g.DrawLines(p, new[] { new PointF(X(.42f), Y(.86f)), new PointF(X(.42f), Y(.62f)), new PointF(X(.58f), Y(.62f)), new PointF(X(.58f), Y(.86f)) });
                        break;
                    case Simge.Park:
                        g.DrawEllipse(p, X(.1f), Y(.1f), m * .8f, m * .8f);
                        g.DrawLine(p, X(.4f), Y(.72f), X(.4f), Y(.28f));
                        g.DrawArc(p, X(.3f), Y(.28f), m * .32f, m * .24f, -90, 180);
                        g.DrawLine(p, X(.4f), Y(.28f), X(.46f), Y(.28f));
                        g.DrawLine(p, X(.4f), Y(.52f), X(.46f), Y(.52f));
                        break;
                    case Simge.Ayar:
                        Disli(g, p, X(.5f), Y(.5f), m * .4f, m * .29f, m * .13f);
                        break;
                    case Simge.Liste:
                        for (int i = 0; i < 3; i++)
                        {
                            float yy = Y(.26f + i * .24f);
                            g.FillEllipse(b, X(.12f) - w * .6f, yy - w * .6f, w * 1.6f, w * 1.6f);
                            g.DrawLine(p, X(.32f), yy, X(.88f), yy);
                        }
                        break;
                    case Simge.Hedef:
                        g.DrawEllipse(p, X(.18f), Y(.18f), m * .64f, m * .64f);
                        g.FillEllipse(b, X(.42f), Y(.42f), m * .16f, m * .16f);
                        g.DrawLine(p, X(.5f), Y(.04f), X(.5f), Y(.24f)); g.DrawLine(p, X(.5f), Y(.76f), X(.5f), Y(.96f));
                        g.DrawLine(p, X(.04f), Y(.5f), X(.24f), Y(.5f)); g.DrawLine(p, X(.76f), Y(.5f), X(.96f), Y(.5f));
                        break;
                    case Simge.Uzak:
                        g.DrawArc(p, X(.08f), Y(.22f), m * .84f, m * .84f, 225, 90);
                        g.DrawArc(p, X(.24f), Y(.38f), m * .52f, m * .52f, 225, 90);
                        g.FillEllipse(b, X(.42f), Y(.7f), m * .16f, m * .16f);
                        break;
                    case Simge.Uretim:
                        Tema.YuvarlakCiz(g, new RectangleF(X(.1f), Y(.1f), m * .8f, m * .8f), m * .14f, c, w);
                        g.FillPolygon(b, new[] { new PointF(X(.4f), Y(.32f)), new PointF(X(.7f), Y(.5f)), new PointF(X(.4f), Y(.68f)) });
                        break;
                    case Simge.Uyari:
                        g.DrawPolygon(p, new[] { new PointF(X(.5f), Y(.1f)), new PointF(X(.92f), Y(.86f)), new PointF(X(.08f), Y(.86f)) });
                        g.DrawLine(p, X(.5f), Y(.38f), X(.5f), Y(.6f));
                        g.FillEllipse(b, X(.5f) - w * .7f, Y(.72f) - w * .7f, w * 1.4f, w * 1.4f);
                        break;
                    case Simge.Bilgi:
                        g.DrawEllipse(p, X(.1f), Y(.1f), m * .8f, m * .8f);
                        g.DrawLine(p, X(.5f), Y(.46f), X(.5f), Y(.72f));
                        g.FillEllipse(b, X(.5f) - w * .7f, Y(.3f) - w * .7f, w * 1.4f, w * 1.4f);
                        break;
                    case Simge.Kilit:
                    case Simge.KilitAcik:
                        Tema.YuvarlakDoldur(g, new RectangleF(X(.2f), Y(.44f), m * .6f, m * .44f), m * .06f, c);
                        if (s == Simge.Kilit) g.DrawArc(p, X(.32f), Y(.14f), m * .36f, m * .5f, 180, 180);
                        else g.DrawArc(p, X(.46f), Y(.1f), m * .36f, m * .5f, 180, 160);
                        g.DrawLine(p, X(.32f), Y(.39f), X(.32f), Y(.46f));
                        break;
                    case Simge.Arti:
                        g.DrawLine(p, X(.5f), Y(.18f), X(.5f), Y(.82f)); g.DrawLine(p, X(.18f), Y(.5f), X(.82f), Y(.5f));
                        break;
                    case Simge.Eksi:
                        g.DrawLine(p, X(.18f), Y(.5f), X(.82f), Y(.5f));
                        break;
                    case Simge.Sol:
                        g.DrawLines(p, new[] { new PointF(X(.62f), Y(.18f)), new PointF(X(.3f), Y(.5f)), new PointF(X(.62f), Y(.82f)) });
                        break;
                    case Simge.Sag:
                        g.DrawLines(p, new[] { new PointF(X(.38f), Y(.18f)), new PointF(X(.7f), Y(.5f)), new PointF(X(.38f), Y(.82f)) });
                        break;
                    case Simge.Yukari:
                        g.DrawLines(p, new[] { new PointF(X(.18f), Y(.64f)), new PointF(X(.5f), Y(.3f)), new PointF(X(.82f), Y(.64f)) });
                        break;
                    case Simge.Asagi:
                        g.DrawLines(p, new[] { new PointF(X(.18f), Y(.36f)), new PointF(X(.5f), Y(.7f)), new PointF(X(.82f), Y(.36f)) });
                        break;
                    case Simge.Tamam:
                        g.DrawLines(p, new[] { new PointF(X(.16f), Y(.52f)), new PointF(X(.4f), Y(.76f)), new PointF(X(.86f), Y(.26f)) });
                        break;
                    case Simge.Kapat:
                        g.DrawLine(p, X(.22f), Y(.22f), X(.78f), Y(.78f)); g.DrawLine(p, X(.78f), Y(.22f), X(.22f), Y(.78f));
                        break;
                    case Simge.Klavye:
                        Tema.YuvarlakCiz(g, new RectangleF(X(.06f), Y(.24f), m * .88f, m * .52f), m * .08f, c, w);
                        for (int i = 0; i < 4; i++) g.FillRectangle(b, X(.2f + i * .18f) - w * .5f, Y(.4f), w * 1.2f, w * 1.2f);
                        g.DrawLine(p, X(.3f), Y(.6f), X(.7f), Y(.6f));
                        break;
                    case Simge.Buyut:
                        g.DrawLines(p, new[] { new PointF(X(.14f), Y(.38f)), new PointF(X(.14f), Y(.14f)), new PointF(X(.38f), Y(.14f)) });
                        g.DrawLines(p, new[] { new PointF(X(.62f), Y(.14f)), new PointF(X(.86f), Y(.14f)), new PointF(X(.86f), Y(.38f)) });
                        g.DrawLines(p, new[] { new PointF(X(.86f), Y(.62f)), new PointF(X(.86f), Y(.86f)), new PointF(X(.62f), Y(.86f)) });
                        g.DrawLines(p, new[] { new PointF(X(.38f), Y(.86f)), new PointF(X(.14f), Y(.86f)), new PointF(X(.14f), Y(.62f)) });
                        break;
                    case Simge.Disk:
                    case Simge.Blok:
                        g.DrawEllipse(p, X(.1f), Y(.1f), m * .8f, m * .8f);
                        g.DrawEllipse(p, X(.36f), Y(.36f), m * .28f, m * .28f);
                        if (s == Simge.Blok) g.DrawLine(p, X(.5f), Y(.1f), X(.5f), Y(.24f));
                        break;
                    case Simge.Olcum:
                        g.DrawLine(p, X(.18f), Y(.1f), X(.18f), Y(.9f));
                        for (int i = 0; i < 5; i++) g.DrawLine(p, X(.18f), Y(.16f + i * .17f), X(i % 2 == 0 ? .5f : .38f), Y(.16f + i * .17f));
                        g.DrawLines(p, new[] { new PointF(X(.72f), Y(.18f)), new PointF(X(.72f), Y(.82f)) });
                        g.DrawLines(p, new[] { new PointF(X(.62f), Y(.3f)), new PointF(X(.72f), Y(.18f)), new PointF(X(.82f), Y(.3f)) });
                        g.DrawLines(p, new[] { new PointF(X(.62f), Y(.7f)), new PointF(X(.72f), Y(.82f)), new PointF(X(.82f), Y(.7f)) });
                        break;
                    case Simge.Pens:
                        g.DrawLines(p, new[] { new PointF(X(.24f), Y(.12f)), new PointF(X(.24f), Y(.5f)), new PointF(X(.42f), Y(.88f)) });
                        g.DrawLines(p, new[] { new PointF(X(.76f), Y(.12f)), new PointF(X(.76f), Y(.5f)), new PointF(X(.58f), Y(.88f)) });
                        g.DrawLine(p, X(.24f), Y(.3f), X(.76f), Y(.3f));
                        break;
                    case Simge.Hava:
                        g.DrawBezier(p, X(.08f), Y(.32f), X(.4f), Y(.32f), X(.62f), Y(.32f), X(.7f), Y(.2f));
                        g.DrawBezier(p, X(.08f), Y(.52f), X(.5f), Y(.52f), X(.8f), Y(.52f), X(.9f), Y(.4f));
                        g.DrawBezier(p, X(.08f), Y(.72f), X(.36f), Y(.72f), X(.56f), Y(.72f), X(.62f), Y(.84f));
                        break;
                    case Simge.Yenile:
                        g.DrawArc(p, X(.16f), Y(.16f), m * .68f, m * .68f, -60, 300);
                        g.FillPolygon(b, new[] { new PointF(X(.72f), Y(.06f)), new PointF(X(.86f), Y(.34f)), new PointF(X(.56f), Y(.32f)) });
                        break;
                    case Simge.Prob:
                        g.DrawLine(p, X(.5f), Y(.08f), X(.5f), Y(.62f));
                        g.FillEllipse(b, X(.4f), Y(.58f), m * .2f, m * .2f);
                        g.DrawLine(p, X(.12f), Y(.88f), X(.88f), Y(.88f));
                        break;
                    case Simge.Kaydet:
                        Tema.YuvarlakCiz(g, new RectangleF(X(.14f), Y(.14f), m * .72f, m * .72f), m * .08f, c, w);
                        g.DrawRectangle(p, X(.32f), Y(.14f), m * .36f, m * .2f);
                        g.DrawRectangle(p, X(.3f), Y(.56f), m * .4f, m * .3f);
                        break;
                    case Simge.Terminal:
                        Tema.YuvarlakCiz(g, new RectangleF(X(.08f), Y(.16f), m * .84f, m * .68f), m * .08f, c, w);
                        g.DrawLines(p, new[] { new PointF(X(.24f), Y(.36f)), new PointF(X(.38f), Y(.5f)), new PointF(X(.24f), Y(.64f)) });
                        g.DrawLine(p, X(.46f), Y(.66f), X(.7f), Y(.66f));
                        break;
                    case Simge.Telefon:
                        Tema.YuvarlakCiz(g, new RectangleF(X(.28f), Y(.06f), m * .44f, m * .88f), m * .08f, c, w);
                        g.DrawLine(p, X(.44f), Y(.8f), X(.56f), Y(.8f));
                        break;
                    case Simge.IsMili:
                        g.DrawRectangle(p, X(.3f), Y(.08f), m * .4f, m * .36f);
                        g.DrawLines(p, new[] { new PointF(X(.36f), Y(.44f)), new PointF(X(.44f), Y(.66f)), new PointF(X(.56f), Y(.66f)), new PointF(X(.64f), Y(.44f)) });
                        g.DrawLine(p, X(.5f), Y(.66f), X(.5f), Y(.92f));
                        break;
                    case Simge.Yedek:
                        g.DrawArc(p, X(.12f), Y(.14f), m * .76f, m * .24f, 0, 360);
                        g.DrawLine(p, X(.12f), Y(.26f), X(.12f), Y(.74f)); g.DrawLine(p, X(.88f), Y(.26f), X(.88f), Y(.74f));
                        g.DrawArc(p, X(.12f), Y(.62f), m * .76f, m * .24f, 0, 180);
                        g.DrawArc(p, X(.12f), Y(.38f), m * .76f, m * .24f, 0, 180);
                        break;
                    case Simge.Saat:
                        g.DrawEllipse(p, X(.1f), Y(.1f), m * .8f, m * .8f);
                        g.DrawLines(p, new[] { new PointF(X(.5f), Y(.26f)), new PointF(X(.5f), Y(.5f)), new PointF(X(.68f), Y(.62f)) });
                        break;
                    case Simge.Guc:
                        g.DrawArc(p, X(.16f), Y(.18f), m * .68f, m * .68f, -50, 280);
                        g.DrawLine(p, X(.5f), Y(.08f), X(.5f), Y(.46f));
                        break;
                    case Simge.Konum:
                        g.DrawEllipse(p, X(.3f), Y(.12f), m * .4f, m * .4f);
                        g.DrawLine(p, X(.5f), Y(.52f), X(.5f), Y(.9f));
                        g.DrawLine(p, X(.24f), Y(.9f), X(.76f), Y(.9f));
                        break;
                    case Simge.Hiz:
                        g.DrawArc(p, X(.1f), Y(.18f), m * .8f, m * .8f, 180, 180);
                        g.DrawLine(p, X(.5f), Y(.58f), X(.74f), Y(.34f));
                        g.FillEllipse(b, X(.44f), Y(.52f), m * .12f, m * .12f);
                        break;
                }
            }
            g.SmoothingMode = eski;
        }

        static void Yildiz(Graphics g, Brush b, float cx, float cy, float r)
        {
            var pts = new PointF[8];
            for (int i = 0; i < 8; i++)
            {
                double a = Math.PI / 4 * i - Math.PI / 2;
                float rr = (i % 2 == 0) ? r : r * 0.28f;
                pts[i] = new PointF(cx + (float)Math.Cos(a) * rr, cy + (float)Math.Sin(a) * rr);
            }
            g.FillPolygon(b, pts);
        }

        static void Disli(Graphics g, Pen p, float cx, float cy, float rDis, float rIc, float rDelik)
        {
            int dis = 8;
            var pts = new List<PointF>();
            for (int i = 0; i < dis * 2; i++)
            {
                double a0 = Math.PI * 2 * i / (dis * 2);
                double a1 = Math.PI * 2 * (i + 1) / (dis * 2);
                float r = (i % 2 == 0) ? rDis : rIc;
                pts.Add(new PointF(cx + (float)Math.Cos(a0 + 0.08) * r, cy + (float)Math.Sin(a0 + 0.08) * r));
                pts.Add(new PointF(cx + (float)Math.Cos(a1 - 0.08) * r, cy + (float)Math.Sin(a1 - 0.08) * r));
            }
            g.DrawPolygon(p, pts.ToArray());
            g.DrawEllipse(p, cx - rDelik, cy - rDelik, rDelik * 2, rDelik * 2);
        }
    }

    // =====================================================================
    //  KOMUT YOLU ve İZİNLER
    // =====================================================================

    /// <summary>Kontrollerin komutları Kabuk'a ilettiği iç yol. Dışarıdan Kabuk.Komut kullanın.</summary>
    public static class KomutYolu
    {
        public static event Action<string, string> Gonderildi;
        public static event Action<string> NedenIstendi;

        public static void Gonder(string ad, string arg)
        {
            if (string.IsNullOrEmpty(ad)) return;
            var h = Gonderildi;
            if (h != null) h(ad, arg ?? "");
        }

        public static void NedenGoster(string neden)
        {
            var h = NedenIstendi;
            if (h != null) h(string.IsNullOrEmpty(neden) ? "Bu işlem şu an kullanılamaz." : neden);
        }
    }

    /// <summary>Komut kaynağı: izin tablosu değişince kendini yeniler.</summary>
    public interface IKomutKaynagi { void IzinYenile(); }
    /// <summary>Ölçek (Tema.S) değişince boyutlarını yeniden hesaplayan kontrol.</summary>
    public interface IOlcekli { void Olcekle(); }

    /// <summary>
    /// Denetleyicinin verdiği izin tablosu. Arama sırası: "ad:arg", "ad", en uzun "önek.*".
    /// Tabloda olmayan komut izinlidir.
    /// </summary>
    public static class Izinler
    {
        static Dictionary<string, bool> izin = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        static Dictionary<string, string> neden = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        public static void Ayarla(IDictionary<string, bool> izinler, IDictionary<string, string> nedenler)
        {
            izin = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            neden = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (izinler != null) foreach (var kv in izinler) if (kv.Key != null) izin[kv.Key] = kv.Value;
            if (nedenler != null) foreach (var kv in nedenler) if (kv.Key != null) neden[kv.Key] = kv.Value;
        }

        static bool Bul<T>(Dictionary<string, T> d, string ad, string arg, out T deger)
        {
            deger = default(T);
            if (string.IsNullOrEmpty(ad) || d.Count == 0) return false;
            if (!string.IsNullOrEmpty(arg) && d.TryGetValue(ad + ":" + arg, out deger)) return true;
            if (d.TryGetValue(ad, out deger)) return true;
            string s = ad;
            while (true)
            {
                int i = s.LastIndexOf('.');
                if (i <= 0) break;
                s = s.Substring(0, i);
                if (d.TryGetValue(s + ".*", out deger)) return true;
            }
            return d.TryGetValue("*", out deger);
        }

        public static bool Izinli(string ad, string arg, out string nedenMetni)
        {
            nedenMetni = null;
            bool v;
            bool bulundu = Bul(izin, ad, arg, out v);
            string n;
            if (Bul(neden, ad, arg, out n)) nedenMetni = n;
            return !bulundu || v;
        }
    }

    // =====================================================================
    //  TEMEL KONTROLLER
    // =====================================================================

    /// <summary>Çift tamponlu, kendisi çizen temel kontrol. Zemini ebeveynin rengidir.</summary>
    public class TemelKontrol : Control
    {
        public TemelKontrol()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint |
                     ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
            DoubleBuffered = true;
            Margin = Padding.Empty;
        }
        protected Color Yuzey { get { return Parent != null ? Parent.BackColor : Tema.Zemin; } }
        protected override void OnPaintBackground(PaintEventArgs e) { e.Graphics.Clear(Yuzey); }

        protected static ToolTip ipucu;
        /// <summary>false: ipucu (tooltip) gösterilmez (dokunmatikte gereksiz; ekran görüntüsü aracı kapatır).</summary>
        public static bool IpuculariGoster = true;
        protected static ToolTip Ipucu
        {
            get
            {
                if (ipucu == null) { ipucu = new ToolTip(); ipucu.InitialDelay = 300; ipucu.ShowAlways = true; }
                return ipucu;
            }
        }
    }

    /// <summary>Yazı rolü (renk).</summary>
    public enum YaziRol { Normal, Soluk, Marka, Ozel }

    /// <summary>Kendisi çizen etiket (Mono/Windows'ta aynı görünür).</summary>
    public class Yazi : TemelKontrol
    {
        string metin = "";
        public float Pt = 12f;
        public bool Kalin;
        public bool SayiYazisi;
        public bool Sar;
        public bool Kucult;
        public YaziRol RenkRol = YaziRol.Normal;
        public Color OzelRenk = Color.Empty;
        public Simge Simge = Simge.Yok;
        public StringAlignment Yatay = StringAlignment.Near;
        public StringAlignment Dikey = StringAlignment.Center;

        public Yazi() { }
        public Yazi(string m, float pt) { metin = m ?? ""; Pt = pt; }
        public Yazi(string m, float pt, bool kalin, YaziRol rol) { metin = m ?? ""; Pt = pt; Kalin = kalin; RenkRol = rol; }

        public string Metin
        {
            get { return metin; }
            set { string v = value ?? ""; if (v != metin) { metin = v; Invalidate(); } }
        }
        public void Renk(Color c) { if (OzelRenk != c || RenkRol != YaziRol.Ozel) { OzelRenk = c; RenkRol = YaziRol.Ozel; Invalidate(); } }

        Color Rengi()
        {
            switch (RenkRol)
            {
                case YaziRol.Soluk: return Tema.Soluk;
                case YaziRol.Marka: return Tema.Marka;
                case YaziRol.Ozel: return OzelRenk.IsEmpty ? Tema.Yazi : OzelRenk;
                default: return Tema.Yazi;
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            var r = new RectangleF(0, 0, Width, Height);
            Color c = Rengi();
            if (Simge != Simge.Yok)
            {
                float s = Math.Min(Height * 0.8f, Tema.PxF(Pt * 1.5f));
                Ikon.Ciz(g, Simge, new RectangleF(0, (Height - s) / 2, s, s), c);
                r = new RectangleF(s + Tema.PxF(8), 0, Width - s - Tema.PxF(8), Height);
            }
            Font f = SayiYazisi ? Tema.Sayi(Pt, Kalin) : Tema.F(Pt, Kalin);
            if (Kucult && !Sar) f = Tema.Sigdir(g, metin, SayiYazisi, Kalin, Pt, 7f, r.Size);
            Tema.Yaz(g, metin, f, c, r, Yatay, Dikey, !Sar);
        }
    }

    /// <summary>Dokunmatik düğme: yuvarlak köşe, renk rolü, simge, basılı ve pasif görünüm, en az 56 px.</summary>
    public class TouchButton : TemelKontrol, IKomutKaynagi
    {
        string metin = "", altMetin = "";
        Rol rol = Rol.Normal;
        Simge simge = Simge.Yok;
        bool basili, secili, izinli = true, etkin = true;
        string neden;
        public float YaziPt = 15f;
        public bool Kalin = true;
        /// <summary>true: simge üstte, yazı altta (büyük düğmeler).</summary>
        public bool Dikey;
        /// <summary>Komut adı (Kabuk.Komut). Boşsa yalnız Tiklandi olayı.</summary>
        public string Komut;
        public string Arg;
        /// <summary>Basılı tutma modu: basınca BasKomut, bırakınca BirakKomut gönderilir.</summary>
        public string BasKomut, BasArg, BirakKomut, BirakArg;
        /// <summary>true: Komut yalnız izin anahtarıdır; tıklama yalnız Tiklandi olayını çağırır (komutu olay sahibi gönderir).</summary>
        public bool YalnizOlay;
        /// <summary>false: pasifken neden metni düğmenin içinde gösterilmez (dar düğmeler; dokununca alt şeritte yine görünür).</summary>
        public bool NedenIcinde = true;
        public event EventHandler Tiklandi;

        public TouchButton() { Cursor = Cursors.Hand; MinimumSize = new Size(40, 40); }
        public TouchButton(string metin, Simge simge, Rol rol, string komut, string arg) : this()
        {
            this.metin = metin ?? ""; this.simge = simge; this.rol = rol; Komut = komut; Arg = arg;
            IzinYenile();
        }

        public string Metin { get { return metin; } set { string v = value ?? ""; if (v != metin) { metin = v; Invalidate(); } } }
        public string AltMetin { get { return altMetin; } set { string v = value ?? ""; if (v != altMetin) { altMetin = v; Invalidate(); } } }
        public Rol Rol { get { return rol; } set { if (rol != value) { rol = value; Invalidate(); } } }
        public Simge Simge { get { return simge; } set { if (simge != value) { simge = value; Invalidate(); } } }
        public bool Secili { get { return secili; } set { if (secili != value) { secili = value; Invalidate(); } } }
        /// <summary>Denetleyici izni (IzinleriUygula).</summary>
        public bool Izinli { get { return izinli && etkin; } }
        /// <summary>Görünümün kendi etkinliği (ör. seçim yokken). İzinle birlikte değerlendirilir.</summary>
        public bool Etkin { get { return etkin; } set { if (etkin != value) { etkin = value; Invalidate(); } } }
        public string Neden { get { return neden; } }

        public void KomutAyarla(string komut, string arg) { Komut = komut; Arg = arg; IzinYenile(); }

        public void IzinYenile()
        {
            string n = null; bool iz = true;
            string ad = !string.IsNullOrEmpty(Komut) ? Komut : BasKomut;
            string ar = !string.IsNullOrEmpty(Komut) ? Arg : BasArg;
            if (!string.IsNullOrEmpty(ad)) iz = Izinler.Izinli(ad, ar, out n);
            if (iz != izinli || n != neden)
            {
                izinli = iz; neden = n;
                try { if (IpuculariGoster) Ipucu.SetToolTip(this, izinli ? null : n); } catch { }
                Invalidate();
            }
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button != MouseButtons.Left) return;
            basili = true; Invalidate();
            if (Izinli && !string.IsNullOrEmpty(BasKomut)) KomutYolu.Gonder(BasKomut, BasArg);
        }
        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (!basili) return;
            basili = false; Invalidate();
            if (!string.IsNullOrEmpty(BasKomut))
            {
                if (Izinli && !string.IsNullOrEmpty(BirakKomut)) KomutYolu.Gonder(BirakKomut, BirakArg);
                if (!Izinli && ClientRectangle.Contains(e.Location)) KomutYolu.NedenGoster(neden);
                return;
            }
            if (!ClientRectangle.Contains(e.Location)) return;
            if (!Izinli) { KomutYolu.NedenGoster(etkin ? neden : (neden ?? "Önce bir seçim yapın.")); return; }
            Tikla();
        }
        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            if (basili && !string.IsNullOrEmpty(BasKomut) && !string.IsNullOrEmpty(BirakKomut) && Izinli) KomutYolu.Gonder(BirakKomut, BirakArg);
            if (basili) { basili = false; Invalidate(); }
        }

        /// <summary>Programdan tıklama (izin denetimi çağırana aittir).</summary>
        public void Tikla()
        {
            var h = Tiklandi; if (h != null) h(this, EventArgs.Empty);
            if (!string.IsNullOrEmpty(Komut) && !YalnizOlay) KomutYolu.Gonder(Komut, Arg);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            Color yuzey = Yuzey;
            float k = Math.Max(1f, Tema.PxF(1));
            var r = new RectangleF(k / 2, k / 2, Width - k - 1, Height - k - 1);
            float yr = Math.Min(Tema.PxF(8), Height / 2f);
            Color dolgu, kenar = Color.Empty, yazi;
            Color rc = Tema.RolRengi(rol);
            switch (rol)
            {
                case Rol.Basari: case Rol.Uyari: case Rol.Tehlike: case Rol.Bilgi:
                    dolgu = rc; yazi = Tema.UstYazi(rc); break;
                case Rol.TehlikeCizgi:
                    dolgu = Tema.Dugme; kenar = Tema.Alarm; yazi = Tema.Alarm; break;
                case Rol.Vurgu:
                    dolgu = Tema.Dugme; kenar = Tema.Marka; yazi = Tema.Marka; break;
                case Rol.Sessiz:
                    dolgu = yuzey; yazi = Tema.Soluk; break;
                default:
                    dolgu = Tema.Dugme; kenar = Tema.DugmeKenar; yazi = Tema.Yazi; break;
            }
            if (secili)
            {
                dolgu = Tema.Karistir(Tema.Dugme, Tema.Marka, Tema.Koyu ? 0.22f : 0.14f);
                kenar = Tema.Marka; yazi = Tema.Yazi;
            }
            if (basili && Izinli) { dolgu = Tema.Basili(dolgu); if (!kenar.IsEmpty) kenar = Tema.Basili(kenar); }
            bool pasif = !Izinli;
            if (pasif)
            {
                dolgu = Tema.Pasiflestir(dolgu, yuzey);
                if (!kenar.IsEmpty) kenar = Tema.Pasiflestir(kenar, yuzey);
                yazi = Tema.Pasiflestir(yazi, yuzey);
            }
            if (rol != Rol.Sessiz || basili) Tema.YuvarlakDoldur(g, r, yr, dolgu);
            if (!kenar.IsEmpty) Tema.YuvarlakCiz(g, r, yr, kenar, secili || rol == Rol.TehlikeCizgi || rol == Rol.Vurgu ? k * 1.6f : k);

            // içerik
            string alt = altMetin;
            if (pasif && NedenIcinde && !string.IsNullOrEmpty(neden) && Height >= Tema.Px(72)) alt = neden;
            float pad = Tema.PxF(10);
            var ic = new RectangleF(pad, Tema.PxF(4), Width - 2 * pad, Height - Tema.PxF(8));
            Font fAlt = Tema.F(Math.Max(8.5f, YaziPt * 0.62f));
            float altH = string.IsNullOrEmpty(alt) ? 0 : fAlt.GetHeight(g) * 1.05f;
            bool dikey = Dikey || (simge != Simge.Yok && Height >= Tema.Px(88) && Width < Height * 2.4f);
            if (string.IsNullOrEmpty(metin)) dikey = true;

            if (dikey)
            {
                float simgeB = simge == Simge.Yok ? 0 : Math.Min(Tema.PxF(34), Math.Min(ic.Height * (string.IsNullOrEmpty(metin) ? 0.7f : 0.36f), ic.Width * 0.5f));
                float bosluk = simge == Simge.Yok || string.IsNullOrEmpty(metin) ? 0 : Tema.PxF(6);
                Font f = Tema.Sigdir(g, metin, false, Kalin, YaziPt, 7f, new SizeF(ic.Width, ic.Height * 0.4f));
                float yH = string.IsNullOrEmpty(metin) ? 0 : Tema.Olc(g, metin, f).Height;
                float toplam = simgeB + bosluk + yH + altH;
                float y0 = ic.Y + (ic.Height - toplam) / 2;
                if (simge != Simge.Yok) Ikon.Ciz(g, simge, new RectangleF(ic.X + (ic.Width - simgeB) / 2, y0, simgeB, simgeB), yazi);
                Tema.Yaz(g, metin, f, yazi, new RectangleF(ic.X, y0 + simgeB + bosluk, ic.Width, yH + 2), StringAlignment.Center, StringAlignment.Near, false);
                if (altH > 0) Tema.Yaz(g, alt, fAlt, pasif ? yazi : Tema.Karistir(yazi, dolgu, 0.3f), new RectangleF(ic.X, y0 + simgeB + bosluk + yH, ic.Width, altH + 2), StringAlignment.Center, StringAlignment.Near, true);
            }
            else
            {
                Simge sm = simge;
                float simgeB = sm == Simge.Yok ? 0 : Math.Min(Tema.PxF(26), ic.Height * 0.52f);
                float bosluk = sm == Simge.Yok ? 0 : Tema.PxF(10);
                float yaziG = ic.Width - simgeB - bosluk;
                Font f = Tema.Sigdir(g, metin, false, Kalin, YaziPt, 7f, new SizeF(yaziG, (ic.Height - altH) * 0.9f));
                if (sm != Simge.Yok && f.SizeInPoints < YaziPt * Tema.S * 0.8f)
                {
                    sm = Simge.Yok; simgeB = 0; bosluk = 0; yaziG = ic.Width;
                    f = Tema.Sigdir(g, metin, false, Kalin, YaziPt, 7f, new SizeF(yaziG, (ic.Height - altH) * 0.9f));
                }
                var z = Tema.Olc(g, metin, f);
                float yaziW = Math.Min(yaziG, z.Width + 2);
                float altW = altH > 0 ? Math.Min(yaziG, Tema.Olc(g, alt, fAlt).Width + 2) : 0;
                float grupW = simgeB + bosluk + Math.Max(yaziW, altW);
                float x0 = ic.X + (ic.Width - grupW) / 2;
                if (sm != Simge.Yok) Ikon.Ciz(g, sm, new RectangleF(x0, ic.Y + (ic.Height - simgeB) / 2, simgeB, simgeB), yazi);
                float tx = x0 + simgeB + bosluk;
                float th = z.Height + altH;
                float ty = ic.Y + (ic.Height - th) / 2;
                StringAlignment hiz = sm == Simge.Yok ? StringAlignment.Center : StringAlignment.Near;
                float tw = sm == Simge.Yok ? ic.Width : Math.Min(ic.Right - tx, Math.Max(yaziW, altW) + Tema.PxF(6));
                float txx = sm == Simge.Yok ? ic.X : tx;
                Tema.Yaz(g, metin, f, yazi, new RectangleF(txx, ty, tw, z.Height + 2), hiz, StringAlignment.Near, true);
                if (altH > 0) Tema.Yaz(g, alt, fAlt, pasif ? yazi : Tema.Karistir(yazi, dolgu, 0.3f), new RectangleF(txx, ty + z.Height, tw, altH + 2), hiz, StringAlignment.Near, true);
            }
        }
    }

    /// <summary>Durum hapı. ALARM'da 1 Hz yanıp söner.</summary>
    public class StatusPill : TemelKontrol
    {
        Durum durum = Durum.Pasif;
        string metin;
        bool yanik = true;
        readonly Timer zaman;
        public float Pt = 18f;

        public StatusPill()
        {
            zaman = new Timer(); zaman.Interval = 500;
            zaman.Tick += delegate { yanik = !yanik; Invalidate(); };
        }

        public Durum Durum
        {
            get { return durum; }
            set
            {
                if (durum == value) return;
                durum = value; yanik = true;
                zaman.Enabled = durum == Durum.Alarm;
                Invalidate();
            }
        }
        public string Metin { get { return metin; } set { if (value != metin) { metin = value; Invalidate(); } } }

        protected override void Dispose(bool disposing) { if (disposing) zaman.Dispose(); base.Dispose(disposing); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            Color c = Tema.DurumRengi(durum);
            Color dolgu = yanik ? c : Tema.Karistir(c, Yuzey, 0.72f);
            float h = Math.Min(Height - 2, Tema.PxF(56));
            var r = new RectangleF(1, (Height - h) / 2, Width - 2, h);
            Tema.YuvarlakDoldur(g, r, h / 2, dolgu);
            // İlerleme teması (Geçişli, Şafak): renkli zeminde (ÇALIŞIYOR mavi zeminde, DURAKLATILDI bakır zeminde) hap ayrışsın diye ince açık çerçeve
            if (Tema.Ilerlemeli) Tema.YuvarlakCiz(g, r, h / 2, Tema.Alfa(Color.White, 90), Math.Max(1f, Tema.PxF(1.2f)));
            Color yazi = yanik ? Tema.UstYazi(c) : Tema.Yazi;
            float nokta = h * 0.26f;
            float x = r.X + h * 0.36f;
            using (var b = new SolidBrush(yazi)) g.FillEllipse(b, x, r.Y + (h - nokta) / 2, nokta, nokta);
            string s = string.IsNullOrEmpty(metin) ? Tema.DurumAdi(durum) : metin;
            var alan = new RectangleF(x + nokta + h * 0.22f, r.Y, r.Right - (x + nokta + h * 0.22f) - h * 0.3f, h);
            Font f = Tema.Sigdir(g, s, false, true, Pt, 9f, new SizeF(alan.Width, alan.Height * 0.8f));
            Tema.Yaz(g, s, f, yazi, alan, StringAlignment.Near, StringAlignment.Center, true);
        }
    }

    /// <summary>Başlıklı kart (yuvarlak köşe, kenar). Çocuklar Padding içine yerleşir.</summary>
    public class Card : Panel, IOlcekli
    {
        string baslik = "", sag = "";
        Color vurgu = Color.Empty;
        public Simge BaslikSimge = Simge.Yok;
        /// <summary>Taban iç boşluk (S=1).</summary>
        public float Bosluk = 14f;
        public Color SagRenk = Color.Empty;
        public event EventHandler BaslikTiklandi;

        public Card()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            DoubleBuffered = true;
            BackColor = Tema.Kart;
            Margin = Padding.Empty;
            Olcekle();
        }
        public Card(string baslik) : this() { this.baslik = baslik ?? ""; Olcekle(); }

        public string Baslik { get { return baslik; } set { string v = value ?? ""; if (v != baslik) { bool d = (v.Length == 0) != (baslik.Length == 0); baslik = v; if (d) Olcekle(); Invalidate(); } } }
        public string SagMetin { get { return sag; } set { string v = value ?? ""; if (v != sag) { sag = v; Invalidate(); } } }
        /// <summary>Sol kenarda renkli şerit (ör. uyarı). Color.Empty = yok.</summary>
        public Color Vurgu { get { return vurgu; } set { if (vurgu != value) { vurgu = value; Invalidate(); } } }

        public int BaslikYuksekligi { get { return baslik.Length == 0 ? 0 : Tema.Px(30); } }

        public void Olcekle()
        {
            int b = Tema.Px(Bosluk);
            Padding = new Padding(b, baslik.Length == 0 ? b : b / 2 + BaslikYuksekligi, b, b);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (e.Y < Padding.Top) { var h = BaslikTiklandi; if (h != null) h(this, EventArgs.Empty); }
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Parent != null ? Parent.BackColor : Tema.Zemin);
            Tema.Hazirla(g);
            float k = Math.Max(1f, Tema.PxF(1));
            var r = new RectangleF(k / 2, k / 2, Width - k - 1, Height - k - 1);
            float yr = Tema.PxF(10);
            Tema.YuvarlakDoldur(g, r, yr, Tema.Kart);
            if (!vurgu.IsEmpty)
            {
                var st = g.Save();
                using (var p = Tema.Yuvarlak(r, yr)) g.SetClip(p);
                using (var b = new SolidBrush(vurgu)) g.FillRectangle(b, 0, 0, Tema.PxF(5), Height);
                g.Restore(st);
            }
            Tema.YuvarlakCiz(g, r, yr, vurgu.IsEmpty ? Tema.KartKenar : Tema.Karistir(Tema.KartKenar, vurgu, 0.5f), k);
            if (baslik.Length > 0)
            {
                int b = Tema.Px(Bosluk);
                float x = b;
                float bh = BaslikYuksekligi;
                if (BaslikSimge != Simge.Yok)
                {
                    float s = Tema.PxF(15);
                    Ikon.Ciz(g, BaslikSimge, new RectangleF(x, Tema.PxF(8) + (bh - s) / 2, s, s), Tema.Soluk);
                    x += s + Tema.PxF(8);
                }
                Font f = Tema.F(10f, true);
                var alanB = new RectangleF(x, Tema.PxF(8), Width - x - b, bh);
                float sw = 0;
                if (sag.Length > 0)
                {
                    Font fs = Tema.F(11f, true);
                    sw = Math.Min(alanB.Width * 0.6f, Tema.Olc(g, sag, fs).Width + Tema.PxF(6));
                    Tema.Yaz(g, sag, fs, SagRenk.IsEmpty ? Tema.Yazi : SagRenk, new RectangleF(alanB.Right - sw, alanB.Y, sw, bh), StringAlignment.Far, StringAlignment.Center, true);
                    sw += Tema.PxF(12);
                }
                Tema.Yaz(g, Bicim.BuyukHarf(baslik), f, Tema.Soluk, new RectangleF(alanB.X, alanB.Y, alanB.Width - sw, bh), StringAlignment.Near, StringAlignment.Center, true);
            }
        }
    }

    /// <summary>Etiket + büyük sabit genişlikli değer.</summary>
    public class BigValue : TemelKontrol
    {
        string etiket = "", deger = "";
        Color renk = Color.Empty;
        public float DegerPt = 22f;
        public float EtiketPt = 9.5f;
        public bool Kalin = true;
        public bool Sayisal = true;
        public StringAlignment Hiza = StringAlignment.Near;

        public BigValue() { }
        public BigValue(string etiket, float pt) { this.etiket = etiket ?? ""; DegerPt = pt; }

        public string Etiket { get { return etiket; } set { string v = value ?? ""; if (v != etiket) { etiket = v; Invalidate(); } } }
        public string Deger { get { return deger; } set { string v = value ?? ""; if (v != deger) { deger = v; Invalidate(); } } }
        public Color Renk { get { return renk; } set { if (renk != value) { renk = value; Invalidate(); } } }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            Font fe = Tema.F(EtiketPt, true);
            float eh = etiket.Length == 0 ? 0 : fe.GetHeight(g) + Tema.PxF(2);
            if (eh > 0) Tema.Yaz(g, Bicim.BuyukHarf(etiket), fe, Tema.Soluk, new RectangleF(0, 0, Width, eh), Hiza, StringAlignment.Near, true);
            var alan = new RectangleF(0, eh, Width, Height - eh);
            Font f = Tema.Sigdir(g, deger, Sayisal, Kalin, DegerPt, 8f, alan.Size);
            Tema.Yaz(g, deger, f, renk.IsEmpty ? Tema.Yazi : renk, alan, Hiza, StringAlignment.Center, true);
        }
    }

    /// <summary>X Y Z A B eksen konumları: iş konumu büyük, makine konumu küçük.</summary>
    public class AxisPanel : TemelKontrol
    {
        static readonly string[] adlar = { "X", "Y", "Z", "A", "B" };
        readonly double[] isK = new double[5], mak = new double[5];
        bool makineBirincil;
        public event EventHandler KoordTiklandi;

        public AxisPanel() { Cursor = Cursors.Hand; }

        public bool MakineBirincil { get { return makineBirincil; } set { if (makineBirincil != value) { makineBirincil = value; Invalidate(); } } }

        public void Ayarla(double x, double y, double z, double a, double b, double mx, double my, double mz, double ma, double mb)
        {
            double[] yi = { x, y, z, a, b }, ym = { mx, my, mz, ma, mb };
            bool d = false;
            for (int i = 0; i < 5; i++)
            {
                if (isK[i] != yi[i] || mak[i] != ym[i]) d = true;
                isK[i] = yi[i]; mak[i] = ym[i];
            }
            if (d) Invalidate();
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            var h = KoordTiklandi; if (h != null) h(this, EventArgs.Empty);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            int sutun = Width >= Tema.Px(150) * 5 ? 5 : 3;
            int satir = sutun == 5 ? 1 : 2;
            float bos = Tema.PxF(8);
            float hw = (Width - bos * (sutun - 1)) / sutun;
            float hh = (Height - bos * (satir - 1)) / satir;
            Font fDeger = null;
            for (int i = 0; i < 5; i++)
            {
                int c = i % sutun, s = i / sutun;
                var r = new RectangleF(c * (hw + bos), s * (hh + bos), hw, hh);
                Tema.YuvarlakDoldur(g, r, Tema.PxF(8), Tema.Dugme);
                float harfW = Math.Min(Tema.PxF(30), r.Width * 0.2f);
                Font fh = Tema.F(15f, true);
                Tema.Yaz(g, adlar[i], fh, Tema.Marka, new RectangleF(r.X + Tema.PxF(10), r.Y, harfW, r.Height * 0.62f), StringAlignment.Near, StringAlignment.Center, true);
                double birincil = makineBirincil ? mak[i] : isK[i];
                double ikincil = makineBirincil ? isK[i] : mak[i];
                string v = Bicim.Sayi(birincil, 3);
                var alan = new RectangleF(r.X + Tema.PxF(10) + harfW, r.Y + Tema.PxF(4), r.Width - harfW - Tema.PxF(20), r.Height * 0.62f - Tema.PxF(4));
                if (fDeger == null) fDeger = Tema.Sigdir(g, "-000.000", true, true, 22f, 9f, alan.Size);
                Tema.Yaz(g, v, fDeger, Tema.Yazi, alan, StringAlignment.Far, StringAlignment.Center, true);
                Font fk = Tema.Sayi(9.5f);
                string alt = (makineBirincil ? "İŞ  " : "MAK  ") + Bicim.Sayi(ikincil, 3);
                Tema.Yaz(g, alt, fk, Tema.Soluk, new RectangleF(r.X + Tema.PxF(10), r.Y + r.Height * 0.6f, r.Width - Tema.PxF(20), r.Height * 0.36f), StringAlignment.Far, StringAlignment.Center, true);
            }
        }
    }

    /// <summary>Yumuşak ilerleyen ilerleme çubuğu.</summary>
    public class ProgressBand : TemelKontrol
    {
        double hedef, gosterilen;
        Color renk = Color.Empty;
        readonly Timer zaman;
        float parilti = -0.3f;
        bool parlak;

        public ProgressBand()
        {
            zaman = new Timer(); zaman.Interval = 16;
            zaman.Tick += Tik;
        }
        protected override void Dispose(bool disposing) { if (disposing) zaman.Dispose(); base.Dispose(disposing); }

        public double Deger
        {
            get { return hedef; }
            set
            {
                double v = Math.Max(0, Math.Min(100, value));
                if (Math.Abs(v - hedef) < 0.0001) return;
                hedef = v;
                if (Tema.Mono && !Visible) gosterilen = v;
                zaman.Enabled = true;
            }
        }
        /// <summary>Animasyonsuz hemen ayarla.</summary>
        public void Hemen(double v) { hedef = gosterilen = Math.Max(0, Math.Min(100, v)); Invalidate(); }
        public Color Renk { get { return renk; } set { if (renk != value) { renk = value; Invalidate(); } } }
        /// <summary>İş sürerken hafif parıltı (Dansci tercihi).</summary>
        public bool Parilti { get { return parlak; } set { if (parlak != value) { parlak = value; if (value) zaman.Enabled = true; Invalidate(); } } }

        void Tik(object s, EventArgs e)
        {
            double fark = hedef - gosterilen;
            if (Math.Abs(fark) < 0.05) gosterilen = hedef; else gosterilen += fark * 0.18;
            if (parlak) { parilti += 0.012f; if (parilti > 1.3f) parilti = -0.3f; }
            if (gosterilen == hedef && !parlak) zaman.Enabled = false;
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            var r = new RectangleF(0, 0, Width - 1, Height - 1);
            float yr = r.Height / 2;
            Tema.YuvarlakDoldur(g, r, yr, Tema.Ayrac);
            float w = (float)(r.Width * gosterilen / 100.0);
            bool cerceve = Tema.Ilerlemeli;
            if (w > 1)
            {
                Color c = renk.IsEmpty ? Tema.Calisiyor : renk;
                var dr = new RectangleF(r.X, r.Y, Math.Max(w, Math.Min(r.Height, r.Width)), r.Height);
                using (var p = Tema.Yuvarlak(dr, yr))
                using (var b = new LinearGradientBrush(new RectangleF(dr.X, dr.Y - 1, dr.Width, dr.Height + 2), Tema.Acilastir(c, 0.12f), c, LinearGradientMode.Vertical))
                    g.FillPath(b, p);
                if (parlak && w > r.Height * 2)
                {
                    float px = r.X + parilti * w;
                    var st = g.Save();
                    using (var p = Tema.Yuvarlak(dr, yr)) g.SetClip(p);
                    var pr = new RectangleF(px - r.Height * 2, r.Y, r.Height * 4, r.Height);
                    using (var b = new LinearGradientBrush(new RectangleF(pr.X - 1, pr.Y, pr.Width + 2, pr.Height), Color.FromArgb(0, 255, 255, 255), Color.FromArgb(0, 255, 255, 255), LinearGradientMode.Horizontal))
                    {
                        var cb = new ColorBlend(3);
                        cb.Colors = new[] { Color.FromArgb(0, 255, 255, 255), Color.FromArgb(70, 255, 255, 255), Color.FromArgb(0, 255, 255, 255) };
                        cb.Positions = new[] { 0f, 0.5f, 1f };
                        b.InterpolationColors = cb;
                        g.FillRectangle(b, pr);
                    }
                    g.Restore(st);
                }
            }
            // İlerleme teması: iz ve dolgu zeminle aynı renk ailesinde kalabilir (mavi dolgu / mavi zemin); ince açık çerçeve
            if (cerceve) Tema.YuvarlakCiz(g, new RectangleF(r.X + 0.5f, r.Y + 0.5f, r.Width - 1, r.Height - 1), yr, Tema.Alfa(Color.White, 70), Math.Max(1f, Tema.PxF(1f)));
        }
    }

    /// <summary>Sol menü (ikon + yazı, 88 px).</summary>
    public class NavRail : TemelKontrol
    {
        class Oge { public string Ad, Metin; public Simge Simge; public bool Rozet; }
        readonly List<Oge> ogeler = new List<Oge>();
        string secili;
        public event Action<string> Secildi;

        public NavRail() { Cursor = Cursors.Hand; }

        public void Ekle(string ad, string metin, Simge simge) { ogeler.Add(new Oge { Ad = ad, Metin = metin, Simge = simge }); Invalidate(); }
        public string Secili { get { return secili; } set { if (secili != value) { secili = value; Invalidate(); } } }
        public void Rozet(string ad, bool var)
        {
            foreach (var o in ogeler) if (o.Ad == ad && o.Rozet != var) { o.Rozet = var; Invalidate(); }
        }

        float OgeH { get { return Math.Min(Tema.PxF(84), (Height - Tema.PxF(16)) / Math.Max(1, ogeler.Count)); } }

        protected override void OnPaintBackground(PaintEventArgs e) { e.Graphics.Clear(Tema.Menu); }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            int i = (int)((e.Y - Tema.PxF(8)) / OgeH);
            if (i < 0 || i >= ogeler.Count) return;
            Secili = ogeler[i].Ad;
            var h = Secildi; if (h != null) h(ogeler[i].Ad);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            using (var p = new Pen(Tema.KartKenar, Math.Max(1, Tema.PxF(1)))) g.DrawLine(p, Width - 1, 0, Width - 1, Height);
            float oh = OgeH;
            for (int i = 0; i < ogeler.Count; i++)
            {
                var o = ogeler[i];
                var r = new RectangleF(Tema.PxF(6), Tema.PxF(8) + i * oh, Width - Tema.PxF(13), oh - Tema.PxF(6));
                bool s = o.Ad == secili;
                if (s)
                {
                    Tema.YuvarlakDoldur(g, r, Tema.PxF(10), Tema.Secili);
                    Tema.YuvarlakDoldur(g, new RectangleF(Tema.PxF(1), r.Y + r.Height * 0.22f, Tema.PxF(4), r.Height * 0.56f), Tema.PxF(2), Tema.Marka);
                }
                Color c = s ? Tema.Yazi : Tema.Soluk;
                float ib = Math.Min(Tema.PxF(28), r.Height * 0.38f);
                float iy = r.Y + r.Height * 0.16f;
                Ikon.Ciz(g, o.Simge, new RectangleF(r.X + (r.Width - ib) / 2, iy, ib, ib), s ? Tema.Marka : c);
                if (o.Rozet)
                    using (var b = new SolidBrush(Tema.Alarm)) g.FillEllipse(b, r.X + r.Width / 2 + ib * 0.4f, iy - Tema.PxF(2), Tema.PxF(10), Tema.PxF(10));
                var yr = new RectangleF(r.X - Tema.PxF(4), iy + ib + Tema.PxF(4), r.Width + Tema.PxF(8), r.Bottom - (iy + ib + Tema.PxF(4)));
                Font f = Tema.Sigdir(g, o.Metin, false, s, 9.5f, 7f, new SizeF(yr.Width, yr.Height));
                Tema.Yaz(g, o.Metin, f, c, yr, StringAlignment.Center, StringAlignment.Near, true);
            }
        }
    }

    /// <summary>Alt mesaj şeridi: son mesaj/alarm. Dokununca Kayıtlar. Sağda eylem düğmeleri olabilir.</summary>
    public class MessageBar : Panel
    {
        MesajTuru tur = MesajTuru.Bilgi;
        string metin = "", zaman = "";
        bool alarm;
        public event EventHandler Tiklandi;

        public MessageBar()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            DoubleBuffered = true; Cursor = Cursors.Hand;
        }

        public void Ayarla(MesajTuru t, string zamanMetni, string m, bool alarmModu)
        {
            m = m ?? ""; zamanMetni = zamanMetni ?? "";
            if (t == tur && m == metin && zamanMetni == zaman && alarmModu == alarm) return;
            tur = t; metin = m; zaman = zamanMetni; alarm = alarmModu;
            BackColor = alarm ? Tema.Alarm : Tema.Kart;
            Invalidate();
        }
        public bool AlarmModu { get { return alarm; } }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            var h = Tiklandi; if (h != null) h(this, EventArgs.Empty);
        }

        int SagGenislik()
        {
            int w = 0;
            foreach (Control c in Controls) if (c.Visible) w += c.Width + Tema.Px(8);
            return w;
        }

        protected override void OnLayout(LayoutEventArgs levent)
        {
            int x = Width - Tema.Px(8);
            int h = Height - Tema.Px(10);
            for (int i = Controls.Count - 1; i >= 0; i--)
            {
                var c = Controls[i]; if (!c.Visible) continue;
                x -= c.Width;
                c.SetBounds(x, (Height - h) / 2, c.Width, h);
                x -= Tema.Px(8);
            }
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            var g = e.Graphics;
            Color zemin = alarm ? Tema.Alarm : Tema.Kart;
            g.Clear(zemin);
            Tema.Hazirla(g);
            if (!alarm) using (var p = new Pen(Tema.KartKenar, Math.Max(1, Tema.PxF(1)))) g.DrawLine(p, 0, 0, Width, 0);
            Color yazi = alarm ? Tema.UstYazi(Tema.Alarm) : Tema.Yazi;
            Color tc = alarm ? yazi : Tema.TurRengi(tur);
            float x = Tema.PxF(16);
            float s = Math.Min(Tema.PxF(20), Height * 0.5f);
            Simge sm = tur == MesajTuru.Hata ? Simge.Uyari : tur == MesajTuru.Uyari ? Simge.Uyari : tur == MesajTuru.Basari ? Simge.Tamam : Simge.Bilgi;
            if (alarm) sm = Simge.Kilit;
            Ikon.Ciz(g, sm, new RectangleF(x, (Height - s) / 2, s, s), tc);
            x += s + Tema.PxF(10);
            if (zaman.Length > 0)
            {
                Font fz = Tema.Sayi(11f);
                float zw = Tema.Olc(g, zaman, fz).Width + Tema.PxF(12);
                Tema.Yaz(g, zaman, fz, alarm ? yazi : Tema.Soluk, new RectangleF(x, 0, zw, Height));
                x += zw;
            }
            float sag = SagGenislik();
            Font fm = Tema.F(12f, alarm);
            string ipucu = alarm ? "" : "Kayıtlar  ›";
            float iw = ipucu.Length > 0 ? Tema.Olc(g, ipucu, Tema.F(10f)).Width + Tema.PxF(16) : 0;
            if (sag > 0) iw = 0;
            Tema.Yaz(g, metin, fm, yazi, new RectangleF(x, 0, Width - x - sag - iw - Tema.PxF(8), Height));
            if (iw > 0) Tema.Yaz(g, ipucu, Tema.F(10f), Tema.Soluk, new RectangleF(Width - iw - Tema.PxF(8), 0, iw, Height), StringAlignment.Far, StringAlignment.Center, true);
        }
    }

    /// <summary>Yuvarlak kırmızı ACİL STOP. Basıldığı an (fare/dokunuş aşağı) "acilstop" gönderir; hiçbir zaman pasif olmaz.</summary>
    public class EStopButton : TemelKontrol
    {
        bool basili, aktif;
        public bool Kucuk;
        public event EventHandler Basildi;

        public EStopButton() { Cursor = Cursors.Hand; }

        /// <summary>Acil stop kilidi şu an etkin mi (görünüm).</summary>
        public bool Aktif { get { return aktif; } set { if (aktif != value) { aktif = value; Invalidate(); } } }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            basili = true; Invalidate();
            var h = Basildi; if (h != null) h(this, EventArgs.Empty); else KomutYolu.Gonder("acilstop", "");
        }
        protected override void OnMouseUp(MouseEventArgs e) { base.OnMouseUp(e); basili = false; Invalidate(); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            Color sari = Color.FromArgb(250, 204, 21);
            Color kirmizi = Color.FromArgb(220, 38, 38);
            if (Kucuk)
            {
                var r = new RectangleF(1, 1, Width - 3, Height - 3);
                Tema.YuvarlakDoldur(g, r, r.Height / 2, basili ? Tema.Basili(kirmizi) : kirmizi);
                Tema.YuvarlakCiz(g, r, r.Height / 2, sari, Tema.PxF(2));
                Tema.Yaz(g, "ACİL STOP", Tema.Sigdir(g, "ACİL STOP", false, true, 11f, 7f, new SizeF(r.Width * 0.8f, r.Height * 0.7f)), Color.White, r, StringAlignment.Center, StringAlignment.Center, true);
                return;
            }
            float d = Math.Min(Width, Height) - Tema.PxF(10);
            var dis = new RectangleF((Width - d) / 2, (Height - d) / 2, d, d);
            using (var b = new SolidBrush(sari)) g.FillEllipse(b, dis);
            float ic = d * 0.80f;
            var icR = new RectangleF(dis.X + (d - ic) / 2, dis.Y + (d - ic) / 2, ic, ic);
            Color k1 = basili ? Tema.Basili(kirmizi) : Color.FromArgb(239, 68, 68);
            Color k2 = basili ? Tema.Basili(Color.FromArgb(153, 27, 27)) : Color.FromArgb(185, 28, 28);
            using (var p = new GraphicsPath())
            {
                p.AddEllipse(icR);
                using (var b = new PathGradientBrush(p))
                {
                    b.CenterPoint = new PointF(icR.X + ic * 0.4f, icR.Y + ic * 0.35f);
                    b.CenterColor = k1; b.SurroundColors = new[] { k2 };
                    g.FillPath(b, p);
                }
            }
            using (var pen = new Pen(Color.FromArgb(120, 0, 0, 0), Math.Max(1, d * 0.02f))) g.DrawEllipse(pen, icR);
            if (aktif)
                using (var pen = new Pen(Color.White, Math.Max(2, d * 0.035f))) g.DrawEllipse(pen, icR.X + ic * 0.07f, icR.Y + ic * 0.07f, ic * 0.86f, ic * 0.86f);
            Font f = Tema.Sigdir(g, "STOP", false, true, 13f, 7f, new SizeF(ic * 0.72f, ic * 0.3f));
            float lh = f.GetHeight(g);
            Tema.Yaz(g, "ACİL", f, Color.White, new RectangleF(icR.X, icR.Y + ic / 2 - lh, ic, lh), StringAlignment.Center, StringAlignment.Center, true);
            Tema.Yaz(g, "STOP", f, Color.White, new RectangleF(icR.X, icR.Y + ic / 2 - lh * 0.05f, ic, lh), StringAlignment.Center, StringAlignment.Center, true);
        }
    }

    /// <summary>Ölçeklenen TableLayoutPanel. Boyut: &gt;0 mutlak px (S=1), &lt;0 yüzde, 0 = otomatik.</summary>
    public class Izgara : TableLayoutPanel, IOlcekli
    {
        float[] sutun = new float[0], satir = new float[0];
        bool[] gizliSatir = new bool[0];
        bool[] gizliSutun = new bool[0];
        public float Bosluk = 10f;
        public float Kenar;

        public Izgara(int sutunSayisi, int satirSayisi)
        {
            DoubleBuffered = true;
            ColumnCount = sutunSayisi; RowCount = satirSayisi;
            Margin = Padding.Empty; Padding = Padding.Empty;
            GrowStyle = TableLayoutPanelGrowStyle.FixedSize;
            sutun = new float[sutunSayisi]; satir = new float[satirSayisi];
            for (int i = 0; i < sutunSayisi; i++) sutun[i] = -100f / sutunSayisi;
            for (int i = 0; i < satirSayisi; i++) satir[i] = -100f / satirSayisi;
            gizliSatir = new bool[satirSayisi]; gizliSutun = new bool[sutunSayisi];
            Olcekle();
        }

        public Izgara Sutunlar(params float[] v) { if (v.Length == ColumnCount) sutun = v; Olcekle(); return this; }
        public Izgara Satirlar(params float[] v) { if (v.Length == RowCount) satir = v; Olcekle(); return this; }
        public void SatirGizle(int i, bool gizli) { if (i >= 0 && i < RowCount && gizliSatir[i] != gizli) { gizliSatir[i] = gizli; Olcekle(); } }
        public void SutunGizle(int i, bool gizli) { if (i >= 0 && i < ColumnCount && gizliSutun[i] != gizli) { gizliSutun[i] = gizli; Olcekle(); } }
        public void SatirBoyu(int i, float v) { if (i >= 0 && i < RowCount && satir[i] != v) { satir[i] = v; Olcekle(); } }

        public T Ekle<T>(T c, int s, int r) where T : Control { return Ekle(c, s, r, 1, 1); }
        public T Ekle<T>(T c, int s, int r, int sYay, int rYay) where T : Control
        {
            c.Dock = DockStyle.Fill;
            Controls.Add(c, s, r);
            if (sYay > 1) SetColumnSpan(c, sYay);
            if (rYay > 1) SetRowSpan(c, rYay);
            Kenarlar(c);
            return c;
        }

        void Kenarlar(Control c)
        {
            int s = GetColumn(c), r = GetRow(c);
            if (s < 0 || r < 0) return;
            int sy = GetColumnSpan(c), ry = GetRowSpan(c);
            int b = Tema.Px(Bosluk / 2f);
            c.Margin = new Padding(s == 0 ? 0 : b, r == 0 ? 0 : b, s + sy >= ColumnCount ? 0 : b, r + ry >= RowCount ? 0 : b);
        }

        public void Olcekle()
        {
            SuspendLayout();
            ColumnStyles.Clear(); RowStyles.Clear();
            for (int i = 0; i < ColumnCount; i++) ColumnStyles.Add(Stil(sutun[i], gizliSutun[i]));
            for (int i = 0; i < RowCount; i++) RowStyles.Add(SatirStil(satir[i], gizliSatir[i]));
            int k = Tema.Px(Kenar);
            Padding = new Padding(k);
            foreach (Control c in Controls) Kenarlar(c);
            ResumeLayout(true);
        }

        static ColumnStyle Stil(float v, bool gizli)
        {
            if (gizli) return new ColumnStyle(SizeType.Absolute, 0);
            if (v > 0) return new ColumnStyle(SizeType.Absolute, Tema.Px(v));
            if (v < 0) return new ColumnStyle(SizeType.Percent, -v);
            return new ColumnStyle(SizeType.AutoSize);
        }
        static RowStyle SatirStil(float v, bool gizli)
        {
            if (gizli) return new RowStyle(SizeType.Absolute, 0);
            if (v > 0) return new RowStyle(SizeType.Absolute, Tema.Px(v));
            if (v < 0) return new RowStyle(SizeType.Percent, -v);
            return new RowStyle(SizeType.AutoSize);
        }
    }

    /// <summary>Dikey yığın: çocuklar sırayla, taban yükseklikleriyle (S=1) dizilir; 0 = kalan alanı doldur.</summary>
    public class Yigin : Panel, IOlcekli
    {
        readonly List<Control> cocuk = new List<Control>();
        readonly List<float> boy = new List<float>();
        public float Bosluk = 8f;

        public Yigin()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            DoubleBuffered = true; Margin = Padding.Empty;
        }

        public T Ekle<T>(T c, float tabanYukseklik) where T : Control
        {
            cocuk.Add(c); boy.Add(tabanYukseklik); Controls.Add(c); PerformLayout(); return c;
        }
        public void Boy(Control c, float v) { int i = cocuk.IndexOf(c); if (i >= 0 && boy[i] != v) { boy[i] = v; PerformLayout(); } }
        public void Olcekle() { PerformLayout(); }

        protected override void OnLayout(LayoutEventArgs e)
        {
            int y = Padding.Top, b = Tema.Px(Bosluk);
            int sabit = 0, dolgu = 0, gorunur = 0;
            for (int i = 0; i < cocuk.Count; i++)
            {
                if (!cocuk[i].Visible) continue;
                gorunur++;
                if (boy[i] > 0) sabit += Tema.Px(boy[i]); else dolgu++;
            }
            int kalan = Math.Max(0, Height - Padding.Vertical - sabit - b * Math.Max(0, gorunur - 1));
            int w = Width - Padding.Horizontal;
            for (int i = 0; i < cocuk.Count; i++)
            {
                var c = cocuk[i]; if (!c.Visible) continue;
                int h = boy[i] > 0 ? Tema.Px(boy[i]) : (dolgu > 0 ? kalan / dolgu : 0);
                c.SetBounds(Padding.Left, y, w, h);
                y += h + b;
            }
        }
    }

    /// <summary>Aç/kapa anahtarı. Tıklayınca Komut, Arg = "Anahtar=1|0" (ya da DegerAcik/DegerKapali).</summary>
    public class Anahtar : TemelKontrol, IKomutKaynagi
    {
        bool acik, izinli = true;
        string neden;
        public string Komut = "ayar.kaydet";
        public string AyarAdi;
        public string DegerAcik = "1", DegerKapali = "0";
        public event EventHandler Degisti;

        public Anahtar() { Cursor = Cursors.Hand; }
        public Anahtar(string ayarAdi) : this() { AyarAdi = ayarAdi; IzinYenile(); }

        public bool Acik { get { return acik; } set { if (acik != value) { acik = value; Invalidate(); } } }

        public void IzinYenile()
        {
            string n; bool iz = Izinler.Izinli(Komut, AyarAdi, out n);
            if (iz != izinli || n != neden) { izinli = iz; neden = n; Invalidate(); }
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (!izinli) { KomutYolu.NedenGoster(neden); return; }
            Acik = !acik;
            var h = Degisti; if (h != null) h(this, EventArgs.Empty);
            if (!string.IsNullOrEmpty(Komut)) KomutYolu.Gonder(Komut, (AyarAdi == null ? "" : AyarAdi + "=") + (acik ? DegerAcik : DegerKapali));
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            float h = Math.Min(Height - 4, Tema.PxF(34)), w = h * 1.85f;
            var r = new RectangleF(Width - w - 2, (Height - h) / 2, w, h);
            Color iz = acik ? Tema.Hazir : Tema.DugmeKenar;
            Color top = Color.White;
            if (!izinli) { iz = Tema.Pasiflestir(iz, Yuzey); top = Tema.Pasiflestir(top, Yuzey); }
            Tema.YuvarlakDoldur(g, r, h / 2, iz);
            float d = h - Tema.PxF(6);
            float x = acik ? r.Right - d - Tema.PxF(3) : r.X + Tema.PxF(3);
            using (var b = new SolidBrush(top)) g.FillEllipse(b, x, r.Y + Tema.PxF(3), d, d);
            string s = acik ? "AÇIK" : "KAPALI";
            Font f = Tema.F(9.5f, true);
            float sw = Tema.Olc(g, s, f).Width + Tema.PxF(10);
            if (r.X - sw - Tema.PxF(4) >= 0)
                Tema.Yaz(g, s, f, acik ? Tema.Yazi : Tema.Soluk, new RectangleF(r.X - sw - Tema.PxF(4), 0, sw, Height), StringAlignment.Far, StringAlignment.Center, true);
        }
    }

    /// <summary>Bölümlü seçim (segment). Tıklayınca Komut, Arg = "AyarAdi=deger" (AyarAdi yoksa yalnız deger).</summary>
    public class SecimGrubu : TemelKontrol, IKomutKaynagi
    {
        string[] secenek = new string[0], deger = new string[0];
        int secili = -1;
        bool izinli = true;
        string neden;
        public string Komut;
        public string AyarAdi;
        public float Pt = 12f;
        public event EventHandler SecimDegisti;

        public SecimGrubu() { Cursor = Cursors.Hand; }
        public SecimGrubu(string[] secenekler, string[] degerler, string komut, string ayarAdi) : this()
        {
            secenek = secenekler ?? new string[0];
            deger = degerler ?? secenek;
            Komut = komut; AyarAdi = ayarAdi; IzinYenile();
        }

        public int Secili { get { return secili; } set { if (secili != value) { secili = value; Invalidate(); } } }
        public string SeciliDeger { get { return secili >= 0 && secili < deger.Length ? deger[secili] : null; } }
        public void DegerSec(string d)
        {
            if (d == null) return;
            for (int i = 0; i < deger.Length; i++)
                if (string.Equals(deger[i], d, StringComparison.OrdinalIgnoreCase)) { Secili = i; return; }
        }
        public void Secenekler(string[] s, string[] d) { secenek = s ?? new string[0]; deger = d ?? secenek; Invalidate(); }

        public void IzinYenile()
        {
            if (string.IsNullOrEmpty(Komut)) return;
            string n; bool iz = Izinler.Izinli(Komut, AyarAdi, out n);
            if (iz != izinli || n != neden) { izinli = iz; neden = n; Invalidate(); }
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (secenek.Length == 0) return;
            int i = (int)(e.X / ((float)Width / secenek.Length));
            if (i < 0 || i >= secenek.Length) return;
            if (!izinli) { KomutYolu.NedenGoster(neden); return; }
            Secili = i;
            var h = SecimDegisti; if (h != null) h(this, EventArgs.Empty);
            if (!string.IsNullOrEmpty(Komut)) KomutYolu.Gonder(Komut, (AyarAdi == null ? "" : AyarAdi + "=") + deger[i]);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            if (secenek.Length == 0) return;
            float k = Math.Max(1, Tema.PxF(1));
            var r = new RectangleF(k / 2, k / 2, Width - k - 1, Height - k - 1);
            float yr = Tema.PxF(8);
            Color yz = Yuzey;
            Func<Color, Color> P = c => izinli ? c : Tema.Pasiflestir(c, yz);
            Tema.YuvarlakDoldur(g, r, yr, P(Tema.Dugme));
            float sw = r.Width / secenek.Length;
            for (int i = 0; i < secenek.Length; i++)
            {
                var sr = new RectangleF(r.X + i * sw, r.Y, sw, r.Height);
                if (i == secili)
                {
                    var ir = new RectangleF(sr.X + Tema.PxF(3), sr.Y + Tema.PxF(3), sr.Width - Tema.PxF(6), sr.Height - Tema.PxF(6));
                    Tema.YuvarlakDoldur(g, ir, yr - 2, P(Tema.Karistir(Tema.Dugme, Tema.Marka, Tema.Koyu ? 0.28f : 0.18f)));
                    Tema.YuvarlakCiz(g, ir, yr - 2, P(Tema.Marka), k * 1.4f);
                }
                else if (i > 0 && i - 1 != secili)
                    using (var p = new Pen(P(Tema.DugmeKenar), k)) g.DrawLine(p, sr.X, sr.Y + sr.Height * 0.25f, sr.X, sr.Bottom - sr.Height * 0.25f);
                Font f = Tema.Sigdir(g, secenek[i], false, i == secili, Pt, 7f, new SizeF(sw - Tema.PxF(10), r.Height * 0.8f));
                Tema.Yaz(g, secenek[i], f, P(i == secili ? Tema.Yazi : Tema.Soluk), sr, StringAlignment.Center, StringAlignment.Center, true);
            }
            Tema.YuvarlakCiz(g, r, yr, P(Tema.DugmeKenar), k);
        }
    }

    /// <summary>Dokununca sayı tuş takımı (ya da metin klavyesi) açan değer kutusu.</summary>
    public class DegerKutusu : TemelKontrol, IKomutKaynagi
    {
        double deger;
        string metin = "";
        bool izinli = true, kirli, bos = true;
        string neden;
        public string Etiket = "";
        public string Birim = "";
        public int Ondalik = 3;
        public double Min = -9999, Max = 9999;
        public bool Metinsel;
        public bool SadeceRakam;
        public int EnCokKarakter;
        public string Komut = "ayar.kaydet";
        public string AyarAdi;
        /// <summary>true: komut göndermez, yalnız Degisti olayı (toplu kayıt için).</summary>
        public bool Yerel;
        public float Pt = 15f;
        public event EventHandler Degisti;

        public DegerKutusu() { Cursor = Cursors.Hand; }

        public double Deger { get { return deger; } set { if (bos || deger != value) { deger = value; bos = false; Invalidate(); } } }
        public string Metin { get { return metin; } set { string v = value ?? ""; if (v != metin) { metin = v; bos = false; Invalidate(); } } }
        public bool Bos { get { return bos; } set { if (bos != value) { bos = value; Invalidate(); } } }
        public bool Kirli { get { return kirli; } set { if (kirli != value) { kirli = value; Invalidate(); } } }
        public string DegerMetni { get { return Metinsel ? metin : (bos ? "" : Bicim.Sayi(deger, Ondalik)); } }

        public void IzinYenile()
        {
            if (Yerel || string.IsNullOrEmpty(Komut)) return;
            string n; bool iz = Izinler.Izinli(Komut, AyarAdi, out n);
            if (iz != izinli || n != neden) { izinli = iz; neden = n; Invalidate(); }
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (!izinli) { KomutYolu.NedenGoster(neden); return; }
            string bas = string.IsNullOrEmpty(Etiket) ? (AyarAdi ?? "Değer") : Etiket;
            if (Metinsel)
            {
                string s = Diyalog.MetinGir(bas, metin, SadeceRakam, EnCokKarakter);
                if (s == null) return;
                Metin = s;
            }
            else
            {
                double? v = Diyalog.SayiGir(bas, bos ? 0 : deger, Min, Max, Ondalik);
                if (!v.HasValue) return;
                Deger = v.Value;
            }
            if (Yerel) Kirli = true;
            var h = Degisti; if (h != null) h(this, EventArgs.Empty);
            if (!Yerel && !string.IsNullOrEmpty(Komut)) KomutYolu.Gonder(Komut, (AyarAdi == null ? "" : AyarAdi + "=") + DegerMetni);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            float k = Math.Max(1, Tema.PxF(1));
            var r = new RectangleF(k / 2, k / 2, Width - k - 1, Height - k - 1);
            Color yz = Yuzey;
            Color dolgu = Tema.Dugme, kenar = kirli ? Tema.Duraklatildi : Tema.DugmeKenar, yazi = Tema.Yazi;
            if (!izinli) { dolgu = Tema.Pasiflestir(dolgu, yz); kenar = Tema.Pasiflestir(kenar, yz); yazi = Tema.Pasiflestir(yazi, yz); }
            Tema.YuvarlakDoldur(g, r, Tema.PxF(8), dolgu);
            Tema.YuvarlakCiz(g, r, Tema.PxF(8), kenar, kirli ? k * 1.8f : k);
            float x = r.X + Tema.PxF(12);
            float sagB = Tema.PxF(30);
            if (!string.IsNullOrEmpty(Etiket) && Width > Tema.Px(220))
            {
                Font fe = Tema.F(10.5f);
                float ew = Math.Min(r.Width * 0.5f, Tema.Olc(g, Etiket, fe).Width + Tema.PxF(12));
                Tema.Yaz(g, Etiket, fe, izinli ? Tema.Soluk : yazi, new RectangleF(x, r.Y, ew, r.Height));
                x += ew;
            }
            string s = bos && !Metinsel ? "—" : DegerMetni;
            if (Metinsel && s.Length == 0) s = "—";
            string b = string.IsNullOrEmpty(Birim) ? "" : " " + Birim;
            Font f = Tema.Sigdir(g, s + b, !Metinsel, true, Pt, 8f, new SizeF(r.Right - sagB - x, r.Height * 0.8f));
            Tema.Yaz(g, s + b, f, yazi, new RectangleF(x, r.Y, r.Right - sagB - x, r.Height), Metinsel ? StringAlignment.Near : StringAlignment.Far, StringAlignment.Center, true);
            // kalem simgesi
            float s2 = Math.Min(Tema.PxF(16), r.Height * 0.4f);
            float px = r.Right - sagB + (sagB - s2) / 2, py = r.Y + (r.Height - s2) / 2;
            using (var p = new Pen(izinli ? Tema.Soluk : yazi, Math.Max(1.2f, s2 * 0.12f)))
            {
                p.StartCap = LineCap.Round; p.EndCap = LineCap.Round;
                g.DrawLine(p, px + s2 * 0.15f, py + s2 * 0.85f, px + s2 * 0.85f, py + s2 * 0.15f);
                g.DrawLine(p, px + s2 * 0.1f, py + s2 * 0.95f, px + s2 * 0.35f, py + s2 * 0.95f);
            }
        }
    }

    /// <summary>Ayar satırı: solda başlık + açıklama, sağda kontrol.</summary>
    public class AyarSatiri : Panel, IOlcekli
    {
        string baslik, aciklama;
        Control sag;
        public float SagGenislik = 240f;
        public bool Ayrac = true;

        public AyarSatiri(string baslik, string aciklama, Control sagKontrol, float sagGenislik)
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            DoubleBuffered = true; Margin = Padding.Empty;
            this.baslik = baslik ?? ""; this.aciklama = aciklama ?? "";
            sag = sagKontrol; SagGenislik = sagGenislik;
            if (sag != null) Controls.Add(sag);
        }
        public Control Sag { get { return sag; } }
        public string Aciklama { get { return aciklama; } set { if (value != aciklama) { aciklama = value ?? ""; Invalidate(); } } }
        public void Olcekle() { PerformLayout(); }

        protected override void OnLayout(LayoutEventArgs e)
        {
            if (sag == null) return;
            int w = Math.Min(Tema.Px(SagGenislik), Width / 2);
            int h = Math.Min(Height - Tema.Px(12), Tema.Px(50));
            sag.SetBounds(Width - w, (Height - h) / 2, w, h);
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            var g = e.Graphics; g.Clear(BackColor); Tema.Hazirla(g);
            int w = sag == null ? 0 : Math.Min(Tema.Px(SagGenislik), Width / 2) + Tema.Px(16);
            var alan = new RectangleF(0, 0, Width - w, Height);
            Font fb = Tema.F(12.5f, true), fa = Tema.F(10f);
            float hb = fb.GetHeight(g), ha = aciklama.Length > 0 ? Tema.Olc(g, aciklama, fa, (int)alan.Width).Height : 0;
            if (ha > Height - hb - Tema.PxF(8)) ha = Height - hb - Tema.PxF(8);
            float y = (Height - hb - ha) / 2;
            Tema.Yaz(g, baslik, fb, Tema.Yazi, new RectangleF(0, y, alan.Width, hb + 2));
            if (aciklama.Length > 0) Tema.Yaz(g, aciklama, fa, Tema.Soluk, new RectangleF(0, y + hb, alan.Width, ha + 2), StringAlignment.Near, StringAlignment.Near, false);
            if (Ayrac) using (var p = new Pen(Tema.Ayrac, Math.Max(1, Tema.PxF(1)))) g.DrawLine(p, 0, Height - 1, Width, Height - 1);
        }
    }

    /// <summary>Tablo satırı.</summary>
    public class TabloSatiri
    {
        public string[] Hucreler;
        public Color Renk = Color.Empty;
        public int VurguSutun = -1;
        public Color VurguRenk = Color.Empty;
        public bool Kalin;
        public object Etiket;
        public TabloSatiri(params string[] h) { Hucreler = h; }
    }

    /// <summary>Kendisi çizen basit tablo (dokunarak satır seçimi).</summary>
    public class Tablo : TemelKontrol
    {
        string[] sutun = new string[0];
        float[] oran = new float[0];
        StringAlignment[] hiza = new StringAlignment[0];
        List<TabloSatiri> satir = new List<TabloSatiri>();
        int secili = -1;
        public bool Secilebilir;
        public float SatirH = 40f;
        public bool SayiYazisi = true;
        public float Pt = 12f;
        /// <summary>Başlık satırı çizilmez.</summary>
        public bool BaslikYok;
        public event Action<int> SatirSecildi;

        public Tablo(string[] sutunlar, float[] oranlar)
        {
            sutun = sutunlar; oran = oranlar;
            hiza = new StringAlignment[sutun.Length];
            for (int i = 1; i < hiza.Length; i++) hiza[i] = StringAlignment.Far;
        }
        public void Hiza(params StringAlignment[] h) { if (h.Length == sutun.Length) hiza = h; Invalidate(); }
        public int Secili { get { return secili; } set { if (secili != value) { secili = value; Invalidate(); } } }
        public List<TabloSatiri> Satirlar { get { return satir; } }

        public void Ayarla(List<TabloSatiri> yeni)
        {
            yeni = yeni ?? new List<TabloSatiri>();
            bool ayni = yeni.Count == satir.Count;
            if (ayni)
                for (int i = 0; i < yeni.Count && ayni; i++)
                {
                    var a = yeni[i]; var b = satir[i];
                    if (a.Renk != b.Renk || a.VurguRenk != b.VurguRenk || a.VurguSutun != b.VurguSutun || a.Kalin != b.Kalin || a.Hucreler.Length != b.Hucreler.Length) ayni = false;
                    else for (int j = 0; j < a.Hucreler.Length; j++) if (a.Hucreler[j] != b.Hucreler[j]) { ayni = false; break; }
                }
            if (ayni) return;
            satir = yeni; Invalidate();
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (!Secilebilir) return;
            float bh = BaslikYok ? 0 : Tema.PxF(32), sh = Tema.PxF(SatirH);
            int i = (int)((e.Y - bh) / sh);
            if (e.Y < bh || i < 0 || i >= satir.Count) return;
            Secili = i;
            var h = SatirSecildi; if (h != null) h(i);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            float top = 0; foreach (var o in oran) top += o;
            float bh = BaslikYok ? 0 : Tema.PxF(32), sh = Tema.PxF(SatirH);
            float pad = Tema.PxF(10);
            float[] x = new float[sutun.Length + 1];
            for (int i = 0; i < sutun.Length; i++) x[i + 1] = x[i] + Width * oran[i] / top;
            Font fb = Tema.F(9.5f, true);
            if (!BaslikYok)
            {
                for (int i = 0; i < sutun.Length; i++)
                    Tema.Yaz(g, Bicim.BuyukHarf(sutun[i]), fb, Tema.Soluk, new RectangleF(x[i] + pad, 0, x[i + 1] - x[i] - 2 * pad, bh), hiza[i], StringAlignment.Center, true);
                using (var p = new Pen(Tema.KartKenar, Math.Max(1, Tema.PxF(1)))) g.DrawLine(p, 0, bh - 1, Width, bh - 1);
            }
            Font f = SayiYazisi ? Tema.Sayi(Pt) : Tema.F(Pt);
            Font fk = SayiYazisi ? Tema.Sayi(Pt, true) : Tema.F(Pt, true);
            Font f0 = Tema.F(Pt, true);
            for (int r = 0; r < satir.Count; r++)
            {
                float y = bh + r * sh;
                if (y > Height) break;
                var rr = new RectangleF(0, y, Width, sh);
                if (r == secili) Tema.YuvarlakDoldur(g, new RectangleF(rr.X, rr.Y + 2, rr.Width, rr.Height - 4), Tema.PxF(6), Tema.Karistir(Yuzey, Tema.Marka, Tema.Koyu ? 0.16f : 0.12f));
                else if (r % 2 == 1) using (var b = new SolidBrush(Tema.Karistir(Yuzey, Tema.Ayrac, 0.45f))) g.FillRectangle(b, rr);
                var s = satir[r];
                Color c = s.Renk.IsEmpty ? Tema.Yazi : s.Renk;
                for (int i = 0; i < sutun.Length && i < s.Hucreler.Length; i++)
                {
                    Color cc = (i == s.VurguSutun && !s.VurguRenk.IsEmpty) ? s.VurguRenk : (i == 0 ? (s.Renk.IsEmpty ? Tema.Yazi : c) : c);
                    Font ff = i == 0 ? f0 : (s.Kalin ? fk : f);
                    Tema.Yaz(g, s.Hucreler[i], ff, cc, new RectangleF(x[i] + pad, y, x[i + 1] - x[i] - 2 * pad, sh), hiza[i], StringAlignment.Center, true);
                }
                if (r == secili)
                    Tema.YuvarlakDoldur(g, new RectangleF(0, y + sh * 0.2f, Tema.PxF(4), sh * 0.6f), Tema.PxF(2), Tema.Marka);
            }
            if (satir.Count == 0)
                Tema.Yaz(g, "Veri yok", Tema.F(11f), Tema.Soluk, new RectangleF(0, bh, Width, sh), StringAlignment.Center, StringAlignment.Center, true);
        }
    }

    /// <summary>Kayıt (log) listesi: renkli tür, sürükleyerek/tekerlekle kaydırma, filtre.</summary>
    public class KayitListesi : TemelKontrol
    {
        List<KayitSatiri> tum = new List<KayitSatiri>();
        List<KayitSatiri> gor = new List<KayitSatiri>();
        int ust; // ilk görünen satır
        bool takip = true;
        int surukleY = -1, surukleUst;
        HashSet<MesajTuru> filtre;

        public KayitListesi() { }

        float SatirH { get { return Tema.PxF(34); } }
        int Sigan { get { return Math.Max(1, (int)(Height / SatirH)); } }

        public void Ayarla(List<KayitSatiri> liste)
        {
            liste = liste ?? new List<KayitSatiri>();
            if (liste.Count == tum.Count && (liste.Count == 0 || ReferenceEquals(liste[liste.Count - 1], tum[tum.Count - 1]) ||
                (liste[liste.Count - 1].Metin == tum[tum.Count - 1].Metin && liste[liste.Count - 1].Zaman == tum[tum.Count - 1].Zaman))) return;
            tum = new List<KayitSatiri>(liste);
            Suz();
        }

        /// <summary>null = tümü.</summary>
        public void Filtre(params MesajTuru[] turler)
        {
            filtre = (turler == null || turler.Length == 0) ? null : new HashSet<MesajTuru>(turler);
            takip = true; Suz();
        }

        void Suz()
        {
            gor = filtre == null ? tum : tum.Where(k => filtre.Contains(k.Tur)).ToList();
            if (takip) ust = Math.Max(0, gor.Count - Sigan);
            Sinirla();
            Invalidate();
        }
        void Sinirla()
        {
            int enCok = Math.Max(0, gor.Count - Sigan);
            if (ust > enCok) ust = enCok;
            if (ust < 0) ust = 0;
            takip = ust >= enCok;
        }
        public void Kaydir(int satir) { ust += satir; Sinirla(); Invalidate(); }
        public void Sona() { ust = int.MaxValue; Sinirla(); Invalidate(); }

        protected override void OnResize(EventArgs e) { base.OnResize(e); if (takip) ust = Math.Max(0, gor.Count - Sigan); Sinirla(); }
        protected override void OnMouseWheel(MouseEventArgs e) { base.OnMouseWheel(e); Kaydir(-e.Delta / 40); }
        protected override void OnMouseDown(MouseEventArgs e) { base.OnMouseDown(e); surukleY = e.Y; surukleUst = ust; Focus(); }
        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            if (surukleY < 0) return;
            int d = (int)((surukleY - e.Y) / SatirH);
            if (surukleUst + d != ust) { ust = surukleUst + d; Sinirla(); Invalidate(); }
        }
        protected override void OnMouseUp(MouseEventArgs e) { base.OnMouseUp(e); surukleY = -1; }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            float sh = SatirH;
            Font fz = Tema.Sayi(10.5f), fm = Tema.F(11.5f);
            float zw = Tema.Olc(g, "00:00:00", fz).Width + Tema.PxF(16);
            for (int i = 0; i < Sigan + 1; i++)
            {
                int k = ust + i;
                if (k >= gor.Count) break;
                var s = gor[k];
                float y = i * sh;
                Color tc = Tema.TurRengi(s.Tur);
                if (s.Tur == MesajTuru.Hata || s.Tur == MesajTuru.Uyari)
                    using (var b = new SolidBrush(Tema.Karistir(Yuzey, tc, Tema.Koyu ? 0.10f : 0.07f))) g.FillRectangle(b, 0, y + 1, Width - Tema.PxF(10), sh - 2);
                Tema.YuvarlakDoldur(g, new RectangleF(Tema.PxF(4), y + sh * 0.22f, Tema.PxF(4), sh * 0.56f), Tema.PxF(2), tc);
                Tema.Yaz(g, s.Zaman.ToString("HH:mm:ss", Bicim.Inv), fz, Tema.Soluk, new RectangleF(Tema.PxF(16), y, zw, sh));
                Color mc = s.Tur == MesajTuru.Bilgi ? Tema.Yazi : tc;
                if (s.Tur == MesajTuru.Basari) mc = Tema.Yazi;
                Tema.Yaz(g, s.Metin, fm, mc, new RectangleF(Tema.PxF(16) + zw, y, Width - zw - Tema.PxF(34), sh));
            }
            if (gor.Count == 0)
                Tema.Yaz(g, "Kayıt yok", Tema.F(12f), Tema.Soluk, new RectangleF(0, 0, Width, sh * 2), StringAlignment.Center, StringAlignment.Center, true);
            // kaydırma göstergesi
            if (gor.Count > Sigan)
            {
                float h = Math.Max(Tema.PxF(24), Height * Sigan / (float)gor.Count);
                float y = (Height - h) * ust / (float)Math.Max(1, gor.Count - Sigan);
                Tema.YuvarlakDoldur(g, new RectangleF(Width - Tema.PxF(6), y, Tema.PxF(4), h), Tema.PxF(2), Tema.DugmeKenar);
            }
        }
    }

    /// <summary>Sihirbaz adım göstergesi (① ② ③ ...). Dokununca AdimSecildi(index).</summary>
    public class AdimGostergesi : TemelKontrol
    {
        string[] adim = new string[0];
        int etkin;
        public event Action<int> AdimSecildi;

        public AdimGostergesi(string[] adimlar) { adim = adimlar; Cursor = Cursors.Hand; }
        public int Etkin { get { return etkin; } set { if (etkin != value) { etkin = value; Invalidate(); } } }
        /// <summary>Uyarı/kilitli adım (ör. prob testi geçilmedi) – kehribar halka.</summary>
        public int Kilitli = -1;

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (adim.Length == 0) return;
            int i = (int)(e.X / ((float)Width / adim.Length));
            if (i < 0 || i >= adim.Length) return;
            var h = AdimSecildi; if (h != null) h(i);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            int n = adim.Length; if (n == 0) return;
            float sw = (float)Width / n;
            float d = Math.Min(Tema.PxF(34), Height * 0.5f);
            float cy = Tema.PxF(4) + d / 2;
            using (var p = new Pen(Tema.KartKenar, Math.Max(2, Tema.PxF(2))))
                for (int i = 0; i < n - 1; i++)
                {
                    p.Color = i < etkin ? Tema.Hazir : Tema.KartKenar;
                    g.DrawLine(p, sw * i + sw / 2 + d / 2 + Tema.PxF(4), cy, sw * (i + 1) + sw / 2 - d / 2 - Tema.PxF(4), cy);
                }
            Font fn = Tema.F(12f, true), fl = Tema.F(10f);
            for (int i = 0; i < n; i++)
            {
                float cx = sw * i + sw / 2;
                var r = new RectangleF(cx - d / 2, cy - d / 2, d, d);
                if (i < etkin)
                {
                    using (var b = new SolidBrush(Tema.Hazir)) g.FillEllipse(b, r);
                    Ikon.Ciz(g, Simge.Tamam, new RectangleF(r.X + d * 0.22f, r.Y + d * 0.22f, d * 0.56f, d * 0.56f), Tema.UstYazi(Tema.Hazir));
                }
                else if (i == etkin)
                {
                    using (var b = new SolidBrush(Tema.Marka)) g.FillEllipse(b, r);
                    Tema.Yaz(g, (i + 1).ToString(Bicim.Inv), fn, Tema.UstYazi(Tema.Marka), r, StringAlignment.Center, StringAlignment.Center, true);
                }
                else
                {
                    using (var p = new Pen(i == Kilitli ? Tema.Duraklatildi : Tema.DugmeKenar, Math.Max(1.5f, Tema.PxF(2)))) g.DrawEllipse(p, r);
                    Tema.Yaz(g, (i + 1).ToString(Bicim.Inv), fn, Tema.Soluk, r, StringAlignment.Center, StringAlignment.Center, true);
                }
                var lr = new RectangleF(sw * i + Tema.PxF(2), cy + d / 2 + Tema.PxF(4), sw - Tema.PxF(4), Height - (cy + d / 2 + Tema.PxF(4)));
                Font ff = Tema.Sigdir(g, adim[i], false, i == etkin, 10.5f, 7f, lr.Size);
                Tema.Yaz(g, adim[i], ff, i == etkin ? Tema.Yazi : Tema.Soluk, lr, StringAlignment.Center, StringAlignment.Near, true);
            }
        }
    }

    /// <summary>Takım yuvası kartı.</summary>
    public class YuvaKarti : TemelKontrol
    {
        YuvaBilgisi bilgi = new YuvaBilgisi();
        bool secili;
        public event EventHandler Secildi;
        public YuvaKarti() { Cursor = Cursors.Hand; }

        public YuvaBilgisi Bilgi { get { return bilgi; } set { bilgi = value ?? new YuvaBilgisi(); Invalidate(); } }
        FrezOmruBilgisi omur;
        string omurImza = "";
        /// <summary>Bu yuvadaki frezin ömrü (null = gösterme). Yalnız değişince yeniden çizilir.</summary>
        public FrezOmruBilgisi Omur
        {
            get { return omur; }
            set
            {
                string im = value == null ? "" : OmurCizim.Kisa(value) + "|" + value.Seviye.ToString(Bicim.Inv);
                omur = value;
                if (im != omurImza) { omurImza = im; Invalidate(); }
            }
        }
        public bool Secili { get { return secili; } set { if (secili != value) { secili = value; Invalidate(); } } }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            var h = Secildi; if (h != null) h(this, EventArgs.Empty);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            float k = Math.Max(1, Tema.PxF(1));
            var r = new RectangleF(k, k, Width - 2 * k - 1, Height - 2 * k - 1);
            Color durumR; Simge sm; string dm;
            if (bilgi.IsMilinde) { durumR = Tema.Calisiyor; sm = Simge.IsMili; dm = "İŞ MİLİNDE"; }
            else if (!string.IsNullOrEmpty(bilgi.Uyari)) { durumR = Tema.Duraklatildi; sm = Simge.Uyari; dm = bilgi.Uyari; }
            else if (!bilgi.Dolu) { durumR = Tema.Pasif; sm = Simge.Eksi; dm = "BOŞ"; }
            else if (bilgi.Kayitli) { durumR = Tema.Hazir; sm = Simge.Tamam; dm = "HAZIR"; }
            else { durumR = Tema.Duraklatildi; sm = Simge.Uyari; dm = "KAYIT YOK"; }
            Color dolgu = secili ? Tema.Karistir(Tema.Dugme, Tema.Marka, Tema.Koyu ? 0.18f : 0.12f) : Tema.Dugme;
            Tema.YuvarlakDoldur(g, r, Tema.PxF(10), dolgu);
            Tema.YuvarlakCiz(g, r, Tema.PxF(10), secili ? Tema.Marka : (bilgi.IsMilinde ? Tema.Calisiyor : Tema.DugmeKenar), secili || bilgi.IsMilinde ? k * 2.2f : k);
            string ad = bilgi.Ad ?? "";
            float ust = r.Height * 0.44f;
            Font f = Tema.Sigdir(g, ad, false, true, ad.Length > 2 ? 13f : 22f, 8f, new SizeF(r.Width - Tema.PxF(12), ust * 0.8f));
            Tema.Yaz(g, ad, f, bilgi.Dolu || bilgi.IsMilinde ? Tema.Yazi : Tema.Soluk, new RectangleF(r.X, r.Y + Tema.PxF(4), r.Width, ust), StringAlignment.Center, StringAlignment.Center, true);
            float sb = Math.Min(Tema.PxF(20), r.Height * 0.17f);
            float sy = r.Y + ust + Tema.PxF(2);
            Ikon.Ciz(g, sm, new RectangleF(r.X + (r.Width - sb) / 2, sy, sb, sb), durumR);
            Font fd = Tema.Sigdir(g, dm, false, true, 9f, 6.5f, new SizeF(r.Width - Tema.PxF(8), Tema.PxF(16)));
            Tema.Yaz(g, dm, fd, durumR, new RectangleF(r.X + Tema.PxF(4), sy + sb + Tema.PxF(2), r.Width - Tema.PxF(8), fd.GetHeight(g) + 2), StringAlignment.Center, StringAlignment.Near, true);
            float altY = r.Bottom - Tema.PxF(6);
            if (!string.IsNullOrEmpty(bilgi.Aciklama))
            {
                Font fa = Tema.F(9f);
                altY = r.Bottom - fa.GetHeight(g) - Tema.PxF(6);
                Tema.Yaz(g, bilgi.Aciklama, fa, Tema.Soluk, new RectangleF(r.X + Tema.PxF(4), altY, r.Width - Tema.PxF(8), fa.GetHeight(g) + 2), StringAlignment.Center, StringAlignment.Near, true);
            }
            if (omur != null)
            {
                // Frez ömrü: "%23" (renkli) / "230 / 1000 dk" (soluk) / ince çubuk; ömür girilmediyse "412 dk" / "ömür girilmedi"
                float ust2 = sy + sb + Tema.PxF(2) + fd.GetHeight(g) + Tema.PxF(4);
                float cy = altY - Tema.PxF(6), ch = Math.Max(3f, Tema.PxF(4));
                float gx = r.X + Tema.PxF(10), gw = r.Width - Tema.PxF(20);
                Color oc = OmurCizim.Renk(omur);
                string s1 = OmurCizim.Yuzde(omur), s2 = OmurCizim.DakikaOmur(omur);
                if (omur.Omur <= 0) { s1 = OmurCizim.Dk(omur.Dakika) + " dk"; s2 = "ömür girilmedi"; }
                Font f2 = Tema.Sigdir(g, s2, false, false, 9f, 6f, new SizeF(r.Width - Tema.PxF(8), Tema.PxF(15)));
                float h2 = f2.GetHeight(g);
                float y2 = cy - ch - Tema.PxF(3) - h2;
                Font f1 = Tema.Sigdir(g, s1, true, true, 11f, 7f, new SizeF(gw, Math.Max(Tema.PxF(10), y2 - ust2)));
                float h1 = f1.GetHeight(g);
                float y1 = y2 - h1;
                if (y1 >= ust2 - Tema.PxF(2))
                {
                    Tema.Yaz(g, s1, f1, omur.Omur > 0 ? oc : Tema.Yazi, new RectangleF(r.X + Tema.PxF(4), y1, r.Width - Tema.PxF(8), h1 + 1), StringAlignment.Center, StringAlignment.Near, true);
                    Tema.Yaz(g, s2, f2, Tema.Soluk, new RectangleF(r.X + Tema.PxF(4), y2, r.Width - Tema.PxF(8), h2 + 1), StringAlignment.Center, StringAlignment.Near, true);
                }
                OmurCizim.Cubuk(g, new RectangleF(gx, cy - ch, gw, ch), omur);
            }
        }
    }

    /// <summary>Frez ömrü çizim yardımcıları (Takımlar kartları, Frez ömrü sekmesi, Üretim TAKIM kartı ortak).</summary>
    public static class OmurCizim
    {
        /// <summary>&lt; %80 normal (yeşil çubuk), %80–99 kehribar (Duraklatıldı), ≥ %100 kırmızı (Alarm); ömür yoksa soluk.</summary>
        public static Color Renk(FrezOmruBilgisi f)
        {
            if (f == null || f.Omur <= 0) return Tema.Soluk;
            switch (f.Seviye) { case 2: return Tema.Alarm; case 1: return Tema.Duraklatildi; default: return Tema.Hazir; }
        }
        /// <summary>Yazı rengi: normalde düz yazı, eşiklerde durum rengi.</summary>
        public static Color YaziRengi(FrezOmruBilgisi f)
        {
            if (f == null || f.Omur <= 0 || f.Seviye == 0) return Tema.Yazi;
            return Renk(f);
        }
        /// <summary>Dakika: 100'ün altında 1 ondalık ("37.5"), üstünde tam sayı ("1043").</summary>
        public static string Dk(double dk)
        {
            if (dk < 0) dk = 0;
            if (dk < 99.95) return dk.ToString("0.0", Bicim.Inv);
            return Math.Round(dk).ToString("0", Bicim.Inv);
        }
        /// <summary>"3 sa 50 dk"</summary>
        public static string Saat(double dk)
        {
            if (dk < 0) dk = 0;
            int t = (int)Math.Floor(dk);
            if (t < 60) return t.ToString(Bicim.Inv) + " dk";
            return (t / 60).ToString(Bicim.Inv) + " sa " + (t % 60).ToString(Bicim.Inv) + " dk";
        }
        /// <summary>"%23" (aşağı yuvarlanır; 999.9 dk / 1000 → %99); ömür yoksa "".</summary>
        public static string Yuzde(FrezOmruBilgisi f)
        {
            if (f == null || f.Omur <= 0) return "";
            return "%" + Math.Floor(f.Yuzde + 1e-9).ToString("0", Bicim.Inv);
        }
        /// <summary>"230 / 1000 dk"; ömür yoksa "230 dk".</summary>
        public static string DakikaOmur(FrezOmruBilgisi f)
        {
            if (f == null) return "";
            if (f.Omur <= 0) return Dk(f.Dakika) + " dk";
            return Dk(f.Dakika) + " / " + Dk(f.Omur) + " dk";
        }
        /// <summary>"230 / 1000 dk · %23"; ömür yoksa "230 dk · ömür girilmedi".</summary>
        public static string Kisa(FrezOmruBilgisi f)
        {
            if (f == null) return "";
            if (f.Omur <= 0) return Dk(f.Dakika) + " dk · ömür girilmedi";
            return DakikaOmur(f) + " · " + Yuzde(f);
        }
        /// <summary>İnce ömür çubuğu (iz + dolgu; %100 üstü tam dolu).</summary>
        public static void Cubuk(Graphics g, RectangleF r, FrezOmruBilgisi f)
        {
            if (r.Width < 4 || r.Height < 1) return;
            float yr = r.Height / 2;
            Tema.YuvarlakDoldur(g, r, yr, Tema.Ayrac);
            if (f == null || f.Omur <= 0) return;
            float w = (float)(r.Width * Math.Max(0, Math.Min(100, f.Yuzde)) / 100.0);
            if (w <= 0.5f) return;
            Tema.YuvarlakDoldur(g, new RectangleF(r.X, r.Y, Math.Max(w, Math.Min(r.Height, r.Width)), r.Height), yr, Renk(f));
        }
        /// <summary>Listede takım numarasını bul (yoksa null).</summary>
        public static FrezOmruBilgisi Bul(MakineDurumu d, int takim)
        {
            if (d == null || d.FrezOmurleri == null) return null;
            foreach (var f in d.FrezOmurleri) if (f != null && f.Takim == takim) return f;
            return null;
        }
    }

    /// <summary>Takımlar › Frez ömrü sekmesindeki tek takım satırı (çizim). Düğmeler (ÖMRÜ AYARLA / SIFIRLA) ayrı TouchButton.</summary>
    public class FrezOmruSatiri : TemelKontrol
    {
        FrezOmruBilgisi bilgi;
        bool isMilinde;
        string imza = "";
        public int Takim = 1;

        public void Ayarla(FrezOmruBilgisi f, bool milde)
        {
            string im = f == null ? "" : OmurCizim.Kisa(f) + "|" + f.Seviye.ToString(Bicim.Inv) + "|" + (f.Sifirlama ?? "") + "|" + OmurCizim.Saat(f.Dakika);
            im += milde ? "|M" : "";
            bilgi = f; isMilinde = milde;
            if (im != imza) { imza = im; Invalidate(); }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            float k = Math.Max(1, Tema.PxF(1));
            var r = new RectangleF(k, k, Width - 2 * k - 1, Height - 2 * k - 1);
            var f = bilgi ?? new FrezOmruBilgisi(Takim, 0, 0, "");
            Color oc = OmurCizim.Renk(f);
            Color kenar = f.Omur > 0 && f.Seviye > 0 ? oc : (isMilinde ? Tema.Calisiyor : Tema.DugmeKenar);
            Tema.YuvarlakDoldur(g, r, Tema.PxF(8), Tema.Dugme);
            Tema.YuvarlakCiz(g, r, Tema.PxF(8), kenar, f.Omur > 0 && f.Seviye > 0 || isMilinde ? k * 2f : k);
            float p = Tema.PxF(12);
            float x = r.X + p, w = r.Width - 2 * p, h = r.Height;
            // sütunlar: ad 12 % · kullanılan 25 % · çubuk 35 % · ömür / sıfırlama 28 %
            float wAd = w * 0.12f, wKul = w * 0.25f, wCub = w * 0.35f, wOm = w - wAd - wKul - wCub;
            float gap = Tema.PxF(10);
            string ad = "T" + f.Takim.ToString(Bicim.Inv);
            Font fAd = Tema.Sigdir(g, ad, false, true, 20f, 10f, new SizeF(wAd - gap, h * 0.55f));
            float ust = r.Y, yAd = isMilinde ? r.Y + h * 0.08f : r.Y;
            Tema.Yaz(g, ad, fAd, Tema.Yazi, new RectangleF(x, yAd, wAd - gap, isMilinde ? h * 0.6f : h), StringAlignment.Near, StringAlignment.Center, true);
            if (isMilinde)
            {
                Font fm = Tema.Sigdir(g, "İŞ MİLİNDE", false, true, 7.5f, 5.5f, new SizeF(wAd - Tema.PxF(4), h * 0.3f));
                Tema.Yaz(g, "İŞ MİLİNDE", fm, Tema.Calisiyor, new RectangleF(x, r.Y + h * 0.62f, wAd, h * 0.3f), StringAlignment.Near, StringAlignment.Near, true);
            }
            x += wAd;
            // kullanılan
            string kul = OmurCizim.Dk(f.Dakika) + " dk", kulAlt = OmurCizim.Saat(f.Dakika) + " kesim";
            Font fK = Tema.Sigdir(g, kul, true, true, 15f, 8f, new SizeF(wKul - gap, h * 0.45f));
            Font fK2 = Tema.Sigdir(g, kulAlt, false, false, 9.5f, 6.5f, new SizeF(wKul - gap, h * 0.3f));
            float hk = fK.GetHeight(g), hk2 = fK2.GetHeight(g), yk = ust + (h - hk - hk2) / 2;
            Tema.Yaz(g, kul, fK, OmurCizim.YaziRengi(f), new RectangleF(x, yk, wKul - gap, hk + 1), StringAlignment.Near, StringAlignment.Near, true);
            Tema.Yaz(g, kulAlt, fK2, Tema.Soluk, new RectangleF(x, yk + hk, wKul - gap, hk2 + 1), StringAlignment.Near, StringAlignment.Near, true);
            x += wKul;
            // çubuk + yüzde
            string yz = f.Omur > 0 ? OmurCizim.Yuzde(f) : "ömür girilmedi";
            string yzSag = f.Omur > 0 ? (f.Seviye == 2 ? "DOLDU" : (f.Seviye == 1 ? "YAKLAŞIYOR" : "")) : "";
            Font fY = f.Omur > 0 ? Tema.Sigdir(g, yz, true, true, 14f, 8f, new SizeF(wCub * 0.5f, h * 0.42f)) : Tema.Sigdir(g, yz, false, false, 10f, 6.5f, new SizeF(wCub - gap, h * 0.42f));
            float hy = fY.GetHeight(g), ch = Math.Max(4f, Tema.PxF(7));
            float yy = ust + (h - hy - Tema.PxF(6) - ch) / 2;
            Tema.Yaz(g, yz, fY, f.Omur > 0 ? oc : Tema.Soluk, new RectangleF(x, yy, wCub - gap, hy + 1), StringAlignment.Near, StringAlignment.Near, true);
            if (yzSag.Length > 0)
            {
                Font fs = Tema.Sigdir(g, yzSag, false, true, 8.5f, 6f, new SizeF(wCub * 0.45f, hy));
                Tema.Yaz(g, yzSag, fs, oc, new RectangleF(x, yy, wCub - gap, hy + 1), StringAlignment.Far, StringAlignment.Center, true);
            }
            OmurCizim.Cubuk(g, new RectangleF(x, yy + hy + Tema.PxF(6), wCub - gap, ch), f);
            x += wCub;
            // ömür + son sıfırlama
            string om = f.Omur > 0 ? "Ömür " + OmurCizim.Dk(f.Omur) + " dk" : "Ömür: —";
            string sf = string.IsNullOrEmpty(f.Sifirlama) ? "Sıfırlanmadı" : "Yeni frez " + f.Sifirlama;
            Font fO = Tema.Sigdir(g, om, true, false, 11f, 7f, new SizeF(wOm, h * 0.4f));
            Font fS = Tema.Sigdir(g, sf, false, false, 9f, 6f, new SizeF(wOm, h * 0.3f));
            float ho = fO.GetHeight(g), hs = fS.GetHeight(g), yo = ust + (h - ho - hs) / 2;
            Tema.Yaz(g, om, fO, f.Omur > 0 ? Tema.Yazi : Tema.Soluk, new RectangleF(x, yo, wOm, ho + 1), StringAlignment.Near, StringAlignment.Near, true);
            Tema.Yaz(g, sf, fS, Tema.Soluk, new RectangleF(x, yo + ho, wOm, hs + 1), StringAlignment.Near, StringAlignment.Near, true);
        }
    }

    /// <summary>Prob testi göstergesi: TEMAS VAR (yeşil) / TEMAS YOK.</summary>
    public class ProbGostergesi : TemelKontrol
    {
        bool aktif, temas;
        public bool Aktif { get { return aktif; } set { if (aktif != value) { aktif = value; Invalidate(); } } }
        public bool Temas { get { return temas; } set { if (temas != value) { temas = value; Invalidate(); } } }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            float d = Math.Min(Width, Height) - Tema.PxF(8);
            var r = new RectangleF((Width - d) / 2, (Height - d) / 2, d, d);
            string s; Color c;
            if (!aktif) { s = "TEST\nKAPALI"; c = Tema.Pasif; }
            else if (temas) { s = "TEMAS\nVAR"; c = Tema.Hazir; }
            else { s = "TEMAS\nYOK"; c = Tema.Soluk; }
            if (aktif && temas)
            {
                using (var b = new SolidBrush(Tema.Alfa(c, 60))) g.FillEllipse(b, r);
                var ic = RectangleF.Inflate(r, -d * 0.08f, -d * 0.08f);
                using (var b = new SolidBrush(c)) g.FillEllipse(b, ic);
                Tema.Yaz(g, s, Tema.Sigdir(g, "TEMAS", false, true, 18f, 8f, new SizeF(d * 0.62f, d * 0.25f)), Tema.UstYazi(c), ic, StringAlignment.Center, StringAlignment.Center, false);
            }
            else
            {
                using (var p = new Pen(c, Math.Max(2, d * 0.04f))) { if (!aktif) p.DashStyle = DashStyle.Dash; g.DrawEllipse(p, RectangleF.Inflate(r, -d * 0.04f, -d * 0.04f)); }
                Tema.Yaz(g, s, Tema.Sigdir(g, "TEMAS", false, true, 18f, 8f, new SizeF(d * 0.62f, d * 0.25f)), c, r, StringAlignment.Center, StringAlignment.Center, false);
            }
        }
    }

    /// <summary>SimView yuvası. Denetleyici SimView'i buraya (Controls.Add, Dock=Fill) ekler; boşken yer tutucu çizer.</summary>
    public class SimHostPanel : Panel
    {
        string dosya = "";
        public SimHostPanel()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            DoubleBuffered = true; Margin = Padding.Empty;
        }
        public string Dosya { get { return dosya; } set { if ((value ?? "") != dosya) { dosya = value ?? ""; Invalidate(); } } }
        protected override void OnControlAdded(ControlEventArgs e) { base.OnControlAdded(e); Invalidate(); }
        protected override void OnControlRemoved(ControlEventArgs e) { base.OnControlRemoved(e); Invalidate(); }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            var g = e.Graphics; g.Clear(BackColor);
            if (Controls.Count > 0) return;
            Tema.Hazirla(g);
            float m = Math.Min(Width, Height);
            var r = new RectangleF(1, 1, Width - 3, Height - 3);
            using (var p = Tema.Yuvarlak(r, Tema.PxF(8)))
            using (var pen = new Pen(Tema.KartKenar, Math.Max(1, Tema.PxF(1.5f))))
            {
                pen.DashStyle = DashStyle.Dash;
                using (var b = new SolidBrush(Tema.Karistir(BackColor, Tema.Zemin, 0.5f))) g.FillPath(b, p);
                g.DrawPath(pen, p);
            }
            // stilize disk (üstten görünüş)
            float d = m * 0.56f;
            float cx = Width / 2f, cy = Height / 2f - m * 0.06f;
            var dr = new RectangleF(cx - d / 2, cy - d / 2, d, d);
            using (var b = new SolidBrush(Tema.Karistir(BackColor, Tema.Soluk, 0.10f))) g.FillEllipse(b, dr);
            using (var pen = new Pen(Tema.Karistir(BackColor, Tema.Soluk, 0.45f), Math.Max(1, Tema.PxF(1.5f)))) g.DrawEllipse(pen, dr);
            using (var b = new SolidBrush(Tema.Karistir(BackColor, Tema.Marka, 0.35f)))
            {
                for (int i = 0; i < 6; i++)
                {
                    double a = Math.PI * 2 * i / 6 - Math.PI / 2;
                    float rr = d * 0.3f, ds = d * 0.13f;
                    float x = cx + (float)Math.Cos(a) * rr, y = cy + (float)Math.Sin(a) * rr;
                    g.FillEllipse(b, x - ds / 2, y - ds / 2, ds, ds * 1.15f);
                }
            }
            using (var pen = new Pen(Tema.Karistir(BackColor, Tema.Soluk, 0.3f), Math.Max(1, Tema.PxF(1)))) g.DrawEllipse(pen, cx - d * 0.06f, cy - d * 0.06f, d * 0.12f, d * 0.12f);
            string s = dosya.Length > 0 ? dosya : "Simülasyon görünümü";
            Tema.Yaz(g, s, Tema.F(10.5f), Tema.Soluk, new RectangleF(0, cy + d / 2 + Tema.PxF(6), Width, Tema.PxF(22)), StringAlignment.Center, StringAlignment.Center, true);
        }
    }

    /// <summary>Uzun işlemlerde içerik alanını kaplayan "meşgul" katmanı (üst şerit ve ACİL STOP açık kalır).</summary>
    public class MesgulKatmani : TemelKontrol
    {
        string metin = "";
        float aci;
        readonly Timer zaman;
        public MesgulKatmani()
        {
            zaman = new Timer(); zaman.Interval = 40;
            zaman.Tick += delegate { aci = (aci + 9) % 360; Invalidate(); };
        }
        public string Metin { get { return metin; } set { if ((value ?? "") != metin) { metin = value ?? ""; Invalidate(); } } }
        protected override void OnVisibleChanged(EventArgs e) { base.OnVisibleChanged(e); zaman.Enabled = Visible; }
        protected override void Dispose(bool disposing) { if (disposing) zaman.Dispose(); base.Dispose(disposing); }
        protected override void OnPaintBackground(PaintEventArgs e) { e.Graphics.Clear(Tema.Zemin); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            float d = Tema.PxF(72);
            var r = new RectangleF((Width - d) / 2, Height / 2f - d - Tema.PxF(10), d, d);
            using (var p = new Pen(Tema.KartKenar, Tema.PxF(7))) g.DrawEllipse(p, r);
            using (var p = new Pen(Tema.Calisiyor, Tema.PxF(7))) { p.StartCap = LineCap.Round; p.EndCap = LineCap.Round; g.DrawArc(p, r, aci, 100); }
            Tema.Yaz(g, metin, Tema.F(18f, true), Tema.Yazi, new RectangleF(Tema.PxF(20), Height / 2f + Tema.PxF(6), Width - Tema.PxF(40), Tema.PxF(40)), StringAlignment.Center, StringAlignment.Center, true);
            Tema.Yaz(g, "Lütfen bekleyin. ACİL STOP her zaman çalışır.", Tema.F(12f), Tema.Soluk, new RectangleF(Tema.PxF(20), Height / 2f + Tema.PxF(48), Width - Tema.PxF(40), Tema.PxF(28)), StringAlignment.Center, StringAlignment.Center, true);
        }
    }

    /// <summary>Ekran değişiminde içeriği 150 ms'de soldurarak getiren katman (yalnız Windows; Mono'da kapalı).</summary>
    public class SolmaKatmani : TemelKontrol
    {
        Bitmap resim;
        DateTime basla;
        readonly Timer zaman;
        public SolmaKatmani()
        {
            zaman = new Timer(); zaman.Interval = 15;
            zaman.Tick += delegate
            {
                if ((DateTime.Now - basla).TotalMilliseconds >= 150) { Bitir(); return; }
                Invalidate();
            };
            Visible = false;
        }
        public void Baslat(Control hedef)
        {
            Bitir();
            if (Tema.Mono || hedef == null || hedef.Width <= 0 || hedef.Height <= 0) return;
            try
            {
                resim = new Bitmap(hedef.Width, hedef.Height);
                hedef.DrawToBitmap(resim, new Rectangle(0, 0, hedef.Width, hedef.Height));
            }
            catch { Bitir(); return; }
            SetBounds(hedef.Left, hedef.Top, hedef.Width, hedef.Height);
            basla = DateTime.Now;
            Visible = true; BringToFront(); zaman.Enabled = true;
        }
        void Bitir()
        {
            zaman.Enabled = false; Visible = false;
            if (resim != null) { resim.Dispose(); resim = null; }
        }
        protected override void Dispose(bool disposing) { if (disposing) { Bitir(); zaman.Dispose(); } base.Dispose(disposing); }
        protected override void OnPaintBackground(PaintEventArgs e) { e.Graphics.Clear(Tema.Zemin); }
        protected override void OnPaint(PaintEventArgs e)
        {
            if (resim == null) return;
            float t = (float)Math.Min(1.0, (DateTime.Now - basla).TotalMilliseconds / 150.0);
            using (var ia = new ImageAttributes())
            {
                var cm = new ColorMatrix(); cm.Matrix33 = t;
                ia.SetColorMatrix(cm);
                e.Graphics.DrawImage(resim, new Rectangle(0, 0, Width, Height), 0, 0, resim.Width, resim.Height, GraphicsUnit.Pixel, ia);
            }
        }
    }

    /// <summary>Tüm ekranların tabanı. Ekranlar veri çekmez; Kabuk DurumUygula ile verir.</summary>
    public class Ekran : UserControl, IOlcekli
    {
        public Ekran()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            DoubleBuffered = true; Dock = DockStyle.Fill; Margin = Padding.Empty; Padding = Padding.Empty;
            BackColor = Tema.Zemin;
        }
        public virtual void DurumUygula(MakineDurumu d) { }
        public virtual void Olcekle() { }
        protected static void Komut(string ad, string arg) { KomutYolu.Gonder(ad, arg); }

        // ortak üreticiler
        protected static TouchButton Dugme(string metin, Simge s, Rol r, string komut, string arg)
        {
            var b = new TouchButton(metin, s, r, komut, arg); b.YaziPt = 13f; return b;
        }
        protected static TouchButton BuyukDugme(string metin, Simge s, Rol r, string komut, string arg)
        {
            var b = new TouchButton(metin, s, r, komut, arg); b.YaziPt = 15f; b.Dikey = true; return b;
        }
        protected static Yazi Etiket(string m, float pt, bool kalin, YaziRol rol) { return new Yazi(m, pt, kalin, rol); }
        protected static Yazi Paragraf(string m, float pt, YaziRol rol)
        {
            var y = new Yazi(m, pt, false, rol); y.Sar = true; y.Dikey = StringAlignment.Near; return y;
        }
    }

    // =====================================================================
    //  1. ÜRETİM (ana ekran)
    // =====================================================================
    public class UretimEkrani : Ekran
    {
        readonly Izgara ana;
        readonly Card isKart, takimKart, simKart, konumKart;
        readonly Yazi lblDosya, lblYuzde, lblDurum;
        readonly ProgressBand ilerleme;
        readonly BigValue bvGecen, bvKalan, bvBitis, bvSatir;
        readonly BigValue bvTakim;
        readonly Yazi lblTakimAciklama, lblMod, lblPens, lblOmur;
        readonly TouchButton btnUyari;
        readonly AxisPanel eksen;
        readonly Yazi lblHiz;
        readonly SecimGrubu koord;
        readonly TouchButton btnSec, btnBaslat, btnDuraklat, btnDurdur, btnTakim, btnTemizlik;
        readonly TouchButton btnHome, btnPark, btnReset, btnBlok;
        readonly Yazi lblBlok;
        // büyük simülasyon
        readonly Izgara buyuk;
        readonly Yazi lblBuyukDosya;
        readonly ProgressBand buyukIlerleme;
        readonly Yazi lblBuyukYuzde;
        /// <summary>SimView'in ana ekrandaki yuvası.</summary>
        public readonly SimHostPanel SimHost = new SimHostPanel();
        /// <summary>SimView'in büyük (tam içerik) yuvası.</summary>
        public readonly SimHostPanel SimHostBuyuk = new SimHostPanel();
        MakineDurumu son;
        bool buyukAcik;

        /// <summary>Büyük simülasyon açıldı/kapandı (denetleyici SimView'i taşıyabilir). Ayrıca "sim.buyuk" komutu gönderilir.</summary>
        public event Action<bool> BuyukSimDegisti;

        public UretimEkrani()
        {
            ana = new Izgara(1, 4).Satirlar(222, -100, 96, 54);
            Controls.Add(ana); ana.Dock = DockStyle.Fill;

            // --- üst: iş kartı + takım kartı
            var ust = new Izgara(2, 1).Sutunlar(-100, 220);
            ana.Ekle(ust, 0, 0);
            isKart = new Card("İş"); isKart.BaslikSimge = Simge.Uretim;
            ust.Ekle(isKart, 0, 0);
            var isI = new Izgara(1, 4).Satirlar(34, 20, -100, 24); isI.Bosluk = 8;
            isKart.Controls.Add(isI); isI.Dock = DockStyle.Fill;
            var r0 = new Izgara(2, 1).Sutunlar(-100, 130);
            isI.Ekle(r0, 0, 0);
            lblDosya = r0.Ekle(Etiket("Bir dosya seçin", 19f, true, YaziRol.Normal), 0, 0); lblDosya.Kucult = true;
            lblYuzde = r0.Ekle(Etiket("", 22f, true, YaziRol.Normal), 1, 0); lblYuzde.SayiYazisi = true; lblYuzde.Yatay = StringAlignment.Far;
            ilerleme = isI.Ekle(new ProgressBand(), 0, 1);
            var r2 = new Izgara(4, 1).Sutunlar(-19, -37, -18, -26);
            isI.Ekle(r2, 0, 2);
            bvGecen = r2.Ekle(new BigValue("Geçen", 20f), 0, 0);
            bvKalan = r2.Ekle(new BigValue("Kalan", 40f), 1, 0);
            bvBitis = r2.Ekle(new BigValue("Bitiş", 20f), 2, 0);
            bvSatir = r2.Ekle(new BigValue("Satır", 16f), 3, 0); bvSatir.Hiza = StringAlignment.Far;
            var r3 = new Izgara(2, 1).Sutunlar(-100, 150);
            isI.Ekle(r3, 0, 3);
            lblDurum = r3.Ekle(Etiket("", 11f, false, YaziRol.Soluk), 0, 0);
            btnUyari = r3.Ekle(new TouchButton("", Simge.Uyari, Rol.Sessiz, null, null), 1, 0);
            btnUyari.YaziPt = 10.5f; btnUyari.MinimumSize = new Size(20, 20);
            btnUyari.Tiklandi += delegate { UyarilariGoster(); };

            takimKart = new Card("Takım"); takimKart.BaslikSimge = Simge.IsMili;
            ust.Ekle(takimKart, 1, 0);
            var tk = new Izgara(1, 5).Satirlar(-100, 22, 22, 22, 22); tk.Bosluk = 2;
            takimKart.Controls.Add(tk); tk.Dock = DockStyle.Fill;
            bvTakim = tk.Ekle(new BigValue("", 40f), 0, 0); bvTakim.Hiza = StringAlignment.Center; bvTakim.Sayisal = false;
            lblTakimAciklama = tk.Ekle(Etiket("", 11.5f, false, YaziRol.Normal), 0, 1); lblTakimAciklama.Yatay = StringAlignment.Center;
            lblMod = tk.Ekle(Etiket("", 10.5f, true, YaziRol.Marka), 0, 2); lblMod.Yatay = StringAlignment.Center;
            lblOmur = tk.Ekle(Etiket("", 10.5f, true, YaziRol.Normal), 0, 3); lblOmur.Yatay = StringAlignment.Center; lblOmur.Kucult = true;
            lblPens = tk.Ekle(Etiket("", 10f, false, YaziRol.Soluk), 0, 4); lblPens.Yatay = StringAlignment.Center;
            takimKart.BaslikTiklandi += delegate { };

            // --- orta: simülasyon + konum
            var orta = new Izgara(2, 1).Sutunlar(-42, -58);
            ana.Ekle(orta, 0, 1);
            simKart = new Card("Simülasyon"); simKart.BaslikSimge = Simge.Disk; simKart.SagMetin = "BÜYÜT  ⤢"; simKart.SagRenk = Tema.Soluk;
            simKart.BaslikTiklandi += delegate { BuyukSim(true); };
            orta.Ekle(simKart, 0, 0);
            simKart.Controls.Add(SimHost); SimHost.Dock = DockStyle.Fill;
            SimHost.DoubleClick += delegate { BuyukSim(true); };
            SimHost.MouseUp += delegate { BuyukSim(true); };
            konumKart = new Card("Konum"); konumKart.BaslikSimge = Simge.Konum;
            orta.Ekle(konumKart, 1, 0);
            var ki = new Izgara(1, 2).Satirlar(-100, 52); ki.Bosluk = 10;
            konumKart.Controls.Add(ki); ki.Dock = DockStyle.Fill;
            eksen = ki.Ekle(new AxisPanel(), 0, 0);
            eksen.KoordTiklandi += delegate { KoordDegistir(!eksen.MakineBirincil); };
            var hz = new Izgara(6, 1).Sutunlar(-100, 56, 104, 56, 12, 170); hz.Bosluk = 6;
            ki.Ekle(hz, 0, 1);
            var lh = hz.Ekle(Etiket("İlerleme oranı", 11f, true, YaziRol.Soluk), 0, 0); lh.Simge = Simge.Hiz; lh.Kucult = true;
            var bEksi = hz.Ekle(Dugme("", Simge.Eksi, Rol.Normal, "hiz.azalt", ""), 1, 0);
            lblHiz = hz.Ekle(Etiket("%100", 18f, true, YaziRol.Normal), 2, 0); lblHiz.SayiYazisi = true; lblHiz.Yatay = StringAlignment.Center; lblHiz.Cursor = Cursors.Hand;
            lblHiz.MouseUp += delegate { Komut("hiz.normal", ""); };
            hz.Ekle(Dugme("", Simge.Arti, Rol.Normal, "hiz.artir", ""), 3, 0);
            koord = hz.Ekle(new SecimGrubu(new[] { "İŞ", "MAKİNE" }, new[] { "0", "1" }, null, null), 5, 0);
            koord.Secili = 0; koord.Pt = 10.5f;
            koord.SecimDegisti += delegate { KoordDegistir(koord.Secili == 1); };

            // --- işlem düğmeleri (DURAKLAT ile DURDUR arası boşluklu)
            var dg = new Izgara(7, 1).Sutunlar(-16.6f, -16.6f, -16.6f, 14, -16.6f, -16.6f, -16.6f);
            ana.Ekle(dg, 0, 2);
            btnSec = dg.Ekle(BuyukDugme("İŞ SEÇ", Simge.Klasor, Rol.Normal, "is.sec", ""), 0, 0);
            btnBaslat = dg.Ekle(BuyukDugme("BAŞLAT", Simge.Oynat, Rol.Basari, "is.baslat", ""), 1, 0);
            btnDuraklat = dg.Ekle(BuyukDugme("DURAKLAT", Simge.Duraklat, Rol.Uyari, "is.duraklat", ""), 2, 0);
            btnDurdur = dg.Ekle(BuyukDugme("DURDUR", Simge.Durdur, Rol.Tehlike, "is.durdur", ""), 4, 0);
            btnTakim = dg.Ekle(BuyukDugme("TAKIM", Simge.Takim, Rol.Normal, "takim.degistir", ""), 5, 0);
            btnTakim.YalnizOlay = true;
            btnTakim.Tiklandi += delegate { TakimSec(); };
            btnTemizlik = dg.Ekle(BuyukDugme("TEMİZLİK", Simge.Temizlik, Rol.Normal, "temizlik", ""), 6, 0);

            // --- bakım şeridi
            var bk = new Izgara(5, 1).Sutunlar(-16, -16, -20, -18, -30); bk.Bosluk = 10;
            ana.Ekle(bk, 0, 3);
            btnHome = bk.Ekle(Dugme("HOME", Simge.Ev, Rol.Normal, "home", ""), 0, 0); btnHome.AltMetin = "";
            btnPark = bk.Ekle(Dugme("PARK", Simge.Park, Rol.Normal, "park", ""), 1, 0);
            btnReset = bk.Ekle(Dugme("ALARMI TEMİZLE", Simge.Yenile, Rol.Normal, "makine.reset", ""), 2, 0);
            btnBlok = bk.Ekle(Dugme("YENİ BLOK", Simge.Blok, Rol.Vurgu, "blok.yeni", ""), 3, 0);
            btnBlok.YalnizOlay = true;
            btnBlok.Tiklandi += delegate { YeniBlok(); };
            lblBlok = bk.Ekle(Etiket("", 11f, false, YaziRol.Soluk), 4, 0); lblBlok.Kucult = true;
            foreach (var b in new[] { btnHome, btnPark, btnReset, btnBlok }) b.YaziPt = 12f;

            // --- büyük simülasyon sayfası
            buyuk = new Izgara(1, 2).Satirlar(64, -100); buyuk.Visible = false;
            Controls.Add(buyuk); buyuk.Dock = DockStyle.Fill;
            var bu = new Izgara(4, 1).Sutunlar(180, -100, 260, 90);
            buyuk.Ekle(bu, 0, 0);
            var bGeri = bu.Ekle(Dugme("KÜÇÜLT", Simge.Sol, Rol.Normal, null, null), 0, 0);
            bGeri.Tiklandi += delegate { BuyukSim(false); };
            lblBuyukDosya = bu.Ekle(Etiket("", 16f, true, YaziRol.Normal), 1, 0); lblBuyukDosya.Kucult = true;
            var bpi = new Izgara(1, 3).Satirlar(-50, 16, -50); bpi.Bosluk = 0;
            bu.Ekle(bpi, 2, 0);
            buyukIlerleme = bpi.Ekle(new ProgressBand(), 0, 1);
            lblBuyukYuzde = bu.Ekle(Etiket("", 18f, true, YaziRol.Normal), 3, 0); lblBuyukYuzde.SayiYazisi = true; lblBuyukYuzde.Yatay = StringAlignment.Far;
            var bc = new Card(); buyuk.Ekle(bc, 0, 1);
            bc.Controls.Add(SimHostBuyuk); SimHostBuyuk.Dock = DockStyle.Fill;
        }

        public bool BuyukSimAcik { get { return buyukAcik; } }

        /// <summary>Büyük simülasyonu aç/kapat.</summary>
        public void BuyukSim(bool ac)
        {
            if (ac == buyukAcik) return;
            buyukAcik = ac;
            buyuk.Visible = ac; ana.Visible = !ac;
            if (ac) buyuk.BringToFront(); else ana.BringToFront();
            var h = BuyukSimDegisti; if (h != null) h(ac);
            Komut("sim.buyuk", ac ? "1" : "0");
        }

        void KoordDegistir(bool makine)
        {
            eksen.MakineBirincil = makine;
            koord.Secili = makine ? 1 : 0;
            Komut("ayar.kaydet", "Koordinat=" + (makine ? "1" : "0"));
        }

        void TakimSec()
        {
            var acik = new string[7];
            acik[0] = "İş milini boşalt (frezi yuvasına bırak)";
            for (int i = 1; i <= 6; i++)
            {
                acik[i] = "";
                if (son != null && son.Yuvalar != null)
                    foreach (var y in son.Yuvalar)
                        if (y.Ad == "T" + i)
                            acik[i] = (y.Aciklama ?? "") + (y.Kayitli ? "" : "  · konum kayıtlı değil") + (y.Dolu ? "" : "  · yuva boş");
            }
            int n = Diyalog.TakimSec(son == null ? 0 : son.Takim, acik);
            if (n >= 0) Komut("takim.degistir", n.ToString(Bicim.Inv));
        }

        void YeniBlok()
        {
            var d = son ?? new MakineDurumu();
            var r = Diyalog.YeniBlok(d.BlokSonrakiIsim ?? "", d.BlokKalinlik, d.BlokDerinlik, !string.IsNullOrEmpty(d.Dosya), d.BekleyenBlok);
            if (r == null || r.Secim < 0) return;
            string a = (r.Isim ?? "") + "|" + Bicim.Sayi(r.Kalinlik, 2) + "|" + Bicim.Sayi(r.Derinlik, 2);
            switch (r.Secim)
            {
                case 0: Komut("blok.kazibasla", a); break;
                case 1: Komut("blok.sadeceisim", a); break;
                case 2: Komut("blok.yenihazir", a); break;
                case 3: Komut("blok.kullanilmis", ""); break;
                case 4: Komut("blok.iptal", ""); break;
            }
        }

        void UyarilariGoster()
        {
            if (son == null) return;
            var sb = new StringBuilder();
            if (son.IsHatalari != null && son.IsHatalari.Count > 0)
            {
                sb.AppendLine("HATALAR (iş başlatılamaz):");
                foreach (var h in son.IsHatalari) sb.AppendLine("•  " + h);
                sb.AppendLine();
            }
            if (son.IsUyarilari != null && son.IsUyarilari.Count > 0)
            {
                sb.AppendLine("UYARILAR:");
                foreach (var u in son.IsUyarilari) sb.AppendLine("•  " + u);
            }
            if (sb.Length == 0) sb.Append("Bu dosya için uyarı yok.");
            Diyalog.Bilgi("Dosya kontrolü · " + (son.Dosya ?? ""), sb.ToString().TrimEnd());
        }

        public override void DurumUygula(MakineDurumu d)
        {
            son = d;
            bool isVar = !string.IsNullOrEmpty(d.Dosya);
            lblDosya.Metin = isVar ? d.Dosya : (d.Durum == Durum.Hazir ? "Makine hazır · bir iş seçin" : "Bir dosya seçin");
            lblDosya.RenkRol = isVar ? YaziRol.Normal : YaziRol.Soluk;
            isKart.SagMetin = string.IsNullOrEmpty(d.Blok) ? "" : "Blok " + d.Blok;
            Color dc = Tema.DurumRengi(d.Durum);
            if (d.IsTamamlandi) dc = Tema.Hazir;
            if (d.Durum == Durum.Hazir && !d.IsTamamlandi) dc = Tema.Calisiyor;
            ilerleme.Renk = dc;
            ilerleme.Deger = d.Yuzde;
            ilerleme.Parilti = d.Durum == Durum.Calisiyor && d.Ayar("Dansci", "0") == "1";
            bool sure = d.Durum == Durum.Calisiyor || d.Durum == Durum.Duraklatildi || d.GecenSn > 0;
            lblYuzde.Metin = isVar && (sure || d.Yuzde > 0) ? "%" + ((int)Math.Floor(d.Yuzde)).ToString(Bicim.Inv) : "";
            bvGecen.Deger = sure ? Bicim.Sure(d.GecenSn) : "—";
            if (sure || !isVar) { bvKalan.Etiket = "Kalan"; bvKalan.Deger = sure ? Bicim.Sure(d.KalanSn) : "—"; }
            else { bvKalan.Etiket = "Tahmini süre"; bvKalan.Deger = d.TahminiSn > 0 ? Bicim.Sure(d.TahminiSn) : "—"; }
            bvKalan.Renk = d.Durum == Durum.Calisiyor ? Tema.Calisiyor : d.Durum == Durum.Duraklatildi ? Tema.Duraklatildi : Color.Empty;
            if (d.IsTamamlandi) { bvKalan.Etiket = "Durum"; bvKalan.Deger = "BİTTİ"; bvKalan.Renk = Tema.Hazir; }
            bvBitis.Deger = string.IsNullOrEmpty(d.BitisSaati) ? "—" : d.BitisSaati;
            bvSatir.Deger = d.ToplamSatir <= 0 ? "—" : (sure || d.Satir > 0 ? Bicim.Binlik(d.Satir) + " / " + Bicim.Binlik(d.ToplamSatir) : Bicim.Binlik(d.ToplamSatir) + " satır");

            int nh = d.IsHatalari == null ? 0 : d.IsHatalari.Count, nu = d.IsUyarilari == null ? 0 : d.IsUyarilari.Count;
            if (!string.IsNullOrEmpty(d.ManuelMesaj))
            {
                lblDurum.Metin = d.HavaYok ? "KOMPRESÖRÜ AÇ · " + d.ManuelMesaj : "MANUEL FREZ: " + d.ManuelMesaj;
                lblDurum.Renk(d.HavaYok ? Tema.Alarm : Tema.Duraklatildi); lblDurum.Kalin = true;
                isKart.Vurgu = d.HavaYok ? Tema.Alarm : Tema.Duraklatildi;
            }
            else if (nh > 0)
            {
                lblDurum.Metin = "⛔ " + d.IsHatalari[0]; lblDurum.Renk(Tema.Alarm); lblDurum.Kalin = true;
                isKart.Vurgu = Tema.Alarm;
            }
            else
            {
                string s = string.IsNullOrEmpty(d.IsTakimlari) ? "" : "Takımlar  " + d.IsTakimlari;
                bool kayit = !string.IsNullOrEmpty(d.DevamKaydi);
                // devam kaydı varken (senaryo 1: kaydın tutulduğu görünsün) "Tahmini" yerine, durumdan hemen sonra gösterilir
                if (d.TahminiSn > 0 && sure && !kayit) s += (s.Length > 0 ? "   ·   " : "") + "Tahmini " + Bicim.Sure(d.TahminiSn);
                if (kayit) s = d.DevamKaydi + (s.Length > 0 ? "   ·   " + s : "");
                if (!string.IsNullOrEmpty(d.DurumMetni)) s = d.DurumMetni + (s.Length > 0 ? "   ·   " + s : "");
                lblDurum.Metin = s; lblDurum.RenkRol = YaziRol.Soluk; lblDurum.Kalin = false;
                isKart.Vurgu = nu > 0 ? Tema.Duraklatildi : Color.Empty;
            }
            btnUyari.Visible = nh + nu > 0;
            btnUyari.Metin = nh > 0 ? nh + " HATA" + (nu > 0 ? " · " + nu + " UYARI" : "") : nu + " UYARI";

            // takım
            bvTakim.Deger = d.Takim > 0 ? "T" + d.Takim.ToString(Bicim.Inv) : "T0";
            bvTakim.Renk = d.Takim > 0 ? Tema.Yazi : Tema.Soluk;
            lblTakimAciklama.Metin = d.Takim > 0 ? (d.TakimAciklama ?? "") : "İş mili boş";
            bool manuel = string.Equals(d.FrezModu, "MANUEL", StringComparison.OrdinalIgnoreCase);
            lblMod.Metin = manuel ? "MANUEL DEĞİŞİM" : "OTOMATİK DEĞİŞİM";
            lblPens.Metin = "Pens " + (d.PensAcik ? "AÇIK" : "kapalı") + (d.HavaYok ? "  ·  HAVA YOK" : "");
            if (d.PensAcik || d.HavaYok) lblPens.Renk(Tema.Duraklatildi); else lblPens.RenkRol = YaziRol.Soluk;
            var om = d.Takim > 0 ? OmurCizim.Bul(d, d.Takim) : null;
            if (om == null) { lblOmur.Metin = ""; }
            else if (om.Omur <= 0) { lblOmur.Metin = "Ömür girilmedi · " + OmurCizim.Dk(om.Dakika) + " dk"; lblOmur.RenkRol = YaziRol.Soluk; }
            else
            {
                lblOmur.Metin = "Ömür " + OmurCizim.Yuzde(om) + " · " + OmurCizim.Dk(om.Dakika) + "/" + OmurCizim.Dk(om.Omur) + " dk";
                if (om.Seviye == 0) lblOmur.RenkRol = YaziRol.Normal; else lblOmur.Renk(OmurCizim.Renk(om));
            }
            takimKart.Vurgu = om != null && om.Omur > 0 && om.Seviye == 2 ? Tema.Alarm : Color.Empty;

            // konum
            eksen.Ayarla(d.X, d.Y, d.Z, d.A, d.B, d.MX, d.MY, d.MZ, d.MA, d.MB);
            bool mk = d.KoordMakine || d.Ayar("Koordinat", "0") == "1";
            eksen.MakineBirincil = mk; koord.Secili = mk ? 1 : 0;
            lblHiz.Metin = "%" + d.Hiz.ToString(Bicim.Inv);
            if (d.Hiz > 120) lblHiz.Renk(Tema.Alarm); else if (d.Hiz != 100) lblHiz.Renk(Tema.Hazir); else lblHiz.RenkRol = YaziRol.Normal;

            // düğmeler
            if (d.Durum == Durum.Duraklatildi) { btnBaslat.Metin = "DEVAM"; btnBaslat.KomutAyarla("is.devam", ""); }
            else { btnBaslat.Metin = "BAŞLAT"; btnBaslat.KomutAyarla("is.baslat", ""); }
            btnReset.Metin = d.AcilStop ? "KİLİDİ KALDIR" : "ALARMI TEMİZLE";
            btnReset.KomutAyarla(d.AcilStop ? "acilstop.kaldir" : "makine.reset", "");
            btnReset.Rol = d.Durum == Durum.Alarm ? Rol.TehlikeCizgi : Rol.Normal;
            btnHome.AltMetin = d.HomeAlindi ? "" : "home gerekli";
            btnHome.Rol = d.HomeAlindi || !d.Bagli ? Rol.Normal : Rol.Vurgu;
            string blok = d.BlokDurum ?? "";
            if (d.BekleyenBlok && blok.Length == 0) blok = "Bekleyen blok ismi var";
            lblBlok.Metin = blok;
            if (blok.Length > 0) lblBlok.Renk(Tema.Hazir); else lblBlok.RenkRol = YaziRol.Soluk;

            SimHost.Dosya = d.Dosya; SimHostBuyuk.Dosya = d.Dosya;
            lblBuyukDosya.Metin = (d.Dosya ?? "Simülasyon") + (d.Satir > 0 ? "   ·   satır " + Bicim.Binlik(d.Satir) : "");
            buyukIlerleme.Renk = dc; buyukIlerleme.Deger = d.Yuzde;
            lblBuyukYuzde.Metin = isVar ? "%" + ((int)Math.Floor(d.Yuzde)).ToString(Bicim.Inv) : "";
        }

        public override void Olcekle()
        {
            float s = Tema.S;
            ana.Satirlar(222, -100, s > 1.2f ? 88 : 96, 54);
        }
    }

    // =====================================================================
    //  2. TAKIMLAR
    // =====================================================================
    public class TakimlarEkrani : Ekran
    {
        static readonly string[] yuvaAdlari = { "T1", "T2", "T3", "T4", "T5", "T6", "SENSÖR", "MANUEL" };
        readonly Yazi lblMil, lblMod, lblPens;
        readonly TouchButton btnMod;
        readonly SecimGrubu sekme;
        readonly Control[] sayfalar = new Control[5];
        // sayfa A
        readonly YuvaKarti[] kartlar = new YuvaKarti[8];
        readonly Yazi lblSecili;
        readonly TouchButton btnAl, btnGit, btnYaklas, btnPensAc, btnPensKapat;
        // sayfa B
        readonly Tablo tblYuva;
        readonly Yazi lblYuvaSecili, lblOrtak, lblJogKonum;
        readonly Card lstKart, secKart;
        readonly TouchButton btnYGit, btnYYaklas, btnYAl, btnYTest;
        readonly Anahtar chkZ;
        readonly SecimGrubu ayAdim;
        readonly List<TouchButton> ayJog = new List<TouchButton>();
        // sayfa C
        readonly SecimGrubu jAdim, jHiz;
        readonly List<TouchButton> jJog = new List<TouchButton>();
        readonly BigValue[] jDeger = new BigValue[5];
        // sayfa D
        readonly DegerKutusu devir;
        readonly TouchButton btnMilCalis;
        readonly Yazi lblMilDurum, lblSogutma;
        // sayfa E: frez ömrü
        readonly FrezOmruSatiri[] omurSatir = new FrezOmruSatiri[6];
        readonly TouchButton[] omurSifirla = new TouchButton[6];
        readonly Yazi lblOmurDiger;
        readonly Card omurKart;
        string secili = "T1";
        MakineDurumu son;

        public TakimlarEkrani()
        {
            var ana = new Izgara(1, 3).Satirlar(62, 52, -100);
            Controls.Add(ana); ana.Dock = DockStyle.Fill;

            // başlık şeridi
            var bas = new Card(); bas.Bosluk = 8;
            ana.Ekle(bas, 0, 0);
            var bi = new Izgara(5, 1).Sutunlar(-30, -32, 150, -24, 4); bi.Bosluk = 10;
            bas.Controls.Add(bi); bi.Dock = DockStyle.Fill;
            lblMil = bi.Ekle(Etiket("İş milinde: —", 15f, true, YaziRol.Normal), 0, 0); lblMil.Simge = Simge.IsMili; lblMil.Kucult = true;
            lblMod = bi.Ekle(Etiket("Frez modu: —", 12f, true, YaziRol.Marka), 1, 0); lblMod.Kucult = true; lblMod.Yatay = StringAlignment.Far;
            btnMod = bi.Ekle(Dugme("DEĞİŞTİR", Simge.Takim, Rol.Normal, "frez.modu", "MANUEL"), 2, 0); btnMod.YaziPt = 11f;
            lblPens = bi.Ekle(Etiket("Pens: —", 12f, false, YaziRol.Soluk), 3, 0); lblPens.Yatay = StringAlignment.Far; lblPens.Kucult = true;

            sekme = ana.Ekle(new SecimGrubu(new[] { "Takım değişimi", "Yuva ayarı", "Hareket (jog)", "İş mili ve hava", "Frez ömrü" }, null, null, null), 0, 1);
            sekme.Secili = 0; sekme.Pt = 12.5f;
            sekme.SecimDegisti += delegate { SekmeGoster(sekme.Secili); };

            var host = new Panel(); host.Margin = Padding.Empty;
            ana.Ekle(host, 0, 2);

            // ---------- A: takım değişimi
            var a = new Izgara(1, 3).Satirlar(-46, 40, -54);
            sayfalar[0] = a;
            var kr = new Izgara(8, 1); kr.Bosluk = 8;
            a.Ekle(kr, 0, 0);
            for (int i = 0; i < 8; i++)
            {
                var k = new YuvaKarti(); k.Bilgi = new YuvaBilgisi { Ad = yuvaAdlari[i] };
                string ad = yuvaAdlari[i];
                k.Secildi += delegate { Sec(ad); };
                kartlar[i] = kr.Ekle(k, i, 0);
            }
            lblSecili = a.Ekle(Etiket("", 13f, false, YaziRol.Normal), 0, 1); lblSecili.SayiYazisi = true; lblSecili.Kucult = true;
            var ab = new Izgara(5, 2); ab.Bosluk = 10;
            a.Ekle(ab, 0, 2);
            btnAl = ab.Ekle(BuyukDugme("T1'İ AL", Simge.Takim, Rol.Vurgu, "takim.degistir", "1"), 0, 0);
            ab.Ekle(BuyukDugme("FREZİ BIRAK", Simge.Asagi, Rol.TehlikeCizgi, "frez.birak", ""), 1, 0).AltMetin = "M6 T0 · yuvasına";
            ab.Ekle(BuyukDugme("TAKIM BOYUNU ÖLÇ", Simge.Olcum, Rol.Normal, "takim.olc", ""), 2, 0);
            ab.Ekle(BuyukDugme("AŞINMA KONTROLÜ", Simge.Hedef, Rol.Normal, "takim.asinma", ""), 3, 0).AltMetin = "M100";
            ab.Ekle(BuyukDugme("İŞ MİLİ BOŞ MU?", Simge.Prob, Rol.Normal, "takim.bosmu", ""), 4, 0);
            btnGit = ab.Ekle(BuyukDugme("YUVAYA GİT", Simge.Konum, Rol.Normal, "yuva.git", "T1"), 0, 1); btnGit.AltMetin = "frezeye dokunmaz";
            btnYaklas = ab.Ekle(BuyukDugme("YAKLAŞ", Simge.Asagi, Rol.Normal, "yuva.yaklas", "T1"), 1, 1); btnYaklas.AltMetin = "#4001, iş mili boş";
            ab.Ekle(BuyukDugme("YUKARI", Simge.Yukari, Rol.Normal, "eksen.yukari", ""), 2, 1).AltMetin = "Z en üst";
            btnPensAc = ab.Ekle(BuyukDugme("PENS AÇ", Simge.Pens, Rol.TehlikeCizgi, "pens.ac", ""), 3, 1); btnPensAc.AltMetin = "frez düşebilir";
            btnPensKapat = ab.Ekle(BuyukDugme("PENS KAPAT", Simge.Pens, Rol.Normal, "pens.kapat", ""), 4, 1);

            // ---------- B: yuva ayarı
            var b = new Izgara(1, 2).Satirlar(-100, 150);
            sayfalar[1] = b;
            var bu = new Izgara(2, 1).Sutunlar(-54, -46);
            b.Ekle(bu, 0, 0);
            lstKart = new Card("Yuva listesi · makine koordinatı"); lstKart.BaslikSimge = Simge.Liste; lstKart.SagRenk = Tema.Duraklatildi;
            bu.Ekle(lstKart, 0, 0);
            tblYuva = new Tablo(new[] { "Yuva", "Kayıtlı X / Y", "Yeni alınan", "Fark" }, new[] { 19f, 33f, 28f, 20f });
            tblYuva.Secilebilir = true; tblYuva.SatirH = 28; tblYuva.Pt = 10.5f;
            tblYuva.Hiza(StringAlignment.Near, StringAlignment.Near, StringAlignment.Near, StringAlignment.Far);
            tblYuva.SatirSecildi += i => { if (i >= 0 && i < yuvaAdlari.Length) Sec(yuvaAdlari[i]); };
            lstKart.Controls.Add(tblYuva); tblYuva.Dock = DockStyle.Fill;
            secKart = new Card("Seçili yuva"); secKart.BaslikSimge = Simge.Hedef; secKart.SagRenk = Tema.Marka;
            bu.Ekle(secKart, 1, 0);
            var ri = new Izgara(3, 4); ri.Bosluk = 8;
            secKart.Controls.Add(ri); ri.Dock = DockStyle.Fill;
            btnYGit = ri.Ekle(Dugme("GİT", Simge.Konum, Rol.Normal, "yuva.git", "ayar:T1"), 0, 0);
            btnYYaklas = ri.Ekle(Dugme("YAKLAŞ", Simge.Asagi, Rol.Normal, "yuva.yaklas", "ayar:T1"), 1, 0);
            ri.Ekle(Dugme("YUKARI", Simge.Yukari, Rol.Normal, "eksen.yukari", ""), 2, 0);
            btnYAl = ri.Ekle(Dugme("BU KONUMU AL  (T1)", Simge.Konum, Rol.Vurgu, "yuva.al", "T1"), 0, 1, 2, 1);
            btnYTest = ri.Ekle(Dugme("TEST AL", Simge.Takim, Rol.Normal, "yuva.test", "1"), 2, 1);
            ri.Ekle(Dugme("KAYDET", Simge.Kaydet, Rol.TehlikeCizgi, "yuva.kaydet", ""), 0, 2);
            ri.Ekle(Dugme("BAŞTAN", Simge.Yenile, Rol.Normal, "yuva.sifirla", ""), 1, 2);
            ri.Ekle(Dugme("DOĞRULANMIŞ", Simge.Yedek, Rol.TehlikeCizgi, "yuva.varsayilan", ""), 2, 2).AltMetin = "değerlere dön";
            var zz = new Izgara(2, 1).Sutunlar(-100, 100); zz.Bosluk = 6;
            ri.Ekle(zz, 0, 3, 2, 1);
            var zl = zz.Ekle(Etiket("T1 alınırken Z'yi de al (alma yüksekliği)", 10f, false, YaziRol.Soluk), 0, 0); zl.Sar = true;
            chkZ = zz.Ekle(new Anahtar("YuvaZ") { Komut = "yuva.zal", AyarAdi = null }, 1, 0);
            ri.Ekle(Dugme("MACRO'DAN OKU", Simge.Yenile, Rol.Normal, "yuva.geometri.oku", ""), 2, 3).AltMetin = "yuva geometrisi";
            foreach (Control rc0 in ri.Controls) { var tb = rc0 as TouchButton; if (tb != null) tb.YaziPt = 12f; }
            var jc = new Card("İnce ayar (jog)"); jc.BaslikSimge = Simge.Buyut;
            b.Ekle(jc, 0, 1);
            var jkz = new Izgara(1, 2).Satirlar(-50, -50); jkz.Bosluk = 8;
            jc.Controls.Add(jkz); jkz.Dock = DockStyle.Fill;
            var j1 = new Izgara(5, 1).Sutunlar(250, -100, 120, 130, 110); j1.Bosluk = 8;
            jkz.Ekle(j1, 0, 0);
            ayAdim = j1.Ekle(new SecimGrubu(new[] { "0.01", "0.05", "0.1", "0.5", "1" }, null, null, null), 0, 0);
            ayAdim.Secili = 2; ayAdim.Pt = 11f;
            lblJogKonum = j1.Ekle(Etiket("", 10f, false, YaziRol.Soluk), 1, 0); lblJogKonum.SayiYazisi = true; lblJogKonum.Sar = true;
            j1.Ekle(Dugme("PENS AÇ", Simge.Pens, Rol.TehlikeCizgi, "pens.ac", ""), 2, 0).YaziPt = 11f;
            j1.Ekle(Dugme("PENS KAPAT", Simge.Pens, Rol.Normal, "pens.kapat", ""), 3, 0).YaziPt = 11f;
            j1.Ekle(Dugme("HAVA", Simge.Hava, Rol.Normal, "hava.ufle", ""), 4, 0).YaziPt = 11f;
            var ji = new Izgara(10, 1); ji.Bosluk = 6;
            jkz.Ekle(ji, 0, 1);
            string[] eks = { "X", "Y", "Z", "A", "B" };
            for (int i = 0; i < 10; i++)
            {
                string e = eks[i / 2] + (i % 2 == 0 ? "-" : "+");
                var t = ji.Ekle(Dugme(eks[i / 2] + (i % 2 == 0 ? "−" : "+"), Simge.Yok, Rol.Normal, "jog", e), i, 0);
                t.YaziPt = 13f; t.Tag = e; ayJog.Add(t);
            }
            ayAdim.SecimDegisti += delegate { JogArgYenile(); };
            lblOrtak = null;
            lblYuvaSecili = null;

            // ---------- C: hareket
            var c = new Izgara(2, 1).Sutunlar(-60, -40);
            sayfalar[2] = c;
            var jk = new Card("Jog"); jk.BaslikSimge = Simge.Buyut;
            c.Ekle(jk, 0, 0);
            var jg = new Izgara(3, 7).Satirlar(44, 44, -20, -20, -20, -20, -20).Sutunlar(-30, -40, -30); jg.Bosluk = 8;
            jk.Controls.Add(jg); jg.Dock = DockStyle.Fill;
            jAdim = jg.Ekle(new SecimGrubu(new[] { "0.01", "0.1", "1", "10", "SÜREKLİ" }, new[] { "0.01", "0.1", "1", "10", "surekli" }, null, null), 0, 0, 3, 1);
            jAdim.Secili = 1; jAdim.Pt = 11.5f;
            jHiz = jg.Ekle(new SecimGrubu(new[] { "Yavaş 100", "Orta 300", "Hızlı 1000" }, new[] { "100", "300", "1000" }, null, null), 0, 1, 3, 1);
            jHiz.Secili = 1; jHiz.Pt = 11.5f;
            string[] eksi = { "X−", "Y− arka", "Z− aşağı", "A− kol", "B− disk" }, arti = { "X+", "Y+ ön", "Z+ yukarı", "A+ kol", "B+ disk" };
            for (int i = 0; i < 5; i++)
            {
                var m = jg.Ekle(Dugme(eksi[i], Simge.Yok, Rol.Normal, "jog", eks[i] + "-"), 0, 2 + i); m.Tag = eks[i] + "-"; m.YaziPt = 13f; jJog.Add(m);
                jDeger[i] = jg.Ekle(new BigValue(eks[i], 20f), 1, 2 + i); jDeger[i].Hiza = StringAlignment.Center; jDeger[i].EtiketPt = 9f;
                var p = jg.Ekle(Dugme(arti[i], Simge.Yok, Rol.Normal, "jog", eks[i] + "+"), 2, 2 + i); p.Tag = eks[i] + "+"; p.YaziPt = 13f; jJog.Add(p);
            }
            jAdim.SecimDegisti += delegate { JogArgYenile(); };
            jHiz.SecimDegisti += delegate { JogArgYenile(); };
            var kg = new Card("Konuma git"); kg.BaslikSimge = Simge.Konum;
            c.Ekle(kg, 1, 0);
            var kgi = new Izgara(1, 6).Satirlar(-17, -17, -17, -17, -17, 40); kgi.Bosluk = 8;
            kg.Controls.Add(kgi); kgi.Dock = DockStyle.Fill;
            kgi.Ekle(Dugme("İŞ MİLİ EN ÜSTE", Simge.Yukari, Rol.Normal, "eksen.yukari", ""), 0, 0);
            kgi.Ekle(Dugme("KOL DÜZ (TAKIM ALMA)", Simge.Takim, Rol.Normal, "konum.koldz", ""), 0, 1);
            kgi.Ekle(Dugme("TAKIM ALANI", Simge.IsMili, Rol.Normal, "konum.takimalani", ""), 0, 2);
            kgi.Ekle(Dugme("BLOK DEĞİŞTİRME", Simge.Blok, Rol.Normal, "konum.blok", ""), 0, 3);
            kgi.Ekle(Dugme("PARK (G30)", Simge.Park, Rol.Normal, "konum.park", ""), 0, 4);
            var kn = kgi.Ekle(Etiket("Z− 10 mm ve üstü adımlar onay ister.", 10f, false, YaziRol.Soluk), 0, 5); kn.Sar = true;

            // ---------- D: iş mili ve hava
            var dd = new Izgara(3, 1); dd.Bosluk = 12;
            sayfalar[3] = dd;
            var mk = new Card("İş mili"); mk.BaslikSimge = Simge.IsMili;
            dd.Ekle(mk, 0, 0);
            var mi = new Izgara(1, 5).Satirlar(26, 56, 64, 64, -100); mi.Bosluk = 10;
            mk.Controls.Add(mi); mi.Dock = DockStyle.Fill;
            mi.Ekle(Etiket("Devir (dev/dk)", 10.5f, true, YaziRol.Soluk), 0, 0);
            devir = mi.Ekle(new DegerKutusu { Yerel = true, Ondalik = 0, Min = 1000, Max = 24000, Etiket = "Devir", Pt = 18f }, 0, 1);
            devir.Deger = 18000;
            devir.Degisti += delegate { btnMilCalis.Arg = Bicim.Sayi(devir.Deger, 0); btnMilCalis.IzinYenile(); devir.Kirli = false; };
            btnMilCalis = mi.Ekle(Dugme("ÇALIŞTIR (M3)", Simge.Oynat, Rol.TehlikeCizgi, "ismili.calistir", "18000"), 0, 2);
            mi.Ekle(Dugme("DURDUR (M5)", Simge.Durdur, Rol.Normal, "ismili.durdur", ""), 0, 3);
            lblMilDurum = mi.Ekle(Etiket("", 11f, false, YaziRol.Soluk), 0, 4); lblMilDurum.Dikey = StringAlignment.Near;
            var pk = new Card("Pens ve hava"); pk.BaslikSimge = Simge.Pens;
            dd.Ekle(pk, 1, 0);
            var pi = new Izgara(1, 4).Satirlar(64, 64, 64, -100); pi.Bosluk = 10;
            pk.Controls.Add(pi); pi.Dock = DockStyle.Fill;
            pi.Ekle(Dugme("PENS AÇ (→ T0)", Simge.Pens, Rol.TehlikeCizgi, "pens.ac", ""), 0, 0);
            pi.Ekle(Dugme("PENS KAPAT (M55 P2)", Simge.Pens, Rol.Normal, "pens.kapat", ""), 0, 1);
            pi.Ekle(Dugme("HAVA ÜFLE (M54 P4)", Simge.Hava, Rol.Normal, "hava.ufle", ""), 0, 2);
            pi.Ekle(Paragraf("Pens açılınca iş milindeki frez düşer: frezi elinle tut.", 10f, YaziRol.Soluk), 0, 3);
            var sk = new Card("Soğutma"); sk.BaslikSimge = Simge.Hava;
            dd.Ekle(sk, 2, 0);
            var si = new Izgara(1, 4).Satirlar(64, 64, 64, -100); si.Bosluk = 10;
            sk.Controls.Add(si); si.Dock = DockStyle.Fill;
            si.Ekle(Dugme("M7 AÇ", Simge.Hava, Rol.Normal, "sogutma.m7", ""), 0, 0);
            si.Ekle(Dugme("M8 AÇ", Simge.Hava, Rol.Normal, "sogutma.m8", ""), 0, 1);
            si.Ekle(Dugme("HEPSİNİ KAPAT (M9)", Simge.Kapat, Rol.Normal, "sogutma.kapat", ""), 0, 2);
            lblSogutma = si.Ekle(Etiket("", 11f, false, YaziRol.Soluk), 0, 3); lblSogutma.Dikey = StringAlignment.Near;

            // ---------- E: frez ömrü (takım başına kesim süresi, operatörün girdiği ömür, yüzde)
            omurKart = new Card("Frez ömrü · kesimde geçen süre"); omurKart.BaslikSimge = Simge.Takim; omurKart.SagRenk = Tema.Soluk;
            omurKart.SagMetin = "yalnız iş kesim yaparken sayılır";
            sayfalar[4] = omurKart;
            var oi = new Izgara(1, 7).Satirlar(-16.66f, -16.66f, -16.66f, -16.66f, -16.66f, -16.66f, 30); oi.Bosluk = 8;
            omurKart.Controls.Add(oi); oi.Dock = DockStyle.Fill;
            for (int i = 0; i < 6; i++)
            {
                string tn = "T" + (i + 1).ToString(Bicim.Inv);
                var sr = new Izgara(3, 1).Sutunlar(-100, 158, 178); sr.Bosluk = 8;
                oi.Ekle(sr, 0, i);
                omurSatir[i] = sr.Ekle(new FrezOmruSatiri { Takim = i + 1 }, 0, 0);
                var ba = sr.Ekle(Dugme("ÖMRÜ AYARLA", Simge.Ayar, Rol.Normal, "frez.omur.ayarla", tn), 1, 0); ba.YaziPt = 11f;
                omurSifirla[i] = sr.Ekle(Dugme("SIFIRLA · YENİ FREZ", Simge.Yenile, Rol.Normal, "frez.omur.sifirla", tn), 2, 0); omurSifirla[i].YaziPt = 10.5f;
            }
            lblOmurDiger = oi.Ekle(Etiket("", 10.5f, false, YaziRol.Soluk), 0, 6); lblOmurDiger.Kucult = true; lblOmurDiger.SayiYazisi = false;

            foreach (var s in sayfalar) { s.Dock = DockStyle.Fill; s.Visible = false; host.Controls.Add(s); }
            SekmeGoster(0);
            JogArgYenile();
            Sec("T1");
        }

        /// <summary>0 takım değişimi, 1 yuva ayarı, 2 hareket, 3 iş mili ve hava, 4 frez ömrü.</summary>
        public void SekmeGoster(int i)
        {
            if (i < 0 || i >= sayfalar.Length) return;
            sekme.Secili = i;
            for (int k = 0; k < sayfalar.Length; k++) sayfalar[k].Visible = k == i;
        }
        public int Sekme { get { return sekme.Secili; } }

        void JogArgYenile()
        {
            string adim = ayAdim.Secili >= 0 ? new[] { "0.01", "0.05", "0.1", "0.5", "1" }[ayAdim.Secili] : "0.1";
            foreach (var t in ayJog) t.KomutAyarla("jog", (string)t.Tag + "|" + adim + "|100");
            string ja = jAdim.SeciliDeger ?? "0.1", jh = jHiz.SeciliDeger ?? "300";
            foreach (var t in jJog)
            {
                string e = (string)t.Tag;
                if (ja == "surekli")
                {
                    t.Komut = null; t.Arg = null;
                    t.BasKomut = "jog.basla"; t.BasArg = e + "|" + jh; t.BirakKomut = "jog.bitir"; t.BirakArg = e.Substring(0, 1);
                    t.IzinYenile();
                }
                else
                {
                    t.BasKomut = null; t.BirakKomut = null;
                    t.KomutAyarla("jog", e + "|" + ja + "|" + jh);
                }
            }
        }

        /// <summary>Yuva seç (görünüm içi).</summary>
        public void Sec(string ad)
        {
            secili = ad;
            int idx = Array.IndexOf(yuvaAdlari, ad);
            for (int i = 0; i < 8; i++) kartlar[i].Secili = i == idx;
            tblYuva.Secili = idx;
            bool takim = ad.StartsWith("T");
            string n = takim ? ad.Substring(1) : "";
            btnAl.Metin = takim ? Bicim.BuyukHarf(ad) + Ek(ad) + " AL" : "TAKIM AL";
            btnAl.Etkin = takim;
            btnAl.KomutAyarla("takim.degistir", n);
            btnGit.KomutAyarla("yuva.git", ad); btnYaklas.KomutAyarla("yuva.yaklas", ad);
            btnYGit.KomutAyarla("yuva.git", "ayar:" + ad); btnYYaklas.KomutAyarla("yuva.yaklas", "ayar:" + ad);
            btnYAl.Metin = "BU KONUMU AL  (" + ad + ")"; btnYAl.KomutAyarla("yuva.al", ad);
            btnYTest.Etkin = takim; btnYTest.KomutAyarla("yuva.test", n);
            secKart.SagMetin = ad;
            SeciliYaz();
        }

        static string Ek(string ad)
        {
            // T1'İ, T2'Yİ, T3'Ü, T4'Ü, T5'İ, T6'YI
            switch (ad) { case "T1": return "'İ"; case "T2": return "'Yİ"; case "T3": return "'Ü"; case "T4": return "'Ü"; case "T5": return "'İ"; case "T6": return "'YI"; }
            return "";
        }

        void SeciliYaz()
        {
            YuvaBilgisi y = null;
            if (son != null && son.Yuvalar != null) foreach (var k in son.Yuvalar) if (k.Ad == secili) y = k;
            if (y == null) { lblSecili.Metin = "Seçili: " + secili; return; }
            string s = "Seçili: " + secili + "    X " + Bicim.Sayi(y.X) + "   Y " + Bicim.Sayi(y.Y);
            if (y.ZVar) s += "   Z(al) " + Bicim.Sayi(y.Z);
            s += "   A " + Bicim.Sayi(y.A) + "   B " + Bicim.Sayi(y.B);
            if (!y.Kayitli) s += "    · kayıt yok (varsayılan)";
            lblSecili.Metin = s;
        }

        public override void DurumUygula(MakineDurumu d)
        {
            son = d;
            lblMil.Metin = "İş milinde: " + (d.Takim > 0 ? "T" + d.Takim + (string.IsNullOrEmpty(d.TakimAciklama) ? "" : "  ·  " + d.TakimAciklama) : "boş (T0)");
            bool manuel = string.Equals(d.FrezModu, "MANUEL", StringComparison.OrdinalIgnoreCase);
            lblMod.Metin = "Frez modu: " + (manuel ? "MANUEL" : "OTOMATİK");
            btnMod.Metin = manuel ? "OTOMATİĞE AL" : "MANUELE AL";
            btnMod.KomutAyarla("frez.modu", manuel ? "OTOMATIK" : "MANUEL");
            lblPens.Metin = "Pens: " + (d.PensAcik ? "AÇIK" : "KAPALI") + "   ·   Hava: " + (d.HavaYok ? "YOK" : "var");
            if (d.PensAcik || d.HavaYok) lblPens.Renk(Tema.Duraklatildi); else lblPens.RenkRol = YaziRol.Soluk;
            btnPensAc.Secili = false;

            var satirlar = new List<TabloSatiri>();
            for (int i = 0; i < 8; i++)
            {
                YuvaBilgisi y = null;
                if (d.Yuvalar != null) foreach (var k in d.Yuvalar) if (k.Ad == yuvaAdlari[i]) y = k;
                if (y == null) y = new YuvaBilgisi { Ad = yuvaAdlari[i], Dolu = i < 6 };
                kartlar[i].Bilgi = y;
                kartlar[i].Omur = i < 6 ? OmurCizim.Bul(d, i + 1) : null;
                string kay = y.Kayitli ? Bicim.Sayi(y.X, 2) + " / " + Bicim.Sayi(y.Y, 2) : "kayıt yok";
                var ts = new TabloSatiri(y.Ad, kay, string.IsNullOrEmpty(y.Yeni) ? "—" : y.Yeni, string.IsNullOrEmpty(y.Fark) ? "ölçülmedi" : y.Fark);
                if (!string.IsNullOrEmpty(y.Yeni) && y.Yeni != "—") { ts.Renk = Tema.Hazir; }
                if (!y.Kayitli) { ts.VurguSutun = 1; ts.VurguRenk = Tema.Duraklatildi; }
                satirlar.Add(ts);
            }
            tblYuva.Ayarla(satirlar);
            tblYuva.Secili = Array.IndexOf(yuvaAdlari, secili);
            lblJogKonum.Metin = "MAK  X " + Bicim.Sayi(d.MX) + "  Y " + Bicim.Sayi(d.MY) + "  Z " + Bicim.Sayi(d.MZ) + "  A " + Bicim.Sayi(d.MA) + "  B " + Bicim.Sayi(d.MB) +
                (string.IsNullOrEmpty(d.YuvaOrtak) ? "" : "\nKayıtlı ortak: " + d.YuvaOrtak);
            chkZ.Acik = d.Ayar("YuvaZ", "0") == "1";
            SeciliYaz();

            double[] m = { d.MX, d.MY, d.MZ, d.MA, d.MB }, w = { d.X, d.Y, d.Z, d.A, d.B };
            string[] eks = { "X", "Y", "Z", "A", "B" };
            for (int i = 0; i < 5; i++)
            {
                jDeger[i].Etiket = eks[i] + "  ·  mak " + Bicim.Sayi(m[i]);
                jDeger[i].Deger = Bicim.Sayi(w[i]);
            }

            lblMilDurum.Metin = d.IsMiliCalisiyor ? "Çalışıyor · " + d.IsMiliDevir + " dev/dk" : "Duruyor";
            if (d.IsMiliCalisiyor) lblMilDurum.Renk(Tema.Calisiyor); else lblMilDurum.RenkRol = YaziRol.Soluk;
            lblSogutma.Metin = "M7 " + (d.M7 ? "AÇIK" : "kapalı") + "   ·   M8 " + (d.M8 ? "AÇIK" : "kapalı");
            lstKart.SagMetin = d.YuvaKaydedilmemis ? "KAYDEDİLMEDİ" : "";

            // frez ömrü sekmesi
            var diger = new StringBuilder();
            int dolan = 0, yakin = 0;
            if (d.FrezOmurleri != null)
                foreach (var f in d.FrezOmurleri)
                {
                    if (f == null) continue;
                    if (f.Omur > 0 && f.Seviye == 2) dolan++; else if (f.Omur > 0 && f.Seviye == 1) yakin++;
                    if (f.Takim >= 1 && f.Takim <= 6) continue;
                    diger.Append(diger.Length > 0 ? "   ·   " : "").Append("T" + f.Takim.ToString(Bicim.Inv) + "  " + OmurCizim.Kisa(f));
                }
            for (int i = 0; i < 6; i++) omurSatir[i].Ayarla(OmurCizim.Bul(d, i + 1) ?? new FrezOmruBilgisi(i + 1, 0, 0, ""), d.Takim == i + 1);
            lblOmurDiger.Metin = diger.Length > 0 ? "Diğer takımlar:   " + diger : "Diğer takımlar: yok   ·   ömür dakika olarak girilir (0 = girilmedi); süre yalnız iş kesim yaparken iş milindeki frez için sayılır";
            omurKart.SagMetin = dolan > 0 ? dolan.ToString(Bicim.Inv) + " FREZ ÖMRÜNÜ DOLDURDU" : (yakin > 0 ? yakin.ToString(Bicim.Inv) + " FREZ ÖMRÜNE YAKLAŞTI" : "yalnız iş kesim yaparken sayılır");
            omurKart.SagRenk = dolan > 0 ? Tema.Alarm : (yakin > 0 ? Tema.Duraklatildi : Tema.Soluk);
        }
    }

    /// <summary>Ekranlar arası geçiş isteği (Kabuk doldurur).</summary>
    public static class Gezinti
    {
        public static Action<string> Git;
        public static void Ac(string ekran) { var h = Git; if (h != null) h(ekran); }
    }

    // =====================================================================
    //  3. KALİBRASYON (kart menüsü + iki sihirbaz)
    // =====================================================================
    public class KalibrasyonEkrani : Ekran
    {
        readonly Control hub, disk, oto;
        // hub
        readonly Yazi lblG54, lblG92, hDiskDurum, hOtoDurum, hUretici, hRaf, hYedek;
        readonly Card hOtoKart;
        // disk
        readonly AdimGostergesi dAdim;
        readonly Card dGovde;
        readonly Control[] dSayfa = new Control[5];
        readonly Yazi dDurum, dG54, dYerlesim, dUyari;
        readonly TouchButton dGeri, dIleri;
        readonly DegerKutusu dKalT, dKalD;
        readonly SecimGrubu dTest;
        readonly Dictionary<string, DegerKutusu> dOlcum = new Dictionary<string, DegerKutusu>();
        readonly Anahtar dSA, dSB, dSY;
        readonly Tablo dSonuc, dUygula;
        // oto
        readonly AdimGostergesi oAdim;
        readonly Card oGovde;
        readonly Control[] oSayfa = new Control[5];
        readonly Yazi oDurum, oG54, oProbBilgi, oProbSonuc, oOlcDurum, oUyari, oBitmis;
        readonly TouchButton oGeri, oIleri, oProbBtn;
        readonly DegerKutusu oT, oUcD;
        readonly SecimGrubu oTHizli, oUc;
        readonly ProbGostergesi oProb;
        readonly Tablo oSonuc, oKalite, oUygula;
        string sayfa = "hub";

        static readonly string[] diskAdimlari = { "Başlangıç", "Test bloğu", "Ölçümler", "Hesapla", "Uygula" };
        static readonly string[] diskBaslik = { "① Başlangıç", "② Test bloğu (T1, boş PMMA disk)", "③ Ölçümler (kumpas, mm)", "④ Hesapla", "⑤ Uygula ve kaydet" };
        static readonly string[] otoAdimlari = { "Hazırlık", "Prob testi", "Ölçüm", "Sonuç", "Uygula" };
        static readonly string[] otoBaslik = { "① Hazırlık", "② Prob testi (zorunlu · hareket yok)", "③ Ölçüm", "④ Sonuç", "⑤ Uygula ve kaydet" };
        /// <summary>Disk kalibrasyonu ölçüm alanları: anahtar, etiket.</summary>
        public static readonly string[,] DiskOlcumleri = {
            { "w", "1  Pencere genişliği (X yönü)" }, { "d1", "2  Z cebi Ø6 derinliği · ÜSTTEN" }, { "d2", "3  Z cebi Ø6 derinliği · ALTTAN" },
            { "dR", "4  Dış Ø5 cebi derinliği" }, { "dL", "5  Dış Ø7 cebi derinliği" }, { "dF", "6  Dış Ø8 cebi derinliği" },
            { "dK", "7  Dış Ø4 cebi derinliği" }, { "dAp", "8  İç Ø8 cebi (A+20), ortası" }, { "dAm", "9  İç Ø7 cebi (A−20), ortası" } };

        public KalibrasyonEkrani()
        {
            // ================= HUB
            var h = new Izgara(1, 2).Satirlar(56, -100);
            hub = h;
            var bilgi = new Card(); bilgi.Bosluk = 8;
            h.Ekle(bilgi, 0, 0);
            var bi = new Izgara(2, 1).Sutunlar(-68, -32);
            bilgi.Controls.Add(bi); bi.Dock = DockStyle.Fill;
            lblG54 = bi.Ekle(Etiket("G54  —", 13f, true, YaziRol.Normal), 0, 0); lblG54.SayiYazisi = true; lblG54.Kucult = true;
            lblG92 = bi.Ekle(Etiket("", 11f, true, YaziRol.Soluk), 1, 0); lblG92.Yatay = StringAlignment.Far; lblG92.Kucult = true;
            var kartlar = new Izgara(3, 2); kartlar.Bosluk = 12;
            h.Ekle(kartlar, 0, 1);
            Card k;
            k = HubKart("Disk kalibrasyonu", Simge.Disk, "Kumpasla: test bloğu kaz, 9 ölçümü gir, hesapla, uygula. X Y Z A B.", out hDiskDurum,
                Dugme("SİHİRBAZI AÇ", Simge.Sag, Rol.Vurgu, null, null), null, null);
            ((TouchButton)k.Tag).Tiklandi += delegate { Sayfa("disk"); };
            kartlar.Ekle(k, 0, 0);
            k = HubKart("Otomatik kalibrasyon", Simge.Prob, "İletken temas, titanyum disk, 18 nokta. Prob testi zorunlu adımdır.", out hOtoDurum,
                Dugme("SİHİRBAZI AÇ", Simge.Sag, Rol.Vurgu, null, null), null, null);
            ((TouchButton)k.Tag).Tiklandi += delegate { Sayfa("oto"); };
            hOtoKart = k;
            kartlar.Ekle(k, 1, 0);
            Yazi bos;
            k = HubKart("Takım boyu ve Z", Simge.Olcum, "Sensörde takım boyunu ölç (G92 Z) ya da iş milinin şu anki Z'sini alma yüksekliği (#4000) yap.", out bos,
                Dugme("TAKIM BOYUNU ÖLÇ", Simge.Olcum, Rol.Normal, "takim.olc", ""), Dugme("Z = ALMA (#4000)", Simge.Kaydet, Rol.TehlikeCizgi, "kal.zalma", ""), null);
            kartlar.Ekle(k, 2, 0);
            k = HubKart("G54 ve üretici değeri", Simge.Hedef, "Disk sıfırını üreticinin değerine döndür; G92 kaydırmasını sıfırla.", out hUretici,
                Dugme("ÜRETİCİYE DÖN", Simge.Yenile, Rol.TehlikeCizgi, "kal.uretici", ""), Dugme("G92 SIFIRLA", Simge.Kapat, Rol.TehlikeCizgi, "kal.g92sifirla", ""), null);
            kartlar.Ekle(k, 0, 1);
            var bYuva = Dugme("KONUMU KAYDET", Simge.Konum, Rol.TehlikeCizgi, "kal.konum.yuva", "");
            bYuva.YalnizOlay = true;
            bYuva.Tiklandi += delegate { KonumuYuvaYap(); };
            k = HubKart("Konumdan yuva / sensör", Simge.Konum, "İş milinin şu anki konumunu bir yuva (T1–T6) ya da sensör konumu olarak kaydet. Önce yedek alınır.", out hRaf, bYuva, null, null);
            kartlar.Ekle(k, 1, 1);
            k = HubKart("Yedekler", Simge.Yedek, "G54, #4000–#4033, G28/G30 değerlerini yedekle ya da yedekten geri yükle.", out hYedek,
                Dugme("YEDEKLE", Simge.Kaydet, Rol.Normal, "yedek.al", ""), Dugme("YEDEKTEN YÜKLE", Simge.Yedek, Rol.TehlikeCizgi, "yedek.yukle", ""), Dugme("KLASÖR", Simge.Klasor, Rol.Normal, "klasor.ac", "yedekler"));
            kartlar.Ekle(k, 2, 1);

            // ================= DİSK SİHİRBAZI
            Izgara dg;
            disk = Sihirbaz("Disk kalibrasyonu", diskAdimlari, "kal.disk", out dAdim, out dGovde, out dDurum, out dGeri, out dIleri, out dg);
            // 1
            var d1 = new Izgara(1, 4).Satirlar(70, 44, 64, -100); d1.Bosluk = 12;
            d1.Ekle(Paragraf("İlk kalibrasyonda bir kez: bilinen iyi değerden başlayın. Üretici değerine dönmek G54'ü ve sensör konumunu sıfırlar; önce yedek alınır.", 12f, YaziRol.Normal), 0, 0);
            dG54 = d1.Ekle(Etiket("", 13f, true, YaziRol.Marka), 0, 1); dG54.SayiYazisi = true; dG54.Kucult = true;
            var d1b = new Izgara(2, 1).Sutunlar(380, -100);
            d1.Ekle(d1b, 0, 2);
            d1b.Ekle(Dugme("ÜRETİCİ DEĞERLERİNE DÖN", Simge.Yenile, Rol.TehlikeCizgi, "kal.uretici", ""), 0, 0);
            d1.Ekle(Paragraf("Bitti sayılır: X Y Z farkı ≤ 0.02 mm, A B farkı ≤ 0.05°.  Bir diske 4 test sığar.  Her turda: test kaz → ölç → hesapla → uygula, fark sınırın altına inene kadar tekrarla.", 11f, YaziRol.Soluk), 0, 3);
            dSayfa[0] = d1;
            // 2
            var d2 = new Izgara(2, 1).Sutunlar(-48, -52); d2.Bosluk = 18;
            var d2s = new Izgara(1, 6).Satirlar(56, 56, 26, 50, 56, -100); d2s.Bosluk = 10;
            d2.Ekle(d2s, 0, 0);
            dKalT = d2s.Ekle(new DegerKutusu { Etiket = "Disk kalınlığı (kumpas)", AyarAdi = "KalT", Ondalik = 2, Min = 5, Max = 40, Birim = "mm" }, 0, 0);
            dKalD = d2s.Ekle(new DegerKutusu { Etiket = "T1 çapı", AyarAdi = "KalD", Ondalik = 2, Min = 0.5, Max = 6, Birim = "mm" }, 0, 1);
            d2s.Ekle(Etiket("Test no", 10.5f, true, YaziRol.Soluk), 0, 2);
            var d2t = new Izgara(2, 1).Sutunlar(-60, -40); d2t.Bosluk = 10;
            d2s.Ekle(d2t, 0, 3);
            dTest = d2t.Ekle(new SecimGrubu(new[] { "1 / 4", "2 / 4", "3 / 4", "4 / 4" }, new[] { "1", "2", "3", "4" }, "kal.disk.test", null), 0, 0);
            dTest.Secili = 0;
            d2t.Ekle(Dugme("YENİ DİSK (TEST 1)", Simge.Disk, Rol.Normal, "kal.disk.test", "1"), 1, 0).YaziPt = 11f;
            d2s.Ekle(Dugme("TEST PROGRAMINI HAZIRLA", Simge.Terminal, Rol.Vurgu, "kal.disk.hazirla", ""), 0, 4);
            d2s.Ekle(Paragraf("Program T1 ile cepleri ve pencereyi keser; hazırlanınca Üretim'de BAŞLAT ile çalıştırın.", 10.5f, YaziRol.Soluk), 0, 5);
            var yc = new Card("Yerleşim (üstten bakış, ön = saat 6)"); yc.BaslikSimge = Simge.Disk;
            d2.Ekle(yc, 1, 0);
            dYerlesim = Paragraf("", 11.5f, YaziRol.Normal); dYerlesim.SayiYazisi = true;
            yc.Controls.Add(dYerlesim); dYerlesim.Dock = DockStyle.Fill;
            dSayfa[1] = d2;
            // 3
            var d3 = new Izgara(2, 6); d3.Bosluk = 10;
            for (int i = 0; i < 9; i++)
            {
                string an = DiskOlcumleri[i, 0];
                var dk = new DegerKutusu { Etiket = DiskOlcumleri[i, 1], Komut = "kal.disk.olcum", AyarAdi = an, Ondalik = 3, Min = 0, Max = 30, Pt = 14f };
                dk.Bos = true;
                dOlcum[an] = d3.Ekle(dk, i < 5 ? 0 : 1, i < 5 ? i : i - 5);
            }
            var ters = new Izgara(3, 1); ters.Bosluk = 8;
            d3.Ekle(ters, 1, 4, 1, 2);
            dSA = TersAnahtar(ters, 0, "A yönü ters", "KalSA");
            dSB = TersAnahtar(ters, 1, "B yönü ters", "KalSB");
            dSY = TersAnahtar(ters, 2, "Y yönü ters", "KalSY");
            dSayfa[2] = d3;
            // 4
            var d4 = new Izgara(1, 3).Satirlar(60, -100, 60); d4.Bosluk = 10;
            var d4b = new Izgara(2, 1).Sutunlar(260, -100); d4b.Bosluk = 14;
            d4.Ekle(d4b, 0, 0);
            d4b.Ekle(Dugme("HESAPLA", Simge.Hedef, Rol.Vurgu, "kal.disk.hesapla", ""), 0, 0);
            d4b.Ekle(Paragraf("Eğim, dX, dY, h (Z), dA, dB ve disk ortası kaçıklığı ölçümlerden hesaplanır. Henüz hiçbir şey yazılmaz.", 10.5f, YaziRol.Soluk), 1, 0);
            dSonuc = d4.Ekle(SonucTablosu(), 0, 1);
            dUyari = d4.Ekle(Paragraf("", 10.5f, YaziRol.Ozel), 0, 2);
            dSayfa[3] = d4;
            // 5
            dSayfa[4] = UygulaSayfasi("kal.disk", out dUygula,
                "Onaylanınca: yedek alınır, varsa G92 sıfırlanır (G92.1), G54 X Y A B (G10 L2 P1) ve #4002 yazılır, kalibrasyon_gecmisi.csv'ye eklenir.");
            foreach (var s in dSayfa) { s.Dock = DockStyle.Fill; s.Visible = false; dGovde.Controls.Add(s); }

            // ================= OTO SİHİRBAZ
            Izgara og;
            oto = Sihirbaz("Otomatik kalibrasyon", otoAdimlari, "kal.oto", out oAdim, out oGovde, out oDurum, out oGeri, out oIleri, out og);
            oAdim.Kilitli = 1;
            // 1
            var o1 = new Izgara(2, 1).Sutunlar(-50, -50); o1.Bosluk = 18;
            var o1l = new Izgara(1, 2).Satirlar(-100, 48); o1l.Bosluk = 8;
            o1.Ekle(o1l, 0, 0);
            o1l.Ekle(Paragraf("☐  Titanyum disk: tutucuya değen kenarı Kapton bantla izole\n\n☐  Disk kablosu (bakır bant) → prob girişi, şase → GND\n\n☐  İş milinde pim yok (program \"T1 tak\" deyince pimi takın)\n\n☐  Makine home almış, disk temiz (alkol)", 12f, YaziRol.Normal), 0, 0);
            oG54 = o1l.Ekle(Etiket("", 10.5f, true, YaziRol.Marka), 0, 1); oG54.SayiYazisi = true; oG54.Sar = true;
            o1l.SatirGizle(1, true);
            var o1r = new Izgara(1, 6).Satirlar(56, 48, 26, 50, 56, -100); o1r.Bosluk = 10;
            o1.Ekle(o1r, 1, 0);
            oT = o1r.Ekle(new DegerKutusu { Etiket = "Disk kalınlığı (mikrometre)", AyarAdi = "OkT", Ondalik = 2, Min = 8, Max = 30, Birim = "mm" }, 0, 0);
            oTHizli = o1r.Ekle(new SecimGrubu(new[] { "10", "12", "18", "20" }, new[] { "10.00", "12.00", "18.00", "20.00" }, "ayar.kaydet", "OkT"), 0, 1);
            oTHizli.SecimDegisti += delegate { double v; if (Bicim.Ayristir(oTHizli.SeciliDeger, out v)) oT.Deger = v; };
            o1r.Ekle(Etiket("Temas ucu", 10.5f, true, YaziRol.Soluk), 0, 2);
            oUc = o1r.Ekle(new SecimGrubu(new[] { "Düz uçlu pim", "Küresel frez (T1)" }, new[] { "duz", "kure" }, "ayar.kaydet", "OkUc"), 0, 3);
            oUcD = o1r.Ekle(new DegerKutusu { Etiket = "Uç çapı Ø", AyarAdi = "OkUcD", Ondalik = 2, Min = 0.5, Max = 6, Birim = "mm" }, 0, 4);
            oSayfa[0] = o1;
            // 2
            var o2 = new Izgara(2, 1).Sutunlar(-40, -60); o2.Bosluk = 18;
            oProb = o2.Ekle(new ProbGostergesi(), 0, 0);
            var o2r = new Izgara(1, 6).Satirlar(78, 28, 56, 56, 40, -100); o2r.Bosluk = 10;
            o2.Ekle(o2r, 1, 0);
            o2r.Ekle(Paragraf("Kabloyu pime / iş miline değdirin → gösterge YEŞİL (TEMAS VAR) yanmalı. Bırakın → TEMAS YOK.  Disk takılıyken ve pim diske değmiyorken TEMAS YOK olmalı.", 12f, YaziRol.Normal), 0, 0);
            oProbBilgi = o2r.Ekle(Etiket("", 10.5f, false, YaziRol.Soluk), 0, 1); oProbBilgi.SayiYazisi = true;
            oProbBtn = o2r.Ekle(Dugme("PROB TESTİNİ BAŞLAT", Simge.Oynat, Rol.Vurgu, "kal.prob.basla", ""), 0, 2);
            o2r.Ekle(Dugme("GİRİŞİ YENİDEN ÖĞREN", Simge.Yenile, Rol.Normal, "kal.prob.ogren", ""), 0, 3);
            oProbSonuc = o2r.Ekle(Etiket("", 13f, true, YaziRol.Soluk), 0, 4); oProbSonuc.Kucult = true;
            o2r.Ekle(Paragraf("Bu adım geçilmeden ölçüm programı hazırlanamaz. Test sırasında makine hareket etmez.", 10.5f, YaziRol.Soluk), 0, 5);
            oSayfa[1] = o2;
            // 3
            var o3 = new Izgara(1, 5).Satirlar(64, 50, 64, 56, -100); o3.Bosluk = 12;
            var o3a = new Izgara(2, 1).Sutunlar(380, -100); o3a.Bosluk = 14;
            o3.Ekle(o3a, 0, 0);
            o3a.Ekle(Dugme("ÖLÇÜM PROGRAMINI HAZIRLA", Simge.Terminal, Rol.Vurgu, "kal.oto.hazirla", ""), 0, 0);
            o3a.Ekle(Paragraf("18 nokta × 2 ölçüm, merkezde 5 tekrar (G38.2). Önce uç çapı, disk kalınlığı ve prob kontrol edilir.", 10.5f, YaziRol.Soluk), 1, 0);
            o3.Ekle(Etiket("→  Sonra Üretim ekranında BAŞLAT  (yaklaşık 10 dk)", 14f, true, YaziRol.Normal), 0, 1);
            var o3b = new Izgara(3, 1).Sutunlar(280, 280, -100); o3b.Bosluk = 14;
            o3.Ekle(o3b, 0, 2);
            var bUr = o3b.Ekle(Dugme("ÜRETİM EKRANINA GİT", Simge.Uretim, Rol.Normal, null, null), 0, 0);
            bUr.Tiklandi += delegate { Gezinti.Ac("uretim"); };
            o3b.Ekle(Dugme("FREZ BOYUNU ÖLÇ", Simge.Olcum, Rol.Normal, "takim.olc", ""), 1, 0);
            oOlcDurum = o3.Ekle(Etiket("", 13f, true, YaziRol.Marka), 0, 3); oOlcDurum.Kucult = true;
            oSayfa[2] = o3;
            // 4
            var o4 = new Izgara(2, 2).Satirlar(60, -100).Sutunlar(-56, -44); o4.Bosluk = 12;
            var o4b = new Izgara(2, 1).Sutunlar(280, -100); o4b.Bosluk = 14;
            o4.Ekle(o4b, 0, 0, 2, 1);
            o4b.Ekle(Dugme("SONUÇLARI OKU", Simge.Liste, Rol.Vurgu, "kal.oto.oku", ""), 0, 0);
            oBitmis = o4b.Ekle(Etiket("", 12f, true, YaziRol.Soluk), 1, 0); oBitmis.Kucult = true;
            var o4l = new Izgara(1, 2).Satirlar(-100, 74); o4l.Bosluk = 6;
            o4.Ekle(o4l, 0, 1);
            oSonuc = o4l.Ekle(SonucTablosu(), 0, 0);
            oUyari = o4l.Ekle(Paragraf("", 10f, YaziRol.Ozel), 0, 1);
            oKalite = o4.Ekle(new Tablo(new[] { "Ölçüm kalitesi", "Değer" }, new[] { 52f, 48f }), 1, 1);
            oKalite.SayiYazisi = false; oKalite.Pt = 10.5f; oKalite.SatirH = 36;
            oSayfa[3] = o4;
            // 5
            oSayfa[4] = UygulaSayfasi("kal.oto", out oUygula,
                "Onaylanınca: yedek alınır, G92.1, G54 X Y A B (G10 L2 P1), #4002 yazılır, #4100 = 0 ve oto_kalibrasyon_gecmisi.csv'ye eklenir. Sonuç büyükse ikinci onay istenir. Kaydettikten sonra bir kez daha ölçün (bitti: X Y Z ≤ 0.01 mm, A B ≤ 0.02°).");
            foreach (var s in oSayfa) { s.Dock = DockStyle.Fill; s.Visible = false; oGovde.Controls.Add(s); }

            foreach (var c in new[] { hub, disk, oto }) { c.Dock = DockStyle.Fill; c.Visible = false; Controls.Add(c); }
            Sayfa("hub");
            AdimGoster(dAdim, dGovde, dSayfa, diskBaslik, 0, dGeri, dIleri, "kal.disk");
            AdimGoster(oAdim, oGovde, oSayfa, otoBaslik, 0, oGeri, oIleri, "kal.oto");
        }

        Anahtar TersAnahtar(Izgara iz, int sutun, string metin, string ayar)
        {
            var c = new Izgara(1, 2).Satirlar(24, -100); c.Bosluk = 4;
            iz.Ekle(c, sutun, 0);
            var y = c.Ekle(Etiket(metin, 10.5f, true, YaziRol.Soluk), 0, 0); y.Yatay = StringAlignment.Far;
            return c.Ekle(new Anahtar(ayar), 0, 1);
        }

        static Tablo SonucTablosu()
        {
            var t = new Tablo(new[] { "Eksen", "Şu an", "Düzeltme", "Yeni değer", "" }, new[] { 25f, 21f, 20f, 23f, 11f });
            t.Pt = 12.5f; t.SatirH = 38;
            return t;
        }

        Control UygulaSayfasi(string onek, out Tablo tablo, string aciklama)
        {
            var u = new Izgara(1, 3).Satirlar(-100, 56, 64); u.Bosluk = 12;
            tablo = u.Ekle(new Tablo(new[] { "Değer", "Eski", "Yeni", "Fark" }, new[] { 22f, 28f, 28f, 22f }), 0, 0);
            tablo.Pt = 13f; tablo.SatirH = 40;
            u.Ekle(Paragraf(aciklama, 10.5f, YaziRol.Soluk), 0, 1);
            var b = new Izgara(4, 1).Sutunlar(340, 180, 220, -100); b.Bosluk = 12;
            u.Ekle(b, 0, 2);
            b.Ekle(Dugme("UYGULA VE KAYDET", Simge.Kaydet, Rol.Tehlike, onek + ".uygula", ""), 0, 0).YaziPt = 14f;
            b.Ekle(Dugme("GEÇMİŞ", Simge.Liste, Rol.Normal, onek + ".gecmis", ""), 1, 0);
            b.Ekle(Dugme("FREZ BOYUNU ÖLÇ", Simge.Olcum, Rol.Normal, "takim.olc", ""), 2, 0);
            return u;
        }

        Card HubKart(string baslik, Simge s, string aciklama, out Yazi durum, TouchButton b1, TouchButton b2, TouchButton b3)
        {
            var k = new Card(baslik); k.BaslikSimge = s;
            int n = (b1 != null ? 1 : 0) + (b2 != null ? 1 : 0) + (b3 != null ? 1 : 0);
            var iz = new Izgara(1, 3 + (n > 1 ? 1 : 0));
            if (n > 1) iz.Satirlar(-100, 24, 52, 52); else iz.Satirlar(-100, 24, 56);
            iz.Bosluk = 8;
            k.Controls.Add(iz); iz.Dock = DockStyle.Fill;
            iz.Ekle(Paragraf(aciklama, 11f, YaziRol.Soluk), 0, 0);
            durum = iz.Ekle(Etiket("", 10.5f, true, YaziRol.Marka), 0, 1); durum.Kucult = true;
            if (n == 1) iz.Ekle(b1, 0, 2);
            else
            {
                iz.Ekle(b1, 0, 2);
                var alt = new Izgara(n - 1, 1); alt.Bosluk = 8;
                iz.Ekle(alt, 0, 3);
                alt.Ekle(b2, 0, 0);
                if (b3 != null) alt.Ekle(b3, 1, 0);
            }
            foreach (var b in new[] { b1, b2, b3 }) if (b != null) b.YaziPt = 12f;
            k.Tag = b1;
            return k;
        }

        Control Sihirbaz(string baslik, string[] adimlar, string onek, out AdimGostergesi ag, out Card govde, out Yazi durum, out TouchButton geri, out TouchButton ileri, out Izgara kok)
        {
            var w = new Izgara(1, 3).Satirlar(70, -100, 64); w.Bosluk = 10;
            kok = w;
            var ust = new Izgara(3, 1).Sutunlar(170, -32, -68); ust.Bosluk = 14;
            w.Ekle(ust, 0, 0);
            var bk = ust.Ekle(Dugme("KALİBRASYON", Simge.Sol, Rol.Normal, null, null), 0, 0); bk.YaziPt = 11f;
            bk.Tiklandi += delegate { Sayfa("hub"); };
            var t = ust.Ekle(Etiket(Bicim.BuyukHarf(baslik), 16f, true, YaziRol.Normal), 1, 0); t.Kucult = true;
            ag = ust.Ekle(new AdimGostergesi(adimlar), 2, 0);
            ag.AdimSecildi += i => Komut(onek + ".adim", i.ToString(Bicim.Inv));
            govde = w.Ekle(new Card(" "), 0, 1);
            var alt = new Izgara(3, 1).Sutunlar(210, -100, 250); alt.Bosluk = 14;
            w.Ekle(alt, 0, 2);
            geri = alt.Ekle(Dugme("GERİ", Simge.Sol, Rol.Normal, onek + ".geri", ""), 0, 0);
            durum = alt.Ekle(Etiket("", 12f, true, YaziRol.Marka), 1, 0); durum.Yatay = StringAlignment.Center; durum.Kucult = true;
            ileri = alt.Ekle(Dugme("İLERİ", Simge.Sag, Rol.Vurgu, onek + ".ileri", ""), 2, 0);
            return w;
        }

        void AdimGoster(AdimGostergesi ag, Card govde, Control[] sayfalar, string[] basliklar, int adim, TouchButton geri, TouchButton ileri, string onek)
        {
            if (adim < 0) adim = 0; if (adim >= sayfalar.Length) adim = sayfalar.Length - 1;
            ag.Etkin = adim;
            govde.Baslik = basliklar[adim];
            for (int i = 0; i < sayfalar.Length; i++) if (sayfalar[i].Visible != (i == adim)) sayfalar[i].Visible = i == adim;
            geri.Etkin = adim > 0;
            bool son = adim == sayfalar.Length - 1;
            ileri.Metin = son ? "BİTİR" : "İLERİ";
            ileri.Simge = son ? Simge.Tamam : Simge.Sag;
            ileri.KomutAyarla(son ? onek + ".bitir" : onek + ".ileri", "");
        }

        void KonumuYuvaYap()
        {
            int i = Diyalog.Secim("Konumdan yuva / sensör", "İş milinin şu anki konumu hangi nokta olarak kaydedilsin?\nT1 seçilirse diğer yuvalar T1 ile birlikte kaydırılabilir (ayrıca sorulur).",
                new[] { "T1", "T2", "T3", "T4", "T5", "T6", "SENSÖR" });
            if (i < 0) return;
            Komut("kal.konum.yuva", i < 6 ? "T" + (i + 1) : "SENSÖR");
        }

        /// <summary>"hub", "disk" ya da "oto".</summary>
        public void Sayfa(string ad)
        {
            if (ad != "disk" && ad != "oto") ad = "hub";
            bool degisti = sayfa != ad;
            sayfa = ad;
            hub.Visible = ad == "hub"; disk.Visible = ad == "disk"; oto.Visible = ad == "oto";
            if (degisti) Komut("kal.ac", ad);
        }
        public string AcikSayfa { get { return sayfa; } }

        static string G54Metni(MakineDurumu d)
        {
            if (d.G54 == null || d.G54.Length < 5) return "G54  —";
            return "G54   X " + Bicim.Sayi(d.G54[0]) + "   Y " + Bicim.Sayi(d.G54[1]) + "   Z " + Bicim.Sayi(d.G54[2]) +
                   "   A " + Bicim.Sayi(d.G54[3]) + "   B " + Bicim.Sayi(d.G54[4]) +
                   (d.Param != null && d.Param.Length > 2 ? "    ·    #4002 " + Bicim.Sayi(d.Param[2]) : "");
        }

        static List<TabloSatiri> SonucSatirlari(List<KalSonucSatiri> l)
        {
            var r = new List<TabloSatiri>();
            if (l == null) return r;
            foreach (var s in l)
            {
                var t = new TabloSatiri(s.Eksen, s.Eski ?? "", s.Duzeltme ?? "", s.Yeni ?? "", s.Iyi ? "✓" : "⚠");
                t.VurguSutun = 4; t.VurguRenk = s.Iyi ? Tema.Hazir : Tema.Duraklatildi;
                r.Add(t);
            }
            return r;
        }
        static List<TabloSatiri> UygulaSatirlari(List<KalSonucSatiri> l)
        {
            var r = new List<TabloSatiri>();
            if (l == null) return r;
            foreach (var s in l)
            {
                var t = new TabloSatiri(s.Eksen, s.Eski ?? "", s.Yeni ?? "", s.Duzeltme ?? "");
                t.VurguSutun = 2; t.VurguRenk = Tema.Marka;
                r.Add(t);
            }
            return r;
        }

        public override void DurumUygula(MakineDurumu d)
        {
            string g54 = G54Metni(d);
            lblG54.Metin = g54; dG54.Metin = g54; oG54.Metin = g54;
            bool g92 = d.G92 != null && d.G92.Length >= 5 && (d.G92[0] != 0 || d.G92[1] != 0 || d.G92[3] != 0 || d.G92[4] != 0);
            if (g92) { lblG92.Metin = "⚠ G92 aktif: X " + Bicim.Sayi(d.G92[0]) + " Y " + Bicim.Sayi(d.G92[1]) + " A " + Bicim.Sayi(d.G92[3]) + " B " + Bicim.Sayi(d.G92[4]); lblG92.Renk(Tema.Alarm); }
            else { lblG92.Metin = d.DegiskenlerOkundu ? "G92 yok ✓" : "Değerler okunmadı"; lblG92.RenkRol = YaziRol.Soluk; }
            hDiskDurum.Metin = d.DiskDurum ?? "";
            if (d.OtoOlcumBitti && !d.OtoSonucHazir) { hOtoDurum.Metin = "Bitmiş ölçüm var · SONUÇLARI OKU"; hOtoDurum.Renk(Tema.Hazir); hOtoKart.Vurgu = Tema.Hazir; }
            else { hOtoDurum.Metin = d.OtoDurum ?? ""; hOtoDurum.RenkRol = YaziRol.Marka; hOtoKart.Vurgu = Color.Empty; }
            hUretici.Metin = d.UreticiFark ?? "";
            hRaf.Metin = d.RafOzeti ?? "";
            hYedek.Metin = string.IsNullOrEmpty(d.SonYedek) ? "" : "Son yedek: " + d.SonYedek;

            // disk
            AdimGoster(dAdim, dGovde, dSayfa, diskBaslik, d.DiskAdim, dGeri, dIleri, "kal.disk");
            DegerAyarla(dKalT, d.Ayar("KalT", "16.00"));
            DegerAyarla(dKalD, d.Ayar("KalD", "2.00"));
            dTest.Secili = Math.Max(0, Math.Min(3, d.DiskTestNo - 1));
            dYerlesim.Metin = d.DiskYerlesim ?? "";
            foreach (var kv in dOlcum)
            {
                string v;
                if (d.DiskOlcum != null && d.DiskOlcum.TryGetValue(kv.Key, out v)) DegerAyarla(kv.Value, v);
            }
            dSA.Acik = d.Ayar("KalSA", "0") == "1"; dSB.Acik = d.Ayar("KalSB", "0") == "1"; dSY.Acik = d.Ayar("KalSY", "0") == "1";
            dSonuc.Ayarla(SonucSatirlari(d.DiskSonuc));
            dUygula.Ayarla(UygulaSatirlari(d.DiskSonuc));
            dUyari.Metin = d.DiskUyarilar == null ? "" : string.Join("\n", d.DiskUyarilar.ToArray());
            dUyari.Renk(Tema.Duraklatildi);
            dDurum.Metin = d.DiskDurum ?? "";

            // oto
            AdimGoster(oAdim, oGovde, oSayfa, otoBaslik, d.OtoAdim, oGeri, oIleri, "kal.oto");
            oAdim.Kilitli = d.ProbTestGecti ? -1 : 1;
            DegerAyarla(oT, d.Ayar("OkT", "10.00"));
            oTHizli.DegerSec(Bicim.Sayi(oT.Deger, 2));
            oUc.DegerSec(d.Ayar("OkUc", "duz"));
            DegerAyarla(oUcD, d.Ayar("OkUcD", "3.00"));
            oProb.Aktif = d.ProbTestAktif; oProb.Temas = d.ProbTemas;
            oProbBilgi.Metin = string.IsNullOrEmpty(d.ProbGiris) ? "Prob girişi henüz öğrenilmedi" : "Prob girişi: " + d.ProbGiris;
            oProbBtn.Metin = d.ProbTestAktif ? "PROB TESTİNİ DURDUR" : "PROB TESTİNİ BAŞLAT";
            oProbBtn.Simge = d.ProbTestAktif ? Simge.Durdur : Simge.Oynat;
            oProbBtn.KomutAyarla(d.ProbTestAktif ? "kal.prob.durdur" : "kal.prob.basla", "");
            if (d.ProbTestGecti) { oProbSonuc.Metin = "✓  Prob testi geçti"; oProbSonuc.Renk(Tema.Hazir); }
            else { oProbSonuc.Metin = "İlerlemek için TEMAS VAR ve TEMAS YOK görülmeli"; oProbSonuc.Renk(Tema.Duraklatildi); }
            oOlcDurum.Metin = d.OtoDurum ?? "";
            oBitmis.Metin = d.OtoOlcumBitti ? (d.OtoSonucHazir ? "Sonuç okundu. Uygunsa ⑤ Uygula." : "Bitmiş ölçüm var · SONUÇLARI OKU") : "Henüz bitmiş ölçüm yok";
            if (d.OtoOlcumBitti) oBitmis.Renk(Tema.Hazir); else oBitmis.RenkRol = YaziRol.Soluk;
            oSonuc.Ayarla(SonucSatirlari(d.OtoSonuc));
            oUygula.Ayarla(UygulaSatirlari(d.OtoSonuc));
            var kal = new List<TabloSatiri>();
            if (d.OtoKalite != null)
                foreach (var q in d.OtoKalite)
                {
                    var t = new TabloSatiri(q.Ad, q.Deger);
                    t.VurguSutun = 1; t.VurguRenk = q.Tur == MesajTuru.Bilgi ? Color.Empty : Tema.TurRengi(q.Tur);
                    kal.Add(t);
                }
            oKalite.Ayarla(kal);
            oUyari.Metin = d.OtoUyarilar == null ? "" : string.Join("\n", d.OtoUyarilar.ToArray());
            oUyari.Renk(d.OtoBuyuk ? Tema.Alarm : Tema.Duraklatildi);
            oDurum.Metin = d.OtoAdim == 1 ? (d.ProbTestGecti ? "Prob testi geçti" : "Prob testi zorunlu") : (d.OtoDurum ?? "");
        }

        static void DegerAyarla(DegerKutusu k, string v)
        {
            double x;
            if (Bicim.Ayristir(v, out x)) k.Deger = x; else if (string.IsNullOrEmpty(v)) k.Bos = true;
        }
    }

    // =====================================================================
    //  4. AYARLAR (sekmeler)
    // =====================================================================
    public class AyarlarEkrani : Ekran
    {
        static readonly string[] sekmeAdlari = { "Genel", "İş akışı", "Hareket", "Eding", "Uzaktan erişim", "Yedekler", "Makine değişkenleri" };
        static readonly Simge[] sekmeSimge = { Simge.Ayar, Simge.Uretim, Simge.Buyut, Simge.Terminal, Simge.Uzak, Simge.Yedek, Simge.Liste };
        readonly TouchButton[] sekmeDugme = new TouchButton[7];
        readonly Control[] sayfa = new Control[7];
        readonly Card govde;
        readonly Dictionary<string, Anahtar> anahtarlar = new Dictionary<string, Anahtar>();
        readonly Dictionary<string, SecimGrubu> secimler = new Dictionary<string, SecimGrubu>();
        readonly Dictionary<string, DegerKutusu> degerler = new Dictionary<string, DegerKutusu>();
        readonly SecimGrubu tema;
        readonly AyarSatiri edingYol, uzakAdres, sonYedek, kioskSatiri;
        readonly DegerKutusu[] g54 = new DegerKutusu[5];
        readonly Yazi[] g92 = new Yazi[5];
        readonly DegerKutusu[] prm = new DegerKutusu[7];
        readonly Yazi lblDegDurum;
        int etkin;
        /// <summary>Tema seçildi (Kabuk hemen uygular; ayrıca ayar.kaydet Tema=koyu|acik gönderilir).</summary>
        /// <summary>Ayarlar › Genel › Tema seçimi: "koyu", "acik" ya da "gecisli".</summary>
        public event Action<string> TemaIstendi;

        public static readonly string[] ParamAdlari = {
            "#4000  Alma Z", "#4001  Yaklaşma Z", "#4002  Sensör yüksekliği", "#4003  Yavaş yaklaşma",
            "#4004  Ölçüm alt sınırı", "#4005  Aşınma sınırı", "#4006  Takım algılama" };

        public AyarlarEkrani()
        {
            var ana = new Izgara(2, 1).Sutunlar(230, -100); ana.Bosluk = 12;
            Controls.Add(ana); ana.Dock = DockStyle.Fill;
            var sol = new Yigin(); sol.Bosluk = 6;
            ana.Ekle(sol, 0, 0);
            for (int i = 0; i < 7; i++)
            {
                int k = i;
                var b = new TouchButton(sekmeAdlari[i], sekmeSimge[i], Rol.Normal, null, null);
                b.YaziPt = 12f; b.Kalin = true;
                b.Tiklandi += delegate { SekmeGoster(k); };
                sekmeDugme[i] = sol.Ekle(b, 62);
            }
            govde = ana.Ekle(new Card("Genel"), 1, 0);

            // Genel
            var g = Sayfa(0);
            tema = new SecimGrubu(new[] { "Koyu", "Açık", "Geçişli", "Şafak" }, new[] { "koyu", "acik", "gecisli", "safak" }, "ayar.kaydet", "Tema");
            tema.Secili = 0;
            tema.SecimDegisti += delegate { var h = TemaIstendi; if (h != null) h(tema.SeciliDeger); };
            g.Ekle(new AyarSatiri("Tema", "Geçişli / Şafak: zemin iş ilerledikçe renk değiştirir (mavi→yeşil, gece→şafak).", tema, 420), 62);
            var ad = new DegerKutusu { Metinsel = true, AyarAdi = "MakineAdi", EnCokKarakter = 30, Pt = 13f, Etiket = "Makine adı" };
            degerler["MakineAdi"] = ad;
            g.Ekle(new AyarSatiri("Makine adı", "Uzaktan portalda görünen ad.", ad, 280), 62);
            Satir(g, "Dokunmatik ekran klavyesi", "Yazı kutusuna dokununca ekran klavyesi açılsın.", "SanalKlavye");
            Satir(g, "Tam ekran", "Paneli çerçevesiz tam ekran açar (yeniden açılınca).", "TamEkran");
            Satir(g, "Windows açılınca başlasın", "Oturum açılınca panel kendiliğinden başlar.", "WinBaslangic");
            Satir(g, "Koordinatlar makine koordinatı", "Konum kartında makine konumu büyük gösterilir.", "Koordinat");
            Satir(g, "İlerleme parıltısı", "İş sürerken ilerleme çubuğunda hafif parıltı (eski \"dans eden hayvan\" yerine).", "Dansci");
            var pk = new Izgara(2, 1); pk.Bosluk = 10;
            pk.Ekle(Dugme("KÜÇÜLT", Simge.Eksi, Rol.Normal, "panel.kucult", ""), 0, 0).YaziPt = 11f;
            pk.Ekle(Dugme("KAPAT", Simge.Kapat, Rol.TehlikeCizgi, "panel.kapat", ""), 1, 0).YaziPt = 11f;
            g.Ekle(new AyarSatiri("Panel penceresi", "Simge durumuna al ya da paneli kapat (çalışırken onay istenir).", pk, 300), 62);
            var kk = new Izgara(2, 1).Sutunlar(-58, -42); kk.Bosluk = 10;
            kk.Ekle(Dugme("WINDOWS'A GEÇ", Simge.Kilit, Rol.Normal, "kiosk.windows", ""), 0, 0).YaziPt = 11f;
            kk.Ekle(Dugme("PIN", Simge.KilitAcik, Rol.Normal, "kiosk.pin", ""), 1, 0).YaziPt = 11f;
            kioskSatiri = new AyarSatiri("Kiosk modu", "Kapalı", kk, 330);
            g.Ekle(kioskSatiri, 62);

            // İş akışı
            var w = Sayfa(1);
            var fm = Satir(w, "Frez değişimi MANUEL", "Açık: frezi operatör elle değiştirir (#4030 = 1). Kapalı: otomatik değiştirici.", "FrezModu");
            fm.DegerAcik = "MANUEL"; fm.DegerKapali = "OTOMATIK";
            Satir(w, "Açılışta otomatik hazırlık", "Bağlanınca RESET ve (geri sayımdan sonra) HOME.", "OtomatikHazirlik");
            var gs = new DegerKutusu { AyarAdi = "GeriSayim", Ondalik = 0, Min = 0, Max = 60, Birim = "sn", Etiket = "Süre" };
            degerler["GeriSayim"] = gs;
            w.Ekle(new AyarSatiri("Home öncesi geri sayım", "0 = geri sayım yok, her açılışta sorar. Süre dolarsa home YAPILMAZ (İPTAL).", gs, 200), 62);
            var st = new SecimGrubu(new[] { "Saat 3", "Saat 9" }, new[] { "3", "9" }, "ayar.kaydet", "SadeTaraf");
            secimler["SadeTaraf"] = st;
            w.Ekle(new AyarSatiri("Blok ismi tarafı", "Yeni blok isminin kazınacağı yer.", st, 220), 62);
            Satir(w, "Başlatırken frez modunu sor", "Sade akışta kapalıdır.", "ModSor");
            Satir(w, "Başlatırken blok bilgisini sor", "Sade akışta kapalıdır (yerine YENİ BLOK düğmesi).", "BlokSor");

            // Hareket
            var hr = Sayfa(2);
            var ja = new SecimGrubu(new[] { "0.01", "0.1", "1", "10" }, new[] { "0.01", "0.1", "1", "10" }, "ayar.kaydet", "JogAdim");
            secimler["JogAdim"] = ja;
            hr.Ekle(new AyarSatiri("Varsayılan jog adımı", "mm ya da derece.", ja, 300), 62);
            var jh = new SecimGrubu(new[] { "Yavaş", "Orta", "Hızlı" }, new[] { "100", "300", "1000" }, "ayar.kaydet", "JogHiz");
            secimler["JogHiz"] = jh;
            hr.Ekle(new AyarSatiri("Varsayılan jog hızı", "Yavaş 100 · Orta 300 · Hızlı 1000 mm/dk (A/B 50–1000).", jh, 300), 62);
            hr.Ekle(new AyarSatiri("Z− güvenliği", "Z− yönünde 10 mm ve üstü adım onay ister.", null, 0), 56);
            // Çarpışma koruması (takım boyu): disk + tutucu + B ünitesi ölçüleri. Varsayılanlar tahmin, MAKİNEDE ÖLÇÜLMELİ.
            Satir(hr, "Çarpışma koruması (takım boyu)", "Açık: uç boşluğu eğik tutucuya yetmeyen frezle BAŞLAT reddedilir, iş sürerken takım değişince iş duraklatılır.", "CarpismaBekci");
            var cR = new DegerKutusu { AyarAdi = "TutucuYaricap", Ondalik = 1, Min = 0, Max = 200, Birim = "mm", Etiket = "R" };
            degerler["TutucuYaricap"] = cR;
            hr.Ekle(new AyarSatiri("Tutucu yarıçapı (R)", "Disk merkezinden tutucu halkası / B ünitesinin en dış noktası. MAKİNEDE ÖLÇÜLMELİ (varsayılan 56 tahmin).", cR, 200), 62);
            var cH = new DegerKutusu { AyarAdi = "TutucuYariYukseklik", Ondalik = 1, Min = 0, Max = 200, Birim = "mm", Etiket = "H" };
            degerler["TutucuYariYukseklik"] = cH;
            hr.Ekle(new AyarSatiri("Tutucu yarı yüksekliği (H)", "Disk düzken orta düzlemden tutucunun en üst noktası. MAKİNEDE ÖLÇÜLMELİ (varsayılan 13 tahmin).", cH, 200), 62);
            var cP = new DegerKutusu { AyarAdi = "CarpismaPayi", Ondalik = 1, Min = 0, Max = 200, Birim = "mm", Etiket = "Pay" };
            degerler["CarpismaPayi"] = cP;
            hr.Ekle(new AyarSatiri("Çarpışma payı", "Uç ile tutucu arasında kalması gereken en az boşluk (varsayılan 3).", cP, 200), 62);
            hr.Ekle(new AyarSatiri("İlerleme oranı (kazıma hızı)", "Üretim ekranında %30–%150 arası, 10'ar adım. %120 üstü onay ister.", null, 0), 56);
            var jbt = new TouchButton("JOG EKRANINA GİT", Simge.Sag, Rol.Normal, null, null); jbt.YaziPt = 11f;
            jbt.Tiklandi += delegate { Gezinti.Ac("takimlar.hareket"); };
            hr.Ekle(new AyarSatiri("Jog ve konuma git", "Takımlar › Hareket sekmesinde.", jbt, 260), 62);

            // Eding
            var ed = Sayfa(3);
            edingYol = ed.Ekle(new AyarSatiri("Eding klasörü", "", Dugme("KLASÖRÜ AÇ", Simge.Klasor, Rol.Normal, "klasor.ac", "eding"), 200), 62);
            var eg = new Izgara(2, 1); eg.Bosluk = 10;
            eg.Ekle(Dugme("GÖSTER", Simge.Buyut, Rol.Normal, "eding.goster", ""), 0, 0).YaziPt = 11f;
            eg.Ekle(Dugme("GİZLE", Simge.Eksi, Rol.Normal, "eding.gizle", ""), 1, 0).YaziPt = 11f;
            ed.Ekle(new AyarSatiri("Eding penceresi", "Göster: Eding'in kendi ekranı açılır, panel üstte kalmaz.", eg, 300), 62);
            ed.Ekle(new AyarSatiri("Eding'i yeniden başlat", "İş sürerken yapılamaz. Bağlantı kesilir, Eding kapanıp yeniden açılır.", Dugme("YENİDEN BAŞLAT", Simge.Yenile, Rol.TehlikeCizgi, "eding.yeniden", ""), 240), 62);
            ed.Ekle(new AyarSatiri("Eding'i ayarları kaydederek kapat", "Ayarlar kaydedilir, sonra Eding ve sunucusu kapatılır.", Dugme("KAPAT", Simge.Kapat, Rol.TehlikeCizgi, "eding.kapat", ""), 200), 62);
            Satir(ed, "Eding arka planda çalışsın", "Eding penceresi gizli açılır.", "EdingGizli");
            Satir(ed, "Açılışta Eding'i sıfırla", "Eding açık ve boştaysa kapatıp yeniden açar (sade akışta kapalı).", "EdingSifirla");
            var kl = new Izgara(3, 1); kl.Bosluk = 8;
            kl.Ekle(Dugme("İŞLER", Simge.Klasor, Rol.Normal, "klasor.ac", "isler"), 0, 0).YaziPt = 10.5f;
            kl.Ekle(Dugme("LOGLAR", Simge.Klasor, Rol.Normal, "klasor.ac", "loglar"), 1, 0).YaziPt = 10.5f;
            kl.Ekle(Dugme("YEDEKLER", Simge.Klasor, Rol.Normal, "klasor.ac", "yedekler"), 2, 0).YaziPt = 10.5f;
            ed.Ekle(new AyarSatiri("Klasörler", "Dosya gezgininde açar.", kl, 390), 62);

            // Uzaktan
            var uz = Sayfa(4);
            Satir(uz, "Uzaktan erişim açık", "Telefondan izleme (yerel ağ, PIN'li). Yeniden açılınca uygulanır.", "Uzak");
            Satir(uz, "Uzaktan başlatma için blok onayı", "Uzaktan BAŞLAT için önce makinede \"Blok takıldı\" onayı istenir.", "UzakKilit");
            var ug = new TouchButton("UZAKTAN EKRANI", Simge.Sag, Rol.Normal, null, null); ug.YaziPt = 11f;
            ug.Tiklandi += delegate { Gezinti.Ac("uzaktan"); };
            uzakAdres = uz.Ekle(new AyarSatiri("Adres ve PIN", "", ug, 240), 62);

            // Yedekler
            var yd = Sayfa(5);
            yd.Ekle(new AyarSatiri("Ayarları yedekle", "G54, #4000–#4006, #4010–#4021, #4030–#4033, G28/G30 → yedekler\\ayar_*.txt", Dugme("YEDEKLE", Simge.Kaydet, Rol.Normal, "yedek.al", ""), 200), 62);
            yd.Ekle(new AyarSatiri("Yedekten yükle", "Seçilen yedekteki değerler makineye yazılır (önce mevcut değerler yedeklenir).", Dugme("YÜKLE", Simge.Yedek, Rol.TehlikeCizgi, "yedek.yukle", ""), 200), 62);
            yd.Ekle(new AyarSatiri("Yedek klasörü", "", Dugme("AÇ", Simge.Klasor, Rol.Normal, "klasor.ac", "yedekler"), 200), 62);
            yd.Ekle(new AyarSatiri("Disk kalibrasyonu geçmişi", "kalibrasyon_gecmisi.csv", Dugme("GÖSTER", Simge.Liste, Rol.Normal, "kal.disk.gecmis", ""), 200), 62);
            yd.Ekle(new AyarSatiri("Otomatik kalibrasyon geçmişi", "oto_kalibrasyon_gecmisi.csv", Dugme("GÖSTER", Simge.Liste, Rol.Normal, "kal.oto.gecmis", ""), 200), 62);
            sonYedek = yd.Ekle(new AyarSatiri("Son yedek", "—", null, 0), 56);

            // Makine değişkenleri
            var mv = new Izgara(2, 2).Satirlar(-100, 62).Sutunlar(-46, -54); mv.Bosluk = 18;
            sayfa[6] = mv;
            var gc = new Izgara(3, 7).Sutunlar(40, -100, 92).Satirlar(26, 56, 56, 56, 56, 56, -100); gc.Bosluk = 8;
            mv.Ekle(gc, 0, 0);
            gc.Ekle(Etiket("", 9.5f, true, YaziRol.Soluk), 0, 0);
            gc.Ekle(Etiket("G54 · #5221–5225", 9.5f, true, YaziRol.Soluk), 1, 0);
            var gh = gc.Ekle(Etiket("G92", 9.5f, true, YaziRol.Soluk), 2, 0); gh.Yatay = StringAlignment.Far;
            string[] eks = { "X", "Y", "Z", "A", "B" };
            for (int i = 0; i < 5; i++)
            {
                var l = gc.Ekle(Etiket(eks[i], 16f, true, YaziRol.Marka), 0, 1 + i); l.Yatay = StringAlignment.Center;
                g54[i] = gc.Ekle(new DegerKutusu { Yerel = true, Ondalik = 3, Min = -999, Max = 999, Etiket = "G54 " + eks[i], Pt = 15f }, 1, 1 + i);
                g92[i] = gc.Ekle(Etiket("0.000", 12f, false, YaziRol.Soluk), 2, 1 + i); g92[i].SayiYazisi = true; g92[i].Yatay = StringAlignment.Far;
            }
            lblDegDurum = gc.Ekle(Etiket("", 10.5f, true, YaziRol.Soluk), 0, 6, 3, 1); lblDegDurum.Sar = true;
            var pc = new Izgara(2, 9).Sutunlar(-56, -44).Satirlar(26, 50, 50, 50, 50, 50, 50, 50, -100); pc.Bosluk = 6;
            mv.Ekle(pc, 1, 0);
            pc.Ekle(Etiket("Takım değiştirici · #4000–#4006", 9.5f, true, YaziRol.Soluk), 0, 0, 2, 1);
            for (int i = 0; i < 7; i++)
            {
                var pl = pc.Ekle(Etiket(ParamAdlari[i], 11f, false, YaziRol.Normal), 0, 1 + i); pl.Kucult = true;
                prm[i] = pc.Ekle(new DegerKutusu { Yerel = true, Ondalik = 3, Min = -999, Max = 999, Etiket = ParamAdlari[i], Pt = 14f }, 1, 1 + i);
            }
            var mb = new Izgara(5, 1).Sutunlar(-19, -14, -19, -18, -30); mb.Bosluk = 10;
            mv.Ekle(mb, 0, 1, 2, 1);
            mb.Ekle(Dugme("DEĞERLERİ\nOKU", Simge.Yenile, Rol.Normal, "degisken.oku", ""), 0, 0).YaziPt = 11f;
            var vz = mb.Ekle(Dugme("VAZGEÇ", Simge.Kapat, Rol.Normal, null, null), 1, 0); vz.YaziPt = 11f;
            vz.Tiklandi += delegate { foreach (var k in g54) k.Kirli = false; foreach (var k in prm) k.Kirli = false; DegiskenDurum(); Komut("degisken.oku", ""); };
            mb.Ekle(Dugme("Z = ALMA\n(#4000)", Simge.Kaydet, Rol.TehlikeCizgi, "kal.zalma", ""), 2, 0).YaziPt = 11f;
            mb.Ekle(Dugme("G92\nSIFIRLA", Simge.Kapat, Rol.TehlikeCizgi, "kal.g92sifirla", ""), 3, 0).YaziPt = 11f;
            var kd = mb.Ekle(Dugme("KAYDET", Simge.Kaydet, Rol.Tehlike, "degisken.kaydet", ""), 4, 0); kd.YaziPt = 14f;
            kd.YalnizOlay = true;
            kd.Tiklandi += delegate { DegiskenKaydet(); };
            foreach (var k in g54) k.Degisti += delegate { DegiskenDurum(); };
            foreach (var k in prm) k.Degisti += delegate { DegiskenDurum(); };

            foreach (var s in sayfa) { s.Dock = DockStyle.Fill; s.Visible = false; govde.Controls.Add(s); }
            SekmeGoster(0);
        }

        Yigin Sayfa(int i)
        {
            var y = new Yigin(); y.Bosluk = 0;
            sayfa[i] = y;
            return y;
        }

        Anahtar Satir(Yigin y, string baslik, string aciklama, string ayar)
        {
            var a = new Anahtar(ayar);
            anahtarlar[ayar] = a;
            y.Ekle(new AyarSatiri(baslik, aciklama, a, 180), 62);
            return a;
        }

        public void SekmeGoster(int i)
        {
            if (i < 0 || i >= sayfa.Length) return;
            etkin = i;
            for (int k = 0; k < sayfa.Length; k++) { sayfa[k].Visible = k == i; sekmeDugme[k].Secili = k == i; }
            govde.Baslik = sekmeAdlari[i];
        }
        public int Sekme { get { return etkin; } }

        void DegiskenDurum()
        {
            int n = 0;
            foreach (var k in g54) if (k.Kirli) n++;
            foreach (var k in prm) if (k.Kirli) n++;
            lblDegDurum.Metin = n > 0 ? n + " değer değişti · KAYDET ile yazılır" : "";
            if (n > 0) lblDegDurum.Renk(Tema.Duraklatildi); else lblDegDurum.RenkRol = YaziRol.Soluk;
        }

        void DegiskenKaydet()
        {
            var sb = new StringBuilder();
            for (int i = 0; i < 5; i++) { if (sb.Length > 0) sb.Append(';'); sb.Append((5221 + i).ToString(Bicim.Inv)).Append('=').Append(g54[i].DegerMetni); }
            for (int i = 0; i < 7; i++) sb.Append(';').Append((4000 + i).ToString(Bicim.Inv)).Append('=').Append(prm[i].DegerMetni);
            Komut("degisken.kaydet", sb.ToString());
        }

        public override void DurumUygula(MakineDurumu d)
        {
            tema.Secili = (int)Tema.Mod;
            foreach (var kv in anahtarlar)
            {
                string v = d.Ayar(kv.Key, null);
                if (v == null) continue;
                kv.Value.Acik = string.Equals(v, kv.Value.DegerAcik, StringComparison.OrdinalIgnoreCase);
            }
            foreach (var kv in secimler) { string v = d.Ayar(kv.Key, null); if (v != null) kv.Value.DegerSec(v); }
            foreach (var kv in degerler)
            {
                string v = d.Ayar(kv.Key, null); if (v == null) continue;
                if (kv.Value.Metinsel) kv.Value.Metin = v;
                else { double x; if (Bicim.Ayristir(v, out x)) kv.Value.Deger = x; }
            }
            if (d.Ayar("MakineAdi", null) == null && !string.IsNullOrEmpty(d.MakineAdi)) degerler["MakineAdi"].Metin = d.MakineAdi;
            string ey = null;
            if (d.Klasorler != null) foreach (var b in d.Klasorler) if (b.Ad == "Eding") ey = b.Deger;
            edingYol.Aciklama = (ey ?? "—") + "   ·   eding_yolu.txt ile değiştirilebilir";
            uzakAdres.Aciklama = (d.UzakAcik ? (d.UzakAdres ?? "") : "Kapalı") + (string.IsNullOrEmpty(d.UzakPin) ? "   ·   PIN yok" : "   ·   PIN " + d.UzakPin);
            sonYedek.Aciklama = string.IsNullOrEmpty(d.SonYedek) ? "Bu oturumda yedek alınmadı" : d.SonYedek;
            kioskSatiri.Aciklama = d.Kiosk ? "AÇIK · Windows gizli; geçiş ve panel kapatma PIN ister" : "KAPALI · KIOSK_KUR.bat ile kurulur";
            if (d.G54 != null && d.G54.Length >= 5)
                for (int i = 0; i < 5; i++) if (!g54[i].Kirli) g54[i].Deger = d.G54[i];
            if (d.G92 != null && d.G92.Length >= 5)
                for (int i = 0; i < 5; i++)
                {
                    g92[i].Metin = Bicim.Sayi(d.G92[i]);
                    if (d.G92[i] != 0 && i != 2) g92[i].Renk(Tema.Alarm); else g92[i].RenkRol = YaziRol.Soluk;
                }
            if (d.Param != null && d.Param.Length >= 7)
                for (int i = 0; i < 7; i++) if (!prm[i].Kirli) prm[i].Deger = d.Param[i];
            if (!d.DegiskenlerOkundu) { lblDegDurum.Metin = "Değerler okunmadı · DEĞERLERİ OKU"; lblDegDurum.Renk(Tema.Duraklatildi); }
            else DegiskenDurum();
        }
    }

    // =====================================================================
    //  5. KAYITLAR
    // =====================================================================
    public class KayitlarEkrani : Ekran
    {
        readonly KayitListesi liste;
        readonly SecimGrubu filtre;
        readonly Tablo teknik;
        readonly TextBox mdi;
        readonly TouchButton gonder;
        readonly Yazi mdiNot;
        bool sanalKlavye;

        public KayitlarEkrani()
        {
            var ana = new Izgara(2, 1).Sutunlar(-57, -43); ana.Bosluk = 12;
            Controls.Add(ana); ana.Dock = DockStyle.Fill;
            var lk = new Card("Mesaj geçmişi"); lk.BaslikSimge = Simge.Liste;
            ana.Ekle(lk, 0, 0);
            var li = new Izgara(1, 2).Satirlar(48, -100); li.Bosluk = 10;
            lk.Controls.Add(li); li.Dock = DockStyle.Fill;
            var ust = new Izgara(3, 1).Sutunlar(-100, 60, 60); ust.Bosluk = 8;
            li.Ekle(ust, 0, 0);
            filtre = ust.Ekle(new SecimGrubu(new[] { "Tümü", "Bilgi", "Uyarı", "Hata" }, new[] { "", "bilgi", "uyari", "hata" }, null, null), 0, 0);
            filtre.Secili = 0; filtre.Pt = 11.5f;
            filtre.SecimDegisti += delegate { FiltreUygula(); };
            liste = li.Ekle(new KayitListesi(), 0, 1);
            ust.Ekle(Dugme("", Simge.Yukari, Rol.Normal, null, null), 1, 0).Tiklandi += delegate { liste.Kaydir(-8); };
            ust.Ekle(Dugme("", Simge.Asagi, Rol.Normal, null, null), 2, 0).Tiklandi += delegate { liste.Kaydir(8); };

            var sag = new Izgara(1, 3).Satirlar(-100, 158, 112); sag.Bosluk = 12;
            ana.Ekle(sag, 1, 0);
            var tk = new Card("Teknik bilgi"); tk.BaslikSimge = Simge.Bilgi;
            sag.Ekle(tk, 0, 0);
            teknik = new Tablo(new[] { "", "" }, new[] { 42f, 58f }); teknik.SayiYazisi = false; teknik.Pt = 10.5f; teknik.SatirH = 29; teknik.BaslikYok = true;
            teknik.Hiza(StringAlignment.Near, StringAlignment.Near);
            tk.Controls.Add(teknik); teknik.Dock = DockStyle.Fill;

            var mk = new Card("MDI · tek satır G-kod"); mk.BaslikSimge = Simge.Terminal; mk.Vurgu = Color.Empty;
            sag.Ekle(mk, 0, 1);
            var mi = new Izgara(3, 2).Sutunlar(-100, 56, 120).Satirlar(52, -100); mi.Bosluk = 8;
            mk.Controls.Add(mi); mi.Dock = DockStyle.Fill;
            var kutu = new Panel(); kutu.Padding = new Padding(8, 0, 8, 0);
            mi.Ekle(kutu, 0, 0);
            mdi = new TextBox();
            mdi.BorderStyle = BorderStyle.None;
            mdi.Dock = DockStyle.None;
            mdi.CharacterCasing = CharacterCasing.Upper;
            kutu.Controls.Add(mdi);
            kutu.Resize += delegate { MdiYerlestir(kutu); };
            kutu.Paint += (s, e) =>
            {
                Tema.Hazirla(e.Graphics);
                var r = new RectangleF(0, 0, kutu.Width - 1, kutu.Height - 1);
                e.Graphics.Clear(kutu.Parent != null ? kutu.Parent.BackColor : Tema.Kart);
                Tema.YuvarlakDoldur(e.Graphics, r, Tema.PxF(8), Tema.Dugme);
                Tema.YuvarlakCiz(e.Graphics, r, Tema.PxF(8), mdi.Focused ? Tema.Marka : Tema.DugmeKenar, Math.Max(1, Tema.PxF(1)));
            };
            mdi.GotFocus += delegate { kutu.Invalidate(); };
            mdi.LostFocus += delegate { kutu.Invalidate(); };
            mdi.KeyDown += (s, e) => { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; e.Handled = true; Gonder(); } };
            mdi.MouseUp += delegate { if (sanalKlavye) Klavye(); };
            var kb = mi.Ekle(Dugme("", Simge.Klavye, Rol.Normal, null, null), 1, 0);
            kb.Tiklandi += delegate { Klavye(); };
            gonder = mi.Ekle(Dugme("GÖNDER", Simge.Sag, Rol.TehlikeCizgi, "mdi.gonder", ""), 2, 0);
            gonder.YalnizOlay = true;
            gonder.Tiklandi += delegate { Gonder(); };
            mdiNot = mi.Ekle(Paragraf("Gönderilmeden önce onay istenir. İş sürerken kilitlidir. Enter = gönder.", 10f, YaziRol.Soluk), 0, 1, 3, 1);

            var kk = new Card("Klasörler"); kk.BaslikSimge = Simge.Klasor;
            sag.Ekle(kk, 0, 2);
            var ki = new Izgara(4, 1); ki.Bosluk = 8;
            kk.Controls.Add(ki); ki.Dock = DockStyle.Fill;
            ki.Ekle(Dugme("İŞLER", Simge.Yok, Rol.Normal, "klasor.ac", "isler"), 0, 0).YaziPt = 10.5f;
            ki.Ekle(Dugme("LOGLAR", Simge.Yok, Rol.Normal, "klasor.ac", "loglar"), 1, 0).YaziPt = 10.5f;
            ki.Ekle(Dugme("YEDEKLER", Simge.Yok, Rol.Normal, "klasor.ac", "yedekler"), 2, 0).YaziPt = 10.5f;
            ki.Ekle(Dugme("EDING", Simge.Yok, Rol.Normal, "klasor.ac", "eding"), 3, 0).YaziPt = 10.5f;
            TemaYenile();
        }

        void MdiYerlestir(Panel kutu)
        {
            int h = mdi.PreferredHeight;
            mdi.SetBounds(Tema.Px(12), Math.Max(0, (kutu.Height - h) / 2), Math.Max(10, kutu.Width - Tema.Px(24)), h);
        }

        /// <summary>Tema değişince TextBox renklerini yeniler.</summary>
        public void TemaYenile()
        {
            mdi.BackColor = Tema.Dugme; mdi.ForeColor = Tema.Yazi;
            mdi.Font = Tema.Sayi(15f);
            if (mdi.Parent != null) { MdiYerlestir((Panel)mdi.Parent); mdi.Parent.Invalidate(); }
        }
        public override void Olcekle() { TemaYenile(); }
        /// <summary>İlerleme teması karesi: yalnız MDI kutusunun zemini (yazı tipi / yerleşim değişmez).</summary>
        public void YuzeyYenile() { if (mdi.BackColor != Tema.Dugme) mdi.BackColor = Tema.Dugme; }

        void Klavye()
        {
            string s = Diyalog.MetinGir("MDI satırı", mdi.Text, false, 0);
            if (s != null) { mdi.Text = s.ToUpper(Bicim.Inv); mdi.SelectionStart = mdi.Text.Length; }
        }

        void Gonder()
        {
            if (mdi.Text.Trim().Length == 0) return;
            if (!gonder.Izinli) { KomutYolu.NedenGoster(gonder.Neden); return; }
            string s = mdi.Text.Trim();
            mdi.Text = "";
            Komut("mdi.gonder", s);
        }

        void FiltreUygula()
        {
            switch (filtre.Secili)
            {
                case 1: liste.Filtre(MesajTuru.Bilgi, MesajTuru.Basari); break;
                case 2: liste.Filtre(MesajTuru.Uyari); break;
                case 3: liste.Filtre(MesajTuru.Hata); break;
                default: liste.Filtre(null); break;
            }
        }

        /// <summary>MDI kutusuna metin yaz (deneme/ekran görüntüsü için).</summary>
        public void MdiMetni(string s) { mdi.Text = s ?? ""; }

        public override void DurumUygula(MakineDurumu d)
        {
            liste.Ayarla(d.Kayitlar);
            var t = new List<TabloSatiri>();
            if (d.Teknik != null)
                foreach (var b in d.Teknik)
                {
                    var r = new TabloSatiri(b.Ad, b.Deger);
                    if (b.Tur != MesajTuru.Bilgi) { r.VurguSutun = 1; r.VurguRenk = Tema.TurRengi(b.Tur); }
                    t.Add(r);
                }
            teknik.Ayarla(t);
            sanalKlavye = d.Ayar("SanalKlavye", "0") == "1";
            string n;
            bool iz = Izinler.Izinli("mdi.gonder", null, out n);
            mdi.ReadOnly = !iz;
            mdiNot.Metin = iz ? "Gönderilmeden önce onay istenir. İş sürerken kilitlidir. Enter = gönder." : "Kilitli: " + (n ?? "şu an kullanılamaz");
            if (iz) mdiNot.RenkRol = YaziRol.Soluk; else mdiNot.Renk(Tema.Duraklatildi);
        }
    }

    // =====================================================================
    //  6. UZAKTAN
    // =====================================================================
    public class UzaktanEkrani : Ekran
    {
        readonly Yazi lblDurum, lblAdres, lblDiger, lblPin;
        readonly Anahtar acik;
        readonly SecimGrubu izin;
        readonly Yazi izinAciklama;
        readonly Tablo cihazlar;
        readonly Card durumKart;

        public UzaktanEkrani()
        {
            var ana = new Izgara(2, 1).Sutunlar(-56, -44); ana.Bosluk = 12;
            Controls.Add(ana); ana.Dock = DockStyle.Fill;
            var sol = new Izgara(1, 2).Satirlar(110, -100); sol.Bosluk = 12;
            ana.Ekle(sol, 0, 0);
            durumKart = new Card("Uzaktan erişim"); durumKart.BaslikSimge = Simge.Uzak;
            sol.Ekle(durumKart, 0, 0);
            var di = new Izgara(2, 1).Sutunlar(-100, 220);
            durumKart.Controls.Add(di); di.Dock = DockStyle.Fill;
            lblDurum = di.Ekle(Etiket("KAPALI", 22f, true, YaziRol.Soluk), 0, 0);
            acik = di.Ekle(new Anahtar(null) { Komut = "uzak.ac" }, 1, 0);
            acik.IzinYenile();
            var ak = new Card("Telefonda tarayıcıya yazın"); ak.BaslikSimge = Simge.Telefon;
            sol.Ekle(ak, 0, 1);
            var ai = new Izgara(1, 3).Satirlar(84, -100, 60); ai.Bosluk = 8;
            ak.Controls.Add(ai); ai.Dock = DockStyle.Fill;
            lblAdres = ai.Ekle(Etiket("—", 30f, true, YaziRol.Marka), 0, 0); lblAdres.SayiYazisi = true; lblAdres.Kucult = true;
            lblDiger = ai.Ekle(Paragraf("", 12f, YaziRol.Soluk), 0, 1); lblDiger.SayiYazisi = true;
            ai.Ekle(Paragraf("Yalnız aynı yerel ağdaki cihazlar bağlanabilir.  Sayfalar:  /  (çok cihazlı portal)  ·  /tek  (tek cihaz).", 10.5f, YaziRol.Soluk), 0, 2);

            var sag = new Izgara(1, 3).Satirlar(150, 170, -100); sag.Bosluk = 12;
            ana.Ekle(sag, 1, 0);
            var pk = new Card("PIN"); pk.BaslikSimge = Simge.Kilit;
            sag.Ekle(pk, 0, 0);
            var pi = new Izgara(2, 2).Sutunlar(-100, 200).Satirlar(-100, 26); pi.Bosluk = 8;
            pk.Controls.Add(pi); pi.Dock = DockStyle.Fill;
            lblPin = pi.Ekle(Etiket("—", 34f, true, YaziRol.Normal), 0, 0); lblPin.SayiYazisi = true; lblPin.Kucult = true;
            var pd = pi.Ekle(Dugme("PIN DEĞİŞTİR", Simge.Kilit, Rol.Normal, "uzak.pin", ""), 1, 0);
            pd.YaziPt = 11.5f; pd.YalnizOlay = true;
            pd.Tiklandi += delegate
            {
                string s = Diyalog.MetinGir("Yeni PIN (4–8 rakam, boş = PIN'siz)", "", true, 8);
                if (s != null) Komut("uzak.pin", s);
            };
            pi.Ekle(Etiket("Her istekte X-Pin başlığıyla sorulur.", 10f, false, YaziRol.Soluk), 0, 1, 2, 1);
            var ik = new Card("İzin düzeyi"); ik.BaslikSimge = Simge.Kilit;
            sag.Ekle(ik, 0, 1);
            var ii = new Izgara(1, 2).Satirlar(52, -100); ii.Bosluk = 8;
            ik.Controls.Add(ii); ii.Dock = DockStyle.Fill;
            izin = ii.Ekle(new SecimGrubu(new[] { "Yalnız izleme", "İzleme + iş seçme", "Tam" }, new[] { "izle", "sec", "tam" }, "uzak.izin", null), 0, 0);
            izin.Pt = 11f;
            izinAciklama = ii.Ekle(Paragraf("", 10.5f, YaziRol.Soluk), 0, 1);
            izin.SecimDegisti += delegate { IzinAciklamaYaz(); };
            var ck = new Card("Son bağlanan cihazlar"); ck.BaslikSimge = Simge.Telefon;
            sag.Ekle(ck, 0, 2);
            cihazlar = new Tablo(new[] { "Adres", "Saat", "Son istek" }, new[] { 47f, 15f, 38f }); cihazlar.Pt = 10f; cihazlar.SatirH = 34; cihazlar.SayiYazisi = false;
            cihazlar.Hiza(StringAlignment.Near, StringAlignment.Near, StringAlignment.Near);
            ck.Controls.Add(cihazlar); cihazlar.Dock = DockStyle.Fill;
        }

        void IzinAciklamaYaz()
        {
            switch (izin.Secili)
            {
                case 0: izinAciklama.Metin = "Telefon yalnız durumu, ilerlemeyi ve mesajları görür. Hiçbir komut gönderemez."; break;
                case 1: izinAciklama.Metin = "İzlemeye ek olarak iş dosyası yükleyip seçebilir. Başlatma makinede yapılır."; break;
                default: izinAciklama.Metin = "Başlat / duraklat / durdur da gönderilebilir (makinede onay ve blok kilidi geçerli)."; break;
            }
        }

        public override void DurumUygula(MakineDurumu d)
        {
            lblDurum.Metin = d.UzakAcik ? "AÇIK" : "KAPALI";
            if (d.UzakAcik) lblDurum.Renk(Tema.Hazir); else lblDurum.RenkRol = YaziRol.Soluk;
            if (!string.IsNullOrEmpty(d.UzakDurumMetni)) durumKart.SagMetin = d.UzakDurumMetni; else durumKart.SagMetin = "";
            acik.Acik = d.UzakAcik;
            lblAdres.Metin = d.UzakAcik && !string.IsNullOrEmpty(d.UzakAdres) ? d.UzakAdres : "—";
            var sb = new StringBuilder();
            if (d.UzakAdresler != null) foreach (var a in d.UzakAdresler) if (a != d.UzakAdres) sb.AppendLine(a);
            lblDiger.Metin = sb.Length > 0 ? "Diğer adresler:\n" + sb.ToString().TrimEnd() : "";
            lblPin.Metin = string.IsNullOrEmpty(d.UzakPin) ? "PIN yok" : d.UzakPin;
            izin.DegerSec(d.UzakIzin ?? "izle");
            IzinAciklamaYaz();
            var t = new List<TabloSatiri>();
            if (d.UzakCihazlar != null) foreach (var c in d.UzakCihazlar) t.Add(new TabloSatiri(c.Adres, c.Zaman, c.Son));
            cihazlar.Ayarla(t);
        }
    }

    // =====================================================================
    //  DİYALOGLAR
    // =====================================================================

    /// <summary>Diyalog başlık bandı.</summary>
    public class DiyalogBandi : TemelKontrol
    {
        public string Baslik = "";
        public Simge Simge = Simge.Bilgi;
        public Color Renk = Color.Empty;
        protected override void OnPaintBackground(PaintEventArgs e)
        {
            e.Graphics.Clear(Renk.IsEmpty ? Tema.Kart : Renk);
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            Color yazi = Renk.IsEmpty ? Tema.Yazi : Tema.UstYazi(Renk);
            float s = Math.Min(Tema.PxF(26), Height * 0.5f);
            float x = Tema.PxF(20);
            Ikon.Ciz(g, Simge, new RectangleF(x, (Height - s) / 2, s, s), Renk.IsEmpty ? Tema.Marka : yazi);
            x += s + Tema.PxF(12);
            var r = new RectangleF(x, 0, Width - x - Tema.PxF(16), Height);
            Tema.Yaz(g, Baslik, Tema.Sigdir(g, Baslik, false, true, 15f, 9f, new SizeF(r.Width, r.Height * 0.7f)), yazi, r);
            if (Renk.IsEmpty) using (var p = new Pen(Tema.KartKenar, Math.Max(1, Tema.PxF(1)))) g.DrawLine(p, 0, Height - 1, Width, Height - 1);
        }
    }

    /// <summary>Temalı, dokunmatik boyutlu diyalog penceresi. Diyalog sınıfı kurar.</summary>
    public class DiyalogFormu : Form
    {
        public int Sonuc = -1;
        /// <summary>Enter'a basınca dönecek sonuç; int.MinValue = Enter hiçbir şey yapmaz.</summary>
        public int EnterSonuc = int.MinValue;
        public readonly DiyalogBandi Bant = new DiyalogBandi();
        public readonly Panel Govde = new Panel();
        public readonly Izgara Dugmeler;
        public readonly Izgara Kok;
        public Color Kenar = Color.Empty;
        public float TabanGenislik = 620;
        public float GovdeYukseklik = 160;
        public float DugmeYukseklik = 72;
        public bool Buyuk;
        public Action<char> TusBasildi;
        public Action<Keys> OzelTus;
        readonly List<TouchButton> dugmeListesi = new List<TouchButton>();

        public DiyalogFormu(string baslik, Simge simge, Color bant, int dugmeSayisi)
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false; TopMost = true; KeyPreview = true;
            AutoScaleMode = AutoScaleMode.None;
            DoubleBuffered = true;
            BackColor = Tema.Kart;
            Text = baslik;
            Bant.Baslik = baslik; Bant.Simge = simge; Bant.Renk = bant;
            Kok = new Izgara(1, 4); Kok.Bosluk = 0;
            Controls.Add(Kok); Kok.Dock = DockStyle.Fill;
            Kok.Ekle(Bant, 0, 0);
            Govde.Padding = Padding.Empty;
            Kok.Ekle(Govde, 0, 1);
            Dugmeler = new Izgara(Math.Max(1, dugmeSayisi), 1); Dugmeler.Bosluk = 14;
            Kok.Ekle(Dugmeler, 0, 2);
            var alt = new Izgara(2, 1).Sutunlar(-100, 150); alt.Bosluk = 10;
            Kok.Ekle(alt, 0, 3);
            var ip = alt.Ekle(new Yazi("Esc = ACİL STOP", 9.5f, false, YaziRol.Soluk), 0, 0);
            var es = alt.Ekle(new EStopButton(), 1, 0); es.Kucuk = true;
            es.Basildi += delegate { Diyalog.AcilStopTetikle(); Sonuc = -1; Close(); };
        }

        public TouchButton DugmeEkle(int sutun, string metin, Rol rol, Simge s, int sonuc)
        {
            var b = new TouchButton(metin, s, rol, null, null);
            b.YaziPt = 14f;
            b.Tiklandi += delegate { Sonuc = sonuc; Close(); };
            Dugmeler.Ekle(b, sutun, 0);
            dugmeListesi.Add(b);
            return b;
        }

        public void Yerlestir()
        {
            Kok.Satirlar(60, -100, DugmeYukseklik <= 0 ? 0.0001f : DugmeYukseklik, 46);
            if (DugmeYukseklik <= 0) Kok.SatirGizle(2, true);
            int b = Tema.Px(22);
            Kok.Padding = Padding.Empty;
            Govde.Margin = new Padding(b, Tema.Px(16), b, Tema.Px(8));
            Dugmeler.Margin = new Padding(b, Tema.Px(4), b, Tema.Px(4));
            foreach (Control c in Kok.Controls) if (c is Izgara && c != Dugmeler) c.Margin = new Padding(b, 0, Tema.Px(12), Tema.Px(8));
            Rectangle alan = Screen.PrimaryScreen.WorkingArea;
            var sahip = Diyalog.Sahip;
            if (sahip != null && sahip.Visible && sahip.WindowState != FormWindowState.Minimized)
            {
                alan = sahip.RectangleToScreen(sahip.ClientRectangle);
                var kb = sahip as Kabuk;
                if (kb != null) { int u = kb.UstSeritYuksekligi; alan = new Rectangle(alan.X, alan.Y + u, alan.Width, alan.Height - u); }
            }
            int w = Math.Min(alan.Width - Tema.Px(24), Tema.Px(TabanGenislik));
            int h = Tema.Px(60) + Tema.Px(GovdeYukseklik) + Tema.Px(Math.Max(0, DugmeYukseklik)) + Tema.Px(46) + Tema.Px(32);
            if (DugmeYukseklik > 0) h += Tema.Px(8);
            h = Math.Min(h, alan.Height - Tema.Px(16));
            if (Buyuk) { w = Math.Min(alan.Width - Tema.Px(24), Math.Max(w, (int)(alan.Width * 0.78))); }
            Bounds = new Rectangle(alan.X + (alan.Width - w) / 2, alan.Y + (alan.Height - h) / 2, w, h);
            TemaGez(this);
        }

        static void TemaGez(Control k)
        {
            foreach (Control c in k.Controls)
            {
                if (c is Card) { c.BackColor = Tema.Kart; }
                else if (!(c is TextBox)) c.BackColor = Tema.Kart;
                TemaGez(c);
            }
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            e.Graphics.Clear(Tema.Kart);
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Color k = Kenar.IsEmpty ? Tema.Karistir(Tema.DugmeKenar, Tema.Soluk, 0.45f) : Kenar;
            using (var p = new Pen(k, Math.Max(2, Tema.PxF(2)))) e.Graphics.DrawRectangle(p, 1, 1, Width - 3, Height - 3);
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == Keys.Escape) { Diyalog.AcilStopTetikle(); Sonuc = -1; Close(); return true; }
            if (keyData == Keys.Enter || keyData == Keys.Return)
            {
                if (EnterSonuc != int.MinValue) { Sonuc = EnterSonuc; Close(); }
                return true;
            }
            if (OzelTus != null && (keyData == Keys.Back || keyData == Keys.Left || keyData == Keys.Right || keyData == Keys.Delete))
            { OzelTus(keyData); return true; }
            return base.ProcessCmdKey(ref msg, keyData);
        }
        protected override void OnKeyPress(KeyPressEventArgs e)
        {
            base.OnKeyPress(e);
            if (TusBasildi != null && !char.IsControl(e.KeyChar)) { TusBasildi(e.KeyChar); e.Handled = true; }
        }
        protected override void OnShown(EventArgs e) { base.OnShown(e); Activate(); }

        /// <summary>Önizleme modunda Show() ile açılınca dönen değer.</summary>
        public int OnizlemeSonucu = -1;
    }

    /// <summary>Sayı / metin girişi göstergesi (imleçli).</summary>
    public class GirisGostergesi : TemelKontrol
    {
        string metin = "";
        public int Imlec = -1;
        public bool Secili;
        public bool Hata;
        public bool Sayisal = true;
        public float Pt = 26f;
        /// <summary>true: yazı yerine her karakter için ● (PIN).</summary>
        public bool Gizli;
        public string Metin { get { return metin; } set { metin = value ?? ""; Invalidate(); } }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            string metin = Gizli ? new string('\u25CF', this.metin.Length) : this.metin;
            var r = new RectangleF(1, 1, Width - 3, Height - 3);
            Tema.YuvarlakDoldur(g, r, Tema.PxF(10), Tema.Zemin);
            Tema.YuvarlakCiz(g, r, Tema.PxF(10), Hata ? Tema.Alarm : Tema.Marka, Math.Max(1.5f, Tema.PxF(2)));
            var alan = new RectangleF(r.X + Tema.PxF(16), r.Y, r.Width - Tema.PxF(32), r.Height);
            Font f = Tema.Sigdir(g, metin.Length == 0 ? "0" : metin, true, true, Pt, 9f, new SizeF(alan.Width, alan.Height * 0.8f));
            var hiza = Sayisal ? StringAlignment.Far : StringAlignment.Near;
            if (Secili && metin.Length > 0)
            {
                var z = Tema.Olc(g, metin, f);
                float x = Sayisal ? alan.Right - z.Width : alan.X;
                Tema.YuvarlakDoldur(g, new RectangleF(x - Tema.PxF(4), alan.Y + (alan.Height - z.Height) / 2, z.Width + Tema.PxF(8), z.Height), Tema.PxF(4), Tema.Karistir(Tema.Zemin, Tema.Calisiyor, 0.45f));
            }
            Tema.Yaz(g, metin, f, Tema.Yazi, alan, hiza, StringAlignment.Center, true);
            // imleç
            if (!Secili)
            {
                int ic = Imlec < 0 || Imlec > metin.Length ? metin.Length : Imlec;
                string once = metin.Substring(0, ic);
                float tw = Tema.Olc(g, metin, f).Width, ow = Tema.Olc(g, once, f).Width;
                float x0 = Sayisal ? alan.Right - tw : alan.X;
                float cx = x0 + ow + Tema.PxF(1);
                float h = f.GetHeight(g);
                using (var p = new Pen(Tema.Marka, Math.Max(2, Tema.PxF(2)))) g.DrawLine(p, cx, alan.Y + (alan.Height - h) / 2, cx, alan.Y + (alan.Height + h) / 2);
            }
        }
    }

    /// <summary>Dokunmatik seçim listesi (dosya seçici vb.).</summary>
    public class SecimListesi : TemelKontrol
    {
        string[] oge = new string[0], aciklama = new string[0];
        int ust, surY = -1, surUst, basilan = -1;
        bool surukledi;
        public event Action<int> Secildi;
        public SecimListesi(string[] ogeler, string[] aciklamalar) { oge = ogeler ?? new string[0]; aciklama = aciklamalar ?? new string[0]; Cursor = Cursors.Hand; }
        float SH { get { return Tema.PxF(aciklama.Length > 0 ? 62 : 52); } }
        int Sigan { get { return Math.Max(1, (int)(Height / SH)); } }
        public void Kaydir(int n) { ust = Math.Max(0, Math.Min(Math.Max(0, oge.Length - Sigan), ust + n)); Invalidate(); }
        protected override void OnMouseWheel(MouseEventArgs e) { base.OnMouseWheel(e); Kaydir(-e.Delta / 60); }
        protected override void OnMouseDown(MouseEventArgs e) { base.OnMouseDown(e); surY = e.Y; surUst = ust; surukledi = false; basilan = ust + (int)(e.Y / SH); Invalidate(); }
        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            if (surY < 0) return;
            int d = (int)((surY - e.Y) / SH);
            if (Math.Abs(surY - e.Y) > Tema.Px(12)) { surukledi = true; basilan = -1; }
            if (d != 0) { ust = Math.Max(0, Math.Min(Math.Max(0, oge.Length - Sigan), surUst + d)); Invalidate(); }
        }
        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            int i = ust + (int)(e.Y / SH);
            bool tik = !surukledi && i == basilan && i >= 0 && i < oge.Length;
            surY = -1; basilan = -1; Invalidate();
            if (tik) { var h = Secildi; if (h != null) h(i); }
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            float sh = SH;
            for (int k = 0; k <= Sigan; k++)
            {
                int i = ust + k; if (i >= oge.Length) break;
                var r = new RectangleF(0, k * sh + Tema.PxF(3), Width - Tema.PxF(12), sh - Tema.PxF(6));
                Tema.YuvarlakDoldur(g, r, Tema.PxF(8), i == basilan ? Tema.Basili(Tema.Dugme) : Tema.Dugme);
                Tema.YuvarlakCiz(g, r, Tema.PxF(8), Tema.DugmeKenar, Math.Max(1, Tema.PxF(1)));
                Ikon.Ciz(g, Simge.Klasor == Simge.Klasor ? Simge.Liste : Simge.Liste, new RectangleF(r.X + Tema.PxF(14), r.Y + (r.Height - Tema.PxF(20)) / 2, Tema.PxF(20), Tema.PxF(20)), Tema.Soluk);
                float x = r.X + Tema.PxF(46);
                bool ac = i < aciklama.Length && !string.IsNullOrEmpty(aciklama[i]);
                Tema.Yaz(g, oge[i], Tema.F(13f, true), Tema.Yazi, new RectangleF(x, r.Y + (ac ? Tema.PxF(4) : 0), r.Width - x - Tema.PxF(10), ac ? r.Height * 0.55f : r.Height));
                if (ac) Tema.Yaz(g, aciklama[i], Tema.F(10f), Tema.Soluk, new RectangleF(x, r.Y + r.Height * 0.52f, r.Width - x - Tema.PxF(10), r.Height * 0.42f));
            }
            if (oge.Length > Sigan)
            {
                float h = Math.Max(Tema.PxF(24), Height * Sigan / (float)oge.Length);
                float y = (Height - h) * ust / (float)Math.Max(1, oge.Length - Sigan);
                Tema.YuvarlakDoldur(g, new RectangleF(Width - Tema.PxF(6), y, Tema.PxF(4), h), Tema.PxF(2), Tema.DugmeKenar);
            }
            if (oge.Length == 0) Tema.Yaz(g, "Liste boş", Tema.F(12f), Tema.Soluk, new RectangleF(0, 0, Width, sh), StringAlignment.Center, StringAlignment.Center, true);
        }
    }

    /// <summary>
    /// Temalı, dokunmatik diyaloglar. Sahip = Kabuk. Her diyalogda küçük ACİL STOP; Esc = ACİL STOP
    /// (Diyalog.AcilStop çağrılır, diyalog "vazgeç" sonucuyla kapanır).
    /// </summary>
    public static class Diyalog
    {
        /// <summary>ACİL STOP eylemi (Kabuk varsayılan olarak "acilstop" komutunu bağlar; denetleyici doğrudan Acil-Stop bağlayabilir).</summary>
        public static Action AcilStop;
        /// <summary>Açık diyalog sayısı (denetleyici modal pencere açık mı diye bakar).</summary>
        public static int AcikSayisi;
        /// <summary>Sahip pencere (Kabuk kendini atar).</summary>
        public static Form Sahip;
        /// <summary>Geliştirme: true ise diyaloglar Show() ile modelsiz açılır ve hemen varsayılan sonucu döner (ekran görüntüsü için).</summary>
        public static bool OnizlemeModu;
        /// <summary>Önizleme modunda son açılan diyalog.</summary>
        public static DiyalogFormu SonForm;
        static readonly List<DiyalogFormu> acik = new List<DiyalogFormu>();

        public static void AcilStopTetikle()
        {
            var a = AcilStop;
            if (a != null) { try { a(); } catch { } }
        }

        /// <summary>Önizleme modunda açılmış tüm diyalogları kapatır.</summary>
        public static void HepsiniKapat()
        {
            foreach (var f in acik.ToArray()) { try { f.Close(); } catch { } }
        }

        /// <summary>Diyalog açıkken Kabuk'un ACİL STOP düğmesinin tam üstüne, diyaloğa ait canlı bir ACİL STOP koyar
        /// (modal pencere sahibi devre dışı bırakır; böylece ACİL STOP hep aynı yerde çalışır).</summary>
        static void AcilStopKatmani(DiyalogFormu f)
        {
            var kb = Sahip as Kabuk;
            if (kb == null || !kb.Visible) return;
            Rectangle r = kb.AcilStopEkranda;
            if (r.Width <= 0) return;
            var k = new Form();
            k.FormBorderStyle = FormBorderStyle.None; k.ShowInTaskbar = false; k.TopMost = true;
            k.StartPosition = FormStartPosition.Manual; k.Bounds = r; k.BackColor = Tema.Kart;
            k.AutoScaleMode = AutoScaleMode.None;
            var e = new EStopButton(); e.Dock = DockStyle.Fill; e.Aktif = kb.SonDurum != null && kb.SonDurum.AcilStop;
            e.Basildi += delegate { AcilStopTetikle(); f.Sonuc = -1; f.Close(); };
            k.Controls.Add(e);
            f.Shown += delegate { try { k.Show(f); k.Bounds = r; } catch { } };
            f.FormClosed += delegate { try { k.Close(); k.Dispose(); } catch { } };
        }

        static int Goster(DiyalogFormu f)
        {
            f.Yerlestir();
            AcilStopKatmani(f);
            AcikSayisi++;
            acik.Add(f);
            if (OnizlemeModu)
            {
                f.FormClosed += delegate { AcikSayisi--; acik.Remove(f); };
                SonForm = f;
                if (Sahip != null && Sahip.Visible) f.Show(Sahip); else f.Show();
                return f.OnizlemeSonucu;
            }
            try
            {
                if (Sahip != null && Sahip.Visible) f.ShowDialog(Sahip); else f.ShowDialog();
            }
            finally { AcikSayisi--; acik.Remove(f); }
            int r = f.Sonuc;
            f.Dispose();
            return r;
        }

        static float MetinYuksekligi(string metin, float pt, float genislikTaban)
        {
            if (string.IsNullOrEmpty(metin)) return 0;
            using (var bmp = new Bitmap(4, 4))
            using (var g = Graphics.FromImage(bmp))
            {
                var z = g.MeasureString(metin, Tema.F(pt), Tema.Px(genislikTaban));
                return z.Height / (Tema.S * Tema.Dpi) + 6;
            }
        }

        static Yazi Paragraf(string m, float pt)
        {
            var y = new Yazi(m, pt, false, YaziRol.Normal); y.Sar = true; y.Dikey = StringAlignment.Near; return y;
        }

        // ------------------------------------------------------------------ Onay
        /// <summary>Normal onay. Varsayılan (Enter) = VAZGEÇ.</summary>
        public static bool Onay(string baslik, string metin) { return Onay(baslik, metin, "EVET"); }
        public static bool Onay(string baslik, string metin, string evetMetni)
        {
            var f = new DiyalogFormu(baslik, Simge.Bilgi, Color.Empty, 2);
            f.GovdeYukseklik = Math.Max(70, Math.Min(360, MetinYuksekligi(metin, 13f, 570)));
            var p = Paragraf(metin, 13f); f.Govde.Controls.Add(p); p.Dock = DockStyle.Fill;
            f.DugmeEkle(0, "VAZGEÇ", Rol.Normal, Simge.Kapat, 0);
            f.DugmeEkle(1, string.IsNullOrEmpty(evetMetni) ? "EVET" : evetMetni, Rol.Vurgu, Simge.Tamam, 1);
            f.EnterSonuc = 0;
            return Goster(f) == 1;
        }

        // ------------------------------------------------------------------ Tehlikeli onay
        /// <summary>
        /// Tehlikeli işlem onayı: kırmızı bant, eski → yeni değer tablosu, yedek dosyası, "EVET, UYGULA".
        /// Varsayılan VAZGEÇ; Enter onaylamaz. Diziler "Ad=değer" ya da yalnız değer olabilir.
        /// </summary>
        public static bool TehlikeliOnay(string baslik, string metin, string[] eskiDegerler, string[] yeniDegerler, string yedekDosyasi)
        {
            var f = new DiyalogFormu("TEHLİKELİ İŞLEM — " + Bicim.BuyukHarf(baslik ?? ""), Simge.Uyari, Tema.Alarm, 2);
            f.Kenar = Tema.Alarm; f.TabanGenislik = 700;
            int n = Math.Max(eskiDegerler == null ? 0 : eskiDegerler.Length, yeniDegerler == null ? 0 : yeniDegerler.Length);
            float mh = MetinYuksekligi(metin, 12.5f, 650);
            float th = n > 0 ? 32 + 34 * n + 6 : 0;
            f.GovdeYukseklik = Math.Min(470, mh + th + 40);
            var y = new Yigin(); y.Bosluk = 8;
            f.Govde.Controls.Add(y); y.Dock = DockStyle.Fill;
            y.Ekle(Paragraf(metin ?? "", 12.5f), Math.Min(200, mh));
            if (n > 0)
            {
                var t = new Tablo(new[] { "Değer", "Eski", "Yeni" }, new[] { 30f, 35f, 35f });
                t.SatirH = 34; t.Pt = 12.5f;
                var satir = new List<TabloSatiri>();
                for (int i = 0; i < n; i++)
                {
                    string e = eskiDegerler != null && i < eskiDegerler.Length ? eskiDegerler[i] : "";
                    string w = yeniDegerler != null && i < yeniDegerler.Length ? yeniDegerler[i] : "";
                    string ad = "", ed = e ?? "", wd = w ?? "";
                    int k = ed.IndexOf('='); if (k > 0) { ad = ed.Substring(0, k).Trim(); ed = ed.Substring(k + 1).Trim(); }
                    k = wd.IndexOf('='); if (k > 0) { if (ad.Length == 0) ad = wd.Substring(0, k).Trim(); wd = wd.Substring(k + 1).Trim(); }
                    if (ad.Length == 0) ad = (i + 1).ToString(Bicim.Inv);
                    var s = new TabloSatiri(ad, ed, wd);
                    if (ed != wd) { s.VurguSutun = 2; s.VurguRenk = Tema.Duraklatildi; s.Kalin = true; }
                    satir.Add(s);
                }
                t.Ayarla(satir);
                y.Ekle(t, Math.Min(300, th));
            }
            // yedekDosyasi: null = bu işlemde yedek gerekmez (yalnız hareket): satır yok; "" = gerekirdi ama alınmadı (kehribar)
            if (yedekDosyasi != null)
            {
                var yd = new Yazi(yedekDosyasi.Length == 0 ? "Yedek: alınmadı" : "Yedek alındı:  " + yedekDosyasi, 11.5f, true, YaziRol.Ozel);
                yd.OzelRenk = yedekDosyasi.Length == 0 ? Tema.Duraklatildi : Tema.Hazir; yd.Simge = Simge.Kaydet; yd.Kucult = true;
                y.Ekle(yd, 28);
            }
            f.DugmeEkle(0, "VAZGEÇ", Rol.Normal, Simge.Kapat, 0);
            f.DugmeEkle(1, "EVET, UYGULA", Rol.Tehlike, Simge.Uyari, 1);
            f.EnterSonuc = int.MinValue;
            f.OnizlemeSonucu = 0;
            return Goster(f) == 1;
        }
        /// <summary>Değer tablosu olmadan tehlikeli onay.</summary>
        public static bool TehlikeliOnay(string baslik, string metin) { return TehlikeliOnay(baslik, metin, null, null, null); }

        // ------------------------------------------------------------------ Bilgi / Hata
        public static void Bilgi(string baslik, string metin)
        {
            var f = new DiyalogFormu(baslik, Simge.Bilgi, Color.Empty, 1);
            f.GovdeYukseklik = Math.Max(60, Math.Min(420, MetinYuksekligi(metin, 12.5f, 570)));
            var p = Paragraf(metin, 12.5f); f.Govde.Controls.Add(p); p.Dock = DockStyle.Fill;
            var d = new Izgara(3, 1).Sutunlar(-30, -40, -30); d.Bosluk = 0;
            f.DugmeEkle(0, "TAMAM", Rol.Vurgu, Simge.Tamam, 0);
            f.EnterSonuc = 0;
            Goster(f);
        }

        /// <summary>Hata: "ne oldu" + "ne yapmalı".</summary>
        public static void Hata(string neOldu, string neYapmali) { Hata("Hata", neOldu, neYapmali); }
        public static void Hata(string baslik, string neOldu, string neYapmali)
        {
            var f = new DiyalogFormu(baslik, Simge.Uyari, Tema.Alarm, 1);
            f.Kenar = Tema.Alarm;
            float h1 = MetinYuksekligi(neOldu, 13f, 570), h2 = MetinYuksekligi(neYapmali, 12.5f, 570);
            f.GovdeYukseklik = Math.Min(440, 26 + h1 + 14 + 26 + h2);
            var y = new Yigin(); y.Bosluk = 4;
            f.Govde.Controls.Add(y); y.Dock = DockStyle.Fill;
            y.Ekle(new Yazi("NE OLDU", 9.5f, true, YaziRol.Soluk), 22);
            var a = Paragraf(neOldu ?? "", 13f); a.Kalin = true; y.Ekle(a, h1);
            y.Ekle(new Yazi("", 6f), 8);
            y.Ekle(new Yazi("NE YAPMALI", 9.5f, true, YaziRol.Soluk), 22);
            y.Ekle(Paragraf(neYapmali ?? "", 12.5f), h2);
            f.DugmeEkle(0, "TAMAM", Rol.Normal, Simge.Tamam, 0);
            f.EnterSonuc = 0;
            Goster(f);
        }

        // ------------------------------------------------------------------ Seçim
        /// <summary>Seçeneklerden biri; -1 = vazgeç / Esc. Seçeneklerde "Vazgeç" yoksa ayrıca VAZGEÇ eklenir.</summary>
        public static int Secim(string baslik, string metin, string[] secenekler)
        {
            secenekler = secenekler ?? new string[0];
            bool vazgecVar = secenekler.Any(s => s != null && Bicim.BuyukHarf(s).StartsWith("VAZGEÇ"));
            var f = new DiyalogFormu(baslik, Simge.Liste, Color.Empty, 1);
            float mh = MetinYuksekligi(metin, 12.5f, 570);
            int sutun = secenekler.Length > 4 ? 2 : 1;
            int satir = (secenekler.Length + sutun - 1) / sutun;
            f.GovdeYukseklik = Math.Min(520, mh + satir * 66 + 8);
            f.DugmeYukseklik = vazgecVar ? 0 : 64;
            var y = new Yigin(); y.Bosluk = 8;
            f.Govde.Controls.Add(y); y.Dock = DockStyle.Fill;
            if (mh > 0) y.Ekle(Paragraf(metin, 12.5f), mh);
            var iz = new Izgara(sutun, Math.Max(1, satir)); iz.Bosluk = 10;
            y.Ekle(iz, 0);
            for (int i = 0; i < secenekler.Length; i++)
            {
                int k = i;
                var b = new TouchButton(secenekler[i], Simge.Yok, i == 0 ? Rol.Vurgu : Rol.Normal, null, null);
                b.YaziPt = 13.5f;
                if (Bicim.BuyukHarf(secenekler[i] ?? "").StartsWith("VAZGEÇ")) { b.Rol = Rol.Normal; k = -1; }
                b.Tiklandi += delegate { f.Sonuc = k; f.Close(); };
                iz.Ekle(b, i % sutun, i / sutun);
            }
            if (!vazgecVar) f.DugmeEkle(0, "VAZGEÇ", Rol.Normal, Simge.Kapat, -1);
            return Goster(f);
        }

        /// <summary>Dokunmatik liste seçici (ör. iş dosyası). -1 vazgeç, -2 ek düğme (ör. "Gözat…").</summary>
        public static int ListeSec(string baslik, string[] ogeler, string[] aciklamalar, string ekDugme)
        {
            var f = new DiyalogFormu(baslik, Simge.Klasor, Color.Empty, string.IsNullOrEmpty(ekDugme) ? 1 : 2);
            f.TabanGenislik = 720; f.GovdeYukseklik = 420;
            var l = new SecimListesi(ogeler, aciklamalar);
            var iz = new Izgara(2, 1).Sutunlar(-100, 64); iz.Bosluk = 10;
            f.Govde.Controls.Add(iz); iz.Dock = DockStyle.Fill;
            iz.Ekle(l, 0, 0);
            var ok = new Izgara(1, 2); ok.Bosluk = 10;
            iz.Ekle(ok, 1, 0);
            ok.Ekle(new TouchButton("", Simge.Yukari, Rol.Normal, null, null), 0, 0).Tiklandi += delegate { l.Kaydir(-4); };
            ok.Ekle(new TouchButton("", Simge.Asagi, Rol.Normal, null, null), 0, 1).Tiklandi += delegate { l.Kaydir(4); };
            l.Secildi += i => { f.Sonuc = i; f.Close(); };
            f.DugmeEkle(0, "VAZGEÇ", Rol.Normal, Simge.Kapat, -1);
            if (!string.IsNullOrEmpty(ekDugme)) f.DugmeEkle(1, ekDugme, Rol.Normal, Simge.Klasor, -2);
            return Goster(f);
        }

        /// <summary>Takım seçici: 0 = iş milini boşalt, 1–6 = takım. -1 vazgeç.</summary>
        public static int TakimSec(int mevcut, string[] aciklamalar)
        {
            var f = new DiyalogFormu("Takım değiştir", Simge.Takim, Color.Empty, 1);
            f.TabanGenislik = 760; f.GovdeYukseklik = 300;
            var iz = new Izgara(4, 2); iz.Bosluk = 12;
            f.Govde.Controls.Add(iz); iz.Dock = DockStyle.Fill;
            for (int i = 0; i <= 6; i++)
            {
                int n = i == 6 ? 0 : i + 1;
                var b = new TouchButton(n == 0 ? "BOŞALT (T0)" : "T" + n, n == 0 ? Simge.Asagi : Simge.Yok, n == 0 ? Rol.TehlikeCizgi : Rol.Normal, null, null);
                b.YaziPt = n == 0 ? 13f : 24f; b.Dikey = true;
                string a = aciklamalar != null && n < aciklamalar.Length ? aciklamalar[n] : "";
                b.AltMetin = n == mevcut ? "iş milinde" : a;
                b.Secili = n == mevcut;
                b.Tiklandi += delegate { f.Sonuc = n; f.Close(); };
                iz.Ekle(b, i % 4, i / 4);
            }
            var not = new Yazi("Onaydan sonra M6 ile değiştirilir.", 10f, false, YaziRol.Soluk); not.Sar = true;
            iz.Ekle(not, 3, 1);
            f.DugmeEkle(0, "VAZGEÇ", Rol.Normal, Simge.Kapat, -1);
            return Goster(f);
        }

        // ------------------------------------------------------------------ Sayı girişi
        /// <summary>Dokunmatik tuş takımıyla sayı. Virgül ve nokta kabul edilir, InvariantCulture ile ayrıştırılır. null = vazgeç.</summary>
        public static double? SayiGir(string baslik, double mevcut, double min, double max) { return SayiGir(baslik, mevcut, min, max, 3); }
        public static double? SayiGir(string baslik, double mevcut, double min, double max, int ondalik)
        {
            var f = new DiyalogFormu(baslik, Simge.Klavye, Color.Empty, 2);
            f.TabanGenislik = 480; f.GovdeYukseklik = 430;
            var gos = new GirisGostergesi();
            string metin = Bicim.Sayi(mevcut, Math.Max(0, ondalik));
            bool ilk = true;
            gos.Metin = metin; gos.Secili = true;
            var bilgi = new Yazi("Aralık: " + Bicim.Sayi(min, ondalik) + "  …  " + Bicim.Sayi(max, ondalik), 10.5f, false, YaziRol.Soluk);
            var iz = new Izgara(4, 6).Satirlar(70, 28, -25, -25, -25, -25); iz.Bosluk = 10;
            f.Govde.Controls.Add(iz); iz.Dock = DockStyle.Fill;
            iz.Ekle(gos, 0, 0, 4, 1);
            iz.Ekle(bilgi, 0, 1, 4, 1);
            TouchButton tamam = null;
            Action yenile = () =>
            {
                double v; bool ok = Bicim.Ayristir(metin, out v) && v >= min - 1e-9 && v <= max + 1e-9;
                gos.Metin = metin; gos.Secili = ilk; gos.Hata = !ok && metin.Length > 0;
                bilgi.Metin = ok || metin.Length == 0 ? "Aralık: " + Bicim.Sayi(min, ondalik) + "  …  " + Bicim.Sayi(max, ondalik)
                                                    : (Bicim.Ayristir(metin, out v) ? "Aralık dışında: " + Bicim.Sayi(min, ondalik) + " … " + Bicim.Sayi(max, ondalik) : "Geçersiz sayı");
                if (ok || metin.Length == 0) bilgi.RenkRol = YaziRol.Soluk; else bilgi.Renk(Tema.Alarm);
                if (tamam != null) tamam.Etkin = ok;
            };
            Action<char> tus = c =>
            {
                if (c == ',') c = '.';
                if (ilk && (char.IsDigit(c) || c == '.')) { metin = ""; }
                ilk = false;
                if (c == '-') { metin = metin.StartsWith("-") ? metin.Substring(1) : "-" + metin; }
                else if (c == '.') { if (ondalik > 0 && !metin.Contains(".")) metin += metin.Length == 0 || metin == "-" ? "0." : "."; }
                else if (char.IsDigit(c))
                {
                    int nokta = metin.IndexOf('.');
                    if (nokta >= 0 && metin.Length - nokta - 1 >= ondalik) return;
                    if (metin == "0") metin = "";
                    if (metin == "-0") metin = "-";
                    metin += c;
                }
                yenile();
            };
            string[,] tuslar = { { "7", "8", "9", "⌫" }, { "4", "5", "6", "C" }, { "1", "2", "3", "±" }, { "0", "", ".", "" } };
            for (int r = 0; r < 4; r++)
                for (int c = 0; c < 4; c++)
                {
                    string t = tuslar[r, c];
                    if (t.Length == 0) continue;
                    var b = new TouchButton(t, Simge.Yok, Rol.Normal, null, null);
                    b.YaziPt = t.Length == 1 && char.IsDigit(t[0]) ? 20f : 16f;
                    if (t == "⌫") { b.Metin = ""; b.Simge = Simge.Sol; }
                    string tt = t;
                    b.Tiklandi += delegate
                    {
                        if (tt == "⌫") { ilk = false; if (metin.Length > 0) metin = metin.Substring(0, metin.Length - 1); yenile(); }
                        else if (tt == "C") { ilk = false; metin = ""; yenile(); }
                        else if (tt == "±") tus('-');
                        else tus(tt[0]);
                    };
                    if (r == 3 && c == 0) iz.Ekle(b, 0, 2 + r, 2, 1);
                    else if (r == 3 && c == 2) iz.Ekle(b, 2, 2 + r, 2, 1);
                    else iz.Ekle(b, c, 2 + r);
                    if (ondalik <= 0 && t == ".") b.Etkin = false;
                    if (min >= 0 && t == "±") b.Etkin = false;
                }
            f.TusBasildi = c => { if (char.IsDigit(c) || c == ',' || c == '.' || c == '-') tus(c); };
            f.OzelTus = k => { if (k == Keys.Back) { ilk = false; if (metin.Length > 0) metin = metin.Substring(0, metin.Length - 1); yenile(); } };
            f.DugmeEkle(0, "VAZGEÇ", Rol.Normal, Simge.Kapat, -1);
            tamam = f.DugmeEkle(1, "TAMAM", Rol.Vurgu, Simge.Tamam, 1);
            f.EnterSonuc = int.MinValue;
            f.KeyDown += (s, e) => { if (e.KeyCode == Keys.Enter && tamam.Izinli) { f.Sonuc = 1; f.Close(); } };
            f.OzelTus = k => { if (k == Keys.Back) { ilk = false; if (metin.Length > 0) metin = metin.Substring(0, metin.Length - 1); yenile(); } };
            yenile();
            int sonuc = Goster(f);
            if (sonuc != 1) return null;
            double deger;
            if (!Bicim.Ayristir(metin, out deger)) return null;
            if (deger < min || deger > max) return null;
            return Math.Round(deger, Math.Max(0, Math.Min(15, ondalik)));
        }

        // ------------------------------------------------------------------ Metin girişi (ekran klavyesi)
        /// <summary>Ekran klavyesiyle metin. sadeceRakam: yalnız 0–9. enCok: 0 = sınırsız. null = vazgeç.</summary>
        public static string MetinGir(string baslik, string mevcut) { return MetinGir(baslik, mevcut, false, 0); }
        public static string MetinGir(string baslik, string mevcut, bool sadeceRakam, int enCok) { return MetinGir(baslik, mevcut, sadeceRakam, enCok, false); }
        /// <summary>PIN girişi: rakam tuş takımı, yazılan rakamlar ● olarak görünür. null = vazgeç.</summary>
        public static string PinGir(string baslik, int enCok) { return MetinGir(baslik, "", true, enCok, true); }
        public static string MetinGir(string baslik, string mevcut, bool sadeceRakam, int enCok, bool gizli)
        {
            var f = new DiyalogFormu(baslik, Simge.Klavye, Color.Empty, 2);
            string metin = mevcut ?? "";
            int imlec = metin.Length;
            bool buyuk = true;
            var gos = new GirisGostergesi(); gos.Sayisal = false; gos.Pt = 20f; gos.Gizli = gizli; gos.Metin = metin; gos.Imlec = imlec;
            var tuslar = new List<TouchButton>();
            Action yenile = () => { gos.Metin = metin; gos.Imlec = imlec; };
            Action<string> ekle = s =>
            {
                if (enCok > 0 && metin.Length + s.Length > enCok) return;
                metin = metin.Insert(imlec, s); imlec += s.Length; yenile();
            };
            Action sil = () => { if (imlec > 0) { metin = metin.Remove(imlec - 1, 1); imlec--; yenile(); } };
            Izgara iz;
            if (sadeceRakam)
            {
                f.TabanGenislik = 460; f.GovdeYukseklik = 400;
                iz = new Izgara(3, 5).Satirlar(70, -25, -25, -25, -25); iz.Bosluk = 10;
                iz.Ekle(gos, 0, 0, 3, 1);
                string[] r = { "7", "8", "9", "4", "5", "6", "1", "2", "3", "C", "0", "⌫" };
                for (int i = 0; i < r.Length; i++)
                {
                    string t = r[i];
                    var b = new TouchButton(t == "⌫" ? "" : t, t == "⌫" ? Simge.Sol : Simge.Yok, Rol.Normal, null, null); b.YaziPt = 20f;
                    b.Tiklandi += delegate { if (t == "⌫") sil(); else if (t == "C") { metin = ""; imlec = 0; yenile(); } else ekle(t); };
                    iz.Ekle(b, i % 3, 1 + i / 3);
                }
            }
            else
            {
                f.TabanGenislik = 900; f.GovdeYukseklik = 420;
                string[] satirlar = { "1234567890", "QWERTYUIOPĞÜ", "ASDFGHJKLŞİ", "ZXCVBNMÖÇ.", "-#=[]/*+_:" };
                iz = new Izgara(1, 7).Satirlar(64, -17, -17, -17, -17, -17, -17); iz.Bosluk = 8;
                iz.Ekle(gos, 0, 0);
                for (int s = 0; s < satirlar.Length; s++)
                {
                    string sat = satirlar[s];
                    int ek = s == 0 ? 1 : (s == 3 ? 1 : 0);
                    var row = new Izgara(12, 1); row.Bosluk = 6;
                    iz.Ekle(row, 0, 1 + s);
                    int bas = (12 - sat.Length - ek) / 2;
                    if (s == 3)
                    {
                        var sh = new TouchButton("⇧", Simge.Yukari, Rol.Normal, null, null); sh.Metin = ""; sh.Secili = true;
                        sh.Tiklandi += delegate
                        {
                            buyuk = !buyuk; sh.Secili = buyuk;
                            foreach (var t in tuslar) t.Metin = buyuk ? t.Metin.ToUpper(Bicim.Tr) : t.Metin.ToLower(Bicim.Tr);
                        };
                        row.Ekle(sh, 0, 0); bas = 1;
                    }
                    for (int i = 0; i < sat.Length; i++)
                    {
                        string t = sat[i].ToString();
                        var b = new TouchButton(t, Simge.Yok, Rol.Normal, null, null); b.YaziPt = 15f;
                        b.Tiklandi += delegate { ekle(b.Metin); };
                        if (char.IsLetter(t[0])) tuslar.Add(b);
                        row.Ekle(b, bas + i, 0);
                    }
                    if (s == 0)
                    {
                        var bs = new TouchButton("", Simge.Sol, Rol.Normal, null, null);
                        bs.Tiklandi += delegate { sil(); };
                        row.Ekle(bs, 11, 0);
                    }
                }
                var alt = new Izgara(5, 1).Sutunlar(-14, -14, -44, -14, -14); alt.Bosluk = 6;
                iz.Ekle(alt, 0, 6);
                var sol = new TouchButton("◀", Simge.Sol, Rol.Normal, null, null); sol.Metin = "";
                sol.Tiklandi += delegate { if (imlec > 0) { imlec--; yenile(); } };
                var sag = new TouchButton("", Simge.Sag, Rol.Normal, null, null);
                sag.Tiklandi += delegate { if (imlec < metin.Length) { imlec++; yenile(); } };
                var bosluk = new TouchButton("BOŞLUK", Simge.Yok, Rol.Normal, null, null); bosluk.YaziPt = 12f;
                bosluk.Tiklandi += delegate { ekle(" "); };
                var tem = new TouchButton("TEMİZLE", Simge.Yok, Rol.Normal, null, null); tem.YaziPt = 11f;
                tem.Tiklandi += delegate { metin = ""; imlec = 0; yenile(); };
                var nok = new TouchButton(",", Simge.Yok, Rol.Normal, null, null); nok.YaziPt = 15f;
                nok.Tiklandi += delegate { ekle(","); };
                alt.Ekle(sol, 0, 0); alt.Ekle(sag, 1, 0); alt.Ekle(bosluk, 2, 0); alt.Ekle(nok, 3, 0); alt.Ekle(tem, 4, 0);
            }
            f.Govde.Controls.Add(iz); iz.Dock = DockStyle.Fill;
            f.TusBasildi = c => { if (!sadeceRakam || char.IsDigit(c)) ekle(c.ToString()); };
            f.OzelTus = k =>
            {
                if (k == Keys.Back) sil();
                else if (k == Keys.Left && imlec > 0) { imlec--; yenile(); }
                else if (k == Keys.Right && imlec < metin.Length) { imlec++; yenile(); }
                else if (k == Keys.Delete && imlec < metin.Length) { metin = metin.Remove(imlec, 1); yenile(); }
            };
            f.DugmeEkle(0, "VAZGEÇ", Rol.Normal, Simge.Kapat, -1);
            f.DugmeEkle(1, "TAMAM", Rol.Vurgu, Simge.Tamam, 1);
            f.EnterSonuc = 1;
            int sonuc = Goster(f);
            return sonuc == 1 ? metin : null;
        }

        // ------------------------------------------------------------------ Geri sayım
        /// <summary>Geri sayım (ör. home öncesi). İPTAL → false, ŞİMDİ BAŞLA → true. Süre bitince: sureBitinceOnay (varsayılan false = iptal).</summary>
        public static bool GeriSayim(string metin, int saniye) { return GeriSayim(metin, saniye, false); }
        public static bool GeriSayim(string metin, int saniye, bool sureBitinceOnay)
        {
            var f = new DiyalogFormu("Geri sayım", Simge.Saat, Color.Empty, 2);
            f.GovdeYukseklik = 220;
            int kalan = Math.Max(0, saniye);
            var iz = new Izgara(2, 1).Sutunlar(200, -100); iz.Bosluk = 16;
            f.Govde.Controls.Add(iz); iz.Dock = DockStyle.Fill;
            var halka = new GeriSayimHalkasi(); halka.Toplam = Math.Max(1, saniye); halka.Kalan = kalan;
            iz.Ekle(halka, 0, 0);
            var p = Paragraf((metin ?? "") + "\n\n" + (sureBitinceOnay ? "Süre bitince işlem başlar." : "Süre bitince işlem İPTAL edilir."), 13f);
            iz.Ekle(p, 1, 0);
            var t = new Timer(); t.Interval = 1000;
            t.Tick += delegate
            {
                kalan--; halka.Kalan = Math.Max(0, kalan);
                if (kalan <= 0) { t.Stop(); if (!Diyalog.OnizlemeModu) { f.Sonuc = sureBitinceOnay ? 1 : 0; f.Close(); } }
            };
            f.Shown += delegate { t.Start(); };
            f.FormClosed += delegate { t.Stop(); t.Dispose(); };
            f.DugmeEkle(0, "İPTAL", Rol.Normal, Simge.Kapat, 0);
            f.DugmeEkle(1, "ŞİMDİ BAŞLA", Rol.Vurgu, Simge.Oynat, 1);
            f.EnterSonuc = int.MinValue;
            f.OnizlemeSonucu = 0;
            return Goster(f) == 1;
        }

        // ------------------------------------------------------------------ Manuel frez adımı
        /// <summary>Manuel frez değişimi adım penceresi (büyük, ses çalar). Basılan düğmenin indeksi; -1 = Esc/ACİL STOP.</summary>
        public static int ManuelFrezAdimi(int adimNo, string metin, string[] dugmeler) { return ManuelFrezAdimi(adimNo, metin, dugmeler, null); }
        public static int ManuelFrezAdimi(int adimNo, string metin, string[] dugmeler, string baslik)
        {
            dugmeler = dugmeler ?? new[] { "TAMAM" };
            var f = new DiyalogFormu("MANUEL FREZ DEĞİŞİMİ · ADIM " + adimNo + (string.IsNullOrEmpty(baslik) ? "" : "  ·  " + baslik), Simge.Takim, Tema.Duraklatildi, dugmeler.Length);
            f.Kenar = Tema.Duraklatildi; f.Buyuk = true; f.TabanGenislik = 860;
            f.GovdeYukseklik = Math.Min(380, Math.Max(150, MetinYuksekligi(metin, 18f, 800)));
            f.DugmeYukseklik = 92;
            var p = Paragraf(metin, 18f); f.Govde.Controls.Add(p); p.Dock = DockStyle.Fill;
            for (int i = 0; i < dugmeler.Length; i++)
            {
                string d = dugmeler[i] ?? "";
                bool durdur = Bicim.BuyukHarf(d).Contains("DURDUR");
                var b = f.DugmeEkle(i, d, i == dugmeler.Length - 1 && !durdur ? Rol.Basari : (durdur ? Rol.TehlikeCizgi : Rol.Normal), Simge.Yok, i);
                b.YaziPt = 16f;
            }
            f.EnterSonuc = int.MinValue;
            try { System.Media.SystemSounds.Exclamation.Play(); } catch { }
            return Goster(f);
        }

        // ------------------------------------------------------------------ Yeni blok
        /// <summary>"Blok takıldı" diyaloğu: isim, kalınlık (10–30), derinlik (0.05–0.5).</summary>
        public static BlokSonucu YeniBlok(string isim, double kalinlik, double derinlik, bool dosyaSecili, bool bekleyenVar)
        {
            var r = new BlokSonucu { Isim = isim ?? "", Kalinlik = kalinlik <= 0 ? 16 : kalinlik, Derinlik = derinlik <= 0 ? 0.15 : derinlik };
            var f = new DiyalogFormu("Yeni blok takıldı", Simge.Blok, Color.Empty, 1);
            f.TabanGenislik = 760; f.GovdeYukseklik = 400;
            var iz = new Izgara(2, 5).Satirlar(56, 56, 56, -50, -50); iz.Bosluk = 12;
            f.Govde.Controls.Add(iz); iz.Dock = DockStyle.Fill;
            var ad = new DegerKutusu { Metinsel = true, Yerel = true, Etiket = "Blok ismi (en çok 10)", EnCokKarakter = 10, Pt = 16f }; ad.Metin = r.Isim;
            var kal = new DegerKutusu { Yerel = true, Etiket = "Kalınlık", Birim = "mm", Ondalik = 2, Min = 10, Max = 30 }; kal.Deger = r.Kalinlik;
            var der = new DegerKutusu { Yerel = true, Etiket = "Kazıma derinliği", Birim = "mm", Ondalik = 2, Min = 0.05, Max = 0.5 }; der.Deger = r.Derinlik;
            iz.Ekle(ad, 0, 0, 2, 1); iz.Ekle(kal, 0, 1); iz.Ekle(der, 1, 1);
            iz.Ekle(new Yazi("İsim, işten önce bloğun kenarına kazınır.", 10.5f, false, YaziRol.Soluk), 0, 2, 2, 1);
            Func<string, string, Rol, int, TouchButton> mk = (m, alt, rol, sec) =>
            {
                var b = new TouchButton(m, Simge.Yok, rol, null, null); b.YaziPt = 13f; b.AltMetin = alt;
                b.Tiklandi += delegate { r.Isim = ad.Metin; r.Kalinlik = kal.Deger; r.Derinlik = der.Deger; f.Sonuc = sec; f.Close(); };
                return b;
            };
            var b0 = iz.Ekle(mk("KAZI VE İŞE BAŞLA", "isim + seçili iş", Rol.Basari, 0), 0, 3); b0.Etkin = dosyaSecili;
            if (!dosyaSecili) b0.AltMetin = "önce iş seçin";
            iz.Ekle(mk("SADECE İSMİ KAZI", "hemen, tek başına", Rol.Normal, 1), 1, 3);
            iz.Ekle(mk("YENİ BLOK HAZIR", "işi sonra başlatacağım", Rol.Vurgu, 2), 0, 4);
            var alt2 = new Izgara(2, 1); alt2.Bosluk = 12;
            iz.Ekle(alt2, 1, 4);
            alt2.Ekle(mk("KULLANILMIŞ BLOK", "isim kazınmaz", Rol.Normal, 3), 0, 0);
            var bi = alt2.Ekle(mk("BEKLEYENİ İPTAL", "", Rol.TehlikeCizgi, 4), 1, 0); bi.Etkin = bekleyenVar;
            f.DugmeEkle(0, "VAZGEÇ", Rol.Normal, Simge.Kapat, -1);
            f.DugmeYukseklik = 64;
            r.Secim = Goster(f);
            return r;
        }

        // ------------------------------------------------------------------ Yarım kalan iş
        /// <summary>Yarım kalan iş: "tam", "yakin", "guvenli", "bastan", "iptal" + iş milindeki takım.</summary>
        public static DevamSonucu Devam(string dosya, string bilgi, int takim) { return Devam(dosya, bilgi, takim, 0); }

        /// <summary>kirik &gt; 0: kırık frez (takım boyu ölçümü). Yalnız "T{k}'NİN İŞİNİ BAŞTAN BAŞLAT" ("frez"), "TÜM İŞİ BAŞTAN" ("bastan"),
        /// VAZGEÇ; kaldığı yerden / yakın / işlem başı seçenekleri gösterilmez (nerede kırıldığı bilinemez).</summary>
        public static DevamSonucu Devam(string dosya, string bilgi, int takim, int kirik)
        {
            if (kirik > 0) return DevamKirik(dosya, bilgi, takim, kirik);
            var r = new DevamSonucu { Takim = Math.Max(0, Math.Min(6, takim)) };
            var f = new DiyalogFormu("Yarım kalan iş · " + (dosya ?? ""), Simge.Oynat, Color.Empty, 1);
            f.TabanGenislik = 720; f.GovdeYukseklik = 290;
            var iz = new Izgara(2, 5).Satirlar(-100, 28, 52, 88, 60); iz.Bosluk = 10;
            f.Govde.Controls.Add(iz); iz.Dock = DockStyle.Fill;
            iz.Ekle(Paragraf(bilgi ?? "", 12.5f), 0, 0, 2, 1);
            iz.Ekle(new Yazi("İş milinde şu an takılı frez (kapağı açıp kontrol edin):", 10.5f, true, YaziRol.Soluk), 0, 1, 2, 1);
            var t = new SecimGrubu(new[] { "Yok", "T1", "T2", "T3", "T4", "T5", "T6" }, null, null, null); t.Secili = r.Takim;
            iz.Ekle(t, 0, 2, 2, 1);
            Func<string, string, Rol, string, TouchButton> mk = (m, alt, rol, sec) =>
            {
                var b = new TouchButton(m, Simge.Yok, rol, null, null); b.YaziPt = 14f; b.AltMetin = alt;
                b.Tiklandi += delegate { r.Secim = sec; r.Takim = t.Secili; f.Sonuc = 1; f.Close(); };
                return b;
            };
            iz.Ekle(mk("KALDIĞI YERDEN DEVAM", "~10 sn geriden, yukarıdan iner · önerilen", Rol.Basari, "tam"), 0, 3);
            iz.Ekle(mk("YAKIN NOKTADAN", "~1 dk geriden, yukarıdan iner", Rol.Vurgu, "yakin"), 1, 3);
            iz.Ekle(mk("İŞLEMİN BAŞINDAN", "son güvenli noktadan", Rol.Normal, "guvenli"), 0, 4);
            iz.Ekle(mk("BAŞTAN BAŞLAT", "", Rol.Normal, "bastan"), 1, 4);
            f.DugmeEkle(0, "VAZGEÇ", Rol.Normal, Simge.Kapat, -1);
            f.DugmeYukseklik = 60;
            Goster(f);
            return r;
        }

        static DevamSonucu DevamKirik(string dosya, string bilgi, int takim, int kirik)
        {
            string tk = "T" + kirik.ToString(Bicim.Inv);
            var r = new DevamSonucu { Takim = Math.Max(0, Math.Min(6, takim)) };
            var f = new DiyalogFormu("Kırık frez · " + tk + " · " + (dosya ?? ""), Simge.Takim, Tema.Alarm, 1);
            f.Kenar = Tema.Alarm;
            f.TabanGenislik = 760; f.GovdeYukseklik = 330;
            var iz = new Izgara(2, 5).Satirlar(-100, 28, 52, 96, 60); iz.Bosluk = 10;
            f.Govde.Controls.Add(iz); iz.Dock = DockStyle.Fill;
            iz.Ekle(Paragraf(bilgi ?? "", 12.5f), 0, 0, 2, 1);
            iz.Ekle(new Yazi("İş milinde şu an takılı frez (kırık " + tk + " PENS AÇ ile çıkarıldıysa: Yok):", 10.5f, true, YaziRol.Soluk), 0, 1, 2, 1);
            var t = new SecimGrubu(new[] { "Yok", "T1", "T2", "T3", "T4", "T5", "T6" }, null, null, null); t.Secili = r.Takim;
            iz.Ekle(t, 0, 2, 2, 1);
            Func<string, string, Rol, string, TouchButton> mk = (m, alt, rol, sec) =>
            {
                var b = new TouchButton(m, Simge.Yok, rol, null, null); b.YaziPt = 14f; b.AltMetin = alt;
                b.Tiklandi += delegate { r.Secim = sec; r.Takim = t.Secili; f.Sonuc = 1; f.Close(); };
                return b;
            };
            iz.Ekle(mk(Bicim.BuyukHarf(tk + "'NİN İŞİNİ BAŞTAN BAŞLAT"), tk + "'nin bu işteki son takım değişiminden · yeni frez alınır ve ölçülür · önerilen", Rol.Basari, "frez"), 0, 3, 2, 1);
            iz.Ekle(mk("TÜM İŞİ BAŞTAN", "bütün iş yeniden kesilir", Rol.Normal, "bastan"), 0, 4, 2, 1);
            f.DugmeEkle(0, "VAZGEÇ", Rol.Normal, Simge.Kapat, -1);
            f.DugmeYukseklik = 60;
            Goster(f);
            return r;
        }
    }

    /// <summary>Geri sayım halkası.</summary>
    public class GeriSayimHalkasi : TemelKontrol
    {
        int kalan; public int Toplam = 5;
        public int Kalan { get { return kalan; } set { kalan = value; Invalidate(); } }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            float d = Math.Min(Width, Height) - Tema.PxF(16);
            var r = new RectangleF((Width - d) / 2, (Height - d) / 2, d, d);
            float k = Tema.PxF(10);
            using (var p = new Pen(Tema.Ayrac, k)) g.DrawEllipse(p, r);
            using (var p = new Pen(Tema.Marka, k)) { p.StartCap = LineCap.Round; p.EndCap = LineCap.Round; if (kalan > 0) g.DrawArc(p, r, -90, 360f * kalan / Math.Max(1, Toplam)); }
            Tema.Yaz(g, kalan.ToString(Bicim.Inv), Tema.Sayi(40f, true), Tema.Yazi, r, StringAlignment.Center, StringAlignment.Center, true);
        }
    }

    // =====================================================================
    //  KABUK (ana pencere)
    // =====================================================================

    /// <summary>Üst şerit zemini (kart rengi + alt çizgi).</summary>
    public class Serit : Panel
    {
        public bool UstCizgi;
        public Serit()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            DoubleBuffered = true; Margin = Padding.Empty;
        }
        protected override void OnPaintBackground(PaintEventArgs e)
        {
            e.Graphics.Clear(BackColor);
            using (var p = new Pen(Tema.KartKenar, Math.Max(1, Tema.PxF(1))))
                if (UstCizgi) e.Graphics.DrawLine(p, 0, 0, Width, 0); else e.Graphics.DrawLine(p, 0, Height - 1, Width, Height - 1);
        }
    }

    /// <summary>Marka: altın elmas + PRIMER.</summary>
    public class MarkaKontrol : TemelKontrol
    {
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            float h = Height, s = Math.Min(Tema.PxF(30), h * 0.42f);
            float x = Tema.PxF(16), cy = h / 2;
            var pts = new[] { new PointF(x + s / 2, cy - s / 2), new PointF(x + s, cy), new PointF(x + s / 2, cy + s / 2), new PointF(x, cy) };
            using (var b = new LinearGradientBrush(new RectangleF(x, cy - s / 2, s, s), Tema.Acilastir(Tema.Marka, 0.25f), Tema.Koyulastir(Tema.Marka, 0.15f), LinearGradientMode.ForwardDiagonal))
                g.FillPolygon(b, pts);
            x += s + Tema.PxF(12);
            Font f = Tema.F(19f, true);
            var z = Tema.Olc(g, "PRIMER", f);
            Tema.Yaz(g, "PRIMER", f, Tema.Yazi, new RectangleF(x, cy - z.Height * 0.62f, Width - x, z.Height), StringAlignment.Near, StringAlignment.Center, true);
            Tema.Yaz(g, "MILL 2 · OPERATÖR", Tema.F(8f, true), Tema.Marka, new RectangleF(x + Tema.PxF(1), cy + z.Height * 0.30f, Width - x, Tema.PxF(16)), StringAlignment.Near, StringAlignment.Center, true);
        }
    }

    /// <summary>Üst şerit bilgi çipleri: bağlantı, DEMO, SİMÜLASYON, ÖNİZLEME, makine adı.</summary>
    public class BilgiCipleri : TemelKontrol
    {
        public bool Bagli, Demo, Simulasyon, Onizleme, Home = true;
        public string MakineAdi = "";
        public void Ayarla(bool bagli, bool demo, bool sim, bool oniz, bool home, string ad)
        {
            ad = ad ?? "";
            if (bagli == Bagli && demo == Demo && sim == Simulasyon && oniz == Onizleme && home == Home && ad == MakineAdi) return;
            Bagli = bagli; Demo = demo; Simulasyon = sim; Onizleme = oniz; Home = home; MakineAdi = ad; Invalidate();
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            float x = Tema.PxF(14), h = Math.Min(Tema.PxF(34), Height * 0.5f), y = (Height - h) / 2;
            x = Cip(g, x, y, h, Bagli ? "Eding bağlı" : "Eding bağlı değil", Bagli ? Tema.Hazir : Tema.Alarm, false, true);
            if (Bagli && !Home) x = Cip(g, x, y, h, "Home gerekli", Tema.Hazirlik, false, true);
            if (Demo) x = Cip(g, x, y, h, "DEMO", Tema.Duraklatildi, true, false);
            if (Simulasyon) x = Cip(g, x, y, h, "SİMÜLASYON", Tema.Hazirlik, true, false);
            if (Onizleme) x = Cip(g, x, y, h, "ÖNİZLEME", Tema.Pasif, true, false);
            if (MakineAdi.Length > 0 && x < Width - Tema.PxF(80))
                Tema.Yaz(g, MakineAdi, Tema.F(10.5f), Tema.Soluk, new RectangleF(x + Tema.PxF(4), 0, Width - x - Tema.PxF(8), Height), StringAlignment.Far, StringAlignment.Center, true);
        }
        float Cip(Graphics g, float x, float y, float h, string s, Color c, bool dolu, bool nokta)
        {
            Font f = Tema.F(10.5f, true);
            float w = Tema.Olc(g, s, f).Width + Tema.PxF(nokta ? 36 : 22);
            if (x + w > Width) return x;
            var r = new RectangleF(x, y, w, h);
            if (dolu) { Tema.YuvarlakDoldur(g, r, h / 2, Tema.Alfa(c, Tema.Koyu ? 50 : 36)); Tema.YuvarlakCiz(g, r, h / 2, c, Math.Max(1, Tema.PxF(1.5f))); }
            else Tema.YuvarlakDoldur(g, r, h / 2, Tema.Dugme);
            float tx = r.X + Tema.PxF(11);
            if (nokta) { float d = Tema.PxF(9); using (var b = new SolidBrush(c)) g.FillEllipse(b, tx, y + (h - d) / 2, d, d); tx += d + Tema.PxF(7); }
            Tema.Yaz(g, s, f, dolu ? c : Tema.Yazi, new RectangleF(tx, y, r.Right - tx, h), StringAlignment.Near, StringAlignment.Center, true);
            return x + w + Tema.PxF(8);
        }
    }

    /// <summary>Saat ve tarih.</summary>
    public class SaatKontrol : TemelKontrol
    {
        public DateTime Zaman = DateTime.Now;
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Tema.Hazirla(g);
            Font f = Tema.Sayi(22f, true);
            float h = f.GetHeight(g);
            Tema.Yaz(g, Zaman.ToString("HH:mm", Bicim.Inv), f, Tema.Yazi, new RectangleF(0, Height / 2f - h * 0.66f, Width - Tema.PxF(10), h), StringAlignment.Far, StringAlignment.Center, true);
            Tema.Yaz(g, Zaman.ToString("d MMMM ddd", Bicim.Tr), Tema.F(9f), Tema.Soluk, new RectangleF(0, Height / 2f + h * 0.34f, Width - Tema.PxF(10), Tema.PxF(16)), StringAlignment.Far, StringAlignment.Center, true);
        }
    }

    /// <summary>
    /// Ana pencere. Denetleyici: new Kabuk(); Komut olayına abone olur; her tikte Uygula(MakineDurumu);
    /// izin değişince IzinleriUygula(...). Görünüm hiçbir eyleme kendi karar vermez.
    /// </summary>
    public class Kabuk : Form
    {
        /// <summary>Her kullanıcı eylemi (bkz. ARAYUZ_API.md).</summary>
        public event EventHandler<KomutArgs> Komut;

        public readonly UretimEkrani Uretim;
        public readonly TakimlarEkrani Takimlar;
        public readonly KalibrasyonEkrani Kalibrasyon;
        public readonly AyarlarEkrani Ayarlar;
        public readonly KayitlarEkrani Kayitlar;
        public readonly UzaktanEkrani Uzaktan;
        public MakineDurumu SonDurum;

        readonly Izgara kok, ust, orta;
        readonly Serit ustSerit;
        readonly StatusPill hap;
        readonly BilgiCipleri cipler;
        readonly SaatKontrol saat;
        readonly EStopButton acil;
        readonly NavRail menu;
        readonly Izgara solSutun;
        readonly TouchButton kapatDugme;
        readonly Panel icerik;
        readonly MessageBar mesaj;
        readonly TouchButton mesajDugme;
        readonly MesgulKatmani mesgul;
        readonly SolmaKatmani solma;
        readonly Timer saatZaman;
        /// <summary>İlerleme teması (Geçişli, Şafak): gösterilen t'yi hedefe yumuşakça yaklaştıran zamanlayıcı (yalnız fark varken çalışır).</summary>
        readonly Timer gecisZaman;
        float gecisHedef;
        DateTime gecisSonTik;
        readonly Dictionary<string, Ekran> ekranlar = new Dictionary<string, Ekran>();
        string etkinEkran = "";
        string geciciMesaj; MesajTuru geciciTur; DateTime geciciBitis;
        string mesgulElle;

        public Kabuk()
        {
            Text = "PrimerMill 2";
            // SK-14: bütün ölçekleme elle (Tema.S × Tema.Dpi, Tema.Px); süreç DPI-aware (SetProcessDPIAware) olduğundan
            // WinForms otomatik ölçeklemesi de açık olursa %125/%150'de çift ölçeklenirdi. Diyaloglar ve katmanlar gibi None.
            AutoScaleMode = AutoScaleMode.None;
            KeyPreview = true;
            DoubleBuffered = true;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(1024, 768);
            MinimumSize = new Size(800, 600);
            BackColor = Tema.Zemin;
            SuspendLayout();

            kok = new Izgara(1, 3).Satirlar(92, -100, 46); kok.Bosluk = 0;
            Controls.Add(kok); kok.Dock = DockStyle.Fill;

            // üst şerit
            ustSerit = new Serit();
            kok.Ekle(ustSerit, 0, 0);
            ust = new Izgara(5, 1).Sutunlar(196, 300, -100, 150, 108); ust.Bosluk = 8;
            ustSerit.Controls.Add(ust); ust.Dock = DockStyle.Fill;
            ust.Ekle(new MarkaKontrol(), 0, 0);
            hap = ust.Ekle(new StatusPill(), 1, 0);
            cipler = ust.Ekle(new BilgiCipleri(), 2, 0);
            saat = ust.Ekle(new SaatKontrol(), 3, 0);
            acil = ust.Ekle(new EStopButton(), 4, 0);
            acil.Basildi += delegate { KomutGeldi("acilstop", ""); };

            // orta: menü + içerik
            orta = new Izgara(2, 1).Sutunlar(88, -100); orta.Bosluk = 0;
            kok.Ekle(orta, 0, 1);
            // sol sütun: menü + en altta CİHAZI KAPAT (her ekranda; komut sistem.kapat, onayı denetleyici açar)
            solSutun = new Izgara(1, 2).Satirlar(-100, 84); solSutun.Bosluk = 0;
            orta.Ekle(solSutun, 0, 0);
            menu = solSutun.Ekle(new NavRail(), 0, 0);
            kapatDugme = new TouchButton("Kapat", Simge.Guc, Rol.Sessiz, "sistem.kapat", "");
            kapatDugme.Dikey = true; kapatDugme.YaziPt = 9.5f; kapatDugme.Kalin = false; kapatDugme.NedenIcinde = false;
            solSutun.Ekle(kapatDugme, 0, 1);
            menu.Ekle("uretim", "Üretim", Simge.Uretim);
            menu.Ekle("takimlar", "Takımlar", Simge.Takim);
            menu.Ekle("kalibrasyon", "Kalibrasyon", Simge.Hedef);
            menu.Ekle("ayarlar", "Ayarlar", Simge.Ayar);
            menu.Ekle("kayitlar", "Kayıtlar", Simge.Liste);
            menu.Ekle("uzaktan", "Uzaktan", Simge.Uzak);
            menu.Secildi += ad => EkranGoster(ad);
            icerik = new Panel(); icerik.Margin = Padding.Empty;
            orta.Ekle(icerik, 1, 0);

            Uretim = new UretimEkrani(); Takimlar = new TakimlarEkrani(); Kalibrasyon = new KalibrasyonEkrani();
            Ayarlar = new AyarlarEkrani(); Kayitlar = new KayitlarEkrani(); Uzaktan = new UzaktanEkrani();
            ekranlar["uretim"] = Uretim; ekranlar["takimlar"] = Takimlar; ekranlar["kalibrasyon"] = Kalibrasyon;
            ekranlar["ayarlar"] = Ayarlar; ekranlar["kayitlar"] = Kayitlar; ekranlar["uzaktan"] = Uzaktan;
            foreach (var e in ekranlar.Values) { e.Visible = false; icerik.Controls.Add(e); }
            mesgul = new MesgulKatmani(); mesgul.Dock = DockStyle.Fill; mesgul.Visible = false; icerik.Controls.Add(mesgul);
            solma = new SolmaKatmani(); icerik.Controls.Add(solma);
            Ayarlar.TemaIstendi += mod => TemaUygula(mod);

            // alt mesaj şeridi
            mesaj = new MessageBar();
            kok.Ekle(mesaj, 0, 2);
            mesaj.Tiklandi += delegate { EkranGoster("kayitlar"); };
            mesajDugme = new TouchButton("", Simge.Kilit, Rol.Normal, null, null);
            mesajDugme.YaziPt = 11.5f; mesajDugme.Width = 200; mesajDugme.Visible = false; mesajDugme.MinimumSize = new Size(40, 30);
            mesaj.Controls.Add(mesajDugme);

            saatZaman = new Timer(); saatZaman.Interval = 1000;
            saatZaman.Tick += delegate { saat.Zaman = DateTime.Now; saat.Invalidate(); MesajYenile(); };
            saatZaman.Start();

            gecisZaman = new Timer(); gecisZaman.Interval = 33;
            gecisZaman.Tick += delegate { GecisTik(); };

            KomutYolu.Gonderildi += KomutGeldi;
            KomutYolu.NedenIstendi += n => Bildir(n, MesajTuru.Uyari);
            Gezinti.Git = EkranGoster;
            if (Diyalog.AcilStop == null) Diyalog.AcilStop = () => KomutGeldi("acilstop", "");
            Diyalog.Sahip = this;

            ResumeLayout(false);
            EkranGoster("uretim");
            TemaUygula(Tema.Mod);
            Uygula(new MakineDurumu());
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                KomutYolu.Gonderildi -= KomutGeldi;
                saatZaman.Dispose();
                gecisZaman.Dispose();
                if (Diyalog.Sahip == this) Diyalog.Sahip = null;
            }
            base.Dispose(disposing);
        }

        void KomutGeldi(string ad, string arg)
        {
            var h = Komut;
            if (h != null)
            {
                try { h(this, new KomutArgs(ad, arg)); }
                catch (Exception ex) { Bildir("Komut işlenemedi (" + ad + "): " + ex.Message, MesajTuru.Hata); }
            }
        }

        // ------------------------------------------------------------ ölçek ve tema
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            try { using (var g = CreateGraphics()) Tema.Dpi = Math.Max(1f, g.DpiX / 96f); } catch { }
            OlcekKontrol(true);
        }
        protected override void OnResize(EventArgs e) { base.OnResize(e); OlcekKontrol(false); }

        void OlcekKontrol(bool zorla)
        {
            if (ClientSize.Width <= 0 || ClientSize.Height <= 0 || WindowState == FormWindowState.Minimized) return;
            float s = Tema.KatsayiHesapla(ClientSize.Width, ClientSize.Height);
            if (!zorla && Math.Abs(s - Tema.S) < 0.015f) return;
            Tema.S = s;
            SuspendLayout();
            icerik.Padding = new Padding(Tema.Px(14), Tema.Px(12), Tema.Px(14), Tema.Px(12));
            OlcekGez(this);
            ResumeLayout(true);
            Invalidate(true);
        }

        static void OlcekGez(Control k)
        {
            foreach (Control c in k.Controls)
            {
                var o = c as IOlcekli;
                if (o != null) o.Olcekle();
                OlcekGez(c);
            }
        }

        /// <summary>Koyu / açık tema (çalışırken). Uyumluluk: TemaUygula(true) = Koyu, TemaUygula(false) = Açık.</summary>
        public void TemaUygula(bool koyu) { TemaUygula(koyu ? TemaModu.Koyu : TemaModu.Acik); }

        /// <summary>Tema ayar değeriyle: "koyu", "acik", "gecisli" (bilinmeyen = koyu).</summary>
        public void TemaUygula(string mod) { TemaUygula(Tema.ModCoz(mod)); }

        /// <summary>Tema modu (çalışırken). Geçişli / Şafak: yüzeyler son durumun ilerlemesinden hemen hesaplanır (geçiş animasyonsuz başlar).</summary>
        public void TemaUygula(TemaModu mod)
        {
            gecisZaman.Stop();
            if (Tema.IlerlemeliMi(mod)) { gecisHedef = Tema.GecisHedefi(SonDurum); Tema.GecisT = gecisHedef; }
            Tema.Uygula(mod);
            YuzeyleriBoya();
            Kayitlar.TemaYenile();
            Invalidate(true);
        }

        /// <summary>İlerleme temasında (Geçişli, Şafak) animasyonu beklemeden gösterilen rengi hedefe atlatır (ekran görüntüsü, test).</summary>
        public void GecisiTamamla()
        {
            if (!Tema.Ilerlemeli) return;
            gecisZaman.Stop();
            if (Math.Abs(Tema.GecisT - gecisHedef) < 0.0001f) return;
            if (!Tema.GecisAyarla(gecisHedef)) return;
            YuzeyleriBoya();
            Kayitlar.YuzeyYenile();
            Invalidate(true);
        }

        /// <summary>İlerleme teması: hedef t (0..1; Tema.GecisHedefi). Fark varsa yumuşak geçiş zamanlayıcısını başlatır.</summary>
        void GecisHedefAyarla(float t)
        {
            gecisHedef = t;
            if (!Tema.Ilerlemeli) { gecisZaman.Stop(); return; }
            if (Math.Abs(Tema.GecisT - t) < 0.001f) return;
            if (!IsHandleCreated || !Visible) { GecisiTamamla(); return; }
            if (!gecisZaman.Enabled) { gecisSonTik = DateTime.Now; gecisZaman.Start(); }
        }

        void GecisTik()
        {
            if (!Tema.Ilerlemeli) { gecisZaman.Stop(); return; }
            // üstel yumuşatma, zaman sabiti ~0.45 s: 200 ms'lik Yuzde adımları tek akışa dönüşür (tik kaçsa da hız aynı)
            DateTime simdi = DateTime.Now;
            double dt = (simdi - gecisSonTik).TotalSeconds; gecisSonTik = simdi;
            if (dt <= 0 || dt > 0.5) dt = gecisZaman.Interval / 1000.0;
            float fark = gecisHedef - Tema.GecisT;
            float yeni;
            if (Math.Abs(fark) < 0.001f) { yeni = gecisHedef; gecisZaman.Stop(); }
            else yeni = Tema.GecisT + fark * (float)(1 - Math.Exp(-dt / 0.45));
            if (yeni == Tema.GecisT) return;
            // 8 bitlik renkler bu karede değişmediyse boyama yok (yavaş ilerlemede CPU yükü ~0)
            if (!Tema.GecisAyarla(yeni)) return;
            YuzeyleriBoya();
            Kayitlar.YuzeyYenile();
            Invalidate(true);
        }

        /// <summary>Yüzey belirteçlerini (Zemin, Kart, Menu) kontrollerin BackColor'una yazar; yazı tiplerine / yerleşime dokunmaz.</summary>
        void YuzeyleriBoya()
        {
            SuspendLayout();
            BackColor = Tema.Zemin;
            ustSerit.BackColor = Tema.Kart;
            TemaGez(this, Tema.Zemin);
            ustSerit.BackColor = Tema.Kart;
            foreach (Control c in ust.Controls) c.BackColor = Tema.Kart;
            ust.BackColor = Tema.Kart;
            mesaj.BackColor = mesaj.AlarmModu ? Tema.Alarm : Tema.Kart;
            mesajDugme.BackColor = mesaj.BackColor;
            solSutun.BackColor = Tema.Menu; kapatDugme.BackColor = Tema.Menu;
            ResumeLayout(false);
        }

        static void TemaGez(Control k, Color yuzey)
        {
            foreach (Control c in k.Controls)
            {
                // BackColor yalnız değişince yazılır (setter zaten yeniden çizer; geçiş karelerinde gereksiz iş olmasın)
                if (c is Card) { if (c.BackColor != Tema.Kart) c.BackColor = Tema.Kart; TemaGez(c, Tema.Kart); }
                else if (c is Serit) { if (c.BackColor != Tema.Kart) c.BackColor = Tema.Kart; TemaGez(c, Tema.Kart); }
                else if (c is MessageBar) { TemaGez(c, c.BackColor); }
                else if (c is TextBox) { }
                else { if (c.BackColor != yuzey) c.BackColor = yuzey; TemaGez(c, yuzey); }
            }
        }

        // ------------------------------------------------------------ gezinti
        /// <summary>Ekran aç: "uretim", "takimlar", "kalibrasyon", "ayarlar", "kayitlar", "uzaktan"; alt sayfalar: "takimlar.yuva", "takimlar.hareket", "takimlar.ismili", "takimlar.omur", "kalibrasyon.disk", "kalibrasyon.oto", "ayarlar.0".."ayarlar.6".</summary>
        public void EkranGoster(string ad)
        {
            if (string.IsNullOrEmpty(ad)) return;
            string ana = ad, alt = null;
            int n = ad.IndexOf('.');
            if (n > 0) { ana = ad.Substring(0, n); alt = ad.Substring(n + 1); }
            Ekran e;
            if (!ekranlar.TryGetValue(ana, out e)) return;
            if (alt != null)
            {
                if (ana == "takimlar") Takimlar.SekmeGoster(alt == "yuva" ? 1 : alt == "hareket" ? 2 : alt == "ismili" ? 3 : alt == "omur" ? 4 : 0);
                else if (ana == "kalibrasyon") Kalibrasyon.Sayfa(alt);
                else if (ana == "ayarlar") { int k; if (int.TryParse(alt, out k)) Ayarlar.SekmeGoster(k); }
            }
            menu.Secili = ana;
            if (ana == etkinEkran) return;
            etkinEkran = ana;
            icerik.SuspendLayout();
            foreach (var kv in ekranlar) kv.Value.Visible = kv.Key == ana;
            icerik.ResumeLayout(true);
            if (mesgul.Visible) mesgul.BringToFront();
            if (IsHandleCreated && Visible) solma.Baslat(e);
            KomutGeldi("ekran", ana);
        }
        public string EtkinEkran { get { return etkinEkran; } }
        /// <summary>Üst şerit yüksekliği (px); diyaloglar bunun altına yerleşir.</summary>
        public int UstSeritYuksekligi { get { return ustSerit.Height; } }
        /// <summary>ACİL STOP düğmesinin ekran koordinatı (diyalog katmanı için).</summary>
        public Rectangle AcilStopEkranda { get { return acil.IsHandleCreated ? acil.RectangleToScreen(acil.ClientRectangle) : Rectangle.Empty; } }

        // ------------------------------------------------------------ durum
        /// <summary>Denetleyiciden gelen durumu tüm ekranlara uygular.</summary>
        public void Uygula(MakineDurumu d)
        {
            if (d == null) return;
            if (InvokeRequired) { BeginInvoke(new Action<MakineDurumu>(Uygula), d); return; }
            SonDurum = d;
            GecisHedefAyarla(Tema.GecisHedefi(d));
            hap.Durum = d.AcilStop ? Durum.Alarm : d.Durum;
            hap.Metin = d.AcilStop ? "ACİL STOP" : Tema.DurumAdi(d.Durum);
            cipler.Ayarla(d.Bagli, d.Demo, d.EdingSimulasyon, d.Onizleme, d.HomeAlindi || !d.Bagli, d.MakineAdi);
            acil.Aktif = d.AcilStop;
            menu.Rozet("kayitlar", d.SonMesajTuru == MesajTuru.Hata && !string.IsNullOrEmpty(d.SonMesaj) && etkinEkran != "kayitlar");
            menu.Rozet("kalibrasyon", d.OtoOlcumBitti && !d.OtoSonucHazir);
            string m = mesgulElle ?? d.Mesgul;
            mesgul.Metin = m ?? "";
            if (mesgul.Visible != !string.IsNullOrEmpty(m)) { mesgul.Visible = !string.IsNullOrEmpty(m); if (mesgul.Visible) mesgul.BringToFront(); }
            foreach (var e in ekranlar.Values)
            {
                try { e.DurumUygula(d); }
                catch (Exception ex) { Bildir("Ekran güncellenemedi: " + ex.Message, MesajTuru.Hata); }
            }
            MesajYenile();
        }

        void MesajYenile()
        {
            var d = SonDurum ?? new MakineDurumu();
            if (d.AcilStop)
            {
                mesaj.Ayarla(MesajTuru.Hata, "", "ACİL STOP BASILI · makine kilitli. Sebebi giderin, sonra kilidi kaldırın.", true);
                MesajDugmesi("KİLİDİ KALDIR", "acilstop.kaldir");
            }
            else if (d.Durum == Durum.Alarm)
            {
                mesaj.Ayarla(MesajTuru.Hata, d.SonMesajZamani == DateTime.MinValue ? "" : d.SonMesajZamani.ToString("HH:mm", Bicim.Inv),
                    "ALARM · " + (string.IsNullOrEmpty(d.SonMesaj) ? (d.DurumMetni ?? "") : d.SonMesaj), true);
                MesajDugmesi("ALARMI TEMİZLE", "makine.reset");
            }
            else
            {
                MesajDugmesi(null, null);
                if (geciciMesaj != null && DateTime.Now < geciciBitis)
                    mesaj.Ayarla(geciciTur, DateTime.Now.ToString("HH:mm", Bicim.Inv), geciciMesaj, false);
                else
                {
                    geciciMesaj = null;
                    mesaj.Ayarla(d.SonMesajTuru, d.SonMesajZamani == DateTime.MinValue ? "" : d.SonMesajZamani.ToString("HH:mm", Bicim.Inv), d.SonMesaj ?? "", false);
                }
            }
            mesajDugme.BackColor = mesaj.BackColor;
        }

        void MesajDugmesi(string metin, string komut)
        {
            bool gor = metin != null;
            if (gor) { mesajDugme.Metin = metin; mesajDugme.KomutAyarla(komut, ""); mesajDugme.Width = Tema.Px(210); }
            if (mesajDugme.Visible != gor) { mesajDugme.Visible = gor; mesaj.PerformLayout(); mesaj.Invalidate(); }
        }

        /// <summary>Alt şeritte birkaç saniye görünen bildirim (kalıcı pencere açmaz).</summary>
        public void Bildir(string metin, MesajTuru tur)
        {
            geciciMesaj = metin; geciciTur = tur; geciciBitis = DateTime.Now.AddSeconds(5);
            MesajYenile();
        }

        /// <summary>Meşgul katmanını elle göster (null/boş = gizle). MakineDurumu.Mesgul ile de yapılabilir.</summary>
        public void MesgulGoster(string metin)
        {
            mesgulElle = string.IsNullOrEmpty(metin) ? null : metin;
            mesgul.Metin = metin ?? "";
            mesgul.Visible = mesgulElle != null || (SonDurum != null && !string.IsNullOrEmpty(SonDurum.Mesgul));
            if (mesgul.Visible) mesgul.BringToFront();
        }

        // ------------------------------------------------------------ izinler
        /// <summary>İzin tablosu: izin[komut] = false ise pasif; neden[komut] dokununca/ipucunda gösterilir. Anahtar "ad", "ad:arg" ya da "önek.*".</summary>
        public void IzinleriUygula(IDictionary<string, bool> izin, IDictionary<string, string> neden)
        {
            Izinler.Ayarla(izin, neden);
            IzinGez(this);
            foreach (var f in Application.OpenForms.Cast<Form>().ToArray()) if (f != this) IzinGez(f);
        }
        /// <summary>Yalnız neden tablosu: tablodaki her komut pasif, diğerleri etkin.</summary>
        public void IzinleriUygula(IDictionary<string, string> neden)
        {
            var iz = new Dictionary<string, bool>();
            if (neden != null) foreach (var k in neden.Keys) iz[k] = false;
            IzinleriUygula(iz, neden);
        }
        /// <summary>PowerShell Hashtable kolaylığı: @{ 'is.baslat' = $false } ve @{ 'is.baslat' = 'Önce dosya seçin' }.</summary>
        public void IzinleriUygulaTablo(IDictionary izin, IDictionary neden)
        {
            var a = new Dictionary<string, bool>();
            var b = new Dictionary<string, string>();
            if (izin != null) foreach (DictionaryEntry kv in izin) if (kv.Key != null) { bool v = false; try { v = Convert.ToBoolean(kv.Value, Bicim.Inv); } catch { } a[kv.Key.ToString()] = v; }
            if (neden != null) foreach (DictionaryEntry kv in neden) if (kv.Key != null) b[kv.Key.ToString()] = kv.Value == null ? null : kv.Value.ToString();
            IzinleriUygula(a, b);
        }
        static void IzinGez(Control k)
        {
            foreach (Control c in k.Controls)
            {
                var s = c as IKomutKaynagi;
                if (s != null) s.IzinYenile();
                IzinGez(c);
            }
        }

        // ------------------------------------------------------------ klavye
        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == Keys.Escape) { KomutGeldi("acilstop", ""); return true; }
            return base.ProcessCmdKey(ref msg, keyData);
        }
    }
}
