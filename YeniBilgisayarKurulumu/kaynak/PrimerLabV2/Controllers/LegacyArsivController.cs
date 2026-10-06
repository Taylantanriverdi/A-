using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;

namespace PrimerLabV2.Controllers
{
    [ApiController]
    [Route("api/legacy-arsiv")]
    public class LegacyArsivController : ControllerBase
    {
        private readonly PrimerLabDbContext _db;

        public LegacyArsivController(PrimerLabDbContext db)
        {
            _db = db;
        }

        [HttpGet("ozet")]
        public async Task<IActionResult> Ozet()
        {
            var gruplar = await _db.Database
                .SqlQuery<LegacyArsivOzetDto>($"""
                    SELECT
                        "Tur",
                        COUNT(*)::int AS "KayitSayisi"
                    FROM "LegacyArsivKayitlari"
                    GROUP BY "Tur"
                    ORDER BY "Tur"
                    """)
                .ToListAsync();

            var sonImport = await _db.Database
                .SqlQuery<LegacyImportBilgisiDto>($"""
                    SELECT
                        "Id",
                        "DosyaAdi",
                        "ImportTarihi",
                        "DoktorSayisi",
                        "TeknisyenSayisi",
                        "IsSayisi",
                        "BekleyenIsSayisi",
                        "TahsilatSayisi",
                        "GiderSayisi",
                        "Notlar"
                    FROM "LegacyImportBilgisi"
                    ORDER BY "Id" DESC
                    LIMIT 1
                    """)
                .FirstOrDefaultAsync();

            return Ok(new
            {
                Gruplar = gruplar,
                SonImport = sonImport
            });
        }

        [HttpGet]
        public async Task<IActionResult> Liste(
            [FromQuery] string? tur,
            [FromQuery] string? q,
            [FromQuery] int limit = 200)
        {
            limit = Math.Clamp(limit, 1, 500);
            var turFilter = (tur ?? string.Empty).Trim();
            var qFilter = (q ?? string.Empty).Trim();

            var rows = await _db.Database
                .SqlQuery<LegacyArsivKayitDto>($"""
                    SELECT
                        "Id",
                        "Tur",
                        "LegacyId",
                        "KayitTarihi",
                        "JsonData"::text AS "JsonData"
                    FROM "LegacyArsivKayitlari"
                    WHERE
                        ({turFilter} = '' OR "Tur" = {turFilter})
                        AND
                        ({qFilter} = '' OR "JsonData"::text ILIKE '%' || {qFilter} || '%')
                    ORDER BY "Id" DESC
                    LIMIT {limit}
                    """)
                .ToListAsync();

            foreach (var row in rows)
            {
                row.JsonData = RedactSensitiveJson(row.JsonData);
            }

            return Ok(rows);
        }
        private static string RedactSensitiveJson(string json)
        {
            try
            {
                var node = JsonNode.Parse(json);
                RedactNode(node);
                return node?.ToJsonString() ?? "{}";
            }
            catch
            {
                return "{}";
            }
        }

        private static void RedactNode(JsonNode? node)
        {
            if (node is JsonObject obj)
            {
                foreach (var key in obj.Select(x => x.Key).ToArray())
                {
                    if (key.Equals("password", StringComparison.OrdinalIgnoreCase) ||
                        key.Equals("pass", StringComparison.OrdinalIgnoreCase) ||
                        key.Contains("secret", StringComparison.OrdinalIgnoreCase) ||
                        key.Contains("token", StringComparison.OrdinalIgnoreCase) ||
                        key.Equals("apiKey", StringComparison.OrdinalIgnoreCase))
                    {
                        obj[key] = "[REDACTED]";
                        continue;
                    }

                    RedactNode(obj[key]);
                }
            }
            else if (node is JsonArray array)
            {
                foreach (var item in array) RedactNode(item);
            }
        }
    }

    public class LegacyArsivOzetDto
    {
        public string Tur { get; set; } = string.Empty;
        public int KayitSayisi { get; set; }
    }

    public class LegacyArsivKayitDto
    {
        public long Id { get; set; }
        public string Tur { get; set; } = string.Empty;
        public long? LegacyId { get; set; }
        public DateTime KayitTarihi { get; set; }
        public string JsonData { get; set; } = "{}";
    }

    public class LegacyImportBilgisiDto
    {
        public int Id { get; set; }
        public string DosyaAdi { get; set; } = string.Empty;
        public DateTime ImportTarihi { get; set; }
        public int DoktorSayisi { get; set; }
        public int TeknisyenSayisi { get; set; }
        public int IsSayisi { get; set; }
        public int BekleyenIsSayisi { get; set; }
        public int TahsilatSayisi { get; set; }
        public int GiderSayisi { get; set; }
        public string? Notlar { get; set; }
    }
}
