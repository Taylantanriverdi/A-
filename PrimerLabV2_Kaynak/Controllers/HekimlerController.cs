using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;
using PrimerLabV2.Models;

namespace PrimerLabV2.Controllers;

[Route("api/hekimler")]
[ApiController]
public class HekimlerController : ControllerBase
{
    private readonly PrimerLabDbContext _db;

    public HekimlerController(PrimerLabDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<IActionResult> GetHekimler()
    {
        var rows = await _db.Hekimler
            .AsNoTracking()
            .Where(h => h.Aktif)
            .OrderBy(h => h.AdSoyad)
            .Select(h => new
            {
                h.Id,
                h.AdSoyad,
                h.KlinikAdi,
                h.Telefon,
                h.Email,
                h.Aktif,
                h.OlusturmaTarihi
            })
            .ToListAsync();

        return Ok(rows);
    }

    [HttpPost]
    public async Task<IActionResult> HekimEkle([FromBody] HekimKaydetDto dto)
    {
        var validation = Validate(dto);
        if (validation != null) return BadRequest(validation);

        var ad = dto.AdSoyad!.Trim();
        var duplicate = await _db.Hekimler
            .AsNoTracking()
            .AnyAsync(h => h.Aktif && h.AdSoyad.ToLower() == ad.ToLower());

        if (duplicate)
            return Conflict("Aynı isimde aktif bir hekim zaten kayıtlı.");

        var hekim = new Hekim
        {
            AdSoyad = ad,
            KlinikAdi = Normalize(dto.KlinikAdi, 200),
            Telefon = Normalize(dto.Telefon, 50),
            Email = NormalizeEmails(dto.Email),
            Aktif = true,
            OlusturmaTarihi = DateTime.UtcNow
        };

        _db.Hekimler.Add(hekim);
        await _db.SaveChangesAsync();

        return Created($"/api/hekimler/{hekim.Id}", hekim);
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> HekimGuncelle(int id, [FromBody] HekimKaydetDto dto)
    {
        var validation = Validate(dto);
        if (validation != null) return BadRequest(validation);

        var hekim = await _db.Hekimler.FirstOrDefaultAsync(h => h.Id == id);
        if (hekim == null) return NotFound("Hekim bulunamadı.");

        var ad = dto.AdSoyad!.Trim();
        var duplicate = await _db.Hekimler
            .AsNoTracking()
            .AnyAsync(h => h.Id != id && h.Aktif && h.AdSoyad.ToLower() == ad.ToLower());

        if (duplicate)
            return Conflict("Aynı isimde başka bir aktif hekim zaten kayıtlı.");

        hekim.AdSoyad = ad;
        hekim.KlinikAdi = Normalize(dto.KlinikAdi, 200);
        hekim.Telefon = Normalize(dto.Telefon, 50);
        hekim.Email = NormalizeEmails(dto.Email);
        hekim.Aktif = dto.Aktif;
        await _db.SaveChangesAsync();

        return Ok(hekim);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> HekimSil(int id)
    {
        var hekim = await _db.Hekimler.FirstOrDefaultAsync(h => h.Id == id);
        if (hekim == null)
            return NotFound("Hekim bulunamadı.");

        // Güvenli silme: geçmiş sipariş ve muhasebe ilişkileri korunur.
        hekim.Aktif = false;
        await _db.SaveChangesAsync();

        return Ok(new { message = "Hekim aktif listeden kaldırıldı.", id = hekim.Id });
    }

    private static string? Validate(HekimKaydetDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.AdSoyad)) return "Hekim adı boş olamaz.";
        if (dto.AdSoyad.Trim().Length > 150) return "Hekim adı en fazla 150 karakter olabilir.";
        if (!string.IsNullOrWhiteSpace(dto.Email))
        {
            var emails = SplitEmails(dto.Email);
            if (emails.Count > 10) return "Bir hekime en fazla 10 e-posta adresi eklenebilir.";
            if (emails.Any(x => !System.Net.Mail.MailAddress.TryCreate(x, out _)))
                return "E-posta adreslerinden biri geçersiz.";
            if (string.Join(";", emails).Length > 250) return "E-posta adreslerinin toplam uzunluğu 250 karakteri geçemez.";
        }
        return null;
    }

    private static string? Normalize(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var v = value.Trim();
        return v.Length <= max ? v : v[..max];
    }

    private static List<string> SplitEmails(string? value)
    {
        return (value ?? string.Empty)
            .Split(new[] { ';', ',', '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string? NormalizeEmails(string? value)
    {
        var emails = SplitEmails(value);
        return emails.Count == 0 ? null : string.Join(";", emails);
    }
}

public sealed class HekimKaydetDto
{
    public string? AdSoyad { get; set; }
    public string? KlinikAdi { get; set; }
    public string? Telefon { get; set; }
    public string? Email { get; set; }
    public bool Aktif { get; set; } = true;
}
