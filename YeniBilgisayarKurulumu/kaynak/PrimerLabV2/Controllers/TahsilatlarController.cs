using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;

namespace PrimerLabV2.Controllers;

[Route("api/tahsilatlar")]
[ApiController]
public class TahsilatlarController : ControllerBase
{
    private static readonly string[] GecerliOdemeTurleri =
    {
        "Nakit", "Havale/EFT", "Kredi Kartı", "Çek", "Diğer"
    };

    private readonly PrimerLabDbContext _db;

    public TahsilatlarController(PrimerLabDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var rows = await _db.Database.SqlQuery<TahsilatListeDto>($"""
            SELECT
                t."Id", t."HekimId", h."AdSoyad" AS "HekimAdi", h."KlinikAdi",
                t."Tutar", COALESCE(t."ParaBirimi",'TRY') AS "ParaBirimi",
                t."Tarih", t."OdemeTuru", t."IslemNo", t."Aciklama",
                t."OlusturmaTarihi"
            FROM "Tahsilatlar" t
            INNER JOIN "Hekimler" h ON h."Id" = t."HekimId"
            ORDER BY t."Tarih" DESC, t."Id" DESC
            """).ToListAsync();

        return Ok(rows);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] TahsilatKaydetDto dto)
    {
        var validation = await ValidateDto(dto);
        if (validation != null) return validation;

        var hekim = await _db.Hekimler.AsNoTracking()
            .FirstAsync(h => h.Id == dto.HekimId && h.Aktif);

        var tarih = NormalizeDate(dto.Tarih) ?? DateTime.UtcNow;

        var kapaliDonem = await CariKurallari.KapaliDonemHatasi(_db, dto.HekimId, tarih);
        if (kapaliDonem != null) return BadRequest(kapaliDonem);

        var odemeTuru = NormalizeOdemeTuru(dto.OdemeTuru);
        var islemNo = NormalizeOptional(dto.IslemNo, 150);
        var aciklama = NormalizeOptional(dto.Aciklama, 500);
        var now = DateTime.UtcNow;

        // SingleAsync() INSERT ... RETURNING sorgusunu alt sorguya sarmaya çalışıp
        // her çağrıda hata veriyordu (EF Core 8+); ToListAsync() SQL'i olduğu gibi çalıştırır.
        var id = (await _db.Database.SqlQuery<int>($"""
            INSERT INTO "Tahsilatlar"
            ("HekimId","Tutar","ParaBirimi","Tarih","OdemeTuru","IslemNo","Aciklama","OlusturmaTarihi")
            VALUES
            ({dto.HekimId},{dto.Tutar},{NormalizeCurrency(dto.ParaBirimi)},{tarih},{odemeTuru},{islemNo},{aciklama},{now})
            RETURNING "Id" AS "Value"
            """)
                .ToListAsync()).Single();

        return Created($"/api/tahsilatlar/{id}", new
        {
            Id = id,
            dto.HekimId,
            HekimAdi = hekim.AdSoyad,
            KlinikAdi = hekim.KlinikAdi,
            dto.Tutar,
            ParaBirimi = NormalizeCurrency(dto.ParaBirimi),
            Tarih = tarih,
            OdemeTuru = odemeTuru,
            IslemNo = islemNo,
            Aciklama = aciklama
        });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] TahsilatKaydetDto dto)
    {
        var validation = await ValidateDto(dto);
        if (validation != null) return validation;

        var tarih = NormalizeDate(dto.Tarih) ?? DateTime.UtcNow;

        // Kapatılmış döneme ait tahsilat düzenlenemez; düzenleme ile bir tahsilat
        // kapatılmış döneme de taşınamaz. Aksi halde kapanmış dönem toplamları
        // ile gerçek kayıtlar ayrışır veya tahsilat bakiyeden kaybolur.
        var mevcut = await _db.Database.SqlQuery<TahsilatDonemGuardDto>($"""
            SELECT "HekimId","Tarih" FROM "Tahsilatlar" WHERE "Id"={id}
            """).FirstOrDefaultAsync();
        if (mevcut == null) return NotFound("Tahsilat kaydı bulunamadı.");

        var eskiDonem = await CariKurallari.KapaliDonemHatasi(_db, mevcut.HekimId, mevcut.Tarih);
        if (eskiDonem != null)
            return BadRequest("Bu tahsilat kapatılmış bir döneme aittir ve düzenlenemez. Önce son dönemi geri alın.");

        var yeniDonem = await CariKurallari.KapaliDonemHatasi(_db, dto.HekimId, tarih);
        if (yeniDonem != null) return BadRequest(yeniDonem);

        var odemeTuru = NormalizeOdemeTuru(dto.OdemeTuru);
        var islemNo = NormalizeOptional(dto.IslemNo, 150);
        var aciklama = NormalizeOptional(dto.Aciklama, 500);

        var count = await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE "Tahsilatlar"
            SET "HekimId"={dto.HekimId}, "Tutar"={dto.Tutar},
                "ParaBirimi"={NormalizeCurrency(dto.ParaBirimi)}, "Tarih"={tarih},
                "OdemeTuru"={odemeTuru}, "IslemNo"={islemNo}, "Aciklama"={aciklama}
            WHERE "Id"={id}
            """);

        if (count == 0) return NotFound("Tahsilat kaydı bulunamadı.");
        return Ok(new
        {
            Id = id,
            dto.HekimId,
            dto.Tutar,
            ParaBirimi = NormalizeCurrency(dto.ParaBirimi),
            Tarih = tarih,
            OdemeTuru = odemeTuru,
            IslemNo = islemNo,
            Aciklama = aciklama
        });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var archived = await _db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(
                SELECT 1
                FROM "Tahsilatlar" t
                INNER JOIN "CariDonemleri" d
                    ON d."HekimId"=t."HekimId"
                   AND COALESCE(d."GeriAlindi",false)=false
                   AND t."Tarih"<=d."KapanisTarihi"
                WHERE t."Id"={id}
            ) AS "Value"
            """).SingleAsync();

        if (archived)
            return BadRequest("Bu tahsilat kapatılmış bir döneme aittir. Önce son dönemi geri alın.");

        var count = await _db.Database.ExecuteSqlInterpolatedAsync($"""
            DELETE FROM "Tahsilatlar" WHERE "Id"={id}
            """);
        return count == 0 ? NotFound("Tahsilat kaydı bulunamadı.") : NoContent();
    }

    private async Task<IActionResult?> ValidateDto(TahsilatKaydetDto dto)
    {
        if (dto.HekimId <= 0) return BadRequest("Hekim seçilmelidir.");
        if (dto.Tutar <= 0) return BadRequest("Tahsilat tutarı 0'dan büyük olmalıdır.");
        if (dto.Tutar > 1_000_000_000m) return BadRequest("Tahsilat tutarı güvenli sınırı aşıyor.");
        if (NormalizeCurrency(dto.ParaBirimi) == null) return BadRequest("Para birimi TRY, EUR veya USD olmalıdır.");

        if (!await _db.Hekimler.AsNoTracking().AnyAsync(h => h.Id == dto.HekimId && h.Aktif))
            return BadRequest("Hekim bulunamadı veya pasif.");

        if (!GecerliOdemeTurleri.Contains(NormalizeOdemeTuru(dto.OdemeTuru)))
            return BadRequest("Geçersiz ödeme türü.");

        if (dto.IslemNo?.Trim().Length > 150) return BadRequest("İşlem / makbuz numarası en fazla 150 karakter olabilir.");
        if (dto.Aciklama?.Trim().Length > 500) return BadRequest("Açıklama en fazla 500 karakter olabilir.");
        return null;
    }

    private static DateTime? NormalizeDate(DateTime? value)
    {
        if (!value.HasValue) return null;
        return DateTime.SpecifyKind(value.Value.Date, DateTimeKind.Utc);
    }

    private static string? NormalizeCurrency(string? value)
    {
        var c = string.IsNullOrWhiteSpace(value) ? "TRY" : value.Trim().ToUpperInvariant();
        return c is "TRY" or "EUR" or "USD" ? c : null;
    }

    private static string NormalizeOdemeTuru(string? value) =>
        string.IsNullOrWhiteSpace(value) ? "Nakit" : value.Trim();

    private static string? NormalizeOptional(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var v = value.Trim();
        return v.Length <= max ? v : v[..max];
    }
}

public sealed class TahsilatKaydetDto
{
    public int HekimId { get; set; }
    public decimal Tutar { get; set; }
    public string? ParaBirimi { get; set; } = "TRY";
    public DateTime? Tarih { get; set; }
    public string? OdemeTuru { get; set; }
    public string? IslemNo { get; set; }
    public string? Aciklama { get; set; }
}

public sealed class TahsilatDonemGuardDto
{
    public int HekimId { get; set; }
    public DateTime Tarih { get; set; }
}

public sealed class TahsilatListeDto
{
    public int Id { get; set; }
    public int HekimId { get; set; }
    public string HekimAdi { get; set; } = string.Empty;
    public string? KlinikAdi { get; set; }
    public decimal Tutar { get; set; }
    public string ParaBirimi { get; set; } = "TRY";
    public DateTime Tarih { get; set; }
    public string? OdemeTuru { get; set; }
    public string? IslemNo { get; set; }
    public string? Aciklama { get; set; }
    public DateTime OlusturmaTarihi { get; set; }
}
