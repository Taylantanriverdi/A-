using System.Net;
using Microsoft.AspNetCore.Mvc;
using PrimerLabV2.Infrastructure;

namespace PrimerLabV2.Controllers;

/// <summary>Yalnız ana bilgisayardan yapılabilen yönetim işleri için ortak denetim.</summary>
internal static class GuvenlikController
{
    internal static bool AnaBilgisayar(HttpContext context)
    {
        var ip = context.Connection.RemoteIpAddress;
        if (ip == null || IPAddress.IsLoopback(ip)) return true;
        return ip.IsIPv4MappedToIPv6 && IPAddress.IsLoopback(ip.MapToIPv4());
    }

    internal static ObjectResult Yasak() =>
        new("Bu ayar yalnız ana Primer Lab bilgisayarından değiştirilebilir.") { StatusCode = StatusCodes.Status403Forbidden };
}

/// <summary>Otomatik gece yedeği ayarları, elle yedek ve yedek indirme.</summary>
[ApiController]
[Route("api/otomatik-yedek")]
public sealed class OtomatikYedekController : ControllerBase
{
    private readonly OtomatikYedekServisi _servis;

    public OtomatikYedekController(OtomatikYedekServisi servis) => _servis = servis;

    [HttpGet]
    public IActionResult Durum()
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        var a = _servis.AyarlariOku();
        return Ok(new
        {
            a.Aktif,
            a.Saat,
            a.Saklanacak,
            a.EkKlasor,
            a.DosyalariDaYedekle,
            a.SonYedek,
            a.SonDurum,
            a.SonBasarili,
            klasor = _servis.AnaKlasor,
            yedekler = _servis.Yedekler().Take(100).Select(f => new
            {
                ad = f.Name,
                boyut = f.Length,
                tarih = f.LastWriteTimeUtc
            })
        });
    }

    [HttpPost]
    public IActionResult Kaydet([FromBody] OtomatikYedekAyarDto dto)
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        if (dto.Saat is < 0 or > 23) return BadRequest("Yedek saati 0 ile 23 arasında olmalıdır.");
        if (dto.Saklanacak is < 3 or > 365) return BadRequest("Saklanacak yedek sayısı 3 ile 365 arasında olmalıdır.");

        var ek = string.IsNullOrWhiteSpace(dto.EkKlasor) ? null : dto.EkKlasor.Trim();
        if (ek != null)
        {
            if (!Path.IsPathFullyQualified(ek))
                return BadRequest("İkinci yedek klasörü tam yol olmalıdır (ör. D:\\Yedek veya E:\\).");
            try
            {
                Directory.CreateDirectory(Path.Combine(ek, "PrimerLab_Yedekler"));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
            {
                return BadRequest("İkinci yedek klasörüne yazılamıyor: " + ex.Message);
            }
        }

        var a = _servis.AyarlariOku();
        a.Aktif = dto.Aktif;
        a.Saat = dto.Saat;
        a.Saklanacak = dto.Saklanacak;
        a.EkKlasor = ek;
        a.DosyalariDaYedekle = ek != null && dto.DosyalariDaYedekle;
        _servis.AyarlariYaz(a);
        return Durum();
    }

    [HttpPost("simdi")]
    public async Task<IActionResult> Simdi(CancellationToken ct)
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        var (basarili, mesaj) = await _servis.YedekAlAsync(ct);
        return basarili ? Ok(new { mesaj }) : StatusCode(StatusCodes.Status500InternalServerError, mesaj);
    }

    [HttpGet("indir/{ad}")]
    public IActionResult Indir(string ad)
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        if (!OtomatikYedekServisi.GecerliAd(ad)) return BadRequest("Geçersiz yedek adı.");
        var yol = Path.Combine(_servis.AnaKlasor, ad);
        if (!System.IO.File.Exists(yol)) return NotFound("Yedek bulunamadı.");
        return PhysicalFile(yol, "application/json", ad);
    }
}

public sealed class OtomatikYedekAyarDto
{
    public bool Aktif { get; set; } = true;
    public int Saat { get; set; } = 2;
    public int Saklanacak { get; set; } = 30;
    public string? EkKlasor { get; set; }
    public bool DosyalariDaYedekle { get; set; }
}
