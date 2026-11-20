// PrimerMill 2 — ekran görüntüsü aracı (yalnız geliştirme; makineye kurulmaz).
// Mono + Xvfb altında Kabuk'u sahte (demo) verilerle doldurur, her ekranı / sihirbaz adımını /
// önemli diyalogları açar ve Graphics.CopyFromScreen ile PNG kaydeder.
// Derleme ve çalıştırma: tests/ui/ekran_goruntusu_al.sh
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Windows.Forms;
using PrimerUI;

static class EkranGoruntusu
{
    class Adim
    {
        public string Dosya;
        public int W, H;
        public TemaModu Mod = TemaModu.Koyu;
        public Action Hazirla;
    }

    static Kabuk k;
    static string cikis;
    static readonly List<Adim> adimlar = new List<Adim>();
    static int sira = -1;
    static int bekle;
    static readonly List<string> komutlar = new List<string>();

    [STAThread]
    static void Main(string[] args)
    {
        cikis = args.Length > 0 ? args[0] : Path.Combine(Environment.CurrentDirectory, "teslim/ekran_goruntuleri");
        Directory.CreateDirectory(cikis);
        if (args.Length < 2) foreach (var f in Directory.GetFiles(cikis, "*.png")) File.Delete(f);
        Application.EnableVisualStyles();

        k = new Kabuk();
        k.FormBorderStyle = FormBorderStyle.None;
        k.StartPosition = FormStartPosition.Manual;
        k.Location = Point.Empty;
        k.Size = new Size(1024, 768);
        k.Komut += (s, e) => komutlar.Add(e.ToString());
        Diyalog.OnizlemeModu = true;
        TemelKontrol.IpuculariGoster = false;
        Diyalog.AcilStop = () => komutlar.Add("ACİL STOP (diyalog)");

        Planla();
        if (args.Length > 1) adimlar.RemoveAll(a => !System.Text.RegularExpressions.Regex.IsMatch(a.Dosya, args[1]));

        var t = new Timer { Interval = 100 };
        t.Tick += delegate { Tik(t); };
        k.Shown += delegate { t.Start(); };
        Application.Run(k);
        Console.WriteLine("Yakalanan komutlar (ilk 20): " + string.Join(" | ", komutlar.GetRange(0, Math.Min(20, komutlar.Count)).ToArray()));
    }

    static void Tik(Timer t)
    {
        if (bekle > 0) { bekle--; return; }
        if (sira >= 0 && sira < adimlar.Count) Yakala(adimlar[sira]);
        sira++;
        Diyalog.HepsiniKapat();
        if (sira >= adimlar.Count) { t.Stop(); Console.WriteLine(adimlar.Count + " ekran görüntüsü: " + cikis); k.Close(); return; }
        var a = adimlar[sira];
        if (k.Size.Width != a.W || k.Size.Height != a.H) { k.Size = new Size(a.W, a.H); k.Location = Point.Empty; }
        if (Tema.Mod != a.Mod) k.TemaUygula(a.Mod);
        try { a.Hazirla(); } catch (Exception ex) { Console.WriteLine("HATA " + a.Dosya + ": " + ex); }
        k.GecisiTamamla(); // Geçişli: yumuşak geçişi beklemeden hedef renk
        k.Refresh();
        bekle = 6; // ~600 ms: yerleşim, ilerleme animasyonu ve diyalog çizimi otursun
    }

    static void Yakala(Adim a)
    {
        Application.DoEvents();
        using (var bmp = new Bitmap(a.W, a.H, PixelFormat.Format24bppRgb))
        {
            using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(0, 0, 0, 0, new Size(a.W, a.H));
            bmp.Save(Path.Combine(cikis, a.Dosya), ImageFormat.Png);
        }
        Console.WriteLine("  " + a.Dosya);
    }

    static void Ekle(string dosya, int w, int h, bool koyu, Action hazirla)
    {
        Ekle(dosya, w, h, koyu ? TemaModu.Koyu : TemaModu.Acik, hazirla);
    }
    static void Ekle(string dosya, int w, int h, TemaModu mod, Action hazirla)
    {
        adimlar.Add(new Adim { Dosya = dosya, W = w, H = h, Mod = mod, Hazirla = hazirla });
    }

    // -----------------------------------------------------------------------------------------
    static void Planla()
    {
        int n = 0;
        Func<string> no = () => (++n).ToString("00");
        foreach (var boy in new[] { new Size(1024, 768), new Size(1920, 1080) })
        {
            int W = boy.Width, H = boy.Height;
            string r = "_koyu_" + W;
            bool kucuk = W == 1024;
            Ekle(no() + "_uretim" + r + ".png", W, H, true, () => { Calisiyor(); Git("uretim"); });
            Ekle(no() + "_uretim_duraklatildi" + r + ".png", W, H, true, () => { var d = Ornek(); d.Durum = Durum.Duraklatildi; d.DurumMetni = "Duraklatıldı"; d.SonMesaj = "İş duraklatıldı (satır 44 812). Devam için DEVAM."; d.SonMesajTuru = MesajTuru.Uyari; Uygula(d, IzinDuraklatildi()); Git("uretim"); });
            if (kucuk)
            {
                Ekle(no() + "_uretim_acilstop" + r + ".png", W, H, true, () => { var d = Ornek(); d.Durum = Durum.Alarm; d.AcilStop = true; d.DurumMetni = "ACİL STOP"; d.ManuelMesaj = null; Uygula(d, IzinAlarm()); Git("uretim"); });
                Ekle(no() + "_uretim_manuel_frez" + r + ".png", W, H, true, () => { var d = Ornek(); d.FrezModu = "MANUEL"; d.ManuelMesaj = "T2 → T3 · pens açılacak, frezi tut"; d.Durum = Durum.Duraklatildi; Uygula(d, IzinDuraklatildi()); Git("uretim"); });
                Ekle(no() + "_uretim_hazir_dosya_uyarili" + r + ".png", W, H, true, () => { var d = Hazir(); d.IsUyarilari.Add("T3 konumu HENÜZ AYARLANMADI. Alırken kırılabilir."); Uygula(d, IzinHazir()); Git("uretim"); });
            }
            Ekle(no() + "_takimlar_degisim" + r + ".png", W, H, true, () => { Uygula(Hazir(), IzinHazir()); Git("takimlar"); k.Takimlar.Sec("T3"); });
            Ekle(no() + "_takimlar_yuva_ayari" + r + ".png", W, H, true, () => { var d = Hazir(); YuvaAyari(d); Uygula(d, IzinHazir()); Git("takimlar.yuva"); k.Takimlar.Sec("T3"); });
            Ekle(no() + "_takimlar_hareket" + r + ".png", W, H, true, () => { Uygula(Hazir(), IzinHazir()); Git("takimlar.hareket"); });
            Ekle(no() + "_takimlar_ismili" + r + ".png", W, H, true, () => { var d = Hazir(); d.IsMiliCalisiyor = true; d.IsMiliDevir = 18000; Uygula(d, IzinHazir()); Git("takimlar.ismili"); });
            Ekle(no() + "_kalibrasyon_menu" + r + ".png", W, H, true, () => { var d = Hazir(); d.OtoOlcumBitti = true; Uygula(d, IzinHazir()); Git("kalibrasyon"); k.Kalibrasyon.Sayfa("hub"); });
            for (int i = 0; i < 5; i++)
            {
                if (!kucuk && i != 2 && i != 3) continue;
                int a = i;
                Ekle(no() + "_kal_disk_adim" + (i + 1) + r + ".png", W, H, true, () => { var d = Hazir(); Disk(d, a); Uygula(d, IzinHazir()); Git("kalibrasyon"); k.Kalibrasyon.Sayfa("disk"); });
            }
            for (int i = 0; i < 5; i++)
            {
                if (!kucuk && i != 1 && i != 3) continue;
                int a = i;
                Ekle(no() + "_kal_oto_adim" + (i + 1) + r + ".png", W, H, true, () => { var d = Hazir(); Oto(d, a); var iz = IzinHazir(); if (!d.ProbTestGecti) { iz.Add("kal.oto.ileri", "Önce prob testini geçin (TEMAS VAR ve YOK)"); } Uygula(d, iz); Git("kalibrasyon"); k.Kalibrasyon.Sayfa("oto"); });
            }
            string[] sekme = { "genel", "is_akisi", "hareket", "eding", "uzaktan", "yedekler", "degiskenler" };
            for (int i = 0; i < 7; i++)
            {
                if (!kucuk && i != 0 && i != 6) continue;
                int s = i;
                Ekle(no() + "_ayarlar_" + sekme[i] + r + ".png", W, H, true, () => { var d = Hazir(); d.Kiosk = s == 0; Uygula(d, IzinHazir()); Git("ayarlar." + s); });
            }
            Ekle(no() + "_kayitlar" + r + ".png", W, H, true, () => { Calisiyor(); Git("kayitlar"); });
            Ekle(no() + "_uzaktan" + r + ".png", W, H, true, () => { Uygula(Hazir(), IzinHazir()); Git("uzaktan"); });
            Ekle(no() + "_simulasyon_buyuk" + r + ".png", W, H, true, () => { Calisiyor(); Git("uretim"); k.Uretim.BuyukSim(true); });
            Ekle(no() + "_diyalog_tehlikeli" + r + ".png", W, H, true, () => { Uygula(Hazir(), IzinHazir()); Git("kalibrasyon"); Tehlikeli(); });
            if (kucuk)
            {
                Ekle(no() + "_diyalog_onay" + r + ".png", W, H, true, () => { Calisiyor(); Git("uretim"); Diyalog.Onay("İşi durdur", "ZY2_45.nc %64'te. İş iptal edilsin mi?\nKaldığı yerden devam kaydı tutulur.", "EVET, DURDUR"); });
                Ekle(no() + "_diyalog_hata" + r + ".png", W, H, true, () => { Uygula(Hazir(), IzinHazir()); Git("uretim"); Diyalog.Hata("Hava basıncı düştü (EXTERR). İş satır 44 812'de durdu.", "Kompresörü açın ve basıncı kontrol edin. Sonra ALARMI TEMİZLE ve BAŞLAT ile kaldığı yerden devam edin."); });
                Ekle(no() + "_diyalog_sayi_girisi" + r + ".png", W, H, true, () => { Uygula(Hazir(), IzinHazir()); Git("kalibrasyon"); k.Kalibrasyon.Sayfa("disk"); Diyalog.SayiGir("Disk kalınlığı (kumpas)", 16.02, 5, 40, 2); });
                Ekle(no() + "_diyalog_klavye" + r + ".png", W, H, true, () => { Uygula(Hazir(), IzinHazir()); Git("kayitlar"); Diyalog.MetinGir("MDI satırı", "G53 G0 Z", false, 0); });
                Ekle(no() + "_diyalog_secim" + r + ".png", W, H, true, () => { Uygula(Hazir(), IzinHazir()); Git("uretim"); Diyalog.Secim("Frez değişimi", "Bu iş için frez değişimi nasıl yapılsın?", new[] { "OTOMATİK (değiştirici)", "MANUEL (elle)" }); });
                Ekle(no() + "_diyalog_geri_sayim" + r + ".png", W, H, true, () => { var d = Hazir(); d.Durum = Durum.Hazirlik; d.DurumMetni = "Home gerekli"; d.HomeAlindi = false; d.Dosya = null; d.ToplamSatir = 0; d.TahminiSn = 0; d.IsTakimlari = null; Uygula(d, IzinHazir()); Git("uretim"); Diyalog.GeriSayim("Makine home konumuna gidecek.\nKapak kapalı, iş milinde frez yok mu?", 5); });
                Ekle(no() + "_diyalog_manuel_frez" + r + ".png", W, H, true, () => { var d = Ornek(); d.FrezModu = "MANUEL"; Uygula(d, IzinDuraklatildi()); Git("uretim"); Diyalog.ManuelFrezAdimi(1, "1.  İş milindeki T2 frezini parmaklarınla tut.\n2.  PENS'İ AÇ'a bas: pens havayla açılır, frezi çıkar.\n\nSonra takılacak frez:  T3", new[] { "İşi durdur", "PENS'İ AÇ" }, "T2 → T3"); });
                Ekle(no() + "_diyalog_yeni_blok" + r + ".png", W, H, true, () => { Uygula(Hazir(), IzinHazir()); Git("uretim"); Diyalog.YeniBlok("124", 16, 0.15, true, true); });
                Ekle(no() + "_diyalog_takim_sec" + r + ".png", W, H, true, () => { Uygula(Hazir(), IzinHazir()); Git("uretim"); Diyalog.TakimSec(2, new[] { "", "Ø2.0 küre", "Ø1.0 küre", "Ø0.6 küre", "Ø2.5 düz", "", "Ø1.0 düz" }); });
                Ekle(no() + "_diyalog_devam" + r + ".png", W, H, true, () => { Uygula(Hazir(), IzinHazir()); Git("uretim"); Diyalog.Devam("ZY2_45.nc", "%64 yapılmıştı · 18.11.2026 14:31\nİş sürerken panel/elektrik kapandı · satır 44 812", 2); });
                Ekle(no() + "_diyalog_is_sec" + r + ".png", W, H, true, () => { Uygula(Hazir(), IzinHazir()); Git("uretim"); Diyalog.ListeSec("İş seç", new[] { "ZY2_45.nc", "ZY2_44.nc", "Kron_A12.nc", "Kopru_3uye.nc", "Test_disk.nc", "ZY1_90.nc", "Abutment_7.nc" }, new[] { "bugün 14:02 · 69 751 satır · ~1:06", "bugün 09:40 · 52 120 satır", "dün 17:12", "dün 11:05", "16.11.2026", "15.11.2026", "14.11.2026" }, "GÖZAT…"); });
                Ekle(no() + "_diyalog_cihaz_kapat" + r + ".png", W, H, true, () => { Uygula(Hazir(), IzinHazir()); Git("uretim"); Diyalog.Secim("Cihazı kapat", "Cihaz kapatılacak: Eding ayarlarını (G54, kalıcı değişkenler) kaydederek kapanır, sonra bilgisayar kapanır.\nYENİDEN BAŞLAT: bilgisayar kapanıp yeniden açılır.", new[] { "KAPAT", "YENİDEN BAŞLAT", "VAZGEÇ" }); });
                Ekle(no() + "_diyalog_kiosk_pin" + r + ".png", W, H, true, () => { var d = Hazir(); d.Kiosk = true; Uygula(d, IzinHazir()); Git("ayarlar.0"); Diyalog.PinGir("Windows'a geç", 8); var g = Diyalog.SonForm; if (g != null) foreach (var c in Tum(g)) { var gg = c as GirisGostergesi; if (gg != null) gg.Metin = "24"; } });
                Ekle(no() + "_diyalog_bilgi_uyarilar" + r + ".png", W, H, true, () => { var d = Hazir(); d.IsUyarilari.Add("T3 konumu HENÜZ AYARLANMADI. Alırken kırılabilir."); d.IsUyarilari.Add("T6 bu işte kullanılmıyor ama iş milinde."); Uygula(d, IzinHazir()); Git("uretim"); Diyalog.Bilgi("Dosya kontrolü · ZY2_45.nc", "UYARILAR:\n•  T3 konumu HENÜZ AYARLANMADI. Alırken kırılabilir.\n•  Tahmini süre 1:06:00 (hızlı hareket 4000 mm/dk varsayımı)."); });
            }
        }
        // açık tema
        Ekle(no() + "_uretim_acik_1024.png", 1024, 768, false, () => { Calisiyor(); Git("uretim"); });
        Ekle(no() + "_diyalog_tehlikeli_acik_1024.png", 1024, 768, false, () => { Uygula(Hazir(), IzinHazir()); Git("kalibrasyon"); Tehlikeli(); });
        Ekle(no() + "_takimlar_acik_1024.png", 1024, 768, false, () => { Uygula(Hazir(), IzinHazir()); Git("takimlar"); k.Takimlar.SekmeGoster(0); k.Takimlar.Sec("T2"); });
        Ekle(no() + "_kal_oto_adim4_acik_1024.png", 1024, 768, false, () => { var d = Hazir(); Oto(d, 3); Uygula(d, IzinHazir()); Git("kalibrasyon"); k.Kalibrasyon.Sayfa("oto"); });
        Ekle(no() + "_uretim_acik_1920.png", 1920, 1080, false, () => { Calisiyor(); Git("uretim"); });
        // Geçişli tema: zemin iş ilerledikçe maviden (0) yeşile (1) döner
        var G = TemaModu.Gecisli;
        Ekle(no() + "_uretim_gecisli_0_1024.png", 1024, 768, G, () => { var d = Hazir(); Uygula(d, IzinHazir()); Git("uretim"); });
        Ekle(no() + "_uretim_gecisli_50_1024.png", 1024, 768, G, () => { var d = Ornek(); d.Yuzde = 50; d.Satir = 34876; d.GecenSn = 33 * 60; d.KalanSn = 33 * 60; Uygula(d, IzinCalisiyor()); Git("uretim"); });
        Ekle(no() + "_uretim_gecisli_100_1024.png", 1024, 768, G, () => { var d = Bitti(); Uygula(d, IzinHazir()); Git("uretim"); });
        Ekle(no() + "_uretim_gecisli_64_1920.png", 1920, 1080, G, () => { Calisiyor(); Git("uretim"); });
        Ekle(no() + "_ayarlar_genel_gecisli_1024.png", 1024, 768, G, () => { var d = Ornek(); d.Yuzde = 30; d.Kiosk = true; d.Ayarlar["Tema"] = "gecisli"; Uygula(d, IzinCalisiyor()); Git("ayarlar.0"); });
        // Şafak: gece çiviti (0) → erik → şafak bakırı (1). %0'da HAZIRLIK (mor hap çivit zeminde), %92'de DURAKLATILDI (kehribar hap bakır zeminde)
        var S = TemaModu.Safak;
        // Frez ömrü sekmesi (yeni; sona eklendi, eski numaralar değişmesin)
        Func<Dictionary<string, string>> izinOmur = () => { var iz = IzinCalisiyor(); iz["frez.omur.sifirla:T1"] = "İş sürüyor ve bu iş T1'i kullanıyor: iş bitince sıfırlayın"; iz["frez.omur.sifirla:T2"] = "İş sürüyor ve bu iş T2'yi kullanıyor: iş bitince sıfırlayın"; iz["frez.omur.sifirla:T3"] = "İş sürüyor ve bu iş T3'ü kullanıyor: iş bitince sıfırlayın"; return iz; };
        Ekle(no() + "_uretim_safak_0_1024.png", 1024, 768, S, () => { var d = Hazir(); d.Durum = Durum.Hazirlik; d.DurumMetni = "Home gerekli"; d.HomeAlindi = false; Uygula(d, IzinHazir()); Git("uretim"); });
        Ekle(no() + "_uretim_safak_50_1024.png", 1024, 768, S, () => { var d = Ornek(); d.Yuzde = 50; d.Satir = 34876; d.GecenSn = 33 * 60; d.KalanSn = 33 * 60; Uygula(d, IzinCalisiyor()); Git("uretim"); });
        Ekle(no() + "_uretim_safak_100_1024.png", 1024, 768, S, () => { var d = Bitti(); Uygula(d, IzinHazir()); Git("uretim"); });
        Ekle(no() + "_uretim_safak_duraklatildi_92_1024.png", 1024, 768, S, () => { var d = Ornek(); d.Yuzde = 92; d.Durum = Durum.Duraklatildi; d.DurumMetni = "Duraklatıldı"; d.Satir = 64170; d.KalanSn = 5 * 60 + 17; d.SonMesaj = "İş duraklatıldı (satır 64 170). Devam için DEVAM."; d.SonMesajTuru = MesajTuru.Uyari; Uygula(d, IzinDuraklatildi()); Git("uretim"); });
        Ekle(no() + "_ayarlar_genel_safak_1024.png", 1024, 768, S, () => { var d = Ornek(); d.Yuzde = 70; d.Kiosk = true; d.Ayarlar["Tema"] = "safak"; Uygula(d, IzinCalisiyor()); Git("ayarlar.0"); });
        Ekle(no() + "_takimlar_frez_omru_koyu_1024.png", 1024, 768, true, () => { Uygula(Hazir(), IzinHazir()); Git("takimlar.omur"); });
        Ekle(no() + "_takimlar_frez_omru_calisirken_koyu_1920.png", 1920, 1080, true, () => { Uygula(Ornek(), izinOmur()); Git("takimlar.omur"); });
        Ekle(no() + "_takimlar_frez_omru_acik_1024.png", 1024, 768, false, () => { Uygula(Hazir(), IzinHazir()); Git("takimlar.omur"); });
        Ekle(no() + "_diyalog_frez_omru_uyari_koyu_1024.png", 1024, 768, true, () => { Uygula(Hazir(), IzinHazir()); Git("uretim"); Diyalog.Onay("Frez ömrü", "Bu işin kullandığı frez ömrünü doldurdu:\n\nT3 ömrünü doldurdu: 1043/1000 dk.\n\nFrezi değiştirip Takımlar › Frez ömrü › SIFIRLA · YENİ FREZ ile sıfırlayabilirsiniz.\n\nYine de başlatılsın mı?"); });
        // kaldığı yerden devam: senaryo 2 (kırık frez) ve devam kaydı satırı
        Ekle(no() + "_diyalog_devam_kirik_frez_koyu_1024.png", 1024, 768, true, () => { var d = Hazir(); d.Takim = 2; Uygula(d, IzinHazir()); Git("uretim"); Diyalog.Devam("ZY2_45", "T2 frezi KIRIK (boy 1.84 mm değişti, sınır 0.2 mm)\n2026-11-20 14:31:07  ·  iş satır 61 240'da durdu  ·  %88\nNerede kırıldığı bilinemediği için T2'nin bu işteki işi baştan kesilir: satır 34 702 (T2 takım değişimi).", 0, 2); });
        Ekle(no() + "_diyalog_freze_hatasi_koyu_1024.png", 1024, 768, true, () => { var d = Hazir(); d.Takim = 2; d.Durum = Durum.Alarm; d.DurumMetni = "Eding hatası"; Uygula(d, IzinHazir()); Git("uretim"); Diyalog.Hata("FREZE HATASI", "T2 frezesinin boyu iş sonrası ölçümde 1.84 mm değişmiş (izin verilen: 0.2 mm).\nFreze kırılmış, aşınmış ya da pensin içinde kaymış olabilir. Kazıma bir sonraki frezeye geçmeden durduruldu.\n\n1. ALARMI TEMİZLE'ye bas.\n2. Frezi tut, PENS AÇ ile kırık frezi çıkar (dikkat: iş milinde kırık T2).\n3. Yeni T2 frezini T2 yuvasına tak (otomatik mod).\n4. BAŞLAT → T2'NİN İŞİNİ BAŞTAN: nerede kırıldığı bilinemediği için T2'nin bu işteki işi, T2'nin takım değişiminden itibaren yeniden kesilir."); });
        Ekle(no() + "_uretim_devam_kaydi_koyu_1024.png", 1024, 768, true, () => { var d = Ornek(); d.DevamKaydi = "Son kayıt: satır 44 812 (14:31:07)"; Uygula(d, IzinCalisiyor()); Git("uretim"); });
    }

    static IEnumerable<Control> Tum(Control k)
    {
        foreach (Control c in k.Controls) { yield return c; foreach (var x in Tum(c)) yield return x; }
    }

    static void Git(string ekran)
    {
        if (ekran != "uretim" || k.Uretim.BuyukSimAcik) k.Uretim.BuyukSim(false);
        k.EkranGoster(ekran);
    }

    static void Tehlikeli()
    {
        Diyalog.TehlikeliOnay("G54 yazılacak",
            "Otomatik kalibrasyon sonucu makineye yazılacak. Önce G92 sıfırlanır (G92.1), sonra G54 ve #4002 güncellenir.",
            new[] { "G54 X=-53.307", "G54 Y=-37.166", "G54 A=0.000", "G54 B=0.000", "#4002=12.345" },
            new[] { "G54 X=-53.311", "G54 Y=-37.160", "G54 A=0.012", "G54 B=-0.008", "#4002=12.351" },
            "yedekler\\ayar_20261118_1432.txt");
    }

    static void Uygula(MakineDurumu d, Dictionary<string, string> neden)
    {
        k.IzinleriUygula(neden);
        k.Uygula(d);
    }

    static void Calisiyor() { Uygula(Ornek(), IzinCalisiyor()); }

    // ---------------------------------------------------------------- izin tabloları (örnek)
    static Dictionary<string, string> IzinCalisiyor()
    {
        var n = new Dictionary<string, string>();
        foreach (var c in new[] { "is.sec", "is.baslat", "takim.degistir", "temizlik", "home", "park", "blok.yeni", "frez.birak", "pens.ac", "pens.kapat",
                                  "yuva.*", "jog", "jog.basla", "konum.*", "eksen.yukari", "takim.olc", "takim.asinma", "takim.bosmu", "ismili.calistir", "kal.*",
                                  "yedek.yukle", "degisken.kaydet", "eding.yeniden", "frez.modu" })
            n[c] = "İş çalışırken kullanılamaz";
        n["mdi.gonder"] = "İş sürerken MDI kilitli";
        n["sistem.kapat"] = "İş sürüyor: yalnız DURAKLAT, DURDUR, ACİL STOP ve hız";
        n["kiosk.windows"] = "İş sürüyor: yalnız DURAKLAT, DURDUR, ACİL STOP ve hız";
        n["makine.reset"] = "Alarm yok";
        n["is.devam"] = "İş duraklatılmadı";
        return n;
    }
    static Dictionary<string, string> IzinDuraklatildi()
    {
        var n = IzinCalisiyor();
        n.Remove("is.devam"); n.Remove("is.durdur");
        n["is.duraklat"] = "İş zaten duraklatıldı";
        n["mdi.gonder"] = "İş duraklatılmışken MDI kilitli";
        return n;
    }
    static Dictionary<string, string> IzinAlarm()
    {
        var n = IzinCalisiyor();
        n.Remove("makine.reset");
        foreach (var c in new[] { "is.duraklat", "is.durdur", "is.devam", "hiz.*" }) n[c] = "Acil stop basılı";
        return n;
    }
    static Dictionary<string, string> IzinHazir()
    {
        var n = new Dictionary<string, string>();
        n["is.duraklat"] = "Çalışan iş yok";
        n["is.durdur"] = "Çalışan iş yok";
        n["is.devam"] = "Duraklatılmış iş yok";
        n["makine.reset"] = "Alarm yok";
        n["yuva.yaklas"] = "İş milinde frez var (T2)";
        n["hiz.*"] = "Çalışan iş yok";
        return n;
    }

    // ---------------------------------------------------------------- sahte veriler
    static MakineDurumu Ornek()
    {
        var d = new MakineDurumu();
        d.Durum = Durum.Calisiyor; d.DurumMetni = "Kazınıyor"; d.Bagli = true; d.Demo = true; d.HomeAlindi = true;
        d.MakineAdi = "DENTMILL-X5";
        d.X = -64.250; d.Y = -52.000; d.Z = -12.345; d.A = 23.000; d.B = 0.000;
        d.MX = -117.557; d.MY = -89.166; d.MZ = -12.345; d.MA = 23.000; d.MB = 0.000;
        d.Takim = 2; d.TakimAciklama = "Ø1.0 küre frez"; d.FrezModu = "OTOMATIK";
        d.Dosya = "ZY2_45.nc"; d.Blok = "#142"; d.Satir = 44812; d.ToplamSatir = 69751; d.Yuzde = 64.2; d.IsAktif = true;
        d.GecenSn = 42 * 60 + 10; d.KalanSn = 23 * 60 + 51; d.TahminiSn = 66 * 60; d.BitisSaati = "14:56";
        d.IsTakimlari = "T1 · T2 · T3";
        d.Hiz = 100;
        d.BlokDurum = "Blok 142 ✓ kazındı"; d.BlokSonrakiIsim = "143";
        d.SonMesaj = "T2 alındı, uzunluk ölçüldü (Δ 0.004 mm)"; d.SonMesajTuru = MesajTuru.Basari; d.SonMesajZamani = new DateTime(2026, 11, 18, 14, 31, 0);
        string[] ac = { "Ø2.0 küre", "Ø1.0 küre", "Ø0.6 küre", "Ø2.5 düz", "", "Ø1.0 düz" };
        double[] y = { -65.166, -45.166, -25.166, -5.166, 14.834, 34.834 };
        for (int i = 0; i < 6; i++)
            d.Yuvalar.Add(new YuvaBilgisi { Ad = "T" + (i + 1), Aciklama = ac[i], Kayitli = i != 2, Dolu = i != 4, IsMilinde = i == 1, X = -125.557, Y = y[i], Z = -46.9, ZVar = true, A = 0, B = 0, Uyari = i == 2 ? "AYARSIZ" : null });
        // frez ömrü: T2 (iş milinde) %91 kehribar, T3 %104 kırmızı, T5 ömür girilmedi, T8 "diğer"
        double[] dk = { 412.6, 912.0, 1043.0, 156.2, 37.5, 655.0 }, om = { 1200, 1000, 1000, 1500, 0, 1000 };
        string[] sf = { "02.11.2026 08:15", "21.10.2026 09:02", "04.10.2026 16:40", "14.11.2026 07:55", "", "28.10.2026 10:30" };
        for (int i = 0; i < 6; i++) d.FrezOmurleri.Add(new FrezOmruBilgisi(i + 1, dk[i], om[i], sf[i]));
        d.FrezOmurleri.Add(new FrezOmruBilgisi(8, 12.4, 0, ""));
        d.Yuvalar.Add(new YuvaBilgisi { Ad = "SENSÖR", Aciklama = "takım boyu", Kayitli = true, X = -125.557, Y = -100.2, A = 0, B = 0 });
        d.Yuvalar.Add(new YuvaBilgisi { Ad = "MANUEL", Aciklama = "değişim noktası", Kayitli = true, X = -64.25, Y = -52, Z = 0, ZVar = true });
        d.G54 = new[] { -53.307, -37.166, 0.0, 0.0, 0.0 };
        d.G92 = new[] { 0.0, 0.0, -0.512, 0.0, 0.0 };
        d.Param = new[] { -46.900, -40.000, 12.345, 50.0, -60.0, 0.05, 1.0 };
        d.DegiskenlerOkundu = true;
        d.UreticiFark = "Üreticiden fark: X −0.004  Y +0.006  A 0.000  B 0.000";
        d.RafOzeti = "Yuvalar: T1–T6 kayıtlı (T3 hariç) · Sensör ✓";
        d.SonYedek = "ayar_20261118_1432.txt";
        d.Ayarlar["SanalKlavye"] = "1"; d.Ayarlar["TamEkran"] = "1"; d.Ayarlar["WinBaslangic"] = "1"; d.Ayarlar["Koordinat"] = "0";
        d.Ayarlar["Dansci"] = "0"; d.Ayarlar["OtomatikHazirlik"] = "1"; d.Ayarlar["GeriSayim"] = "5"; d.Ayarlar["SadeTaraf"] = "9";
        d.Ayarlar["FrezModu"] = "OTOMATIK"; d.Ayarlar["ModSor"] = "0"; d.Ayarlar["BlokSor"] = "0"; d.Ayarlar["EdingGizli"] = "1"; d.Ayarlar["EdingSifirla"] = "0";
        d.Ayarlar["Uzak"] = "1"; d.Ayarlar["UzakKilit"] = "1"; d.Ayarlar["MakineAdi"] = "DENTMILL-X5"; d.Ayarlar["JogAdim"] = "0.1"; d.Ayarlar["JogHiz"] = "300";
        d.Ayarlar["KalT"] = "16.02"; d.Ayarlar["KalD"] = "2.00"; d.Ayarlar["OkT"] = "10.00"; d.Ayarlar["OkUc"] = "duz"; d.Ayarlar["OkUcD"] = "3.00"; d.Ayarlar["KalSA"] = "0"; d.Ayarlar["KalSB"] = "1"; d.Ayarlar["KalSY"] = "0";
        var t0 = new DateTime(2026, 11, 18, 13, 40, 0);
        string[] m = {
            "B|PANEL AÇILDI · PrimerMill 2 (demo)", "B|Eding klasörü: P:\\CNC", "S|Eding'e bağlanıldı (CPU5B)", "B|Makro sürümü 3 ✓", "U|Home alınmamış · geri sayım 5 sn",
            "S|Home tamam (42 sn)", "B|Dosya seçildi: ZY2_45.nc", "B|Kontrol: 69 751 satır · T1 T2 T3 · tahmini 1:06:00", "U|T3 konumu HENÜZ AYARLANMADI. Alırken kırılabilir.",
            "B|BAŞLAT · ZY2_45.nc", "S|T1 alındı, uzunluk ölçüldü (Δ 0.002 mm)", "B|%5", "B|%10", "B|%15", "B|%20", "U|Hız %110'a çıkarıldı",
            "B|%25", "B|%30", "B|%35", "H|EXTERR: hava basıncı düştü · iş duraklatıldı", "S|Hava basıncı geri geldi", "B|DEVAM", "B|%40", "B|%45", "B|%50",
            "S|T2 alındı, uzunluk ölçüldü (Δ 0.004 mm)", "B|%55", "B|%60", "B|Devam kaydı güncellendi (satır 44 812)" };
        for (int i = 0; i < m.Length; i++)
        {
            var p = m[i].Split(new[] { '|' }, 2);
            var tur = p[0] == "S" ? MesajTuru.Basari : p[0] == "U" ? MesajTuru.Uyari : p[0] == "H" ? MesajTuru.Hata : MesajTuru.Bilgi;
            d.Kayitlar.Add(new KayitSatiri(t0.AddSeconds(i * 107), tur, p[1]));
        }
        d.Teknik.Add(new BilgiSatiri("Eding durumu", "RUNNING · rc 0"));
        d.Teknik.Add(new BilgiSatiri("Home", "alındı ✓", MesajTuru.Basari));
        d.Teknik.Add(new BilgiSatiri("Takım", "T2 · Ø1.0 küre"));
        d.Teknik.Add(new BilgiSatiri("Acil stop", "kapalı"));
        d.Teknik.Add(new BilgiSatiri("Makro sürümü", "3 (macro.cnc)"));
        d.Teknik.Add(new BilgiSatiri("Ayarlı frezler", "T1 T2 T4 T5 T6"));
        d.Teknik.Add(new BilgiSatiri("Ayarsız", "T3", MesajTuru.Uyari));
        d.Teknik.Add(new BilgiSatiri("Satır / geçen / kalan", "44 812 · 0:42:10 · 0:23:51"));
        d.Teknik.Add(new BilgiSatiri("Log", "loglar\\Panel_2026-11-18_13-40.log"));
        d.Klasorler.Add(new BilgiSatiri("Eding", "P:\\CNC"));
        d.UzakAcik = true; d.UzakAdres = "http://192.168.1.40:8080"; d.UzakAdresler.Add("http://192.168.1.40:8080"); d.UzakAdresler.Add("http://10.0.0.12:8080");
        d.UzakPin = "4821"; d.UzakIzin = "sec"; d.UzakDurumMetni = "2 cihaz bağlı";
        d.UzakCihazlar.Add(new UzakCihaz("192.168.1.57 (telefon)", "14:30", "GET /api/durum"));
        d.UzakCihazlar.Add(new UzakCihaz("192.168.1.23 (ofis PC)", "14:12", "POST /api/yukle"));
        d.UzakCihazlar.Add(new UzakCihaz("192.168.1.57 (telefon)", "13:58", "POST /api/komut sec"));
        return d;
    }

    static MakineDurumu Hazir()
    {
        var d = Ornek();
        d.Durum = Durum.Hazir; d.DurumMetni = "Hazır"; d.Satir = 0; d.Yuzde = 0; d.GecenSn = 0; d.KalanSn = 0; d.BitisSaati = null; d.IsAktif = false;
        d.SonMesaj = "Makine hazır · ZY2_45.nc seçili"; d.SonMesajTuru = MesajTuru.Bilgi;
        return d;
    }

    /// <summary>İş bitti (IsTamamlandi, %100): Geçişli temada tam yeşil.</summary>
    static MakineDurumu Bitti()
    {
        var d = Ornek();
        d.Durum = Durum.Hazir; d.DurumMetni = "Hazır"; d.IsAktif = false; d.IsTamamlandi = true; d.Yuzde = 100;
        d.Satir = d.ToplamSatir; d.GecenSn = 65 * 60 + 40; d.KalanSn = 0;
        d.SonMesaj = "ZY2_45.nc tamamlandı · 1:05:40"; d.SonMesajTuru = MesajTuru.Basari;
        return d;
    }

    static void YuvaAyari(MakineDurumu d)
    {
        foreach (var y in d.Yuvalar)
        {
            if (y.Ad == "T1") { y.Yeni = "X -125.561  Y -65.160"; y.Fark = "ΔY +0.006"; }
            else if (y.Ad == "T2") { y.Yeni = "Y -45.159"; y.Fark = "ΔY +0.007"; }
            else if (y.Ad == "SENSÖR") { y.Yeni = "—"; y.Fark = "ölçülmedi"; }
        }
        d.YuvaOrtak = "A 0.000  B 0.000  alma Z -46.900  yaklaşma Z -40.000";
        d.YuvaKaydedilmemis = true;
    }

    static void Disk(MakineDurumu d, int adim)
    {
        d.DiskAdim = adim; d.DiskTestNo = 2;
        d.DiskYerlesim = "Test 2\nDış cepler, kenara yakın:\n  Ø5 saat 3   Ø8 saat 6\n  Ø7 saat 9   Ø4 saat 12\nİç grup, saat 4–5 arası:\n  Ø7 (A−20) · Ø6 Z cebi + 2 nokta\n  Ø8 (A+20)\n  pencere, Z cebinin arkasında\n\nDerinliği kumpasın derinlik ucuyla\ncebin ortasından ölçün.";
        d.DiskDurum = adim >= 1 ? "Test 2 programı hazır · Üretim'de BAŞLAT" : "";
        if (adim >= 2)
        {
            string[] k = { "w", "d1", "d2", "dR", "dL", "dF", "dK", "dAp", "dAm" };
            string[] v = { "4.012", "1.004", "0.998", "0.512", "0.505", "0.497", "0.509", "0.731", "0.722" };
            for (int i = 0; i < k.Length; i++) if (adim > 2 || i < 6) d.DiskOlcum[k[i]] = v[i];
        }
        if (adim >= 3)
        {
            d.DiskSonuc.Add(new KalSonucSatiri("X", "-53.307", "-0.006", "-53.313", true));
            d.DiskSonuc.Add(new KalSonucSatiri("Y", "-37.166", "+0.012", "-37.154", true));
            d.DiskSonuc.Add(new KalSonucSatiri("Z (#4002)", "12.345", "+0.031", "12.376", false));
            d.DiskSonuc.Add(new KalSonucSatiri("A", "0.000", "-0.040°", "-0.040", true));
            d.DiskSonuc.Add(new KalSonucSatiri("B", "0.000", "+0.020°", "0.020", true));
            d.DiskUyarilar.Add("Z düzeltmesi 0.02 mm sınırının üstünde: uyguladıktan sonra bir test daha kazıyın.");
            d.DiskUyarilar.Add("Disk ortası B ekseninden 0.03 mm kaçık (eğim 0.01°).");
            d.DiskSonucHazir = true;
        }
    }

    static void Oto(MakineDurumu d, int adim)
    {
        d.OtoAdim = adim;
        d.ProbTestAktif = adim == 1; d.ProbTemas = adim == 1; d.ProbGiris = "IN 7 (aktif düşük)";
        d.ProbTestGecti = adim >= 1;
        d.OtoDurum = adim == 2 ? "Program hazır: PM_kalibrasyon_otomatik.nc · Üretim'de BAŞLAT" : (adim >= 3 ? "Ölçüm bitti (kimlik 58213)" : "");
        d.OtoOlcumBitti = adim >= 3; d.OtoSonucHazir = adim >= 3;
        if (adim >= 3)
        {
            d.OtoSonuc.Add(new KalSonucSatiri("X", "-53.307", "-0.004", "-53.311", true));
            d.OtoSonuc.Add(new KalSonucSatiri("Y", "-37.166", "+0.006", "-37.160", true));
            d.OtoSonuc.Add(new KalSonucSatiri("Z (#4002)", "12.345", "+0.006", "12.351", true));
            d.OtoSonuc.Add(new KalSonucSatiri("A", "0.000", "+0.012°", "0.012", true));
            d.OtoSonuc.Add(new KalSonucSatiri("B", "0.000", "-0.008°", "-0.008", true));
            d.OtoKalite.Add(new KalKaliteSatiri("Tekrar (5 temas)", "0.002 mm", MesajTuru.Basari));
            d.OtoKalite.Add(new KalKaliteSatiri("Çift ölçüm farkı", "≤ 0.003 mm", MesajTuru.Basari));
            d.OtoKalite.Add(new KalKaliteSatiri("Model uyumu (RMS)", "0.004 mm", MesajTuru.Basari));
            d.OtoKalite.Add(new KalKaliteSatiri("En büyük artık", "0.012 mm", MesajTuru.Uyari));
            d.OtoKalite.Add(new KalKaliteSatiri("Açı ölçeği A / B", "%100.1 / %99.9", MesajTuru.Basari));
            d.OtoKalite.Add(new KalKaliteSatiri("Disk kaçıklığı", "0.03 mm", MesajTuru.Bilgi));
            d.OtoUyarilar.Add("Ölçümler modele tam uymuyor (>0.01 mm): bir noktada kir / çapak olabilir.");
        }
    }
}
