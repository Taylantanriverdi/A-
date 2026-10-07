using System.Text.Json;
using System.Data;
using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;

namespace PrimerLabV2.Controllers;

[ApiController]
[Route("api/kasa-arsiv")]
public sealed class KasaArsivV2Controller : ControllerBase
{
    private readonly PrimerLabDbContext _db;
    private static readonly string[] Currencies = { "TRY", "EUR", "USD" };

    public KasaArsivV2Controller(PrimerLabDbContext db)
    {
        _db = db;
    }

    [HttpGet("ozet")]
    public async Task<IActionResult> Ozet([FromQuery] DateTime? baslangic, [FromQuery] DateTime? bitis)
    {
        // Pasif hekim, açık cari hareketi veya bakiyesi varsa listede kalır.
        var hekimler = await _db.Hekimler.AsNoTracking()
            .OrderBy(x => x.AdSoyad)
            .Select(x => new
            {
                x.Id,
                x.AdSoyad,
                x.KlinikAdi,
                x.Telefon,
                x.Email,
                x.Aktif
            })
            .ToListAsync();

        var result = new List<object>();

        foreach (var h in hekimler)
        {
            var cari = await BuildCari(h.Id, baslangic, bitis);

            if (!h.Aktif &&
                cari.Isler.Count == 0 &&
                cari.Odemeler.Count == 0 &&
                cari.Bakiyeler.Values.All(v => v == 0))
                continue;

            result.Add(new
            {
                hekimId = h.Id,
                aktif = h.Aktif,
                hekimAdi = h.AdSoyad,
                klinikAdi = h.KlinikAdi,
                telefon = h.Telefon,
                email = h.Email,
                tamamlananIsSayisi = cari.Isler.Count,
                toplamlar = cari.Toplamlar,
                tahsilatlar = cari.TahsilatlarToplam,
                bakiye = cari.Bakiyeler,
                donemBaslangic = cari.DonemBaslangic,
                arsivDonemSayisi = await _db.Database.SqlQuery<int>($"""
                    SELECT COUNT(*)::int AS "Value"
                    FROM "CariDonemleri"
                    WHERE "HekimId"={h.Id} AND COALESCE("GeriAlindi",false)=false
                    """).SingleAsync()
            });
        }

        return Ok(result);
    }

    [HttpGet("hekim/{hekimId:int}")]
    public async Task<IActionResult> HekimDetay(
        int hekimId,
        [FromQuery] DateTime? baslangic,
        [FromQuery] DateTime? bitis)
    {
        var hekim = await _db.Hekimler.AsNoTracking()
            .Where(x => x.Id == hekimId)
            .Select(x => new
            {
                x.Id,
                x.AdSoyad,
                x.KlinikAdi,
                x.Telefon,
                x.Email,
                x.Aktif
            })
            .FirstOrDefaultAsync();

        if (hekim == null)
            return NotFound("Hekim bulunamadı.");

        var cari = await BuildCari(hekimId, baslangic, bitis);

        var donemler = await _db.Database.SqlQuery<KasaArsivDonemRow>($"""
            SELECT
                "Id","HekimId","BaslangicTarihi","KapanisTarihi","IsSayisi",
                "ToplamlarJson","TahsilatlarJson","BakiyelerJson",
                "DevirEklendi","GeriAlindi","Notlar","OlusturmaTarihi"
            FROM "CariDonemleri"
            WHERE "HekimId"={hekimId}
            ORDER BY "KapanisTarihi" DESC, "Id" DESC
            """).ToListAsync();

        return Ok(new
        {
            hekim,
            cari.DonemBaslangic,
            isler = cari.Isler,
            odemeler = cari.Odemeler,
            devir = cari.Devir,
            toplamlar = cari.Toplamlar,
            tahsilatlar = cari.TahsilatlarToplam,
            bakiye = cari.Bakiyeler,
            donemler = donemler.Select(d => new
            {
                d.Id,
                d.BaslangicTarihi,
                d.KapanisTarihi,
                d.IsSayisi,
                toplamlar = ParseMoney(d.ToplamlarJson),
                tahsilatlar = ParseMoney(d.TahsilatlarJson),
                bakiyeler = ParseMoney(d.BakiyelerJson),
                d.DevirEklendi,
                d.GeriAlindi,
                d.Notlar,
                d.OlusturmaTarihi
            })
        });
    }

    // Hekim listesi (tarih aralığı): her hekim için aralık başındaki geçmiş bakiye, aralıktaki işler,
    // tahsilatlar ve aralık sonu bakiyesi. Aralık verilmezse yil/ay ya da bu ay kullanılır.
    [HttpGet("aylik")]
    public async Task<IActionResult> Aylik([FromQuery] int? yil, [FromQuery] int? ay,
        [FromQuery] string? baslangic, [FromQuery] string? bitis, CancellationToken ct)
    {
        var (bas, bit, hata) = AralikSec(yil, ay, baslangic, bitis);
        if (hata != null) return BadRequest(hata);
        var y = bas.Year; var a = bas.Month;

        var hekimler = await _db.Hekimler.AsNoTracking()
            .OrderBy(x => x.AdSoyad)
            .Select(x => new { x.Id, x.AdSoyad, x.KlinikAdi, x.Telefon, x.Aktif })
            .ToListAsync(ct);
        var defterler = await HekimEkstreHesabi.DefterleriKur(_db, 0, ct);

        var satirlar = new List<object>();
        var genel = new
        {
            devir = HekimEkstreHesabi.BosPara(), isToplam = HekimEkstreHesabi.BosPara(),
            tahsilat = HekimEkstreHesabi.BosPara(), kapanis = HekimEkstreHesabi.BosPara()
        };
        var genelIs = 0;
        foreach (var h in hekimler)
        {
            defterler.TryGetValue(h.Id, out var d);
            var e = d == null ? new HekimEkstreHesabi.Ekstre { Baslangic = bas, Bitis = bit } : HekimEkstreHesabi.Hesapla(d, bas, bit);
            var guncel = d == null ? HekimEkstreHesabi.BosPara() : HekimEkstreHesabi.GuncelBakiye(d);
            var hareketli = e.Isler.Count > 0 || e.Odemeler.Count > 0 || e.Duzeltmeler.Count > 0 ||
                            Sifirdan(e.Devir) || Sifirdan(e.Kapanis);
            if (!h.Aktif && !hareketli && !Sifirdan(guncel)) continue;

            foreach (var c in Currencies)
            {
                genel.devir[c] += e.Devir[c]; genel.isToplam[c] += e.IsToplam[c];
                genel.tahsilat[c] += e.TahsilatToplam[c]; genel.kapanis[c] += e.Kapanis[c];
            }
            genelIs += e.Isler.Count;
            satirlar.Add(new
            {
                hekimId = h.Id, aktif = h.Aktif, hekimAdi = h.AdSoyad, klinikAdi = h.KlinikAdi, telefon = h.Telefon,
                hareketli,
                isSayisi = e.Isler.Count,
                hastaSayisi = HastaGruplari(e.Isler).Count,
                devir = e.Devir, isToplam = e.IsToplam, tahsilat = e.TahsilatToplam,
                duzeltme = e.DuzeltmeToplam, kapanis = e.Kapanis, guncelBakiye = guncel
            });
        }

        return Ok(new
        {
            yil = y, ay = a, baslangic = HekimEkstreHesabi.Gun(bas), bitis = HekimEkstreHesabi.Gun(bit),
            genel = new { genel.devir, genel.isToplam, genel.tahsilat, genel.kapanis, isSayisi = genelIs },
            hekimler = satirlar
        });
    }

    // Hekimin aylık ekstresi: devir + o ayın hastaları/işleri − o ayın tahsilatları (± dönem düzeltmesi) = ay sonu bakiyesi.
    [HttpGet("ekstre/{hekimId:int}")]
    public async Task<IActionResult> Ekstre(int hekimId, [FromQuery] int? yil, [FromQuery] int? ay,
        [FromQuery] string? baslangic, [FromQuery] string? bitis, CancellationToken ct)
    {
        var (bas, bit, hata) = AralikSec(yil, ay, baslangic, bitis);
        if (hata != null) return BadRequest(hata);
        var y = bas.Year; var a = bas.Month;
        var hekim = await _db.Hekimler.AsNoTracking()
            .Where(x => x.Id == hekimId)
            .Select(x => new { x.Id, x.AdSoyad, x.KlinikAdi, x.Telefon, x.Email, x.Aktif })
            .FirstOrDefaultAsync(ct);
        if (hekim == null) return NotFound("Hekim bulunamadı.");

        var d = (await HekimEkstreHesabi.DefterleriKur(_db, hekimId, ct))[hekimId];
        var e = HekimEkstreHesabi.Hesapla(d, bas, bit);

        return Ok(new
        {
            hekim,
            yil = y, ay = a, baslangic = HekimEkstreHesabi.Gun(bas), bitis = HekimEkstreHesabi.Gun(bit),
            ayBitmedi = bit >= HekimEkstreHesabi.YerelGun(DateTime.UtcNow),
            devir = e.Devir, isToplam = e.IsToplam, tahsilatToplam = e.TahsilatToplam,
            duzeltmeToplam = e.DuzeltmeToplam, kapanis = e.Kapanis,
            guncelBakiye = HekimEkstreHesabi.GuncelBakiye(d),
            isSayisi = e.Isler.Count,
            isler = e.Isler.Select(x => new
            {
                x.Id, tarih = HekimEkstreHesabi.Gun(x.Tarih),
                gelisTarihi = x.GelisTarihi is { } g ? HekimEkstreHesabi.Gun(g) : null,
                x.HastaAdi, x.IsTuru, x.Adet, x.Tutar, x.ParaBirimi, arsivde = x.KapaliDonemde
            }),
            hastalar = HastaGruplari(e.Isler),
            odemeler = e.Odemeler.Select(x => new
            {
                x.Id, tarih = HekimEkstreHesabi.Gun(x.Tarih), x.Tutar, x.ParaBirimi,
                x.OdemeTuru, x.IslemNo, x.Aciklama, kapali = x.KapaliDonemde
            }),
            duzeltmeler = e.Duzeltmeler.Select(x => new
            {
                x.DonemId, tarih = HekimEkstreHesabi.Gun(x.Tarih), tutarlar = x.Tutarlar, x.Aciklama
            }),
            kapananDonemler = e.KapananDonemler.Select(x => new { x.DonemId, tarih = HekimEkstreHesabi.Gun(x.Tarih) })
        });
    }

    private static (DateOnly, DateOnly, string?) AralikSec(int? yil, int? ay, string? baslangic, string? bitis)
    {
        if (!string.IsNullOrWhiteSpace(baslangic) || !string.IsNullOrWhiteSpace(bitis))
        {
            var ci = System.Globalization.CultureInfo.InvariantCulture;
            if (!DateOnly.TryParseExact(baslangic ?? "", "yyyy-MM-dd", ci, System.Globalization.DateTimeStyles.None, out var b) ||
                !DateOnly.TryParseExact(bitis ?? "", "yyyy-MM-dd", ci, System.Globalization.DateTimeStyles.None, out var e))
                return (default, default, "Başlangıç ve bitiş tarihi seçilmelidir.");
            if (e < b) return (default, default, "Bitiş tarihi başlangıçtan önce olamaz.");
            if (b.Year < 2000 || e.Year > 2100) return (default, default, "Geçersiz tarih aralığı.");
            return (b, e, null);
        }
        var (yy, aa, h) = AySec(yil, ay);
        if (h != null) return (default, default, h);
        var (bb, ee) = HekimEkstreHesabi.AyAraligi(yy, aa);
        return (bb, ee, null);
    }

    private static (int, int, string?) AySec(int? yil, int? ay)
    {
        var (y, a) = HekimEkstreHesabi.BuAy();
        if (yil.HasValue) y = yil.Value;
        if (ay.HasValue) a = ay.Value;
        if (y < 2000 || y > 2100 || a < 1 || a > 12) return (0, 0, "Geçersiz ay seçimi.");
        return (y, a, null);
    }

    private static bool Sifirdan(Dictionary<string, decimal> m) => m.Values.Any(v => v != 0);

    private static List<object> HastaGruplari(List<HekimEkstreHesabi.Hareket> isler) =>
        isler.GroupBy(x => (x.HastaAdi ?? "").Trim().ToLower(new System.Globalization.CultureInfo("tr-TR")))
            .Select(g =>
            {
                var t = HekimEkstreHesabi.BosPara();
                foreach (var x in g) t[x.ParaBirimi] += x.Tutar;
                return (object)new { hastaAdi = g.First().HastaAdi, isSayisi = g.Count(), tutarlar = t };
            })
            .ToList();

    [HttpPost("tahsilat")]
    public async Task<IActionResult> TahsilatEkle([FromBody] KasaArsivTahsilatInput dto)
    {
        try
        {
            if (dto.HekimId <= 0) return BadRequest("Hekim seçilmelidir.");
            if (dto.Tutar <= 0) return BadRequest("Tahsilat tutarı sıfırdan büyük olmalıdır.");
            if (dto.Tutar > 1_000_000_000m) return BadRequest("Tahsilat tutarı güvenli sınırı aşıyor.");

            var currency = NormalizeCurrency(dto.ParaBirimi);
            if (currency == null) return BadRequest("Para birimi TRY, EUR veya USD olmalıdır.");
            if (!await _db.Hekimler.AsNoTracking().AnyAsync(x => x.Id == dto.HekimId && x.Aktif))
                return BadRequest("Hekim bulunamadı veya pasif.");

            var tarih = ToUtcDate(dto.Tarih) ?? DateTime.UtcNow;

            var kapaliDonem = await CariKurallari.KapaliDonemHatasi(_db, dto.HekimId, tarih);
            if (kapaliDonem != null) return BadRequest(kapaliDonem);

            var tur = string.IsNullOrWhiteSpace(dto.OdemeTuru) ? "Nakit" : dto.OdemeTuru.Trim();
            var aciklama = Trim(dto.Aciklama, 500);
            var islemNo = Trim(dto.IslemNo, 150);

            var id = await InsertTahsilatDirect(dto.HekimId, dto.Tutar, currency, tarih, tur, islemNo, aciklama);
            await VeritabaniSayaclari.IleriAl(_db, "Tahsilatlar");
            return Ok(new { id });
        }
        catch (Exception ex)
        {
            return Problem(title: "Tahsilat kaydedilemedi.", detail: SafeDbMessage(ex), statusCode: 500);
        }
    }

    [HttpDelete("tahsilat/{id:int}")]
    public async Task<IActionResult> TahsilatSil(int id)
    {
        var payment = await _db.Database.SqlQuery<KasaArsivPaymentGuard>($"""
            SELECT "Id","HekimId","Tarih"
            FROM "Tahsilatlar"
            WHERE "Id"={id}
            """).FirstOrDefaultAsync();

        if (payment == null)
            return NotFound("Tahsilat kaydı bulunamadı.");

        var lastPeriod = await LastActivePeriod(payment.HekimId);
        if (lastPeriod != null && payment.Tarih <= lastPeriod.KapanisTarihi)
            return BadRequest("Bu tahsilat kapatılmış bir döneme aittir. Önce son dönemi geri alın.");

        await _db.Database.ExecuteSqlInterpolatedAsync($"""
            DELETE FROM "Tahsilatlar" WHERE "Id"={id}
            """);

        return NoContent();
    }

    [HttpPost("donem-kapat/{hekimId:int}")]
    public async Task<IActionResult> DonemKapat(int hekimId, [FromBody] KasaArsivDonemInput dto)
    {
        if (!await _db.Hekimler.AsNoTracking().AnyAsync(x => x.Id == hekimId))
            return NotFound("Hekim bulunamadı.");

        var closeDate = ToUtcDate(dto.KapanisTarihi) ?? DateTime.UtcNow.Date;
        if (closeDate.Date > DateTime.UtcNow.Date)
            return BadRequest("Kapanış tarihi gelecekte olamaz.");

        var last = await LastActivePeriod(hekimId);
        var closeAt = KapanisAni(closeDate);

        if (last != null && closeAt <= last.KapanisTarihi)
            return BadRequest("Yeni kapanış tarihi önceki dönem kapanışından sonra olmalıdır.");

        var cari = await BuildCari(hekimId, null, closeAt, includeCarry: true, kapanisIcin: true);

        if (cari.Isler.Count == 0 &&
            cari.Odemeler.Count == 0 &&
            cari.Devir.Values.All(v => v == 0))
            return BadRequest("Kapatılacak cari hareket bulunmuyor.");

        var balances = new Dictionary<string, decimal>(cari.Bakiyeler);

        if (dto.KapanisBakiyeleri != null)
        {
            foreach (var c in Currencies)
            {
                if (dto.KapanisBakiyeleri.TryGetValue(c, out var v))
                    balances[c] = v;
            }
        }

        int id;
        try
        {
            id = await InsertDonemDirect(hekimId, cari, closeAt, balances, dto);
            await VeritabaniSayaclari.IleriAl(_db, "CariDonemleri");
        }
        catch (Exception ex)
        {
            return Problem(title: "Dönem kapatılamadı.", detail: SafeDbMessage(ex), statusCode: 500);
        }

        return Ok(new
        {
            id,
            kapanisTarihi = closeAt,
            bakiyeler = balances,
            devirEklendi = dto.DevirEkle
        });
    }

    // Dönem kapatma penceresi: seçilen kapanış tarihindeki bakiye (kapatınca kaydedilecek değerin aynısı).
    // Önceden pencere her zaman bugünkü bakiyeyle doluyordu; geçmiş tarihli kapanışta kapanıştan sonraki
    // tahsilatlar hem kapanış bakiyesinden hem açık dönemden düşülüyordu.
    [HttpGet("donem-onizleme/{hekimId:int}")]
    public async Task<IActionResult> DonemOnizleme(int hekimId, [FromQuery] DateTime? tarih)
    {
        if (!await _db.Hekimler.AsNoTracking().AnyAsync(x => x.Id == hekimId))
            return NotFound("Hekim bulunamadı.");
        var closeDate = ToUtcDate(tarih) ?? DateTime.UtcNow.Date;
        var closeAt = KapanisAni(closeDate);
        var last = await LastActivePeriod(hekimId);
        var cari = await BuildCari(hekimId, null, closeAt, includeCarry: true, kapanisIcin: true);
        return Ok(new
        {
            bakiyeler = cari.Bakiyeler,
            devir = cari.Devir,
            toplamlar = cari.Toplamlar,
            tahsilatlar = cari.TahsilatlarToplam,
            isSayisi = cari.Isler.Count,
            odemeSayisi = cari.Odemeler.Count,
            oncekiKapanis = last?.KapanisTarihi,
            gecersiz = closeDate.Date > DateTime.UtcNow.Date ? "Kapanış tarihi gelecekte olamaz."
                : last != null && closeAt <= last.KapanisTarihi ? "Kapanış tarihi önceki dönem kapanışından sonra olmalıdır." : null
        });
    }

    [HttpPost("donem/{id:int}/geri-al")]
    public async Task<IActionResult> DonemGeriAl(int id)
    {
        var row = await _db.Database.SqlQuery<KasaArsivPeriodGuard>($"""
            SELECT "Id","HekimId"
            FROM "CariDonemleri"
            WHERE "Id"={id} AND COALESCE("GeriAlindi",false)=false
            """).FirstOrDefaultAsync();

        if (row == null)
            return NotFound("Aktif dönem bulunamadı.");

        // En son dönem, BuildCari ile aynı şekilde kapanış tarihine göre belirlenir.
        var last = await LastActivePeriod(row.HekimId);

        if (last == null || last.Id != id)
            return BadRequest("Yalnızca en son kapatılan dönem geri alınabilir.");

        await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE "CariDonemleri"
            SET "GeriAlindi"=true, "GuncellemeTarihi"={DateTime.UtcNow}
            WHERE "Id"={id}
            """);

        return Ok();
    }

    [HttpGet("donem/{id:int}")]
    public async Task<IActionResult> DonemDetay(int id)
    {
        var row = await _db.Database.SqlQuery<KasaArsivDonemDetailRow>($"""
            SELECT
                "Id","HekimId","BaslangicTarihi","KapanisTarihi","IsSayisi",
                "ToplamlarJson","TahsilatlarJson","BakiyelerJson",
                "IslerSnapshotJson","TahsilatlarSnapshotJson",
                "DevirEklendi","GeriAlindi","Notlar","OlusturmaTarihi"
            FROM "CariDonemleri"
            WHERE "Id"={id}
            """).FirstOrDefaultAsync();

        if (row == null)
            return NotFound("Dönem bulunamadı.");

        return Ok(new
        {
            row.Id,
            row.HekimId,
            row.BaslangicTarihi,
            row.KapanisTarihi,
            row.IsSayisi,
            toplamlar = ParseMoney(row.ToplamlarJson),
            tahsilatlar = ParseMoney(row.TahsilatlarJson),
            bakiyeler = ParseMoney(row.BakiyelerJson),
            isler = JsonSerializer.Deserialize<object>(row.IslerSnapshotJson),
            odemeler = JsonSerializer.Deserialize<object>(row.TahsilatlarSnapshotJson),
            row.DevirEklendi,
            row.GeriAlindi,
            row.Notlar,
            row.OlusturmaTarihi
        });
    }

    private async Task<KasaArsivCurrent> BuildCari(
        int hekimId,
        DateTime? baslangic,
        DateTime? bitis,
        bool includeCarry = true,
        bool kapanisIcin = false)
    {
        var last = await LastActivePeriod(hekimId);
        DateTime? periodStart = last?.KapanisTarihi.AddTicks(1);

        var jobs = await _db.Database.SqlQuery<KasaArsivJobRow>($"""
            SELECT
                s."Id",
                p."AdSoyad" AS "HastaAdi",
                COALESCE(s."ParaBirimi",'TRY') AS "ParaBirimi",
                COALESCE(SUM(k."Adet" * k."BirimFiyat"),0) AS "Tutar",
                COALESCE(string_agg(k."IsTuru", ', ' ORDER BY k."Id"),'-') AS "IsTuru",
                COALESCE(
                    (
                        SELECT MAX(g."DegisimTarihi")
                        FROM "SiparisDurumGecmisi" g
                        WHERE g."SiparisId"=s."Id"
                          AND g."YeniDurum" IN ('Tamamlandı','Teslim')
                    ),
                    s."OlusturmaTarihi"
                ) AS "TamamlanmaTarihi",
                s."OlusturmaTarihi" AS "TeslimTarihi"
            FROM "Siparisler" s
            INNER JOIN "Hastalar" p ON p."Id"=s."HastaId"
            LEFT JOIN "SiparisKalemleri" k ON k."SiparisId"=s."Id"
            WHERE p."HekimId"={hekimId}
              AND COALESCE(s."Silindi",false)=false
              AND s."Durum" IN ('Tamamlandı','Teslim')
            GROUP BY s."Id",p."AdSoyad",s."ParaBirimi",s."OlusturmaTarihi"
            ORDER BY "TeslimTarihi" DESC, s."Id" DESC
            """).ToListAsync();

        var payments = await _db.Database.SqlQuery<KasaArsivPaymentRow>($"""
            SELECT
                "Id","HekimId","Tutar",
                COALESCE("ParaBirimi",'TRY') AS "ParaBirimi",
                "Tarih","OdemeTuru","IslemNo","Aciklama","OlusturmaTarihi"
            FROM "Tahsilatlar"
            WHERE "HekimId"={hekimId}
            ORDER BY "Tarih" DESC,"Id" DESC
            """).ToListAsync();

        var start = MaxDate(periodStart, ToUtcDate(baslangic));
        // Kapanışta bitiş, çağıranın hesapladığı kesin kapanış anıdır (Türkiye saatiyle gün sonu).
        var end = bitis.HasValue
            ? (kapanisIcin ? bitis.Value : ToUtcDate(bitis)!.Value.Date.AddDays(1).AddTicks(-1))
            : (DateTime?)null;

        // Dönem sınırı tamamlanma tarihine göre; kullanıcı filtresi geliş tarihine göre.
        // Kapatılmış dönemlere girmiş işler açık dönemde tekrar sayılmaz.
        // Dönem kapanışında ise kapanış tarihine kadar TAMAMLANAN işler alınır: geçmiş tarihli
        // kapanışta, kapanıştan önce gelip sonra tamamlanan iş yanlış döneme yazılmasın.
        var userStart = ToUtcDate(baslangic);
        var arsivlenmis = await CariKurallari.ArsivlenmisIsler(_db, hekimId);
        var filteredJobs = jobs.Where(x =>
            !arsivlenmis.Contains(x.Id) &&
            (!periodStart.HasValue || x.TamamlanmaTarihi >= periodStart.Value) &&
            (!userStart.HasValue || x.TeslimTarihi >= userStart.Value) &&
            (!end.HasValue || (kapanisIcin ? x.TamamlanmaTarihi : x.TeslimTarihi) <= end.Value)
        ).ToList();

        var filteredPayments = payments.Where(x =>
            (!start.HasValue || x.Tarih >= start.Value) &&
            (!end.HasValue || x.Tarih <= end.Value)
        ).ToList();

        var totals = EmptyMoney();
        foreach (var x in filteredJobs)
            totals[NormalizeCurrency(x.ParaBirimi) ?? "TRY"] += x.Tutar;

        var collected = EmptyMoney();
        foreach (var x in filteredPayments)
            collected[NormalizeCurrency(x.ParaBirimi) ?? "TRY"] += x.Tutar;

        var carry = EmptyMoney();
        if (includeCarry && !baslangic.HasValue && last != null && last.DevirEklendi)
        {
            var previous = ParseMoney(last.BakiyelerJson);
            foreach (var c in Currencies)
                carry[c] = previous[c];
        }

        var balance = EmptyMoney();
        foreach (var c in Currencies)
            balance[c] = carry[c] + totals[c] - collected[c];

        return new KasaArsivCurrent
        {
            DonemBaslangic = periodStart,
            Isler = filteredJobs,
            Odemeler = filteredPayments,
            Devir = carry,
            Toplamlar = totals,
            TahsilatlarToplam = collected,
            Bakiyeler = balance
        };
    }

    private async Task<KasaArsivLastPeriod?> LastActivePeriod(int hekimId)
    {
        return await _db.Database.SqlQuery<KasaArsivLastPeriod>($"""
            SELECT "Id","KapanisTarihi","BakiyelerJson","DevirEklendi"
            FROM "CariDonemleri"
            WHERE "HekimId"={hekimId}
              AND COALESCE("GeriAlindi",false)=false
            ORDER BY "KapanisTarihi" DESC,"Id" DESC
            LIMIT 1
            """).FirstOrDefaultAsync();
    }

    private async Task<int> InsertTahsilatDirect(int hekimId, decimal tutar, string paraBirimi, DateTime tarih, string odemeTuru, string? islemNo, string? aciklama)
    {
        var conn = _db.Database.GetDbConnection();
        var opened = conn.State != ConnectionState.Open;
        if (opened) await conn.OpenAsync();
        try
        {
            await using var cmd = conn.CreateCommand();
            // V33.07.11: Eski/aktarilmis veritabanlarinda Id sequence yetkisi olmayabiliyor.
            // Id'yi tablo icinden guvenli bicimde ureterek sequence bagimliligini kaldiriyoruz.
            cmd.CommandText = """
                WITH _lock AS (SELECT pg_advisory_xact_lock(33071101)),
                _next AS (
                    SELECT COALESCE(MAX(t."Id"),0)+1 AS "Id"
                    FROM "Tahsilatlar" t, _lock
                )
                INSERT INTO "Tahsilatlar"
                ("Id","HekimId","Tutar","ParaBirimi","Tarih","OdemeTuru","IslemNo","Aciklama","OlusturmaTarihi")
                SELECT _next."Id",@h,@t,@p,@d,@o,@i,@a,@n FROM _next
                RETURNING "Id";
                """;
            AddParam(cmd,"@h",hekimId); AddParam(cmd,"@t",tutar); AddParam(cmd,"@p",paraBirimi); AddParam(cmd,"@d",tarih);
            AddParam(cmd,"@o",odemeTuru); AddParam(cmd,"@i",islemNo); AddParam(cmd,"@a",aciklama); AddParam(cmd,"@n",DateTime.UtcNow);
            return Convert.ToInt32(await cmd.ExecuteScalarAsync());
        }
        finally { if (opened) await conn.CloseAsync(); }
    }

    private async Task<int> InsertDonemDirect(int hekimId, KasaArsivCurrent cari, DateTime closeAt, Dictionary<string,decimal> balances, KasaArsivDonemInput dto)
    {
        var conn = _db.Database.GetDbConnection();
        var opened = conn.State != ConnectionState.Open;
        if (opened) await conn.OpenAsync();
        try
        {
            await using var cmd = conn.CreateCommand();
            // V33.07.11: CariDonemleri sequence yetkisi olmayan eski kurulumlarda da calisir.
            cmd.CommandText = """
                WITH _lock AS (SELECT pg_advisory_xact_lock(33071102)),
                _next AS (
                    SELECT COALESCE(MAX(d."Id"),0)+1 AS "Id"
                    FROM "CariDonemleri" d, _lock
                )
                INSERT INTO "CariDonemleri"
                ("Id","HekimId","BaslangicTarihi","KapanisTarihi","IsSayisi","ToplamlarJson","TahsilatlarJson","BakiyelerJson","IslerSnapshotJson","TahsilatlarSnapshotJson","DevirEklendi","GeriAlindi","Notlar","OlusturmaTarihi")
                SELECT _next."Id",@h,@b,@k,@s,@tj,@thj,@bj,@ij,@oj,@d,false,@not,@n FROM _next
                RETURNING "Id";
                """;
            AddParam(cmd,"@h",hekimId); AddParam(cmd,"@b",cari.DonemBaslangic); AddParam(cmd,"@k",closeAt); AddParam(cmd,"@s",cari.Isler.Count);
            AddParam(cmd,"@tj",JsonSerializer.Serialize(cari.Toplamlar)); AddParam(cmd,"@thj",JsonSerializer.Serialize(cari.TahsilatlarToplam)); AddParam(cmd,"@bj",JsonSerializer.Serialize(balances));
            AddParam(cmd,"@ij",JsonSerializer.Serialize(cari.Isler)); AddParam(cmd,"@oj",JsonSerializer.Serialize(cari.Odemeler)); AddParam(cmd,"@d",dto.DevirEkle); AddParam(cmd,"@not",Trim(dto.Notlar,1000)); AddParam(cmd,"@n",DateTime.UtcNow);
            return Convert.ToInt32(await cmd.ExecuteScalarAsync());
        }
        finally { if (opened) await conn.CloseAsync(); }
    }

    // Kapanış, seçilen günün Türkiye saatiyle (UTC+3) gün sonudur; gece yarısından sonra tamamlanan
    // iş ya da tahsilat ertesi güne (yeni döneme) kalır. Aylık ekstre de günleri Türkiye saatine göre ayırır.
    private static DateTime KapanisAni(DateTime gun) =>
        DateTime.SpecifyKind(gun.Date, DateTimeKind.Utc).AddDays(1).AddHours(-3).AddTicks(-1);

    private static void AddParam(DbCommand cmd, string name, object? value)
    {
        var p=cmd.CreateParameter(); p.ParameterName=name; p.Value=value ?? DBNull.Value; cmd.Parameters.Add(p);
    }

    private static string SafeDbMessage(Exception ex)
    {
        var m=ex.GetBaseException().Message;
        if (m.Contains("permission denied", StringComparison.OrdinalIgnoreCase)) return "Veritabanı yetkisi eksik: "+m;
        if (m.Contains("does not exist", StringComparison.OrdinalIgnoreCase)) return "Kasa / Arşiv veritabanı şeması eksik: "+m;
        return m.Length>600 ? m[..600] : m;
    }

    private static Dictionary<string, decimal> EmptyMoney() =>
        new()
        {
            ["TRY"] = 0,
            ["EUR"] = 0,
            ["USD"] = 0
        };

    private static Dictionary<string, decimal> ParseMoney(string? json)
    {
        var result = EmptyMoney();

        if (string.IsNullOrWhiteSpace(json))
            return result;

        try
        {
            var map = JsonSerializer.Deserialize<Dictionary<string, decimal>>(json);
            if (map != null)
            {
                foreach (var c in Currencies)
                {
                    if (map.TryGetValue(c, out var v))
                        result[c] = v;
                }
            }
        }
        catch { }

        return result;
    }

    private static string? NormalizeCurrency(string? value)
    {
        var c = string.IsNullOrWhiteSpace(value)
            ? "TRY"
            : value.Trim().ToUpperInvariant();

        return c is "TRY" or "EUR" or "USD" ? c : null;
    }

    private static DateTime? ToUtcDate(DateTime? value)
    {
        if (!value.HasValue)
            return null;

        return DateTime.SpecifyKind(value.Value.Date, DateTimeKind.Utc);
    }

    private static DateTime? MaxDate(DateTime? a, DateTime? b)
    {
        if (!a.HasValue) return b;
        if (!b.HasValue) return a;
        return a.Value > b.Value ? a : b;
    }

    private static string? Trim(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        value = value.Trim();
        return value.Length <= max ? value : value[..max];
    }
}

public sealed class KasaArsivCurrent
{
    public DateTime? DonemBaslangic { get; set; }
    public List<KasaArsivJobRow> Isler { get; set; } = new();
    public List<KasaArsivPaymentRow> Odemeler { get; set; } = new();
    public Dictionary<string, decimal> Devir { get; set; } = new();
    public Dictionary<string, decimal> Toplamlar { get; set; } = new();
    public Dictionary<string, decimal> TahsilatlarToplam { get; set; } = new();
    public Dictionary<string, decimal> Bakiyeler { get; set; } = new();
}

public sealed class KasaArsivJobRow
{
    public int Id { get; set; }
    public string HastaAdi { get; set; } = "";
    public string IsTuru { get; set; } = "";
    public decimal Tutar { get; set; }
    public string ParaBirimi { get; set; } = "TRY";
    public DateTime TeslimTarihi { get; set; }
    public DateTime TamamlanmaTarihi { get; set; }
}

public sealed class KasaArsivPaymentRow
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

public sealed class KasaArsivTahsilatInput
{
    public int HekimId { get; set; }
    public decimal Tutar { get; set; }
    public string? ParaBirimi { get; set; } = "TRY";
    public DateTime? Tarih { get; set; }
    public string? OdemeTuru { get; set; }
    public string? IslemNo { get; set; }
    public string? Aciklama { get; set; }
}

public sealed class KasaArsivDonemInput
{
    public DateTime? KapanisTarihi { get; set; }
    public bool DevirEkle { get; set; } = true;
    public Dictionary<string, decimal>? KapanisBakiyeleri { get; set; }
    public string? Notlar { get; set; }
}

public sealed class KasaArsivLastPeriod
{
    public int Id { get; set; }
    public DateTime KapanisTarihi { get; set; }
    public string BakiyelerJson { get; set; } = "{}";
    public bool DevirEklendi { get; set; }
}

public class KasaArsivDonemRow
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

public sealed class KasaArsivDonemDetailRow : KasaArsivDonemRow
{
    public string IslerSnapshotJson { get; set; } = "[]";
    public string TahsilatlarSnapshotJson { get; set; } = "[]";
}

public sealed class KasaArsivPaymentGuard
{
    public int Id { get; set; }
    public int HekimId { get; set; }
    public DateTime Tarih { get; set; }
}

public sealed class KasaArsivPeriodGuard
{
    public int Id { get; set; }
    public int HekimId { get; set; }
}
