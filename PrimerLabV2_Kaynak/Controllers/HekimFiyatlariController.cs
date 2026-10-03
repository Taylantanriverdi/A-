using System.Data;
using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;

namespace PrimerLabV2.Controllers
{
    [Route("api/hekim-fiyatlari")]
    [ApiController]
    public class HekimFiyatlariController : ControllerBase
    {
        private readonly PrimerLabDbContext _db;

        private static readonly string[] VarsayilanIsKatalogu =
        {
            "Monolitik Zirkonyum",
            "Altyapı Zirkonyum",
            "Cam Seramik E.max",
            "Geçici",
            "Titanyum Bar",
            "Titanyum All On Four",
            "Tasarım"
        };

        public HekimFiyatlariController(PrimerLabDbContext db)
        {
            _db = db;
        }

        // =========================================================
        // MERKEZİ İŞ KATALOĞU
        //
        // HekimId = 0 olan kayıtlar global iş kataloğu olarak kullanılır.
        // Böylece yeni tablo oluşturmadan mevcut HekimFiyatlari tablosu
        // üzerinde merkezi katalog + hekime özel fiyat yapısı sağlanır.
        // =========================================================

        [HttpGet("katalog")]
        public async Task<IActionResult> GetKatalog()
        {
            var connection = _db.Database.GetDbConnection();
            var acildiMi = connection.State != ConnectionState.Open;

            if (acildiMi)
            {
                await connection.OpenAsync();
            }

            try
            {
                await EnsureCatalogAsync(connection);

                await using var command = connection.CreateCommand();

                command.CommandText = """
                    SELECT
                        "Id",
                        "IsTuru",
                        COALESCE("ParaBirimi",'TRY') AS "ParaBirimi",
                        "Sira",
                        "Aktif"
                    FROM "HekimFiyatlari"
                    WHERE "HekimId" = 0
                      AND "Aktif" = TRUE
                    ORDER BY "Sira", "IsTuru";
                    """;

                var sonuc = new List<object>();

                await using var reader =
                    await command.ExecuteReaderAsync();

                while (await reader.ReadAsync())
                {
                    sonuc.Add(new
                    {
                        Id = reader.GetInt32(0),
                        IsTuru = reader.GetString(1),
                        ParaBirimi = reader.GetString(2),
                        Sira = reader.GetInt32(3),
                        Aktif = reader.GetBoolean(4)
                    });
                }

                return Ok(sonuc);
            }
            finally
            {
                if (acildiMi)
                {
                    await connection.CloseAsync();
                }
            }
        }


        [HttpPut("katalog")]
        public async Task<IActionResult> KatalogKaydet(
            [FromBody] List<IsKatalogKaydetDto> kalemler)
        {
            kalemler ??= new List<IsKatalogKaydetDto>();

            var temizListe = new List<IsKatalogKaydetDto>();
            var isimler = new HashSet<string>(
                StringComparer.CurrentCultureIgnoreCase
            );

            foreach (var kalem in kalemler)
            {
                var isTuru = kalem.IsTuru?.Trim() ?? "";

                if (string.IsNullOrWhiteSpace(isTuru))
                {
                    return BadRequest(
                        "İş türü boş bırakılamaz."
                    );
                }

                if (!isimler.Add(isTuru))
                {
                    return BadRequest(
                        $"{isTuru} katalogda iki kez bulunuyor."
                    );
                }

                temizListe.Add(new IsKatalogKaydetDto
                {
                    IsTuru = isTuru,
                    Sira = kalem.Sira
                });
            }

            if (temizListe.Count == 0)
            {
                return BadRequest(
                    "İş kataloğu tamamen boş bırakılamaz."
                );
            }

            var connection = _db.Database.GetDbConnection();
            var acildiMi = connection.State != ConnectionState.Open;

            if (acildiMi)
            {
                await connection.OpenAsync();
            }

            await using var transaction =
                await connection.BeginTransactionAsync();

            try
            {
                await using (var delete = connection.CreateCommand())
                {
                    delete.Transaction = transaction;
                    delete.CommandText = """
                        DELETE FROM "HekimFiyatlari"
                        WHERE "HekimId" = 0;
                        """;

                    await delete.ExecuteNonQueryAsync();
                }

                var sira = 0;

                foreach (var kalem in temizListe)
                {
                    await InsertPriceRowAsync(
                        connection,
                        transaction,
                        0,
                        kalem.IsTuru,
                        0m,
                        "TRY",
                        sira++
                    );
                }

                await transaction.CommitAsync();

                return Ok(new
                {
                    KayitSayisi = temizListe.Count
                });
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
            finally
            {
                if (acildiMi)
                {
                    await connection.CloseAsync();
                }
            }
        }


        // =========================================================
        // İŞ TÜRÜ ÖNERİLERİ
        //
        // Her hekimin iş listesi kendisine özeldir. Hekim listesine iş
        // yazarken, aynı işin farklı yazılmaması için diğer hekimlerde
        // kullanılan iş adları öneri olarak sunulur.
        // =========================================================

        [HttpGet("is-turleri")]
        public async Task<IActionResult> IsTuruOnerileri()
        {
            var rows = await _db.Database.SqlQuery<string>($"""
                SELECT MIN(BTRIM("IsTuru")) AS "Value"
                FROM "HekimFiyatlari"
                WHERE "HekimId" <> 0
                  AND "Aktif" = TRUE
                  AND BTRIM("IsTuru") <> ''
                GROUP BY LOWER(BTRIM("IsTuru"))
                ORDER BY 1
                """).ToListAsync();

            return Ok(rows);
        }


        // =========================================================
        // HEKİME ÖZEL FİYATLAR
        // =========================================================

        [HttpGet("{hekimId:int}")]
        public async Task<IActionResult> GetFiyatlar(int hekimId)
        {
            if (hekimId <= 0)
            {
                return BadRequest("Geçerli bir hekim seçilmelidir.");
            }

            var hekimVar = await _db.Hekimler
                .AsNoTracking()
                .AnyAsync(h => h.Id == hekimId);

            if (!hekimVar)
            {
                return NotFound("Hekim bulunamadı.");
            }

            var connection = _db.Database.GetDbConnection();
            var acildiMi = connection.State != ConnectionState.Open;

            if (acildiMi)
            {
                await connection.OpenAsync();
            }

            try
            {
                await EnsureCatalogAsync(connection);

                await using var command = connection.CreateCommand();

                command.CommandText = """
                    SELECT
                        "Id",
                        "HekimId",
                        "IsTuru",
                        "BirimFiyat",
                        COALESCE("ParaBirimi",'TRY') AS "ParaBirimi",
                        "Sira",
                        "Aktif"
                    FROM "HekimFiyatlari"
                    WHERE "HekimId" = @hekimId
                      AND "Aktif" = TRUE
                    ORDER BY "Sira", "IsTuru";
                    """;

                AddParameter(command, "@hekimId", hekimId);

                var sonuc = new List<object>();

                await using var reader =
                    await command.ExecuteReaderAsync();

                while (await reader.ReadAsync())
                {
                    sonuc.Add(new
                    {
                        Id = reader.GetInt32(0),
                        HekimId = reader.GetInt32(1),
                        IsTuru = reader.GetString(2),
                        BirimFiyat = reader.GetDecimal(3),
                        ParaBirimi = reader.GetString(4),
                        Sira = reader.GetInt32(5),
                        Aktif = reader.GetBoolean(6)
                    });
                }

                return Ok(sonuc);
            }
            finally
            {
                if (acildiMi)
                {
                    await connection.CloseAsync();
                }
            }
        }


        [HttpPut("{hekimId:int}")]
        public async Task<IActionResult> FiyatlariKaydet(
            int hekimId,
            [FromBody] List<HekimFiyatKaydetDto> fiyatlar)
        {
            var hekim = await _db.Hekimler
                .AsNoTracking()
                .FirstOrDefaultAsync(h => h.Id == hekimId);

            if (hekim == null)
            {
                return NotFound("Hekim bulunamadı.");
            }

            fiyatlar ??= new List<HekimFiyatKaydetDto>();

            var temizListe = new List<HekimFiyatKaydetDto>();
            var isimler = new HashSet<string>(
                StringComparer.CurrentCultureIgnoreCase
            );

            foreach (var fiyat in fiyatlar)
            {
                var isTuru = fiyat.IsTuru?.Trim() ?? "";

                if (string.IsNullOrWhiteSpace(isTuru))
                {
                    return BadRequest(
                        "İş türü boş bırakılamaz."
                    );
                }

                if (fiyat.BirimFiyat < 0)
                {
                    return BadRequest(
                        $"{isTuru} için fiyat geçersiz."
                    );
                }

                if (!isimler.Add(isTuru))
                {
                    return BadRequest(
                        $"{isTuru} fiyat listesinde iki kez bulunuyor."
                    );
                }

                var paraBirimi = NormalizeCurrency(fiyat.ParaBirimi);
                if (paraBirimi == null)
                {
                    return BadRequest($"{isTuru} için para birimi geçersiz. TRY, EUR veya USD kullanılabilir.");
                }

                temizListe.Add(new HekimFiyatKaydetDto
                {
                    IsTuru = isTuru,
                    BirimFiyat = fiyat.BirimFiyat,
                    ParaBirimi = paraBirimi,
                    Sira = fiyat.Sira
                });
            }

            var connection = _db.Database.GetDbConnection();
            var acildiMi = connection.State != ConnectionState.Open;

            if (acildiMi)
            {
                await connection.OpenAsync();
            }

            await using var transaction =
                await connection.BeginTransactionAsync();

            try
            {
                await using (var delete = connection.CreateCommand())
                {
                    delete.Transaction = transaction;

                    delete.CommandText = """
                        DELETE FROM "HekimFiyatlari"
                        WHERE "HekimId" = @hekimId;
                        """;

                    AddParameter(delete, "@hekimId", hekimId);

                    await delete.ExecuteNonQueryAsync();
                }

                var sira = 0;

                foreach (var fiyat in temizListe)
                {
                    await InsertPriceRowAsync(
                        connection,
                        transaction,
                        hekimId,
                        fiyat.IsTuru,
                        fiyat.BirimFiyat,
                        fiyat.ParaBirimi,
                        sira++
                    );
                }

                await transaction.CommitAsync();

                return Ok(new
                {
                    HekimId = hekimId,
                    HekimAdi = hekim.AdSoyad,
                    KayitSayisi = temizListe.Count
                });
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
            finally
            {
                if (acildiMi)
                {
                    await connection.CloseAsync();
                }
            }
        }


        private static async Task EnsureCatalogAsync(
            DbConnection connection)
        {
            // Katalog yalnızca ilk kurulumda otomatik oluşturulur.
            // Kullanıcı katalogdan bir iş türünü sildikten sonra artık
            // varsayılan listeden veya hekim fiyatlarından yeniden üretilmez.
            await using (var checkCatalog = connection.CreateCommand())
            {
                checkCatalog.CommandText = """
                    SELECT COUNT(*)
                    FROM "HekimFiyatlari"
                    WHERE "HekimId" = 0;
                    """;

                var mevcut =
                    Convert.ToInt32(
                        await checkCatalog.ExecuteScalarAsync()
                    );

                if (mevcut > 0)
                {
                    return;
                }
            }

            // Önce daha önce hekimlere yazılmış tüm farklı iş adlarını
            // merkezi kataloğa kopyala. Böylece mevcut kullanıcı verisi kaybolmaz.
            await using (var copyExisting = connection.CreateCommand())
            {
                copyExisting.CommandText = """
                    INSERT INTO "HekimFiyatlari"
                    (
                        "HekimId",
                        "IsTuru",
                        "BirimFiyat",
                        "ParaBirimi",
                        "Sira",
                        "Aktif"
                    )
                    SELECT
                        0,
                        x."IsTuru",
                        0,
                        'TRY',
                        1000 + ROW_NUMBER() OVER (ORDER BY x."IsTuru"),
                        TRUE
                    FROM
                    (
                        SELECT DISTINCT "IsTuru"
                        FROM "HekimFiyatlari"
                        WHERE "HekimId" <> 0
                          AND "Aktif" = TRUE
                    ) x
                    WHERE NOT EXISTS
                    (
                        SELECT 1
                        FROM "HekimFiyatlari" k
                        WHERE k."HekimId" = 0
                          AND LOWER(k."IsTuru") = LOWER(x."IsTuru")
                    )
                    ON CONFLICT ("HekimId", "IsTuru")
                    DO NOTHING;
                    """;

                await copyExisting.ExecuteNonQueryAsync();
            }

            var sira = 0;

            foreach (var isTuru in VarsayilanIsKatalogu)
            {
                await using var command = connection.CreateCommand();

                command.CommandText = """
                    INSERT INTO "HekimFiyatlari"
                    (
                        "HekimId",
                        "IsTuru",
                        "BirimFiyat",
                        "ParaBirimi",
                        "Sira",
                        "Aktif"
                    )
                    SELECT
                        0,
                        @isTuru,
                        0,
                        'TRY',
                        @sira,
                        TRUE
                    WHERE NOT EXISTS
                    (
                        SELECT 1
                        FROM "HekimFiyatlari"
                        WHERE "HekimId" = 0
                          AND LOWER("IsTuru") = LOWER(@isTuru)
                    )
                    ON CONFLICT ("HekimId", "IsTuru")
                    DO NOTHING;
                    """;

                AddParameter(command, "@isTuru", isTuru);
                AddParameter(command, "@sira", sira++);

                await command.ExecuteNonQueryAsync();
            }
        }


        private static async Task InsertPriceRowAsync(
            DbConnection connection,
            DbTransaction transaction,
            int hekimId,
            string isTuru,
            decimal birimFiyat,
            string paraBirimi,
            int sira)
        {
            await using var insert = connection.CreateCommand();
            insert.Transaction = transaction;

            insert.CommandText = """
                INSERT INTO "HekimFiyatlari"
                (
                    "HekimId",
                    "IsTuru",
                    "BirimFiyat",
                    "ParaBirimi",
                    "Sira",
                    "Aktif"
                )
                VALUES
                (
                    @hekimId,
                    @isTuru,
                    @birimFiyat,
                    @paraBirimi,
                    @sira,
                    TRUE
                );
                """;

            AddParameter(insert, "@hekimId", hekimId);
            AddParameter(insert, "@isTuru", isTuru);
            AddParameter(insert, "@birimFiyat", birimFiyat);
            AddParameter(insert, "@paraBirimi", paraBirimi);
            AddParameter(insert, "@sira", sira);

            await insert.ExecuteNonQueryAsync();
        }


        private static string? NormalizeCurrency(string? value)
        {
            var currency = string.IsNullOrWhiteSpace(value)
                ? "TRY"
                : value.Trim().ToUpperInvariant();

            return currency is "TRY" or "EUR" or "USD"
                ? currency
                : null;
        }

        private static void AddParameter(
            DbCommand command,
            string name,
            object value)
        {
            var parameter = command.CreateParameter();
            parameter.ParameterName = name;
            parameter.Value = value;
            command.Parameters.Add(parameter);
        }
    }


    public class HekimFiyatKaydetDto
    {
        public string IsTuru { get; set; }
            = string.Empty;

        public decimal BirimFiyat { get; set; }

        public string ParaBirimi { get; set; } = "TRY";

        public int Sira { get; set; }
    }


    public class IsKatalogKaydetDto
    {
        public string IsTuru { get; set; }
            = string.Empty;

        public int Sira { get; set; }
    }
}
