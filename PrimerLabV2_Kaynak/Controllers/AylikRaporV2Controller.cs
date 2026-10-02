using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;

namespace PrimerLabV2.Controllers;

[ApiController]
[Route("api/aylik-rapor-v2")]
public sealed class AylikRaporV2Controller : ControllerBase
{
    private readonly PrimerLabDbContext _db;
    private static readonly string[] Currencies = { "TRY", "EUR", "USD" };

    public AylikRaporV2Controller(PrimerLabDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<IActionResult> Get(
        [FromQuery] int yil,
        [FromQuery] int ay = 0,
        [FromQuery] string paraBirimi = "ALL")
    {
        if (yil < 2020 || yil > 2100)
            return BadRequest("Yıl geçersiz.");

        if (ay < 0 || ay > 12)
            return BadRequest("Ay 0-12 aralığında olmalıdır.");

        var currency = (paraBirimi ?? "ALL").Trim().ToUpperInvariant();
        if (currency != "ALL" && !Currencies.Contains(currency))
            return BadRequest("Para birimi ALL, TRY, EUR veya USD olmalıdır.");

        var yearStart = UtcDate(yil, 1, 1);
        var yearEnd = yearStart.AddYears(1);

        var rangeStart = ay == 0 ? yearStart : UtcDate(yil, ay, 1);
        var rangeEnd = ay == 0 ? yearEnd : rangeStart.AddMonths(1);

        var monthlyJobs = await _db.Database.SqlQuery<ReportMonthCurrencyRow>($"""
            WITH completed AS
            (
                SELECT
                    s."Id",
                    COALESCE(s."ParaBirimi",'TRY') AS "ParaBirimi",
                    s."OlusturmaTarihi" AS "GelisTarihi"
                FROM "Siparisler" s
                INNER JOIN "SiparisDurumGecmisi" g ON g."SiparisId"=s."Id"
                WHERE g."YeniDurum" IN ('Tamamlandı','Teslim')
                  -- Bugün hâlâ tamamlanmış olmalı; tamamlandıktan sonra geri alınan
                  -- işler önceden ciroda sayılmaya devam ediyordu.
                  AND s."Durum" IN ('Tamamlandı','Teslim')
                  AND s."OlusturmaTarihi">={yearStart}
                  AND s."OlusturmaTarihi"<{yearEnd}
                  AND COALESCE(s."Silindi",false)=false
                GROUP BY s."Id", s."OlusturmaTarihi", COALESCE(s."ParaBirimi",'TRY')
            )
            SELECT
                EXTRACT(MONTH FROM c."GelisTarihi")::int AS "Ay",
                c."ParaBirimi",
                COUNT(DISTINCT c."Id")::int AS "IsSayisi",
                COALESCE(SUM(k."Adet"),0)::int AS "UyeSayisi",
                COALESCE(SUM(k."Adet" * k."BirimFiyat"),0)::numeric AS "Tutar"
            FROM completed c
            LEFT JOIN "SiparisKalemleri" k ON k."SiparisId"=c."Id"
            GROUP BY EXTRACT(MONTH FROM c."GelisTarihi"), c."ParaBirimi"
            ORDER BY "Ay", c."ParaBirimi"
            """).ToListAsync();

        var monthlyPayments = await _db.Database.SqlQuery<ReportMonthCurrencyRow>($"""
            SELECT
                EXTRACT(MONTH FROM "Tarih")::int AS "Ay",
                COALESCE("ParaBirimi",'TRY') AS "ParaBirimi",
                COUNT(*)::int AS "IsSayisi",
                0::int AS "UyeSayisi",
                COALESCE(SUM("Tutar"),0)::numeric AS "Tutar"
            FROM "Tahsilatlar"
            WHERE "Tarih">={yearStart} AND "Tarih"<{yearEnd}
            GROUP BY EXTRACT(MONTH FROM "Tarih"), COALESCE("ParaBirimi",'TRY')
            ORDER BY "Ay", "ParaBirimi"
            """).ToListAsync();

        var monthlyExpenses = await _db.Database.SqlQuery<ReportMonthTryRow>($"""
            SELECT
                EXTRACT(MONTH FROM "Tarih")::int AS "Ay",
                COUNT(*)::int AS "KayitSayisi",
                COALESCE(SUM("Tutar"),0)::numeric AS "Tutar"
            FROM "Giderler"
            WHERE "Tarih">={yearStart} AND "Tarih"<{yearEnd}
            GROUP BY EXTRACT(MONTH FROM "Tarih")
            ORDER BY "Ay"
            """).ToListAsync();

        var doctorRows = await _db.Database.SqlQuery<ReportDoctorCurrencyRow>($"""
            WITH completed AS
            (
                SELECT
                    s."Id",
                    p."HekimId",
                    s."OlusturmaTarihi" AS "GelisTarihi",
                    COALESCE(s."ParaBirimi",'TRY') AS "ParaBirimi"
                FROM "Siparisler" s
                INNER JOIN "Hastalar" p ON p."Id"=s."HastaId"
                INNER JOIN "SiparisDurumGecmisi" g ON g."SiparisId"=s."Id"
                WHERE g."YeniDurum" IN ('Tamamlandı','Teslim')
                  AND s."Durum" IN ('Tamamlandı','Teslim')
                  AND s."OlusturmaTarihi">={rangeStart}
                  AND s."OlusturmaTarihi"<{rangeEnd}
                  AND COALESCE(s."Silindi",false)=false
                GROUP BY s."Id", p."HekimId", s."OlusturmaTarihi", COALESCE(s."ParaBirimi",'TRY')
            )
            SELECT
                h."Id" AS "HekimId",
                h."AdSoyad" AS "HekimAdi",
                h."KlinikAdi",
                c."ParaBirimi",
                COUNT(DISTINCT c."Id")::int AS "IsSayisi",
                COALESCE(SUM(k."Adet"),0)::int AS "UyeSayisi",
                COALESCE(SUM(k."Adet" * k."BirimFiyat"),0)::numeric AS "Tutar"
            FROM completed c
            INNER JOIN "Hekimler" h ON h."Id"=c."HekimId"
            LEFT JOIN "SiparisKalemleri" k ON k."SiparisId"=c."Id"
            GROUP BY h."Id",h."AdSoyad",h."KlinikAdi",c."ParaBirimi"
            ORDER BY h."AdSoyad",c."ParaBirimi"
            """).ToListAsync();

        var paymentTypes = await _db.Database.SqlQuery<ReportPaymentTypeRow>($"""
            SELECT
                COALESCE(NULLIF(BTRIM("OdemeTuru"),''),'Diğer') AS "OdemeTuru",
                COALESCE("ParaBirimi",'TRY') AS "ParaBirimi",
                COUNT(*)::int AS "KayitSayisi",
                COALESCE(SUM("Tutar"),0)::numeric AS "Tutar"
            FROM "Tahsilatlar"
            WHERE "Tarih">={rangeStart} AND "Tarih"<{rangeEnd}
            GROUP BY COALESCE(NULLIF(BTRIM("OdemeTuru"),''),'Diğer'),
                     COALESCE("ParaBirimi",'TRY')
            ORDER BY "OdemeTuru","ParaBirimi"
            """).ToListAsync();

        var expenseCategories = await _db.Database.SqlQuery<ReportCategoryRow>($"""
            SELECT
                COALESCE(NULLIF(BTRIM("Kategori"),''),'Diğer') AS "Kategori",
                COUNT(*)::int AS "KayitSayisi",
                COALESCE(SUM("Tutar"),0)::numeric AS "Tutar"
            FROM "Giderler"
            WHERE "Tarih">={rangeStart} AND "Tarih"<{rangeEnd}
            GROUP BY COALESCE(NULLIF(BTRIM("Kategori"),''),'Diğer')
            ORDER BY "Tutar" DESC,"Kategori"
            """).ToListAsync();

        var periodJobTotals = SumCurrencies(
            monthlyJobs.Where(x => InPeriod(x.Ay, ay)),
            x => x.ParaBirimi,
            x => x.Tutar);

        var periodPaymentTotals = SumCurrencies(
            monthlyPayments.Where(x => InPeriod(x.Ay, ay)),
            x => x.ParaBirimi,
            x => x.Tutar);

        var periodExpenseTry = monthlyExpenses
            .Where(x => InPeriod(x.Ay, ay))
            .Sum(x => x.Tutar);

        var netCash = EmptyMoney();
        netCash["TRY"] = periodPaymentTotals["TRY"] - periodExpenseTry;
        netCash["EUR"] = periodPaymentTotals["EUR"];
        netCash["USD"] = periodPaymentTotals["USD"];

        var monthRows = Enumerable.Range(1, 12)
            .Select(m =>
            {
                var jobs = SumCurrencies(
                    monthlyJobs.Where(x => x.Ay == m),
                    x => x.ParaBirimi,
                    x => x.Tutar);

                var payments = SumCurrencies(
                    monthlyPayments.Where(x => x.Ay == m),
                    x => x.ParaBirimi,
                    x => x.Tutar);

                var expense = monthlyExpenses
                    .Where(x => x.Ay == m)
                    .Sum(x => x.Tutar);

                var net = EmptyMoney();
                net["TRY"] = payments["TRY"] - expense;
                net["EUR"] = payments["EUR"];
                net["USD"] = payments["USD"];

                return new
                {
                    ay = m,
                    isSayisi = monthlyJobs.Where(x => x.Ay == m).Sum(x => x.IsSayisi),
                    uyeSayisi = monthlyJobs.Where(x => x.Ay == m).Sum(x => x.UyeSayisi),
                    tamamlanan = jobs,
                    tahsilat = payments,
                    giderTry = expense,
                    netNakit = net
                };
            })
            .ToList();

        var doctorGrouped = doctorRows
            .GroupBy(x => new { x.HekimId, x.HekimAdi, x.KlinikAdi })
            .Select(g =>
            {
                var totals = EmptyMoney();
                foreach (var row in g)
                {
                    var c = NormalizeCurrency(row.ParaBirimi);
                    totals[c] += row.Tutar;
                }

                return new
                {
                    hekimId = g.Key.HekimId,
                    hekimAdi = g.Key.HekimAdi,
                    klinikAdi = g.Key.KlinikAdi,
                    isSayisi = g.Sum(x => x.IsSayisi),
                    uyeSayisi = g.Sum(x => x.UyeSayisi),
                    tutarlar = totals
                };
            })
            .OrderByDescending(x => ValueForSort(x.tutarlar, currency))
            .ThenBy(x => x.hekimAdi)
            .ToList();

        var filteredJobTotal = currency == "ALL"
            ? periodJobTotals
            : OnlyCurrency(periodJobTotals, currency);

        var filteredPaymentTotal = currency == "ALL"
            ? periodPaymentTotals
            : OnlyCurrency(periodPaymentTotals, currency);

        var filteredNet = currency == "ALL"
            ? netCash
            : OnlyCurrency(netCash, currency);

        return Ok(new
        {
            yil,
            ay,
            paraBirimi = currency,
            period = new
            {
                baslangic = rangeStart,
                bitis = rangeEnd.AddTicks(-1)
            },
            summary = new
            {
                isSayisi = monthlyJobs.Where(x => InPeriod(x.Ay, ay)).Sum(x => x.IsSayisi),
                uyeSayisi = monthlyJobs.Where(x => InPeriod(x.Ay, ay)).Sum(x => x.UyeSayisi),
                tamamlanan = filteredJobTotal,
                tahsilat = filteredPaymentTotal,
                giderTry = periodExpenseTry,
                netNakit = filteredNet
            },
            aylar = monthRows,
            hekimler = doctorGrouped,
            odemeTurleri = paymentTypes,
            giderKategorileri = expenseCategories
        });
    }

    private static bool InPeriod(int rowMonth, int selectedMonth) =>
        selectedMonth == 0 || rowMonth == selectedMonth;

    private static DateTime UtcDate(int year, int month, int day) =>
        DateTime.SpecifyKind(new DateTime(year, month, day), DateTimeKind.Utc);

    private static string NormalizeCurrency(string? value)
    {
        var c = string.IsNullOrWhiteSpace(value) ? "TRY" : value.Trim().ToUpperInvariant();
        return c is "TRY" or "EUR" or "USD" ? c : "TRY";
    }

    private static Dictionary<string, decimal> EmptyMoney() =>
        new()
        {
            ["TRY"] = 0,
            ["EUR"] = 0,
            ["USD"] = 0
        };

    private static Dictionary<string, decimal> OnlyCurrency(
        Dictionary<string, decimal> source,
        string currency)
    {
        var result = EmptyMoney();
        if (result.ContainsKey(currency))
            result[currency] = source.GetValueOrDefault(currency);
        return result;
    }

    private static Dictionary<string, decimal> SumCurrencies<T>(
        IEnumerable<T> rows,
        Func<T, string> currency,
        Func<T, decimal> amount)
    {
        var result = EmptyMoney();
        foreach (var row in rows)
        {
            var c = NormalizeCurrency(currency(row));
            result[c] += amount(row);
        }
        return result;
    }

    private static decimal ValueForSort(
        Dictionary<string, decimal> values,
        string selectedCurrency)
    {
        if (selectedCurrency != "ALL")
            return values.GetValueOrDefault(selectedCurrency);

        // Kur dönüşümü yapılmadığı için sadece sıralama amacıyla toplam nominal değer.
        return values.Values.Sum();
    }
}

public sealed class ReportMonthCurrencyRow
{
    public int Ay { get; set; }
    public string ParaBirimi { get; set; } = "TRY";
    public int IsSayisi { get; set; }
    public int UyeSayisi { get; set; }
    public decimal Tutar { get; set; }
}

public sealed class ReportMonthTryRow
{
    public int Ay { get; set; }
    public int KayitSayisi { get; set; }
    public decimal Tutar { get; set; }
}

public sealed class ReportDoctorCurrencyRow
{
    public int HekimId { get; set; }
    public string HekimAdi { get; set; } = "";
    public string? KlinikAdi { get; set; }
    public string ParaBirimi { get; set; } = "TRY";
    public int IsSayisi { get; set; }
    public int UyeSayisi { get; set; }
    public decimal Tutar { get; set; }
}

public sealed class ReportPaymentTypeRow
{
    public string OdemeTuru { get; set; } = "Diğer";
    public string ParaBirimi { get; set; } = "TRY";
    public int KayitSayisi { get; set; }
    public decimal Tutar { get; set; }
}

public sealed class ReportCategoryRow
{
    public string Kategori { get; set; } = "Diğer";
    public int KayitSayisi { get; set; }
    public decimal Tutar { get; set; }
}
