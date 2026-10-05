using Microsoft.AspNetCore.Mvc;
using PrimerLabV2.Infrastructure;

namespace PrimerLabV2.Controllers;

/// <summary>Ana program yönetici girişi: ilk şifre, giriş, çıkış, kurtarma kodu, şifre değiştirme.</summary>
[ApiController]
[Route("api/yonetici-giris")]
public sealed class YoneticiGirisController : ControllerBase
{
    private readonly YoneticiGirisi _giris;

    public YoneticiGirisController(YoneticiGirisi giris) => _giris = giris;

    [HttpGet("durum")]
    public IActionResult Durum() => Ok(new
    {
        kurulu = _giris.Kurulu,
        oturum = _giris.OturumGecerli(HttpContext),
        anaBilgisayar = GuvenlikController.AnaBilgisayar(HttpContext),
        sonDegisim = _giris.SonDegisim
    });

    // İlk şifre yalnız programın kurulu olduğu bilgisayardan belirlenir.
    [HttpPost("kur")]
    public IActionResult Kur([FromBody] YoneticiSifreDto dto)
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext))
            return StatusCode(StatusCodes.Status403Forbidden, "İlk şifre yalnız Primer Lab'in kurulu olduğu bilgisayardan belirlenebilir.");
        if (_giris.Kurulu) return Conflict("Yönetici şifresi zaten belirlenmiş. Giriş yapın.");
        var hata = Kontrol(dto.YeniParola, dto.YeniParolaTekrar);
        if (hata != null) return BadRequest(hata);
        var kod = _giris.Kur(dto.YeniParola!);
        if (kod == null) return Conflict("Yönetici şifresi zaten belirlenmiş. Giriş yapın.");
        _giris.OturumAc(HttpContext, dto.Hatirla);
        return Ok(new { kurtarmaKodu = kod });
    }

    [HttpPost("giris")]
    public async Task<IActionResult> Giris([FromBody] YoneticiSifreDto dto, CancellationToken ct)
    {
        if (!_giris.Kurulu) return Conflict("Önce yönetici şifresi belirlenmeli.");
        if (_giris.Kilitli() is { } dk)
            return StatusCode(StatusCodes.Status429TooManyRequests, $"Çok fazla hatalı deneme. {dk} dakika sonra tekrar deneyin ya da \"Şifremi unuttum\"u kullanın.");
        if (string.IsNullOrEmpty(dto.Parola) || !_giris.ParolaDogru(dto.Parola))
        {
            _giris.HataKaydet();
            await Task.Delay(Random.Shared.Next(250, 600), ct);
            return Unauthorized("Şifre hatalı.");
        }
        _giris.HatalariTemizle();
        // Yazıcı istasyonu (sürekli açık, sessiz yazdırma penceresi) bir yıl hatırlanır.
        _giris.OturumAc(HttpContext, dto.Hatirla, dto.Istasyon ? TimeSpan.FromDays(365) : null);
        if (dto.Istasyon) YaziciIstasyonuServisi.IstasyonIsaretle(HttpContext);
        return Ok(new { message = "Giriş yapıldı." });
    }

    // Programın kendi açtığı yazıcı istasyonu penceresi: tek kullanımlık anahtarla, şifre sormadan girer.
    [HttpGet("istasyon")]
    public IActionResult Istasyon([FromQuery] string? jeton, [FromQuery] string? kip, [FromServices] YaziciIstasyonuServisi istasyon)
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext) || !_giris.Kurulu || !istasyon.JetonKullan(jeton))
            return Redirect("/giris?r=" + Uri.EscapeDataString("/?istasyon=1"));
        _giris.OturumAc(HttpContext, true, TimeSpan.FromDays(365));
        YaziciIstasyonuServisi.IstasyonIsaretle(HttpContext);
        return Redirect(kip == "ayar" ? "/?istasyon=1&ayar=1" : "/?istasyon=1");
    }

    // Masaüstü kısayolu (PrimerLab_YaziciIstasyonu.bat) istasyonu programa açtırır.
    [HttpPost("istasyon-ac")]
    public IActionResult IstasyonAc([FromServices] YaziciIstasyonuServisi istasyon)
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        var hata = istasyon.Baslat();
        return hata == null ? Ok(new { message = "Yazıcı istasyonu açıldı." }) : BadRequest(hata);
    }

    [HttpPost("cikis")]
    public IActionResult Cikis()
    {
        YoneticiGirisi.OturumKapat(HttpContext);
        return Ok(new { message = "Çıkış yapıldı." });
    }

    [HttpPost("kurtar")]
    public async Task<IActionResult> Kurtar([FromBody] YoneticiSifreDto dto, CancellationToken ct)
    {
        if (!_giris.Kurulu) return Conflict("Önce yönetici şifresi belirlenmeli.");
        if (_giris.Kilitli() is { } dk)
            return StatusCode(StatusCodes.Status429TooManyRequests, $"Çok fazla hatalı deneme. {dk} dakika sonra tekrar deneyin.");
        var hata = Kontrol(dto.YeniParola, dto.YeniParolaTekrar);
        if (hata != null) return BadRequest(hata);
        var kod = _giris.KurtarmaIle(dto.KurtarmaKodu ?? "", dto.YeniParola!);
        if (kod == null)
        {
            _giris.HataKaydet();
            await Task.Delay(Random.Shared.Next(250, 600), ct);
            return Unauthorized("Kurtarma kodu hatalı. Kodu ilk şifreyi belirlerken kaydettiğiniz yerden kontrol edin.");
        }
        _giris.HatalariTemizle();
        _giris.OturumAc(HttpContext, dto.Hatirla);
        return Ok(new { kurtarmaKodu = kod });
    }

    // ---- oturum açıkken (ara katman zaten giriş ister)

    [HttpPost("sifre-degistir")]
    public IActionResult SifreDegistir([FromBody] YoneticiSifreDto dto)
    {
        if (!_giris.OturumGecerli(HttpContext)) return Unauthorized("Önce giriş yapın.");
        var hata = Kontrol(dto.YeniParola, dto.YeniParolaTekrar);
        if (hata != null) return BadRequest(hata);
        if (dto.YeniParola == dto.Parola) return BadRequest("Yeni şifre mevcut şifreyle aynı olamaz.");
        if (!_giris.ParolaDegistir(dto.Parola ?? "", dto.YeniParola!)) return BadRequest("Mevcut şifre hatalı.");
        _giris.OturumAc(HttpContext, false);
        return Ok(new { message = "Şifre değiştirildi. Diğer cihaz ve tarayıcılardaki oturumlar kapatıldı." });
    }

    [HttpPost("kurtarma-yenile")]
    public IActionResult KurtarmaYenile([FromBody] YoneticiSifreDto dto)
    {
        if (!_giris.OturumGecerli(HttpContext)) return Unauthorized("Önce giriş yapın.");
        var kod = _giris.KurtarmaKoduYenile(dto.Parola ?? "");
        return kod == null ? BadRequest("Mevcut şifre hatalı.") : Ok(new { kurtarmaKodu = kod });
    }

    private static string? Kontrol(string? yeni, string? tekrar)
    {
        var hata = PortalKimlik.ParolaKontrol(yeni);
        if (hata != null) return hata;
        return yeni != tekrar ? "İki şifre birbirinin aynısı değil." : null;
    }
}

public sealed class YoneticiSifreDto
{
    public string? Parola { get; set; }
    public string? YeniParola { get; set; }
    public string? YeniParolaTekrar { get; set; }
    public string? KurtarmaKodu { get; set; }
    public bool Hatirla { get; set; }
    public bool Istasyon { get; set; }
}
