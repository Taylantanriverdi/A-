using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;
using PrimerLabV2.Infrastructure;

namespace PrimerLabV2.Controllers;

[ApiController]
[Route("api/mail-v2")]
public sealed class MailIntegrationController : ControllerBase
{
    private readonly MailIntegrationService _service;
    private readonly PrimerLabDbContext _db;
    private readonly IWebHostEnvironment _env;
    private readonly IcerikTakip _takip;

    public MailIntegrationController(
        MailIntegrationService service,
        PrimerLabDbContext db,
        IWebHostEnvironment env,
        IcerikTakip takip)
    {
        _service = service;
        _db = db;
        _env = env;
        _takip = takip;
    }

    private static readonly HashSet<string> IsDosyasiUzantilari = new(StringComparer.OrdinalIgnoreCase)
    {
        ".stl", ".obj", ".ply", ".dcm", ".zip", ".rar", ".7z", ".pdf", ".jpg", ".jpeg", ".png", ".webp", ".txt",
        ".xml", ".3ox", ".3oxz", ".dentalproject", ".constructioninfo"
    };

    [HttpGet("status")]
    public async Task<IActionResult> Status() => Ok(await _service.GetStatusAsync());

    [HttpGet("settings")]
    public IActionResult Settings() => Ok(_service.GetSettings());

    [HttpPost("settings")]
    public async Task<IActionResult> Settings([FromBody] MailRuntimeSettings settings)
    {
        await _service.SaveSettingsAsync(settings);
        return Ok(_service.GetSettings());
    }

    [HttpPost("credentials")]
    [RequestSizeLimit(2 * 1024 * 1024)]
    public async Task<IActionResult> Credentials(IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest("credentials.json seçilmelidir.");

        using var reader = new StreamReader(file.OpenReadStream(), Encoding.UTF8);
        var json = await reader.ReadToEndAsync();

        try
        {
            await _service.SaveCredentialsAsync(json);
            return Ok(new { configured = true });
        }
        catch (Exception ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpPost("connect")]
    public IActionResult Connect()
    {
        var state = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        Response.Cookies.Append(
            "primer_gmail_state",
            state,
            new CookieOptions
            {
                HttpOnly = true,
                SameSite = SameSiteMode.Lax,
                Secure = false,
                MaxAge = TimeSpan.FromMinutes(10)
            });

        try
        {
            return Ok(new { url = _service.BuildAuthorizationUrl(state) });
        }
        catch (Exception ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpGet("oauth/callback")]
    public async Task<IActionResult> Callback([FromQuery] string? code, [FromQuery] string? state, [FromQuery] string? error)
    {
        if (!string.IsNullOrWhiteSpace(error))
            return Content("Google bağlantısı iptal edildi veya hata oluştu: " + error);

        var expected = Request.Cookies["primer_gmail_state"];
        Response.Cookies.Delete("primer_gmail_state");

        if (string.IsNullOrWhiteSpace(code) ||
            string.IsNullOrWhiteSpace(state) ||
            string.IsNullOrWhiteSpace(expected) ||
            !CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(state),
                Encoding.UTF8.GetBytes(expected)))
        {
            return BadRequest("OAuth state doğrulaması başarısız.");
        }

        try
        {
            await _service.ExchangeCodeAsync(code);
            return Redirect("/?gmail=connected");
        }
        catch (Exception ex)
        {
            return Content("Gmail bağlantısı kurulamadı: " + ex.Message);
        }
    }

    [HttpDelete("disconnect")]
    public IActionResult Disconnect()
    {
        _service.Disconnect();
        return NoContent();
    }

    [HttpPost("stop")]
    public IActionResult Stop()
    {
        var stopped = _service.CancelActiveRun();
        var runtime = _service.GetRuntimeStatus();

        return Ok(new
        {
            stopped,
            runtime,
            message = stopped
                ? "Durdurma isteği alındı."
                : "Aktif mail sorgusu bulunamadı."
        });
    }

    [HttpPost("preview")]
    public async Task<IActionResult> Preview(CancellationToken cancellationToken)
    {
        var result = await _service.RunAsync(true, cancellationToken);
        return result.Success ? Ok(result) : BadRequest(result);
    }

    [HttpPost("process")]
    public async Task<IActionResult> Process(CancellationToken cancellationToken)
    {
        var result = await _service.RunAsync(false, cancellationToken);
        return result.Success ? Ok(result) : BadRequest(result);
    }

    /// <summary>Mail sayaçları (menü rozeti ve süzgeç sekmeleri).</summary>
    [HttpGet("ozet")]
    public async Task<IActionResult> Ozet(CancellationToken ct)
    {
        var d = await _db.Database.SqlQuery<MailOzetSatiri>($"""
            SELECT COUNT(*) FILTER (WHERE "Aktarildi"=false)::int AS "Bekleyen",
                   COUNT(*) FILTER (WHERE "Aktarildi"=false AND COALESCE("IncelemeGerekli",false))::int AS "Inceleme",
                   COUNT(*) FILTER (WHERE "Aktarildi"=true)::int AS "Aktarilan",
                   COUNT(*)::int AS "Toplam"
            FROM "MailGelenler"
            """).SingleAsync(ct);
        return Ok(d);
    }

    [HttpGet("mails")]
    public async Task<IActionResult> Mails(
        [FromQuery] string? search = null,
        [FromQuery] bool reviewOnly = false,
        [FromQuery] int take = 200,
        [FromQuery] string? durum = null)
    {
        take = Math.Clamp(take, 1, 500);
        var d = durum is "bekleyen" or "aktarilan" ? durum : "";
        try
        {
        var rows = await _db.Database.SqlQuery<MailListRow>($"""
            SELECT
                -- Türler açıkça belirtilir: tablo eski bir sürümde farklı türlerle oluşturulmuş olsa da liste okunur.
                m."Id"::int AS "Id",m."Tarih"::timestamptz AS "Tarih",m."Gonderen"::text AS "Gonderen",m."Konu"::text AS "Konu",m."HekimId"::int AS "HekimId",
                h."AdSoyad"::text AS "HekimAdi",h."KlinikAdi"::text AS "KlinikAdi",
                m."HastaAdi"::text AS "HastaAdi",m."IsTuru"::text AS "IsTuru",m."DisRengi"::text AS "DisRengi",m."Materyal"::text AS "Materyal",m."Notlar"::text AS "Notlar",
                m."Klinik"::text AS "Klinik",CASE WHEN m."UyeSayisi"::text ~ '^\s*[0-9]+\s*$' AND length(btrim(m."UyeSayisi"::text)) < 7 THEN btrim(m."UyeSayisi"::text)::int END AS "UyeSayisi",m."DisNo"::text AS "DisNo",m."ReferansKodu"::text AS "ReferansKodu",
                m."MesajId"::text AS "MesajId",m."Dosyalar"::text AS "Dosyalar",m."WetransferLinkleri"::text AS "WetransferLinkleri",
                m."AnalizKaynagi"::text AS "AnalizKaynagi",CASE WHEN m."Guven"::text ~ '^\s*-?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?\s*$' THEN btrim(m."Guven"::text)::float8 END AS "Guven",
                COALESCE(m."IncelemeGerekli"::boolean,false) AS "IncelemeGerekli",COALESCE(m."Aktarildi"::boolean,false) AS "Aktarildi",
                (SELECT COUNT(*)::int FROM "MailDosyalari" f WHERE f."MailId"=m."Id") AS "DosyaSayisi"
            FROM "MailGelenler" m
            LEFT JOIN "Hekimler" h ON h."Id"=m."HekimId"
            WHERE ({reviewOnly}=false OR COALESCE(m."IncelemeGerekli",false)=true)
              AND ({d}='' OR ({d}='bekleyen' AND m."Aktarildi"=false) OR ({d}='aktarilan' AND m."Aktarildi"=true))
              AND (
                    {string.IsNullOrWhiteSpace(search)}=true OR
                    COALESCE(m."Gonderen",'') ILIKE {'%' + (search ?? "") + '%'} OR
                    COALESCE(m."Konu",'') ILIKE {'%' + (search ?? "") + '%'} OR
                    COALESCE(m."HastaAdi",'') ILIKE {'%' + (search ?? "") + '%'} OR
                    COALESCE(h."AdSoyad",'') ILIKE {'%' + (search ?? "") + '%'}
                  )
            ORDER BY m."Tarih" DESC,m."Id" DESC
            LIMIT {take}
            """).ToListAsync();

        return Ok(rows);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Genel "500" yerine gerçek neden gösterilir (destek için).
            return StatusCode(StatusCodes.Status500InternalServerError, "Mail listesi okunamadı: " + ex.GetBaseException().Message);
        }
    }

    [HttpGet("mail/{id:int}/files")]
    public async Task<IActionResult> Files(int id)
    {
        var rows = await _db.Database.SqlQuery<MailFileListRow>($"""
            SELECT "Id"::int AS "Id","MailId"::int AS "MailId",COALESCE("DosyaAdi"::text,'dosya') AS "DosyaAdi",COALESCE("Boyut"::bigint,0) AS "Boyut",COALESCE("MimeType"::text,'application/octet-stream') AS "MimeType"
            FROM "MailDosyalari"
            WHERE "MailId"={id}
            ORDER BY "Id"
            """).ToListAsync();

        return Ok(rows);
    }

    [HttpGet("mail/{mailId:int}/file/{fileId:int}")]
    public async Task<IActionResult> Download(int mailId, int fileId, CancellationToken cancellationToken)
    {
        var row = await _db.Database.SqlQuery<MailFileListRow>($"""
            SELECT "Id"::int AS "Id","MailId"::int AS "MailId",COALESCE("DosyaAdi"::text,'dosya') AS "DosyaAdi",COALESCE("Boyut"::bigint,0) AS "Boyut",COALESCE("MimeType"::text,'application/octet-stream') AS "MimeType"
            FROM "MailDosyalari"
            WHERE "Id"={fileId} AND "MailId"={mailId}
            """).FirstOrDefaultAsync(cancellationToken);

        if (row == null) return NotFound();

        var path = await _service.GetStoredFilePathAsync(mailId, fileId, cancellationToken);
        if (path == null) return NotFound("Dosya diskte bulunamadı.");

        return PhysicalFile(path, string.IsNullOrWhiteSpace(row.MimeType) ? "application/octet-stream" : row.MimeType, row.DosyaAdi);
    }


    [HttpGet("mail/{mailId:int}/download-all")]
    public async Task<IActionResult> DownloadAll(int mailId, CancellationToken cancellationToken)
    {
        var mail = await _db.Database.SqlQuery<MailDownloadInfoRow>($"""
            SELECT
                "Id",
                COALESCE(NULLIF("HastaAdi",''),'MAIL_' || "Id"::text) AS "HastaAdi",
                "Tarih"
            FROM "MailGelenler"
            WHERE "Id"={mailId}
            """).FirstOrDefaultAsync(cancellationToken);

        if (mail == null)
            return NotFound("Mail kaydı bulunamadı.");

        var files = await _db.Database.SqlQuery<MailFileListRow>($"""
            SELECT "Id"::int AS "Id","MailId"::int AS "MailId",COALESCE("DosyaAdi"::text,'dosya') AS "DosyaAdi",COALESCE("Boyut"::bigint,0) AS "Boyut",COALESCE("MimeType"::text,'application/octet-stream') AS "MimeType"
            FROM "MailDosyalari"
            WHERE "MailId"={mailId}
            ORDER BY "Id"
            """).ToListAsync(cancellationToken);

        if (files.Count == 0)
            return NotFound("Bu mailde indirilebilir dosya kaydı yok.");

        // Tek dosyada gereksiz ZIP oluşturma.
        if (files.Count == 1)
        {
            var only = files[0];
            var path = await _service.GetStoredFilePathAsync(mailId, only.Id, cancellationToken);

            if (path == null)
                return NotFound("Dosya diskte bulunamadı.");

            return PhysicalFile(
                path,
                string.IsNullOrWhiteSpace(only.MimeType) ? "application/octet-stream" : only.MimeType,
                only.DosyaAdi);
        }

        var validFiles = new List<(MailFileListRow Row, string Path)>();

        foreach (var file in files)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var path = await _service.GetStoredFilePathAsync(mailId, file.Id, cancellationToken);
            if (path != null && System.IO.File.Exists(path))
                validFiles.Add((file, path));
        }

        if (validFiles.Count == 0)
            return NotFound("Dosya kayıtları var ancak dosyalar diskte bulunamadı.");

        if (validFiles.Count == 1)
        {
            var one = validFiles[0];
            return PhysicalFile(
                one.Path,
                string.IsNullOrWhiteSpace(one.Row.MimeType) ? "application/octet-stream" : one.Row.MimeType,
                one.Row.DosyaAdi);
        }

        await using var memory = new MemoryStream();

        using (var archive = new ZipArchive(memory, ZipArchiveMode.Create, leaveOpen: true))
        {
            var usedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var item in validFiles)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var safeName = SafeDownloadFileName(item.Row.DosyaAdi);
                safeName = UniqueArchiveName(safeName, usedNames);

                var entry = archive.CreateEntry(safeName, CompressionLevel.Fastest);

                await using var source = System.IO.File.OpenRead(item.Path);
                await using var target = entry.Open();
                await source.CopyToAsync(target, cancellationToken);
            }
        }

        memory.Position = 0;

        var patient = SafeDownloadFileName(mail.HastaAdi);
        if (string.IsNullOrWhiteSpace(patient))
            patient = "MAIL_" + mailId;

        var date = mail.Tarih.ToString("yyyy-MM-dd");
        var zipName = $"{patient}_{date}.zip";

        return File(memory.ToArray(), "application/zip", zipName);
    }

    private static string SafeDownloadFileName(string? value)
    {
        var name = string.IsNullOrWhiteSpace(value) ? "dosya" : value.Trim();

        foreach (var ch in Path.GetInvalidFileNameChars())
            name = name.Replace(ch, '_');

        name = name.Replace('/', '_').Replace('\\', '_');

        while (name.Contains("__", StringComparison.Ordinal))
            name = name.Replace("__", "_", StringComparison.Ordinal);

        return name.Trim(' ', '.', '_');
    }

    private static string UniqueArchiveName(string fileName, HashSet<string> used)
    {
        if (used.Add(fileName))
            return fileName;

        var extension = Path.GetExtension(fileName);
        var stem = Path.GetFileNameWithoutExtension(fileName);

        for (var i = 2; i < 10000; i++)
        {
            var candidate = $"{stem}_{i}{extension}";
            if (used.Add(candidate))
                return candidate;
        }

        return Guid.NewGuid().ToString("N") + extension;
    }

    /// <summary>Mailin tüm ayrıntısı: gövde metni, AI'nın çıkardığı alanlar, ekler.</summary>
    [HttpGet("mail/{id:int}")]
    public async Task<IActionResult> Detay(int id, CancellationToken ct)
    {
        var m = await _db.Database.SqlQuery<MailDetaySatiri>($"""
            SELECT m."Id"::int AS "Id", m."Tarih"::timestamptz AS "Tarih", m."Gonderen"::text AS "Gonderen", m."Konu"::text AS "Konu",
                   left(COALESCE(m."Gövde"::text,''), 30000) AS "Govde",
                   m."HekimId"::int AS "HekimId", h."AdSoyad"::text AS "HekimAdi", m."Klinik"::text AS "Klinik", m."HastaAdi"::text AS "HastaAdi",
                   m."IsTuru"::text AS "IsTuru", m."DisRengi"::text AS "DisRengi", m."Materyal"::text AS "Materyal",
                   m."Notlar"::text AS "Notlar", CASE WHEN m."UyeSayisi"::text ~ '^\s*[0-9]+\s*$' AND length(btrim(m."UyeSayisi"::text)) < 7 THEN btrim(m."UyeSayisi"::text)::int END AS "UyeSayisi", m."DisNo"::text AS "DisNo", m."ReferansKodu"::text AS "ReferansKodu",
                   m."WetransferLinkleri"::text AS "WetransferLinkleri", m."AnalizKaynagi"::text AS "AnalizKaynagi",
                   CASE WHEN m."Guven"::text ~ '^\s*-?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?\s*$' THEN btrim(m."Guven"::text)::float8 END AS "Guven", COALESCE(m."IncelemeGerekli"::boolean,false) AS "IncelemeGerekli", COALESCE(m."Aktarildi"::boolean,false) AS "Aktarildi"
            FROM "MailGelenler" m LEFT JOIN "Hekimler" h ON h."Id"=m."HekimId"
            WHERE m."Id"={id}
            """).FirstOrDefaultAsync(ct);
        if (m == null) return NotFound("Mail bulunamadı.");
        var dosyalar = await _db.Database.SqlQuery<MailFileListRow>($"""
            SELECT "Id"::int AS "Id","MailId"::int AS "MailId",COALESCE("DosyaAdi"::text,'dosya') AS "DosyaAdi",COALESCE("Boyut"::bigint,0) AS "Boyut",COALESCE("MimeType"::text,'application/octet-stream') AS "MimeType"
            FROM "MailDosyalari" WHERE "MailId"={id} ORDER BY "Id"
            """).ToListAsync(ct);
        return Ok(new { mail = m, dosyalar });
    }

    /// <summary>İşlendi (aktarıldı) işaretini koyar ya da kaldırır (gövdesiz çağrı: işlendi).</summary>
    [HttpPatch("mail/{id:int}/aktarildi")]
    public async Task<IActionResult> MarkTransferred(int id, [FromBody] MailDurumDto? dto = null)
    {
        var deger = dto?.Aktarildi ?? true;
        var count = await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE "MailGelenler"
            SET "Aktarildi"={deger}
            WHERE "Id"={id}
            """);

        return count == 0 ? NotFound() : Ok(new { aktarildi = deger });
    }

    /// <summary>
    /// Mailden oluşturulan siparişe mailin eklerini iş dosyası olarak kopyalar (3B dosyalar "Tarama")
    /// ve maili işlendi olarak işaretler. Sipariş para birimine göre bölündüyse her işe kopyalanır.
    /// </summary>
    [HttpPost("mail/{id:int}/ise-aktar")]
    public async Task<IActionResult> IseAktar(int id, [FromBody] MailIseAktarDto dto, CancellationToken ct)
    {
        var isler = (dto.SiparisIdler ?? new()).Where(x => x > 0).Distinct().Take(10).ToList();
        if (isler.Count == 0) return BadRequest("Sipariş numarası gerekli.");
        var mevcut = await _db.Database.SqlQuery<int>($"""
            SELECT "Id" AS "Value" FROM "Siparisler" WHERE "Id" = ANY({isler.ToArray()})
            """).ToListAsync(ct);
        if (mevcut.Count == 0) return NotFound("Sipariş bulunamadı.");
        var dosyalar = await _db.Database.SqlQuery<MailFileListRow>($"""
            SELECT "Id"::int AS "Id","MailId"::int AS "MailId",COALESCE("DosyaAdi"::text,'dosya') AS "DosyaAdi",COALESCE("Boyut"::bigint,0) AS "Boyut",COALESCE("MimeType"::text,'application/octet-stream') AS "MimeType"
            FROM "MailDosyalari" WHERE "MailId"={id} ORDER BY "Id"
            """).ToListAsync(ct);

        int kopyalanan = 0, atlanan = 0;
        var gonderen = await _db.Database.SqlQuery<string>($"""
            SELECT COALESCE(h."AdSoyad", m."Gonderen", 'Mail') AS "Value"
            FROM "MailGelenler" m LEFT JOIN "Hekimler" h ON h."Id"=m."HekimId" WHERE m."Id"={id}
            """).FirstOrDefaultAsync(ct) ?? "Mail";
        foreach (var f in dosyalar)
        {
            var uzanti = Path.GetExtension(f.DosyaAdi).ToLowerInvariant();
            var kaynak = await _service.GetStoredFilePathAsync(id, f.Id, ct);
            if (kaynak == null || !IsDosyasiUzantilari.Contains(uzanti)) { atlanan++; continue; }
            var tur = uzanti is ".stl" or ".obj" or ".ply" or ".dcm" or ".zip" or ".rar" or ".7z" or ".3ox" or ".3oxz" or ".xml" ? "Tarama" : "Diger";
            var ad = Path.GetFileName(f.DosyaAdi);
            if (ad.Length > 240) ad = ad[^240..];
            foreach (var siparisId in mevcut)
            {
                var klasor = Path.GetFullPath(Path.Combine(_env.ContentRootPath, "App_Data", "IsDosyalari", siparisId.ToString()));
                Directory.CreateDirectory(klasor);
                var saklanan = Guid.NewGuid().ToString("N") + uzanti;
                var hedef = Path.Combine(klasor, saklanan);
                System.IO.File.Copy(kaynak, hedef);
                try
                {
                    var dosyaId = (await _db.Database.SqlQuery<int>($"""
                        INSERT INTO "IsDosyalari" ("SiparisId","DosyaTuru","OrijinalDosyaAdi","SaklananDosyaAdi","Uzanti","Boyut","YuklemeTarihi")
                        VALUES ({siparisId},{tur},{ad},{saklanan},{uzanti},{new FileInfo(hedef).Length},{DateTime.UtcNow})
                        RETURNING "Id" AS "Value"
                        """).ToListAsync(ct)).Single();
                    _takip.DosyaYuklendi(dosyaId, "Mail", gonderen + " (mail eki)");
                    kopyalanan++;
                }
                catch
                {
                    try { System.IO.File.Delete(hedef); } catch { }
                    throw;
                }
            }
        }

        await _db.Database.ExecuteSqlInterpolatedAsync($"""UPDATE "MailGelenler" SET "Aktarildi"=true WHERE "Id"={id}""", ct);
        return Ok(new
        {
            kopyalanan, atlanan,
            message = kopyalanan > 0
                ? $"{kopyalanan} mail eki siparişin dosyalarına eklendi." + (atlanan > 0 ? $" {atlanan} ek (desteklenmeyen tür ya da diskte yok) atlandı." : "")
                : dosyalar.Count == 0 ? "Mailde kayıtlı ek yok." : "Ekler aktarılamadı (desteklenmeyen tür ya da diskte yok)."
        });
    }
}


public sealed class MailDownloadInfoRow
{
    public int Id { get; set; }
    public string HastaAdi { get; set; } = string.Empty;
    public DateTime Tarih { get; set; }
}

public sealed class MailListRow
{
    public int Id { get; set; }
    public DateTime Tarih { get; set; }
    public string? Gonderen { get; set; }
    public string? Konu { get; set; }
    public int? HekimId { get; set; }
    public string? HekimAdi { get; set; }
    public string? KlinikAdi { get; set; }
    public string? HastaAdi { get; set; }
    public string? IsTuru { get; set; }
    public string? DisRengi { get; set; }
    public string? Materyal { get; set; }
    public string? Notlar { get; set; }
    public string? MesajId { get; set; }
    public string? Dosyalar { get; set; }
    public string? WetransferLinkleri { get; set; }
    public string? AnalizKaynagi { get; set; }
    public double? Guven { get; set; }
    public bool IncelemeGerekli { get; set; }
    public bool Aktarildi { get; set; }
    public int DosyaSayisi { get; set; }
    public string? Klinik { get; set; }
    public int? UyeSayisi { get; set; }
    public string? DisNo { get; set; }
    public string? ReferansKodu { get; set; }
}

public sealed class MailOzetSatiri
{
    public int Bekleyen { get; set; }
    public int Inceleme { get; set; }
    public int Aktarilan { get; set; }
    public int Toplam { get; set; }
}

public sealed class MailDurumDto
{
    public bool? Aktarildi { get; set; }
}

public sealed class MailIseAktarDto
{
    public List<int>? SiparisIdler { get; set; }
}

public sealed class MailDetaySatiri
{
    public int Id { get; set; }
    public DateTime Tarih { get; set; }
    public string? Gonderen { get; set; }
    public string? Konu { get; set; }
    public string? Govde { get; set; }
    public int? HekimId { get; set; }
    public string? HekimAdi { get; set; }
    public string? Klinik { get; set; }
    public string? HastaAdi { get; set; }
    public string? IsTuru { get; set; }
    public string? DisRengi { get; set; }
    public string? Materyal { get; set; }
    public string? Notlar { get; set; }
    public int? UyeSayisi { get; set; }
    public string? DisNo { get; set; }
    public string? ReferansKodu { get; set; }
    public string? WetransferLinkleri { get; set; }
    public string? AnalizKaynagi { get; set; }
    public double? Guven { get; set; }
    public bool IncelemeGerekli { get; set; }
    public bool Aktarildi { get; set; }
}

public sealed class MailFileListRow
{
    public int Id { get; set; }
    public int MailId { get; set; }
    public string DosyaAdi { get; set; } = "";
    public long Boyut { get; set; }
    public string MimeType { get; set; } = "application/octet-stream";
}
