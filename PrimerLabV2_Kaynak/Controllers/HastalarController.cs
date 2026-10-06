using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;
using PrimerLabV2.Models;

namespace PrimerLabV2.Controllers;

[Route("api/hastalar")]
[ApiController]
public class HastalarController : ControllerBase
{
    private readonly PrimerLabDbContext _db;

    public HastalarController(PrimerLabDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<IActionResult> GetHastalar() =>
        Ok(await Query().Where(h => h.Aktif).OrderBy(h => h.AdSoyad).ToListAsync());

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetHasta(int id)
    {
        var row = await Query().FirstOrDefaultAsync(h => h.Id == id);
        return row == null ? NotFound("Kayıt bulunamadı.") : Ok(row);
    }

    [HttpGet("hekim/{hekimId:int}")]
    public async Task<IActionResult> GetHekiminHastalari(int hekimId)
    {
        if (!await _db.Hekimler.AsNoTracking().AnyAsync(h => h.Id == hekimId))
            return NotFound("Hekim bulunamadı.");

        return Ok(await Query()
            .Where(h => h.HekimId == hekimId && h.Aktif)
            .OrderBy(h => h.AdSoyad)
            .ToListAsync());
    }

    [HttpPost]
    public async Task<IActionResult> HastaEkle([FromBody] HastaKaydetDto dto)
    {
        var error = await Validate(dto);
        if (error != null) return BadRequest(error);

        var hasta = new Hasta
        {
            AdSoyad = dto.AdSoyad!.Trim(),
            HekimId = dto.HekimId,
            Telefon = Normalize(dto.Telefon, 50),
            Notlar = Normalize(dto.Notlar, 2000),
            OlusturmaTarihi = DateTime.UtcNow,
            Aktif = true
        };

        _db.Hastalar.Add(hasta);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetHasta), new { id = hasta.Id }, new { hasta.Id });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> HastaDuzenle(int id, [FromBody] HastaKaydetDto dto)
    {
        var error = await Validate(dto);
        if (error != null) return BadRequest(error);

        var hasta = await _db.Hastalar.FirstOrDefaultAsync(h => h.Id == id);
        if (hasta == null) return NotFound("Kayıt bulunamadı.");

        hasta.AdSoyad = dto.AdSoyad!.Trim();
        hasta.HekimId = dto.HekimId;
        hasta.Telefon = Normalize(dto.Telefon, 50);
        hasta.Notlar = Normalize(dto.Notlar, 2000);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPatch("{id:int}/pasif")]
    public async Task<IActionResult> HastaPasifeAl(int id) => await SetAktif(id, false);

    [HttpPatch("{id:int}/aktif")]
    public async Task<IActionResult> HastaAktifEt(int id) => await SetAktif(id, true);

    private IQueryable<HastaListeDto> Query() =>
        _db.Hastalar.AsNoTracking().Select(h => new HastaListeDto
        {
            Id = h.Id,
            AdSoyad = h.AdSoyad,
            HekimId = h.HekimId,
            HekimAdi = h.Hekim!.AdSoyad,
            HekimKlinikAdi = h.Hekim.KlinikAdi,
            Telefon = h.Telefon,
            Notlar = h.Notlar,
            Aktif = h.Aktif,
            OlusturmaTarihi = h.OlusturmaTarihi
        });

    private async Task<string?> Validate(HastaKaydetDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.AdSoyad)) return "Hasta/iş sahibi adı boş olamaz.";
        if (dto.AdSoyad.Trim().Length > 150) return "Ad en fazla 150 karakter olabilir.";
        if (dto.HekimId <= 0 || !await _db.Hekimler.AsNoTracking().AnyAsync(h => h.Id == dto.HekimId && h.Aktif))
            return "Geçerli ve aktif bir hekim seçilmelidir.";
        return null;
    }

    private async Task<IActionResult> SetAktif(int id, bool aktif)
    {
        var hasta = await _db.Hastalar.FirstOrDefaultAsync(h => h.Id == id);
        if (hasta == null) return NotFound("Kayıt bulunamadı.");
        if (hasta.Aktif == aktif) return NoContent();
        hasta.Aktif = aktif;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private static string? Normalize(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var v = value.Trim();
        return v.Length <= max ? v : v[..max];
    }
}

public sealed class HastaKaydetDto
{
    public string? AdSoyad { get; set; }
    public int HekimId { get; set; }
    public string? Telefon { get; set; }
    public string? Notlar { get; set; }
}

public sealed class HastaListeDto
{
    public int Id { get; set; }
    public string AdSoyad { get; set; } = string.Empty;
    public int HekimId { get; set; }
    public string HekimAdi { get; set; } = string.Empty;
    public string? HekimKlinikAdi { get; set; }
    public string? Telefon { get; set; }
    public string? Notlar { get; set; }
    public bool Aktif { get; set; }
    public DateTime OlusturmaTarihi { get; set; }
}
