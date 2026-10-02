using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;

namespace PrimerLabV2.Controllers;

[ApiController]
[Route("api/cari")]
public sealed class CariArsivController : ControllerBase
{
    private readonly PrimerLabDbContext _db;
    private static readonly string[] Currencies = { "TRY", "EUR", "USD" };

    public CariArsivController(PrimerLabDbContext db) => _db = db;

    [HttpGet("ozet")]
    public async Task<IActionResult> Ozet([FromQuery] DateTime? baslangic, [FromQuery] DateTime? bitis)
    {
        var hekimler = await _db.Hekimler.AsNoTracking()
            .Where(h => h.Aktif)
            .OrderBy(h => h.AdSoyad)
            .Select(h => new { h.Id, h.AdSoyad, h.KlinikAdi })
            .ToListAsync();

        var result = new List<object>();

        foreach (var h in hekimler)
        {
            var d = await BuildCurrent(h.Id, baslangic, bitis);

            result.Add(new
            {
                hekimId = h.Id,
                hekimAdi = h.AdSoyad,
                klinikAdi = h.KlinikAdi,
                toplamIs = d.Isler.Count,
                toplamlar = d.Toplamlar,
                tahsilatlar = d.TahsilatToplamlari,
                kalanBakiye = d.Bakiyeler,
                donemBaslangic = d.DonemBaslangic,
                eskiDonemSayisi = await _db.Database.SqlQuery<int>($"""
                    SELECT COUNT(*)::int AS "Value"
                    FROM "CariDonemleri"
                    WHERE "HekimId"={h.Id} AND COALESCE("GeriAlindi",false)=false
                    """).SingleAsync()
            });
        }

        return Ok(result);
    }

    [HttpGet("{hekimId:int}/detay")]
    public async Task<IActionResult> Detay(
        int hekimId,
        [FromQuery] DateTime? baslangic,
        [FromQuery] DateTime? bitis)
    {
        var hekim = await _db.Hekimler.AsNoTracking()
            .Where(h => h.Id == hekimId)
            .Select(h => new { h.Id, h.AdSoyad, h.KlinikAdi, h.Telefon, h.Email })
            .FirstOrDefaultAsync();

        if (hekim == null) return NotFound("Hekim bulunamadı.");

        var d = await BuildCurrent(hekimId, baslangic, bitis);

        var donemler = await _db.Database.SqlQuery<CariDonemListeDto>($"""
            SELECT "Id","HekimId","BaslangicTarihi","KapanisTarihi","IsSayisi",
                   "ToplamlarJson","TahsilatlarJson","BakiyelerJson",
                   "DevirEklendi","GeriAlindi","Notlar","OlusturmaTarihi"
            FROM "CariDonemleri"
            WHERE "HekimId"={hekimId}
            ORDER BY "KapanisTarihi" DESC, "Id" DESC
            """).ToListAsync();

        return Ok(new
        {
            hekim,
            d.DonemBaslangic,
            d.Isler,
            d.Tahsilatlar,
            d.Devir,
            d.Toplamlar,
            d.TahsilatToplamlari,
            d.Bakiyeler,
            donemler = donemler.Select(x => new
            {
                x.Id,
                x.BaslangicTarihi,
                x.KapanisTarihi,
                x.IsSayisi,
                toplamlar = ParseMoneyMap(x.ToplamlarJson),
                tahsilatlar = ParseMoneyMap(x.TahsilatlarJson),
                bakiyeler = ParseMoneyMap(x.BakiyelerJson),
                x.DevirEklendi,
                x.GeriAlindi,
                x.Notlar,
                x.OlusturmaTarihi
            })
        });
    }

    [HttpPost("tahsilat")]
    public async Task<IActionResult> Tahsilat([FromBody] CariTahsilatDto dto)
    {
        if (dto.HekimId <= 0) return BadRequest("Hekim seçilmelidir.");
        if (dto.Tutar <= 0) return BadRequest("Tahsilat tutarı 0'dan büyük olmalıdır.");

        var currency = NormalizeCurrency(dto.ParaBirimi);
        if (currency == null) return BadRequest("Para birimi TRY, EUR veya USD olmalıdır.");

        if (!await _db.Hekimler.AsNoTracking().AnyAsync(h => h.Id == dto.HekimId))
            return BadRequest("Hekim bulunamadı.");

        var tarih = NormalizeDate(dto.Tarih) ?? DateTime.UtcNow;
        var odeme = string.IsNullOrWhiteSpace(dto.OdemeTuru) ? "Nakit" : dto.OdemeTuru.Trim();
        var aciklama = Trim(dto.Aciklama, 500);
        var islem = Trim(dto.IslemNo, 150);

        var id = await _db.Database.SqlQuery<int>($"""
            INSERT INTO "Tahsilatlar"
            ("HekimId","Tutar","ParaBirimi","Tarih","OdemeTuru","IslemNo","Aciklama","OlusturmaTarihi")
            VALUES
            ({dto.HekimId},{dto.Tutar},{currency},{tarih},{odeme},{islem},{aciklama},{DateTime.UtcNow})
            RETURNING "Id" AS "Value"
            """).SingleAsync();

        return Ok(new { id });
    }

    [HttpDelete("tahsilat/{id:int}")]
    public async Task<IActionResult> TahsilatSil(int id)
    {
        var row = await _db.Database.SqlQuery<CariTahsilatSilGuardDto>($"""
            SELECT t."Id", t."HekimId", t."Tarih"
            FROM "Tahsilatlar" t
            WHERE t."Id"={id}
            """).FirstOrDefaultAsync();

        if (row == null)
            return NotFound("Tahsilat bulunamadı.");

        var latest = await SonAktifDonem(row.HekimId);
        if (latest != null && row.Tarih <= latest.KapanisTarihi)
            return BadRequest("Bu tahsilat kapatılmış bir döneme aittir. Önce son dönemi geri alın.");

        await _db.Database.ExecuteSqlInterpolatedAsync($"""
            DELETE FROM "Tahsilatlar" WHERE "Id"={id}
            """);

        return NoContent();
    }

    [HttpPost("{hekimId:int}/donem-kapat")]
    public async Task<IActionResult> DonemKapat(int hekimId, [FromBody] DonemKapatDto dto)
    {
        if (!await _db.Hekimler.AsNoTracking().AnyAsync(h => h.Id == hekimId))
            return NotFound("Hekim bulunamadı.");

        var kapanisDate = NormalizeDate(dto.KapanisTarihi) ?? DateTime.UtcNow.Date;
        if (kapanisDate.Date > DateTime.UtcNow.Date)
            return BadRequest("Dönem kapanış tarihi gelecekte olamaz.");

        var kapanis = kapanisDate.Date.AddDays(1).AddTicks(-1);
        var latest = await SonAktifDonem(hekimId);

        if (latest != null && kapanis <= latest.KapanisTarihi)
            return BadRequest("Yeni kapanış tarihi önceki kapanış tarihinden sonra olmalıdır.");

        var current = await BuildCurrent(hekimId, null, kapanis, includeCarry: true);

        if (current.Isler.Count == 0 && current.Tahsilatlar.Count == 0 &&
            current.Devir.Values.All(v => v == 0))
            return BadRequest("Kapatılacak cari hareket bulunmuyor.");

        var bakiye = new Dictionary<string, decimal>(current.Bakiyeler);
        if (dto.KapanisBakiyeleri != null)
        {
            foreach (var c in Currencies)
            {
                if (dto.KapanisBakiyeleri.TryGetValue(c, out var v))
                    bakiye[c] = v;
            }
        }

        var id = await _db.Database.SqlQuery<int>($"""
            INSERT INTO "CariDonemleri"
            ("HekimId","BaslangicTarihi","KapanisTarihi","IsSayisi",
             "ToplamlarJson","TahsilatlarJson","BakiyelerJson",
             "IslerSnapshotJson","TahsilatlarSnapshotJson",
             "DevirEklendi","GeriAlindi","Notlar","OlusturmaTarihi")
            VALUES
            ({hekimId},{current.DonemBaslangic},{kapanis},{current.Isler.Count},
             {JsonSerializer.Serialize(current.Toplamlar)},
             {JsonSerializer.Serialize(current.TahsilatToplamlari)},
             {JsonSerializer.Serialize(bakiye)},
             {JsonSerializer.Serialize(current.Isler)},
             {JsonSerializer.Serialize(current.Tahsilatlar)},
             {dto.DevirEkle},false,{Trim(dto.Notlar,1000)},{DateTime.UtcNow})
            RETURNING "Id" AS "Value"
            """).SingleAsync();

        return Ok(new
        {
            id,
            kapanisTarihi = kapanis,
            bakiyeler = bakiye,
            devirEklendi = dto.DevirEkle
        });
    }


    [HttpGet("donem/{id:int}")]
    public async Task<IActionResult> Donem(int id)
    {
        var x = await _db.Database.SqlQuery<CariDonemDetayDto>($"""
            SELECT "Id","HekimId","BaslangicTarihi","KapanisTarihi","IsSayisi",
                   "ToplamlarJson","TahsilatlarJson","BakiyelerJson",
                   "IslerSnapshotJson","TahsilatlarSnapshotJson",
                   "DevirEklendi","GeriAlindi","Notlar","OlusturmaTarihi"
            FROM "CariDonemleri" WHERE "Id"={id}
            """).FirstOrDefaultAsync();

        if (x == null) return NotFound("Dönem bulunamadı.");

        return Ok(new
        {
            x.Id, x.HekimId, x.BaslangicTarihi, x.KapanisTarihi, x.IsSayisi,
            toplamlar = ParseMoneyMap(x.ToplamlarJson),
            tahsilatlar = ParseMoneyMap(x.TahsilatlarJson),
            bakiyeler = ParseMoneyMap(x.BakiyelerJson),
            isler = JsonSerializer.Deserialize<object>(x.IslerSnapshotJson),
            odemeler = JsonSerializer.Deserialize<object>(x.TahsilatlarSnapshotJson),
            x.DevirEklendi, x.GeriAlindi, x.Notlar, x.OlusturmaTarihi
        });
    }

    [HttpPut("donem/{id:int}")]
    public async Task<IActionResult> DonemDuzenle(int id, [FromBody] DonemDuzenleDto dto)
    {
        var json = JsonSerializer.Serialize(dto.Bakiyeler ?? EmptyMoneyMap());
        var count = await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE "CariDonemleri"
            SET "BakiyelerJson"={json},
                "DevirEklendi"={dto.DevirEkle},
                "Notlar"={Trim(dto.Notlar,1000)},
                "GuncellemeTarihi"={DateTime.UtcNow}
            WHERE "Id"={id} AND COALESCE("GeriAlindi",false)=false
            """);
        return count == 0 ? NotFound("Aktif arşiv dönemi bulunamadı.") : Ok();
    }

    [HttpPost("donem/{id:int}/geri-al")]
    public async Task<IActionResult> DonemGeriAl(int id)
    {
        var row = await _db.Database.SqlQuery<DonemHekimDto>($"""
            SELECT "Id","HekimId"
            FROM "CariDonemleri"
            WHERE "Id"={id} AND COALESCE("GeriAlindi",false)=false
            """).FirstOrDefaultAsync();

        if (row == null) return NotFound("Aktif dönem bulunamadı.");

        var latestId = await _db.Database.SqlQuery<int>($"""
            SELECT COALESCE(MAX("Id"),0) AS "Value"
            FROM "CariDonemleri"
            WHERE "HekimId"={row.HekimId} AND COALESCE("GeriAlindi",false)=false
            """).SingleAsync();

        if (latestId != id)
            return BadRequest("Yalnızca hekimin en son kapatılan dönemi geri alınabilir.");

        await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE "CariDonemleri"
            SET "GeriAlindi"=true,"GuncellemeTarihi"={DateTime.UtcNow}
            WHERE "Id"={id}
            """);

        return Ok();
    }

    private async Task<CariCurrent> BuildCurrent(
        int hekimId,
        DateTime? filterStart,
        DateTime? filterEnd,
        bool includeCarry = true)
    {
        var latest = await SonAktifDonem(hekimId);
        DateTime? periodStart = latest?.KapanisTarihi.AddTicks(1);

        var allJobs = await _db.Database.SqlQuery<CariIsDto>($"""
            SELECT
                s."Id",
                h."AdSoyad" AS "HekimAdi",
                p."AdSoyad" AS "HastaAdi",
                COALESCE(s."ParaBirimi",'TRY') AS "ParaBirimi",
                COALESCE(SUM(k."Adet" * k."BirimFiyat"),0) AS "Tutar",
                COALESCE(string_agg(k."IsTuru", ', ' ORDER BY k."Id"),'-') AS "IsTuru",
                s."OlusturmaTarihi" AS "TeslimTarihi"
            FROM "Siparisler" s
            INNER JOIN "Hastalar" p ON p."Id"=s."HastaId"
            INNER JOIN "Hekimler" h ON h."Id"=p."HekimId"
            LEFT JOIN "SiparisKalemleri" k ON k."SiparisId"=s."Id"
            WHERE p."HekimId"={hekimId}
              AND COALESCE(s."Silindi",false)=false
              AND s."Durum" IN ('Tamamlandı','Teslim')
            GROUP BY s."Id",h."AdSoyad",p."AdSoyad",s."ParaBirimi",s."OlusturmaTarihi"
            ORDER BY "TeslimTarihi" DESC, s."Id" DESC
            """).ToListAsync();

        var payments = await _db.Database.SqlQuery<CariTahsilatListeDto>($"""
            SELECT "Id","HekimId","Tutar",COALESCE("ParaBirimi",'TRY') AS "ParaBirimi",
                   "Tarih","OdemeTuru","IslemNo","Aciklama","OlusturmaTarihi"
            FROM "Tahsilatlar"
            WHERE "HekimId"={hekimId}
            ORDER BY "Tarih" DESC,"Id" DESC
            """).ToListAsync();

        var effectiveStart = MaxDate(periodStart, NormalizeDate(filterStart));
        var effectiveEnd = filterEnd.HasValue
            ? NormalizeDate(filterEnd)!.Value.Date.AddDays(1).AddTicks(-1)
            : (DateTime?)null;

        var jobs = allJobs.Where(x =>
            (!effectiveStart.HasValue || x.TeslimTarihi >= effectiveStart.Value) &&
            (!effectiveEnd.HasValue || x.TeslimTarihi <= effectiveEnd.Value)
        ).ToList();

        var pays = payments.Where(x =>
            (!effectiveStart.HasValue || x.Tarih >= effectiveStart.Value) &&
            (!effectiveEnd.HasValue || x.Tarih <= effectiveEnd.Value)
        ).ToList();

        var totals = EmptyMoneyMap();
        foreach (var x in jobs) totals[NormalizeCurrency(x.ParaBirimi) ?? "TRY"] += x.Tutar;

        var paymentTotals = EmptyMoneyMap();
        foreach (var x in pays) paymentTotals[NormalizeCurrency(x.ParaBirimi) ?? "TRY"] += x.Tutar;

        var devir = EmptyMoneyMap();
        // Başlangıç filtresi verilmediyse devreden bakiye korunur.
        // Böylece dönem kapanışında ve sadece bitiş tarihi filtrelerinde bakiye kaybolmaz.
        if (includeCarry && !filterStart.HasValue && latest != null && latest.DevirEklendi)
        {
            var previous = ParseMoneyMap(latest.BakiyelerJson);
            foreach (var c in Currencies) devir[c] = previous[c];
        }

        var balance = EmptyMoneyMap();
        foreach (var c in Currencies)
            balance[c] = devir[c] + totals[c] - paymentTotals[c];

        return new CariCurrent
        {
            DonemBaslangic = periodStart,
            Isler = jobs,
            Tahsilatlar = pays,
            Devir = devir,
            Toplamlar = totals,
            TahsilatToplamlari = paymentTotals,
            Bakiyeler = balance
        };
    }

    private async Task<CariDonemLatestDto?> SonAktifDonem(int hekimId) =>
        await _db.Database.SqlQuery<CariDonemLatestDto>($"""
            SELECT "Id","KapanisTarihi","BakiyelerJson","DevirEklendi"
            FROM "CariDonemleri"
            WHERE "HekimId"={hekimId} AND COALESCE("GeriAlindi",false)=false
            ORDER BY "KapanisTarihi" DESC,"Id" DESC
            LIMIT 1
            """).FirstOrDefaultAsync();

    private static Dictionary<string, decimal> EmptyMoneyMap() =>
        new() { ["TRY"] = 0, ["EUR"] = 0, ["USD"] = 0 };

    private static Dictionary<string, decimal> ParseMoneyMap(string? json)
    {
        var result = EmptyMoneyMap();
        if (string.IsNullOrWhiteSpace(json)) return result;
        try
        {
            var parsed = JsonSerializer.Deserialize<Dictionary<string, decimal>>(json);
            if (parsed != null)
                foreach (var c in Currencies)
                    if (parsed.TryGetValue(c, out var v)) result[c] = v;
        }
        catch { }
        return result;
    }

    private static string? NormalizeCurrency(string? value)
    {
        var c = string.IsNullOrWhiteSpace(value) ? "TRY" : value.Trim().ToUpperInvariant();
        return c is "TRY" or "EUR" or "USD" ? c : null;
    }

    private static DateTime? NormalizeDate(DateTime? value)
    {
        if (!value.HasValue) return null;
        return DateTime.SpecifyKind(value.Value.Date, DateTimeKind.Utc);
    }

    private static DateTime? MaxDate(DateTime? a, DateTime? b)
    {
        if (!a.HasValue) return b;
        if (!b.HasValue) return a;
        return a.Value > b.Value ? a : b;
    }

    private static string? Trim(string? v, int max)
    {
        if (string.IsNullOrWhiteSpace(v)) return null;
        v = v.Trim();
        return v.Length <= max ? v : v[..max];
    }
}

public sealed class CariCurrent
{
    public DateTime? DonemBaslangic { get; set; }
    public List<CariIsDto> Isler { get; set; } = new();
    public List<CariTahsilatListeDto> Tahsilatlar { get; set; } = new();
    public Dictionary<string, decimal> Devir { get; set; } = new();
    public Dictionary<string, decimal> Toplamlar { get; set; } = new();
    public Dictionary<string, decimal> TahsilatToplamlari { get; set; } = new();
    public Dictionary<string, decimal> Bakiyeler { get; set; } = new();
}

public sealed class CariIsDto
{
    public int Id { get; set; }
    public string HekimAdi { get; set; } = "";
    public string HastaAdi { get; set; } = "";
    public string IsTuru { get; set; } = "";
    public decimal Tutar { get; set; }
    public string ParaBirimi { get; set; } = "TRY";
    public DateTime TeslimTarihi { get; set; }
}

public sealed class CariTahsilatListeDto
{
    public int Id { get; set; }
    public int HekimId { get; set; }
    public decimal Tutar { get; set; }
    public string ParaBirimi { get; set; } = "TRY";
    public DateTime Tarih { get; set; }
    public string? OdemeTuru { get; set; }
    public string? IslemNo { get; set; }
    public string? Aciklama { get; set; }
    public DateTime OlusturmaTarihi { get; set; }
}

public sealed class CariTahsilatDto
{
    public int HekimId { get; set; }
    public decimal Tutar { get; set; }
    public string? ParaBirimi { get; set; } = "TRY";
    public DateTime? Tarih { get; set; }
    public string? OdemeTuru { get; set; }
    public string? IslemNo { get; set; }
    public string? Aciklama { get; set; }
}

public sealed class DonemKapatDto
{
    public DateTime? KapanisTarihi { get; set; }
    public bool DevirEkle { get; set; } = true;
    public Dictionary<string, decimal>? KapanisBakiyeleri { get; set; }
    public string? Notlar { get; set; }
}

public sealed class DonemDuzenleDto
{
    public bool DevirEkle { get; set; } = true;
    public Dictionary<string, decimal>? Bakiyeler { get; set; }
    public string? Notlar { get; set; }
}

public sealed class OlusturulanCariDonemDto
{
    public int Id { get; set; }
}

public sealed class CariDonemLatestDto
{
    public int Id { get; set; }
    public DateTime KapanisTarihi { get; set; }
    public string BakiyelerJson { get; set; } = "{}";
    public bool DevirEklendi { get; set; }
}

public class CariDonemListeDto
{
    public int Id { get; set; }
    public int HekimId { get; set; }
    public DateTime? BaslangicTarihi { get; set; }
    public DateTime KapanisTarihi { get; set; }
    public int IsSayisi { get; set; }
    public string ToplamlarJson { get; set; } = "{}";
    public string TahsilatlarJson { get; set; } = "{}";
    public string BakiyelerJson { get; set; } = "{}";
    public bool DevirEklendi { get; set; }
    public bool GeriAlindi { get; set; }
    public string? Notlar { get; set; }
    public DateTime OlusturmaTarihi { get; set; }
}

public sealed class CariDonemDetayDto : CariDonemListeDto
{
    public string IslerSnapshotJson { get; set; } = "[]";
    public string TahsilatlarSnapshotJson { get; set; } = "[]";
}

public sealed class CariTahsilatSilGuardDto
{
    public int Id { get; set; }
    public int HekimId { get; set; }
    public DateTime Tarih { get; set; }
}

public sealed class DonemHekimDto
{
    public int Id { get; set; }
    public int HekimId { get; set; }
}
