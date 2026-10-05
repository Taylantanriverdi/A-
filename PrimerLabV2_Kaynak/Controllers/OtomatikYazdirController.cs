using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;
using PrimerLabV2.Infrastructure;

namespace PrimerLabV2.Controllers;

/// <summary>Otomatik yazdırma: ayarlar ve yazıcı istasyonunun kuyruğu (yönetici oturumu gerekir).</summary>
[ApiController]
[Route("api/otomatik-yazdir")]
public sealed class OtomatikYazdirController : ControllerBase
{
    private readonly OtomatikYazdirma _oy;
    private readonly PrimerLabDbContext _db;

    public OtomatikYazdirController(OtomatikYazdirma oy, PrimerLabDbContext db)
    {
        _oy = oy;
        _db = db;
    }

    [HttpGet("ayarlar")]
    public async Task<IActionResult> Ayarlar(CancellationToken ct)
    {
        var a = _oy.Oku();
        var d = _oy.IstasyonDurumu();
        var sonlar = a.Basilanlar.OrderByDescending(x => x.Tarih).Take(8).ToList();
        var ids = sonlar.Select(x => x.Id).ToArray();
        var adlar = ids.Length == 0 ? new List<YazdirIsSatiri>() : await _db.Database.SqlQuery<YazdirIsSatiri>($"""
            SELECT s."Id", COALESCE(ha."AdSoyad",'-') AS "HastaAdi", COALESCE(h."AdSoyad",'-') AS "HekimAdi", COALESCE(s."Kaynak",'') AS "Kaynak"
            FROM "Siparisler" s LEFT JOIN "Hastalar" ha ON ha."Id"=s."HastaId" LEFT JOIN "Hekimler" h ON h."Id"=ha."HekimId"
            WHERE s."Id" = ANY({ids})
            """).ToListAsync(ct);
        return Ok(new
        {
            a.Aktif, a.Kopya, a.Kaynaklar, a.BaslangicTarihi,
            secilebilirKaynaklar = OtomatikYazdirma.SecilebilirKaynaklar,
            istasyonCevrimici = d.Cevrimici, istasyonSonSinyal = d.Son, sonHata = d.SonHata,
            sonBasilanlar = sonlar.Select(x =>
            {
                var i = adlar.FirstOrDefault(y => y.Id == x.Id);
                return new { x.Id, x.Tarih, x.Basarili, x.Hata, hastaAdi = i?.HastaAdi, hekimAdi = i?.HekimAdi };
            })
        });
    }

    [HttpPost("ayarlar")]
    public async Task<IActionResult> AyarKaydet([FromBody] OtomatikYazdirDto dto, CancellationToken ct)
    {
        _oy.Kaydet(dto.Aktif, dto.Kopya, dto.Kaynaklar);
        return await Ayarlar(ct);
    }

    /// <summary>İstasyonun kuyruğu: açıkken gelen, seçili kaynaklardan, henüz basılmamış işler (en eski önce).</summary>
    [HttpGet("bekleyen")]
    public async Task<IActionResult> Bekleyen(CancellationToken ct)
    {
        _oy.Sinyal();
        var a = _oy.Oku();
        var tekrar = _oy.TekrarIstenenler();
        if (!a.Aktif && tekrar.Count == 0) return Ok(new { aktif = false, kopya = a.Kopya, isler = Array.Empty<int>() });
        var bas = a.BaslangicTarihi ?? DateTime.UtcNow;
        var tekrarDizi = tekrar.ToArray();
        var adaylar = await _db.Database.SqlQuery<YazdirIsSatiri>($"""
            SELECT s."Id", '' AS "HastaAdi", '' AS "HekimAdi", COALESCE(s."Kaynak",'') AS "Kaynak"
            FROM "Siparisler" s
            WHERE COALESCE(s."Silindi",false)=false
              AND ((s."OlusturmaTarihi" >= {bas} AND {a.Aktif}) OR s."Id" = ANY({tekrarDizi}))
            ORDER BY s."Id"
            LIMIT 200
            """).ToListAsync(ct);
        var basilan = _oy.BasilanIdler();
        bool KaynakUygun(string k) => a.Kaynaklar.Any(x => k == x || (x == "Hekim Portalı" && k.Contains("Hekim Portalı")));
        var isler = adaylar.Where(x => tekrar.Contains(x.Id) || (!basilan.Contains(x.Id) && KaynakUygun(x.Kaynak)))
            .Select(x => x.Id).Take(5).ToArray();
        isler = _oy.Ayir(isler);
        return Ok(new { aktif = a.Aktif, kopya = a.Kopya, isler });
    }

    [HttpPost("basildi")]
    public IActionResult Basildi([FromBody] YazdirSonucDto dto)
    {
        if (dto.Id <= 0) return BadRequest();
        _oy.BasildiKaydet(dto.Id, dto.Basarili, dto.Hata is { Length: > 300 } h ? h[..300] : dto.Hata);
        return Ok();
    }

    [HttpPost("tekrar/{id:int}")]
    public IActionResult Tekrar(int id)
    {
        _oy.Tekrar(id);
        return Ok(new { message = $"#{id} yazıcı istasyonunda yeniden basılacak." });
    }
}

public sealed class OtomatikYazdirDto
{
    public bool Aktif { get; set; }
    public int Kopya { get; set; } = 1;
    public List<string>? Kaynaklar { get; set; }
}

public sealed class YazdirSonucDto
{
    public int Id { get; set; }
    public bool Basarili { get; set; } = true;
    public string? Hata { get; set; }
}

public sealed class YazdirIsSatiri
{
    public int Id { get; set; }
    public string HastaAdi { get; set; } = "";
    public string HekimAdi { get; set; } = "";
    public string Kaynak { get; set; } = "";
}
