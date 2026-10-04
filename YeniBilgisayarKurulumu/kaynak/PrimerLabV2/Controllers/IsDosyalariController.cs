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

    private const long MaxFileSize = 250L * 1024L * 1024L;

    private static readonly HashSet<string> AllowedExtensions =
        new(StringComparer.OrdinalIgnoreCase)
        {
            // .dcm Hekim Portalı'nda kabul ediliyordu; laboratuvar ekranında da kabul edilir.
            ".stl", ".obj", ".ply", ".dcm", ".zip", ".rar", ".7z", ".pdf",
            ".jpg", ".jpeg", ".png", ".webp", ".txt",
            // Tarayıcı / CAD programlarının sipariş ve proje dosyaları (3Shape, exocad).
            ".xml", ".3ox", ".3oxz", ".dentalproject", ".constructioninfo"
        };

    public IsDosyalariController(PrimerLabDbContext db, IWebHostEnvironment environment)
    {
        _db = db;
        _environment = environment;
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
            return BadRequest("Desteklenmeyen dosya türü. STL, OBJ, PLY, DCM, ZIP, RAR, 7Z, PDF, JPG, PNG, WEBP, TXT, XML, 3OX ve exocad proje dosyaları kabul edilir.");

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

            var type = NormalizeType(dosyaTuru);
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

public sealed class IsDosyasiKayitDto : IsDosyasiListeDto
{
    public string SaklananDosyaAdi { get; set; } = string.Empty;
}
