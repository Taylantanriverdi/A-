using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;
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

    public HekimPortalController(
        PrimerLabDbContext db,
        IDataProtectionProvider dataProtectionProvider,
        IWebHostEnvironment environment)
    {
        _db = db;
        _protector = dataProtectionProvider.CreateProtector("PrimerLab.HekimPortal.Session.v1");
        _environment = environment;
    }

    // =========================================================
    // ADMIN — ANA YAZILIMDAN HEKİM PORTAL HESABI YÖNETİMİ
    // =========================================================

    [HttpGet("admin/account/{hekimId:int}")]
    public async Task<IActionResult> AdminGetAccount(int hekimId, CancellationToken cancellationToken)
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
            portalAdresleri = GetPortalUrls()
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
    public async Task<IActionResult> Login([FromBody] PortalLoginDto dto, CancellationToken cancellationToken)
    {
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        if (IsLoginBlocked(ip, out var waitMinutes))
            return StatusCode(StatusCodes.Status429TooManyRequests,
                $"Çok fazla başarısız giriş denemesi. Yaklaşık {waitMinutes} dakika sonra tekrar deneyin.");

        var username = (dto.KullaniciAdi ?? string.Empty).Trim().ToLowerInvariant();
        var password = dto.Parola ?? string.Empty;

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
            return BadRequest("Kullanıcı adı ve parola gereklidir.");

        var account = await _db.Database.SqlQuery<PortalLoginRow>($"""
            SELECT
                p."Id",p."HekimId",p."KullaniciAdi",p."ParolaHash",p."ParolaSalt",p."Aktif",
                h."AdSoyad" AS "HekimAdi",h."KlinikAdi",h."Aktif" AS "HekimAktif"
            FROM "HekimPortalHesaplari" p
            INNER JOIN "Hekimler" h ON h."Id"=p."HekimId"
            WHERE lower(p."KullaniciAdi")=lower({username})
            LIMIT 1
            """).FirstOrDefaultAsync(cancellationToken);

        if (account == null || !account.Aktif || !account.HekimAktif || !VerifyPassword(password, account.ParolaSalt, account.ParolaHash))
        {
            RegisterLoginFailure(ip);
            await Task.Delay(Random.Shared.Next(150, 450), cancellationToken);
            return Unauthorized("Kullanıcı adı veya parola hatalı.");
        }

        LoginAttempts.TryRemove(ip, out _);

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
                COALESCE((SELECT COUNT(*) FROM "IsDosyalari" f WHERE f."SiparisId"=s."Id"),0)::int AS "DosyaSayisi"
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

        return Ok(rows.Select(x => new
        {
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
        if (files.Sum(x => x.Length) > MaxRequestSize - (2L * 1024L * 1024L))
            return BadRequest("Toplam dosya boyutu çok yüksek.");

        foreach (var file in files)
        {
            var fileError = ValidateFile(file);
            if (fileError != null) return BadRequest(fileError);
        }

        // Para birimi ve fiyat bilgisi yalnız ana Primer Lab'de kullanılır.
        // Hekim bu bilgileri portalda görmez.
        var allowedPrices = await PortalPriceList(session.HekimId, cancellationToken);
        var priceMap = allowedPrices.ToDictionary(x => x.IsTuru, StringComparer.CurrentCultureIgnoreCase);

        var cleanItems = new List<(PortalNewJobItemDto Dto, PortalPriceRow Price)>();
        foreach (var item in dto.Kalemler)
        {
            var name = item.IsTuru.Trim();
            if (!priceMap.TryGetValue(name, out var price))
                return BadRequest($"'{name}' hekime tanımlı iş listesinde bulunmuyor.");

            cleanItems.Add((item, price));
        }

        // Aynı portal talebinde TRY/EUR/USD birlikte seçilebilir.
        // Ana muhasebe düzenini bozmamak için talep arka planda para birimine göre ayrı siparişlere bölünür.
        var currencyGroups = cleanItems
            .GroupBy(x => NormalizeCurrency(x.Price.ParaBirimi))
            .OrderBy(x => x.Key)
            .ToList();

        var termin = NormalizeDate(dto.TerminTarihi);
        var teeth = dto.Disler.Distinct().OrderBy(x => x).ToArray();
        var toothText = string.Join(",", teeth);
        var notes = Normalize(dto.Notlar, 4000);
        var designSource = dto.TasarimKaynagi == "doctor" ? "doctor" : "lab";
        var portalSubmissionId = Guid.NewGuid();
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
                            HekimId = session.HekimId,
                            Telefon = null,
                            Notlar = notes,
                            Aktif = true,
                            OlusturmaTarihi = DateTime.UtcNow
                        };

                        var siparis = new Siparis
                        {
                            Hasta = hasta,
                            Durum = "Bekliyor",
                            Notlar = notes,
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
                                "Kaynak"='Hekim Portalı',
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

                        var splitNote = currencyGroups.Count > 1
                            ? $"Hekim Portalı üzerinden tek talep olarak gönderildi; muhasebe için {currency} grubuna ayrıldı. Gelen İş Onayı bekliyor."
                            : "Hekim Portalı üzerinden gönderildi; Gelen İş Onayı bekliyor.";

                        await _db.Database.ExecuteSqlInterpolatedAsync($"""
                            INSERT INTO "SiparisDurumGecmisi"
                            ("SiparisId","EskiDurum","YeniDurum","DegisimTarihi","Aciklama")
                            VALUES ({siparis.Id},{(string?)null},{"Bekliyor"},{DateTime.UtcNow},{splitNote})
                            """, cancellationToken);

                        // Dosyalar talebin tamamına aittir. İçeride bölünen her siparişe aynı dosyaların
                        // ayrı fiziksel kopyası kaydedilir; böylece hangi sipariş açılırsa açılsın dosya erişimi eksiksizdir.
                        foreach (var file in files)
                        {
                            var saved = await SavePortalFile(siparis.Id, file, designSource, cancellationToken);
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

        return Ok(new
        {
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

        var fullPath = SafeStoredPath(jobId, row.SaklananDosyaAdi);
        if (!System.IO.File.Exists(fullPath)) return NotFound("Dosyanın fiziksel kopyası bulunamadı.");

        var provider = new FileExtensionContentTypeProvider();
        if (!provider.TryGetContentType(row.OrijinalDosyaAdi, out var contentType))
            contentType = "application/octet-stream";

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
        // TEK DOĞRULUK KAYNAĞI: HekimId=0 merkezi iş kataloğudur.
        // Portal hiçbir zaman hekimin eski/özel fiyat satırlarından bağımsız bir iş listesi üretmez.
        // Hekime özel kayıt varsa yalnız fiyat ve para birimini üstüne bindirir.
        return await _db.Database.SqlQuery<PortalPriceRow>($"""
            SELECT
                k."IsTuru" AS "IsTuru",
                COALESCE(p."BirimFiyat",0) AS "BirimFiyat",
                COALESCE(p."ParaBirimi",'TRY') AS "ParaBirimi",
                k."Sira" AS "Sira"
            FROM "HekimFiyatlari" k
            LEFT JOIN "HekimFiyatlari" p
              ON p."HekimId"={hekimId}
             AND p."Aktif"=true
             AND LOWER(p."IsTuru")=LOWER(k."IsTuru")
            WHERE k."HekimId"=0
              AND k."Aktif"=true
            ORDER BY k."Sira",k."IsTuru"
            """).ToListAsync(cancellationToken);
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
            if (item.Adet <= 0 || item.Adet > 99) return "İş adedi 1-99 arasında olmalıdır.";
        }

        if (dto.Disler == null || dto.Disler.Count == 0) return "En az bir diş seçilmelidir.";
        if (dto.Disler.Any(x => !ValidTeeth.Contains(x))) return "Geçersiz diş numarası seçildi.";
        if (string.IsNullOrWhiteSpace(dto.DisRengi)) return "Diş rengi gereklidir.";
        if (dto.DisRengi.Trim().Length > 50) return "Diş rengi çok uzun.";
        if (string.IsNullOrWhiteSpace(dto.Materyal)) return "Materyal seçilmelidir.";
        if (dto.Materyal.Trim().Length > 120) return "Materyal bilgisi çok uzun.";
        if (dto.TerminTarihi == null) return "Teslim tarihi seçilmelidir.";
        return null;
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
            await _db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO "IsDosyalari"
                ("SiparisId","DosyaTuru","OrijinalDosyaAdi","SaklananDosyaAdi","Uzanti","Boyut","YuklemeTarihi")
                VALUES ({siparisId},{fileType},{originalName},{storedName},{extension},{file.Length},{now})
                """, cancellationToken);
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

    private static string[] GetPortalUrls()
    {
        var urls = new List<string>();
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

    private static bool IsLoginBlocked(string ip, out int waitMinutes)
    {
        waitMinutes = 0;
        if (!LoginAttempts.TryGetValue(ip, out var state)) return false;

        lock (state)
        {
            var now = DateTime.UtcNow;
            state.Failures.RemoveAll(x => now - x > TimeSpan.FromMinutes(10));
            if (state.Failures.Count < 5) return false;

            var remaining = TimeSpan.FromMinutes(10) - (now - state.Failures[0]);
            waitMinutes = Math.Max(1, (int)Math.Ceiling(remaining.TotalMinutes));
            return remaining > TimeSpan.Zero;
        }
    }

    private static void RegisterLoginFailure(string ip)
    {
        var state = LoginAttempts.GetOrAdd(ip, _ => new LoginAttemptState());
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
}

public sealed class PortalNewJobItemDto
{
    public string IsTuru { get; set; } = string.Empty;
    public int Adet { get; set; } = 1;
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
