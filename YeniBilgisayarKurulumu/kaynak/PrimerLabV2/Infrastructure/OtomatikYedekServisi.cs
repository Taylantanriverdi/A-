using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using PrimerLabV2.Controllers;
using PrimerLabV2.Data;

namespace PrimerLabV2.Infrastructure;

/// <summary>
/// Otomatik yedek: her gün belirlenen saatte (bilgisayar o saatte kapalıysa açıldıktan sonra)
/// tam veritabanı yedeği alır. Yedek, Ayarlar > Yedekten Geri Yükle ile açılabilen JSON
/// biçimindedir. Varsayılan klasör C:\PrimerLab\Yedekler\Otomatik; son N yedek saklanır.
/// İsteğe bağlı ikinci klasör (USB disk, OneDrive vb.) — yedek oraya da kopyalanır,
/// istenirse iş dosyaları (taramalar/tasarımlar) da yalnız yeni/değişenler kopyalanarak eşitlenir.
/// </summary>
public sealed class OtomatikYedekServisi : BackgroundService
{
    private static readonly Regex AdDeseni = new(@"^PrimerLab_OtomatikYedek_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$", RegexOptions.Compiled);
    private static readonly JsonSerializerOptions JsonAyar = new() { WriteIndented = true };

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<OtomatikYedekServisi> _log;
    private readonly SemaphoreSlim _calisiyor = new(1, 1);
    private readonly object _kilit = new();

    public OtomatikYedekServisi(IServiceScopeFactory scopeFactory, IWebHostEnvironment env, ILogger<OtomatikYedekServisi> log)
    {
        _scopeFactory = scopeFactory;
        _env = env;
        _log = log;
    }

    public sealed class Ayarlar
    {
        public bool Aktif { get; set; } = true;
        public int Saat { get; set; } = 2;
        public int Saklanacak { get; set; } = 30;
        public string? EkKlasor { get; set; }
        public bool DosyalariDaYedekle { get; set; }
        public DateTime? SonYedek { get; set; }
        public string? SonDurum { get; set; }
        public bool SonBasarili { get; set; } = true;
    }

    private string AyarDosyasi => Path.Combine(_env.ContentRootPath, "App_Data", "otomatik-yedek.json");

    public string AnaKlasor => Path.GetFullPath(Path.Combine(_env.ContentRootPath, "..", "Yedekler", "Otomatik"));

    public Ayarlar AyarlariOku()
    {
        lock (_kilit)
        {
            try
            {
                return File.Exists(AyarDosyasi)
                    ? JsonSerializer.Deserialize<Ayarlar>(File.ReadAllText(AyarDosyasi)) ?? new Ayarlar()
                    : new Ayarlar();
            }
            catch (JsonException) { return new Ayarlar(); }
        }
    }

    public void AyarlariYaz(Ayarlar a)
    {
        lock (_kilit)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(AyarDosyasi)!);
            var gecici = AyarDosyasi + ".tmp";
            File.WriteAllText(gecici, JsonSerializer.Serialize(a, JsonAyar));
            File.Move(gecici, AyarDosyasi, overwrite: true);
        }
    }

    public IEnumerable<FileInfo> Yedekler() =>
        Directory.Exists(AnaKlasor)
            ? new DirectoryInfo(AnaKlasor).GetFiles("PrimerLab_OtomatikYedek_*.json")
                .Where(f => AdDeseni.IsMatch(f.Name)).OrderByDescending(f => f.Name)
            : Enumerable.Empty<FileInfo>();

    public static bool GecerliAd(string ad) => AdDeseni.IsMatch(ad);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Program açılırken veritabanı hazır olsun diye biraz beklenir.
        try { await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken); } catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var a = AyarlariOku();
                if (a.Aktif && Zamani(a)) await YedekAlAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _log.LogError(ex, "Otomatik yedek kontrolü başarısız.");
            }

            try { await Task.Delay(TimeSpan.FromMinutes(10), stoppingToken); } catch (OperationCanceledException) { return; }
        }
    }

    // Bugünün yedek saati geçtiyse ve bugün (yerel saat) yedek alınmadıysa; ya da son yedek 26 saatten eskiyse.
    private static bool Zamani(Ayarlar a)
    {
        var simdi = DateTime.Now;
        var son = a.SonYedek?.ToLocalTime();
        if (son == null) return true;
        if ((simdi - son.Value).TotalHours >= 26) return true;
        return simdi.Hour >= a.Saat && son.Value.Date < simdi.Date;
    }

    /// <summary>Yedeği hemen alır. Aynı anda ikinci yedek başlatılmaz.</summary>
    public async Task<(bool Basarili, string Mesaj)> YedekAlAsync(CancellationToken ct)
    {
        if (!await _calisiyor.WaitAsync(0, ct)) return (false, "Şu anda zaten bir yedek alınıyor.");
        var a = AyarlariOku();
        try
        {
            Directory.CreateDirectory(AnaKlasor);
            var ad = $"PrimerLab_OtomatikYedek_{DateTime.Now:yyyy-MM-dd_HH-mm-ss}.json";
            var yol = Path.Combine(AnaKlasor, ad);

            using (var scope = _scopeFactory.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<PrimerLabDbContext>();
                var belge = await BackupController.YedekBelgesiOlustur(db);
                var gecici = yol + ".tmp";
                await File.WriteAllTextAsync(gecici, belge.ToJsonString(JsonAyar), new UTF8Encoding(false), ct);
                File.Move(gecici, yol);
            }
            Temizle(AnaKlasor, a.Saklanacak);

            var ek = "";
            if (!string.IsNullOrWhiteSpace(a.EkKlasor))
            {
                try
                {
                    var hedef = Path.Combine(a.EkKlasor, "PrimerLab_Yedekler");
                    Directory.CreateDirectory(hedef);
                    File.Copy(yol, Path.Combine(hedef, ad), overwrite: true);
                    Temizle(hedef, a.Saklanacak);
                    if (a.DosyalariDaYedekle)
                    {
                        var adet = DosyalariEsitle(Path.Combine(_env.ContentRootPath, "App_Data", "IsDosyalari"), Path.Combine(hedef, "IsDosyalari"), ct);
                        ek = $" İkinci klasöre de kopyalandı; {adet} yeni/değişen iş dosyası eşitlendi.";
                    }
                    else ek = " İkinci klasöre de kopyalandı.";
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    ek = " UYARI: İkinci klasöre kopyalanamadı (" + ex.Message + ").";
                }
            }

            var boyut = new FileInfo(yol).Length / 1048576.0;
            a.SonYedek = DateTime.UtcNow;
            a.SonBasarili = !ek.Contains("UYARI");
            a.SonDurum = $"{ad} ({boyut:0.0} MB) alındı.{ek}";
            AyarlariYaz(a);
            _log.LogInformation("Otomatik yedek alındı: {Yol}", yol);
            return (true, a.SonDurum);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _log.LogError(ex, "Otomatik yedek alınamadı.");
            a.SonBasarili = false;
            a.SonDurum = "Yedek alınamadı: " + ex.Message;
            // Hata halinde kısa süre sonra tekrar denenmesi için SonYedek güncellenmez.
            AyarlariYaz(a);
            return (false, a.SonDurum);
        }
        finally
        {
            _calisiyor.Release();
        }
    }

    private static void Temizle(string klasor, int saklanacak)
    {
        var fazla = new DirectoryInfo(klasor).GetFiles("PrimerLab_OtomatikYedek_*.json")
            .Where(f => AdDeseni.IsMatch(f.Name))
            .OrderByDescending(f => f.Name)
            .Skip(Math.Max(1, saklanacak));
        foreach (var f in fazla)
        {
            try { f.Delete(); } catch (IOException) { }
        }
    }

    // Yalnız yeni veya boyutu/tarihi değişen dosyalar kopyalanır; hedefte hiçbir şey silinmez.
    private static int DosyalariEsitle(string kaynak, string hedef, CancellationToken ct)
    {
        if (!Directory.Exists(kaynak)) return 0;
        var adet = 0;
        foreach (var dosya in Directory.EnumerateFiles(kaynak, "*", SearchOption.AllDirectories))
        {
            ct.ThrowIfCancellationRequested();
            var goreli = Path.GetRelativePath(kaynak, dosya);
            var h = Path.Combine(hedef, goreli);
            var ki = new FileInfo(dosya);
            var hi = new FileInfo(h);
            if (hi.Exists && hi.Length == ki.Length && hi.LastWriteTimeUtc >= ki.LastWriteTimeUtc) continue;
            Directory.CreateDirectory(Path.GetDirectoryName(h)!);
            File.Copy(dosya, h, overwrite: true);
            adet++;
        }
        return adet;
    }
}
