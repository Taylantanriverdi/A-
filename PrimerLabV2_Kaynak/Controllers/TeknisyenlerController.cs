using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;
using PrimerLabV2.Infrastructure;

namespace PrimerLabV2.Controllers
{
    [Route("api/teknisyenler")]
    [ApiController]
    public class TeknisyenlerController : ControllerBase
    {
        private readonly PrimerLabDbContext _db;
        private readonly TeknisyenHesapDeposu _hesaplar;

        public TeknisyenlerController(PrimerLabDbContext db, TeknisyenHesapDeposu hesaplar)
        {
            _db = db;
            _hesaplar = hesaplar;
        }

        [HttpGet]
        public async Task<IActionResult> GetAll()
        {
            var rows = await _db.Database
                .SqlQuery<TeknisyenRow>($"""
                    SELECT
                        "Id",
                        "AdSoyad",
                        "Aktif",
                        "OlusturmaTarihi"
                    FROM "Teknisyenler"
                    ORDER BY "Aktif" DESC, "AdSoyad", "Id"
                    """)
                .ToListAsync();

            return Ok(rows);
        }

        [HttpPost]
        public async Task<IActionResult> Create(
            [FromBody] TeknisyenKaydetDto dto)
        {
            var adSoyad =
                (dto.AdSoyad ?? string.Empty).Trim();

            if (string.IsNullOrWhiteSpace(adSoyad))
            {
                return BadRequest(
                    "Teknisyen adı boş bırakılamaz."
                );
            }

            if (adSoyad.Length > 150)
            {
                return BadRequest(
                    "Teknisyen adı 150 karakterden uzun olamaz."
                );
            }

            var duplicate = await _db.Database
                .SqlQuery<TeknisyenRow>($"""
                    SELECT
                        "Id",
                        "AdSoyad",
                        "Aktif",
                        "OlusturmaTarihi"
                    FROM "Teknisyenler"
                    WHERE LOWER(TRIM("AdSoyad")) =
                          LOWER(TRIM({adSoyad}))
                    LIMIT 1
                    """)
                .FirstOrDefaultAsync();

            if (duplicate != null)
            {
                return BadRequest(
                    duplicate.Aktif
                        ? "Aynı isimde bir teknisyen zaten kayıtlı."
                        : "Aynı isimde pasif bir teknisyen kayıtlı. Yeni kayıt açmak yerine o teknisyeni 'Aktif Yap' ile tekrar aktifleştir."
                );
            }

            await _db.Database
                .ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO "Teknisyenler"
                        ("AdSoyad", "Aktif", "OlusturmaTarihi")
                    VALUES
                        ({adSoyad}, TRUE, NOW())
                    """);

            return Ok(new
            {
                Message = "Teknisyen eklendi."
            });
        }

        [HttpPut("{id:int}")]
        public async Task<IActionResult> Update(
            int id,
            [FromBody] TeknisyenKaydetDto dto)
        {
            if (id <= 0)
            {
                return BadRequest(
                    "Geçersiz teknisyen."
                );
            }

            var adSoyad =
                (dto.AdSoyad ?? string.Empty).Trim();

            if (string.IsNullOrWhiteSpace(adSoyad))
            {
                return BadRequest(
                    "Teknisyen adı boş bırakılamaz."
                );
            }

            if (adSoyad.Length > 150)
            {
                return BadRequest(
                    "Teknisyen adı 150 karakterden uzun olamaz."
                );
            }

            var exists = await _db.Database
                .SqlQuery<int>($"""
                    SELECT COUNT(*)::int AS "Value"
                    FROM "Teknisyenler"
                    WHERE "Id" = {id}
                    """)
                .FirstAsync();

            if (exists == 0)
            {
                return NotFound(
                    "Teknisyen bulunamadı."
                );
            }

            var duplicate = await _db.Database
                .SqlQuery<int>($"""
                    SELECT COUNT(*)::int AS "Value"
                    FROM "Teknisyenler"
                    WHERE LOWER(TRIM("AdSoyad")) =
                          LOWER(TRIM({adSoyad}))
                      AND "Id" <> {id}
                    """)
                .FirstAsync();

            if (duplicate > 0)
            {
                return BadRequest(
                    "Aynı isimde başka bir teknisyen zaten kayıtlı."
                );
            }

            await _db.Database
                .ExecuteSqlInterpolatedAsync($"""
                    UPDATE "Teknisyenler"
                    SET
                        "AdSoyad" = {adSoyad},
                        "Aktif" = COALESCE({dto.Aktif}, "Aktif")
                    WHERE "Id" = {id}
                    """);

            return Ok(new
            {
                Message = "Teknisyen güncellendi."
            });
        }

        [HttpDelete("{id:int}")]
        public async Task<IActionResult> Delete(int id)
        {
            if (id <= 0) return BadRequest("Geçersiz teknisyen.");

            var exists = await _db.Database.SqlQuery<int>($"""
                SELECT COUNT(*)::int AS "Value"
                FROM "Teknisyenler"
                WHERE "Id" = {id}
                """).FirstAsync();
            if (exists == 0) return NotFound("Teknisyen bulunamadı.");

            const string kullanimdaMesaji =
                "Bu teknisyene bağlı iş geçmişi bulunduğu için kayıt silinemez. Geçmiş kayıtların bozulmaması için 'Pasife Al' seçeneğini kullan.";

            // Kontrol ve silme tek komutta yapılır: kontrol ile silme arasında
            // başka bir ekrandan bu teknisyene iş atanırsa kayıt silinmez.
            int silinen;
            try
            {
                silinen = await _db.Database.ExecuteSqlInterpolatedAsync($"""
                    DELETE FROM "Teknisyenler" t
                    WHERE t."Id" = {id}
                      AND NOT EXISTS (
                          SELECT 1 FROM "Siparisler" s
                          WHERE s."TeknisyenId" = {id}
                      )
                    """);
            }
            catch (DbException ex) when (ex.SqlState == "23503")
            {
                // Başka bir tablo (yabancı anahtar) bu teknisyene bağlı.
                return Conflict(kullanimdaMesaji);
            }

            if (silinen == 0)
                return Conflict(kullanimdaMesaji);

            // Panel hesabı da silinir; yoksa kullanıcı adı sahipsiz kalır ve yeni hesaba verilemez.
            _hesaplar.Sil(id);
            return Ok(new { Message = "Teknisyen silindi." });
        }
    }

    [Route("api/teknisyen-atamalari")]
    [ApiController]
    public class TeknisyenAtamalariController : ControllerBase
    {
        private readonly PrimerLabDbContext _db;

        public TeknisyenAtamalariController(
            PrimerLabDbContext db)
        {
            _db = db;
        }

        [HttpGet]
        public async Task<IActionResult> GetAll()
        {
            var rows = await _db.Database
                .SqlQuery<TeknisyenAtamaRow>($"""
                    SELECT
                        s."Id" AS "SiparisId",
                        s."TeknisyenId",
                        t."AdSoyad" AS "TeknisyenAdi",
                        COALESCE(t."Aktif", FALSE) AS "TeknisyenAktif"
                    FROM "Siparisler" s
                    LEFT JOIN "Teknisyenler" t
                        ON t."Id" = s."TeknisyenId"
                    ORDER BY s."Id" DESC
                    """)
                .ToListAsync();

            return Ok(rows);
        }

        [HttpGet("{siparisId:int}")]
        public async Task<IActionResult> GetOne(
            int siparisId)
        {
            if (siparisId <= 0)
            {
                return BadRequest("Geçersiz iş.");
            }

            var row = await _db.Database
                .SqlQuery<TeknisyenAtamaRow>($"""
                    SELECT
                        s."Id" AS "SiparisId",
                        s."TeknisyenId",
                        t."AdSoyad" AS "TeknisyenAdi",
                        COALESCE(t."Aktif", FALSE) AS "TeknisyenAktif"
                    FROM "Siparisler" s
                    LEFT JOIN "Teknisyenler" t
                        ON t."Id" = s."TeknisyenId"
                    WHERE s."Id" = {siparisId}
                    """)
                .FirstOrDefaultAsync();

            if (row == null)
            {
                return NotFound("İş bulunamadı.");
            }

            Response.Headers.CacheControl =
                "no-store, no-cache, must-revalidate";

            return Ok(row);
        }

        [HttpPatch("{siparisId:int}")]
        public async Task<IActionResult> Assign(
            int siparisId,
            [FromBody] TeknisyenAtaDto dto)
        {
            if (siparisId <= 0)
            {
                return BadRequest("Geçersiz iş.");
            }

            var siparisExists = await _db.Database
                .SqlQuery<int>($"""
                    SELECT COUNT(*)::int AS "Value"
                    FROM "Siparisler"
                    WHERE "Id" = {siparisId}
                    """)
                .FirstAsync();

            if (siparisExists == 0)
            {
                return NotFound("İş bulunamadı.");
            }

            if (dto.TeknisyenId.HasValue)
            {
                var teknisyenId =
                    dto.TeknisyenId.Value;

                var teknisyenExists =
                    await _db.Database
                        .SqlQuery<int>($"""
                            SELECT COUNT(*)::int AS "Value"
                            FROM "Teknisyenler" t
                            WHERE t."Id" = {teknisyenId}
                              AND (
                                  t."Aktif" = TRUE
                                  OR EXISTS (
                                      SELECT 1 FROM "Siparisler" s
                                      WHERE s."Id" = {siparisId}
                                        AND s."TeknisyenId" = {teknisyenId}
                                  )
                              )
                            """)
                        .FirstAsync();

                if (teknisyenExists == 0)
                {
                    return BadRequest(
                        "Seçilen teknisyen bulunamadı veya pasif."
                    );
                }

                await _db.Database
                    .ExecuteSqlInterpolatedAsync($"""
                        UPDATE "Siparisler"
                        SET "TeknisyenId" = {teknisyenId}
                        WHERE "Id" = {siparisId}
                        """);
            }
            else
            {
                await _db.Database
                    .ExecuteSqlInterpolatedAsync($"""
                        UPDATE "Siparisler"
                        SET "TeknisyenId" = NULL
                        WHERE "Id" = {siparisId}
                        """);
            }

            var current = await _db.Database
                .SqlQuery<TeknisyenAtamaRow>($"""
                    SELECT
                        s."Id" AS "SiparisId",
                        s."TeknisyenId",
                        t."AdSoyad" AS "TeknisyenAdi",
                        COALESCE(t."Aktif", FALSE) AS "TeknisyenAktif"
                    FROM "Siparisler" s
                    LEFT JOIN "Teknisyenler" t
                        ON t."Id" = s."TeknisyenId"
                    WHERE s."Id" = {siparisId}
                    """)
                .FirstAsync();

            if (current.TeknisyenId != dto.TeknisyenId)
            {
                return StatusCode(
                    500,
                    "Teknisyen değişikliği veritabanında doğrulanamadı."
                );
            }

            Response.Headers.CacheControl =
                "no-store, no-cache, must-revalidate";

            return Ok(current);
        }
    }

    public class TeknisyenRow
    {
        public int Id { get; set; }
        public string AdSoyad { get; set; } = string.Empty;
        public bool Aktif { get; set; }
        public DateTime OlusturmaTarihi { get; set; }
    }

    public class TeknisyenAtamaRow
    {
        public int SiparisId { get; set; }
        public int? TeknisyenId { get; set; }
        public string? TeknisyenAdi { get; set; }
        public bool TeknisyenAktif { get; set; }
    }

    public class TeknisyenKaydetDto
    {
        public string? AdSoyad { get; set; }
        // null gelirse (istemci göndermezse) mevcut aktiflik durumu korunur.
        // Eskiden varsayılan "true" olduğu için sadece isim gönderen bir
        // istek pasif teknisyeni sessizce tekrar aktif yapıyordu.
        public bool? Aktif { get; set; }
    }

    public class TeknisyenAtaDto
    {
        public int? TeknisyenId { get; set; }
    }
}
