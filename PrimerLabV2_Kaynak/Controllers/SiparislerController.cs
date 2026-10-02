using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;
using PrimerLabV2.Models;

namespace PrimerLabV2.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class SiparislerController : ControllerBase
    {
        private readonly PrimerLabDbContext _db;

        public SiparislerController(PrimerLabDbContext db)
        {
            _db = db;
        }

        private static DateTime? NormalizeTerminUtc(
            DateTime? value)
        {
            if (!value.HasValue)
            {
                return null;
            }

            var dateOnly =
                value.Value.Date;

            return DateTime.SpecifyKind(
                dateOnly,
                DateTimeKind.Utc
            );
        }

        private static string NormalizeCurrency(string? value)
        {
            var currency = (value ?? "TRY").Trim().ToUpperInvariant();

            return currency is "TRY" or "EUR" or "USD"
                ? currency
                : "TRY";
        }

        // =========================================================
        // TÜM İŞLERİ LİSTELE
        // =========================================================

        [HttpGet]
        public async Task<IActionResult> GetSiparisler()
        {
            var silinenIds = await _db.Database
                .SqlQuery<int>($"""
                    SELECT "Id" AS "Value"
                    FROM "Siparisler"
                    WHERE COALESCE("Silindi", FALSE) = TRUE
                    """)
                .ToListAsync();

            var silinenSet = silinenIds.ToHashSet();

            var siparisler = await _db.Siparisler
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

            siparisler = siparisler
                .Where(s => !silinenSet.Contains(s.Id))
                .ToList();

            var paraBirimiKayitlari = await _db.Database
                .SqlQuery<SiparisParaBirimiDto>($"""
                    SELECT
                        "Id" AS "SiparisId",
                        COALESCE(NULLIF(BTRIM("ParaBirimi"), ''), 'TRY') AS "ParaBirimi"
                    FROM "Siparisler"
                    """)
                .ToListAsync();

            var paraBirimiMap = paraBirimiKayitlari.ToDictionary(
                x => x.SiparisId,
                x => NormalizeCurrency(x.ParaBirimi)
            );

            var terminKayitlari = await _db.Database
                .SqlQuery<SiparisTerminTarihiDto>($"""
                    SELECT "Id" AS "SiparisId", "TerminTarihi"
                    FROM "Siparisler"
                    WHERE "TerminTarihi" IS NOT NULL
                    """)
                .ToListAsync();

            var terminMap = terminKayitlari.ToDictionary(
                x => x.SiparisId,
                x => (DateTime?)x.TerminTarihi
            );

            var disRengiKayitlari = await _db.Database
                .SqlQuery<SiparisDisRengiDto>($"""
                    SELECT "Id" AS "SiparisId", "DisRengi"
                    FROM "Siparisler"
                    WHERE "DisRengi" IS NOT NULL
                      AND BTRIM("DisRengi") <> ''
                    """)
                .ToListAsync();

            var disRengiMap = disRengiKayitlari.ToDictionary(
                x => x.SiparisId,
                x => x.DisRengi
            );

            var operasyonBilgileri = await _db.Database
                .SqlQuery<SiparisOperasyonBilgisiDto>($"""
                    SELECT
                        "Id" AS "SiparisId",
                        COALESCE("Oncelik", 'Normal') AS "Oncelik",
                        "UretimNotu",
                        COALESCE("UretimAsamasi", 'Bekliyor') AS "UretimAsamasi",
                        COALESCE("KaliteKontrolDurumu", 'Bekliyor') AS "KaliteKontrolDurumu",
                        "KaliteKontrolNotu",
                        "KaliteKontrolTarihi"
                    FROM "Siparisler"
                    """)
                .ToListAsync();

            var operasyonMap = operasyonBilgileri.ToDictionary(
                x => x.SiparisId,
                x => x
            );

            var teslimKayitlari = await _db.Database
                .SqlQuery<SiparisTeslimTarihiDto>($"""
                    SELECT
                        "SiparisId",
                        MAX("DegisimTarihi") AS "TeslimTarihi"
                    FROM "SiparisDurumGecmisi"
                    WHERE "YeniDurum" IN ('Teslim','Tamamlandı')
                    GROUP BY "SiparisId"
                    """)
                .ToListAsync();

            var teslimMap = teslimKayitlari.ToDictionary(
                x => x.SiparisId,
                x => (DateTime?)x.TeslimTarihi
            );

            return Ok(siparisler.Select(s => new
            {
                s.Id,
                s.HastaId,
                s.HastaAdi,
                s.HekimId,
                s.HekimAdi,
                s.KlinikAdi,
                s.Durum,
                s.OlusturmaTarihi,
                TerminTarihi = terminMap.TryGetValue(s.Id, out var termin)
                    ? termin
                    : null,
                DisRengi = disRengiMap.TryGetValue(s.Id, out var disRengi)
                    ? disRengi
                    : null,
                Oncelik = operasyonMap.TryGetValue(s.Id, out var op1)
                    ? op1.Oncelik
                    : "Normal",
                UretimNotu = operasyonMap.TryGetValue(s.Id, out var op2)
                    ? op2.UretimNotu
                    : null,
                UretimAsamasi = operasyonMap.TryGetValue(s.Id, out var op3)
                    ? op3.UretimAsamasi
                    : "Bekliyor",
                KaliteKontrolDurumu = operasyonMap.TryGetValue(s.Id, out var op4)
                    ? op4.KaliteKontrolDurumu
                    : "Bekliyor",
                KaliteKontrolNotu = operasyonMap.TryGetValue(s.Id, out var op5)
                    ? op5.KaliteKontrolNotu
                    : null,
                KaliteKontrolTarihi = operasyonMap.TryGetValue(s.Id, out var op6)
                    ? op6.KaliteKontrolTarihi
                    : null,
                TeslimTarihi = teslimMap.TryGetValue(s.Id, out var tarih)
                    ? tarih
                    : null,
                ParaBirimi = paraBirimiMap.TryGetValue(s.Id, out var paraBirimi)
                    ? paraBirimi
                    : "TRY",
                s.ToplamAdet,
                s.ToplamTutar,
                s.Kalemler
            }));
        }


        // =========================================================
        // TEK İŞİ GETİR
        // =========================================================

        [HttpGet("{id:int}")]
        public async Task<IActionResult> GetSiparis(int id)
        {
            var siparis = await _db.Siparisler
                .AsNoTracking()
                .Where(s => s.Id == id)
                .Select(s => new
                {
                    s.Id,
                    s.HastaId,
                    HastaAdi = s.Hasta.AdSoyad,
                    HekimId = s.Hasta.HekimId,
                    HekimAdi = s.Hasta.Hekim != null ? s.Hasta.Hekim.AdSoyad : "",
                    KlinikAdi = s.Hasta.Hekim != null ? s.Hasta.Hekim.KlinikAdi : "",
                    s.Durum,
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
                .FirstOrDefaultAsync();

            if (siparis == null)
            {
                return NotFound("İş bulunamadı.");
            }

            var gecmis = await _db.Database
                .SqlQuery<SiparisDurumGecmisiDto>($"""
                    SELECT
                        "Id",
                        "SiparisId",
                        "EskiDurum",
                        "YeniDurum",
                        "DegisimTarihi",
                        "Aciklama"
                    FROM "SiparisDurumGecmisi"
                    WHERE "SiparisId" = {id}
                    ORDER BY "DegisimTarihi" DESC, "Id" DESC
                    """)
                .ToListAsync();

            var teslimTarihi = gecmis
                .Where(x => x.YeniDurum == "Teslim" || x.YeniDurum == "Tamamlandı")
                .OrderByDescending(x => x.DegisimTarihi)
                .Select(x => (DateTime?)x.DegisimTarihi)
                .FirstOrDefault();

            var terminTarihi = await _db.Database
                .SqlQuery<DateTime?>($"""
                    SELECT "TerminTarihi" AS "Value"
                    FROM "Siparisler"
                    WHERE "Id" = {id}
                    """)
                .FirstOrDefaultAsync();

            var disRengi = await _db.Database
                .SqlQuery<string?>($"""
                    SELECT "DisRengi" AS "Value"
                    FROM "Siparisler"
                    WHERE "Id" = {id}
                    """)
                .FirstOrDefaultAsync();

            var paraBirimi = await _db.Database
                .SqlQuery<string?>($"""
                    SELECT COALESCE(NULLIF(BTRIM("ParaBirimi"), ''), 'TRY') AS "Value"
                    FROM "Siparisler"
                    WHERE "Id" = {id}
                    """)
                .FirstOrDefaultAsync();

            var operasyonBilgisi = await _db.Database
                .SqlQuery<SiparisOperasyonBilgisiDto>($"""
                    SELECT
                        "Id" AS "SiparisId",
                        COALESCE("Oncelik", 'Normal') AS "Oncelik",
                        "UretimNotu",
                        COALESCE("UretimAsamasi", 'Bekliyor') AS "UretimAsamasi",
                        COALESCE("KaliteKontrolDurumu", 'Bekliyor') AS "KaliteKontrolDurumu",
                        "KaliteKontrolNotu",
                        "KaliteKontrolTarihi"
                    FROM "Siparisler"
                    WHERE "Id" = {id}
                    """)
                .FirstOrDefaultAsync();

            return Ok(new
            {
                siparis.Id,
                siparis.HastaId,
                siparis.HastaAdi,
                siparis.HekimId,
                siparis.HekimAdi,
                siparis.KlinikAdi,
                siparis.Durum,
                siparis.OlusturmaTarihi,
                TerminTarihi = terminTarihi,
                DisRengi = disRengi,
                Oncelik = operasyonBilgisi?.Oncelik ?? "Normal",
                UretimNotu = operasyonBilgisi?.UretimNotu,
                UretimAsamasi = operasyonBilgisi?.UretimAsamasi ?? "Bekliyor",
                KaliteKontrolDurumu = operasyonBilgisi?.KaliteKontrolDurumu ?? "Bekliyor",
                KaliteKontrolNotu = operasyonBilgisi?.KaliteKontrolNotu,
                KaliteKontrolTarihi = operasyonBilgisi?.KaliteKontrolTarihi,
                TeslimTarihi = teslimTarihi,
                ParaBirimi = NormalizeCurrency(paraBirimi),
                siparis.ToplamAdet,
                siparis.ToplamTutar,
                siparis.Kalemler,
                DurumGecmisi = gecmis
            });
        }


        // =========================================================
        // ESKİ SİSTEM - SİPARİŞ OLUŞTUR
        // =========================================================

        [HttpPost]
        public async Task<IActionResult> CreateSiparis(
            [FromBody] SiparisOlusturDto dto)
        {
            if (dto.HastaId <= 0)
            {
                return BadRequest(
                    "Geçerli bir hasta seçilmelidir."
                );
            }

            if (dto.Kalemler == null ||
                dto.Kalemler.Count == 0)
            {
                return BadRequest(
                    "En az bir iş kalemi gereklidir."
                );
            }

            var hastaVar = await _db.Hastalar
                .AnyAsync(h =>
                    h.Id == dto.HastaId &&
                    h.Aktif
                );

            if (!hastaVar)
            {
                return BadRequest(
                    "Hasta bulunamadı veya pasif."
                );
            }

            foreach (var kalem in dto.Kalemler)
            {
                if (string.IsNullOrWhiteSpace(kalem.IsTuru))
                    return BadRequest("İş türü boş olamaz.");
                if (kalem.Adet <= 0)
                    return BadRequest("Adet en az 1 olmalıdır.");
                if (kalem.BirimFiyat < 0)
                    return BadRequest("Birim fiyat negatif olamaz.");
            }

            var requestedStatus = string.IsNullOrWhiteSpace(dto.Durum)
                ? "Bekliyor"
                : NormalizeConstitutionalStatus(dto.Durum);

            if (requestedStatus == null || requestedStatus == "Tamamlandı")
                return BadRequest("Geçersiz başlangıç durumu.");

            var siparis = new Siparis
            {
                HastaId = dto.HastaId,

                Durum = requestedStatus,

                OlusturmaTarihi =
                    DateTime.UtcNow,

                Kalemler =
                    dto.Kalemler
                        .Select(k =>
                            new SiparisKalemi
                            {
                                IsTuru =
                                    k.IsTuru.Trim(),

                                Adet =
                                    k.Adet,

                                BirimFiyat =
                                    k.BirimFiyat
                            })
                        .ToList()
            };

            _db.Siparisler.Add(siparis);

            await _db.SaveChangesAsync();

            await DurumGecmisiEkle(
                siparis.Id,
                null,
                siparis.Durum,
                "İş oluşturuldu."
            );

            return CreatedAtAction(
                nameof(GetSiparis),
                new { id = siparis.Id },
                new
                {
                    siparis.Id,
                    siparis.HastaId,
                    siparis.Durum,
                    siparis.OlusturmaTarihi
                }
            );
        }


        // =========================================================
        // YENİ LABORATUVAR İŞİ OLUŞTUR
        //
        // Hasta ayrı modül değildir.
        // Kullanıcı iş açarken hasta adını yazar.
        // Sistem hasta kaydını arka planda oluşturur.
        // =========================================================

        [HttpPost("yeni-is")]
        public async Task<IActionResult> YeniIsOlustur(
            [FromBody] YeniIsOlusturDto dto)
        {
            if (dto.HekimId <= 0)
            {
                return BadRequest(
                    "Hekim seçilmelidir."
                );
            }

            if (string.IsNullOrWhiteSpace(dto.HastaAdi))
            {
                return BadRequest(
                    "Hasta adı boş bırakılamaz."
                );
            }

            if (string.IsNullOrWhiteSpace(dto.IsTuru))
            {
                return BadRequest(
                    "İş türü seçilmelidir."
                );
            }

            if (dto.Adet <= 0)
            {
                return BadRequest(
                    "Adet en az 1 olmalıdır."
                );
            }

            if (dto.BirimFiyat < 0)
            {
                return BadRequest(
                    "Birim fiyat geçersiz."
                );
            }


            var hekim = await _db.Hekimler
                .FirstOrDefaultAsync(h =>
                    h.Id == dto.HekimId &&
                    h.Aktif
                );

            if (hekim == null)
            {
                return BadRequest(
                    "Seçilen hekim bulunamadı."
                );
            }


            await using var transaction =
                await _db.Database
                    .BeginTransactionAsync();

            try
            {
                // Hasta sadece işin iç bilgisi olarak tutuluyor.
                var hasta = new Hasta
                {
                    AdSoyad =
                        dto.HastaAdi.Trim(),

                    HekimId =
                        dto.HekimId,

                    Telefon =
                        null,

                    Notlar =
                        string.IsNullOrWhiteSpace(dto.Notlar)
                            ? null
                            : dto.Notlar.Trim(),

                    Aktif =
                        true,

                    OlusturmaTarihi =
                        DateTime.UtcNow
                };


                _db.Hastalar.Add(hasta);

                await _db.SaveChangesAsync();


                var siparis = new Siparis
                {
                    HastaId =
                        hasta.Id,

                    Durum =
                        "Bekliyor",

                    OlusturmaTarihi =
                        DateTime.UtcNow,

                    Kalemler =
                        new List<SiparisKalemi>
                        {
                            new SiparisKalemi
                            {
                                IsTuru =
                                    dto.IsTuru.Trim(),

                                Adet =
                                    dto.Adet,

                                BirimFiyat =
                                    dto.BirimFiyat
                            }
                        }
                };


                _db.Siparisler.Add(siparis);

                await _db.SaveChangesAsync();

                await DurumGecmisiEkle(
                    siparis.Id,
                    null,
                    siparis.Durum,
                    "İş oluşturuldu."
                );

                await transaction.CommitAsync();


                return CreatedAtAction(
                    nameof(GetSiparis),

                    new
                    {
                        id = siparis.Id
                    },

                    new
                    {
                        siparis.Id,

                        IsNo =
                            siparis.Id,

                        HekimId =
                            hekim.Id,

                        HekimAdi =
                            hekim.AdSoyad,

                        KlinikAdi =
                            hekim.KlinikAdi,

                        HastaAdi =
                            hasta.AdSoyad,

                        IsTuru =
                            dto.IsTuru,

                        dto.Adet,
                        dto.BirimFiyat,

                        ToplamTutar =
                            dto.Adet *
                            dto.BirimFiyat,

                        Durum =
                            siparis.Durum,

                        dto.Renk,
                        dto.TeslimTarihi,
                        dto.Notlar
                    }
                );
            }
            catch
            {
                await transaction.RollbackAsync();

                return StatusCode(
                    500,
                    "İş kaydedilirken hata oluştu."
                );
            }
        }



        // =========================================================
        // YENİ LABORATUVAR İŞİ OLUŞTUR - ÇOKLU İŞ KALEMİ
        //
        // Bir hekim seçilir ve o hekime ait fiyat listesinden
        // bir veya birden fazla iş aynı siparişe eklenebilir.
        // Fiyat, sipariş oluşturulduğu anda SiparisKalemi'ne yazılır.
        // Böylece hekimin fiyatı sonradan değişse bile eski işlerin
        // fiyatı değişmez.
        // =========================================================

        [HttpPost("yeni-is-coklu")]
        public async Task<IActionResult> YeniCokluIsOlustur(
            [FromBody] YeniCokluIsOlusturDto dto)
        {
            if (dto.HekimId <= 0)
            {
                return BadRequest("Hekim seçilmelidir.");
            }

            if (string.IsNullOrWhiteSpace(dto.HastaAdi))
            {
                return BadRequest("Hasta adı boş bırakılamaz.");
            }

            if (dto.Kalemler == null || dto.Kalemler.Count == 0)
            {
                return BadRequest("En az bir iş kalemi eklenmelidir.");
            }

            foreach (var kalem in dto.Kalemler)
            {
                if (string.IsNullOrWhiteSpace(kalem.IsTuru))
                {
                    return BadRequest("İş türü boş bırakılamaz.");
                }

                if (kalem.Adet <= 0)
                {
                    return BadRequest(
                        $"{kalem.IsTuru} için adet en az 1 olmalıdır."
                    );
                }

                if (kalem.BirimFiyat < 0)
                {
                    return BadRequest(
                        $"{kalem.IsTuru} için birim fiyat geçersiz."
                    );
                }
            }

            var hekim = await _db.Hekimler
                .FirstOrDefaultAsync(h =>
                    h.Id == dto.HekimId &&
                    h.Aktif
                );

            if (hekim == null)
            {
                return BadRequest(
                    "Seçilen hekim bulunamadı veya pasif."
                );
            }

            var terminTarihiUtc =
                NormalizeTerminUtc(
                    dto.TerminTarihi
                );

            await using var transaction =
                await _db.Database.BeginTransactionAsync();

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
                await _db.SaveChangesAsync();

                var siparis = new Siparis
                {
                    HastaId = hasta.Id,
                    Durum = "Bekliyor",
                    OlusturmaTarihi = DateTime.UtcNow,
                    Kalemler = dto.Kalemler
                        .Select(k => new SiparisKalemi
                        {
                            IsTuru = k.IsTuru.Trim(),
                            Adet = k.Adet,
                            BirimFiyat = k.BirimFiyat
                        })
                        .ToList()
                };

                _db.Siparisler.Add(siparis);
                await _db.SaveChangesAsync();

                var disRengi =
                    string.IsNullOrWhiteSpace(dto.DisRengi)
                        ? null
                        : dto.DisRengi.Trim();

                var oncelik = NormalizeOncelik(dto.Oncelik);

                var uretimNotu =
                    string.IsNullOrWhiteSpace(dto.UretimNotu)
                        ? null
                        : dto.UretimNotu.Trim();

                await _db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE "Siparisler"
                    SET
                        "TerminTarihi" = {terminTarihiUtc},
                        "DisRengi" = {disRengi},
                        "Oncelik" = {oncelik},
                        "UretimNotu" = {uretimNotu},
                        "UretimAsamasi" = 'Bekliyor',
                        "KaliteKontrolDurumu" = 'Bekliyor',
                        "KaliteKontrolNotu" = NULL,
                        "KaliteKontrolTarihi" = NULL
                    WHERE "Id" = {siparis.Id}
                    """);

                await DurumGecmisiEkle(
                    siparis.Id,
                    null,
                    siparis.Durum,
                    "İş oluşturuldu."
                );

                await transaction.CommitAsync();

                return CreatedAtAction(
                    nameof(GetSiparis),
                    new { id = siparis.Id },
                    new
                    {
                        siparis.Id,
                        IsNo = siparis.Id,
                        HekimId = hekim.Id,
                        HekimAdi = hekim.AdSoyad,
                        KlinikAdi = hekim.KlinikAdi,
                        HastaAdi = hasta.AdSoyad,
                        Durum = siparis.Durum,
                        TerminTarihi = terminTarihiUtc,
                        DisRengi = disRengi,
                        Oncelik = oncelik,
                        UretimNotu = uretimNotu,
                        UretimAsamasi = "Bekliyor",
                        KaliteKontrolDurumu = "Bekliyor",
                        KaliteKontrolNotu = (string?)null,
                        ToplamAdet = siparis.Kalemler.Sum(k => k.Adet),
                        ToplamTutar = siparis.Kalemler.Sum(
                            k => k.Adet * k.BirimFiyat
                        ),
                        Kalemler = siparis.Kalemler.Select(k => new
                        {
                            k.Id,
                            k.IsTuru,
                            k.Adet,
                            k.BirimFiyat,
                            Toplam = k.Adet * k.BirimFiyat
                        })
                    }
                );
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();

                var rootMessage =
                    ex.GetBaseException().Message;

                if (
                    rootMessage.Contains(
                        "timestamp with time zone",
                        StringComparison.OrdinalIgnoreCase
                    ) ||
                    rootMessage.Contains(
                        "DateTime",
                        StringComparison.OrdinalIgnoreCase
                    )
                )
                {
                    return StatusCode(
                        500,
                        "Termin tarihi kaydedilemedi. Tarih formatı sunucu ile uyumlu değildi. V21.1 bu alanı UTC olarak normalize eder."
                    );
                }

                return StatusCode(
                    500,
                    "İş kaydedilemedi. Sistem günlükleri için Request ID: " +
                    HttpContext.TraceIdentifier
                );
            }
        }


        // =========================================================
        // DURUM DEĞİŞTİR
        // =========================================================

        [HttpPatch("{id:int}/durum")]
        public async Task<IActionResult> DurumDegistir(
            int id,
            [FromBody] SiparisDurumDto dto)
        {
            var siparis = await _db.Siparisler
                .FirstOrDefaultAsync(s => s.Id == id);

            if (siparis == null) return NotFound("İş bulunamadı.");

            var yeniDurum = NormalizeConstitutionalStatus(dto.Durum);
            if (yeniDurum == null)
                return BadRequest("Geçersiz durum. Primer Lab anayasa iş akışını kullanır.");

            var eskiDurum = siparis.Durum;
            if (string.Equals(eskiDurum, yeniDurum, StringComparison.OrdinalIgnoreCase))
                return Ok(new { siparis.Id, Durum = yeniDurum });

            if (yeniDurum == "Tamamlama Onayı")
            {
                await _db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE "Siparisler"
                    SET "Durum"='Tamamlama Onayı',
                        "TamamlamaOncekiDurum"={eskiDurum},
                        "TamamlamaTalepTarihi"={DateTime.UtcNow}
                    WHERE "Id"={id}
                    """);
            }
            else
            {
                siparis.Durum = yeniDurum;
                await _db.SaveChangesAsync();

                if (yeniDurum == "Tamamlandı")
                {
                    await _db.Database.ExecuteSqlInterpolatedAsync($"""
                        UPDATE "Siparisler"
                        SET "TamamlamaOncekiDurum"=NULL,
                            "TamamlamaTalepTarihi"=NULL
                        WHERE "Id"={id}
                        """);
                }
            }

            await DurumGecmisiEkle(
                siparis.Id,
                eskiDurum,
                yeniDurum,
                yeniDurum == "Tamamlama Onayı"
                    ? "İş bitirme onayına gönderildi."
                    : "İş akışı güncellendi.");

            return Ok(new { siparis.Id, Durum = yeniDurum });
        }

        // =========================================================
        // LAB İŞİNİ DÜZENLE
        //
        // İş detay ekranından hasta adı, durum ve bütün iş kalemleri
        // güvenli şekilde tek işlemde güncellenir.
        // =========================================================

        [HttpPut("{id:int}/lab-duzenle")]
        public async Task<IActionResult> LabIsiDuzenle(
            int id,
            [FromBody] LabIsDuzenleDto dto)
        {
            if (string.IsNullOrWhiteSpace(dto.HastaAdi))
            {
                return BadRequest("Hasta adı boş bırakılamaz.");
            }

            if (dto.Kalemler == null || dto.Kalemler.Count == 0)
            {
                return BadRequest("En az bir iş kalemi gereklidir.");
            }

            foreach (var kalem in dto.Kalemler)
            {
                if (string.IsNullOrWhiteSpace(kalem.IsTuru))
                {
                    return BadRequest("İş türü boş bırakılamaz.");
                }

                if (kalem.Adet <= 0)
                {
                    return BadRequest(
                        $"{kalem.IsTuru} için adet en az 1 olmalıdır."
                    );
                }

                if (kalem.BirimFiyat < 0)
                {
                    return BadRequest(
                        $"{kalem.IsTuru} için birim fiyat geçersiz."
                    );
                }
            }

            var siparis = await _db.Siparisler
                .Include(s => s.Hasta)
                .Include(s => s.Kalemler)
                .FirstOrDefaultAsync(s => s.Id == id);

            if (siparis == null)
            {
                return NotFound("İş bulunamadı.");
            }

            if (siparis.Hasta == null)
            {
                return BadRequest("İşe bağlı hasta kaydı bulunamadı.");
            }

            var eskiDurum = siparis.Durum;

            var terminTarihiUtc =
                NormalizeTerminUtc(
                    dto.TerminTarihi
                );

            var strategy = _db.Database.CreateExecutionStrategy();

            try
            {
                return await strategy.ExecuteAsync<IActionResult>(async () =>
                {
                    await using var transaction = await _db.Database.BeginTransactionAsync();
                    try
                    {
                siparis.Hasta.AdSoyad =
                    dto.HastaAdi.Trim();

                if (!string.IsNullOrWhiteSpace(dto.Durum))
                {
                    var normalizedStatus = NormalizeConstitutionalStatus(dto.Durum);
                    if (normalizedStatus == null)
                    {
                        await transaction.RollbackAsync();
                        return BadRequest("Geçersiz durum. Primer Lab durum akışını kullanır.");
                    }
                    siparis.Durum = normalizedStatus;
                }

                var disRengi =
                    string.IsNullOrWhiteSpace(dto.DisRengi)
                        ? null
                        : dto.DisRengi.Trim();

                var oncelik = NormalizeOncelik(dto.Oncelik);

                var uretimNotu =
                    string.IsNullOrWhiteSpace(dto.UretimNotu)
                        ? null
                        : dto.UretimNotu.Trim();

                var uretimAsamasi =
                    NormalizeUretimAsamasi(dto.UretimAsamasi);

                var kaliteKontrolDurumu =
                    NormalizeKaliteDurumu(dto.KaliteKontrolDurumu);

                var kaliteKontrolNotu =
                    string.IsNullOrWhiteSpace(dto.KaliteKontrolNotu)
                        ? null
                        : dto.KaliteKontrolNotu.Trim();

                var kaliteKontrolTarihi =
                    kaliteKontrolDurumu == "Bekliyor"
                        ? (DateTime?)null
                        : DateTime.UtcNow;

                await _db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE "Siparisler"
                    SET
                        "TerminTarihi" = {terminTarihiUtc},
                        "DisRengi" = {disRengi},
                        "Oncelik" = {oncelik},
                        "UretimNotu" = {uretimNotu},
                        "UretimAsamasi" = {uretimAsamasi},
                        "KaliteKontrolDurumu" = {kaliteKontrolDurumu},
                        "KaliteKontrolNotu" = {kaliteKontrolNotu},
                        "KaliteKontrolTarihi" = {kaliteKontrolTarihi}
                    WHERE "Id" = {siparis.Id}
                    """);

                // V33.07.15: Eski DIGICAD/Primer aktarımlarında PostgreSQL sequence
                // yetkisi veya sequence sayacı tablo ile uyumsuz olabiliyor. İş kalemi
                // düzenleme sırasında EF'nin otomatik Id üretimine güvenmek 500 hatasına
                // yol açıyordu. Transaction-scoped advisory lock ile Id'leri güvenli
                // şekilde tablodaki gerçek MAX(Id) üzerinden ayırıyoruz.
                await _db.Database.ExecuteSqlRawAsync(
                    "SELECT pg_advisory_xact_lock(33071501);"
                );

                var sonrakiKalemId =
                    (await _db.SiparisKalemleri
                        .MaxAsync(k => (int?)k.Id) ?? 0) + 1;

                _db.SiparisKalemleri.RemoveRange(
                    siparis.Kalemler
                );

                var yeniKalemler = dto.Kalemler
                    .Select(k => new SiparisKalemi
                    {
                        Id = sonrakiKalemId++,
                        SiparisId = siparis.Id,
                        IsTuru = k.IsTuru.Trim(),
                        Adet = k.Adet,
                        BirimFiyat = k.BirimFiyat
                    })
                    .ToList();

                _db.SiparisKalemleri.AddRange(yeniKalemler);
                siparis.Kalemler = yeniKalemler;

                await _db.SaveChangesAsync();

                if (string.Equals(siparis.Durum, "Tamamlandı", StringComparison.OrdinalIgnoreCase))
                {
                    await _db.Database.ExecuteSqlInterpolatedAsync($"""
                        UPDATE "Siparisler"
                        SET "TamamlamaOncekiDurum"=NULL,
                            "TamamlamaTalepTarihi"=NULL
                        WHERE "Id"={siparis.Id}
                        """);
                }

                if (!string.Equals(
                    eskiDurum,
                    siparis.Durum,
                    StringComparison.OrdinalIgnoreCase))
                {
                    await DurumGecmisiEkle(
                        siparis.Id,
                        eskiDurum,
                        siparis.Durum,
                        "İş düzenleme ekranından durum değiştirildi."
                    );
                }

                await transaction.CommitAsync();

                return Ok(new
                {
                    siparis.Id,
                    HastaAdi = siparis.Hasta.AdSoyad,
                    siparis.Durum,
                    TerminTarihi = terminTarihiUtc,
                    DisRengi = disRengi,
                    Oncelik = oncelik,
                    UretimNotu = uretimNotu,
                    UretimAsamasi = uretimAsamasi,
                    KaliteKontrolDurumu = kaliteKontrolDurumu,
                    KaliteKontrolNotu = kaliteKontrolNotu,
                    KaliteKontrolTarihi = kaliteKontrolTarihi,
                    ToplamAdet = siparis.Kalemler.Sum(k => k.Adet),
                    ToplamTutar = siparis.Kalemler.Sum(
                        k => k.Adet * k.BirimFiyat
                    ),
                    Kalemler = siparis.Kalemler.Select(k => new
                    {
                        k.Id,
                        k.IsTuru,
                        k.Adet,
                        k.BirimFiyat,
                        Toplam = k.Adet * k.BirimFiyat
                    })
                });
                    }
                    catch
                    {
                        await transaction.RollbackAsync();
                        throw;
                    }
                });
            }
            catch (Exception ex)
            {
                // V33.07.16: Npgsql retry execution strategy ile transaction ayni
                // execution-strategy delegesi icinde calisir. Boylece kullanici
                // baslatimli transaction / retry cakismasi ortadan kalkar.
                var detail = ex.InnerException?.Message ?? ex.Message;
                return Problem(
                    title: "İş güncellenemedi.",
                    detail: detail,
                    statusCode: StatusCodes.Status500InternalServerError
                );
            }
        }


        // =========================================================
        // ÜRETİM AŞAMASI / KALİTE KONTROL HIZLI GÜNCELLEME
        // =========================================================
        [HttpPatch("{id:int}/uretim-kalite")]
        public async Task<IActionResult> UretimKaliteGuncelle(
            int id,
            [FromBody] UretimKaliteGuncelleDto dto)
        {
            var exists = await _db.Siparisler
                .AsNoTracking()
                .AnyAsync(s => s.Id == id);

            if (!exists)
            {
                return NotFound("İş bulunamadı.");
            }

            var uretimAsamasi =
                NormalizeUretimAsamasi(dto.UretimAsamasi);

            var kaliteKontrolDurumu =
                NormalizeKaliteDurumu(dto.KaliteKontrolDurumu);

            var kaliteKontrolNotu =
                string.IsNullOrWhiteSpace(dto.KaliteKontrolNotu)
                    ? null
                    : dto.KaliteKontrolNotu.Trim();

            var kaliteKontrolTarihi =
                kaliteKontrolDurumu == "Bekliyor"
                    ? (DateTime?)null
                    : DateTime.UtcNow;

            await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE "Siparisler"
                SET
                    "UretimAsamasi" = {uretimAsamasi},
                    "KaliteKontrolDurumu" = {kaliteKontrolDurumu},
                    "KaliteKontrolNotu" = {kaliteKontrolNotu},
                    "KaliteKontrolTarihi" = {kaliteKontrolTarihi}
                WHERE "Id" = {id}
                """);

            return Ok(new
            {
                Id = id,
                UretimAsamasi = uretimAsamasi,
                KaliteKontrolDurumu = kaliteKontrolDurumu,
                KaliteKontrolNotu = kaliteKontrolNotu,
                KaliteKontrolTarihi = kaliteKontrolTarihi
            });
        }


        // =========================================================
        // İŞ DÜZENLE
        // =========================================================

        [HttpPut("{id:int}")]
        public async Task<IActionResult> UpdateSiparis(
            int id,
            [FromBody] SiparisDuzenleDto dto)
        {
            var siparis =
                await _db.Siparisler
                    .Include(s => s.Kalemler)
                    .FirstOrDefaultAsync(
                        s => s.Id == id
                    );

            if (siparis == null)
            {
                return NotFound(
                    "İş bulunamadı."
                );
            }


            var hastaVar =
                await _db.Hastalar
                    .AnyAsync(h =>
                        h.Id == dto.HastaId &&
                        h.Aktif
                    );

            if (!hastaVar)
            {
                return BadRequest(
                    "Hasta bulunamadı."
                );
            }


            if (dto.Kalemler == null ||
                dto.Kalemler.Count == 0)
            {
                return BadRequest(
                    "En az bir iş kalemi gereklidir."
                );
            }


            siparis.HastaId =
                dto.HastaId;

            if (!string.IsNullOrWhiteSpace(dto.Durum))
            {
                var normalizedStatus = NormalizeConstitutionalStatus(dto.Durum);
                if (normalizedStatus == null)
                    return BadRequest("Geçersiz durum. Primer Lab durum akışını kullanır.");
                siparis.Durum = normalizedStatus;
            }


            _db.SiparisKalemleri
                .RemoveRange(
                    siparis.Kalemler
                );


            siparis.Kalemler =
                dto.Kalemler
                    .Select(k =>
                        new SiparisKalemi
                        {
                            IsTuru =
                                k.IsTuru.Trim(),

                            Adet =
                                k.Adet,

                            BirimFiyat =
                                k.BirimFiyat
                        })
                    .ToList();


            await _db.SaveChangesAsync();


            return Ok(
                new
                {
                    siparis.Id,
                    siparis.HastaId,
                    siparis.Durum
                }
            );
        }


        // =========================================================
        // İŞ İPTAL
        // =========================================================

        [HttpPatch("{id:int}/iptal")]
        public async Task<IActionResult> IptalEt(int id)
        {
            var siparis = await _db.Siparisler
                .AsNoTracking()
                .FirstOrDefaultAsync(s => s.Id == id);

            if (siparis == null) return NotFound("İş bulunamadı.");

            var count = await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE "Siparisler"
                SET "Silindi"=TRUE,
                    "SilinmeTarihi"={DateTime.UtcNow}
                WHERE "Id"={id}
                """);

            if (count == 0) return NotFound("İş bulunamadı.");

            await DurumGecmisiEkle(
                id,
                siparis.Durum,
                siparis.Durum,
                "Eski iptal uç noktası çağrıldı; kayıt güvenli biçimde Silinenler'e taşındı.");

            return Ok(new { siparis.Id, siparis.Durum, Silindi = true });
        }

        private static string? NormalizeConstitutionalStatus(string? value)
        {
            var v = (value ?? string.Empty).Trim();
            return v switch
            {
                "Yeni" => "Bekliyor",
                "Onay Bekliyor" => "Bekliyor",
                "Devam Eden" => "Üretimde",
                "Devam Ediyor" => "Üretimde",
                "Tasarım" => "Tasarımda",
                "Üretim" => "Üretimde",
                "Hazır" => "Tamamlama Onayı",
                "Teslim" => "Tamamlandı",
                "Teslim Edildi" => "Tamamlandı",
                "Bekliyor" => "Bekliyor",
                "Tasarımda" => "Tasarımda",
                "Üretimde" => "Üretimde",
                "Makyajda" => "Makyajda",
                "Tamamlama Onayı" => "Tamamlama Onayı",
                "Tamamlandı" => "Tamamlandı",
                _ => null
            };
        }

        private static string NormalizeUretimAsamasi(string? value)
        {
            var v = (value ?? "Bekliyor").Trim();

            return v switch
            {
                "Tasarım" => "Tasarım",
                "Üretim" => "Üretim",
                "Bitim" => "Bitim",
                "Kalite Kontrol" => "Kalite Kontrol",
                "Paketleme" => "Paketleme",
                _ => "Bekliyor"
            };
        }

        private static string NormalizeKaliteDurumu(string? value)
        {
            var v = (value ?? "Bekliyor").Trim();

            return v switch
            {
                "Onaylandı" => "Onaylandı",
                "Düzeltme Gerekli" => "Düzeltme Gerekli",
                _ => "Bekliyor"
            };
        }

        private static string NormalizeOncelik(string? value)
        {
            var v = (value ?? "Normal").Trim();

            if (string.Equals(v, "Çok Acil", StringComparison.OrdinalIgnoreCase))
                return "Çok Acil";

            if (string.Equals(v, "Acil", StringComparison.OrdinalIgnoreCase))
                return "Acil";

            return "Normal";
        }

        private async Task DurumGecmisiEkle(
            int siparisId,
            string? eskiDurum,
            string yeniDurum,
            string? aciklama)
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
                    {eskiDurum},
                    {yeniDurum},
                    {DateTime.UtcNow},
                    {aciklama}
                )
                """);
        }

    }


    // =============================================================
    // DTO'LAR
    // =============================================================


    public class YeniCokluIsOlusturDto
    {
        public int HekimId { get; set; }

        public string HastaAdi { get; set; }
            = string.Empty;

        public string? Notlar { get; set; }

        public DateTime? TerminTarihi { get; set; }

        public string? DisRengi { get; set; }

        public string? Oncelik { get; set; }

        public string? UretimNotu { get; set; }

        public List<YeniCokluIsKalemiDto> Kalemler { get; set; }
            = new();
    }


    public class YeniCokluIsKalemiDto
    {
        public string IsTuru { get; set; }
            = string.Empty;

        public int Adet { get; set; }
            = 1;

        public decimal BirimFiyat { get; set; }
    }


    public class YeniIsOlusturDto
    {
        public int HekimId { get; set; }

        public string HastaAdi { get; set; }
            = string.Empty;

        public string IsTuru { get; set; }
            = string.Empty;

        public int Adet { get; set; }
            = 1;

        public decimal BirimFiyat { get; set; }

        public string? Renk { get; set; }

        public DateTime? TeslimTarihi { get; set; }

        public string? Notlar { get; set; }
    }



    public class LabIsDuzenleDto
    {
        public string HastaAdi { get; set; }
            = string.Empty;

        public string Durum { get; set; }
            = "Yeni";

        public DateTime? TerminTarihi { get; set; }

        public string? DisRengi { get; set; }

        public string? Oncelik { get; set; }

        public string? UretimNotu { get; set; }

        public string? UretimAsamasi { get; set; }

        public string? KaliteKontrolDurumu { get; set; }

        public string? KaliteKontrolNotu { get; set; }

        public List<SiparisKalemiOlusturDto> Kalemler { get; set; }
            = new();
    }


    public class SiparisOlusturDto
    {
        public int HastaId { get; set; }

        public string Durum { get; set; }
            = "Yeni";

        public List<SiparisKalemiOlusturDto>
            Kalemler
        { get; set; }
            = new();
    }


    public class SiparisDuzenleDto
    {
        public int HastaId { get; set; }

        public string Durum { get; set; }
            = "Yeni";

        public List<SiparisKalemiOlusturDto>
            Kalemler
        { get; set; }
            = new();
    }


    public class SiparisDurumDto
    {
        public string Durum { get; set; }
            = string.Empty;
    }


    public class SiparisKalemiOlusturDto
    {
        public string IsTuru { get; set; }
            = string.Empty;

        public int Adet { get; set; }
            = 1;

        public decimal BirimFiyat { get; set; }
    }

    public class SiparisDurumGecmisiDto
    {
        public int Id { get; set; }
        public int SiparisId { get; set; }
        public string? EskiDurum { get; set; }
        public string YeniDurum { get; set; } = string.Empty;
        public DateTime DegisimTarihi { get; set; }
        public string? Aciklama { get; set; }
    }

    public class SiparisParaBirimiDto
    {
        public int SiparisId { get; set; }
        public string ParaBirimi { get; set; } = "TRY";
    }

    public class SiparisTerminTarihiDto
    {
        public int SiparisId { get; set; }
        public DateTime TerminTarihi { get; set; }
    }

    public class SiparisTeslimTarihiDto
    {
        public int SiparisId { get; set; }
        public DateTime TeslimTarihi { get; set; }
    }

    public class SiparisDisRengiDto
    {
        public int SiparisId { get; set; }
        public string DisRengi { get; set; } = string.Empty;
    }

    public class SiparisOperasyonBilgisiDto
    {
        public int SiparisId { get; set; }
        public string Oncelik { get; set; } = "Normal";
        public string? UretimNotu { get; set; }
        public string UretimAsamasi { get; set; } = "Bekliyor";
        public string KaliteKontrolDurumu { get; set; } = "Bekliyor";
        public string? KaliteKontrolNotu { get; set; }
        public DateTime? KaliteKontrolTarihi { get; set; }
    }

    public class UretimKaliteGuncelleDto
    {
        public string? UretimAsamasi { get; set; }
        public string? KaliteKontrolDurumu { get; set; }
        public string? KaliteKontrolNotu { get; set; }
    }

}