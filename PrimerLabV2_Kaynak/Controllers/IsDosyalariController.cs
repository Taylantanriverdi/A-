using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;

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
            ".stl", ".obj", ".ply", ".zip", ".rar", ".7z", ".pdf",
            ".jpg", ".jpeg", ".png", ".webp", ".txt"
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
            return BadRequest("Desteklenmeyen dosya türü. STL, OBJ, PLY, ZIP, RAR, 7Z, PDF, JPG, PNG, WEBP ve TXT kabul edilir.");

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
            var id = await _db.Database.SqlQuery<int>($"""
                INSERT INTO "IsDosyalari"
                ("SiparisId","DosyaTuru","OrijinalDosyaAdi","SaklananDosyaAdi","Uzanti","Boyut","YuklemeTarihi")
                VALUES ({siparisId},{type},{originalName},{storedName},{extension},{dosya.Length},{now})
                RETURNING "Id" AS "Value"
                """).SingleAsync(cancellationToken);

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
