using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;
using PrimerLabV2.Infrastructure;
using PrimerLabV2.Models;

namespace PrimerLabV2.Controllers;

[ApiController]
[Route("api/hekim-portal")]
public sealed class HekimPortalController : ControllerBase
{
    private const string CookieName = "primer_hekim_portal";
    private const int PasswordIterations = 210_000;
    private const long MaxFileSize = 250L * 1024L * 1024L;
    private const long MaxRequestSize = 520L * 1024L * 1024L;

    private static readonly Regex UsernameRegex =
        new("^[a-zA-Z0-9._-]{3,64}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly HashSet<string> AllowedExtensions =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ".stl", ".obj", ".ply", ".dcm", ".zip", ".rar", ".7z", ".pdf",
            ".jpg", ".jpeg", ".png", ".webp", ".txt"
        };

    private static readonly HashSet<int> ValidTeeth = new(
        new[]
        {
            18,17,16,15,14,13,12,11, 21,22,23,24,25,26,27,28,
            48,47,46,45,44,43,42,41, 31,32,33,34,35,36,37,38
        });

    private static readonly ConcurrentDictionary<string, LoginAttemptState> LoginAttempts = new();

    private readonly PrimerLabDbContext _db;
    private readonly IDataProtector _protector;
    private readonly IWebHostEnvironment _environment;
    private readonly IConfiguration _configuration;
    private readonly IDataProtector _teknisyenProtector;
    private readonly TeknisyenHesapDeposu _teknisyenHesaplari;
    private readonly IcerikTakip _takip;

    public HekimPortalController(
        PrimerLabDbContext db,
        IDataProtectionProvider dataProtectionProvider,
        IWebHostEnvironment environment,
        IConfiguration configuration,
        TeknisyenHesapDeposu teknisyenHesaplari,
        IcerikTakip takip)
    {
        _takip = takip;
        _db = db;
        _protector = dataProtectionProvider.CreateProtector("PrimerLab.HekimPortal.Session.v1");
        // Teknisyen Paneli oturum çerezi (iç teknisyenin hekim adına sipariş formu açması için).
        _teknisyenProtector = dataProtectionProvider.CreateProtector("PrimerLab.TeknisyenPaneli.Session.v1");
        _environment = environment;
        _configuration = configuration;
        _teknisyenHesaplari = teknisyenHesaplari;
    }

    // =========================================================
    // ADMIN — ANA YAZILIMDAN HEKİM PORTAL HESABI YÖNETİMİ
    // =========================================================

    [HttpGet("admin/account/{hekimId:int}")]
    public async Task<IActionResult> AdminGetAccount(int hekimId, [FromServices] PortalKimlik kimlik, CancellationToken cancellationToken)
    {
        if (!IsLoopback(HttpContext.Connection.RemoteIpAddress))
            return StatusCode(StatusCodes.Status403Forbidden, "Portal hesap yönetimi yalnız ana Primer Lab bilgisayarından yapılabilir.");

        var hekim = await _db.Hekimler.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == hekimId, cancellationToken);

        if (hekim == null) return NotFound("Hekim bulunamadı.");

        var account = await _db.Database.SqlQuery<PortalAccountAdminRow>($"""
            SELECT "HekimId","KullaniciAdi","Aktif","SonGirisTarihi","GuncellemeTarihi"
            FROM "HekimPortalHesaplari"
            WHERE "HekimId"={hekimId}
            """).FirstOrDefaultAsync(cancellationToken);

        return Ok(new
        {
            hekimId = hekim.Id,
            hekimAdi = hekim.AdSoyad,
            klinikAdi = hekim.KlinikAdi,
            kullaniciAdi = account?.KullaniciAdi ?? SuggestUsername(hekim.AdSoyad),
            aktif = account?.Aktif ?? true,
            hesapVar = account != null,
            sonGirisTarihi = account?.SonGirisTarihi,
            guncellemeTarihi = account?.GuncellemeTarihi,
            portalYolu = "/hekim-portal",
            girisKodu = kimlik.AyarlariOku().GiristeEpostaKodu,
            eposta = kimlik.BilgiGetir("hekim:" + hekim.Id)?.Email ?? hekim.Email,
            epostaDogrulandi = kimlik.BilgiGetir("hekim:" + hekim.Id)?.EmailDogrulamaTarihi != null,
            portalAdresleri = GetPortalUrls(),
            internetAdresi = InternetPortalUrl()
        });
    }

    [HttpPost("admin/account/{hekimId:int}")]
    public async Task<IActionResult> AdminSaveAccount(
        int hekimId,
        [FromBody] PortalAccountSaveDto dto,
        CancellationToken cancellationToken)
    {
        if (!IsLoopback(HttpContext.Connection.RemoteIpAddress))
            return StatusCode(StatusCodes.Status403Forbidden, "Portal hesap yönetimi yalnız ana Primer Lab bilgisayarından yapılabilir.");

        var hekim = await _db.Hekimler.FirstOrDefaultAsync(x => x.Id == hekimId, cancellationToken);
        if (hekim == null) return NotFound("Hekim bulunamadı.");

        var username = (dto.KullaniciAdi ?? string.Empty).Trim().ToLowerInvariant();
        if (!UsernameRegex.IsMatch(username))
            return BadRequest("Kullanıcı adı 3-64 karakter olmalı; yalnız harf, rakam, nokta, alt çizgi ve tire kullanılabilir.");

        var existing = await _db.Database.SqlQuery<PortalAccountSecretRow>($"""
            SELECT "Id","HekimId","KullaniciAdi","ParolaHash","ParolaSalt","Aktif"
            FROM "HekimPortalHesaplari"
            WHERE "HekimId"={hekimId}
            """).FirstOrDefaultAsync(cancellationToken);

        var duplicate = await _db.Database.SqlQuery<int>($"""
            SELECT COUNT(*)::int AS "Value"
            FROM "HekimPortalHesaplari"
            WHERE lower("KullaniciAdi")=lower({username})
              AND "HekimId"<>{hekimId}
            """).SingleAsync(cancellationToken);

        if (duplicate > 0) return Conflict("Bu kullanıcı adı başka bir hekim tarafından kullanılıyor.");

        var password = dto.YeniParola ?? string.Empty;
        if (existing == null && string.IsNullOrWhiteSpace(password))
            return BadRequest("Yeni portal hesabı için parola gereklidir.");

        if (!string.IsNullOrWhiteSpace(password) && !IsStrongEnough(password))
            return BadRequest("Parola en az 8 karakter olmalı ve en az bir harf ile bir rakam içermelidir.");

        string hash;
        string salt;

        if (!string.IsNullOrWhiteSpace(password))
        {
            salt = Convert.ToBase64String(RandomNumberGenerator.GetBytes(24));
            hash = HashPassword(password, salt);
        }
        else
        {
            hash = existing!.ParolaHash;
            salt = existing.ParolaSalt;
        }

        var now = DateTime.UtcNow;
        var active = dto.Aktif && hekim.Aktif;

        await _db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "HekimPortalHesaplari"
            ("HekimId","KullaniciAdi","ParolaHash","ParolaSalt","Aktif","OlusturmaTarihi","GuncellemeTarihi")
            VALUES ({hekimId},{username},{hash},{salt},{active},{now},{now})
            ON CONFLICT ("HekimId")
            DO UPDATE SET
                "KullaniciAdi"=EXCLUDED."KullaniciAdi",
                "ParolaHash"=EXCLUDED."ParolaHash",
                "ParolaSalt"=EXCLUDED."ParolaSalt",
                "Aktif"=EXCLUDED."Aktif",
                "GuncellemeTarihi"=EXCLUDED."GuncellemeTarihi"
            """, cancellationToken);

        return Ok(new
        {
            message = "Hekim portal hesabı kaydedildi.",
            hekimId,
            kullaniciAdi = username,
            aktif = active,
            parolaDegisti = !string.IsNullOrWhiteSpace(password)
        });
    }

    [HttpDelete("admin/account/{hekimId:int}")]
    public async Task<IActionResult> AdminDisableAccount(int hekimId, CancellationToken cancellationToken)
    {
        if (!IsLoopback(HttpContext.Connection.RemoteIpAddress))
            return StatusCode(StatusCodes.Status403Forbidden, "Portal hesap yönetimi yalnız ana Primer Lab bilgisayarından yapılabilir.");

        var count = await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE "HekimPortalHesaplari"
            SET "Aktif"=false,"GuncellemeTarihi"={DateTime.UtcNow}
            WHERE "HekimId"={hekimId}
            """, cancellationToken);

        if (count == 0) return NotFound("Portal hesabı bulunamadı.");
        return Ok(new { message = "Portal hesabı pasif hale getirildi." });
    }

    // =========================================================
    // PORTAL OTURUM
    // =========================================================

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] PortalLoginDto dto, [FromServices] PortalKimlik kimlik, CancellationToken cancellationToken)
    {
        // Tünel gerçek adresi iletmediyse (IPAddress.None) tüm hekimler aynı adreste görünür;
        // bu durumda yalnız kullanıcı adı sınırı uygulanır, bir hekimin hataları diğerlerini kilitlemez.
        var remote = HttpContext.Connection.RemoteIpAddress;
        var ip = remote == null || remote.Equals(System.Net.IPAddress.None) ? "ip:?" : "ip:" + remote;
        var ipKnown = ip != "ip:?";
        var username = (dto.KullaniciAdi ?? string.Empty).Trim().ToLowerInvariant();
        var password = dto.Parola ?? string.Empty;

        // Portal internete açık olabileceği için deneme sınırı hem IP hem kullanıcı adı bazındadır
        // (farklı adreslerden tek hesaba parola denemesi de durdurulur).
        var userKey = "u:" + username;
        var waitMinutes = 0;
        if ((ipKnown && IsLoginBlocked(ip, 5, out waitMinutes)) || IsLoginBlocked(userKey, 10, out waitMinutes))
            return StatusCode(StatusCodes.Status429TooManyRequests,
                $"Çok fazla başarısız giriş denemesi. Yaklaşık {waitMinutes} dakika sonra tekrar deneyin.");
        if (ipKnown && !kimlik.Izin("giris-ip:" + ip, 40, TimeSpan.FromMinutes(10)))
            return StatusCode(StatusCodes.Status429TooManyRequests, "Çok fazla giriş isteği. Birkaç dakika sonra tekrar deneyin.");

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
            return BadRequest("Kullanıcı adı ve şifre gereklidir.");

        var account = await _db.Database.SqlQuery<PortalLoginRow>($"""
            SELECT
                p."Id",p."HekimId",p."KullaniciAdi",p."ParolaHash",p."ParolaSalt",p."Aktif",
                h."AdSoyad" AS "HekimAdi",h."KlinikAdi",h."Aktif" AS "HekimAktif"
            FROM "HekimPortalHesaplari" p
            INNER JOIN "Hekimler" h ON h."Id"=p."HekimId"
            WHERE lower(p."KullaniciAdi")=lower({username})
            LIMIT 1
            """).FirstOrDefaultAsync(cancellationToken);

        bool? dogru = account == null ? false
            : await kimlik.OzetKapisindan(() => VerifyPassword(password, account.ParolaSalt, account.ParolaHash), cancellationToken);
        if (dogru == null) return StatusCode(StatusCodes.Status503ServiceUnavailable, PortalKimlik.YogunMesaj);

        if (account == null || dogru == false || !account.HekimAktif)
        {
            if (ipKnown) RegisterLoginFailure(ip);
            if (username.Length > 0) RegisterLoginFailure(userKey);
            await Task.Delay(Random.Shared.Next(150, 450), cancellationToken);
            return Unauthorized("Kullanıcı adı veya şifre hatalı.");
        }

        LoginAttempts.TryRemove(ip, out _);
        LoginAttempts.TryRemove(userKey, out _);

        var hesap = "hekim:" + account.HekimId;
        if (!account.Aktif)
            return StatusCode(StatusCodes.Status403Forbidden, kimlik.BilgiGetir(hesap)?.OnayBekliyor == true
                ? "Kaydınız laboratuvarın onayını bekliyor. Onaylandığında bu bilgilerle giriş yapabilirsiniz."
                : "Hesabınız pasif. Lütfen laboratuvarla görüşün.");

        // E-posta doğrulaması: kayıtlı adrese 6 haneli kod gönderilir ("bu cihazı hatırla" seçildiyse atlanır).
        Request.Cookies.TryGetValue(CihazCerezi, out var cihaz);
        var (yanit, oturumAc, hata) = kimlik.GirisSonrasi(hesap, account.ParolaHash, cihaz);
        if (hata != null) return StatusCode(StatusCodes.Status429TooManyRequests, hata);
        if (!oturumAc) return Ok(yanit);
        return await OturumAc(account.HekimId, cancellationToken);
    }

    private const string CihazCerezi = "primer_hekim_cihaz";

    // E-postası kayıtlı olmayan hesap: adresini yazar, koda doğrulanınca kaydedilir.
    [HttpPost("login/eposta")]
    public IActionResult LoginEposta([FromBody] EpostaKodDto dto, [FromServices] PortalKimlik kimlik)
    {
        var (yanit, hata) = kimlik.GirisEpostasi(dto.Jeton, "hekim:", dto.Eposta);
        return hata != null ? BadRequest(hata) : Ok(yanit);
    }

    [HttpPost("login/kod")]
    public async Task<IActionResult> LoginKod([FromBody] EpostaKodDto dto, [FromServices] PortalKimlik kimlik, CancellationToken cancellationToken)
    {
        var (hesap, hata) = kimlik.GirisKoduDogrula(dto.Jeton, dto.Kod, "hekim:");
        if (hata != null)
        {
            await Task.Delay(Random.Shared.Next(150, 450), cancellationToken);
            return Unauthorized(hata);
        }
        var hekimId = PortalKimlik.HesapId(hesap!);
        if (dto.Hatirla)
        {
            var ozet = await _db.Database.SqlQuery<string>($"""
                SELECT "ParolaHash" AS "Value" FROM "HekimPortalHesaplari" WHERE "HekimId"={hekimId}
                """).FirstOrDefaultAsync(cancellationToken);
            if (ozet != null)
            {
                var gun = kimlik.AyarlariOku().CihazHatirlaGun;
                Request.Cookies.TryGetValue(CihazCerezi, out var mevcut);
                PortalKimlik.CihazCereziYaz(HttpContext, CihazCerezi,
                    PortalKimlik.CihazCereziEkle(mevcut, kimlik.CihazJetonu(hesap!, ozet, gun)), gun);
            }
        }
        await EpostayiHekimeYaz(hekimId, kimlik.BilgiGetir(hesap!)?.Email, cancellationToken);
        return await OturumAc(hekimId, cancellationToken);
    }

    [HttpPost("login/kod-tekrar")]
    public IActionResult LoginKodTekrar([FromBody] EpostaKodDto dto, [FromServices] PortalKimlik kimlik)
    {
        var hata = kimlik.KoduTekrarGonder(dto.Jeton);
        return hata != null ? StatusCode(StatusCodes.Status429TooManyRequests, hata) : Ok(new { message = "Yeni kod gönderildi." });
    }

    // Hekim kartında e-posta boşsa doğrulanan adres yazılır (laboratuvar hekimin e-postasını görür).
    private async Task EpostayiHekimeYaz(int hekimId, string? email, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(email)) return;
        await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE "Hekimler" SET "Email"={email} WHERE "Id"={hekimId} AND COALESCE("Email",'')=''
            """, ct);
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

        var adSoyad = Normalize(dto.AdSoyad, 150);
        var klinik = Normalize(dto.KlinikAdi, 150);
        var telefon = Normalize(dto.Telefon, 30);
        var email = PortalKimlik.EpostaNormalize(dto.Eposta);
        var username = (dto.KullaniciAdi ?? string.Empty).Trim().ToLowerInvariant();
        if (adSoyad == null || adSoyad.Length < 3) return BadRequest("Adınızı ve soyadınızı yazın.");
        if (email == null) return BadRequest("Geçerli bir e-posta adresi girin.");
        if (!UsernameRegex.IsMatch(username))
            return BadRequest("Kullanıcı adı 3-64 karakter olmalı; yalnız harf, rakam, nokta, alt çizgi ve tire kullanılabilir.");
        var parolaHatasi = PortalKimlik.ParolaKontrol(dto.Parola);
        if (parolaHatasi != null) return BadRequest(parolaHatasi);
        if (!dto.Kvkk) return BadRequest("Devam etmek için bilgilendirme metnini onaylayın.");

        var kullanimda = await _db.Database.SqlQuery<int>($"""
            SELECT COUNT(*)::int AS "Value" FROM "HekimPortalHesaplari" WHERE lower("KullaniciAdi")=lower({username})
            """).SingleAsync(ct);
        if (kullanimda > 0) return Conflict("Bu kullanıcı adı alınmış. Başka bir kullanıcı adı seçin.");
        var sahip = kimlik.EpostaSahibi(email);
        if (sahip != null && sahip.StartsWith("hekim:", StringComparison.Ordinal))
            return Conflict("Bu e-posta ile kayıtlı bir hesap var. Giriş yapın ya da \"Şifremi unuttum\"u kullanın.");

        var ozet = await kimlik.OzetKapisindan(() =>
        {
            var salt = Convert.ToBase64String(RandomNumberGenerator.GetBytes(24));
            return new[] { HashPassword(dto.Parola!, salt), salt };
        }, ct);
        if (ozet == null) return StatusCode(StatusCodes.Status503ServiceUnavailable, PortalKimlik.YogunMesaj);

        var veri = JsonSerializer.Serialize(new HekimKayitVerisi(adSoyad, klinik, telefon, username, ozet[0], ozet[1], PortalKimlik.IpAnahtari(HttpContext)));
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
        var onay = kimlik.AyarlariOku().OnayGereksin;
        if (kimlik.EpostaSahibi(k.Email) is { } sahip && sahip.StartsWith("hekim:", StringComparison.Ordinal))
            return Conflict("Bu e-posta ile kayıtlı bir hesap var. Giriş yapın ya da \"Şifremi unuttum\"u kullanın.");

        int hekimId = 0;
        try
        {
            var strategy = _db.Database.CreateExecutionStrategy();
            await strategy.ExecuteAsync(async () =>
            {
                await using var tx = await _db.Database.BeginTransactionAsync(ct);
                // Laboratuvarda bu e-postayla kayıtlı (portal hesabı olmayan) hekim varsa ona bağlanır:
                // mevcut fiyat listesi ve işleri görünür. Yoksa yeni hekim kartı açılır.
                var mevcut = await _db.Database.SqlQuery<int>($"""
                    SELECT h."Id" AS "Value" FROM "Hekimler" h
                    WHERE lower(h."Email")=lower({k.Email}) AND h."Aktif"=true
                      AND NOT EXISTS (SELECT 1 FROM "HekimPortalHesaplari" p WHERE p."HekimId"=h."Id")
                    ORDER BY h."Id" LIMIT 1
                    """).ToListAsync(ct);
                if (mevcut.Count > 0) hekimId = mevcut[0];
                else
                    hekimId = (await _db.Database.SqlQuery<int>($"""
                        INSERT INTO "Hekimler" ("AdSoyad","KlinikAdi","Telefon","Email","Aktif","OlusturmaTarihi")
                        VALUES ({v.AdSoyad},{v.KlinikAdi},{v.Telefon},{k.Email},true,{DateTime.UtcNow})
                        RETURNING "Id" AS "Value"
                        """).ToListAsync(ct))[0];
                var now = DateTime.UtcNow;
                await _db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO "HekimPortalHesaplari"
                    ("HekimId","KullaniciAdi","ParolaHash","ParolaSalt","Aktif","OlusturmaTarihi","GuncellemeTarihi")
                    VALUES ({hekimId},{v.KullaniciAdi},{v.ParolaHash},{v.ParolaSalt},{!onay},{now},{now})
                    """, ct);
                await tx.CommitAsync(ct);
            });
        }
        catch (Exception ex) when (TekilIhlali(ex))
        {
            return Conflict("Bu kullanıcı adı az önce başka biri tarafından alındı. Lütfen baştan başlayıp başka bir kullanıcı adı seçin.");
        }

        var hesap = "hekim:" + hekimId;
        kimlik.BilgiGuncelle(hesap, b =>
        {
            b.Email = k.Email;
            b.EmailDogrulamaTarihi = DateTime.UtcNow;
            b.KendiKaydi = true;
            b.KayitTarihi = DateTime.UtcNow;
            b.OnayBekliyor = onay;
            b.KayitIp = v.Ip;
            b.Telefon = v.Telefon;
        });

        if (onay) return Ok(new { onayBekliyor = true, message = "Kaydınız alındı. Laboratuvar onayladığında giriş yapabilirsiniz." });
        return await OturumAc(hekimId, ct);
    }

    [HttpPost("sifre/basla")]
    public async Task<IActionResult> SifreBasla([FromBody] SifreSifirlaDto dto, [FromServices] PortalKimlik kimlik, CancellationToken ct)
    {
        if (!kimlik.EpostaHazir) return StatusCode(StatusCodes.Status503ServiceUnavailable, "Şifre sıfırlama için laboratuvarın e-posta ayarı yapılmamış. Laboratuvarla görüşün.");
        if (!kimlik.ZorlukDogrula(dto.ZorlukJeton, dto.ZorlukCevap))
            return BadRequest("Güvenlik doğrulaması tamamlanamadı. Sayfayı yenileyip tekrar deneyin.");
        var izin = kimlik.BasvuruIzni(HttpContext, "sifre");
        if (izin != null) return StatusCode(StatusCodes.Status429TooManyRequests, izin);

        var giris = (dto.Kimlik ?? string.Empty).Trim().ToLowerInvariant();
        string? hesap = null;
        if (giris.Contains('@'))
        {
            var e = PortalKimlik.EpostaNormalize(giris);
            var s = e == null ? null : kimlik.EpostaSahibi(e);
            if (s != null && s.StartsWith("hekim:", StringComparison.Ordinal)) hesap = s;
        }
        else if (giris.Length > 0)
        {
            var id = await _db.Database.SqlQuery<int>($"""
                SELECT "HekimId" AS "Value" FROM "HekimPortalHesaplari" WHERE lower("KullaniciAdi")={giris}
                """).ToListAsync(ct);
            if (id.Count > 0) hesap = "hekim:" + id[0];
        }

        var bilgi = hesap == null ? null : kimlik.BilgiGetir(hesap);
        string? jeton = null;
        if (bilgi?.Email != null && bilgi.EmailDogrulamaTarihi != null)
        {
            var (j, hata) = kimlik.KodGonder(PortalKimlik.AmacSifre, hesap, bilgi.Email);
            if (hata != null) return StatusCode(StatusCodes.Status429TooManyRequests, hata);
            jeton = j;
        }
        // Hesap bulunamasa da aynı yanıt verilir (kimin kayıtlı olduğu dışarıdan anlaşılmasın).
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
        if (k!.Hesap == null || !k.Hesap.StartsWith("hekim:", StringComparison.Ordinal)) return Unauthorized("Süre doldu. Lütfen baştan başlayın.");
        var ozet = await kimlik.OzetKapisindan(() =>
        {
            var salt = Convert.ToBase64String(RandomNumberGenerator.GetBytes(24));
            return new[] { HashPassword(dto.YeniParola!, salt), salt };
        }, ct);
        if (ozet == null) return StatusCode(StatusCodes.Status503ServiceUnavailable, PortalKimlik.YogunMesaj);
        await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE "HekimPortalHesaplari" SET "ParolaHash"={ozet[0]},"ParolaSalt"={ozet[1]},"GuncellemeTarihi"={DateTime.UtcNow}
            WHERE "HekimId"={PortalKimlik.HesapId(k.Hesap)}
            """, ct);
        return Ok(new { message = "Şifreniz yenilendi. Yeni şifrenizle giriş yapabilirsiniz." });
    }

    internal static bool TekilIhlali(Exception ex)
    {
        for (var e = ex; e != null; e = e.InnerException)
            if (e is Npgsql.PostgresException pg && pg.SqlState == "23505") return true;
        return false;
    }

    private async Task<IActionResult> OturumAc(int hekimId, CancellationToken cancellationToken)
    {
        var account = await _db.Database.SqlQuery<PortalLoginRow>($"""
            SELECT
                p."Id",p."HekimId",p."KullaniciAdi",p."ParolaHash",p."ParolaSalt",p."Aktif",
                h."AdSoyad" AS "HekimAdi",h."KlinikAdi",h."Aktif" AS "HekimAktif"
            FROM "HekimPortalHesaplari" p
            INNER JOIN "Hekimler" h ON h."Id"=p."HekimId"
            WHERE p."HekimId"={hekimId}
            LIMIT 1
            """).FirstOrDefaultAsync(cancellationToken);
        if (account == null || !account.Aktif || !account.HekimAktif)
            return Unauthorized("Portal hesabı pasif.");

        var expiresUtc = DateTime.UtcNow.AddHours(12);
        var session = new PortalSession
        {
            HekimId = account.HekimId,
            ExpiresUtc = expiresUtc,
            Nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(16))
        };

        var protectedValue = _protector.Protect(JsonSerializer.Serialize(session));

        Response.Cookies.Append(CookieName, protectedValue, new CookieOptions
        {
            HttpOnly = true,
            Secure = Request.IsHttps,
            SameSite = SameSiteMode.Strict,
            Expires = expiresUtc,
            IsEssential = true,
            Path = "/"
        });

        await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE "HekimPortalHesaplari"
            SET "SonGirisTarihi"={DateTime.UtcNow},"GuncellemeTarihi"={DateTime.UtcNow}
            WHERE "Id"={account.Id}
            """, cancellationToken);

        return Ok(new
        {
            hekimId = account.HekimId,
            hekimAdi = account.HekimAdi,
            klinikAdi = account.KlinikAdi,
            expiresUtc
        });
    }

    [HttpPost("logout")]
    public IActionResult Logout()
    {
        Response.Cookies.Delete(CookieName, new CookieOptions { Path = "/" });
        return Ok(new { message = "Oturum kapatıldı." });
    }

    [HttpGet("me")]
    public async Task<IActionResult> Me(CancellationToken cancellationToken)
    {
        var session = await RequireSession(cancellationToken);
        if (session.Error != null) return session.Error;

        var hekimId = session.HekimId;
        var hekim = await _db.Hekimler.AsNoTracking()
            .Where(x => x.Id == hekimId && x.Aktif)
            .Select(x => new { x.Id, x.AdSoyad, x.KlinikAdi, x.Telefon, x.Email })
            .FirstOrDefaultAsync(cancellationToken);

        if (hekim == null) return Unauthorized("Hekim hesabı pasif veya bulunamadı.");

        var prices = await PortalPriceList(hekimId, cancellationToken);

        return Ok(new
        {
            hekim,
            // Hekim portali bir musteri ekranidir. Fiyat ve para birimi portal istemcisine gonderilmez.
            isTurleri = prices.Select(x => new
            {
                isTuru = x.IsTuru
            })
        });
    }

    // =========================================================
    // PORTAL İŞLERİ
    // =========================================================

    [HttpGet("jobs")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> Jobs(CancellationToken cancellationToken)
    {
        var session = await RequireSession(cancellationToken);
        if (session.Error != null) return session.Error;

        var rows = await _db.Database.SqlQuery<PortalJobRow>($"""
            SELECT
                s."Id",
                p."AdSoyad" AS "HastaAdi",
                s."Durum",
                COALESCE(s."OnayDurumu",'Onaylandı') AS "OnayDurumu",
                s."OlusturmaTarihi",
                s."TerminTarihi",
                s."DisRengi",
                s."DisSemasi",
                s."Materyal",
                s."Notlar",
                COALESCE(s."PortalTasarimKaynagi",'lab') AS "TasarimKaynagi",
                COALESCE(s."ParaBirimi",'TRY') AS "ParaBirimi",
                COALESCE((SELECT SUM(k."Adet") FROM "SiparisKalemleri" k WHERE k."SiparisId"=s."Id"),0)::int AS "ToplamAdet",
                COALESCE((SELECT COUNT(*) FROM "IsDosyalari" f WHERE f."SiparisId"=s."Id"),0)::int AS "DosyaSayisi",
                COALESCE((SELECT COUNT(*) FROM "IsMesajlari" m WHERE m."SiparisId"=s."Id" AND m."GonderenTipi" IN ('Hekim','Laboratuvar')),0)::int AS "MesajSayisi"
            FROM "Siparisler" s
            INNER JOIN "Hastalar" p ON p."Id"=s."HastaId"
            WHERE p."HekimId"={session.HekimId}
              AND COALESCE(s."Silindi",false)=false
              AND COALESCE(s."Aktif",true)=true
              AND COALESCE(p."Aktif",true)=true
            ORDER BY s."OlusturmaTarihi" DESC,s."Id" DESC
            LIMIT 500
            """).ToListAsync(cancellationToken);

        var ids = rows.Select(x => x.Id).ToArray();
        var items = new List<PortalJobItemRow>();

        if (ids.Length > 0)
        {
            items = await _db.Database.SqlQuery<PortalJobItemRow>($"""
                SELECT "SiparisId","IsTuru","Adet","BirimFiyat"
                FROM "SiparisKalemleri"
                WHERE "SiparisId" = ANY({ids})
                ORDER BY "SiparisId","Id"
                """).ToListAsync(cancellationToken);
        }

        var byJob = items.GroupBy(x => x.SiparisId).ToDictionary(g => g.Key, g => g.ToList());

        // Laboratuvardan gelen, hekimin henüz okumadığı mesajlar.
        var labMesajlari = ids.Length == 0 ? new List<MesajNoSatiri>() : await _db.Database.SqlQuery<MesajNoSatiri>($"""
            SELECT "SiparisId","Id","GonderenTipi" FROM "IsMesajlari"
            WHERE "SiparisId" = ANY({ids}) AND "GonderenTipi"='Laboratuvar'
            """).ToListAsync(cancellationToken);
        var sinir = _takip.OkunmaSiniri("hekim:" + session.HekimId);
        var okunmamis = labMesajlari.Where(m => m.Id > sinir(m.SiparisId)).GroupBy(m => m.SiparisId).ToDictionary(g => g.Key, g => g.Count());

        var linkSayilari = HttpContext.RequestServices.GetRequiredService<IsLinkleri>().Sayilar();
        // Laboratuvar / teknisyenin yüklediği tasarım ve yazıcı (CTB) dosyaları iş kartında doğrudan indirilir.
        var hazir = ids.Length == 0 ? new List<HazirDosyaSatiri>() : await _db.Database.SqlQuery<HazirDosyaSatiri>($"""
            SELECT "Id","SiparisId","DosyaTuru","OrijinalDosyaAdi","Boyut","YuklemeTarihi"
            FROM "IsDosyalari"
            WHERE "SiparisId" = ANY({ids}) AND "DosyaTuru" IN ('Tasarım','Yazıcı')
            ORDER BY "YuklemeTarihi" DESC,"Id" DESC
            """).ToListAsync(cancellationToken);
        var paylasim = HttpContext.RequestServices.GetRequiredService<HekimPaylasimi>().Tumu();
        var yukleyenler = _takip.DosyaBilgileri(hazir.Select(f => f.Id));
        var hazirIs = hazir
            .Where(f => !(yukleyenler.TryGetValue(f.Id, out var yb) && yb.YukleyenTipi == "Hekim"))
            .GroupBy(f => f.SiparisId)
            .ToDictionary(g => g.Key, g => g.Select(f => new
            {
                f.Id, f.DosyaTuru, f.OrijinalDosyaAdi, f.Boyut, f.YuklemeTarihi,
                Yeni = paylasim.TryGetValue(f.Id, out var pk) && pk.HekimIndirdi == null
            }).ToList());
        return Ok(rows.Select(x => new
        {
            HazirDosyalar = hazirIs.TryGetValue(x.Id, out var hd) ? (object)hd : Array.Empty<object>(),
            OkunmamisMesaj = okunmamis.TryGetValue(x.Id, out var om) ? om : 0,
            x.Id,
            x.HastaAdi,
            x.Durum,
            x.OnayDurumu,
            x.OlusturmaTarihi,
            x.TerminTarihi,
            x.DisRengi,
            x.DisSemasi,
            x.Materyal,
            x.Notlar,
            x.TasarimKaynagi,
            x.ToplamAdet,
            x.DosyaSayisi,
            LinkSayisi = linkSayilari.TryGetValue(x.Id, out var ls) ? ls : 0,
            x.MesajSayisi,
            kalemler = byJob.TryGetValue(x.Id, out var list)
                ? list.Select(k => (object)new { k.IsTuru, k.Adet }).ToArray()
                : Array.Empty<object>()
        }));
    }

    [HttpPost("jobs")]
    [RequestSizeLimit(MaxRequestSize)]
    public async Task<IActionResult> CreateJob(
        [FromForm] string payload,
        [FromForm] List<IFormFile>? files,
        CancellationToken cancellationToken)
    {
        var session = await RequireSession(cancellationToken);
        if (session.Error != null) return session.Error;
        return await IsKaydet(session.HekimId, "Hekim Portalı", null, payload, files, cancellationToken);
    }

    // =========================================================
    // İÇ TEKNİSYEN — hekim adına sipariş formu (Teknisyen Paneli > Sipariş Formu)
    // =========================================================

    [HttpGet("teknisyen/hekimler")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> TeknisyenHekimler(CancellationToken cancellationToken)
    {
        var tek = await IcTeknisyen(cancellationToken);
        if (tek.Error != null) return tek.Error;
        var liste = await _db.Database.SqlQuery<TeknisyenHekimSatiri>($"""
            SELECT h."Id", h."AdSoyad", h."KlinikAdi",
                   (SELECT COUNT(*)::int FROM "HekimFiyatlari" f WHERE f."HekimId"=h."Id" AND f."Aktif"=true) AS "IsTuruSayisi"
            FROM "Hekimler" h
            WHERE h."Aktif"=true
            ORDER BY h."AdSoyad"
            """).ToListAsync(cancellationToken);
        return Ok(new { teknisyen = new { adSoyad = tek.Ad }, hekimler = liste });
    }

    [HttpGet("teknisyen/me")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> TeknisyenHekimBilgisi([FromQuery] int hekimId, CancellationToken cancellationToken)
    {
        var tek = await IcTeknisyen(cancellationToken);
        if (tek.Error != null) return tek.Error;
        var hekim = await _db.Hekimler.AsNoTracking()
            .Where(x => x.Id == hekimId && x.Aktif)
            .Select(x => new { x.Id, x.AdSoyad, x.KlinikAdi, x.Telefon, x.Email })
            .FirstOrDefaultAsync(cancellationToken);
        if (hekim == null) return NotFound("Hekim bulunamadı veya pasif.");
        var prices = await PortalPriceList(hekimId, cancellationToken);
        return Ok(new { hekim, isTurleri = prices.Select(x => new { isTuru = x.IsTuru }) });
    }

    [HttpPost("teknisyen/jobs")]
    [RequestSizeLimit(MaxRequestSize)]
    public async Task<IActionResult> TeknisyenIsOlustur(
        [FromQuery] int hekimId,
        [FromForm] string payload,
        [FromForm] List<IFormFile>? files,
        CancellationToken cancellationToken)
    {
        var tek = await IcTeknisyen(cancellationToken);
        if (tek.Error != null) return tek.Error;
        var aktif = await _db.Hekimler.AsNoTracking().AnyAsync(x => x.Id == hekimId && x.Aktif, cancellationToken);
        if (!aktif) return BadRequest("Hekim seçin.");
        return await IsKaydet(hekimId, "Teknisyen Paneli", tek.Ad, payload, files, cancellationToken);
    }

    // Teknisyen Paneli çerezinden yalnız aktif İÇ teknisyen kabul edilir (dış teknisyen sipariş açamaz).
    private async Task<(int Id, string Ad, IActionResult? Error)> IcTeknisyen(CancellationToken cancellationToken)
    {
        if (!Request.Cookies.TryGetValue("primer_teknisyen", out var cerez) || string.IsNullOrWhiteSpace(cerez))
            return (0, "", Unauthorized("Teknisyen oturumu bulunamadı. Teknisyen Paneli'nden giriş yapın."));
        int tekId;
        try
        {
            using var belge = JsonDocument.Parse(_teknisyenProtector.Unprotect(cerez));
            tekId = belge.RootElement.GetProperty("TeknisyenId").GetInt32();
            if (belge.RootElement.GetProperty("Bitis").GetDateTime() <= DateTime.UtcNow)
                return (0, "", Unauthorized("Teknisyen oturumu sona erdi."));
        }
        catch
        {
            return (0, "", Unauthorized("Teknisyen oturumu geçersiz."));
        }
        var hesap = _teknisyenHesaplari.Getir(tekId);
        if (hesap == null || !hesap.Aktif) return (0, "", Unauthorized("Teknisyen hesabı pasif."));
        if (hesap.Tip != TeknisyenHesapDeposu.Ic)
            return (0, "", StatusCode(StatusCodes.Status403Forbidden, "Sipariş formunu yalnız iç teknisyenler açabilir."));
        var ad = await _db.Database.SqlQuery<string>($"""
            SELECT "AdSoyad" AS "Value" FROM "Teknisyenler" WHERE "Id"={tekId} AND COALESCE("Aktif",true)=true
            """).FirstOrDefaultAsync(cancellationToken);
        return ad == null ? (0, "", Unauthorized("Teknisyen hesabı pasif.")) : (tekId, ad, null);
    }

    // Hekim Portalı ve iç teknisyen sipariş formunun ortak kaydı: fiyat hekimin listesinden alınır,
    // iş "Gelen Onay" olarak laboratuvar onayına düşer.
    private async Task<IActionResult> IsKaydet(
        int hekimId, string kaynak, string? teknisyenAdi, string payload, List<IFormFile>? files, CancellationToken cancellationToken)
    {
        PortalNewJobDto dto;
        try
        {
            dto = JsonSerializer.Deserialize<PortalNewJobDto>(payload, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            }) ?? new PortalNewJobDto();
        }
        catch
        {
            return BadRequest("Form verisi okunamadı.");
        }

        var validation = ValidateNewJob(dto);
        if (validation != null) return BadRequest(validation);

        files ??= new List<IFormFile>();
        if (files.Count > 8) return BadRequest("Bir iş için en fazla 8 dosya yüklenebilir.");
        // Linkler iş kaydedilmeden önce denetlenir (hatalı link yüzünden yarım kayıt oluşmasın).
        var linkler = (dto.Linkler ?? new()).Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()).Distinct().ToList();
        if (linkler.Count > IsLinkleri.IsBasinaEnFazla) return BadRequest($"Bir işe en fazla {IsLinkleri.IsBasinaEnFazla} link eklenebilir.");
        foreach (var l in linkler)
            if (IsLinkleri.Dogrula(l, out var linkHata) == null) return BadRequest(linkHata);
        if (files.Sum(x => x.Length) > MaxRequestSize - (2L * 1024L * 1024L))
            return BadRequest("Toplam dosya boyutu çok yüksek.");

        foreach (var file in files)
        {
            var fileError = ValidateFile(file);
            if (fileError != null) return BadRequest(fileError);
        }

        // Para birimi ve fiyat bilgisi yalnız ana Primer Lab'de kullanılır.
        // Hekim bu bilgileri portalda görmez.
        var allowedPrices = await PortalPriceList(hekimId, cancellationToken);
        var priceMap = allowedPrices.ToDictionary(x => x.IsTuru, StringComparer.CurrentCultureIgnoreCase);

        // Fiyat hekime tanımlı listeden otomatik alınır; portal istemcisinden fiyat kabul edilmez.
        // Adet gönderilmediyse kaleme seçilen diş sayısı kullanılır (köprü: 3 diş = 3 üye;
        // gece plağı gibi çene işlerinde hekim adedi 1 bırakır).
        var cleanItems = new List<(PortalNewJobItemDto Dto, PortalPriceRow Price)>();
        foreach (var item in dto.Kalemler)
        {
            var name = item.IsTuru.Trim();
            if (!priceMap.TryGetValue(name, out var price))
                return BadRequest($"'{name}' hekime tanımlı iş listesinde bulunmuyor.");

            if (item.Disler is { Count: > 0 })
            {
                item.Disler = item.Disler.Distinct().OrderBy(x => x).ToList();
                if (item.Adet <= 0) item.Adet = item.Disler.Count;
            }

            cleanItems.Add((item, price));
        }

        // Aynı portal talebinde TRY/EUR/USD birlikte seçilebilir.
        // Ana muhasebe düzenini bozmamak için talep arka planda para birimine göre ayrı siparişlere bölünür.
        var currencyGroups = cleanItems
            .GroupBy(x => NormalizeCurrency(x.Price.ParaBirimi))
            .OrderBy(x => x.Key)
            .ToList();

        var termin = NormalizeDate(dto.TerminTarihi);
        var teeth = AllTeeth(dto).ToArray();
        var toothText = string.Join(",", teeth);
        var notes = Normalize(dto.Notlar, 4000);
        var jobNotes = Normalize(BuildJobNotes(dto, cleanItems.Select(x => (x.Price.IsTuru, x.Dto)).ToList(), notes,
            teknisyenAdi != null ? "[Teknisyen Paneli — " + teknisyenAdi + "]" : "[Hekim Portalı]"), 8000);
        var designSource = dto.TasarimKaynagi == "doctor" ? "doctor" : "lab";
        var portalSubmissionId = Guid.NewGuid();
        var hekimAdiKayit = await _db.Hekimler.AsNoTracking().Where(x => x.Id == hekimId).Select(x => x.AdSoyad).FirstOrDefaultAsync(cancellationToken) ?? "Hekim";
        var yukleyenTipi = teknisyenAdi != null ? "Teknisyen" : "Hekim";
        var yukleyenAdi = teknisyenAdi != null ? teknisyenAdi + " (" + hekimAdiKayit + " adına)" : hekimAdiKayit;
        var savedPaths = new List<string>();
        var createdJobIds = new List<int>();

        var strategy = _db.Database.CreateExecutionStrategy();

        try
        {
            await strategy.ExecuteAsync(async () =>
            {
                await using var tx = await _db.Database.BeginTransactionAsync(cancellationToken);
                try
                {
                    foreach (var group in currencyGroups)
                    {
                        var currency = group.Key;
                        var groupItems = group.ToList();

                        var hasta = new Hasta
                        {
                            AdSoyad = dto.HastaAdi.Trim(),
                            HekimId = hekimId,
                            Telefon = null,
                            Notlar = notes,
                            Aktif = true,
                            OlusturmaTarihi = DateTime.UtcNow
                        };

                        var siparis = new Siparis
                        {
                            Hasta = hasta,
                            Durum = "Bekliyor",
                            Notlar = jobNotes,
                            Aktif = true,
                            OlusturmaTarihi = DateTime.UtcNow,
                            Kalemler = groupItems.Select(x => new SiparisKalemi
                            {
                                IsTuru = x.Price.IsTuru,
                                Adet = x.Dto.Adet,
                                BirimFiyat = x.Price.BirimFiyat
                            }).ToList()
                        };

                        _db.Hastalar.Add(hasta);
                        _db.Siparisler.Add(siparis);
                        await _db.SaveChangesAsync(cancellationToken);
                        createdJobIds.Add(siparis.Id);

                        await _db.Database.ExecuteSqlInterpolatedAsync($"""
                            UPDATE "Siparisler"
                            SET
                                "OnayDurumu"='Gelen Onay',
                                "Kaynak"={kaynak},
                                "TerminTarihi"={termin},
                                "DisRengi"={Normalize(dto.DisRengi,50)},
                                "DisSemasi"={Normalize(toothText,250)},
                                "Materyal"={Normalize(dto.Materyal,120)},
                                "ParaBirimi"={currency},
                                "PortalTasarimKaynagi"={designSource},
                                "PortalGonderimId"={portalSubmissionId},
                                "Silindi"=false,
                                "SilinmeTarihi"=NULL
                            WHERE "Id"={siparis.Id}
                            """, cancellationToken);

                        var gonderen = teknisyenAdi != null
                            ? $"Teknisyen Paneli'nden {teknisyenAdi} tarafından açıldı"
                            : "Hekim Portalı üzerinden gönderildi";
                        var splitNote = currencyGroups.Count > 1
                            ? $"{gonderen}; tek talep, muhasebe için {currency} grubuna ayrıldı. Gelen İş Onayı bekliyor."
                            : $"{gonderen}; Gelen İş Onayı bekliyor.";

                        await _db.Database.ExecuteSqlInterpolatedAsync($"""
                            INSERT INTO "SiparisDurumGecmisi"
                            ("SiparisId","EskiDurum","YeniDurum","DegisimTarihi","Aciklama")
                            VALUES ({siparis.Id},{(string?)null},{"Bekliyor"},{DateTime.UtcNow},{splitNote})
                            """, cancellationToken);

                        // Dosyalar talebin tamamına aittir. İçeride bölünen her siparişe aynı dosyaların
                        // ayrı fiziksel kopyası kaydedilir; böylece hangi sipariş açılırsa açılsın dosya erişimi eksiksizdir.
                        foreach (var file in files)
                        {
                            var saved = await SavePortalFile(siparis.Id, file, designSource, yukleyenTipi, yukleyenAdi, cancellationToken);
                            savedPaths.Add(saved.FullPath);
                        }
                    }

                    await tx.CommitAsync(cancellationToken);
                }
                catch
                {
                    await tx.RollbackAsync(cancellationToken);
                    throw;
                }
            });
        }
        catch
        {
            foreach (var path in savedPaths)
            {
                try { if (System.IO.File.Exists(path)) System.IO.File.Delete(path); } catch { }
            }
            throw;
        }

        if (linkler.Count > 0)
        {
            var linkDeposu = HttpContext.RequestServices.GetRequiredService<IsLinkleri>();
            foreach (var isId in createdJobIds)
                linkDeposu.Ekle(isId, linkler, null, teknisyenAdi != null ? "Teknisyen" : "Hekim", teknisyenAdi);
        }

        return Ok(new
        {
            linkSayisi = linkler.Count,
            message = createdJobIds.Count > 1
                ? "İş laboratuvara gönderildi. Farklı muhasebe para birimleri ana sistemde otomatik olarak ayrı iş kayıtlarına ayrıldı."
                : "İş laboratuvara gönderildi ve Gelen İş Onayı kuyruğuna eklendi.",
            siparisId = createdJobIds.FirstOrDefault(),
            siparisIds = createdJobIds,
            portalGonderimId = portalSubmissionId,
            dosyaSayisi = files.Count,
            dahiliKayitSayisi = createdJobIds.Count
        });
    }

    // İş bazında laboratuvarla yazışma (ana programdaki Mesajlar ekranıyla aynı kayıtlar).
    [HttpGet("jobs/{jobId:int}/messages")]
    public async Task<IActionResult> JobMessages(int jobId, CancellationToken cancellationToken)
    {
        var session = await RequireSession(cancellationToken);
        if (session.Error != null) return session.Error;
        if (!await OwnsJob(session.HekimId, jobId, cancellationToken)) return NotFound("İş bulunamadı.");

        // Yalnız hekim ↔ laboratuvar kanalı; laboratuvar ile teknisyen arasındaki iç yazışma hekime gösterilmez.
        var rows = await _db.Database.SqlQuery<IsMesajSatiri>($"""
            SELECT "Id","GonderenTipi","GonderenAdi","Mesaj","Tarih"
            FROM "IsMesajlari" WHERE "SiparisId"={jobId} AND "GonderenTipi" IN ('Hekim','Laboratuvar')
            ORDER BY "Tarih","Id"
            """).ToListAsync(cancellationToken);
        if (rows.Count > 0) _takip.MesajOkundu("hekim:" + session.HekimId, jobId, rows.Max(x => x.Id));

        // Laboratuvar içi kişiler (teknisyen adları) hekime gösterilmez.
        return Ok(rows.Select(m => new
        {
            m.Id,
            Gonderen = m.GonderenTipi == "Hekim" ? "Siz" : "Laboratuvar",
            Benim = m.GonderenTipi == "Hekim",
            m.Mesaj,
            m.Tarih
        }));
    }

    [HttpPost("jobs/{jobId:int}/messages")]
    public async Task<IActionResult> SendJobMessage(int jobId, [FromBody] IsMesajDto dto, CancellationToken cancellationToken)
    {
        var session = await RequireSession(cancellationToken);
        if (session.Error != null) return session.Error;
        if (!await OwnsJob(session.HekimId, jobId, cancellationToken)) return NotFound("İş bulunamadı.");

        var mesaj = (dto.Mesaj ?? string.Empty).Trim();
        if (mesaj.Length == 0) return BadRequest("Mesaj boş olamaz.");
        if (mesaj.Length > 4000) return BadRequest("Mesaj en fazla 4000 karakter olabilir.");

        var hekimAdi = await _db.Hekimler.AsNoTracking()
            .Where(x => x.Id == session.HekimId).Select(x => x.AdSoyad)
            .FirstOrDefaultAsync(cancellationToken) ?? "Hekim";

        var yeniId = (await _db.Database.SqlQuery<int>($"""
            INSERT INTO "IsMesajlari" ("SiparisId","GonderenTipi","GonderenAdi","Mesaj","Tarih")
            VALUES ({jobId},{"Hekim"},{hekimAdi},{mesaj},{DateTime.UtcNow})
            RETURNING "Id" AS "Value"
            """).ToListAsync(cancellationToken)).Single();
        _takip.MesajOkundu("hekim:" + session.HekimId, jobId, yeniId);
        return Ok(new { message = "Mesaj gönderildi." });
    }

    // Dosya yerine paylaşılan linkler: hekim görür, sonradan ekler, kendi eklediğini siler.
    [HttpGet("jobs/{jobId:int}/links")]
    public async Task<IActionResult> JobLinks(int jobId, [FromServices] IsLinkleri linkler, CancellationToken cancellationToken)
    {
        var session = await RequireSession(cancellationToken);
        if (session.Error != null) return session.Error;
        if (!await OwnsJob(session.HekimId, jobId, cancellationToken)) return NotFound("İş bulunamadı.");
        return Ok(linkler.Liste(jobId).Select(x => new
        {
            x.Id, x.Url, x.Aciklama, x.Tarih, servis = IsLinkleri.Servis(x.Url),
            Ekleyen = x.EkleyenTipi == "Hekim" ? "Siz" : "Laboratuvar", Benim = x.EkleyenTipi == "Hekim"
        }));
    }

    [HttpPost("jobs/{jobId:int}/links")]
    public async Task<IActionResult> AddJobLinks(int jobId, [FromBody] IsLinkEkleDto dto, [FromServices] IsLinkleri linkler, CancellationToken cancellationToken)
    {
        var session = await RequireSession(cancellationToken);
        if (session.Error != null) return session.Error;
        if (!await OwnsJob(session.HekimId, jobId, cancellationToken)) return NotFound("İş bulunamadı.");
        var liste = (dto.Linkler ?? new()).Where(x => !string.IsNullOrWhiteSpace(x)).ToList();
        if (liste.Count == 0) return BadRequest("Link girin.");
        var hata = linkler.Ekle(jobId, liste, dto.Aciklama, "Hekim", null);
        if (hata != null) return BadRequest(hata);
        return Ok(new { message = "Link işe eklendi; laboratuvar görebilir." });
    }

    [HttpDelete("jobs/{jobId:int}/links/{linkId:int}")]
    public async Task<IActionResult> DeleteJobLink(int jobId, int linkId, [FromServices] IsLinkleri linkler, CancellationToken cancellationToken)
    {
        var session = await RequireSession(cancellationToken);
        if (session.Error != null) return session.Error;
        if (!await OwnsJob(session.HekimId, jobId, cancellationToken)) return NotFound("İş bulunamadı.");
        return linkler.Sil(jobId, linkId, "Hekim") ? Ok() : NotFound("Link bulunamadı.");
    }

    [HttpGet("jobs/{jobId:int}/files")]
    public async Task<IActionResult> JobFiles(int jobId, CancellationToken cancellationToken)
    {
        var session = await RequireSession(cancellationToken);
        if (session.Error != null) return session.Error;
        if (!await OwnsJob(session.HekimId, jobId, cancellationToken)) return NotFound("İş bulunamadı.");

        var rows = await _db.Database.SqlQuery<PortalFileRow>($"""
            SELECT "Id","SiparisId","DosyaTuru","OrijinalDosyaAdi","Uzanti","Boyut","YuklemeTarihi"
            FROM "IsDosyalari"
            WHERE "SiparisId"={jobId}
            ORDER BY "YuklemeTarihi" DESC,"Id" DESC
            """).ToListAsync(cancellationToken);

        return Ok(rows);
    }

    [HttpGet("jobs/{jobId:int}/files/{fileId:int}")]
    public async Task<IActionResult> DownloadFile(int jobId, int fileId, CancellationToken cancellationToken)
    {
        var session = await RequireSession(cancellationToken);
        if (session.Error != null) return session.Error;
        if (!await OwnsJob(session.HekimId, jobId, cancellationToken)) return NotFound("İş bulunamadı.");

        var row = await _db.Database.SqlQuery<PortalFileSecretRow>($"""
            SELECT "Id","SiparisId","DosyaTuru","OrijinalDosyaAdi","SaklananDosyaAdi","Uzanti","Boyut","YuklemeTarihi"
            FROM "IsDosyalari"
            WHERE "Id"={fileId} AND "SiparisId"={jobId}
            """).FirstOrDefaultAsync(cancellationToken);

        if (row == null) return NotFound("Dosya bulunamadı.");
        HttpContext.RequestServices.GetRequiredService<HekimPaylasimi>().HekimIndirdi(fileId);

        var fullPath = SafeStoredPath(jobId, row.SaklananDosyaAdi);
        if (!System.IO.File.Exists(fullPath)) return NotFound("Dosyanın fiziksel kopyası bulunamadı.");

        var provider = new FileExtensionContentTypeProvider();
        if (!provider.TryGetContentType(row.OrijinalDosyaAdi, out var contentType))
            contentType = "application/octet-stream";
        _takip.Indirildi(new[] { row.Id }, "Hekim");

        return PhysicalFile(fullPath, contentType, Path.GetFileName(row.OrijinalDosyaAdi), enableRangeProcessing: true);
    }

    // =========================================================
    // HELPERS
    // =========================================================

    private async Task<(int HekimId, IActionResult? Error)> RequireSession(CancellationToken cancellationToken)
    {
        if (!Request.Cookies.TryGetValue(CookieName, out var cookie) || string.IsNullOrWhiteSpace(cookie))
            return (0, Unauthorized("Portal oturumu bulunamadı."));

        PortalSession? session;
        try
        {
            session = JsonSerializer.Deserialize<PortalSession>(_protector.Unprotect(cookie));
        }
        catch
        {
            return (0, Unauthorized("Portal oturumu geçersiz."));
        }

        if (session == null || session.HekimId <= 0 || session.ExpiresUtc <= DateTime.UtcNow)
            return (0, Unauthorized("Portal oturumu sona erdi."));

        var active = await _db.Database.SqlQuery<int>($"""
            SELECT COUNT(*)::int AS "Value"
            FROM "HekimPortalHesaplari" p
            INNER JOIN "Hekimler" h ON h."Id"=p."HekimId"
            WHERE p."HekimId"={session.HekimId}
              AND p."Aktif"=true
              AND h."Aktif"=true
            """).SingleAsync(cancellationToken);

        if (active == 0) return (0, Unauthorized("Portal hesabı pasif."));
        return (session.HekimId, null);
    }

    private async Task<List<PortalPriceRow>> PortalPriceList(int hekimId, CancellationToken cancellationToken)
    {
        // Hekim portalda yalnız kendisine tanımlı işleri görür (Hekimler > Fiyat Listesi).
        var ozel = await _db.Database.SqlQuery<PortalPriceRow>($"""
            SELECT
                "IsTuru" AS "IsTuru",
                "BirimFiyat" AS "BirimFiyat",
                COALESCE("ParaBirimi",'TRY') AS "ParaBirimi",
                "Sira" AS "Sira"
            FROM "HekimFiyatlari"
            WHERE "HekimId"={hekimId}
              AND "Aktif"=true
            ORDER BY "Sira","IsTuru"
            """).ToListAsync(cancellationToken);

        // Merkezi katalog kullanılmaz: listesi tanımlanmamış hekim portalda iş türü
        // göremez; laboratuvar Hekimler ekranından listesini tanımlamalıdır.
        return ozel;
    }

    private static string? ValidateNewJob(PortalNewJobDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.HastaAdi)) return "Hasta adı gereklidir.";
        if (dto.HastaAdi.Trim().Length > 150) return "Hasta adı çok uzun.";
        if (dto.Kalemler == null || dto.Kalemler.Count == 0) return "En az bir iş kalemi seçilmelidir.";
        if (dto.Kalemler.Count > 12) return "Bir talepte en fazla 12 iş kalemi olabilir.";

        foreach (var item in dto.Kalemler)
        {
            if (string.IsNullOrWhiteSpace(item.IsTuru)) return "İş türü boş bırakılamaz.";
            var hasTeeth = item.Disler is { Count: > 0 };
            if (hasTeeth && item.Disler!.Any(x => !ValidTeeth.Contains(x))) return "Geçersiz diş numarası seçildi.";
            if (item.Adet > 99 || (item.Adet <= 0 && !hasTeeth)) return "İş adedi 1-99 arasında olmalıdır.";
        }

        dto.Disler ??= new List<int>();
        if (dto.Disler.Any(x => !ValidTeeth.Contains(x))) return "Geçersiz diş numarası seçildi.";
        if (!AllTeeth(dto).Any()) return "En az bir diş seçilmelidir.";

        if (dto.ImplantVar && string.IsNullOrWhiteSpace(dto.ImplantMarkasi)) return "İmplant markası gereklidir.";
        foreach (var (value, label) in new[]
                 {
                     (dto.ImplantMarkasi, "İmplant markası"), (dto.ImplantPlatform, "İmplant platformu"),
                     (dto.AbutmentTipi, "Abutment tipi"), (dto.BaglantiTipi, "Bağlantı tipi"),
                     (dto.TaramaCihazi, "Tarama cihazı"), (dto.ProvaAsamasi, "Prova aşaması"),
                     (dto.ReferansNo, "Referans no")
                 })
        {
            if ((value?.Trim().Length ?? 0) > 120) return $"{label} çok uzun.";
        }
        if (string.IsNullOrWhiteSpace(dto.DisRengi)) return "Diş rengi gereklidir.";
        if (dto.DisRengi.Trim().Length > 50) return "Diş rengi çok uzun.";
        if (string.IsNullOrWhiteSpace(dto.Materyal)) return "Materyal seçilmelidir.";
        if (dto.Materyal.Trim().Length > 120) return "Materyal bilgisi çok uzun.";
        if (dto.TerminTarihi == null) return "Teslim tarihi seçilmelidir.";
        return null;
    }

    private static IEnumerable<int> AllTeeth(PortalNewJobDto dto) =>
        (dto.Disler ?? new List<int>())
            .Concat(dto.Kalemler.SelectMany(x => x.Disler ?? new List<int>()))
            .Distinct()
            .OrderBy(x => x);

    // Ana sistemde yeni alan/kolon gerektirmeden portal bilgileri iş notunda düzenli bir blok
    // olarak saklanır; Gelen İş Onayı ve iş detayında olduğu gibi görünür.
    private static string BuildJobNotes(
        PortalNewJobDto dto,
        List<(string IsTuru, PortalNewJobItemDto Item)> items,
        string? doctorNote,
        string baslik = "[Hekim Portalı]")
    {
        static string? Clean(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim().Replace('\n', ' ').Replace('\r', ' ');
        var lines = new List<string>();

        if (dto.Acil) lines.Add("⚠ ACİL İŞ");
        if (Clean(dto.ReferansNo) is { } refNo) lines.Add("Klinik ref no: " + refNo);

        var plan = items
            .Where(x => x.Item.Disler is { Count: > 0 })
            .Select(x => $"{x.IsTuru}: {string.Join(",", x.Item.Disler!)}")
            .ToList();
        if (plan.Count > 0) lines.Add("Diş planı: " + string.Join(" | ", plan));

        if (dto.ImplantVar)
        {
            var parts = new List<string> { Clean(dto.ImplantMarkasi) ?? "-" };
            if (Clean(dto.ImplantPlatform) is { } platform) parts.Add("Platform/çap: " + platform);
            if (Clean(dto.AbutmentTipi) is { } abutment) parts.Add("Abutment: " + abutment);
            if (Clean(dto.BaglantiTipi) is { } baglanti) parts.Add("Bağlantı: " + baglanti);
            lines.Add("İmplant: " + string.Join(" · ", parts));
        }

        if (Clean(dto.TaramaCihazi) is { } scanner) lines.Add("Tarama cihazı: " + scanner);
        if (Clean(dto.ProvaAsamasi) is { } prova) lines.Add("Prova: " + prova);
        if (doctorNote != null) lines.Add("Hekim notu: " + doctorNote);

        return lines.Count == 0 ? string.Empty : baslik + "\n" + string.Join("\n", lines);
    }

    private static string? ValidateFile(IFormFile file)
    {
        if (file.Length <= 0) return $"'{file.FileName}' boş dosya.";
        if (file.Length > MaxFileSize) return $"'{file.FileName}' 250 MB sınırını aşıyor.";

        var name = Path.GetFileName((file.FileName ?? string.Empty).Trim());
        if (string.IsNullOrWhiteSpace(name) || name.Length > 240 || name.Any(char.IsControl))
            return "Dosya adı geçersiz veya çok uzun.";

        var extension = Path.GetExtension(name).ToLowerInvariant();
        if (!AllowedExtensions.Contains(extension))
            return $"'{name}' desteklenmeyen dosya türü. STL, OBJ, PLY, DCM, ZIP, RAR, 7Z, PDF ve görseller kabul edilir.";

        return null;
    }

    private async Task<SavedPortalFile> SavePortalFile(
        int siparisId,
        IFormFile file,
        string designSource,
        string yukleyenTipi,
        string yukleyenAdi,
        CancellationToken cancellationToken)
    {
        var originalName = Path.GetFileName(file.FileName.Trim());
        var extension = Path.GetExtension(originalName).ToLowerInvariant();
        var storedName = Guid.NewGuid().ToString("N") + extension;
        var folder = Path.Combine(StorageRoot(), siparisId.ToString());
        Directory.CreateDirectory(folder);
        var fullPath = SafeStoredPath(siparisId, storedName);

        await using (var stream = new FileStream(fullPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 128 * 1024, useAsync: true))
        {
            await file.CopyToAsync(stream, cancellationToken);
            await stream.FlushAsync(cancellationToken);
        }

        var fileType = designSource == "doctor" ? "Tasarım" : "Tarama";
        var now = DateTime.UtcNow;

        try
        {
            var dosyaId = (await _db.Database.SqlQuery<int>($"""
                INSERT INTO "IsDosyalari"
                ("SiparisId","DosyaTuru","OrijinalDosyaAdi","SaklananDosyaAdi","Uzanti","Boyut","YuklemeTarihi")
                VALUES ({siparisId},{fileType},{originalName},{storedName},{extension},{file.Length},{now})
                RETURNING "Id" AS "Value"
                """).ToListAsync(cancellationToken)).Single();
            _takip.DosyaYuklendi(dosyaId, yukleyenTipi, yukleyenAdi);
        }
        catch
        {
            try { if (System.IO.File.Exists(fullPath)) System.IO.File.Delete(fullPath); } catch { }
            throw;
        }

        return new SavedPortalFile(fullPath);
    }

    private string StorageRoot()
    {
        var root = Path.GetFullPath(Path.Combine(_environment.ContentRootPath, "App_Data", "IsDosyalari"));
        Directory.CreateDirectory(root);
        return root;
    }

    private string SafeStoredPath(int siparisId, string storedName)
    {
        var safeName = Path.GetFileName(storedName ?? string.Empty);
        if (string.IsNullOrWhiteSpace(safeName) || safeName != storedName)
            throw new InvalidOperationException("Dosya yolu güvenlik kontrolünden geçemedi.");

        var folder = Path.GetFullPath(Path.Combine(StorageRoot(), siparisId.ToString()));
        var full = Path.GetFullPath(Path.Combine(folder, safeName));
        var prefix = folder.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Dosya yolu depolama alanı dışında.");

        return full;
    }

    private async Task<bool> OwnsJob(int hekimId, int jobId, CancellationToken cancellationToken)
    {
        return await _db.Database.SqlQuery<int>($"""
            SELECT COUNT(*)::int AS "Value"
            FROM "Siparisler" s
            INNER JOIN "Hastalar" p ON p."Id"=s."HastaId"
            WHERE s."Id"={jobId} AND p."HekimId"={hekimId}
            """).SingleAsync(cancellationToken) > 0;
    }

    private static DateTime? NormalizeDate(DateTime? value)
    {
        if (!value.HasValue) return null;
        var date = value.Value.Date;
        if (date < DateTime.UtcNow.Date) return DateTime.UtcNow.Date;
        if (date > DateTime.UtcNow.Date.AddYears(2)) return DateTime.UtcNow.Date.AddYears(2);
        return DateTime.SpecifyKind(date, DateTimeKind.Utc);
    }

    private static string NormalizeCurrency(string? value)
    {
        var v = (value ?? "TRY").Trim().ToUpperInvariant();
        return v switch
        {
            "EUR" or "€" => "EUR",
            "USD" or "$" => "USD",
            _ => "TRY"
        };
    }

    private static string? Normalize(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var v = value.Trim();
        return v.Length <= max ? v : v[..max];
    }

    private string? InternetPortalUrl()
    {
        var value = _configuration["PrimerLab:PortalInternetUrl"];
        if (string.IsNullOrWhiteSpace(value)) return null;
        value = value.Trim().TrimEnd('/');
        if (!value.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) value = "https://" + value;
        return value.EndsWith("/hekim-portal", StringComparison.OrdinalIgnoreCase) ? value : value + "/hekim-portal";
    }

    private string[] GetPortalUrls()
    {
        var urls = new List<string>();
        if (InternetPortalUrl() is { } internet) urls.Add(internet);
        try
        {
            var addresses = System.Net.Dns.GetHostEntry(System.Net.Dns.GetHostName())
                .AddressList
                .Where(a => a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                .Where(a => !System.Net.IPAddress.IsLoopback(a))
                .Where(a =>
                {
                    var b = a.GetAddressBytes();
                    return b[0] == 10 ||
                           (b[0] == 172 && b[1] >= 16 && b[1] <= 31) ||
                           (b[0] == 192 && b[1] == 168);
                })
                .OrderByDescending(a => a.GetAddressBytes()[0] == 192 && a.GetAddressBytes()[1] == 168)
                .ToArray();

            foreach (var address in addresses)
                urls.Add($"http://{address}:5169/hekim-portal");
        }
        catch { }

        urls.Add("http://localhost:5169/hekim-portal");
        return urls.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private static string SuggestUsername(string value)
    {
        var normalized = value.Trim().ToLowerInvariant()
            .Replace('ç','c').Replace('ğ','g').Replace('ı','i').Replace('ö','o').Replace('ş','s').Replace('ü','u');
        normalized = Regex.Replace(normalized, "[^a-z0-9]+", ".").Trim('.');
        return string.IsNullOrWhiteSpace(normalized) ? "hekim" : normalized[..Math.Min(normalized.Length, 50)];
    }

    private static bool IsStrongEnough(string password) =>
        password.Length >= 8 && password.Any(char.IsLetter) && password.Any(char.IsDigit);

    private static string HashPassword(string password, string base64Salt)
    {
        var salt = Convert.FromBase64String(base64Salt);
        var bytes = Rfc2898DeriveBytes.Pbkdf2(
            password,
            salt,
            PasswordIterations,
            HashAlgorithmName.SHA256,
            32);
        return Convert.ToBase64String(bytes);
    }

    private static bool VerifyPassword(string password, string base64Salt, string expectedHash)
    {
        try
        {
            var actual = Convert.FromBase64String(HashPassword(password, base64Salt));
            var expected = Convert.FromBase64String(expectedHash);
            return actual.Length == expected.Length && CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch { return false; }
    }

    private static bool IsLoopback(System.Net.IPAddress? address)
    {
        if (address == null) return true;
        if (System.Net.IPAddress.IsLoopback(address)) return true;
        return address.IsIPv4MappedToIPv6 &&
               System.Net.IPAddress.IsLoopback(address.MapToIPv4());
    }

    private static bool IsLoginBlocked(string key, int limit, out int waitMinutes)
    {
        waitMinutes = 0;
        if (!LoginAttempts.TryGetValue(key, out var state)) return false;

        lock (state)
        {
            var now = DateTime.UtcNow;
            state.Failures.RemoveAll(x => now - x > TimeSpan.FromMinutes(10));
            if (state.Failures.Count < limit) return false;

            var remaining = TimeSpan.FromMinutes(10) - (now - state.Failures[state.Failures.Count - limit]);
            waitMinutes = Math.Max(1, (int)Math.Ceiling(remaining.TotalMinutes));
            return remaining > TimeSpan.Zero;
        }
    }

    private static void RegisterLoginFailure(string key)
    {
        if (LoginAttempts.Count > 50_000) LoginAttempts.Clear();
        var state = LoginAttempts.GetOrAdd(key, _ => new LoginAttemptState());
        lock (state)
        {
            var now = DateTime.UtcNow;
            state.Failures.RemoveAll(x => now - x > TimeSpan.FromMinutes(10));
            state.Failures.Add(now);
        }
    }

    private sealed class LoginAttemptState
    {
        public List<DateTime> Failures { get; } = new();
    }

    private sealed record SavedPortalFile(string FullPath);
}

public sealed class PortalAccountSaveDto
{
    public string? KullaniciAdi { get; set; }
    public string? YeniParola { get; set; }
    public bool Aktif { get; set; } = true;
}

public sealed class EpostaKodDto
{
    public string? Jeton { get; set; }
    public string? Kod { get; set; }
    public string? Eposta { get; set; }
    public bool Hatirla { get; set; }
}

public sealed class PortalKayitDto
{
    public string? AdSoyad { get; set; }
    public string? KlinikAdi { get; set; }
    public string? Telefon { get; set; }
    public string? Eposta { get; set; }
    public string? KullaniciAdi { get; set; }
    public string? Parola { get; set; }
    public bool Kvkk { get; set; }
    // Gizli tuzak alanı: insanlar görmez, botlar doldurur.
    public string? Website { get; set; }
    public string? ZorlukJeton { get; set; }
    public string? ZorlukCevap { get; set; }
}

public sealed class SifreSifirlaDto
{
    public string? Kimlik { get; set; }
    public string? ZorlukJeton { get; set; }
    public string? ZorlukCevap { get; set; }
    public string? Jeton { get; set; }
    public string? Kod { get; set; }
    public string? YeniParola { get; set; }
}

public sealed record HekimKayitVerisi(string AdSoyad, string? KlinikAdi, string? Telefon, string KullaniciAdi, string ParolaHash, string ParolaSalt, string? Ip);

public sealed class PortalLoginDto
{
    public string? KullaniciAdi { get; set; }
    public string? Parola { get; set; }
}

public sealed class PortalSession
{
    public int HekimId { get; set; }
    public DateTime ExpiresUtc { get; set; }
    public string Nonce { get; set; } = string.Empty;
}

public sealed class PortalAccountAdminRow
{
    public int HekimId { get; set; }
    public string KullaniciAdi { get; set; } = string.Empty;
    public bool Aktif { get; set; }
    public DateTime? SonGirisTarihi { get; set; }
    public DateTime GuncellemeTarihi { get; set; }
}

public class PortalAccountSecretRow
{
    public int Id { get; set; }
    public int HekimId { get; set; }
    public string KullaniciAdi { get; set; } = string.Empty;
    public string ParolaHash { get; set; } = string.Empty;
    public string ParolaSalt { get; set; } = string.Empty;
    public bool Aktif { get; set; }
}

public sealed class PortalLoginRow : PortalAccountSecretRow
{
    public string HekimAdi { get; set; } = string.Empty;
    public string? KlinikAdi { get; set; }
    public bool HekimAktif { get; set; }
}

public sealed class PortalPriceRow
{
    public string IsTuru { get; set; } = string.Empty;
    public decimal BirimFiyat { get; set; }
    public string ParaBirimi { get; set; } = "TRY";
    public int Sira { get; set; }
}

public sealed class TeknisyenHekimSatiri
{
    public int Id { get; set; }
    public string AdSoyad { get; set; } = string.Empty;
    public string? KlinikAdi { get; set; }
    public int IsTuruSayisi { get; set; }
}

public sealed class PortalNewJobDto
{
    public string HastaAdi { get; set; } = string.Empty;
    public string DisRengi { get; set; } = string.Empty;
    public string Materyal { get; set; } = string.Empty;
    public List<int> Disler { get; set; } = new();
    public DateTime? TerminTarihi { get; set; }
    public string? Notlar { get; set; }
    public string TasarimKaynagi { get; set; } = "lab";
    public List<PortalNewJobItemDto> Kalemler { get; set; } = new();
    public bool Acil { get; set; }
    public string? ReferansNo { get; set; }
    public bool ImplantVar { get; set; }
    public string? ImplantMarkasi { get; set; }
    public string? ImplantPlatform { get; set; }
    public string? AbutmentTipi { get; set; }
    public string? BaglantiTipi { get; set; }
    public string? TaramaCihazi { get; set; }
    public string? ProvaAsamasi { get; set; }
    /// <summary>Dosya yerine (ya da dosyayla birlikte) paylaşılan bağlantılar: WeTransfer, Drive, Dropbox...</summary>
    public List<string>? Linkler { get; set; }
}

public sealed class HazirDosyaSatiri
{
    public int Id { get; set; }
    public int SiparisId { get; set; }
    public string DosyaTuru { get; set; } = "";
    public string OrijinalDosyaAdi { get; set; } = "";
    public long Boyut { get; set; }
    public DateTime YuklemeTarihi { get; set; }
}

public sealed class IsLinkEkleDto
{
    public List<string>? Linkler { get; set; }
    public string? Aciklama { get; set; }
}

public sealed class PortalNewJobItemDto
{
    public string IsTuru { get; set; } = string.Empty;
    public int Adet { get; set; } = 1;
    public List<int>? Disler { get; set; }
}

public sealed class PortalJobRow
{
    public int Id { get; set; }
    public string HastaAdi { get; set; } = string.Empty;
    public string Durum { get; set; } = string.Empty;
    public string OnayDurumu { get; set; } = string.Empty;
    public DateTime OlusturmaTarihi { get; set; }
    public DateTime? TerminTarihi { get; set; }
    public string? DisRengi { get; set; }
    public string? DisSemasi { get; set; }
    public string? Materyal { get; set; }
    public string? Notlar { get; set; }
    public string TasarimKaynagi { get; set; } = "lab";
    public string ParaBirimi { get; set; } = "TRY";
    public int ToplamAdet { get; set; }
    public int DosyaSayisi { get; set; }
    public int MesajSayisi { get; set; }
}

public sealed class PortalJobItemRow
{
    public int SiparisId { get; set; }
    public string IsTuru { get; set; } = string.Empty;
    public int Adet { get; set; }
    public decimal BirimFiyat { get; set; }
}

public class PortalFileRow
{
    public int Id { get; set; }
    public int SiparisId { get; set; }
    public string DosyaTuru { get; set; } = string.Empty;
    public string OrijinalDosyaAdi { get; set; } = string.Empty;
    public string Uzanti { get; set; } = string.Empty;
    public long Boyut { get; set; }
    public DateTime YuklemeTarihi { get; set; }
}

public sealed class PortalFileSecretRow : PortalFileRow
{
    public string SaklananDosyaAdi { get; set; } = string.Empty;
}
