using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using PrimerLabV2.Infrastructure;

namespace PrimerLabV2.Controllers;

/// <summary>
/// WhatsApp Business Cloud API webhook'u (Meta buraya gelen mesajları iletir; internet tüneli
/// yalnız bu yolu açar) ve ana programdaki WhatsApp ayarları.
/// Gelen her istek Meta'nın imzasıyla (uygulama gizli anahtarı) doğrulanır; imzasız istek işlenmez.
/// </summary>
[ApiController]
[Route("api/whatsapp")]
public sealed class WhatsAppController : ControllerBase
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> NumaraKilitleri = new();

    private readonly WhatsAppServisi _wa;
    private readonly IServiceScopeFactory _scope;
    private readonly IConfiguration _config;
    private readonly ILogger<WhatsAppController> _log;

    public WhatsAppController(WhatsAppServisi wa, IServiceScopeFactory scope, IConfiguration config, ILogger<WhatsAppController> log)
    {
        _wa = wa;
        _scope = scope;
        _config = config;
        _log = log;
    }

    // ---------------------------------------------------------------- webhook (Meta)

    [HttpGet("webhook")]
    public IActionResult Dogrula([FromQuery(Name = "hub.mode")] string? mod, [FromQuery(Name = "hub.verify_token")] string? jeton,
        [FromQuery(Name = "hub.challenge")] string? challenge)
    {
        var a = _wa.Oku();
        if (mod == "subscribe" && !string.IsNullOrEmpty(jeton) && jeton == a.DogrulamaJetonu && challenge != null)
            return Content(challenge, "text/plain");
        return StatusCode(StatusCodes.Status403Forbidden, "Doğrulama jetonu hatalı.");
    }

    [HttpPost("webhook")]
    public async Task<IActionResult> Al()
    {
        using var ms = new MemoryStream();
        await Request.Body.CopyToAsync(ms);
        var govde = ms.ToArray();
        var a = _wa.Oku();

        if (!_wa.ImzaDogru(a, govde, Request.Headers["X-Hub-Signature-256"].FirstOrDefault()))
        {
            _log.LogWarning("WhatsApp webhook: imza doğrulanamadı (uygulama gizli anahtarı girilmemiş veya istek Meta'dan değil).");
            _wa.Kaydet("hata", "-", "İmzasız / hatalı imzalı webhook isteği reddedildi", "imza");
            return Unauthorized();
        }
        if (!a.Aktif) return Ok();

        JsonNode? kok;
        try { kok = JsonNode.Parse(govde); }
        catch (System.Text.Json.JsonException) { return Ok(); }

        foreach (var entry in kok?["entry"]?.AsArray() ?? new JsonArray())
        foreach (var change in entry?["changes"]?.AsArray() ?? new JsonArray())
        foreach (var m in change?["value"]?["messages"]?.AsArray() ?? new JsonArray())
        {
            var id = m?["id"]?.GetValue<string>();
            var numara = WhatsAppServisi.Numara(m?["from"]?.GetValue<string>());
            if (id == null || numara == null || !_wa.YeniMesaj(id)) continue;
            var tur = m!["type"]?.GetValue<string>();
            var metin = tur switch
            {
                "text" => m["text"]?["body"]?.GetValue<string>(),
                "button" => m["button"]?["text"]?.GetValue<string>(),
                "interactive" => m["interactive"]?["button_reply"]?["title"]?.GetValue<string>()
                                 ?? m["interactive"]?["list_reply"]?["title"]?.GetValue<string>(),
                _ => null
            };
            var tamMetin = metin;

            // Meta'ya hemen 200 dönülür (yoksa mesajı tekrar gönderir); işlem arka planda, numara başına sırayla yapılır.
            _ = Task.Run(async () =>
            {
                var kilit = NumaraKilitleri.GetOrAdd(numara, _ => new SemaphoreSlim(1, 1));
                await kilit.WaitAsync();
                try
                {
                    if (string.IsNullOrWhiteSpace(tamMetin))
                    {
                        _wa.GelenKaydet(numara);
                        var ay = _wa.Oku();
                        if (_wa.Yonetici(ay, numara))
                            await _wa.GonderAsync(numara, "Şimdilik yalnız yazılı mesajları anlayabiliyorum.", false);
                        return;
                    }
                    using var sc = _scope.CreateScope();
                    var isleyici = sc.ServiceProvider.GetRequiredService<WhatsAppIsleyici>();
                    await isleyici.IsleAsync(numara, tamMetin.Length > 4000 ? tamMetin[..4000] : tamMetin, CancellationToken.None);
                }
                catch (Exception ex)
                {
                    _log.LogError(ex, "WhatsApp mesajı işlenemedi.");
                }
                finally
                {
                    kilit.Release();
                }
            });
        }
        return Ok();
    }

    // ---------------------------------------------------------------- ayarlar (yalnız ana bilgisayar)

    private string? WebhookAdresi()
    {
        var v = _config["PrimerLab:PortalInternetUrl"];
        if (string.IsNullOrWhiteSpace(v)) return null;
        v = v.Trim().TrimEnd('/');
        if (v.EndsWith("/hekim-portal", StringComparison.OrdinalIgnoreCase)) v = v[..^"/hekim-portal".Length];
        if (!v.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) v = "https://" + v;
        return v + "/api/whatsapp/webhook";
    }

    [HttpGet("ayarlar")]
    public IActionResult Ayarlar()
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        return Ok(_wa.Durum(WebhookAdresi()));
    }

    [HttpPost("ayarlar")]
    public IActionResult Kaydet([FromBody] WhatsAppAyarDto dto)
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        var yoneticiler = (dto.Yoneticiler ?? new()).Select(WhatsAppServisi.Numara).OfType<string>().Distinct().ToList();
        if ((dto.Yoneticiler ?? new()).Any(x => !string.IsNullOrWhiteSpace(x) && WhatsAppServisi.Numara(x) == null))
            return BadRequest("Yönetici numaralarından biri geçersiz. Ülke koduyla yazın (ör. 905321234567).");
        if (dto.Aktif && yoneticiler.Count == 0) return BadRequest("En az bir yönetici WhatsApp numarası girin (sizin numaranız).");
        var surum = (dto.ApiSurumu ?? "v23.0").Trim();
        if (!System.Text.RegularExpressions.Regex.IsMatch(surum, @"^v\d{2}\.\d$")) return BadRequest("API sürümü v23.0 biçiminde olmalı.");
        var pnid = (dto.TelefonNumarasiId ?? "").Trim();
        if (pnid.Length > 0 && !pnid.All(char.IsDigit)) return BadRequest("Telefon numarası kimliği (Phone number ID) yalnız rakamdan oluşur.");

        _wa.Guncelle(a =>
        {
            a.Aktif = dto.Aktif;
            a.TelefonNumarasiId = pnid.Length > 0 ? pnid : null;
            if (!string.IsNullOrWhiteSpace(dto.ErisimJetonu)) a.SifreliJeton = _wa.Sifrele(dto.ErisimJetonu.Trim());
            if (!string.IsNullOrWhiteSpace(dto.UygulamaSirri)) a.SifreliUygulamaSirri = _wa.Sifrele(dto.UygulamaSirri.Trim());
            a.ApiSurumu = surum;
            a.Yoneticiler = yoneticiler;
            a.HekimSorgu = dto.HekimSorgu;
            a.HekimBildirim = dto.HekimBildirim;
            a.HekimBildirimOlaylari = (dto.HekimBildirimOlaylari ?? new()).Where(x => x is "Onaylandı" or "Tasarımda" or "Üretimde" or "Tamamlandı").Distinct().ToList();
            a.TeknisyenBildirim = dto.TeknisyenBildirim;
            a.SabahOzeti = dto.SabahOzeti;
            a.OzetSaati = Math.Clamp(dto.OzetSaati, 5, 22);
            a.HastaAdiKisalt = dto.HastaAdiKisalt;
            a.SablonAdi = string.IsNullOrWhiteSpace(dto.SablonAdi) ? "primer_bildirim" : dto.SablonAdi.Trim();
            a.SablonDili = string.IsNullOrWhiteSpace(dto.SablonDili) ? "tr" : dto.SablonDili.Trim();
        });
        return Ok(_wa.Durum(WebhookAdresi()));
    }

    [HttpPost("deneme")]
    public async Task<IActionResult> Deneme(CancellationToken ct)
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        var a = _wa.Oku();
        if (!_wa.Hazir(a)) return BadRequest("Önce WhatsApp'ı açıp Telefon numarası kimliği ve erişim jetonunu kaydedin.");
        var hedef = a.Yoneticiler.Select(WhatsAppServisi.Numara).OfType<string>().FirstOrDefault();
        if (hedef == null) return BadRequest("Yönetici numarası yok.");
        var s = await _wa.GonderAsync(hedef, "Primer Lab WhatsApp bağlantısı çalışıyor. Bana bu numaradan yazarak Primer AI'ya soru sorabilirsiniz.", true, ct);
        return s.Basarili
            ? Ok(new { message = "Deneme mesajı gönderildi: " + WhatsAppServisi.Maskele(hedef) + (s.SablonKullanildi ? " (şablonla — son 24 saatte bu numaradan mesaj gelmediği için)" : "") })
            : BadRequest("Gönderilemedi: " + s.Hata);
    }

    [HttpPost("ozet-gonder")]
    public async Task<IActionResult> OzetGonder([FromServices] Data.PrimerLabDbContext db, CancellationToken ct)
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        var a = _wa.Oku();
        if (!_wa.Hazir(a)) return BadRequest("WhatsApp ayarları eksik.");
        var metin = await WhatsAppBildirimServisi.OzetMetni(db, ct);
        var hatalar = new List<string>();
        foreach (var y in a.Yoneticiler.Select(WhatsAppServisi.Numara).OfType<string>().Distinct())
        {
            var s = await _wa.GonderAsync(y, metin, true, ct);
            if (!s.Basarili) hatalar.Add(s.Hata ?? "hata");
        }
        return hatalar.Count == 0 ? Ok(new { message = "Özet gönderildi.", metin }) : BadRequest(string.Join(" | ", hatalar));
    }
}

public sealed class WhatsAppAyarDto
{
    public bool Aktif { get; set; }
    public string? TelefonNumarasiId { get; set; }
    public string? ErisimJetonu { get; set; }
    public string? UygulamaSirri { get; set; }
    public string? ApiSurumu { get; set; }
    public List<string>? Yoneticiler { get; set; }
    public bool HekimSorgu { get; set; }
    public bool HekimBildirim { get; set; }
    public List<string>? HekimBildirimOlaylari { get; set; }
    public bool TeknisyenBildirim { get; set; }
    public bool SabahOzeti { get; set; }
    public int OzetSaati { get; set; } = 8;
    public bool HastaAdiKisalt { get; set; } = true;
    public string? SablonAdi { get; set; }
    public string? SablonDili { get; set; }
}
