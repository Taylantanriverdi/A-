using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;
using PrimerLabV2.Infrastructure;

namespace PrimerLabV2.Controllers;

// Teknisyen Paneli (/teknisyen): teknisyen kendi hesabıyla girer, yalnız kendisine atanmış
// onaylı işleri görür; durum günceller, tarama dosyalarını indirir, tasarım dosyası yükler
// ve iş bazında laboratuvar/hekim ile yazışır. Fiyat bilgisi gönderilmez.
// Dış teknisyen: işi önce "Kabul Et"meli (kabul etmeden dosya indiremez ve durum değiştiremez),
// hekim adını yalnız baş harfleriyle görür.
[ApiController]
[Route("api/teknisyen-portal")]
public sealed class TeknisyenPortalController : ControllerBase
{
    private const string CookieName = "primer_teknisyen";
    private const long MaxFileSize = 250L * 1024L * 1024L;
    private const string KabulOnEki = "Teknisyen kabul etti";
    private const string TeslimOnEki = "Tasarım teslim edildi";

    private static readonly Regex UsernameRegex =
        new("^[a-zA-Z0-9._-]{3,64}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".stl", ".obj", ".ply", ".dcm", ".zip", ".rar", ".7z", ".pdf",
        ".jpg", ".jpeg", ".png", ".webp", ".txt",
        ".xml", ".3ox", ".3oxz", ".dentalproject", ".constructioninfo"
    };

    // Teknisyenin seçebileceği durumlar. "Tamamlandı"yı laboratuvar (admin) onaylar.
    // İş akışı: teknisyen taramayı indirir, tasarlar, tasarımı yükleyip laboratuvara teslim eder;
    // üretime alma laboratuvarın (admin) işidir. Dış teknisyen yalnız tasarım aşamalarını değiştirir;
    // iç teknisyen (laboratuvar kadrosu) üretim aşamalarını da yürütebilir.
    private static readonly string[] IcTeknisyenDurumlari =
        { "Bekliyor", "Tasarımda", "Üretimde", "Makyajda", "Tamamlama Onayı" };
    private static readonly string[] DisTeknisyenDurumlari =
        { "Bekliyor", "Tasarımda" };

    private static readonly ConcurrentDictionary<string, List<DateTime>> GirisDenemeleri = new();

    private readonly PrimerLabDbContext _db;
    private readonly IDataProtector _protector;
    private readonly IWebHostEnvironment _environment;
    private readonly TeknisyenHesapDeposu _hesaplar;
    private readonly IcerikTakip _takip;

    public TeknisyenPortalController(
        PrimerLabDbContext db,
        IDataProtectionProvider dataProtectionProvider,
        IWebHostEnvironment environment,
        TeknisyenHesapDeposu hesaplar,
        IcerikTakip takip)
    {
        _takip = takip;
        _db = db;
        _protector = dataProtectionProvider.CreateProtector("PrimerLab.TeknisyenPaneli.Session.v1");
        _environment = environment;
        _hesaplar = hesaplar;
    }

    // =========================================================
    // ADMIN — ana programdan teknisyen panel hesabı yönetimi
    // =========================================================

    [HttpGet("admin/account/{teknisyenId:int}")]
    public async Task<IActionResult> AdminHesap(int teknisyenId, [FromServices] PortalKimlik kimlik, CancellationToken ct)
    {
        if (!IsLoopback(HttpContext.Connection.RemoteIpAddress))
            return StatusCode(StatusCodes.Status403Forbidden, "Hesap yönetimi yalnız ana Primer Lab bilgisayarından yapılabilir.");

        var tek = await TeknisyenGetir(teknisyenId, ct);
        if (tek == null) return NotFound("Teknisyen bulunamadı.");

        var hesap = _hesaplar.Getir(teknisyenId);
        return Ok(new
        {
            teknisyenId,
            adSoyad = tek.AdSoyad,
            kullaniciAdi = hesap?.KullaniciAdi ?? KullaniciAdiOner(tek.AdSoyad),
            tip = hesap?.Tip ?? TeknisyenHesapDeposu.Ic,
            aktif = hesap?.Aktif ?? true,
            hesapVar = hesap != null,
            sonGirisTarihi = hesap?.SonGirisTarihi,
            panelYolu = "/teknisyen",
            girisKodu = kimlik.AyarlariOku().GiristeEpostaKodu,
            eposta = kimlik.BilgiGetir("teknisyen:" + teknisyenId)?.Email,
            epostaDogrulandi = kimlik.BilgiGetir("teknisyen:" + teknisyenId)?.EmailDogrulamaTarihi != null
        });
    }

    [HttpPost("admin/account/{teknisyenId:int}")]
    public async Task<IActionResult> AdminHesapKaydet(int teknisyenId, [FromBody] TeknisyenHesapDto dto, CancellationToken ct)
    {
        if (!IsLoopback(HttpContext.Connection.RemoteIpAddress))
            return StatusCode(StatusCodes.Status403Forbidden, "Hesap yönetimi yalnız ana Primer Lab bilgisayarından yapılabilir.");

        var tek = await TeknisyenGetir(teknisyenId, ct);
        if (tek == null) return NotFound("Teknisyen bulunamadı.");

        var kullaniciAdi = (dto.KullaniciAdi ?? string.Empty).Trim().ToLowerInvariant();
        if (!UsernameRegex.IsMatch(kullaniciAdi))
            return BadRequest("Kullanıcı adı 3-64 karakter olmalı; yalnız harf, rakam, nokta, alt çizgi ve tire kullanılabilir.");

        var parola = dto.YeniParola ?? string.Empty;
        var mevcut = _hesaplar.Getir(teknisyenId);
        if (mevcut == null && string.IsNullOrWhiteSpace(parola))
            return BadRequest("Yeni hesap için parola gereklidir.");
        if (!string.IsNullOrWhiteSpace(parola) && (parola.Length < 8 || !parola.Any(char.IsLetter) || !parola.Any(char.IsDigit)))
            return BadRequest("Parola en az 8 karakter olmalı ve en az bir harf ile bir rakam içermelidir.");

        var tip = dto.Tip == TeknisyenHesapDeposu.Dis ? TeknisyenHesapDeposu.Dis : TeknisyenHesapDeposu.Ic;

        // Kullanıcı adı başka bir hesaptaysa: o teknisyen silinmişse hesap sahipsizdir, kendiliğinden
        // temizlenir; teknisyen duruyorsa kimde olduğu söylenir, yönetici onaylarsa bu teknisyene devredilir.
        var sahip = _hesaplar.KullaniciAdiyla(kullaniciAdi);
        if (sahip != null && sahip.TeknisyenId != teknisyenId)
        {
            var sahipTek = await TeknisyenGetir(sahip.TeknisyenId, ct);
            if (sahipTek != null && !dto.Devral)
                return Conflict(new
                {
                    devralinabilir = true,
                    sahipId = sahipTek.Id,
                    sahipAdi = sahipTek.AdSoyad,
                    sahipAktif = sahipTek.Aktif,
                    message = $"\"{kullaniciAdi}\" kullanıcı adı {sahipTek.AdSoyad} (#{sahipTek.Id}{(sahipTek.Aktif ? "" : ", pasif")}) teknisyeninin panel hesabında kayıtlı."
                });
            _hesaplar.Sil(sahip.TeknisyenId);
        }

        if (!_hesaplar.Kaydet(teknisyenId, kullaniciAdi, string.IsNullOrWhiteSpace(parola) ? null : parola, tip, dto.Aktif && tek.Aktif))
            return Conflict("Bu kullanıcı adı başka bir teknisyende kullanılıyor.");
        if (!tek.Aktif)
            return Ok(new { message = "Hesap kaydedildi ancak teknisyen kartı pasif olduğu için giriş yapılamaz. Teknisyeni aktif yapın.", kullaniciAdi, tip });

        return Ok(new { message = "Teknisyen panel hesabı kaydedildi.", kullaniciAdi, tip });
    }

    [HttpDelete("admin/account/{teknisyenId:int}")]
    public IActionResult AdminHesapPasif(int teknisyenId)
    {
        if (!IsLoopback(HttpContext.Connection.RemoteIpAddress))
            return StatusCode(StatusCodes.Status403Forbidden, "Hesap yönetimi yalnız ana Primer Lab bilgisayarından yapılabilir.");
        return _hesaplar.Pasiflestir(teknisyenId) ? Ok(new { message = "Hesap pasif hale getirildi." }) : NotFound("Hesap bulunamadı.");
    }

    // =========================================================
    // OTURUM
    // =========================================================

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] TeknisyenGirisDto dto, [FromServices] PortalKimlik kimlik, CancellationToken ct)
    {
        var kullaniciAdi = (dto.KullaniciAdi ?? string.Empty).Trim().ToLowerInvariant();
        var parola = dto.Parola ?? string.Empty;
        var remote = HttpContext.Connection.RemoteIpAddress;
        var ipAnahtar = remote == null || remote.Equals(IPAddress.None) ? null : "ip:" + remote;
        var kAnahtar = "u:" + kullaniciAdi;

        if ((ipAnahtar != null && Engelli(ipAnahtar, 5)) || Engelli(kAnahtar, 10))
            return StatusCode(StatusCodes.Status429TooManyRequests, "Çok fazla hatalı giriş denemesi. 10 dakika sonra tekrar deneyin.");
        if (ipAnahtar != null && !kimlik.Izin("tgiris-ip:" + ipAnahtar, 40, TimeSpan.FromMinutes(10)))
            return StatusCode(StatusCodes.Status429TooManyRequests, "Çok fazla giriş isteği. Birkaç dakika sonra tekrar deneyin.");

        if (kullaniciAdi.Length == 0 || parola.Length == 0)
            return BadRequest("Kullanıcı adı ve şifre gereklidir.");

        var hesap = _hesaplar.KullaniciAdiyla(kullaniciAdi);
        var tek = hesap == null ? null : await TeknisyenGetir(hesap.TeknisyenId, ct);
        bool? dogru = hesap == null ? false : await kimlik.OzetKapisindan(() => TeknisyenHesapDeposu.ParolaDogru(hesap, parola), ct);
        if (dogru == null) return StatusCode(StatusCodes.Status503ServiceUnavailable, PortalKimlik.YogunMesaj);

        if (hesap == null || tek == null || dogru == false)
        {
            if (ipAnahtar != null) HataKaydet(ipAnahtar);
            if (kullaniciAdi.Length > 0) HataKaydet(kAnahtar);
            await Task.Delay(Random.Shared.Next(150, 450), ct);
            return Unauthorized("Kullanıcı adı veya şifre hatalı.");
        }

        if (ipAnahtar != null) GirisDenemeleri.TryRemove(ipAnahtar, out _);
        GirisDenemeleri.TryRemove(kAnahtar, out _);

        var anahtar = "teknisyen:" + tek.Id;
        if (!tek.Aktif)
            return StatusCode(StatusCodes.Status403Forbidden, "Teknisyen kaydınız pasif. Lütfen laboratuvarla görüşün.");
        if (!hesap.Aktif)
            return StatusCode(StatusCodes.Status403Forbidden, kimlik.BilgiGetir(anahtar)?.OnayBekliyor == true
                ? "Kaydınız laboratuvarın onayını bekliyor. Onaylandığında bu bilgilerle giriş yapabilirsiniz."
                : "Hesabınız pasif. Lütfen laboratuvarla görüşün.");

        Request.Cookies.TryGetValue(CihazCerezi, out var cihaz);
        var (yanit, oturumAc, hata) = kimlik.GirisSonrasi(anahtar, hesap.ParolaHash, cihaz);
        if (hata != null) return StatusCode(StatusCodes.Status429TooManyRequests, hata);
        if (!oturumAc) return Ok(yanit);
        return await OturumAc(tek.Id, ct);
    }

    private const string CihazCerezi = "primer_teknisyen_cihaz";

    [HttpPost("login/eposta")]
    public IActionResult LoginEposta([FromBody] EpostaKodDto dto, [FromServices] PortalKimlik kimlik)
    {
        var (yanit, hata) = kimlik.GirisEpostasi(dto.Jeton, "teknisyen:", dto.Eposta);
        return hata != null ? BadRequest(hata) : Ok(yanit);
    }

    [HttpPost("login/kod")]
    public async Task<IActionResult> LoginKod([FromBody] EpostaKodDto dto, [FromServices] PortalKimlik kimlik, CancellationToken ct)
    {
        var (anahtar, hata) = kimlik.GirisKoduDogrula(dto.Jeton, dto.Kod, "teknisyen:");
        if (hata != null)
        {
            await Task.Delay(Random.Shared.Next(150, 450), ct);
            return Unauthorized(hata);
        }
        var id = PortalKimlik.HesapId(anahtar!);
        if (dto.Hatirla && _hesaplar.Getir(id) is { } h)
        {
            var gun = kimlik.AyarlariOku().CihazHatirlaGun;
            Request.Cookies.TryGetValue(CihazCerezi, out var mevcut);
            PortalKimlik.CihazCereziYaz(HttpContext, CihazCerezi,
                PortalKimlik.CihazCereziEkle(mevcut, kimlik.CihazJetonu(anahtar!, h.ParolaHash, gun)), gun);
        }
        return await OturumAc(id, ct);
    }

    [HttpPost("login/kod-tekrar")]
    public IActionResult LoginKodTekrar([FromBody] EpostaKodDto dto, [FromServices] PortalKimlik kimlik)
    {
        var hata = kimlik.KoduTekrarGonder(dto.Jeton);
        return hata != null ? StatusCode(StatusCodes.Status429TooManyRequests, hata) : Ok(new { message = "Yeni kod gönderildi." });
    }

    // =========================================================
    // KENDİ KENDİNE KAYIT VE ŞİFRE SIFIRLAMA
    // =========================================================

    [HttpGet("kayit/durum")]
    public IActionResult KayitDurum([FromServices] PortalKimlik kimlik)
    {
        var a = kimlik.AyarlariOku();
        return Ok(new { kayitAcik = a.KayitAcik && kimlik.EpostaHazir, sifreSifirlama = kimlik.EpostaHazir, onayGereksin = a.OnayGereksin });
    }

    [HttpGet("kayit/zorluk")]
    public IActionResult KayitZorluk([FromServices] PortalKimlik kimlik) => Ok(kimlik.ZorlukUret());

    [HttpPost("kayit/basla")]
    public async Task<IActionResult> KayitBasla([FromBody] PortalKayitDto dto, [FromServices] PortalKimlik kimlik, CancellationToken ct)
    {
        var a = kimlik.AyarlariOku();
        if (!a.KayitAcik) return StatusCode(StatusCodes.Status403Forbidden, "Yeni kayıt şu anda kapalı. Lütfen laboratuvarla görüşün.");
        if (!kimlik.EpostaHazir) return StatusCode(StatusCodes.Status503ServiceUnavailable, "Laboratuvarın e-posta ayarı henüz yapılmadığı için kayıt alınamıyor.");
        if (!string.IsNullOrEmpty(dto.Website)) return Ok(new { jeton = kimlik.SahteKod(PortalKimlik.AmacKayit), eposta = "" });
        if (!kimlik.ZorlukDogrula(dto.ZorlukJeton, dto.ZorlukCevap))
            return BadRequest("Güvenlik doğrulaması tamamlanamadı. Sayfayı yenileyip tekrar deneyin.");
        var izin = kimlik.BasvuruIzni(HttpContext, "kayit");
        if (izin != null) return StatusCode(StatusCodes.Status429TooManyRequests, izin);

        var adSoyad = Kisalt(dto.AdSoyad, 150);
        var telefon = Kisalt(dto.Telefon, 30);
        var email = PortalKimlik.EpostaNormalize(dto.Eposta);
        var kullaniciAdi = (dto.KullaniciAdi ?? string.Empty).Trim().ToLowerInvariant();
        if (adSoyad == null || adSoyad.Length < 3) return BadRequest("Adınızı ve soyadınızı yazın.");
        if (email == null) return BadRequest("Geçerli bir e-posta adresi girin.");
        if (!UsernameRegex.IsMatch(kullaniciAdi))
            return BadRequest("Kullanıcı adı 3-64 karakter olmalı; yalnız harf, rakam, nokta, alt çizgi ve tire kullanılabilir.");
        var parolaHatasi = PortalKimlik.ParolaKontrol(dto.Parola);
        if (parolaHatasi != null) return BadRequest(parolaHatasi);
        if (!dto.Kvkk) return BadRequest("Devam etmek için bilgilendirme metnini onaylayın.");
        if (!await KullaniciAdiMusait(kullaniciAdi, ct)) return Conflict("Bu kullanıcı adı alınmış. Başka bir kullanıcı adı seçin.");
        var sahip = kimlik.EpostaSahibi(email);
        if (sahip != null && sahip.StartsWith("teknisyen:", StringComparison.Ordinal))
            return Conflict("Bu e-posta ile kayıtlı bir hesap var. Giriş yapın ya da \"Şifremi unuttum\"u kullanın.");

        var ozet = await kimlik.OzetKapisindan(() => { var o = TeknisyenHesapDeposu.OzetUret(dto.Parola!); return new[] { o.Hash, o.Salt }; }, ct);
        if (ozet == null) return StatusCode(StatusCodes.Status503ServiceUnavailable, PortalKimlik.YogunMesaj);

        var veri = JsonSerializer.Serialize(new HekimKayitVerisi(adSoyad, null, telefon, kullaniciAdi, ozet[0], ozet[1], PortalKimlik.IpAnahtari(HttpContext)));
        var (jeton, hata) = kimlik.KodGonder(PortalKimlik.AmacKayit, null, email, veri);
        if (hata != null) return StatusCode(StatusCodes.Status429TooManyRequests, hata);
        return Ok(new { jeton, eposta = PortalKimlik.Maskele(email) });
    }

    [HttpPost("kayit/tamamla")]
    public async Task<IActionResult> KayitTamamla([FromBody] EpostaKodDto dto, [FromServices] PortalKimlik kimlik, CancellationToken ct)
    {
        var (k, hata) = kimlik.KodDogrula(dto.Jeton, dto.Kod, PortalKimlik.AmacKayit);
        if (hata != null)
        {
            await Task.Delay(Random.Shared.Next(150, 450), ct);
            return Unauthorized(hata);
        }
        var v = JsonSerializer.Deserialize<HekimKayitVerisi>(k!.Veri!)!;
        var a = kimlik.AyarlariOku();
        if (!await KullaniciAdiMusait(v.KullaniciAdi, ct))
            return Conflict("Bu kullanıcı adı az önce başka biri tarafından alındı. Lütfen baştan başlayıp başka bir kullanıcı adı seçin.");

        var id = (await _db.Database.SqlQuery<int>($"""
            INSERT INTO "Teknisyenler" ("AdSoyad","Aktif","OlusturmaTarihi") VALUES ({v.AdSoyad},true,{DateTime.UtcNow})
            RETURNING "Id" AS "Value"
            """).ToListAsync(ct))[0];
        if (!_hesaplar.OzetliEkle(id, v.KullaniciAdi, v.ParolaHash, v.ParolaSalt, a.YeniTeknisyenTipi, !a.OnayGereksin))
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"""UPDATE "Teknisyenler" SET "Aktif"=false WHERE "Id"={id}""", ct);
            return Conflict("Bu kullanıcı adı az önce başka biri tarafından alındı. Lütfen baştan başlayıp başka bir kullanıcı adı seçin.");
        }

        kimlik.BilgiGuncelle("teknisyen:" + id, b =>
        {
            b.Email = k.Email;
            b.EmailDogrulamaTarihi = DateTime.UtcNow;
            b.KendiKaydi = true;
            b.KayitTarihi = DateTime.UtcNow;
            b.OnayBekliyor = a.OnayGereksin;
            b.KayitIp = v.Ip;
            b.Telefon = v.Telefon;
        });

        if (a.OnayGereksin) return Ok(new { onayBekliyor = true, message = "Kaydınız alındı. Laboratuvar onayladığında giriş yapabilirsiniz." });
        return await OturumAc(id, ct);
    }

    [HttpPost("sifre/basla")]
    public IActionResult SifreBasla([FromBody] SifreSifirlaDto dto, [FromServices] PortalKimlik kimlik)
    {
        if (!kimlik.EpostaHazir) return StatusCode(StatusCodes.Status503ServiceUnavailable, "Şifre sıfırlama için laboratuvarın e-posta ayarı yapılmamış. Laboratuvarla görüşün.");
        if (!kimlik.ZorlukDogrula(dto.ZorlukJeton, dto.ZorlukCevap))
            return BadRequest("Güvenlik doğrulaması tamamlanamadı. Sayfayı yenileyip tekrar deneyin.");
        var izin = kimlik.BasvuruIzni(HttpContext, "sifre");
        if (izin != null) return StatusCode(StatusCodes.Status429TooManyRequests, izin);

        var giris = (dto.Kimlik ?? string.Empty).Trim().ToLowerInvariant();
        string? anahtar = null;
        if (giris.Contains('@'))
        {
            var e = PortalKimlik.EpostaNormalize(giris);
            var s = e == null ? null : kimlik.EpostaSahibi(e);
            if (s != null && s.StartsWith("teknisyen:", StringComparison.Ordinal)) anahtar = s;
        }
        else if (giris.Length > 0 && _hesaplar.KullaniciAdiyla(giris) is { } h)
            anahtar = "teknisyen:" + h.TeknisyenId;

        var bilgi = anahtar == null ? null : kimlik.BilgiGetir(anahtar);
        string? jeton = null;
        if (bilgi?.Email != null && bilgi.EmailDogrulamaTarihi != null)
        {
            var (j, hata) = kimlik.KodGonder(PortalKimlik.AmacSifre, anahtar, bilgi.Email);
            if (hata != null) return StatusCode(StatusCodes.Status429TooManyRequests, hata);
            jeton = j;
        }
        return Ok(new { jeton = jeton ?? kimlik.SahteKod(PortalKimlik.AmacSifre) });
    }

    [HttpPost("sifre/tamamla")]
    public async Task<IActionResult> SifreTamamla([FromBody] SifreSifirlaDto dto, [FromServices] PortalKimlik kimlik, CancellationToken ct)
    {
        var parolaHatasi = PortalKimlik.ParolaKontrol(dto.YeniParola);
        if (parolaHatasi != null) return BadRequest(parolaHatasi);
        var (k, hata) = kimlik.KodDogrula(dto.Jeton, dto.Kod, PortalKimlik.AmacSifre);
        if (hata != null)
        {
            await Task.Delay(Random.Shared.Next(150, 450), ct);
            return Unauthorized(hata);
        }
        if (k!.Hesap == null || !k.Hesap.StartsWith("teknisyen:", StringComparison.Ordinal)) return Unauthorized("Süre doldu. Lütfen baştan başlayın.");
        var ozet = await kimlik.OzetKapisindan(() => { var o = TeknisyenHesapDeposu.OzetUret(dto.YeniParola!); return new[] { o.Hash, o.Salt }; }, ct);
        if (ozet == null) return StatusCode(StatusCodes.Status503ServiceUnavailable, PortalKimlik.YogunMesaj);
        _hesaplar.ParolaAyarla(PortalKimlik.HesapId(k.Hesap), ozet[0], ozet[1]);
        return Ok(new { message = "Şifreniz yenilendi. Yeni şifrenizle giriş yapabilirsiniz." });
    }

    private static string? Kisalt(string? deger, int max)
    {
        var t = (deger ?? string.Empty).Trim();
        return t.Length == 0 ? null : t.Length > max ? t[..max] : t;
    }

    private async Task<IActionResult> OturumAc(int teknisyenId, CancellationToken ct)
    {
        var hesap = _hesaplar.Getir(teknisyenId);
        var tek = await TeknisyenGetir(teknisyenId, ct);
        if (hesap == null || tek == null || !hesap.Aktif || !tek.Aktif) return Unauthorized("Hesap pasif.");

        var bitis = DateTime.UtcNow.AddHours(12);
        var oturum = JsonSerializer.Serialize(new TeknisyenOturum { TeknisyenId = tek.Id, Bitis = bitis });
        Response.Cookies.Append(CookieName, _protector.Protect(oturum), new CookieOptions
        {
            HttpOnly = true,
            Secure = Request.IsHttps,
            SameSite = SameSiteMode.Strict,
            Expires = bitis,
            IsEssential = true,
            Path = "/"
        });
        _hesaplar.GirisKaydet(tek.Id);

        return Ok(new { teknisyenId = tek.Id, adSoyad = tek.AdSoyad, tip = hesap.Tip });
    }

    [HttpPost("logout")]
    public IActionResult Logout()
    {
        Response.Cookies.Delete(CookieName, new CookieOptions { Path = "/" });
        return Ok(new { message = "Oturum kapatıldı." });
    }

    [HttpGet("me")]
    public async Task<IActionResult> Me(CancellationToken ct)
    {
        var o = await Oturum(ct);
        if (o.Hata != null) return o.Hata;
        return Ok(new { teknisyenId = o.Tek!.Id, adSoyad = o.Tek.AdSoyad, tip = o.Tip });
    }

    // =========================================================
    // İŞLER
    // =========================================================

    [HttpGet("jobs")]
    public async Task<IActionResult> Jobs(CancellationToken ct)
    {
        var o = await Oturum(ct);
        if (o.Hata != null) return o.Hata;
        var tekId = o.Tek!.Id;
        var kabulDeseni = KabulDeseni(tekId);

        var rows = await _db.Database.SqlQuery<TeknisyenIsSatiri>($"""
            SELECT
                s."Id",
                COALESCE(p."AdSoyad",'-') AS "HastaAdi",
                COALESCE(h."AdSoyad",'-') AS "HekimAdi",
                s."Durum",
                s."OlusturmaTarihi",
                s."TerminTarihi",
                s."DisRengi",
                s."DisSemasi",
                s."Materyal",
                s."Notlar",
                COALESCE((SELECT COUNT(*) FROM "IsDosyalari" f WHERE f."SiparisId"=s."Id" AND f."DosyaTuru"='Tarama'),0)::int AS "TaramaSayisi",
                COALESCE((SELECT COUNT(*) FROM "IsDosyalari" f WHERE f."SiparisId"=s."Id" AND f."DosyaTuru"='Tasarım'),0)::int AS "TasarimSayisi",
                COALESCE((SELECT COUNT(*) FROM "IsDosyalari" f WHERE f."SiparisId"=s."Id"),0)::int AS "DosyaSayisi",
                COALESCE((SELECT COUNT(*) FROM "IsMesajlari" m WHERE m."SiparisId"=s."Id"
                          AND ({o.Tip}='ic' OR m."GonderenTipi"<>'Laboratuvar')),0)::int AS "MesajSayisi",
                EXISTS(SELECT 1 FROM "SiparisDurumGecmisi" g
                       WHERE g."SiparisId"=s."Id" AND g."Aciklama" LIKE {kabulDeseni}) AS "Kabul",
                (SELECT MAX(g."DegisimTarihi") FROM "SiparisDurumGecmisi" g
                  WHERE g."SiparisId"=s."Id" AND g."Aciklama" LIKE {TeslimOnEki + "%"}) AS "TasarimTeslimTarihi",
                COALESCE(s."TasarimIndirildi",false) AS "UretimeAlindi",
                (SELECT MAX(g."DegisimTarihi") FROM "SiparisDurumGecmisi" g
                  WHERE g."SiparisId"=s."Id" AND g."YeniDurum"='Tamamlandı') AS "TamamlanmaTarihi"
            FROM "Siparisler" s
            INNER JOIN "Hastalar" p ON p."Id"=s."HastaId"
            LEFT JOIN "Hekimler" h ON h."Id"=p."HekimId"
            WHERE s."TeknisyenId"={tekId}
              AND COALESCE(s."Silindi",false)=false
              AND COALESCE(s."Aktif",true)=true
              AND COALESCE(s."OnayDurumu",'Onaylandı') NOT IN ('Gelen Onay','Reddedildi')
              AND (s."Durum"<>'Tamamlandı' OR s."OlusturmaTarihi" > {DateTime.UtcNow.AddDays(-180)})
            ORDER BY s."TerminTarihi" NULLS LAST, s."Id"
            LIMIT 1000
            """).ToListAsync(ct);

        var ids = rows.Select(x => x.Id).ToArray();
        var kalemler = ids.Length == 0
            ? new List<TeknisyenKalemSatiri>()
            : await _db.Database.SqlQuery<TeknisyenKalemSatiri>($"""
                SELECT "SiparisId","IsTuru","Adet" FROM "SiparisKalemleri"
                WHERE "SiparisId" = ANY({ids}) ORDER BY "SiparisId","Id"
                """).ToListAsync(ct);
        var isKalemleri = kalemler.GroupBy(x => x.SiparisId).ToDictionary(g => g.Key, g => g.ToList());
        var dis = o.Tip == TeknisyenHesapDeposu.Dis;

        // Teknisyenin okumadığı mesajlar: laboratuvarın ona yazdıkları ve hekim mesajları (kendi yazdıkları hariç).
        var gelenMesaj = ids.Length == 0 ? new List<MesajNoSatiri>() : await _db.Database.SqlQuery<MesajNoSatiri>($"""
            SELECT "SiparisId","Id","GonderenTipi" FROM "IsMesajlari"
            WHERE "SiparisId" = ANY({ids}) AND "GonderenTipi" IN ('Lab-Teknisyen','Hekim')
            """).ToListAsync(ct);
        var sinir = _takip.OkunmaSiniri("teknisyen:" + tekId);
        var okunmamis = gelenMesaj.Where(m => m.Id > sinir(m.SiparisId)).GroupBy(m => m.SiparisId).ToDictionary(g => g.Key, g => g.Count());
        var linkSayilari = HttpContext.RequestServices.GetRequiredService<IsLinkleri>().Sayilar();

        return Ok(rows.Select(x => new
        {
            x.Id,
            x.HastaAdi,
            HekimAdi = dis ? Maskele(x.HekimAdi) : x.HekimAdi,
            x.Durum,
            x.OlusturmaTarihi,
            x.TerminTarihi,
            x.DisRengi,
            x.DisSemasi,
            x.Materyal,
            x.Notlar,
            x.TaramaSayisi,
            x.TasarimSayisi,
            x.DosyaSayisi,
            LinkSayisi = linkSayilari.TryGetValue(x.Id, out var ls) ? ls : 0,
            x.MesajSayisi,
            OkunmamisMesaj = okunmamis.TryGetValue(x.Id, out var om) ? om : 0,
            Kabul = !dis || x.Kabul,
            x.TamamlanmaTarihi,
            x.TasarimTeslimTarihi,
            x.UretimeAlindi,
            Kalemler = isKalemleri.TryGetValue(x.Id, out var k)
                ? k.Select(i => (object)new { i.IsTuru, i.Adet }).ToArray()
                : Array.Empty<object>()
        }));
    }

    [HttpPost("jobs/{jobId:int}/kabul")]
    public async Task<IActionResult> Kabul(int jobId, CancellationToken ct)
    {
        var o = await Oturum(ct);
        if (o.Hata != null) return o.Hata;
        var durum = await IsDurumu(o.Tek!.Id, jobId, ct);
        if (durum == null) return NotFound("İş bulunamadı.");
        // Kabul kaydı durum geçmişine yazılır; tamamlanmış işte yeni "Tamamlandı" satırı
        // tamamlanma tarihini (cari dönem hesabını) değiştireceği için kabul yapılmaz.
        if (durum is "Tamamlandı" or "Teslim Edildi") return BadRequest("Tamamlanmış iş kabul edilemez.");
        if (await KabulEdildi(o.Tek.Id, jobId, ct)) return Ok(new { message = "İş zaten kabul edilmiş." });

        await GecmisEkle(jobId, durum, durum, $"{KabulOnEki}: {o.Tek.AdSoyad} (#{o.Tek.Id})", ct);
        return Ok(new { message = "İş kabul edildi; tarama dosyaları indirilebilir." });
    }

    [HttpPost("jobs/{jobId:int}/durum")]
    public async Task<IActionResult> DurumDegistir(int jobId, [FromBody] TeknisyenDurumDto dto, CancellationToken ct)
    {
        var o = await Oturum(ct);
        if (o.Hata != null) return o.Hata;

        var yeni = (dto.Durum ?? string.Empty).Trim();
        var izinli = o.Tip == TeknisyenHesapDeposu.Dis ? DisTeknisyenDurumlari : IcTeknisyenDurumlari;
        if (!izinli.Contains(yeni))
            return BadRequest(o.Tip == TeknisyenHesapDeposu.Dis
                ? "Tasarımı yükleyip laboratuvara teslim edin; üretime alma laboratuvar tarafından yapılır."
                : "Geçersiz durum.");

        var eski = await IsDurumu(o.Tek!.Id, jobId, ct);
        if (eski == null) return NotFound("İş bulunamadı.");
        if (o.Tip == TeknisyenHesapDeposu.Dis && !await KabulEdildi(o.Tek.Id, jobId, ct))
            return BadRequest("Önce işi kabul edin.");
        if (eski == "Tamamlandı") return BadRequest("Tamamlanmış işin durumu değiştirilemez.");
        if (eski == "Tamamlama Onayı") return BadRequest("İş laboratuvarın tamamlama onayını bekliyor.");
        if (o.Tip == TeknisyenHesapDeposu.Dis && eski is ("Üretimde" or "Makyajda"))
            return BadRequest("İş laboratuvarda üretimde; durumu laboratuvar yönetir.");
        if (eski == yeni) return Ok(new { message = "Durum zaten " + yeni + "." });

        var aciklama = $"Teknisyen: {o.Tek.AdSoyad}";
        if (yeni == "Tamamlama Onayı")
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE "Siparisler"
                SET "Durum"='Tamamlama Onayı',
                    "TamamlamaOncekiDurum"={eski},
                    "TamamlamaTalepTarihi"={DateTime.UtcNow}
                WHERE "Id"={jobId} AND "TeknisyenId"={o.Tek.Id}
                """, ct);
            aciklama = $"Teknisyen işi bitirdi ({o.Tek.AdSoyad}); admin onayı bekliyor.";
        }
        else
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE "Siparisler" SET "Durum"={yeni}
                WHERE "Id"={jobId} AND "TeknisyenId"={o.Tek.Id}
                """, ct);
        }

        await GecmisEkle(jobId, eski, yeni, aciklama, ct);
        return Ok(new { message = yeni == "Tamamlama Onayı" ? "İş tamamlandı olarak bildirildi; laboratuvar onayı bekleniyor." : "Durum güncellendi." });
    }

    // Tasarım bitti: yüklenen tasarım laboratuvara teslim edilir; laboratuvar "Dosyalar >
    // Tasarımdaki İşler" ekranından görüp "Üretime Al" ile üretime geçirir.
    [HttpPost("jobs/{jobId:int}/tasarim-teslim")]
    public async Task<IActionResult> TasarimTeslim(int jobId, CancellationToken ct)
    {
        var o = await Oturum(ct);
        if (o.Hata != null) return o.Hata;
        var durum = await IsDurumu(o.Tek!.Id, jobId, ct);
        if (durum == null) return NotFound("İş bulunamadı.");
        if (o.Tip == TeknisyenHesapDeposu.Dis && !await KabulEdildi(o.Tek.Id, jobId, ct))
            return BadRequest("Önce işi kabul edin.");
        if (durum is "Tamamlandı" or "Tamamlama Onayı" or "Teslim Edildi")
            return BadRequest("Tamamlanmış işte tasarım teslimi yapılamaz.");

        var tasarimSayisi = await _db.Database.SqlQuery<int>($"""
            SELECT COUNT(*)::int AS "Value" FROM "IsDosyalari" WHERE "SiparisId"={jobId} AND "DosyaTuru"='Tasarım'
            """).SingleAsync(ct);
        if (tasarimSayisi == 0) return BadRequest("Önce tasarım dosyasını yükleyin.");

        await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE "Siparisler" SET "TasarimIndirildi"=false, "TasarimIndirmeTarihi"=NULL
            WHERE "Id"={jobId} AND "TeknisyenId"={o.Tek.Id}
            """, ct);
        await GecmisEkle(jobId, durum, durum, $"{TeslimOnEki}: {o.Tek.AdSoyad} (#{o.Tek.Id}), {tasarimSayisi} tasarım dosyası", ct);
        await _db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "IsMesajlari" ("SiparisId","GonderenTipi","GonderenAdi","Mesaj","Tarih")
            VALUES ({jobId},{"Teknisyen"},{o.Tek.AdSoyad},{"✔ Tasarım tamamlandı ve yüklendi (" + tasarimSayisi + " dosya). Üretime alınmaya hazır."},{DateTime.UtcNow})
            """, ct);
        return Ok(new { message = "Tasarım laboratuvara teslim edildi. Üretime alma laboratuvar tarafından yapılacak." });
    }

    // =========================================================
    // SİPARİŞ FORMLARI (yalnız iç teknisyen) — tüm işlerin formları, fiyatsız
    // =========================================================

    [HttpGet("siparis-formlari")]
    public async Task<IActionResult> SiparisFormlari([FromQuery] string? ara, [FromQuery] int sayfa, CancellationToken ct)
    {
        var o = await Oturum(ct);
        if (o.Hata != null) return o.Hata;
        if (o.Tip != TeknisyenHesapDeposu.Ic) return StatusCode(StatusCodes.Status403Forbidden, "Sipariş formlarını yalnız iç teknisyenler görebilir.");
        var q = (ara ?? "").Trim();
        if (q.Length > 80) q = q[..80];
        var desen = "%" + q.Replace("\\", "").Replace("%", "").Replace("_", "") + "%";
        var no = int.TryParse(q.TrimStart('#'), out var n) ? n : -1;
        sayfa = Math.Max(0, sayfa);
        var rows = await _db.Database.SqlQuery<SiparisFormuSatiri>($"""
            SELECT s."Id", COALESCE(p."AdSoyad",'-') AS "HastaAdi", COALESCE(h."AdSoyad",'-') AS "HekimAdi",
                   h."KlinikAdi", COALESCE(s."Durum",'Bekliyor') AS "Durum", COALESCE(s."OnayDurumu",'Onaylandı') AS "OnayDurumu",
                   s."OlusturmaTarihi", s."TerminTarihi", s."DisRengi", s."DisSemasi", s."Materyal", s."Notlar",
                   t."AdSoyad" AS "TeknisyenAdi", s."Kaynak",
                   (SELECT string_agg(k."IsTuru" || ' × ' || k."Adet", ', ' ORDER BY k."Id") FROM "SiparisKalemleri" k WHERE k."SiparisId"=s."Id") AS "Kalemler",
                   (SELECT COUNT(*)::int FROM "IsDosyalari" f WHERE f."SiparisId"=s."Id") AS "DosyaSayisi"
            FROM "Siparisler" s
            INNER JOIN "Hastalar" p ON p."Id"=s."HastaId"
            LEFT JOIN "Hekimler" h ON h."Id"=p."HekimId"
            LEFT JOIN "Teknisyenler" t ON t."Id"=s."TeknisyenId"
            WHERE COALESCE(s."Silindi",false)=false
              AND ({q} = '' OR s."Id"={no} OR p."AdSoyad" ILIKE {desen} OR h."AdSoyad" ILIKE {desen} OR h."KlinikAdi" ILIKE {desen}
                   OR EXISTS(SELECT 1 FROM "SiparisKalemleri" k WHERE k."SiparisId"=s."Id" AND k."IsTuru" ILIKE {desen}))
            ORDER BY s."Id" DESC
            LIMIT 51 OFFSET {sayfa * 50}
            """).ToListAsync(ct);
        return Ok(new { formlar = rows.Take(50), devami = rows.Count > 50 });
    }

    // =========================================================
    // DOSYALAR
    // =========================================================

    [HttpGet("jobs/{jobId:int}/links")]
    public async Task<IActionResult> Linkler(int jobId, [FromServices] IsLinkleri linkler, CancellationToken ct)
    {
        var o = await Oturum(ct);
        if (o.Hata != null) return o.Hata;
        if (!await OkumaErisimi(o.Tek!.Id, o.Tip, jobId, ct)) return NotFound("İş bulunamadı.");
        return Ok(linkler.Liste(jobId).Select(IsLinkleri.Gorunum));
    }

    [HttpGet("jobs/{jobId:int}/files")]
    public async Task<IActionResult> Dosyalar(int jobId, CancellationToken ct)
    {
        var o = await Oturum(ct);
        if (o.Hata != null) return o.Hata;
        if (!await OkumaErisimi(o.Tek!.Id, o.Tip, jobId, ct)) return NotFound("İş bulunamadı.");

        var rows = await _db.Database.SqlQuery<TeknisyenDosyaSatiri>($"""
            SELECT "Id","DosyaTuru","OrijinalDosyaAdi","SaklananDosyaAdi","Boyut","YuklemeTarihi"
            FROM "IsDosyalari" WHERE "SiparisId"={jobId}
            ORDER BY "YuklemeTarihi" DESC,"Id" DESC
            """).ToListAsync(ct);
        return Ok(rows.Select(x => new { x.Id, x.DosyaTuru, x.OrijinalDosyaAdi, x.Boyut, x.YuklemeTarihi }));
    }

    [HttpGet("jobs/{jobId:int}/files/{fileId:int}")]
    public async Task<IActionResult> DosyaIndir(int jobId, int fileId, CancellationToken ct)
    {
        var o = await Oturum(ct);
        if (o.Hata != null) return o.Hata;
        if (!await OkumaErisimi(o.Tek!.Id, o.Tip, jobId, ct)) return NotFound("İş bulunamadı.");
        if (o.Tip == TeknisyenHesapDeposu.Dis && !await KabulEdildi(o.Tek.Id, jobId, ct))
            return BadRequest("Dosyaları indirmek için önce işi kabul edin.");

        var row = await _db.Database.SqlQuery<TeknisyenDosyaSatiri>($"""
            SELECT "Id","DosyaTuru","OrijinalDosyaAdi","SaklananDosyaAdi","Boyut","YuklemeTarihi"
            FROM "IsDosyalari" WHERE "Id"={fileId} AND "SiparisId"={jobId}
            """).FirstOrDefaultAsync(ct);
        if (row == null) return NotFound("Dosya bulunamadı.");

        var yol = GuvenliYol(jobId, row.SaklananDosyaAdi);
        if (!System.IO.File.Exists(yol)) return NotFound("Dosyanın fiziksel kopyası bulunamadı.");
        if (!new FileExtensionContentTypeProvider().TryGetContentType(row.OrijinalDosyaAdi, out var tur))
            tur = "application/octet-stream";
        _takip.Indirildi(new[] { row.Id }, "Teknisyen: " + o.Tek.AdSoyad);
        return PhysicalFile(yol, tur, Path.GetFileName(row.OrijinalDosyaAdi), enableRangeProcessing: true);
    }

    [HttpPost("jobs/{jobId:int}/files")]
    [RequestSizeLimit(MaxFileSize + 1024 * 1024)]
    public async Task<IActionResult> DosyaYukle(int jobId, [FromForm] IFormFile dosya, [FromForm] string? dosyaTuru, CancellationToken ct)
    {
        var o = await Oturum(ct);
        if (o.Hata != null) return o.Hata;
        if (await IsDurumu(o.Tek!.Id, jobId, ct) == null) return NotFound("İş bulunamadı.");
        if (o.Tip == TeknisyenHesapDeposu.Dis && !await KabulEdildi(o.Tek.Id, jobId, ct))
            return BadRequest("Önce işi kabul edin.");

        if (dosya == null || dosya.Length <= 0) return BadRequest("Dosya seçilmedi.");
        if (dosya.Length > MaxFileSize) return BadRequest("Dosya en fazla 250 MB olabilir.");
        var ad = Path.GetFileName((dosya.FileName ?? string.Empty).Trim());
        if (string.IsNullOrWhiteSpace(ad) || ad.Length > 240 || ad.Any(char.IsControl)) return BadRequest("Dosya adı geçersiz.");
        var uzanti = Path.GetExtension(ad).ToLowerInvariant();
        if (!AllowedExtensions.Contains(uzanti)) return BadRequest("Desteklenmeyen dosya türü.");

        var tur = dosyaTuru == "Diger" ? "Diger" : (dosyaTuru == "Üretim" ? "Üretim" : "Tasarım");
        var saklanan = Guid.NewGuid().ToString("N") + uzanti;
        var yol = GuvenliYol(jobId, saklanan);
        Directory.CreateDirectory(Path.GetDirectoryName(yol)!);

        try
        {
            await using (var akis = new FileStream(yol, FileMode.CreateNew, FileAccess.Write, FileShare.None, 128 * 1024, useAsync: true))
                await dosya.CopyToAsync(akis, ct);

            var dosyaId = (await _db.Database.SqlQuery<int>($"""
                INSERT INTO "IsDosyalari"
                ("SiparisId","DosyaTuru","OrijinalDosyaAdi","SaklananDosyaAdi","Uzanti","Boyut","YuklemeTarihi")
                VALUES ({jobId},{tur},{ad},{saklanan},{uzanti},{dosya.Length},{DateTime.UtcNow})
                RETURNING "Id" AS "Value"
                """).ToListAsync(ct)).Single();
            _takip.DosyaYuklendi(dosyaId, "Teknisyen", o.Tek.AdSoyad);
        }
        catch
        {
            try { if (System.IO.File.Exists(yol)) System.IO.File.Delete(yol); } catch { }
            throw;
        }

        return Ok(new { message = "Dosya yüklendi.", dosyaTuru = tur, orijinalDosyaAdi = ad });
    }

    // =========================================================
    // MESAJLAR
    // =========================================================

    [HttpGet("jobs/{jobId:int}/messages")]
    public async Task<IActionResult> Mesajlar(int jobId, CancellationToken ct)
    {
        var o = await Oturum(ct);
        if (o.Hata != null) return o.Hata;
        if (await IsDurumu(o.Tek!.Id, jobId, ct) == null) return NotFound("İş bulunamadı.");

        var dis = o.Tip == TeknisyenHesapDeposu.Dis;
        // Dış teknisyen laboratuvarın hekime yazdıklarını (fiyat vb. olabilir) görmez.
        var rows = (await _db.Database.SqlQuery<IsMesajSatiri>($"""
            SELECT "Id","GonderenTipi","GonderenAdi","Mesaj","Tarih"
            FROM "IsMesajlari" WHERE "SiparisId"={jobId}
            ORDER BY "Tarih","Id"
            """).ToListAsync(ct)).Where(m => !dis || m.GonderenTipi != "Laboratuvar").ToList();
        if (rows.Count > 0) _takip.MesajOkundu("teknisyen:" + o.Tek.Id, jobId, rows.Max(x => x.Id));
        return Ok(rows.Select(m => new
        {
            m.Id,
            GonderenTipi = m.GonderenTipi == "Lab-Teknisyen" ? "Laboratuvar" : m.GonderenTipi,
            Kanal = m.GonderenTipi is "Hekim" or "Laboratuvar" ? "hekim" : "ic",
            GonderenAdi = dis && m.GonderenTipi == "Hekim" ? Maskele(m.GonderenAdi) : m.GonderenAdi,
            m.Mesaj,
            m.Tarih,
            Benim = m.GonderenTipi == "Teknisyen" && m.GonderenAdi == o.Tek.AdSoyad
        }));
    }

    [HttpPost("jobs/{jobId:int}/messages")]
    public async Task<IActionResult> MesajGonder(int jobId, [FromBody] IsMesajDto dto, CancellationToken ct)
    {
        var o = await Oturum(ct);
        if (o.Hata != null) return o.Hata;
        if (await IsDurumu(o.Tek!.Id, jobId, ct) == null) return NotFound("İş bulunamadı.");

        var mesaj = (dto.Mesaj ?? string.Empty).Trim();
        if (mesaj.Length == 0) return BadRequest("Mesaj boş olamaz.");
        if (mesaj.Length > 4000) return BadRequest("Mesaj en fazla 4000 karakter olabilir.");

        var yeniId = (await _db.Database.SqlQuery<int>($"""
            INSERT INTO "IsMesajlari" ("SiparisId","GonderenTipi","GonderenAdi","Mesaj","Tarih")
            VALUES ({jobId},{"Teknisyen"},{o.Tek.AdSoyad},{mesaj},{DateTime.UtcNow})
            RETURNING "Id" AS "Value"
            """).ToListAsync(ct)).Single();
        _takip.MesajOkundu("teknisyen:" + o.Tek.Id, jobId, yeniId);
        return Ok(new { message = "Mesaj gönderildi." });
    }

    // =========================================================
    // YARDIMCILAR
    // =========================================================

    private async Task<(TeknisyenSatiri? Tek, string Tip, IActionResult? Hata)> Oturum(CancellationToken ct)
    {
        if (!Request.Cookies.TryGetValue(CookieName, out var cerez) || string.IsNullOrWhiteSpace(cerez))
            return (null, "", Unauthorized("Oturum bulunamadı."));

        TeknisyenOturum? oturum;
        try { oturum = JsonSerializer.Deserialize<TeknisyenOturum>(_protector.Unprotect(cerez)); }
        catch { return (null, "", Unauthorized("Oturum geçersiz.")); }

        if (oturum == null || oturum.Bitis <= DateTime.UtcNow)
            return (null, "", Unauthorized("Oturum sona erdi."));

        var hesap = _hesaplar.Getir(oturum.TeknisyenId);
        var tek = await TeknisyenGetir(oturum.TeknisyenId, ct);
        if (hesap == null || !hesap.Aktif || tek == null || !tek.Aktif)
            return (null, "", Unauthorized("Hesap pasif."));

        return (tek, hesap.Tip, null);
    }

    private Task<TeknisyenSatiri?> TeknisyenGetir(int id, CancellationToken ct) =>
        _db.Database.SqlQuery<TeknisyenSatiri>($"""
            SELECT "Id","AdSoyad",COALESCE("Aktif",true) AS "Aktif" FROM "Teknisyenler" WHERE "Id"={id}
            """).FirstOrDefaultAsync(ct);

    // İş bu teknisyene atanmış, onaylı ve silinmemişse durumunu döner; değilse null.
    private async Task<string?> IsDurumu(int tekId, int jobId, CancellationToken ct)
    {
        var liste = await _db.Database.SqlQuery<string>($"""
            SELECT COALESCE("Durum",'Bekliyor') AS "Value" FROM "Siparisler"
            WHERE "Id"={jobId} AND "TeknisyenId"={tekId}
              AND COALESCE("Silindi",false)=false
              AND COALESCE("OnayDurumu",'Onaylandı') NOT IN ('Gelen Onay','Reddedildi')
            """).ToListAsync(ct);
        return liste.FirstOrDefault();
    }

    // Okuma (dosya listesi / indirme): dış teknisyen yalnız kendi işine; iç teknisyen laboratuvar kadrosu
    // olduğu için silinmemiş tüm işlere (geçmiş sipariş formları) erişir.
    private async Task<bool> OkumaErisimi(int tekId, string tip, int jobId, CancellationToken ct)
    {
        if (tip != TeknisyenHesapDeposu.Ic) return await IsDurumu(tekId, jobId, ct) != null;
        return await _db.Database.SqlQuery<int>($"""
            SELECT COUNT(*)::int AS "Value" FROM "Siparisler" WHERE "Id"={jobId} AND COALESCE("Silindi",false)=false
            """).SingleAsync(ct) > 0;
    }

    // Silinmiş teknisyende kalmış (sahipsiz) hesap kullanıcı adını tutmasın.
    private async Task<bool> KullaniciAdiMusait(string kullaniciAdi, CancellationToken ct)
    {
        var sahip = _hesaplar.KullaniciAdiyla(kullaniciAdi);
        if (sahip == null) return true;
        if (await TeknisyenGetir(sahip.TeknisyenId, ct) != null) return false;
        _hesaplar.Sil(sahip.TeknisyenId);
        return true;
    }

    private static string KabulDeseni(int tekId) => KabulOnEki + "%(#" + tekId + ")";

    private async Task<bool> KabulEdildi(int tekId, int jobId, CancellationToken ct)
    {
        var desen = KabulDeseni(tekId);
        return await _db.Database.SqlQuery<int>($"""
            SELECT COUNT(*)::int AS "Value" FROM "SiparisDurumGecmisi"
            WHERE "SiparisId"={jobId} AND "Aciklama" LIKE {desen}
            """).SingleAsync(ct) > 0;
    }

    private Task GecmisEkle(int jobId, string? eski, string yeni, string aciklama, CancellationToken ct) =>
        _db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "SiparisDurumGecmisi" ("SiparisId","EskiDurum","YeniDurum","DegisimTarihi","Aciklama")
            VALUES ({jobId},{eski},{yeni},{DateTime.UtcNow},{aciklama})
            """, ct);

    private string GuvenliYol(int jobId, string saklanan)
    {
        var ad = Path.GetFileName(saklanan ?? string.Empty);
        if (string.IsNullOrWhiteSpace(ad) || ad != saklanan)
            throw new InvalidOperationException("Dosya yolu güvenlik kontrolünden geçemedi.");
        var klasor = Path.GetFullPath(Path.Combine(_environment.ContentRootPath, "App_Data", "IsDosyalari", jobId.ToString()));
        var tam = Path.GetFullPath(Path.Combine(klasor, ad));
        if (!tam.StartsWith(klasor.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Dosya yolu depolama alanı dışında.");
        return tam;
    }

    // Dış teknisyene hekim adı yalnız baş harfleriyle gösterilir ("Dr Ayşe Kaya" → "D.A.K.").
    private static string Maskele(string? ad)
    {
        if (string.IsNullOrWhiteSpace(ad)) return "-";
        return string.Concat(ad.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(p => char.ToUpper(p[0], new System.Globalization.CultureInfo("tr-TR")) + "."));
    }

    private static string KullaniciAdiOner(string ad)
    {
        var n = ad.Trim().ToLowerInvariant()
            .Replace('ç', 'c').Replace('ğ', 'g').Replace('ı', 'i').Replace('ö', 'o').Replace('ş', 's').Replace('ü', 'u');
        n = Regex.Replace(n, "[^a-z0-9]+", ".").Trim('.');
        return string.IsNullOrWhiteSpace(n) ? "teknisyen" : n[..Math.Min(n.Length, 50)];
    }

    private static bool IsLoopback(IPAddress? a) =>
        a == null || IPAddress.IsLoopback(a) || (a.IsIPv4MappedToIPv6 && IPAddress.IsLoopback(a.MapToIPv4()));

    private static bool Engelli(string anahtar, int sinir)
    {
        if (!GirisDenemeleri.TryGetValue(anahtar, out var liste)) return false;
        lock (liste)
        {
            liste.RemoveAll(x => DateTime.UtcNow - x > TimeSpan.FromMinutes(10));
            return liste.Count >= sinir;
        }
    }

    private static void HataKaydet(string anahtar)
    {
        if (GirisDenemeleri.Count > 50_000) GirisDenemeleri.Clear();
        var liste = GirisDenemeleri.GetOrAdd(anahtar, _ => new List<DateTime>());
        lock (liste)
        {
            liste.RemoveAll(x => DateTime.UtcNow - x > TimeSpan.FromMinutes(10));
            liste.Add(DateTime.UtcNow);
        }
    }

    private sealed class TeknisyenOturum
    {
        public int TeknisyenId { get; set; }
        public DateTime Bitis { get; set; }
    }
}

public sealed class TeknisyenHesapDto
{
    public string? KullaniciAdi { get; set; }
    public string? YeniParola { get; set; }
    public string? Tip { get; set; }
    public bool Aktif { get; set; } = true;
    public bool Devral { get; set; }
}

public sealed class TeknisyenGirisDto
{
    public string? KullaniciAdi { get; set; }
    public string? Parola { get; set; }
}

public sealed class TeknisyenDurumDto
{
    public string? Durum { get; set; }
}

public sealed class IsMesajDto
{
    public string? Mesaj { get; set; }
}

public sealed class TeknisyenSatiri
{
    public int Id { get; set; }
    public string AdSoyad { get; set; } = string.Empty;
    public bool Aktif { get; set; }
}

public sealed class TeknisyenIsSatiri
{
    public int Id { get; set; }
    public string HastaAdi { get; set; } = string.Empty;
    public string HekimAdi { get; set; } = string.Empty;
    public string? Durum { get; set; }
    public DateTime OlusturmaTarihi { get; set; }
    public DateTime? TerminTarihi { get; set; }
    public string? DisRengi { get; set; }
    public string? DisSemasi { get; set; }
    public string? Materyal { get; set; }
    public string? Notlar { get; set; }
    public int TaramaSayisi { get; set; }
    public int TasarimSayisi { get; set; }
    public int DosyaSayisi { get; set; }
    public int MesajSayisi { get; set; }
    public bool Kabul { get; set; }
    public DateTime? TamamlanmaTarihi { get; set; }
    public DateTime? TasarimTeslimTarihi { get; set; }
    public bool UretimeAlindi { get; set; }
}

public sealed class SiparisFormuSatiri
{
    public int Id { get; set; }
    public string HastaAdi { get; set; } = string.Empty;
    public string HekimAdi { get; set; } = string.Empty;
    public string? KlinikAdi { get; set; }
    public string Durum { get; set; } = string.Empty;
    public string OnayDurumu { get; set; } = string.Empty;
    public DateTime OlusturmaTarihi { get; set; }
    public DateTime? TerminTarihi { get; set; }
    public string? DisRengi { get; set; }
    public string? DisSemasi { get; set; }
    public string? Materyal { get; set; }
    public string? Notlar { get; set; }
    public string? TeknisyenAdi { get; set; }
    public string? Kaynak { get; set; }
    public string? Kalemler { get; set; }
    public int DosyaSayisi { get; set; }
}

public sealed class TeknisyenKalemSatiri
{
    public int SiparisId { get; set; }
    public string IsTuru { get; set; } = string.Empty;
    public int Adet { get; set; }
}

public sealed class TeknisyenDosyaSatiri
{
    public int Id { get; set; }
    public string DosyaTuru { get; set; } = string.Empty;
    public string OrijinalDosyaAdi { get; set; } = string.Empty;
    public string SaklananDosyaAdi { get; set; } = string.Empty;
    public long Boyut { get; set; }
    public DateTime YuklemeTarihi { get; set; }
}

public sealed class IsMesajSatiri
{
    public int Id { get; set; }
    public string GonderenTipi { get; set; } = string.Empty;
    public string? GonderenAdi { get; set; }
    public string Mesaj { get; set; } = string.Empty;
    public DateTime Tarih { get; set; }
}
