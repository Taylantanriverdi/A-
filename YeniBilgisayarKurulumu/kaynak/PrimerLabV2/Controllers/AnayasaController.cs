using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;
using PrimerLabV2.Models;

namespace PrimerLabV2.Controllers
{
    [ApiController]
    [Route("api/anayasa")]
    public class AnayasaController : ControllerBase
    {
        private readonly PrimerLabDbContext _db;
        private readonly IConfiguration _config;
        private readonly IWebHostEnvironment _environment;

        private static readonly string[] GecerliDurumlar =
        {
            "Bekliyor",
            "Devam Ediyor",
            "Tasarımda",
            "Üretimde",
            "Makyajda",
            "Tamamlama Onayı",
            "Tamamlandı"
        };

        public AnayasaController(
            PrimerLabDbContext db,
            IConfiguration config,
            IWebHostEnvironment environment)
        {
            _db = db;
            _config = config;
            _environment = environment;
        }

        private static DateTime? NormalizeDate(DateTime? value)
        {
            if (!value.HasValue)
                return null;

            var d = value.Value.Date;
            return DateTime.SpecifyKind(d, DateTimeKind.Utc);
        }

        private async Task DurumGecmisiEkle(
            int siparisId,
            string? eski,
            string yeni,
            string aciklama)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO "SiparisDurumGecmisi"
                (
                    "SiparisId",
                    "EskiDurum",
                    "YeniDurum",
                    "DegisimTarihi",
                    "Aciklama"
                )
                VALUES
                (
                    {siparisId},
                    {eski},
                    {yeni},
                    {DateTime.UtcNow},
                    {aciklama}
                )
                """);
        }

        [HttpGet("isler")]
        public async Task<IActionResult> Isler()
        {
            var baseRows = await _db.Siparisler
                .AsNoTracking()
                .OrderByDescending(s => s.Id)
                .Select(s => new
                {
                    s.Id,
                    s.HastaId,
                    HastaAdi = s.Hasta.AdSoyad,
                    HekimId = s.Hasta.HekimId,
                    HekimAdi = s.Hasta.Hekim != null ? s.Hasta.Hekim.AdSoyad : "",
                    KlinikAdi = s.Hasta.Hekim != null ? s.Hasta.Hekim.KlinikAdi : "",
                    s.Durum,
                    s.Notlar,
                    s.OlusturmaTarihi,
                    ToplamAdet = s.Kalemler.Sum(k => k.Adet),
                    ToplamTutar = s.Kalemler.Sum(k => k.Adet * k.BirimFiyat),
                    Kalemler = s.Kalemler.Select(k => new
                    {
                        k.Id,
                        k.IsTuru,
                        k.Adet,
                        k.BirimFiyat,
                        Toplam = k.Adet * k.BirimFiyat
                    })
                })
                .ToListAsync();

            var metas = await _db.Database
                .SqlQuery<AnayasaIsMetaDto>($"""
                    SELECT
                        s."Id" AS "SiparisId",
                        COALESCE(s."OnayDurumu",'Onaylandı') AS "OnayDurumu",
                        COALESCE(s."Kaynak",'Eski Sistem') AS "Kaynak",
                        s."TerminTarihi",
                        s."DisRengi",
                        s."DisSemasi",
                        s."Materyal",
                        COALESCE(s."ParaBirimi",'TRY') AS "ParaBirimi",
                        COALESCE(s."Silindi",false) AS "Silindi",
                        s."SilinmeTarihi",
                        s."TamamlamaOncekiDurum",
                        s."TamamlamaTalepTarihi",
                        COALESCE(s."TasarimIndirildi",false) AS "TasarimIndirildi",
                        s."TasarimIndirmeTarihi",
                        COALESCE(f."DosyaSayisi",0)::int AS "DosyaSayisi",
                        COALESCE(f."TaramaSayisi",0)::int AS "TaramaDosyaSayisi",
                        COALESCE(f."TasarimSayisi",0)::int AS "TasarimDosyaSayisi"
                    FROM "Siparisler" s
                    LEFT JOIN
                    (
                        SELECT
                            "SiparisId",
                            COUNT(*) AS "DosyaSayisi",
                            COUNT(*) FILTER (WHERE "DosyaTuru"='Tarama') AS "TaramaSayisi",
                            COUNT(*) FILTER (WHERE "DosyaTuru"='Tasarım') AS "TasarimSayisi"
                        FROM "IsDosyalari"
                        GROUP BY "SiparisId"
                    ) f ON f."SiparisId"=s."Id"
                    """)
                .ToListAsync();

            var map = metas.ToDictionary(x => x.SiparisId);

            return Ok(baseRows.Select(x =>
            {
                map.TryGetValue(x.Id, out var m);
                return new
                {
                    x.Id,
                    x.HastaId,
                    x.HastaAdi,
                    x.HekimId,
                    x.HekimAdi,
                    x.KlinikAdi,
                    x.Durum,
                    x.Notlar,
                    x.OlusturmaTarihi,
                    OnayDurumu = m?.OnayDurumu ?? "Onaylandı",
                    Kaynak = m?.Kaynak ?? "Eski Sistem",
                    TerminTarihi = m?.TerminTarihi,
                    DisRengi = m?.DisRengi,
                    DisSemasi = m?.DisSemasi,
                    Materyal = m?.Materyal,
                    ParaBirimi = m?.ParaBirimi ?? "TRY",
                    Silindi = m?.Silindi ?? false,
                    SilinmeTarihi = m?.SilinmeTarihi,
                    TamamlamaOncekiDurum = m?.TamamlamaOncekiDurum,
                    TamamlamaTalepTarihi = m?.TamamlamaTalepTarihi,
                    TasarimIndirildi = m?.TasarimIndirildi ?? false,
                    TasarimIndirmeTarihi = m?.TasarimIndirmeTarihi,
                    DosyaSayisi = m?.DosyaSayisi ?? 0,
                    TaramaDosyaSayisi = m?.TaramaDosyaSayisi ?? 0,
                    TasarimDosyaSayisi = m?.TasarimDosyaSayisi ?? 0,
                    x.ToplamAdet,
                    x.ToplamTutar,
                    x.Kalemler
                };
            }));
        }

        [HttpPost("siparis")]
        public async Task<IActionResult> YeniSiparis(
            [FromBody] AnayasaSiparisDto dto)
        {
            if (dto.HekimId <= 0)
                return BadRequest("Hekim seçilmelidir.");

            if (string.IsNullOrWhiteSpace(dto.HastaAdi))
                return BadRequest("Hasta adı gereklidir.");

            if (dto.Kalemler == null || dto.Kalemler.Count == 0)
                return BadRequest("En az bir iş kalemi gereklidir.");

            foreach (var k in dto.Kalemler)
            {
                if (string.IsNullOrWhiteSpace(k.IsTuru))
                    return BadRequest("İş türü boş olamaz.");

                if (k.Adet <= 0)
                    return BadRequest("Adet en az 1 olmalıdır.");

                if (k.BirimFiyat < 0)
                    return BadRequest("Birim fiyat negatif olamaz.");

                var currency = NormalizeCurrency(
                    string.IsNullOrWhiteSpace(k.ParaBirimi)
                        ? dto.ParaBirimi
                        : k.ParaBirimi
                );

                if (currency == null)
                    return BadRequest(
                        $"'{k.IsTuru}' kalemi için para birimi TRY, EUR veya USD olmalıdır."
                    );
            }

            var hekimVar = await _db.Hekimler
                .AsNoTracking()
                .AnyAsync(h => h.Id == dto.HekimId && h.Aktif);

            if (!hekimVar)
                return BadRequest("Hekim bulunamadı veya pasif.");

            var gruplar = dto.Kalemler
                .Select(k => new
                {
                    Kalem = k,
                    ParaBirimi = NormalizeCurrency(
                        string.IsNullOrWhiteSpace(k.ParaBirimi)
                            ? dto.ParaBirimi
                            : k.ParaBirimi
                    )!
                })
                .GroupBy(x => x.ParaBirimi)
                .Select(g => new
                {
                    ParaBirimi = g.Key,
                    Kalemler = g.Select(x => x.Kalem).ToList()
                })
                .ToList();

            var termin = NormalizeDate(dto.TerminTarihi);
            var renk = Normalize(dto.DisRengi, 50);
            var materyal = Normalize(dto.Materyal, 120);
            var disSemasi = Normalize(dto.DisSemasi, 250);
            var kaynak = Normalize(dto.Kaynak, 40) ?? "Sipariş Formu";

            var sonuc = new List<OlusturulanSiparisDto>();

            // V32.26: Hekim Portalindan gelen kaydi yeni siparis olarak kopyalama.
            // Ayni SiparisId uzerinde resmi siparis formuna donustur; dosyalar ve portal baglantisi korunur.
            if (dto.AktarilanSiparisId.HasValue && dto.AktarilanSiparisId.Value > 0)
            {
                if (gruplar.Count != 1)
                    return BadRequest("Portal işi sipariş formuna aktarılırken tek para birimi kullanılmalıdır.");

                var aktarimId = dto.AktarilanSiparisId.Value;
                var mevcut = await _db.Siparisler
                    .Include(x => x.Hasta)
                    .Include(x => x.Kalemler)
                    .FirstOrDefaultAsync(x => x.Id == aktarimId);

                if (mevcut == null)
                    return NotFound("Aktarılacak portal işi bulunamadı.");

                var meta = await _db.Database.SqlQuery<AnayasaAktarimGuardDto>($"""
                    SELECT
                        COALESCE("Kaynak",'') AS "Kaynak",
                        COALESCE("Silindi",false) AS "Silindi"
                    FROM "Siparisler"
                    WHERE "Id"={aktarimId}
                    """).FirstOrDefaultAsync();

                if (meta == null || meta.Silindi)
                    return BadRequest("Silinmiş bir iş sipariş formuna aktarılamaz.");

                if (!string.Equals(meta.Kaynak, "Hekim Portalı", StringComparison.OrdinalIgnoreCase))
                    return Conflict("Bu kayıt daha önce sipariş formuna aktarılmış veya portal kaydı değildir.");

                if (mevcut.Hasta == null || mevcut.Hasta.HekimId != dto.HekimId)
                    return BadRequest("Portal işi farklı bir hekime aktarılamaz.");

                var grup = gruplar[0];
                var aktarimOncekiDurum = mevcut.Durum;
                var strategyAktar = _db.Database.CreateExecutionStrategy();
                await strategyAktar.ExecuteAsync(async () =>
                {
                    await using var tx = await _db.Database.BeginTransactionAsync();
                    try
                    {
                        mevcut.Hasta.AdSoyad = dto.HastaAdi.Trim();
                        mevcut.Hasta.Notlar = string.IsNullOrWhiteSpace(dto.Notlar) ? null : dto.Notlar.Trim();
                        mevcut.Notlar = string.IsNullOrWhiteSpace(dto.Notlar) ? null : dto.Notlar.Trim();
                        mevcut.Durum = "Bekliyor";
                        mevcut.Aktif = true;

                        _db.SiparisKalemleri.RemoveRange(mevcut.Kalemler);
                        mevcut.Kalemler = grup.Kalemler.Select(k => new SiparisKalemi
                        {
                            IsTuru = k.IsTuru.Trim(),
                            Adet = k.Adet,
                            BirimFiyat = k.BirimFiyat
                        }).ToList();

                        await _db.SaveChangesAsync();

                        await _db.Database.ExecuteSqlInterpolatedAsync($"""
                            UPDATE "Siparisler"
                            SET
                                "OnayDurumu"='Gelen Onay',
                                "Kaynak"='Sipariş Formu (Hekim Portalı)',
                                "TerminTarihi"={termin},
                                "DisRengi"={renk},
                                "DisSemasi"={disSemasi},
                                "Materyal"={materyal},
                                "ParaBirimi"={grup.ParaBirimi},
                                "Silindi"=false,
                                "SilinmeTarihi"=NULL
                            WHERE "Id"={aktarimId}
                            """);

                        await DurumGecmisiEkle(
                            aktarimId,
                            aktarimOncekiDurum,
                            "Bekliyor",
                            "Hekim Portalı kaydı Sipariş Formuna aktarıldı; Gelen İş Onayı bekliyor."
                        );

                        await tx.CommitAsync();
                    }
                    catch
                    {
                        await tx.RollbackAsync();
                        throw;
                    }
                });

                return Ok(new
                {
                    olusturulanSiparisSayisi = 1,
                    aktarilanSiparisId = aktarimId,
                    mevcutKayitGuncellendi = true,
                    siparisler = new[] { new { id = aktarimId } }
                });
            }

            try
            {
                // Npgsql retry stratejisi varken transaction bu şekilde çalıştırılmalıdır.
                // Böylece geçici bağlantı hatalarında transaction/retry çakışması oluşmaz.
                var strategy = _db.Database.CreateExecutionStrategy();

                await strategy.ExecuteAsync(async () =>
                {
                    await using var tx = await _db.Database.BeginTransactionAsync();

                    try
                    {
                        var hasta = new Hasta
                        {
                            AdSoyad = dto.HastaAdi.Trim(),
                            HekimId = dto.HekimId,
                            Telefon = null,
                            Notlar = string.IsNullOrWhiteSpace(dto.Notlar)
                                ? null
                                : dto.Notlar.Trim(),
                            Aktif = true,
                            OlusturmaTarihi = DateTime.UtcNow
                        };

                        _db.Hastalar.Add(hasta);

                        var siparisler = gruplar.Select(grup => new
                        {
                            Grup = grup,
                            Siparis = new Siparis
                            {
                                Hasta = hasta,
                                Durum = "Bekliyor",
                                Notlar = string.IsNullOrWhiteSpace(dto.Notlar)
                                    ? null
                                    : dto.Notlar.Trim(),
                                Aktif = true,
                                OlusturmaTarihi = DateTime.UtcNow,
                                Kalemler = grup.Kalemler.Select(k => new SiparisKalemi
                                {
                                    IsTuru = k.IsTuru.Trim(),
                                    Adet = k.Adet,
                                    BirimFiyat = k.BirimFiyat
                                }).ToList()
                            }
                        }).ToList();

                        foreach (var x in siparisler)
                            _db.Siparisler.Add(x.Siparis);

                        // Hasta + bütün para birimi grupları tek EF SaveChanges ile oluşturulur.
                        await _db.SaveChangesAsync();

                        foreach (var x in siparisler)
                        {
                            var siparis = x.Siparis;
                            var paraBirimi = x.Grup.ParaBirimi;

                            await _db.Database.ExecuteSqlInterpolatedAsync($"""
                                UPDATE "Siparisler"
                                SET
                                    "OnayDurumu"='Gelen Onay',
                                    "Kaynak"={kaynak},
                                    "TerminTarihi"={termin},
                                    "DisRengi"={renk},
                                    "DisSemasi"={disSemasi},
                                    "Materyal"={materyal},
                                    "ParaBirimi"={paraBirimi},
                                    "Silindi"=false,
                                    "SilinmeTarihi"=NULL
                                WHERE "Id"={siparis.Id}
                                """);

                            await DurumGecmisiEkle(
                                siparis.Id,
                                null,
                                "Bekliyor",
                                gruplar.Count > 1
                                    ? $"Sipariş oluşturuldu; {paraBirimi} grubu Gelen İş Onayı bekliyor."
                                    : "Sipariş oluşturuldu; Gelen İş Onayı bekliyor."
                            );

                            sonuc.Add(new OlusturulanSiparisDto
                            {
                                Id = siparis.Id,
                                Durum = "Bekliyor",
                                OnayDurumu = "Gelen Onay",
                                ParaBirimi = paraBirimi,
                                KalemSayisi = siparis.Kalemler.Count
                            });
                        }

                        await tx.CommitAsync();
                    }
                    catch
                    {
                        await tx.RollbackAsync();
                        throw;
                    }
                });

                return Ok(new
                {
                    olusturulanSiparisSayisi = sonuc.Count,
                    karisikParaBirimi = sonuc.Count > 1,
                    siparisler = sonuc
                });
            }
            catch (DbUpdateException)
            {
                return Problem(
                    statusCode: StatusCodes.Status500InternalServerError,
                    title: "Sipariş kaydedilemedi.",
                    detail: "Sipariş veritabanına yazılamadı. Veriler geri alındı; eksik veya yarım kayıt oluşmadı."
                );
            }
            catch (Exception)
            {
                return Problem(
                    statusCode: StatusCodes.Status500InternalServerError,
                    title: "Sipariş kaydedilemedi.",
                    detail: "Sipariş oluşturma işlemi tamamlanamadı. Veriler geri alındı; eksik veya yarım kayıt oluşmadı."
                );
            }
        }


        [HttpPatch("isler/{id:int}/gelen-onayla")]
        public async Task<IActionResult> GelenOnayla(int id)
        {
            var count = await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE "Siparisler"
                SET "OnayDurumu"='Onaylandı'
                WHERE "Id"={id}
                  AND COALESCE("Silindi",false)=false
                  AND COALESCE("OnayDurumu",'Onaylandı')='Gelen Onay'
                """);

            if (count == 0)
                return NotFound("İş bulunamadı.");

            return Ok();
        }

        [HttpPatch("isler/{id:int}/gelen-reddet")]
        public async Task<IActionResult> GelenReddet(int id)
        {
            var count = await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE "Siparisler"
                SET
                    "OnayDurumu"='Reddedildi',
                    "Silindi"=true,
                    "SilinmeTarihi"={DateTime.UtcNow}
                WHERE "Id"={id}
                  AND COALESCE("Silindi",false)=false
                  AND COALESCE("OnayDurumu",'Onaylandı')='Gelen Onay'
                """);

            if (count == 0)
                return BadRequest("İş bulunamadı, silinmiş veya Gelen İş Onayı beklemiyor.");

            return Ok();
        }

        [HttpPatch("isler/{id:int}/durum")]
        public async Task<IActionResult> Durum(
            int id,
            [FromBody] AnayasaDurumDto dto)
        {
            var yeni = dto.Durum?.Trim();

            if (string.IsNullOrWhiteSpace(yeni) ||
                !GecerliDurumlar.Contains(yeni))
            {
                return BadRequest("Geçersiz durum.");
            }

            var siparis = await _db.Siparisler
                .FirstOrDefaultAsync(x => x.Id == id);

            if (siparis == null)
                return NotFound("İş bulunamadı.");

            var guard = await _db.Database
                .SqlQuery<AnayasaDurumGuardDto>($"""
                    SELECT
                        COALESCE("OnayDurumu",'Onaylandı') AS "OnayDurumu",
                        COALESCE("Silindi",false) AS "Silindi"
                    FROM "Siparisler"
                    WHERE "Id"={id}
                    """)
                .FirstAsync();

            if (guard.Silindi)
                return BadRequest("Silinen bir işin durumu değiştirilemez. Önce geri alın.");

            if (guard.OnayDurumu == "Gelen Onay")
                return BadRequest("İş henüz Gelen İş Onayı bekliyor.");

            if (guard.OnayDurumu == "Reddedildi")
                return BadRequest("Reddedilmiş bir işin durumu değiştirilemez.");

            var eski = siparis.Durum;

            if (yeni == "Tamamlama Onayı")
            {
                await _db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE "Siparisler"
                    SET
                        "Durum"='Tamamlama Onayı',
                        "TamamlamaOncekiDurum"={eski},
                        "TamamlamaTalepTarihi"={DateTime.UtcNow}
                    WHERE "Id"={id}
                    """);

                await DurumGecmisiEkle(
                    id,
                    eski,
                    "Tamamlama Onayı",
                    "Teknisyen işi bitirdi; admin onayı bekliyor.");

                return Ok();
            }

            siparis.Durum = yeni;
            await _db.SaveChangesAsync();

            if (yeni == "Tamamlandı")
            {
                await _db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE "Siparisler"
                    SET "TamamlamaOncekiDurum"=NULL,
                        "TamamlamaTalepTarihi"=NULL
                    WHERE "Id"={id}
                    """);
            }

            await DurumGecmisiEkle(
                id,
                eski,
                yeni,
                "Üretim aşaması güncellendi.");

            return Ok();
        }

        [HttpPatch("isler/{id:int}/tamamlama-onayla")]
        public async Task<IActionResult> TamamlamaOnayla(int id)
        {
            var siparis = await _db.Siparisler
                .FirstOrDefaultAsync(x => x.Id == id);

            if (siparis == null)
                return NotFound("İş bulunamadı.");

            var eski = siparis.Durum;

            if (eski != "Tamamlama Onayı")
                return BadRequest("İş tamamlama onayı beklemiyor.");

            siparis.Durum = "Tamamlandı";
            await _db.SaveChangesAsync();

            await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE "Siparisler"
                SET
                    "TamamlamaOncekiDurum"=NULL,
                    "TamamlamaTalepTarihi"=NULL
                WHERE "Id"={id}
                """);

            await DurumGecmisiEkle(
                id,
                eski,
                "Tamamlandı",
                "Admin biten iş onayını verdi.");

            return Ok();
        }

        [HttpPatch("isler/{id:int}/tamamlama-reddet")]
        public async Task<IActionResult> TamamlamaReddet(int id)
        {
            var row = await _db.Database
                .SqlQuery<TamamlamaDto>($"""
                    SELECT
                        "Id",
                        COALESCE("TamamlamaOncekiDurum",'Makyajda') AS "OncekiDurum"
                    FROM "Siparisler"
                    WHERE "Id"={id}
                    """)
                .FirstOrDefaultAsync();

            if (row == null)
                return NotFound("İş bulunamadı.");

            var geri = GecerliDurumlar.Contains(row.OncekiDurum) &&
                       row.OncekiDurum != "Tamamlandı" &&
                       row.OncekiDurum != "Tamamlama Onayı"
                ? row.OncekiDurum
                : "Makyajda";

            // Yalnız gerçekten "Tamamlama Onayı" bekleyen iş geri çevrilebilir.
            // Önceden kontrol yoktu: eski bir ekrandan (veya çift tıklamayla) gelen
            // ret isteği, zaten onaylanmış "Tamamlandı" bir işi Makyajda'ya geri
            // alıyor ve iş ciroya/cariye girmekten çıkıyordu.
            var guncellenen = await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE "Siparisler"
                SET
                    "Durum"={geri},
                    "TamamlamaOncekiDurum"=NULL,
                    "TamamlamaTalepTarihi"=NULL
                WHERE "Id"={id}
                  AND "Durum"='Tamamlama Onayı'
                """);

            if (guncellenen == 0)
                return BadRequest("İş tamamlama onayı beklemiyor.");

            await DurumGecmisiEkle(
                id,
                "Tamamlama Onayı",
                geri,
                "Admin biten iş onayını reddetti.");

            return Ok();
        }

        [HttpPatch("isler/{id:int}/sil")]
        public async Task<IActionResult> Sil(int id)
        {
            var count = await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE "Siparisler"
                SET
                    "Silindi"=true,
                    "SilinmeTarihi"={DateTime.UtcNow}
                WHERE "Id"={id}
                """);

            return count == 0 ? NotFound("İş bulunamadı.") : Ok();
        }

        [HttpPatch("isler/{id:int}/geri-al")]
        public async Task<IActionResult> GeriAl(int id)
        {
            var count = await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE "Siparisler"
                SET
                    "Silindi"=false,
                    "SilinmeTarihi"=NULL,
                    "OnayDurumu"=
                        CASE
                            WHEN "OnayDurumu"='Reddedildi' THEN 'Gelen Onay'
                            ELSE "OnayDurumu"
                        END
                WHERE "Id"={id}
                """);

            return count == 0 ? NotFound("İş bulunamadı.") : Ok();
        }

        [HttpDelete("isler/{id:int}/kalici")]
        public async Task<IActionResult> KaliciSil(int id)
        {
            var silindi = await _db.Database
                .SqlQuery<bool>($"""
                    SELECT COALESCE("Silindi",false) AS "Value"
                    FROM "Siparisler"
                    WHERE "Id"={id}
                    """)
                .FirstOrDefaultAsync();

            if (!silindi)
                return BadRequest("Kalıcı silme yalnızca Silinenler'deki kayıtlar için yapılabilir.");

            // Retry stratejisi açıkken işlem strateji içinde çalışmalıdır.
            var strategy = _db.Database.CreateExecutionStrategy();
            var bulunamadi = false;
            await strategy.ExecuteAsync(async () =>
            {
            _db.ChangeTracker.Clear();
            bulunamadi = false;
            await using var tx = await _db.Database.BeginTransactionAsync();
            try
            {
                await _db.Database.ExecuteSqlInterpolatedAsync($"""
                    DELETE FROM "IsDosyalari" WHERE "SiparisId"={id}
                    """);
                await _db.Database.ExecuteSqlInterpolatedAsync($"""
                    DELETE FROM "IsMesajlari" WHERE "SiparisId"={id}
                    """);
                await _db.Database.ExecuteSqlInterpolatedAsync($"""
                    DELETE FROM "SiparisDurumGecmisi" WHERE "SiparisId"={id}
                    """);

                var siparis = await _db.Siparisler
                    .Include(x => x.Kalemler)
                    .FirstOrDefaultAsync(x => x.Id == id);
                if (siparis == null)
                {
                    await tx.RollbackAsync();
                    bulunamadi = true;
                    return;
                }

                _db.Siparisler.Remove(siparis);
                await _db.SaveChangesAsync();
                await tx.CommitAsync();
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }
            });

            if (bulunamadi)
                return NotFound("İş bulunamadı.");

            try
            {
                var folder = Path.Combine(
                    _environment.ContentRootPath,
                    "App_Data",
                    "IsDosyalari",
                    id.ToString());
                if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
            }
            catch
            {
                // Veritabanı kalıcı silmesi başarılıysa fiziksel artık dosya sonraki bakımda temizlenebilir.
            }

            return NoContent();
        }

        [HttpGet("mesajlar/{siparisId:int}")]
        public async Task<IActionResult> Mesajlar(int siparisId)
        {
            var rows = await _db.Database
                .SqlQuery<MesajDto>($"""
                    SELECT
                        "Id",
                        "SiparisId",
                        "GonderenTipi",
                        "GonderenAdi",
                        "Mesaj",
                        "Tarih"
                    FROM "IsMesajlari"
                    WHERE "SiparisId"={siparisId}
                    ORDER BY "Tarih","Id"
                    """)
                .ToListAsync();

            return Ok(rows);
        }

        [HttpPost("mesajlar/{siparisId:int}")]
        public async Task<IActionResult> MesajGonder(
            int siparisId,
            [FromBody] MesajKaydetDto dto)
        {
            if (string.IsNullOrWhiteSpace(dto.Mesaj))
                return BadRequest("Mesaj boş olamaz.");

            if (dto.Mesaj.Trim().Length > 4000)
                return BadRequest("Mesaj en fazla 4000 karakter olabilir.");

            var exists = await _db.Siparisler
                .AsNoTracking()
                .AnyAsync(x => x.Id == siparisId);

            if (!exists)
                return NotFound("İş bulunamadı.");

            var tip = Normalize(dto.GonderenTipi, 40) ?? "Laboratuvar";
            var ad = Normalize(dto.GonderenAdi, 150);
            var mesaj = dto.Mesaj.Trim();

            await _db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO "IsMesajlari"
                ("SiparisId","GonderenTipi","GonderenAdi","Mesaj","Tarih")
                VALUES
                ({siparisId},{tip},{ad},{mesaj},{DateTime.UtcNow})
                """);

            return Ok();
        }

        [HttpGet("giderler")]
        public async Task<IActionResult> Giderler()
        {
            var rows = await _db.Database
                .SqlQuery<GiderDto>($"""
                    SELECT
                        "Id",
                        "Tarih",
                        "Kategori",
                        "Aciklama",
                        "Tutar",
                        "OlusturmaTarihi"
                    FROM "Giderler"
                    ORDER BY "Tarih" DESC, "Id" DESC
                    """)
                .ToListAsync();

            return Ok(rows);
        }

        [HttpPost("giderler")]
        public async Task<IActionResult> GiderEkle(
            [FromBody] GiderKaydetDto dto)
        {
            if (dto.Tutar <= 0)
                return BadRequest("Tutar 0'dan büyük olmalıdır.");

            var tarih = NormalizeDate(dto.Tarih) ?? DateTime.UtcNow;
            var kategori = Normalize(dto.Kategori, 100) ?? "Diğer";
            var aciklama = Normalize(dto.Aciklama, 500);

            await _db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO "Giderler"
                ("Tarih","Kategori","Aciklama","Tutar","OlusturmaTarihi")
                VALUES
                ({tarih},{kategori},{aciklama},{dto.Tutar},{DateTime.UtcNow})
                """);

            return Ok();
        }

        [HttpDelete("giderler/{id:int}")]
        public async Task<IActionResult> GiderSil(int id)
        {
            var count = await _db.Database.ExecuteSqlInterpolatedAsync($"""
                DELETE FROM "Giderler" WHERE "Id"={id}
                """);

            return count == 0 ? NotFound() : NoContent();
        }

        [HttpGet("aylik-rapor")]
        public async Task<IActionResult> AylikRapor([FromQuery] string ay)
        {
            if (string.IsNullOrWhiteSpace(ay) ||
                !DateTime.TryParseExact(
                    ay + "-01",
                    "yyyy-MM-dd",
                    System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None,
                    out var localStart))
            {
                return BadRequest("Ay yyyy-MM formatında olmalı.");
            }

            var start = DateTime.SpecifyKind(localStart, DateTimeKind.Utc);
            var end = start.AddMonths(1);

            var tamamlananDoviz = await _db.Database
                .SqlQuery<CurrencyTotalDto>($"""
                    SELECT
                        COALESCE(s."ParaBirimi",'TRY') AS "ParaBirimi",
                        COALESCE(SUM(k."Adet" * k."BirimFiyat"),0)::numeric AS "Tutar"
                    FROM "SiparisKalemleri" k
                    INNER JOIN "Siparisler" s ON s."Id"=k."SiparisId"
                    INNER JOIN
                    (
                        -- İşin EN SON tamamlanma tarihi bu aya düşmeli. Böylece
                        -- tamamlanıp geri alınan ve sonraki ay tekrar tamamlanan
                        -- iş iki ayda birden sayılmaz.
                        SELECT "SiparisId"
                        FROM "SiparisDurumGecmisi"
                        WHERE "YeniDurum" IN ('Tamamlandı','Teslim')
                        GROUP BY "SiparisId"
                        HAVING MAX("DegisimTarihi")>={start}
                           AND MAX("DegisimTarihi")<{end}
                    ) d ON d."SiparisId"=s."Id"
                    WHERE COALESCE(s."Silindi",false)=false
                      AND s."Durum" IN ('Tamamlandı','Teslim')
                    GROUP BY COALESCE(s."ParaBirimi",'TRY')
                    ORDER BY "ParaBirimi"
                    """)
                .ToListAsync();

            decimal Total(string currency) =>
                tamamlananDoviz
                    .Where(x => x.ParaBirimi == currency)
                    .Sum(x => x.Tutar);

            var tamamlananIsTutari = Total("TRY");
            // Tahsilatlar para birimine göre ayrılır. Önceden TRY, EUR ve USD
            // tutarları tek sayı olarak toplanıp TL gibi gösteriliyordu
            // (ör. 1000 TL + 100 EUR = "1100 TL"); Net Nakit de buna göre yanlıştı.
            var tahsilatDoviz = await _db.Database
                .SqlQuery<CurrencyTotalDto>($"""
                    SELECT
                        COALESCE(NULLIF(BTRIM("ParaBirimi"),''),'TRY') AS "ParaBirimi",
                        COALESCE(SUM("Tutar"),0)::numeric AS "Tutar"
                    FROM "Tahsilatlar"
                    WHERE "Tarih">={start} AND "Tarih"<{end}
                    GROUP BY COALESCE(NULLIF(BTRIM("ParaBirimi"),''),'TRY')
                    """)
                .ToListAsync();

            decimal TahsilatToplam(string currency) =>
                tahsilatDoviz
                    .Where(x => string.Equals(x.ParaBirimi, currency, StringComparison.OrdinalIgnoreCase))
                    .Sum(x => x.Tutar);

            var tahsilat = new DecimalScalarDto { Value = TahsilatToplam("TRY") };

            var gider = await _db.Database
                .SqlQuery<DecimalScalarDto>($"""
                    SELECT COALESCE(SUM("Tutar"),0) AS "Value"
                    FROM "Giderler"
                    WHERE "Tarih">={start} AND "Tarih"<{end}
                    """)
                .FirstAsync();

            return Ok(new
            {
                Ay = ay,
                TamamlananIsTutari = tamamlananIsTutari,
                TamamlananEur = Total("EUR"),
                TamamlananUsd = Total("USD"),
                TamamlananDoviz = tamamlananDoviz,
                Tahsilat = tahsilat.Value,
                TahsilatEur = TahsilatToplam("EUR"),
                TahsilatUsd = TahsilatToplam("USD"),
                Gider = gider.Value,
                NetNakit = tahsilat.Value - gider.Value
            });
        }

        [HttpGet("mail")]
        public async Task<IActionResult> Mail()
        {
            var rows = await _db.Database
                .SqlQuery<MailDto>($"""
                    SELECT
                        "Id","Tarih","Gonderen","Konu",
                        "HekimId","HastaAdi","IsTuru",
                        "DisRengi","Materyal","Notlar","Aktarildi"
                    FROM "MailGelenler"
                    ORDER BY "Tarih" DESC, "Id" DESC
                    """)
                .ToListAsync();

            return Ok(rows);
        }

        [HttpPost("mail/import")]
        public async Task<IActionResult> MailImport(
            [FromBody] MailImportDto dto)
        {
            var expected = _config["Integration:MailImportKey"];

            if (string.IsNullOrWhiteSpace(expected))
            {
                return StatusCode(
                    503,
                    "MailImportKey sunucu User Secrets içinde tanımlı değil.");
            }

            var supplied = Request.Headers["X-Integration-Key"].FirstOrDefault();

            if (!string.Equals(expected, supplied, StringComparison.Ordinal))
                return Unauthorized("Geçersiz entegrasyon anahtarı.");

            await _db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO "MailGelenler"
                (
                    "Tarih","Gonderen","Konu","Gövde",
                    "HekimId","HastaAdi","IsTuru","DisRengi",
                    "Materyal","Notlar","Aktarildi"
                )
                VALUES
                (
                    {dto.Tarih ?? DateTime.UtcNow},
                    {Normalize(dto.Gonderen,300)},
                    {Normalize(dto.Konu,500)},
                    {dto.Govde},
                    {dto.HekimId},
                    {Normalize(dto.HastaAdi,150)},
                    {Normalize(dto.IsTuru,200)},
                    {Normalize(dto.DisRengi,50)},
                    {Normalize(dto.Materyal,120)},
                    {dto.Notlar},
                    false
                )
                """);

            return Ok();
        }

        private static string? NormalizeCurrency(string? value)
        {
            var currency = string.IsNullOrWhiteSpace(value)
                ? "TRY"
                : value.Trim().ToUpperInvariant();
            return currency is "TRY" or "EUR" or "USD" ? currency : null;
        }

        private static string? Normalize(string? value, int max)
        {
            if (string.IsNullOrWhiteSpace(value))
                return null;

            var v = value.Trim();
            return v.Length <= max ? v : v[..max];
        }
    }

    public class OlusturulanSiparisDto
    {
        public int Id { get; set; }
        public string Durum { get; set; } = "Bekliyor";
        public string OnayDurumu { get; set; } = "Gelen Onay";
        public string ParaBirimi { get; set; } = "TRY";
        public int KalemSayisi { get; set; }
    }

    public class AnayasaSiparisDto
    {
        public int HekimId { get; set; }
        public string HastaAdi { get; set; } = string.Empty;
        public DateTime? TerminTarihi { get; set; }
        public string? DisRengi { get; set; }
        public string? DisSemasi { get; set; }
        public string? Materyal { get; set; }
        public string? ParaBirimi { get; set; } = "TRY";
        public string? Notlar { get; set; }
        public string? Kaynak { get; set; }
        public int? AktarilanSiparisId { get; set; }
        public List<AnayasaKalemDto> Kalemler { get; set; } = new();
    }

    public class AnayasaKalemDto
    {
        public string IsTuru { get; set; } = string.Empty;
        public int Adet { get; set; } = 1;
        public decimal BirimFiyat { get; set; }
        public string? ParaBirimi { get; set; } = "TRY";
    }

    public class AnayasaDurumDto
    {
        public string Durum { get; set; } = string.Empty;
    }

    public class AnayasaIsMetaDto
    {
        public int SiparisId { get; set; }
        public string OnayDurumu { get; set; } = "Onaylandı";
        public string Kaynak { get; set; } = "Eski Sistem";
        public DateTime? TerminTarihi { get; set; }
        public string? DisRengi { get; set; }
        public string? DisSemasi { get; set; }
        public string? Materyal { get; set; }
        public string ParaBirimi { get; set; } = "TRY";
        public bool Silindi { get; set; }
        public DateTime? SilinmeTarihi { get; set; }
        public string? TamamlamaOncekiDurum { get; set; }
        public DateTime? TamamlamaTalepTarihi { get; set; }
        public bool TasarimIndirildi { get; set; }
        public DateTime? TasarimIndirmeTarihi { get; set; }
        public int DosyaSayisi { get; set; }
        public int TaramaDosyaSayisi { get; set; }
        public int TasarimDosyaSayisi { get; set; }
    }

    public class AnayasaAktarimGuardDto
    {
        public string Kaynak { get; set; } = string.Empty;
        public bool Silindi { get; set; }
    }

    public class AnayasaDurumGuardDto
    {
        public string OnayDurumu { get; set; } = "Onaylandı";
        public bool Silindi { get; set; }
    }

    public class TamamlamaDto
    {
        public int Id { get; set; }
        public string OncekiDurum { get; set; } = "Makyajda";
    }

    public class MesajDto
    {
        public int Id { get; set; }
        public int SiparisId { get; set; }
        public string GonderenTipi { get; set; } = string.Empty;
        public string? GonderenAdi { get; set; }
        public string Mesaj { get; set; } = string.Empty;
        public DateTime Tarih { get; set; }
    }

    public class MesajKaydetDto
    {
        public string? GonderenTipi { get; set; }
        public string? GonderenAdi { get; set; }
        public string Mesaj { get; set; } = string.Empty;
    }

    public class GiderDto
    {
        public int Id { get; set; }
        public DateTime Tarih { get; set; }
        public string Kategori { get; set; } = string.Empty;
        public string? Aciklama { get; set; }
        public decimal Tutar { get; set; }
        public DateTime OlusturmaTarihi { get; set; }
    }

    public class GiderKaydetDto
    {
        public DateTime? Tarih { get; set; }
        public string? Kategori { get; set; }
        public string? Aciklama { get; set; }
        public decimal Tutar { get; set; }
    }

    public class CurrencyTotalDto
    {
        public string ParaBirimi { get; set; } = "TRY";
        public decimal Tutar { get; set; }
    }

    public class DecimalScalarDto
    {
        public decimal Value { get; set; }
    }

    public class MailDto
    {
        public int Id { get; set; }
        public DateTime Tarih { get; set; }
        public string? Gonderen { get; set; }
        public string? Konu { get; set; }
        public int? HekimId { get; set; }
        public string? HastaAdi { get; set; }
        public string? IsTuru { get; set; }
        public string? DisRengi { get; set; }
        public string? Materyal { get; set; }
        public string? Notlar { get; set; }
        public bool Aktarildi { get; set; }
    }

    public class MailImportDto
    {
        public DateTime? Tarih { get; set; }
        public string? Gonderen { get; set; }
        public string? Konu { get; set; }
        public string? Govde { get; set; }
        public int? HekimId { get; set; }
        public string? HastaAdi { get; set; }
        public string? IsTuru { get; set; }
        public string? DisRengi { get; set; }
        public string? Materyal { get; set; }
        public string? Notlar { get; set; }
    }
}
