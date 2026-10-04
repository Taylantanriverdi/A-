using System.Net;
using System.Net.Mail;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;

namespace PrimerLabV2.Infrastructure;

/// <summary>
/// Portal doğrulama e-postaları (giriş kodu, kayıt onayı, şifre sıfırlama) SMTP ile gönderilir.
/// Gönderimler sınırlı bir kuyruğa alınır ve arka planda sırayla, dakika/gün sınırına uyularak
/// gönderilir: aynı anda yüzlerce başvuru gelse de istek beklemez, posta sağlayıcısı hesabı
/// (Gmail vb.) toplu gönderim nedeniyle kilitlenmez. Kuyruk doluysa veya günlük sınır
/// aşıldıysa yeni kod istenemez ("sistem yoğun").
/// SMTP parolası App_Data\Secrets\eposta-ayarlari.json içinde Windows veri koruması ile şifrelidir.
/// </summary>
public sealed class EpostaServisi : BackgroundService
{
    private const int KuyrukKapasitesi = 300;

    private readonly string _dosya;
    private readonly IDataProtector _koruma;
    private readonly ILogger<EpostaServisi> _log;
    private readonly object _kilit = new();
    // İki sıra: giriş kodları öncelikli gider; kayıt / şifre yenileme kodları ikinci sırada bekler.
    // Toplu (ör. sahte) kayıt başvurusu, gerçek kullanıcıların giriş kodunu geciktiremez.
    private readonly System.Collections.Concurrent.ConcurrentQueue<Ileti> _oncelikli = new();
    private readonly System.Collections.Concurrent.ConcurrentQueue<Ileti> _normal = new();
    private readonly SemaphoreSlim _sinyal = new(0);
    private static readonly JsonSerializerOptions JsonAyar = new() { WriteIndented = true };

    private int _bekleyen;
    private DateTime _gun = DateTime.Today;
    private int _bugunGonderilen;
    private readonly Queue<DateTime> _sonDakika = new();

    public EpostaServisi(IWebHostEnvironment env, IDataProtectionProvider dp, ILogger<EpostaServisi> log)
    {
        _dosya = Path.Combine(env.ContentRootPath, "App_Data", "Secrets", "eposta-ayarlari.json");
        _koruma = dp.CreateProtector("PrimerLab.Eposta.Smtp.v1");
        _log = log;
    }

    public sealed class Ayarlar
    {
        public string? Sunucu { get; set; }
        public int Port { get; set; } = 587;
        public bool Ssl { get; set; } = true;
        public string? Kullanici { get; set; }
        public string? SifreliParola { get; set; }
        public string? GonderenAdres { get; set; }
        public string GonderenAd { get; set; } = "Primer Dental Lab";
        public int DakikadaEnFazla { get; set; } = 20;
        public int GundeEnFazla { get; set; } = 450;
        public DateTime? SonBasari { get; set; }
        public string? SonHata { get; set; }
        public DateTime? SonHataTarihi { get; set; }
    }

    private sealed record Ileti(string Alici, string Konu, string Html);

    public Ayarlar Oku()
    {
        lock (_kilit)
        {
            try
            {
                return File.Exists(_dosya) ? JsonSerializer.Deserialize<Ayarlar>(File.ReadAllText(_dosya)) ?? new Ayarlar() : new Ayarlar();
            }
            catch (JsonException) { return new Ayarlar(); }
        }
    }

    private void Yaz(Ayarlar a)
    {
        lock (_kilit)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_dosya)!);
            var gecici = _dosya + ".tmp";
            File.WriteAllText(gecici, JsonSerializer.Serialize(a, JsonAyar));
            File.Move(gecici, _dosya, overwrite: true);
        }
    }

    public bool Hazir
    {
        get
        {
            var a = Oku();
            return !string.IsNullOrWhiteSpace(a.Sunucu) && !string.IsNullOrWhiteSpace(a.GonderenAdres) &&
                   !string.IsNullOrWhiteSpace(a.Kullanici) && !string.IsNullOrWhiteSpace(a.SifreliParola);
        }
    }

    /// <summary>Ayarları kaydeder; parola boşsa kayıtlı parola korunur.</summary>
    public void Kaydet(Ayarlar yeni, string? parola)
    {
        var a = Oku();
        a.Sunucu = yeni.Sunucu?.Trim();
        a.Port = yeni.Port is > 0 and < 65536 ? yeni.Port : 587;
        a.Ssl = yeni.Ssl;
        a.Kullanici = yeni.Kullanici?.Trim();
        a.GonderenAdres = string.IsNullOrWhiteSpace(yeni.GonderenAdres) ? a.Kullanici : yeni.GonderenAdres.Trim();
        a.GonderenAd = string.IsNullOrWhiteSpace(yeni.GonderenAd) ? "Primer Dental Lab" : yeni.GonderenAd.Trim();
        a.DakikadaEnFazla = Math.Clamp(yeni.DakikadaEnFazla, 1, 120);
        a.GundeEnFazla = Math.Clamp(yeni.GundeEnFazla, 10, 10_000);
        if (!string.IsNullOrEmpty(parola)) a.SifreliParola = _koruma.Protect(parola);
        Yaz(a);
    }

    public object Durum()
    {
        var a = Oku();
        lock (_sonDakika)
        {
            if (_gun != DateTime.Today) { _gun = DateTime.Today; _bugunGonderilen = 0; }
            return new
            {
                hazir = Hazir,
                sunucu = a.Sunucu,
                port = a.Port,
                ssl = a.Ssl,
                kullanici = a.Kullanici,
                parolaKayitli = !string.IsNullOrEmpty(a.SifreliParola),
                gonderenAdres = a.GonderenAdres,
                gonderenAd = a.GonderenAd,
                dakikadaEnFazla = a.DakikadaEnFazla,
                gundeEnFazla = a.GundeEnFazla,
                kuyrukta = Volatile.Read(ref _bekleyen),
                bugunGonderilen = _bugunGonderilen,
                sonBasari = a.SonBasari,
                sonHata = a.SonHata,
                sonHataTarihi = a.SonHataTarihi
            };
        }
    }

    /// <summary>
    /// İletiyi kuyruğa ekler. Kuyruk doluysa, günlük sınır dolduysa veya e-posta ayarı yoksa false.
    /// Öncelikli olmayan iletiler (kayıt, şifre yenileme) günlük sınırın ve kuyruğun en fazla
    /// %60'ını kullanabilir; kalan pay giriş kodlarına ayrılır.
    /// </summary>
    public bool KuyrugaEkle(string alici, string konu, string html, bool oncelikli = true)
    {
        if (!Hazir) return false;
        var a = Oku();
        lock (_sonDakika)
        {
            if (_gun != DateTime.Today) { _gun = DateTime.Today; _bugunGonderilen = 0; }
            var bekleyen = Volatile.Read(ref _bekleyen);
            var gunPayi = oncelikli ? a.GundeEnFazla : a.GundeEnFazla * 6 / 10;
            var kuyrukPayi = oncelikli ? KuyrukKapasitesi : KuyrukKapasitesi * 6 / 10;
            if (_bugunGonderilen + bekleyen >= gunPayi || bekleyen >= kuyrukPayi) return false;
            Interlocked.Increment(ref _bekleyen);
        }
        (oncelikli ? _oncelikli : _normal).Enqueue(new Ileti(alici, konu, html));
        _sinyal.Release();
        return true;
    }

    /// <summary>Kuyruğa girmeden hemen gönderir (yönetici "deneme e-postası").</summary>
    public async Task<string?> DenemeGonderAsync(string alici, CancellationToken ct)
    {
        if (!Hazir) return "E-posta ayarları eksik.";
        try
        {
            await GonderAsync(Oku(), new Ileti(alici, "Primer Lab deneme e-postası",
                Sablon("Deneme e-postası", "<p>Bu ileti geldiyse Primer Lab e-posta ayarları doğru çalışıyor.</p>")), ct);
            return null;
        }
        catch (Exception ex) when (ex is SmtpException or InvalidOperationException or FormatException or IOException or System.Security.Cryptography.CryptographicException)
        {
            return ex.InnerException?.Message is { } ic ? ex.Message + " (" + ic + ")" : ex.Message;
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            while (true)
            {
                await _sinyal.WaitAsync(stoppingToken);
                // Dakikalık sınır beklenirken öncelikli sıra sürekli kontrol edilir; kayıt / şifre
                // iletileri dakikalık sınırın en fazla %70'ini kullanır, kalanı giriş kodlarına kalır.
                Ileti? ileti = null;
                var a = Oku();
                while (ileti == null)
                {
                    a = Oku();
                    if (!_oncelikli.IsEmpty)
                    {
                        if (DakikaUygun(a.DakikadaEnFazla)) _oncelikli.TryDequeue(out ileti);
                    }
                    else if (!_normal.IsEmpty && DakikaUygun(Math.Max(1, a.DakikadaEnFazla * 7 / 10)))
                        _normal.TryDequeue(out ileti);
                    if (ileti == null) await Task.Delay(250, stoppingToken);
                }
                for (var deneme = 1; deneme <= 3; deneme++)
                {
                    try
                    {
                        await GonderAsync(a, ileti, stoppingToken);
                        lock (_sonDakika) { _bugunGonderilen++; _sonDakika.Enqueue(DateTime.UtcNow); }
                        a = Oku(); a.SonBasari = DateTime.UtcNow; Yaz(a);
                        break;
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        _log.LogWarning(ex, "Portal e-postası gönderilemedi ({Deneme}/3).", deneme);
                        a = Oku();
                        a.SonHata = ex.InnerException?.Message is { } ic ? ex.Message + " (" + ic + ")" : ex.Message;
                        a.SonHataTarihi = DateTime.UtcNow;
                        Yaz(a);
                        if (deneme < 3) await Task.Delay(TimeSpan.FromSeconds(5 * deneme), stoppingToken);
                    }
                }
                Interlocked.Decrement(ref _bekleyen);
            }
        }
        catch (OperationCanceledException) { }
    }

    private bool DakikaUygun(int sinir)
    {
        lock (_sonDakika)
        {
            while (_sonDakika.Count > 0 && DateTime.UtcNow - _sonDakika.Peek() > TimeSpan.FromMinutes(1)) _sonDakika.Dequeue();
            return _sonDakika.Count < sinir;
        }
    }

    private async Task GonderAsync(Ayarlar a, Ileti ileti, CancellationToken ct)
    {
        var parola = _koruma.Unprotect(a.SifreliParola!);
        using var smtp = new SmtpClient(a.Sunucu!, a.Port)
        {
            EnableSsl = a.Ssl,
            DeliveryMethod = SmtpDeliveryMethod.Network,
            UseDefaultCredentials = false,
            Credentials = new NetworkCredential(a.Kullanici, parola),
            Timeout = 30_000
        };
        using var mesaj = new MailMessage
        {
            From = new MailAddress(a.GonderenAdres!, a.GonderenAd),
            Subject = ileti.Konu,
            Body = ileti.Html,
            IsBodyHtml = true,
            BodyEncoding = System.Text.Encoding.UTF8,
            SubjectEncoding = System.Text.Encoding.UTF8
        };
        mesaj.To.Add(new MailAddress(ileti.Alici));
        await smtp.SendMailAsync(mesaj, ct);
    }

    public static string Sablon(string baslik, string govdeHtml) =>
        "<div style=\"font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#10233e\">" +
        "<div style=\"font-size:13px;font-weight:bold;color:#64748b;letter-spacing:.5px\">PRIMER DENTAL LAB</div>" +
        "<h2 style=\"margin:8px 0 14px\">" + WebUtility.HtmlEncode(baslik) + "</h2>" + govdeHtml +
        "<p style=\"font-size:12px;color:#64748b;margin-top:22px\">Bu işlemi siz yapmadıysanız bu e-postayı dikkate almayın; kodu kimseyle paylaşmayın.</p></div>";
}
