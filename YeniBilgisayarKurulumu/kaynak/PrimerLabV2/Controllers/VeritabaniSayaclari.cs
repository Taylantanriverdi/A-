using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;

namespace PrimerLabV2.Controllers;

// Bazı uç noktalar (iş kalemi düzenleme, Kasa tahsilatı, Kasa dönem kapatma)
// Id'yi tablodaki MAX(Id)+1 ile kendileri üretir. Bu kayıtlar tablonun Id
// sayacını (sequence) ilerletmez; ardından sayacı kullanan normal bir ekleme
// (yeni sipariş, Cari tahsilatı, Cari dönem kapatma) aynı Id'yi almaya çalışıp
// "duplicate key" hatasıyla başarısız oluyordu.
//
// Bu yardımcı, sayacı tablodaki en büyük Id'nin gerisindeyse ileri alır; hiçbir
// zaman geri almaz. Yetki veya sayaç yoksa sessizce geçer (PL/pgSQL EXCEPTION
// bloğu kendi alt işlemini kullanır, dıştaki işlemi bozmaz).
internal static class VeritabaniSayaclari
{
    private static readonly HashSet<string> IzinliTablolar = new(StringComparer.Ordinal)
    {
        "SiparisKalemleri",
        "Tahsilatlar",
        "CariDonemleri"
    };

    public static async Task IleriAl(PrimerLabDbContext db, string tablo)
    {
        if (!IzinliTablolar.Contains(tablo))
            throw new ArgumentException("Bilinmeyen tablo.", nameof(tablo));

        // Tablo adı yalnız yukarıdaki sabit listeden gelir; kullanıcı girdisi içermez.
        var sql = $"""
            DO $sayac$
            DECLARE
                seq text := pg_get_serial_sequence('"{tablo}"', 'Id');
                en_buyuk bigint;
                son bigint;
                cagrildi boolean;
            BEGIN
                IF seq IS NULL THEN
                    RETURN;
                END IF;

                SELECT COALESCE(MAX("Id"), 0) INTO en_buyuk FROM "{tablo}";
                EXECUTE format('SELECT last_value, is_called FROM %s', seq) INTO son, cagrildi;

                IF NOT cagrildi THEN
                    son := son - 1;
                END IF;

                IF en_buyuk > son THEN
                    PERFORM setval(seq, en_buyuk, true);
                END IF;
            EXCEPTION WHEN OTHERS THEN
                NULL;
            END
            $sayac$;
            """;

        await db.Database.ExecuteSqlRawAsync(sql);
    }
}
