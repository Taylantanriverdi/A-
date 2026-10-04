using System.Security.Cryptography;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;
using PrimerLabV2.Infrastructure;

namespace PrimerLabV2.Controllers;

/// <summary>
/// Ana programdaki "Portal Hesapları" ekranı: Hekim Portalı ve Teknisyen Paneli hesaplarının
/// tamamı (kendi kaydını yapanlar dahil), aktif/pasif, onay, şifre belirleme, e-posta,
/// kayıt ve e-posta (SMTP) ayarları. Yalnız ana bilgisayardan erişilir.
/// Şifreler geri döndürülemez özet olarak saklandığı için mevcut şifre okunamaz; yönetici yeni
/// şifre belirler ve belirlediği şifre bir kez ekranda gösterilir.
/// </summary>
[ApiController]
[Route("api/portal-hesaplari")]
public sealed class PortalHesaplariController : ControllerBase
{
    private const int PasswordIterations = 210_000;

    private readonly PrimerLabDbContext _db;
    private readonly PortalKimlik _kimlik;
    private readonly TeknisyenHesapDeposu _teknisyenler;
    private readonly EpostaServisi _eposta;

    public PortalHesaplariController(PrimerLabDbContext db, PortalKimlik kimlik, TeknisyenHesapDeposu teknisyenler, EpostaServisi eposta)
    {
        _db = db;
        _kimlik = kimlik;
        _teknisyenler = teknisyenler;
        _eposta = eposta;
    }

    [HttpGet]
    public async Task<IActionResult> Liste(CancellationToken ct)
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        var bilgiler = _kimlik.TumBilgiler();

        var hekimler = await _db.Database.SqlQuery<HekimHesapSatiri>($"""
            SELECT p."HekimId",p."KullaniciAdi",p."Aktif",p."SonGirisTarihi",p."OlusturmaTarihi",
                   h."AdSoyad",h."KlinikAdi",h."Telefon",h."Email",h."Aktif" AS "HekimAktif"
            FROM "HekimPortalHesaplari" p
            INNER JOIN "Hekimler" h ON h."Id"=p."HekimId"
            """).ToListAsync(ct);

        var tekAdlari = await _db.Database.SqlQuery<TeknisyenAdSatiri>($"""
            SELECT "Id","AdSoyad",COALESCE("Aktif",true) AS "Aktif" FROM "Teknisyenler"
            """).ToDictionaryAsync(x => x.Id, ct);

        var liste = new List<object>();
        foreach (var h in hekimler)
        {
            bilgiler.TryGetValue("hekim:" + h.HekimId, out var b);
            liste.Add(new
            {
                tur = "hekim",
                id = h.HekimId,
                adSoyad = h.AdSoyad,
                klinik = h.KlinikAdi,
                telefon = b?.Telefon ?? h.Telefon,
                kullaniciAdi = h.KullaniciAdi,
                eposta = b?.Email ?? h.Email,
                epostaDogrulandi = b?.EmailDogrulamaTarihi != null,
                kendiKaydi = b?.KendiKaydi ?? false,
                kayitTarihi = b?.KayitTarihi ?? h.OlusturmaTarihi,
                sonGiris = h.SonGirisTarihi,
                aktif = h.Aktif && h.HekimAktif,
                kartAktif = h.HekimAktif,
                onayBekliyor = b?.OnayBekliyor == true && !h.Aktif,
                tip = (string?)null
            });
        }

        foreach (var t in _teknisyenler.Tumu())
        {
            if (!tekAdlari.TryGetValue(t.TeknisyenId, out var ad)) continue;
            bilgiler.TryGetValue("teknisyen:" + t.TeknisyenId, out var b);
            liste.Add(new
            {
                tur = "teknisyen",
                id = t.TeknisyenId,
                adSoyad = ad.AdSoyad,
                klinik = (string?)null,
                telefon = b?.Telefon,
                kullaniciAdi = t.KullaniciAdi,
                eposta = b?.Email,
                epostaDogrulandi = b?.EmailDogrulamaTarihi != null,
                kendiKaydi = b?.KendiKaydi ?? false,
                kayitTarihi = b?.KayitTarihi ?? (DateTime?)t.GuncellemeTarihi,
                sonGiris = t.SonGirisTarihi,
                aktif = t.Aktif && ad.Aktif,
                kartAktif = ad.Aktif,
                onayBekliyor = b?.OnayBekliyor == true && !t.Aktif,
                tip = t.Tip
            });
        }

        return Ok(new
        {
            hesaplar = liste,
            ayarlar = _kimlik.AyarlariOku(),
            eposta = _eposta.Durum(),
            istatistik = _kimlik.Istatistik()
        });
    }

    [HttpPost("{tur}/{id:int}/durum")]
    public async Task<IActionResult> Durum(string tur, int id, [FromBody] HesapDurumDto dto, CancellationToken ct)
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        bool bulundu;
        if (tur == "hekim")
        {
            bulundu = await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE "HekimPortalHesaplari" SET "Aktif"={dto.Aktif},"GuncellemeTarihi"={DateTime.UtcNow} WHERE "HekimId"={id}
                """, ct) > 0;
            // Kendi kaydıyla açılan hekim kartı pasifse, hesabı aktif yaparken kart da aktifleşir.
            if (bulundu && dto.Aktif)
                await _db.Database.ExecuteSqlInterpolatedAsync($"""UPDATE "Hekimler" SET "Aktif"=true WHERE "Id"={id}""", ct);
        }
        else if (tur == "teknisyen")
        {
            bulundu = _teknisyenler.AktifAyarla(id, dto.Aktif);
            if (bulundu && dto.Aktif)
                await _db.Database.ExecuteSqlInterpolatedAsync($"""UPDATE "Teknisyenler" SET "Aktif"=true WHERE "Id"={id}""", ct);
        }
        else return BadRequest("Geçersiz hesap türü.");

        if (!bulundu) return NotFound("Hesap bulunamadı.");
        if (dto.Aktif) _kimlik.BilgiGuncelle(tur + ":" + id, b => b.OnayBekliyor = false);
        return Ok(new { message = dto.Aktif ? "Hesap aktif." : "Hesap pasif." });
    }

    /// <summary>Yeni şifre belirler. Boş gönderilirse rastgele şifre üretilir. Şifre yanıtla bir kez döner.</summary>
    [HttpPost("{tur}/{id:int}/sifre")]
    public async Task<IActionResult> Sifre(string tur, int id, [FromBody] HesapSifreDto dto, CancellationToken ct)
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        var parola = string.IsNullOrWhiteSpace(dto.YeniParola) ? PortalKimlik.RastgeleParola() : dto.YeniParola.Trim();
        var hata = PortalKimlik.ParolaKontrol(parola);
        if (hata != null) return BadRequest(hata);

        bool bulundu;
        if (tur == "hekim")
        {
            var salt = Convert.ToBase64String(RandomNumberGenerator.GetBytes(24));
            var hash = Convert.ToBase64String(Rfc2898DeriveBytes.Pbkdf2(parola, Convert.FromBase64String(salt), PasswordIterations, HashAlgorithmName.SHA256, 32));
            bulundu = await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE "HekimPortalHesaplari" SET "ParolaHash"={hash},"ParolaSalt"={salt},"GuncellemeTarihi"={DateTime.UtcNow} WHERE "HekimId"={id}
                """, ct) > 0;
        }
        else if (tur == "teknisyen")
        {
            var o = TeknisyenHesapDeposu.OzetUret(parola);
            bulundu = _teknisyenler.ParolaAyarla(id, o.Hash, o.Salt);
        }
        else return BadRequest("Geçersiz hesap türü.");

        if (!bulundu) return NotFound("Hesap bulunamadı.");
        return Ok(new { parola, message = "Yeni şifre belirlendi. Kişiye iletin; eski şifre ve hatırlanan cihazlar geçersiz oldu." });
    }

    [HttpPost("{tur}/{id:int}/eposta")]
    public async Task<IActionResult> Eposta(string tur, int id, [FromBody] HesapEpostaDto dto, CancellationToken ct)
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        if (tur is not ("hekim" or "teknisyen")) return BadRequest("Geçersiz hesap türü.");
        var anahtar = tur + ":" + id;
        if (string.IsNullOrWhiteSpace(dto.Eposta))
        {
            _kimlik.BilgiGuncelle(anahtar, b => { b.Email = null; b.EmailDogrulamaTarihi = null; });
            return Ok(new { message = "E-posta silindi; kişi bir sonraki girişte adresini yazıp doğrulayacak." });
        }
        var e = PortalKimlik.EpostaNormalize(dto.Eposta);
        if (e == null) return BadRequest("Geçerli bir e-posta adresi girin.");
        if (_kimlik.EpostaSahibi(e, anahtar) is { } sahip && sahip.StartsWith(tur + ":", StringComparison.Ordinal))
            return Conflict("Bu e-posta başka bir hesapta kullanılıyor.");
        // Yönetici yazdığı adresi doğrulanmış kabul eder; giriş kodları bu adrese gider.
        _kimlik.BilgiGuncelle(anahtar, b => { b.Email = e; b.EmailDogrulamaTarihi = DateTime.UtcNow; });
        if (tur == "hekim")
            await _db.Database.ExecuteSqlInterpolatedAsync($"""UPDATE "Hekimler" SET "Email"={e} WHERE "Id"={id}""", ct);
        return Ok(new { message = "E-posta kaydedildi." });
    }

    /// <summary>
    /// Kendi kaydını yapan hekimi laboratuvardaki mevcut hekim kartına bağlar (aynı kişi iki kez
    /// görünmesin; mevcut fiyat listesi ve işleri portalda görünsün). Kayıtla açılan boş kart pasife alınır.
    /// </summary>
    [HttpPost("hekim/{id:int}/eslestir")]
    public async Task<IActionResult> Eslestir(int id, [FromBody] HekimEslestirDto dto, CancellationToken ct)
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        if (dto.HedefHekimId <= 0 || dto.HedefHekimId == id) return BadRequest("Bağlanacak hekimi seçin.");

        var hedefHesap = await _db.Database.SqlQuery<int>($"""
            SELECT COUNT(*)::int AS "Value" FROM "HekimPortalHesaplari" WHERE "HekimId"={dto.HedefHekimId}
            """).SingleAsync(ct);
        if (hedefHesap > 0) return Conflict("Seçilen hekimin zaten bir portal hesabı var.");
        var hedefVar = await _db.Hekimler.AnyAsync(x => x.Id == dto.HedefHekimId, ct);
        if (!hedefVar) return NotFound("Hekim bulunamadı.");

        var strategy = _db.Database.CreateExecutionStrategy();
        var tasindi = false;
        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await _db.Database.BeginTransactionAsync(ct);
            tasindi = await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE "HekimPortalHesaplari" SET "HekimId"={dto.HedefHekimId},"GuncellemeTarihi"={DateTime.UtcNow} WHERE "HekimId"={id}
                """, ct) > 0;
            if (tasindi)
            {
                // Eski kart: işi/hastası yoksa pasife alınır; işleri varsa yeni karta taşınır.
                await _db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE "Hastalar" SET "HekimId"={dto.HedefHekimId} WHERE "HekimId"={id}
                    """, ct);
                await _db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE "Hekimler" SET "Aktif"=false WHERE "Id"={id}
                    """, ct);
                await _db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE "Hekimler" h SET "Email"=COALESCE(NULLIF(h."Email",''),o."Email"),
                                            "Telefon"=COALESCE(NULLIF(h."Telefon",''),o."Telefon")
                    FROM "Hekimler" o WHERE h."Id"={dto.HedefHekimId} AND o."Id"={id}
                    """, ct);
            }
            await tx.CommitAsync(ct);
        });
        if (!tasindi) return NotFound("Portal hesabı bulunamadı.");

        var eski = _kimlik.BilgiGetir("hekim:" + id);
        if (eski != null)
        {
            _kimlik.BilgiGuncelle("hekim:" + dto.HedefHekimId, b =>
            {
                b.Email = eski.Email; b.EmailDogrulamaTarihi = eski.EmailDogrulamaTarihi; b.KendiKaydi = eski.KendiKaydi;
                b.KayitTarihi = eski.KayitTarihi; b.OnayBekliyor = eski.OnayBekliyor; b.KayitIp = eski.KayitIp; b.Telefon = eski.Telefon;
            });
            _kimlik.BilgiGuncelle("hekim:" + id, b => { b.Email = null; b.EmailDogrulamaTarihi = null; });
        }
        return Ok(new { message = "Portal hesabı seçilen hekim kartına bağlandı." });
    }

    [HttpPost("ayarlar")]
    public IActionResult AyarKaydet([FromBody] PortalKimlik.Ayarlar dto)
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        var a = _kimlik.AyarlariOku();
        a.KayitAcik = dto.KayitAcik;
        a.OnayGereksin = dto.OnayGereksin;
        a.GiristeEpostaKodu = dto.GiristeEpostaKodu;
        a.CihazHatirlaGun = Math.Clamp(dto.CihazHatirlaGun, 0, 365);
        a.YeniTeknisyenTipi = dto.YeniTeknisyenTipi == TeknisyenHesapDeposu.Ic ? TeknisyenHesapDeposu.Ic : TeknisyenHesapDeposu.Dis;
        a.SaatlikKayitSiniri = Math.Clamp(dto.SaatlikKayitSiniri, 20, 5000);
        _kimlik.AyarlariYaz(a);
        return Ok(a);
    }

    [HttpPost("eposta-ayarlari")]
    public IActionResult EpostaAyarKaydet([FromBody] EpostaAyarDto dto)
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        if (string.IsNullOrWhiteSpace(dto.Sunucu) || string.IsNullOrWhiteSpace(dto.Kullanici))
            return BadRequest("SMTP sunucusu ve kullanıcı (e-posta adresi) gereklidir.");
        var gonderen = string.IsNullOrWhiteSpace(dto.GonderenAdres) ? dto.Kullanici : dto.GonderenAdres;
        if (PortalKimlik.EpostaNormalize(gonderen) == null) return BadRequest("Gönderen e-posta adresi geçersiz.");
        _eposta.Kaydet(new EpostaServisi.Ayarlar
        {
            Sunucu = dto.Sunucu, Port = dto.Port, Ssl = dto.Ssl, Kullanici = dto.Kullanici,
            GonderenAdres = gonderen, GonderenAd = dto.GonderenAd ?? "Primer Dental Lab",
            DakikadaEnFazla = dto.DakikadaEnFazla, GundeEnFazla = dto.GundeEnFazla
        }, dto.Parola);
        return Ok(_eposta.Durum());
    }

    [HttpPost("eposta-test")]
    public async Task<IActionResult> EpostaTest([FromBody] HesapEpostaDto dto, CancellationToken ct)
    {
        if (!GuvenlikController.AnaBilgisayar(HttpContext)) return GuvenlikController.Yasak();
        var e = PortalKimlik.EpostaNormalize(dto.Eposta);
        if (e == null) return BadRequest("Deneme için geçerli bir e-posta adresi girin.");
        var hata = await _eposta.DenemeGonderAsync(e, ct);
        return hata == null ? Ok(new { message = "Deneme e-postası gönderildi: " + e }) : BadRequest("Gönderilemedi: " + hata);
    }
}

public sealed class HekimHesapSatiri
{
    public int HekimId { get; set; }
    public string KullaniciAdi { get; set; } = string.Empty;
    public bool Aktif { get; set; }
    public DateTime? SonGirisTarihi { get; set; }
    public DateTime OlusturmaTarihi { get; set; }
    public string AdSoyad { get; set; } = string.Empty;
    public string? KlinikAdi { get; set; }
    public string? Telefon { get; set; }
    public string? Email { get; set; }
    public bool HekimAktif { get; set; }
}

public sealed class TeknisyenAdSatiri
{
    public int Id { get; set; }
    public string AdSoyad { get; set; } = string.Empty;
    public bool Aktif { get; set; }
}

public sealed class HesapDurumDto { public bool Aktif { get; set; } }
public sealed class HesapSifreDto { public string? YeniParola { get; set; } }
public sealed class HesapEpostaDto { public string? Eposta { get; set; } }
public sealed class HekimEslestirDto { public int HedefHekimId { get; set; } }

public sealed class EpostaAyarDto
{
    public string? Sunucu { get; set; }
    public int Port { get; set; } = 587;
    public bool Ssl { get; set; } = true;
    public string? Kullanici { get; set; }
    public string? Parola { get; set; }
    public string? GonderenAdres { get; set; }
    public string? GonderenAd { get; set; }
    public int DakikadaEnFazla { get; set; } = 20;
    public int GundeEnFazla { get; set; } = 450;
}
