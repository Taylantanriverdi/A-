using Microsoft.AspNetCore.Mvc;
using PrimerLabV2.Infrastructure;

namespace PrimerLabV2.Controllers;

/// <summary>Firma bilgileri ve logo (yalnız ana bilgisayardan değiştirilir).</summary>
[ApiController]
[Route("api/firma")]
public sealed class FirmaController : ControllerBase
{
    private readonly FirmaServisi _firma;

    public FirmaController(FirmaServisi firma) => _firma = firma;

    [HttpGet]
    public IActionResult Getir()
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        var b = _firma.Oku();
        return Ok(new
        {
            b.FirmaAdi, b.AltBaslik, b.Adres, b.Telefon, b.Eposta, b.WebSitesi,
            b.VergiDairesi, b.VergiNo, b.FormAltNotu, b.GuncellemeTarihi,
            logo = _firma.LogoDataUrl(),
            kisaltma = FirmaServisi.Kisaltma(b.FirmaAdi)
        });
    }

    [HttpPost]
    public IActionResult Kaydet([FromBody] FirmaDto dto)
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        static string? K(string? v, int max) => string.IsNullOrWhiteSpace(v) ? null : (v.Trim().Length > max ? v.Trim()[..max] : v.Trim());
        var ad = K(dto.FirmaAdi, 120);
        if (ad == null) return BadRequest("Firma adını yazın.");
        var eposta = K(dto.Eposta, 150);
        if (eposta != null && !System.Text.RegularExpressions.Regex.IsMatch(eposta, @"^[^@\s]+@[^@\s]+\.[^@\s]+$"))
            return BadRequest("E-posta adresi geçerli görünmüyor.");
        _firma.Kaydet(new FirmaServisi.Bilgiler
        {
            FirmaAdi = ad,
            AltBaslik = K(dto.AltBaslik, 120),
            Adres = K(dto.Adres, 300),
            Telefon = K(dto.Telefon, 60),
            Eposta = eposta,
            WebSitesi = K(dto.WebSitesi, 150),
            VergiDairesi = K(dto.VergiDairesi, 80),
            VergiNo = K(dto.VergiNo, 30),
            FormAltNotu = K(dto.FormAltNotu, 400)
        });
        return Getir();
    }

    [HttpPost("logo")]
    [RequestSizeLimit(2 * 1024 * 1024)]
    public async Task<IActionResult> LogoYukle(IFormFile? dosya, CancellationToken ct)
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        if (dosya == null) return BadRequest("Logo dosyası seçin.");
        if (dosya.Length > FirmaServisi.LogoAzamiBoyut) return BadRequest("Logo en fazla 1 MB olabilir. Daha küçük bir PNG/JPG seçin.");
        using var ms = new MemoryStream();
        await dosya.CopyToAsync(ms, ct);
        var hata = _firma.LogoKaydet(ms.ToArray());
        return hata != null ? BadRequest(hata) : Getir();
    }

    [HttpDelete("logo")]
    public IActionResult LogoSil()
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        _firma.LogoSil();
        return Getir();
    }
}

public sealed class FirmaDto
{
    public string? FirmaAdi { get; set; }
    public string? AltBaslik { get; set; }
    public string? Adres { get; set; }
    public string? Telefon { get; set; }
    public string? Eposta { get; set; }
    public string? WebSitesi { get; set; }
    public string? VergiDairesi { get; set; }
    public string? VergiNo { get; set; }
    public string? FormAltNotu { get; set; }
}
