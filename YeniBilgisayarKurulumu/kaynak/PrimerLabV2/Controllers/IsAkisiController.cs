using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;
using PrimerLabV2.Infrastructure;

namespace PrimerLabV2.Controllers;

/// <summary>
/// İş Akışı Paneli: hekimden, mailden ve elle girilen tüm işlerin akışı (onay, durum, teknisyen ataması,
/// dosyalar, mesajlar, fiyatsız sipariş formu). Aynı veritabanını kullandığı için ana programla anlık senkrondur.
/// FİYAT: bu denetleyici fiyat/tutar/para birimi alanlarını hiç sorgulamaz ve döndürmez.
/// Değişiklikler (onay, durum, atama, mesaj) ana programın kendi uçlarına içeriden yaptırılır;
/// böylece kurallar ve kayıtlar (durum geçmişi, bildirimler) birebir aynı kalır.
/// </summary>
[ApiController]
[Route("api/is-akisi")]
public sealed class IsAkisiController : ControllerBase
{
    private static readonly string[] Durumlar = { "Bekliyor", "Devam Ediyor", "Tasarımda", "Üretimde", "Makyajda", "Tamamlama Onayı", "Tamamlandı" };

    private readonly PrimerLabDbContext _db;
    private readonly IsAkisiHesaplari _hesaplar;
    private readonly YoneticiGirisi _yonetici;
    private readonly IcerikTakip _takip;
    private readonly IHttpClientFactory _http;

    public IsAkisiController(PrimerLabDbContext db, IsAkisiHesaplari hesaplar, YoneticiGirisi yonetici, IcerikTakip takip, IHttpClientFactory http)
    {
        _db = db;
        _hesaplar = hesaplar;
        _yonetici = yonetici;
        _takip = takip;
        _http = http;
    }

    // ------------------------------------------------------------------ oturum

    /// <summary>Panel kullanıcısı ya da ana programda oturumu açık yönetici.</summary>
    private string? Kullanici()
    {
        var h = _hesaplar.OturumHesabi(HttpContext);
        if (h != null) return h.AdSoyad;
        return _yonetici.OturumGecerli(HttpContext) ? "Yönetici" : null;
    }

    [HttpPost("giris")]
    public async Task<IActionResult> Giris([FromBody] IsAkisiGirisDto dto, CancellationToken ct)
    {
        var ku = (dto.KullaniciAdi ?? "").Trim();
        if (ku.Length == 0 || string.IsNullOrEmpty(dto.Parola)) return BadRequest("Kullanıcı adı ve şifre gerekli.");
        if (_hesaplar.Kilitli(ku) is { } dk)
            return StatusCode(StatusCodes.Status429TooManyRequests, $"Çok fazla hatalı deneme. {dk} dakika sonra tekrar deneyin.");
        var h = _hesaplar.Dogrula(ku, dto.Parola);
        if (h == null)
        {
            await Task.Delay(Random.Shared.Next(200, 500), ct);
            return Unauthorized("Kullanıcı adı veya şifre hatalı (ya da hesap pasif).");
        }
        _hesaplar.OturumAc(HttpContext, h, dto.Hatirla);
        return Ok(new { adSoyad = h.AdSoyad });
    }

    [HttpPost("cikis")]
    public IActionResult Cikis()
    {
        IsAkisiHesaplari.OturumKapat(HttpContext);
        return Ok();
    }

    [HttpGet("ben")]
    public IActionResult Ben()
    {
        var k = Kullanici();
        return k == null ? Unauthorized("Giriş gerekli.") : Ok(new { adSoyad = k, durumlar = Durumlar });
    }

    // ------------------------------------------------------------------ okuma (fiyatsız)

    [HttpGet("isler")]
    public async Task<IActionResult> Isler([FromQuery] int tamamlananGun = 60, CancellationToken ct = default)
    {
        if (Kullanici() == null) return Unauthorized("Giriş gerekli.");
        tamamlananGun = Math.Clamp(tamamlananGun, 1, 3650);
        var sinir = DateTime.UtcNow.AddDays(-tamamlananGun);
        var rows = await _db.Database.SqlQuery<IsAkisiSatiri>($"""
            SELECT s."Id",
                   COALESCE(ha."AdSoyad",'-') AS "HastaAdi",
                   h."Id" AS "HekimId", COALESCE(h."AdSoyad",'-') AS "HekimAdi", h."KlinikAdi",
                   COALESCE(s."Kaynak",'') AS "Kaynak",
                   COALESCE(s."OnayDurumu",'Onaylandı') AS "OnayDurumu",
                   COALESCE(s."Durum",'Bekliyor') AS "Durum",
                   s."TerminTarihi", s."OlusturmaTarihi", s."DisRengi", s."DisSemasi", s."Materyal", s."Notlar",
                   s."TeknisyenId", t."AdSoyad" AS "TeknisyenAdi",
                   COALESCE(s."Oncelik",'Normal') AS "Oncelik",
                   s."TamamlamaTalepTarihi"
            FROM "Siparisler" s
            LEFT JOIN "Hastalar" ha ON ha."Id"=s."HastaId"
            LEFT JOIN "Hekimler" h ON h."Id"=ha."HekimId"
            LEFT JOIN "Teknisyenler" t ON t."Id"=s."TeknisyenId"
            WHERE COALESCE(s."Silindi",false)=false
              AND (COALESCE(s."Durum",'')<>'Tamamlandı' OR COALESCE(s."TeslimTarihi",s."OlusturmaTarihi") >= {sinir} OR s."OlusturmaTarihi" >= {sinir})
            ORDER BY s."Id" DESC
            LIMIT 1500
            """).ToListAsync(ct);
        var ids = rows.Select(x => x.Id).ToArray();
        var kalemler = ids.Length == 0 ? new List<IsAkisiKalemSatiri>() : await _db.Database.SqlQuery<IsAkisiKalemSatiri>($"""
            SELECT "SiparisId","IsTuru","Adet" FROM "SiparisKalemleri" WHERE "SiparisId" = ANY({ids}) ORDER BY "Id"
            """).ToListAsync(ct);
        var dosyalar = ids.Length == 0 ? new List<IsAkisiDosyaSayiSatiri>() : await _db.Database.SqlQuery<IsAkisiDosyaSayiSatiri>($"""
            SELECT "Id","SiparisId",COALESCE("DosyaTuru",'Diger') AS "DosyaTuru" FROM "IsDosyalari" WHERE "SiparisId" = ANY({ids})
            """).ToListAsync(ct);
        var mesajlar = ids.Length == 0 ? new List<MesajNoSatiri>() : await _db.Database.SqlQuery<MesajNoSatiri>($"""
            SELECT "SiparisId","Id","GonderenTipi" FROM "IsMesajlari" WHERE "SiparisId" = ANY({ids})
            """).ToListAsync(ct);

        var yukleyen = _takip.DosyaBilgileri(dosyalar.Select(d => d.Id));
        var mailIsler = dosyalar.Where(d => yukleyen.TryGetValue(d.Id, out var b) && b.YukleyenTipi == "Mail").Select(d => d.SiparisId).ToHashSet();
        var okSinir = _takip.OkunmaSiniri(IcerikTakip.Laboratuvar);
        var linkSayilari = HttpContext.RequestServices.GetRequiredService<IsLinkleri>().Sayilar();
        var kalemHarita = kalemler.GroupBy(k => k.SiparisId).ToDictionary(g => g.Key, g => g.ToList());
        var dosyaHarita = dosyalar.GroupBy(d => d.SiparisId).ToDictionary(g => g.Key, g => g.ToList());
        var mesajHarita = mesajlar.GroupBy(m => m.SiparisId).ToDictionary(g => g.Key, g => g.ToList());

        return Ok(rows.Select(x =>
        {
            dosyaHarita.TryGetValue(x.Id, out var df); df ??= new();
            mesajHarita.TryGetValue(x.Id, out var mj); mj ??= new();
            return new
            {
                x.Id, x.HastaAdi, x.HekimId, x.HekimAdi, x.KlinikAdi,
                Kaynak = KaynakGrubu(x.Kaynak, mailIsler.Contains(x.Id)), KaynakDetay = x.Kaynak,
                x.OnayDurumu, x.Durum, x.TerminTarihi, x.OlusturmaTarihi, x.DisRengi, x.DisSemasi, x.Materyal,
                x.Notlar, x.TeknisyenId, x.TeknisyenAdi, x.Oncelik, x.TamamlamaTalepTarihi,
                Kalemler = kalemHarita.TryGetValue(x.Id, out var kl) ? kl.Select(k => new { k.IsTuru, k.Adet }).ToArray() : Array.Empty<object>(),
                Tarama = df.Count(d => d.DosyaTuru == "Tarama"),
                Tasarim = df.Count(d => d.DosyaTuru == "Tasarım"),
                Yazici = df.Count(d => d.DosyaTuru == "Yazıcı"),
                Diger = df.Count(d => d.DosyaTuru is not ("Tarama" or "Tasarım" or "Yazıcı")),
                LinkSayisi = linkSayilari.TryGetValue(x.Id, out var ls) ? ls : 0,
                MesajSayisi = mj.Count,
                OkunmamisMesaj = mj.Count(m => m.GonderenTipi is "Hekim" or "Teknisyen" && m.Id > okSinir(x.Id))
            };
        }));
    }

    private static string KaynakGrubu(string kaynak, bool maildenDosya)
    {
        if (kaynak.Contains("Hekim Portalı", StringComparison.OrdinalIgnoreCase)) return "Hekim";
        if (kaynak.Equals("Mail", StringComparison.OrdinalIgnoreCase) || maildenDosya) return "Mail";
        if (kaynak.Contains("Teknisyen", StringComparison.OrdinalIgnoreCase)) return "Teknisyen";
        return "Manuel";
    }

    [HttpGet("teknisyenler")]
    public async Task<IActionResult> Teknisyenler(CancellationToken ct)
    {
        if (Kullanici() == null) return Unauthorized("Giriş gerekli.");
        var l = await _db.Database.SqlQuery<IsAkisiTeknisyenSatiri>($"""
            SELECT "Id","AdSoyad",COALESCE("Aktif",true) AS "Aktif" FROM "Teknisyenler" ORDER BY "AdSoyad"
            """).ToListAsync(ct);
        return Ok(l);
    }

    [HttpGet("isler/{id:int}/dosyalar")]
    public async Task<IActionResult> Dosyalar(int id, CancellationToken ct)
    {
        if (Kullanici() == null) return Unauthorized("Giriş gerekli.");
        var l = await _db.Database.SqlQuery<IsAkisiDosyaSatiri>($"""
            SELECT "Id",COALESCE("DosyaTuru",'Diger') AS "DosyaTuru","OrijinalDosyaAdi",COALESCE("Boyut",0)::bigint AS "Boyut","YuklemeTarihi"
            FROM "IsDosyalari" WHERE "SiparisId"={id} ORDER BY "YuklemeTarihi" DESC,"Id" DESC
            """).ToListAsync(ct);
        var linkler = HttpContext.RequestServices.GetRequiredService<IsLinkleri>().Liste(id).Select(IsLinkleri.Gorunum);
        return Ok(new { dosyalar = l, linkler });
    }

    [HttpGet("isler/{id:int}/mesajlar")]
    public async Task<IActionResult> Mesajlar(int id, CancellationToken ct)
    {
        if (Kullanici() == null) return Unauthorized("Giriş gerekli.");
        var l = await _db.Database.SqlQuery<IsAkisiMesajSatiri>($"""
            SELECT "Id","GonderenTipi","GonderenAdi","Mesaj","Tarih" FROM "IsMesajlari" WHERE "SiparisId"={id} ORDER BY "Tarih","Id"
            """).ToListAsync(ct);
        return Ok(l.Select(m => new
        {
            m.Id, m.GonderenAdi, m.Mesaj, m.Tarih,
            Kim = m.GonderenTipi switch { "Hekim" => "Hekim", "Teknisyen" => "Teknisyen", "Lab-Teknisyen" => "Laboratuvar → teknisyen", _ => "Laboratuvar → hekim" },
            Kanal = m.GonderenTipi is "Teknisyen" or "Lab-Teknisyen" ? "teknisyen" : "hekim"
        }));
    }

    // ------------------------------------------------------------------ işlemler (ana programın uçlarıyla)

    [HttpPost("isler/{id:int}/onayla")]
    public Task<IActionResult> Onayla(int id, CancellationToken ct) => Vekil(HttpMethod.Patch, $"/api/anayasa/isler/{id}/gelen-onayla", null, ct);

    [HttpPost("isler/{id:int}/reddet")]
    public Task<IActionResult> Reddet(int id, CancellationToken ct) => Vekil(HttpMethod.Patch, $"/api/anayasa/isler/{id}/gelen-reddet", null, ct);

    [HttpPost("isler/{id:int}/durum")]
    public Task<IActionResult> Durum(int id, [FromBody] IsAkisiDurumDto dto, CancellationToken ct) =>
        Vekil(HttpMethod.Patch, $"/api/anayasa/isler/{id}/durum", new { durum = dto.Durum }, ct);

    [HttpPost("isler/{id:int}/tamamlama-onayla")]
    public Task<IActionResult> TamamlamaOnayla(int id, CancellationToken ct) => Vekil(HttpMethod.Patch, $"/api/anayasa/isler/{id}/tamamlama-onayla", null, ct);

    [HttpPost("isler/{id:int}/teknisyen")]
    public Task<IActionResult> TeknisyenAta(int id, [FromBody] IsAkisiAtamaDto dto, CancellationToken ct) =>
        Vekil(HttpMethod.Patch, $"/api/teknisyen-atamalari/{id}", new { teknisyenId = dto.TeknisyenId }, ct);

    [HttpPost("isler/{id:int}/mesajlar")]
    public Task<IActionResult> MesajGonder(int id, [FromBody] IsAkisiMesajDto dto, CancellationToken ct) =>
        Vekil(HttpMethod.Post, $"/api/anayasa/mesajlar/{id}",
            new { mesaj = dto.Mesaj, kanal = dto.Kanal == "teknisyen" ? "teknisyen" : "hekim", gonderenAdi = "Laboratuvar" }, ct);

    [HttpGet("dosya/{dosyaId:int}")]
    public async Task<IActionResult> DosyaIndir(int dosyaId, CancellationToken ct)
    {
        if (Kullanici() == null) return Unauthorized("Giriş gerekli.");
        var http = IcIstemci();
        var r = await http.GetAsync($"/api/is-dosyalari/{dosyaId}/indir", HttpCompletionOption.ResponseHeadersRead, ct);
        if (!r.IsSuccessStatusCode) return StatusCode((int)r.StatusCode, await r.Content.ReadAsStringAsync(ct));
        var ad = r.Content.Headers.ContentDisposition?.FileNameStar ?? r.Content.Headers.ContentDisposition?.FileName?.Trim('"') ?? "dosya";
        HttpContext.Response.RegisterForDispose(r);
        return File(await r.Content.ReadAsStreamAsync(ct), r.Content.Headers.ContentType?.MediaType ?? "application/octet-stream", ad);
    }

    private HttpClient IcIstemci()
    {
        var http = _http.CreateClient();
        http.BaseAddress = new Uri(Environment.GetEnvironmentVariable("PRIMERLAB_YEREL_ADRES") ?? "http://127.0.0.1:5169");
        http.DefaultRequestHeaders.Add(YoneticiGirisi.IcBaslik, _yonetici.IcJeton);
        http.Timeout = TimeSpan.FromMinutes(10);
        return http;
    }

    private async Task<IActionResult> Vekil(HttpMethod yontem, string yol, object? govde, CancellationToken ct)
    {
        if (Kullanici() == null) return Unauthorized("Giriş gerekli.");
        using var istek = new HttpRequestMessage(yontem, yol);
        if (govde != null) istek.Content = JsonContent.Create(govde);
        using var r = await IcIstemci().SendAsync(istek, ct);
        if (r.IsSuccessStatusCode) return Ok(new { ok = true });
        var metin = await r.Content.ReadAsStringAsync(ct);
        return StatusCode((int)r.StatusCode, string.IsNullOrWhiteSpace(metin) || metin.TrimStart().StartsWith('{') ? "İşlem yapılamadı." : metin);
    }

    // ------------------------------------------------------------------ hesap yönetimi (yalnız yönetici)

    [HttpGet("admin/hesaplar")]
    public IActionResult Hesaplar() => Ok(_hesaplar.Liste().Select(h => new { h.Id, h.AdSoyad, h.KullaniciAdi, h.Aktif, h.OlusturmaTarihi, h.SonGiris }));

    [HttpPost("admin/hesaplar")]
    public IActionResult HesapEkle([FromBody] IsAkisiHesapDto dto)
    {
        var hata = _hesaplar.Ekle(dto.AdSoyad ?? "", dto.KullaniciAdi ?? "", dto.Parola ?? "");
        return hata == null ? Ok(new { message = "Hesap açıldı." }) : BadRequest(hata);
    }

    [HttpPatch("admin/hesaplar/{id:int}")]
    public IActionResult HesapGuncelle(int id, [FromBody] IsAkisiHesapDto dto)
    {
        var hata = _hesaplar.Guncelle(id, dto.AdSoyad, dto.Aktif, dto.Parola);
        return hata == null ? Ok(new { message = "Kaydedildi." }) : BadRequest(hata);
    }

    [HttpDelete("admin/hesaplar/{id:int}")]
    public IActionResult HesapSil(int id) => _hesaplar.Sil(id) ? Ok() : NotFound("Hesap bulunamadı.");
}

public sealed class IsAkisiGirisDto { public string? KullaniciAdi { get; set; } public string? Parola { get; set; } public bool Hatirla { get; set; } }
public sealed class IsAkisiDurumDto { public string? Durum { get; set; } }
public sealed class IsAkisiAtamaDto { public int? TeknisyenId { get; set; } }
public sealed class IsAkisiMesajDto { public string? Mesaj { get; set; } public string? Kanal { get; set; } }
public sealed class IsAkisiHesapDto { public string? AdSoyad { get; set; } public string? KullaniciAdi { get; set; } public string? Parola { get; set; } public bool? Aktif { get; set; } }

public sealed class IsAkisiSatiri
{
    public int Id { get; set; }
    public string HastaAdi { get; set; } = "";
    public int? HekimId { get; set; }
    public string HekimAdi { get; set; } = "";
    public string? KlinikAdi { get; set; }
    public string Kaynak { get; set; } = "";
    public string OnayDurumu { get; set; } = "";
    public string Durum { get; set; } = "";
    public DateTime? TerminTarihi { get; set; }
    public DateTime OlusturmaTarihi { get; set; }
    public string? DisRengi { get; set; }
    public string? DisSemasi { get; set; }
    public string? Materyal { get; set; }
    public string? Notlar { get; set; }
    public int? TeknisyenId { get; set; }
    public string? TeknisyenAdi { get; set; }
    public string Oncelik { get; set; } = "Normal";
    public DateTime? TamamlamaTalepTarihi { get; set; }
}

public sealed class IsAkisiKalemSatiri { public int SiparisId { get; set; } public string IsTuru { get; set; } = ""; public int Adet { get; set; } }
public sealed class IsAkisiDosyaSayiSatiri { public int Id { get; set; } public int SiparisId { get; set; } public string DosyaTuru { get; set; } = ""; }
public sealed class IsAkisiDosyaSatiri { public int Id { get; set; } public string DosyaTuru { get; set; } = ""; public string OrijinalDosyaAdi { get; set; } = ""; public long Boyut { get; set; } public DateTime YuklemeTarihi { get; set; } }
public sealed class IsAkisiTeknisyenSatiri { public int Id { get; set; } public string AdSoyad { get; set; } = ""; public bool Aktif { get; set; } }
public sealed class IsAkisiMesajSatiri { public int Id { get; set; } public string GonderenTipi { get; set; } = ""; public string? GonderenAdi { get; set; } public string Mesaj { get; set; } = ""; public DateTime Tarih { get; set; } }
