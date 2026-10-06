using System.Collections.Concurrent;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PrimerLabV2.Infrastructure;

/// <summary>
/// Yazıcı istasyonunu kullanıcıya bırakmadan açık tutar: otomatik yazdırma açıkken istasyon
/// penceresinden sinyal gelmiyorsa Edge'i (yoksa Chrome) sessiz yazdırma kipinde kendisi açar.
/// Pencere tek kullanımlık bir anahtarla oturum açar; yönetici şifresi sorulmaz.
/// Program, Primer Lab_Baslat ile kullanıcı oturumunda çalıştığı için pencere masaüstünde açılır.
/// </summary>
public sealed class YaziciIstasyonuServisi : BackgroundService
{
    public const string Adres = "http://localhost:5169";
    /// <summary>Yalnız sessiz yazdırma profiline konur; normal tarayıcıda açılan sekme iş almaz (yazdırma penceresi çıkmasın).</summary>
    public const string CerezAdi = "primer_istasyon";

    public static void IstasyonIsaretle(HttpContext ctx) =>
        ctx.Response.Cookies.Append(CerezAdi, "1", new CookieOptions
        {
            HttpOnly = true, SameSite = SameSiteMode.Lax, IsEssential = true, Path = "/",
            Secure = ctx.Request.IsHttps, Expires = DateTimeOffset.UtcNow.AddYears(5)
        });

    public static bool IstasyonMu(HttpContext ctx) => ctx.Request.Cookies.ContainsKey(CerezAdi);
    private static readonly TimeSpan Bekleme = TimeSpan.FromSeconds(90);
    private static readonly TimeSpan UzunBekleme = TimeSpan.FromMinutes(15);

    private readonly OtomatikYazdirma _oy;
    private readonly ILogger<YaziciIstasyonuServisi> _log;
    private readonly string _profil;
    private readonly ConcurrentDictionary<string, DateTime> _jetonlar = new();
    private readonly object _kilit = new();
    private DateTime _sonBaslatma = DateTime.MinValue;
    private int _sonucsuzDeneme;
    // "Yazıcı ayarını elle yap" penceresi açıkken (sessiz olmayan kip) istasyon kendiliğinden açılmaz.
    private DateTime _ayarKipiBitis = DateTime.MinValue;
    private bool _ayarKipiKapatilacak;

    /// <summary>Sunucu her açıldığında değişir; istasyon sayfası güncellemeden sonra kendini yeniler.</summary>
    public static readonly string Surum = Environment.ProcessId + "-" + DateTime.UtcNow.Ticks;

    public YaziciIstasyonuServisi(OtomatikYazdirma oy, IWebHostEnvironment env, ILogger<YaziciIstasyonuServisi> log)
    {
        _oy = oy;
        _log = log;
        // C:\PrimerLab\Uygulama -> C:\PrimerLab\YaziciIstasyonu (betikteki profille aynı).
        _profil = Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "YaziciIstasyonu"));
    }

    /// <summary>Son başlatma denemesinin hatası (ekranda gösterilir).</summary>
    public string? SonHata { get; private set; }

    /// <summary>Tek kullanımlık, 3 dakika geçerli giriş anahtarını doğrular ve harcar.</summary>
    public bool JetonKullan(string? jeton)
    {
        if (string.IsNullOrEmpty(jeton)) return false;
        foreach (var k in _jetonlar.Where(x => DateTime.UtcNow - x.Value > TimeSpan.FromMinutes(3)).Select(x => x.Key).ToList())
            _jetonlar.TryRemove(k, out _);
        return _jetonlar.TryRemove(jeton, out _);
    }

    public static string? TarayiciBul()
    {
        var ozel = Environment.GetEnvironmentVariable("PRIMERLAB_ISTASYON_TARAYICI");
        if (!string.IsNullOrWhiteSpace(ozel) && File.Exists(ozel)) return ozel;
        if (!OperatingSystem.IsWindows()) return null;
        string[] kokler =
        {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
        };
        foreach (var yol in new[] { @"Microsoft\Edge\Application\msedge.exe", @"Google\Chrome\Application\chrome.exe" })
            foreach (var kok in kokler.Where(k => !string.IsNullOrEmpty(k)))
            {
                var tam = Path.Combine(kok, yol);
                if (File.Exists(tam)) return tam;
            }
        return null;
    }

    /// <summary>Az önce açılmış (henüz bağlanmamış) bir pencere yoksa istasyonu açar.</summary>
    public void BaslatGerekirse()
    {
        if (DateTime.UtcNow - _sonBaslatma > TimeSpan.FromSeconds(60)) Baslat();
    }

    /// <summary>
    /// Edge/Chrome sessiz yazdırmada yazdırma penceresinin son kullanılan ("yapışkan") ayarlarını uygular.
    /// Elle yazdırmadaki "Renk: Siyah-beyaz" ve "Arka plan grafikleri" seçimleri burada profile yazılır;
    /// böylece otomatik baskı elle baskıyla aynı çıkar. Profildeki diğer seçimler (kâğıt, yazıcı) korunur.
    /// Tarayıcı kapalıyken yazılmalıdır (açıkken kapanışta üzerine yazar).
    /// </summary>
    private void TercihleriYaz()
    {
        try
        {
            var renksiz = _oy.Oku().Renksiz;
            var klasor = Path.Combine(_profil, "Default");
            Directory.CreateDirectory(klasor);
            var dosya = Path.Combine(klasor, "Preferences");
            JsonObject kok;
            try { kok = File.Exists(dosya) ? JsonNode.Parse(File.ReadAllText(dosya)) as JsonObject ?? new JsonObject() : new JsonObject(); }
            catch (JsonException) { kok = new JsonObject(); }
            var yazdirma = kok["printing"] as JsonObject ?? new JsonObject();
            kok["printing"] = yazdirma;
            var yapiskan = yazdirma["print_preview_sticky_settings"] as JsonObject ?? new JsonObject();
            yazdirma["print_preview_sticky_settings"] = yapiskan;
            JsonObject durum;
            try { durum = JsonNode.Parse(yapiskan["appState"]?.GetValue<string>() ?? "{}") as JsonObject ?? new JsonObject(); }
            catch (Exception) { durum = new JsonObject(); }
            durum["version"] = 2;
            durum["isColorEnabled"] = !renksiz;
            durum["isCssBackgroundEnabled"] = true;
            durum["isHeaderFooterEnabled"] = false;
            durum["isLandscapeEnabled"] = false;
            // Kâğıt: A5 (form A5 olarak tasarlandı; elle baskıdaki gibi kâğıdı doldurur). Windows'ta A5 = 11.
            durum["mediaSize"] = new JsonObject
            {
                ["name"] = "ISO_A5", ["custom_display_name"] = "A5", ["vendor_id"] = "11",
                ["width_microns"] = 148000, ["height_microns"] = 210000, ["is_default"] = false
            };
            durum["scalingType"] = 0;      // varsayılan ölçek (%100)
            durum["scaling"] = "100";
            durum["marginsType"] = 0;      // varsayılan kenar boşluğu (sayfa CSS'i belirler)
            yapiskan["appState"] = durum.ToJsonString();
            File.WriteAllText(dosya, kok.ToJsonString());
        }
        catch (Exception ex) { _log.LogWarning(ex, "Yazıcı istasyonu yazdırma tercihleri yazılamadı."); }
    }

    /// <summary>İstasyon profiliyle açık tarayıcı pencerelerini kapatır (yalnız Windows).</summary>
    public void Kapat()
    {
        if (!OperatingSystem.IsWindows()) return;
        try
        {
            var psi = new ProcessStartInfo("powershell") { UseShellExecute = false, CreateNoWindow = true };
            foreach (var a in new[] { "-NoProfile", "-Command",
                "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' or Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*" +
                _profil.Replace("'", "''") + "*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" })
                psi.ArgumentList.Add(a);
            using var p = Process.Start(psi);
            p?.WaitForExit(15000);
            Thread.Sleep(1500);
        }
        catch (Exception ex) { _log.LogWarning(ex, "Yazıcı istasyonu kapatılamadı."); }
    }

    /// <summary>Ayar değişince istasyon kapatılıp yeni ayarlarla açılır.</summary>
    public string? YenidenBaslat()
    {
        Kapat();
        return Baslat();
    }

    /// <summary>
    /// Yedek yol: istasyon profili sessiz olmayan kipte açılır; kullanıcı deneme baskısında yazdırma
    /// penceresinden Siyah-beyaz / A5 / Arka plan grafikleri seçer. Seçimler profilde kalır ve
    /// sessiz baskı da bunları kullanır.
    /// </summary>
    public string? AyarKipiBaslat()
    {
        Kapat();
        _ayarKipiBitis = DateTime.UtcNow.AddMinutes(10);
        _ayarKipiKapatilacak = true;
        return Baslat(ayarKipi: true);
    }

    public void AyarKipiBitti()
    {
        _ayarKipiBitis = DateTime.UtcNow;
        // Sessiz istasyon yaklaşık 20 sn sonra açılır (ayar penceresi kapanıp tercihler kaydedilsin).
        _sonBaslatma = DateTime.UtcNow - Bekleme + TimeSpan.FromSeconds(20);
    }

    /// <summary>İstasyon penceresini açar. Hata varsa açıklamasını döner.</summary>
    public string? Baslat(bool ayarKipi = false)
    {
        lock (_kilit)
        {
            var tarayici = TarayiciBul();
            if (tarayici == null)
                return SonHata = OperatingSystem.IsWindows()
                    ? "Microsoft Edge veya Google Chrome bulunamadı; istasyon açılamadı."
                    : "Yazıcı istasyonu yalnız Windows'ta otomatik açılabilir.";
            var jeton = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
            _jetonlar[jeton] = DateTime.UtcNow;
            try
            {
                Directory.CreateDirectory(_profil);
                TercihleriYaz();
                var psi = new ProcessStartInfo(tarayici) { UseShellExecute = false };
                if (!ayarKipi) psi.ArgumentList.Add("--kiosk-printing");
                foreach (var a in new[]
                {
                    "--user-data-dir=" + _profil,
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--disable-background-timer-throttling",
                    "--disable-renderer-backgrounding",
                    "--disable-backgrounding-occluded-windows",
                    "--hide-crash-restore-bubble",
                    // Dar pencerede form mobil düzene geçmesin.
                    "--window-size=1400,1000",
                    "--window-position=30,30",
                    "--disable-session-crashed-bubble",
                    "--app=" + Adres + "/api/yonetici-giris/istasyon?jeton=" + jeton + (ayarKipi ? "&kip=ayar" : "")
                }) psi.ArgumentList.Add(a);
                using var _ = Process.Start(psi);
                _sonBaslatma = DateTime.UtcNow;
                SonHata = null;
                _log.LogInformation("Yazıcı istasyonu açıldı ({Tarayici}).", tarayici);
                return null;
            }
            catch (Exception ex)
            {
                _jetonlar.TryRemove(jeton, out _);
                _log.LogWarning(ex, "Yazıcı istasyonu açılamadı.");
                return SonHata = "İstasyon açılamadı: " + ex.Message;
            }
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken); } catch (OperationCanceledException) { return; }
        while (!stoppingToken.IsCancellationRequested)
        {
            try { Denetle(); }
            catch (Exception ex) { _log.LogWarning(ex, "Yazıcı istasyonu denetimi başarısız."); }
            try { await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken); } catch (OperationCanceledException) { return; }
        }
    }

    private void Denetle()
    {
        if (DateTime.UtcNow < _ayarKipiBitis) return;
        var a = _oy.Oku();
        var durum = _oy.IstasyonDurumu();
        // Sinyal 45 sn içindeyse istasyon çalışıyor.
        if (durum.Son != null && DateTime.UtcNow - durum.Son < TimeSpan.FromSeconds(45))
        {
            if (durum.Son > _sonBaslatma) { _sonucsuzDeneme = 0; SonHata = null; }
            return;
        }
        if (!a.Aktif || TarayiciBul() == null) return;
        // Açılan pencere hiç bağlanamıyorsa sürekli yeni pencere açılmasın: 3 denemeden sonra seyrekleşir.
        var bekle = _sonucsuzDeneme >= 3 ? UzunBekleme : Bekleme;
        if (DateTime.UtcNow - _sonBaslatma < bekle) return;
        _sonucsuzDeneme++;
        // Ayar penceresi hâlâ açıksa kapatılır; yoksa yeni pencere sessiz olmayan kipe katılırdı.
        if (_ayarKipiKapatilacak) { _ayarKipiKapatilacak = false; Kapat(); }
        Baslat();
        if (_sonucsuzDeneme >= 3 && SonHata == null)
            SonHata = "İstasyon penceresi açıldı ama bağlanamadı. Masaüstündeki \"Primer Lab Yazici Istasyonu\" kısayolunu deneyin.";
    }
}
