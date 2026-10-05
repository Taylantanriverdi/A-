using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using System.IO.Compression;
using PrimerLabV2.Data;
using PrimerLabV2.Infrastructure;

namespace PrimerLabV2.Controllers;

[ApiController]
[Route("api/is-dosyalari")]
public class IsDosyalariController : ControllerBase
{
    private readonly PrimerLabDbContext _db;
    private readonly IWebHostEnvironment _environment;
    private readonly IcerikTakip _takip;

    private const long MaxFileSize = 250L * 1024L * 1024L;

    private static readonly HashSet<string> AllowedExtensions =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            // .dcm Hekim Portalı'nda kabul ediliyordu; laboratuvar ekranında da kabul edilir.
            ".stl", ".obj", ".ply", ".dcm", ".zip", ".rar", ".7z", ".pdf",
            ".jpg", ".jpeg", ".png", ".webp", ".txt",
            // Tarayıcı / CAD programlarının sipariş ve proje dosyaları (3Shape, exocad).
            ".xml", ".3ox", ".3oxz", ".dentalproject", ".constructioninfo"
        }.Concat(HekimPaylasimi.YaziciUzantilari).ToHashSet(StringComparer.OrdinalIgnoreCase);

    public IsDosyalariController(PrimerLabDbContext db, IWebHostEnvironment environment, IcerikTakip takip)
    {
        _db = db;
        _environment = environment;
        _takip = takip;
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

    private static string NormalizeType(string? value) => value switch
    {
        "Tarama" => "Tarama",
        "Tasarım" => "Tasarım",
        "Üretim" => "Üretim",
        "Yazıcı" => "Yazıcı",
        _ => "Diger"
    };

    [HttpGet("siparis/{siparisId:int}")]
    public async Task<IActionResult> List(int siparisId)
    {
        if (!await _db.Siparisler.AsNoTracking().AnyAsync(x => x.Id == siparisId))
            return NotFound("İş bulunamadı.");

        var files = await _db.Database.SqlQuery<IsDosyasiListeDto>($"""
            SELECT "Id","SiparisId","DosyaTuru","OrijinalDosyaAdi","Uzanti","Boyut","YuklemeTarihi"
            FROM "IsDosyalari"
            WHERE "SiparisId"={siparisId}
            ORDER BY "YuklemeTarihi" DESC,"Id" DESC
            """).ToListAsync();
        return Ok(files);
    }

    [HttpPost("siparis/{siparisId:int}")]
    [RequestSizeLimit(MaxFileSize + 1024 * 1024)]
    public async Task<IActionResult> Upload(
        int siparisId,
        [FromForm] IFormFile dosya,
        [FromForm] string? dosyaTuru,
        CancellationToken cancellationToken)
    {
        if (!await _db.Siparisler.AsNoTracking().AnyAsync(x => x.Id == siparisId, cancellationToken))
            return NotFound("İş bulunamadı.");
        if (dosya == null || dosya.Length <= 0) return BadRequest("Dosya seçilmedi.");
        if (dosya.Length > MaxFileSize) return BadRequest("Dosya en fazla 250 MB olabilir.");

        var originalName = Path.GetFileName((dosya.FileName ?? string.Empty).Trim());
        if (string.IsNullOrWhiteSpace(originalName) || originalName.Length > 240 || originalName.Any(char.IsControl))
            return BadRequest("Dosya adı geçersiz veya çok uzun.");

        var extension = Path.GetExtension(originalName).ToLowerInvariant();
        if (!AllowedExtensions.Contains(extension))
            return BadRequest("Desteklenmeyen dosya türü. STL, OBJ, PLY, DCM, ZIP, RAR, 7Z, PDF, JPG, PNG, WEBP, TXT, XML, 3OX, exocad proje dosyaları ve yazıcı dosyaları (CTB, GOO, PWMX...) kabul edilir.");

        var storedName = Guid.NewGuid().ToString("N") + extension;
        var folder = Path.Combine(StorageRoot(), siparisId.ToString());
        Directory.CreateDirectory(folder);
        var fullPath = SafeStoredPath(siparisId, storedName);

        try
        {
            await using (var stream = new FileStream(fullPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1024 * 128, useAsync: true))
            {
                await dosya.CopyToAsync(stream, cancellationToken);
                await stream.FlushAsync(cancellationToken);
            }

            var type = HekimPaylasimi.TurBelirle(NormalizeType(dosyaTuru), extension);
            var now = DateTime.UtcNow;
            // SingleAsync() INSERT ... RETURNING sorgusunu alt sorguya sarmaya çalışıp
            // her çağrıda hata veriyordu (EF Core 8+); ToListAsync() SQL'i olduğu gibi çalıştırır.
            var id = (await _db.Database.SqlQuery<int>($"""
                INSERT INTO "IsDosyalari"
                ("SiparisId","DosyaTuru","OrijinalDosyaAdi","SaklananDosyaAdi","Uzanti","Boyut","YuklemeTarihi")
                VALUES ({siparisId},{type},{originalName},{storedName},{extension},{dosya.Length},{now})
                RETURNING "Id" AS "Value"
                """)
                .ToListAsync(cancellationToken)).Single();
            _takip.DosyaYuklendi(id, "Laboratuvar", "Laboratuvar");
            // Tasarım ve yazıcı (CTB) dosyası hekime açılır ve bildirilir.
            await HttpContext.RequestServices.GetRequiredService<HekimPaylasimi>()
                .HekimeAcAsync(_db, id, siparisId, originalName, type, "Laboratuvar", "Laboratuvar", cancellationToken);

            return Ok(new
            {
                Id = id, SiparisId = siparisId, DosyaTuru = type,
                OrijinalDosyaAdi = originalName, Uzanti = extension,
                Boyut = dosya.Length, YuklemeTarihi = now
            });
        }
        catch
        {
            try { if (System.IO.File.Exists(fullPath)) System.IO.File.Delete(fullPath); } catch { }
            throw;
        }
    }

    // Bir işin tüm tarama (veya tasarım) dosyaları tek tıkla: tek dosyaysa kendisi, birden fazlaysa zip.
    [HttpGet("siparis/{siparisId:int}/indir-hepsi")]
    public async Task<IActionResult> HepsiniIndir(int siparisId, [FromQuery] string? tur, CancellationToken cancellationToken)
    {
        var hasta = await _db.Database.SqlQuery<string>($"""
            SELECT COALESCE(h."AdSoyad",'hasta') AS "Value"
            FROM "Siparisler" s LEFT JOIN "Hastalar" h ON h."Id"=s."HastaId"
            WHERE s."Id"={siparisId}
            """).ToListAsync(cancellationToken);
        if (hasta.Count == 0) return NotFound("İş bulunamadı.");

        var tumu = string.IsNullOrWhiteSpace(tur) || tur == "Hepsi";
        var secilenTur = NormalizeType(tur);
        var files = (await _db.Database.SqlQuery<IsDosyasiKayitDto>($"""
            SELECT "Id","SiparisId","DosyaTuru","OrijinalDosyaAdi","SaklananDosyaAdi","Uzanti","Boyut","YuklemeTarihi"
            FROM "IsDosyalari" WHERE "SiparisId"={siparisId}
            ORDER BY "YuklemeTarihi","Id"
            """).ToListAsync(cancellationToken))
            .Where(f => tumu || f.DosyaTuru == secilenTur)
            .Select(f => (Kayit: f, Yol: TryPath(f)))
            .Where(x => x.Yol != null && System.IO.File.Exists(x.Yol))
            .ToList();

        if (files.Count == 0) return NotFound("İndirilecek dosya bulunamadı.");
        _takip.Indirildi(files.Select(x => x.Kayit.Id), "Laboratuvar");

        var provider = new FileExtensionContentTypeProvider();
        if (files.Count == 1)
        {
            var tek = files[0];
            if (!provider.TryGetContentType(tek.Kayit.OrijinalDosyaAdi, out var ct)) ct = "application/octet-stream";
            return PhysicalFile(tek.Yol!, ct, Path.GetFileName(tek.Kayit.OrijinalDosyaAdi), enableRangeProcessing: true);
        }

        // Zip geçici dosyaya yazılır (Kestrel eşzamanlı yazmaya izin vermez); indirme bitince silinir.
        var gecici = Path.Combine(Path.GetTempPath(), "primerlab_" + Guid.NewGuid().ToString("N") + ".zip");
        await using (var zipAkis = new FileStream(gecici, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 1 << 16, useAsync: true))
        using (var zip = new ZipArchive(zipAkis, ZipArchiveMode.Create, leaveOpen: true))
        {
            var kullanilan = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var (kayit, yol) in files)
            {
                var ad = Path.GetFileName(kayit.OrijinalDosyaAdi);
                if (tumu) ad = kayit.DosyaTuru + "/" + ad;
                var aday = ad; var n = 2;
                while (!kullanilan.Add(aday))
                    aday = Path.Combine(Path.GetDirectoryName(ad) ?? "", Path.GetFileNameWithoutExtension(ad) + $" ({n++})" + Path.GetExtension(ad)).Replace('\\', '/');
                var giris = zip.CreateEntry(aday, CompressionLevel.Fastest);
                await using var hedef = giris.Open();
                await using var kaynak = new FileStream(yol!, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16, useAsync: true);
                await kaynak.CopyToAsync(hedef, cancellationToken);
            }
        }

        var zipAdi = $"{siparisId}_{GuvenliAd(hasta[0])}_{(tumu ? "dosyalar" : secilenTur == "Tasarım" ? "tasarim" : secilenTur == "Tarama" ? "tarama" : "dosyalar")}.zip";
        var akis = new FileStream(gecici, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 1 << 16, FileOptions.DeleteOnClose | FileOptions.Asynchronous);
        return File(akis, "application/zip", zipAdi);
    }

    // ------------------------------------------------------------------ Dosya merkezi

    /// <summary>
    /// Tüm işlerin dosyaları tek listede: tür, "yalnız yeni" (laboratuvarın henüz indirmediği/görmediği),
    /// tarih ve metin süzgeci; kimin yüklediği ve indirme geçmişiyle.
    /// </summary>
    [HttpGet("liste")]
    public async Task<IActionResult> Liste(
        [FromQuery] string? tur, [FromQuery] bool yeni = false, [FromQuery] int gun = 0,
        [FromQuery] string? ara = null, [FromQuery] int sayfa = 0, CancellationToken ct = default)
    {
        var q = (ara ?? "").Trim();
        if (q.Length > 80) q = q[..80];
        var desen = "%" + q.Replace("\\", "").Replace("%", "").Replace("_", "") + "%";
        var no = int.TryParse(q.TrimStart('#'), out var n) ? n : -1;
        var turFiltre = string.IsNullOrWhiteSpace(tur) || tur == "Hepsi" ? "" : NormalizeType(tur);
        var baslangic = gun > 0 ? DateTime.UtcNow.AddDays(-Math.Min(gun, 3650)) : new DateTime(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        var rows = await _db.Database.SqlQuery<DosyaMerkeziSatiri>($"""
            SELECT f."Id", f."SiparisId", f."DosyaTuru", f."OrijinalDosyaAdi", f."Uzanti", f."Boyut", f."YuklemeTarihi",
                   COALESCE(ha."AdSoyad",'-') AS "HastaAdi", COALESCE(h."AdSoyad",'-') AS "HekimAdi",
                   t."AdSoyad" AS "TeknisyenAdi", COALESCE(s."Durum",'Bekliyor') AS "Durum",
                   COALESCE(s."OnayDurumu",'Onaylandı') AS "OnayDurumu", COALESCE(s."Silindi",false) AS "Silindi"
            FROM "IsDosyalari" f
            JOIN "Siparisler" s ON s."Id"=f."SiparisId"
            LEFT JOIN "Hastalar" ha ON ha."Id"=s."HastaId"
            LEFT JOIN "Hekimler" h ON h."Id"=ha."HekimId"
            LEFT JOIN "Teknisyenler" t ON t."Id"=s."TeknisyenId"
            WHERE COALESCE(s."Silindi",false)=false
              AND ({turFiltre}='' OR f."DosyaTuru"={turFiltre})
              AND f."YuklemeTarihi" >= {baslangic}
              AND ({q}='' OR f."SiparisId"={no} OR f."OrijinalDosyaAdi" ILIKE {desen} OR ha."AdSoyad" ILIKE {desen} OR h."AdSoyad" ILIKE {desen})
            ORDER BY f."YuklemeTarihi" DESC, f."Id" DESC
            LIMIT 3000
            """).ToListAsync(ct);

        var bilgi = _takip.DosyaBilgileri(rows.Select(x => x.Id));
        var tumu = rows.Select(x =>
        {
            bilgi.TryGetValue(x.Id, out var b);
            var labIndirme = b?.Indirmeler.Where(i => i.Kim == "Laboratuvar").ToList() ?? new();
            return new
            {
                x.Id, x.SiparisId, x.DosyaTuru, x.OrijinalDosyaAdi, x.Uzanti, x.Boyut, x.YuklemeTarihi,
                x.HastaAdi, x.HekimAdi, x.TeknisyenAdi, x.Durum, x.OnayDurumu,
                Yukleyen = b?.Yukleyen ?? (x.DosyaTuru == "Tarama" ? "Hekim / laboratuvar" : x.DosyaTuru == "Tasarım" ? "Teknisyen / laboratuvar" : null),
                YukleyenTipi = b?.YukleyenTipi,
                Yeni = _takip.LabIcinYeni(x.Id),
                LabIndirmeSayisi = labIndirme.Count,
                SonLabIndirme = labIndirme.LastOrDefault()?.Tarih,
                Indirmeler = b?.Indirmeler.TakeLast(6).Reverse().Select(i => new { i.Kim, i.Tarih }).ToList()
            };
        }).ToList();

        var liste = yeni ? tumu.Where(x => x.Yeni).ToList() : tumu;
        var bugun = DateTime.UtcNow.AddHours(3).Date.AddHours(-3);
        sayfa = Math.Max(0, sayfa);
        return Ok(new
        {
            ozet = new
            {
                yeni = tumu.Count(x => x.Yeni),
                bugun = tumu.Count(x => x.YuklemeTarihi >= bugun),
                toplam = tumu.Count,
                toplamBoyut = tumu.Sum(x => x.Boyut),
                tarama = tumu.Count(x => x.DosyaTuru == "Tarama"),
                tasarim = tumu.Count(x => x.DosyaTuru == "Tasarım")
            },
            dosyalar = liste.Skip(sayfa * 100).Take(100),
            devami = liste.Count > (sayfa + 1) * 100,
            sonuc = liste.Count
        });
    }

    /// <summary>Menü rozeti: laboratuvarın henüz görmediği yeni dosya sayısı.</summary>
    [HttpGet("yeni-sayisi")]
    public async Task<IActionResult> YeniSayisi(CancellationToken ct)
    {
        var sinir = _takip.BaslangicDosyaId;
        if (sinir == int.MaxValue) return Ok(new { yeni = 0 });
        var idler = await _db.Database.SqlQuery<int>($"""
            SELECT f."Id" AS "Value" FROM "IsDosyalari" f JOIN "Siparisler" s ON s."Id"=f."SiparisId"
            WHERE f."Id" > {sinir} AND COALESCE(s."Silindi",false)=false
            """).ToListAsync(ct);
        return Ok(new { yeni = idler.Count(_takip.LabIcinYeni) });
    }

    /// <summary>İndirmeden "görüldü" işaretler.</summary>
    [HttpPost("gorundu")]
    public IActionResult Gorundu([FromBody] DosyaSecimDto dto)
    {
        var ids = (dto.Idler ?? new()).Take(5000).ToList();
        if (ids.Count == 0) return BadRequest("Dosya seçin.");
        _takip.LabGordu(ids);
        return Ok(new { message = ids.Count + " dosya görüldü olarak işaretlendi." });
    }

    /// <summary>Seçilen dosyalar tek zip (iş numarası ve hasta adıyla klasörlenir).</summary>
    [HttpPost("zip")]
    public async Task<IActionResult> SeciliZip([FromForm] string idler, CancellationToken ct)
    {
        var ids = (idler ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => int.TryParse(x, out var v) ? v : 0).Where(x => x > 0).Distinct().Take(500).ToArray();
        if (ids.Length == 0) return BadRequest("Dosya seçin.");
        var files = (await _db.Database.SqlQuery<SeciliDosyaSatiri>($"""
            SELECT f."Id", f."SiparisId", f."DosyaTuru", f."OrijinalDosyaAdi", f."SaklananDosyaAdi", COALESCE(ha."AdSoyad",'hasta') AS "HastaAdi"
            FROM "IsDosyalari" f JOIN "Siparisler" s ON s."Id"=f."SiparisId" LEFT JOIN "Hastalar" ha ON ha."Id"=s."HastaId"
            WHERE f."Id" = ANY({ids})
            ORDER BY f."SiparisId", f."Id"
            """).ToListAsync(ct))
            .Select(f => (Kayit: f, Yol: TryPath(new IsDosyasiKayitDto { SiparisId = f.SiparisId, SaklananDosyaAdi = f.SaklananDosyaAdi })))
            .Where(x => x.Yol != null && System.IO.File.Exists(x.Yol))
            .ToList();
        if (files.Count == 0) return NotFound("İndirilecek dosya bulunamadı.");
        _takip.Indirildi(files.Select(x => x.Kayit.Id), "Laboratuvar");

        var gecici = Path.Combine(Path.GetTempPath(), "primerlab_" + Guid.NewGuid().ToString("N") + ".zip");
        await using (var zipAkis = new FileStream(gecici, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 1 << 16, useAsync: true))
        using (var zip = new ZipArchive(zipAkis, ZipArchiveMode.Create, leaveOpen: true))
        {
            var kullanilan = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var (k, yol) in files)
            {
                var ad = $"{k.SiparisId}_{GuvenliAd(k.HastaAdi)}/{k.DosyaTuru}/{Path.GetFileName(k.OrijinalDosyaAdi)}";
                var aday = ad; var i = 2;
                while (!kullanilan.Add(aday))
                    aday = ad[..^Path.GetExtension(ad).Length] + $" ({i++})" + Path.GetExtension(ad);
                var giris = zip.CreateEntry(aday, CompressionLevel.Fastest);
                await using var hedef = giris.Open();
                await using var kaynak = new FileStream(yol!, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16, useAsync: true);
                await kaynak.CopyToAsync(hedef, ct);
            }
        }
        var akis = new FileStream(gecici, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 1 << 16, FileOptions.DeleteOnClose | FileOptions.Asynchronous);
        return File(akis, "application/zip", $"dosyalar_{DateTime.UtcNow.AddHours(3):yyyyMMdd_HHmm}.zip");
    }

    // Fare ile üzerine gelindiğinde gösterilen hafif 3B önizleme (STL / PLY / OBJ).
    [HttpGet("{id:int}/onizleme")]
    public async Task<IActionResult> Onizleme(int id, CancellationToken cancellationToken)
    {
        var file = await GetFile(id);
        if (file == null) return NotFound("Dosya kaydı bulunamadı.");
        var yol = TryPath(file);
        if (yol == null || !System.IO.File.Exists(yol)) return NotFound("Dosyanın fiziksel kopyası bulunamadı.");
        if (!MeshOnizleme.Desteklenen.Contains(file.Uzanti)) return StatusCode(StatusCodes.Status415UnsupportedMediaType, "Bu dosya türü için önizleme yok.");

        string? onizleme;
        try
        {
            onizleme = await MeshOnizleme.OnizlemeYolu(
                yol, file.Uzanti,
                Path.Combine(_environment.ContentRootPath, "App_Data", "Onizleme"),
                file.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                cancellationToken);
        }
        catch (Exception ex) when (ex is InvalidDataException or IOException or FormatException or OverflowException or EndOfStreamException)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity, "Dosya okunamadı; önizleme oluşturulamadı.");
        }

        if (onizleme == null) return StatusCode(StatusCodes.Status422UnprocessableEntity, "Önizleme oluşturulamadı.");
        Response.Headers.CacheControl = "private, max-age=86400";
        return PhysicalFile(onizleme, "application/octet-stream");
    }

    private string? TryPath(IsDosyasiKayitDto f)
    {
        try { return SafeStoredPath(f.SiparisId, f.SaklananDosyaAdi); } catch { return null; }
    }

    private static string GuvenliAd(string ad)
    {
        var temiz = new string((ad ?? "").Select(c => char.IsLetterOrDigit(c) ? c : '_').ToArray()).Trim('_');
        return string.IsNullOrEmpty(temiz) ? "hasta" : temiz[..Math.Min(temiz.Length, 40)];
    }

    [HttpGet("{id:int}/indir")]
    public async Task<IActionResult> Download(int id)
    {
        var file = await GetFile(id);
        if (file == null) return NotFound("Dosya kaydı bulunamadı.");

        string fullPath;
        try { fullPath = SafeStoredPath(file.SiparisId, file.SaklananDosyaAdi); }
        catch { return StatusCode(500, "Dosya yolu güvenlik kontrolünden geçemedi."); }

        if (!System.IO.File.Exists(fullPath)) return NotFound("Dosyanın fiziksel kopyası bulunamadı.");
        _takip.Indirildi(new[] { id }, "Laboratuvar");

        var provider = new FileExtensionContentTypeProvider();
        if (!provider.TryGetContentType(file.OrijinalDosyaAdi, out var contentType))
            contentType = "application/octet-stream";

        return PhysicalFile(
            fullPath,
            contentType,
            Path.GetFileName(file.OrijinalDosyaAdi),
            enableRangeProcessing: true);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var file = await GetFile(id);
        if (file == null) return NotFound("Dosya kaydı bulunamadı.");

        string? fullPath = null;
        try { fullPath = SafeStoredPath(file.SiparisId, file.SaklananDosyaAdi); } catch { }

        var count = await _db.Database.ExecuteSqlInterpolatedAsync($"""
            DELETE FROM "IsDosyalari" WHERE "Id"={id}
            """);
        if (count == 0) return NotFound("Dosya kaydı bulunamadı.");
        _takip.DosyaSilindi(id);
        HttpContext.RequestServices.GetRequiredService<HekimPaylasimi>().DosyaSilindi(id);

        if (fullPath != null)
        {
            try { if (System.IO.File.Exists(fullPath)) System.IO.File.Delete(fullPath); } catch { }
        }
        return NoContent();
    }

    private Task<IsDosyasiKayitDto?> GetFile(int id) =>
        _db.Database.SqlQuery<IsDosyasiKayitDto>($"""
            SELECT "Id","SiparisId","DosyaTuru","OrijinalDosyaAdi","SaklananDosyaAdi","Uzanti","Boyut","YuklemeTarihi"
            FROM "IsDosyalari" WHERE "Id"={id}
            """).FirstOrDefaultAsync();
}

public class IsDosyasiListeDto
{
    public int Id { get; set; }
    public int SiparisId { get; set; }
    public string DosyaTuru { get; set; } = "Diger";
    public string OrijinalDosyaAdi { get; set; } = string.Empty;
    public string Uzanti { get; set; } = string.Empty;
    public long Boyut { get; set; }
    public DateTime YuklemeTarihi { get; set; }
}

public sealed class DosyaSecimDto
{
    public List<int>? Idler { get; set; }
}

public sealed class SeciliDosyaSatiri
{
    public int Id { get; set; }
    public int SiparisId { get; set; }
    public string DosyaTuru { get; set; } = "";
    public string OrijinalDosyaAdi { get; set; } = "";
    public string SaklananDosyaAdi { get; set; } = "";
    public string HastaAdi { get; set; } = "";
}

public sealed class DosyaMerkeziSatiri
{
    public int Id { get; set; }
    public int SiparisId { get; set; }
    public string DosyaTuru { get; set; } = "";
    public string OrijinalDosyaAdi { get; set; } = "";
    public string Uzanti { get; set; } = "";
    public long Boyut { get; set; }
    public DateTime YuklemeTarihi { get; set; }
    public string HastaAdi { get; set; } = "";
    public string HekimAdi { get; set; } = "";
    public string? TeknisyenAdi { get; set; }
    public string Durum { get; set; } = "";
    public string OnayDurumu { get; set; } = "";
    public bool Silindi { get; set; }
}

public sealed class IsDosyasiKayitDto : IsDosyasiListeDto
{
    public string SaklananDosyaAdi { get; set; } = string.Empty;
}
