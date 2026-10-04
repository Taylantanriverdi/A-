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

    private static readonly Regex UsernameRegex =
        new("^[a-zA-Z0-9._-]{3,64}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".stl", ".obj", ".ply", ".dcm", ".zip", ".rar", ".7z", ".pdf",
        ".jpg", ".jpeg", ".png", ".webp", ".txt",
        ".xml", ".3ox", ".3oxz", ".dentalproject", ".constructioninfo"
    };

    // Teknisyenin seçebileceği durumlar. "Tamamlandı"yı laboratuvar (admin) onaylar.
    private static readonly string[] TeknisyenDurumlari =
        { "Bekliyor", "Tasarımda", "Üretimde", "Makyajda", "Tamamlama Onayı" };

    private static readonly ConcurrentDictionary<string, List<DateTime>> GirisDenemeleri = new();

    private readonly PrimerLabDbContext _db;
    private readonly IDataProtector _protector;
    private readonly IWebHostEnvironment _environment;
    private readonly TeknisyenHesapDeposu _hesaplar;

    public TeknisyenPortalController(
        PrimerLabDbContext db,
        IDataProtectionProvider dataProtectionProvider,
        IWebHostEnvironment environment,
        TeknisyenHesapDeposu hesaplar)
    {
        _db = db;
        _protector = dataProtectionProvider.CreateProtector("PrimerLab.TeknisyenPaneli.Session.v1");
        _environment = environment;
        _hesaplar = hesaplar;
    }

    // =========================================================
    // ADMIN — ana programdan teknisyen panel hesabı yönetimi
    // =========================================================

    [HttpGet("admin/account/{teknisyenId:int}")]
    public async Task<IActionResult> AdminHesap(int teknisyenId, CancellationToken ct)
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
            panelYolu = "/teknisyen"
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
        if (!_hesaplar.Kaydet(teknisyenId, kullaniciAdi, string.IsNullOrWhiteSpace(parola) ? null : parola, tip, dto.Aktif && tek.Aktif))
            return Conflict("Bu kullanıcı adı başka bir teknisyende kullanılıyor.");

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
    public async Task<IActionResult> Login([FromBody] TeknisyenGirisDto dto, CancellationToken ct)
    {
        var kullaniciAdi = (dto.KullaniciAdi ?? string.Empty).Trim().ToLowerInvariant();
        var parola = dto.Parola ?? string.Empty;
        var remote = HttpContext.Connection.RemoteIpAddress;
        var ipAnahtar = remote == null || remote.Equals(IPAddress.None) ? null : "ip:" + remote;
        var kAnahtar = "u:" + kullaniciAdi;

        if ((ipAnahtar != null && Engelli(ipAnahtar, 5)) || Engelli(kAnahtar, 10))
            return StatusCode(StatusCodes.Status429TooManyRequests, "Çok fazla hatalı giriş denemesi. 10 dakika sonra tekrar deneyin.");

        if (kullaniciAdi.Length == 0 || parola.Length == 0)
            return BadRequest("Kullanıcı adı ve parola gereklidir.");

        var hesap = _hesaplar.KullaniciAdiyla(kullaniciAdi);
        var tek = hesap == null ? null : await TeknisyenGetir(hesap.TeknisyenId, ct);

        if (hesap == null || tek == null || !hesap.Aktif || !tek.Aktif || !TeknisyenHesapDeposu.ParolaDogru(hesap, parola))
        {
            if (ipAnahtar != null) HataKaydet(ipAnahtar);
            if (kullaniciAdi.Length > 0) HataKaydet(kAnahtar);
            await Task.Delay(Random.Shared.Next(150, 450), ct);
            return Unauthorized("Kullanıcı adı veya parola hatalı.");
        }

        if (ipAnahtar != null) GirisDenemeleri.TryRemove(ipAnahtar, out _);
        GirisDenemeleri.TryRemove(kAnahtar, out _);

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
                COALESCE((SELECT COUNT(*) FROM "IsMesajlari" m WHERE m."SiparisId"=s."Id"),0)::int AS "MesajSayisi",
                EXISTS(SELECT 1 FROM "SiparisDurumGecmisi" g
                       WHERE g."SiparisId"=s."Id" AND g."Aciklama" LIKE {kabulDeseni}) AS "Kabul",
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
            x.MesajSayisi,
            Kabul = !dis || x.Kabul,
            x.TamamlanmaTarihi,
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
        if (!TeknisyenDurumlari.Contains(yeni)) return BadRequest("Geçersiz durum.");

        var eski = await IsDurumu(o.Tek!.Id, jobId, ct);
        if (eski == null) return NotFound("İş bulunamadı.");
        if (o.Tip == TeknisyenHesapDeposu.Dis && !await KabulEdildi(o.Tek.Id, jobId, ct))
            return BadRequest("Önce işi kabul edin.");
        if (eski == "Tamamlandı") return BadRequest("Tamamlanmış işin durumu değiştirilemez.");
        if (eski == "Tamamlama Onayı") return BadRequest("İş laboratuvarın tamamlama onayını bekliyor.");
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

    // =========================================================
    // DOSYALAR
    // =========================================================

    [HttpGet("jobs/{jobId:int}/files")]
    public async Task<IActionResult> Dosyalar(int jobId, CancellationToken ct)
    {
        var o = await Oturum(ct);
        if (o.Hata != null) return o.Hata;
        if (await IsDurumu(o.Tek!.Id, jobId, ct) == null) return NotFound("İş bulunamadı.");

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
        if (await IsDurumu(o.Tek!.Id, jobId, ct) == null) return NotFound("İş bulunamadı.");
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

            await _db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO "IsDosyalari"
                ("SiparisId","DosyaTuru","OrijinalDosyaAdi","SaklananDosyaAdi","Uzanti","Boyut","YuklemeTarihi")
                VALUES ({jobId},{tur},{ad},{saklanan},{uzanti},{dosya.Length},{DateTime.UtcNow})
                """, ct);
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

        var rows = await _db.Database.SqlQuery<IsMesajSatiri>($"""
            SELECT "Id","GonderenTipi","GonderenAdi","Mesaj","Tarih"
            FROM "IsMesajlari" WHERE "SiparisId"={jobId}
            ORDER BY "Tarih","Id"
            """).ToListAsync(ct);

        var dis = o.Tip == TeknisyenHesapDeposu.Dis;
        return Ok(rows.Select(m => new
        {
            m.Id,
            m.GonderenTipi,
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

        await _db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "IsMesajlari" ("SiparisId","GonderenTipi","GonderenAdi","Mesaj","Tarih")
            VALUES ({jobId},{"Teknisyen"},{o.Tek.AdSoyad},{mesaj},{DateTime.UtcNow})
            """, ct);
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
