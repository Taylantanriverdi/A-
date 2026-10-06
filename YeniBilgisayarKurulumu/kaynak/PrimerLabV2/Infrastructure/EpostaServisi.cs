using System.Net;
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
        a.GonderenAd = string.IsNullOrWhiteSpace(yeni.GonderenAd) ? FirmaServisi.VarsayilanAd : yeni.GonderenAd.Trim();
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
    public async Task<(bool Basarili, string Mesaj)> DenemeGonderAsync(string alici, CancellationToken ct)
    {
        if (!Hazir) return (false, "E-posta ayarları eksik.");
        try
        {
            var portDegisti = await GonderAsync(Oku(), new Ileti(alici, "Primer Lab deneme e-postası",
                Sablon("Deneme e-postası", "<p>Bu ileti geldiyse Primer Lab e-posta ayarları doğru çalışıyor.</p>")), ct);
            var a = Oku(); a.SonBasari = DateTime.UtcNow; a.SonHata = null; Yaz(a);
            return (true, "Deneme e-postası gönderildi: " + alici +
                          (portDegisti ? ". 587 numaralı port bu bilgisayarda engelli olduğu için 465 (SSL) ile gönderildi; ayar 465 olarak kaydedildi." : ""));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            var mesaj = Aciklama(ex);
            var a = Oku(); a.SonHata = mesaj; a.SonHataTarihi = DateTime.UtcNow; Yaz(a);
            return (false, mesaj);
        }
    }

    /// <summary>Teknik hatayı yöneticinin anlayacağı açıklamaya çevirir.</summary>
    public static string Aciklama(Exception ex)
    {
        var teknik = ex.Message + (ex.InnerException != null ? " (" + ex.InnerException.Message + ")" : "");
        return ex switch
        {
            MailKit.Security.AuthenticationException =>
                "E-posta adresi veya uygulama şifresi kabul edilmedi. Gmail'de normal şifre çalışmaz: Google Hesabı → Güvenlik → 2 Adımlı Doğrulama açık olmalı, " +
                "\"Uygulama şifreleri\"nden oluşturulan 16 haneli şifreyi yazın. [" + teknik + "]",
            MailKit.Security.SslHandshakeException =>
                "Şifreli bağlantı kurulamadı. Bilgisayardaki antivirüsün \"e-posta tarama / posta kalkanı\" özelliği bağlantıya karışıyor olabilir; " +
                "o özelliği kapatıp tekrar deneyin. [" + teknik + "]",
            System.Net.Sockets.SocketException or IOException or MailKit.ProtocolException or MailKit.Net.Smtp.SmtpProtocolException or TimeoutException =>
                "E-posta sunucusuna bağlanılamadı ya da bağlantı kesildi (587 ve 465 portları denendi). Genellikle antivirüsün \"e-posta kalkanı\" ya da güvenlik duvarı " +
                "giden e-postayı engeller: antivirüste e-posta taramasını kapatıp, PrimerLab'a güvenlik duvarında izin verip tekrar deneyin. [" + teknik + "]",
            MailKit.Net.Smtp.SmtpCommandException sc =>
                "E-posta sunucusu iletiyi kabul etmedi (" + sc.StatusCode + "). " + teknik,
            _ => teknik
        };
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
                        a.SonHata = Aciklama(ex);
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

    // MailKit ile gönderir. Şifreli 587 (STARTTLS) bağlantısı kesilirse 465 (doğrudan SSL) denenir;
    // çalışırsa ayar 465 olarak kaydedilir (bazı antivirüs/ağlar 587'yi keser). Port değiştiyse true.
    private async Task<bool> GonderAsync(Ayarlar a, Ileti ileti, CancellationToken ct)
    {
        try
        {
            await TekGonder(a, a.Port, ileti, ct);
            return false;
        }
        catch (Exception ex) when (a.Ssl && a.Port == 587 && BaglantiHatasi(ex))
        {
            _log.LogWarning(ex, "587 ile gönderilemedi, 465 (SSL) deneniyor.");
            await TekGonder(a, 465, ileti, ct);
            var y = Oku(); y.Port = 465; Yaz(y);
            return true;
        }
    }

    private static bool BaglantiHatasi(Exception ex) =>
        ex is System.Net.Sockets.SocketException or IOException or MailKit.Security.SslHandshakeException
            or MailKit.Net.Smtp.SmtpProtocolException or TimeoutException;

    private async Task TekGonder(Ayarlar a, int port, Ileti ileti, CancellationToken ct)
    {
        var parola = _koruma.Unprotect(a.SifreliParola!);
        var mesaj = new MimeKit.MimeMessage();
        // Gönderen adı varsayılan bırakıldıysa Firma Bilgileri'ndeki firma adı kullanılır.
        var gonderenAd = string.IsNullOrWhiteSpace(a.GonderenAd) || a.GonderenAd == FirmaServisi.VarsayilanAd
            ? FirmaServisi.Ornek?.Ad ?? FirmaServisi.VarsayilanAd : a.GonderenAd;
        mesaj.From.Add(new MimeKit.MailboxAddress(gonderenAd, a.GonderenAdres));
        mesaj.To.Add(MimeKit.MailboxAddress.Parse(ileti.Alici));
        mesaj.Subject = ileti.Konu;
        mesaj.Body = new MimeKit.TextPart(MimeKit.Text.TextFormat.Html) { Text = ileti.Html };

        using var smtp = new MailKit.Net.Smtp.SmtpClient { Timeout = 30_000 };
        var guvenlik = !a.Ssl ? MailKit.Security.SecureSocketOptions.None
            : port == 465 ? MailKit.Security.SecureSocketOptions.SslOnConnect
            : MailKit.Security.SecureSocketOptions.StartTls;
        await smtp.ConnectAsync(a.Sunucu!, port, guvenlik, ct);
        await smtp.AuthenticateAsync(a.Kullanici, parola, ct);
        await smtp.SendAsync(mesaj, ct);
        await smtp.DisconnectAsync(true, ct);
    }

    public static string Sablon(string baslik, string govdeHtml) =>
        "<div style=\"font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#10233e\">" +
        "<div style=\"font-size:13px;font-weight:bold;color:#64748b;letter-spacing:.5px\">" +
        WebUtility.HtmlEncode(FirmaServisi.Ornek?.Ad ?? FirmaServisi.VarsayilanAd) + "</div>" +
        "<h2 style=\"margin:8px 0 14px\">" + WebUtility.HtmlEncode(baslik) + "</h2>" + govdeHtml +
        "<p style=\"font-size:12px;color:#64748b;margin-top:22px\">Bu işlemi siz yapmadıysanız bu e-postayı dikkate almayın; kodu kimseyle paylaşmayın.</p>" +
        (string.IsNullOrEmpty(FirmaServisi.Ornek?.IletisimSatiri()) ? "" :
            "<p style=\"font-size:11px;color:#94a3b8;margin-top:10px\">" + WebUtility.HtmlEncode(FirmaServisi.Ornek!.IletisimSatiri()) + "</p>") + "</div>";
}
