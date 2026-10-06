using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;

namespace PrimerLabV2.Controllers;

// Cari, Kasa / Arşiv ve Primer AI aynı bakiye kurallarını buradan kullanır.
//
// Bir işin cariye yazılma zamanı tamamlanma tarihidir (geliş tarihi değil).
// Önceden dönem sınırı geliş tarihine göre çizildiği için, dönem kapanmadan önce
// gelip kapanıştan sonra tamamlanan işler hiçbir döneme girmiyor ve hekime hiç
// faturalanmıyordu. Ayrıca kapatılmış bir dönemin anlık görüntüsüne (snapshot)
// giren işler, sonradan tekrar tamamlansa bile ikinci kez faturalanmaz.
internal static class CariKurallari
{
    // Hekimin geri alınmamış dönem kapanışlarına giren iş numaraları.
    // Yalnız bu uygulamanın yazdığı "Id" alanı okunur; eski sistemden aktarılan
    // dönemlerdeki "id" değerleri eski sistemin numaralarıdır, yeni işlerle eşleşmez.
    public static async Task<HashSet<int>> ArsivlenmisIsler(PrimerLabDbContext db, int hekimId)
    {
        var snapshots = await db.Database.SqlQuery<string>($"""
            SELECT COALESCE("IslerSnapshotJson",'[]') AS "Value"
            FROM "CariDonemleri"
            WHERE "HekimId"={hekimId} AND COALESCE("GeriAlindi",false)=false
            """).ToListAsync();

        var ids = new HashSet<int>();
        foreach (var json in snapshots)
        {
            try
            {
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.ValueKind != JsonValueKind.Array) continue;

                foreach (var item in doc.RootElement.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.Object &&
                        item.TryGetProperty("Id", out var id) &&
                        id.ValueKind == JsonValueKind.Number &&
                        id.TryGetInt32(out var value))
                    {
                        ids.Add(value);
                    }
                }
            }
            catch (JsonException)
            {
                // Bozuk bir anlık görüntü cari ekranını kilitlememeli.
            }
        }

        return ids;
    }

    // Tahsilat tarihi kapatılmış bir döneme düşüyorsa hata mesajı döner.
    // Böyle bir tahsilat ne kapanmış dönemin anlık görüntüsünde ne de açık dönemde
    // görünür; hekimin bakiyesinden hiç düşmezdi.
    public static async Task<string?> KapaliDonemHatasi(PrimerLabDbContext db, int hekimId, DateTime tarih)
    {
        var kapanis = await db.Database.SqlQuery<DateTime?>($"""
            SELECT MAX("KapanisTarihi") AS "Value"
            FROM "CariDonemleri"
            WHERE "HekimId"={hekimId} AND COALESCE("GeriAlindi",false)=false
            """).SingleAsync();

        if (kapanis.HasValue && tarih <= kapanis.Value)
        {
            var gun = kapanis.Value.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture);
            return $"Bu tarih {gun} tarihinde kapatılmış döneme düşüyor. Tahsilat tarihini kapanıştan sonraki bir gün seçin veya önce son dönemi geri alın.";
        }

        return null;
    }
}
