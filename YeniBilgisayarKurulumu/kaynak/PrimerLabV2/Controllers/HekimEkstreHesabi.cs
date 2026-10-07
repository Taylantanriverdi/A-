using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;

namespace PrimerLabV2.Controllers;

// Hekim aylık ekstresi (Kasa / Arşiv).
//
// Hekimin cari hesabı bir defter gibi kurulur: tamamlanan işler borç, tahsilatlar alacak yazılır.
// Kapatılmış cari dönemler "kontrol noktası"dır: kapanışta kaydedilen bakiye (devredildiyse) o tarihteki
// kesin bakiyedir; hesaplanan bakiyeyle farkı varsa (elle düzeltilmiş kapanış, devredilmeyen bakiye,
// eski sistemden aktarılan dönem) ekstrede "dönem kapanışı düzeltmesi" satırı olarak görünür.
// Böylece aylık ekstrenin "ay sonu bakiyesi", Kasa / Arşiv'in açık dönem bakiyesiyle her zaman aynıdır.
//
// Bir ayın ekstresinde yalnız o ay tamamlanan işler (hastalar) ve o ay yapılan tahsilatlar listelenir;
// önceki ayların tamamı tek bir "devir" satırında toplanır (borç ise eklenir, fazla ödeme ise düşülür).
// Tarihler Türkiye saatine (UTC+3) göre gün/aya yerleştirilir.
internal static class HekimEkstreHesabi
{
    public static readonly string[] ParaBirimleri = { "TRY", "EUR", "USD" };
    private static readonly TimeSpan TurkiyeFarki = TimeSpan.FromHours(3);

    public static Dictionary<string, decimal> BosPara() => new() { ["TRY"] = 0, ["EUR"] = 0, ["USD"] = 0 };

    public static string ParaBirimi(string? v)
    {
        var c = string.IsNullOrWhiteSpace(v) ? "TRY" : v.Trim().ToUpperInvariant();
        return c is "TRY" or "EUR" or "USD" ? c : "TRY";
    }

    public static DateOnly YerelGun(DateTime utc)
    {
        var u = utc.Kind == DateTimeKind.Local ? utc.ToUniversalTime() : utc;
        return DateOnly.FromDateTime(u + TurkiyeFarki);
    }

    public static (int yil, int ay) BuAy()
    {
        var g = YerelGun(DateTime.UtcNow);
        return (g.Year, g.Month);
    }

    // ------------------------------------------------------------------ veri

    public sealed class IsSatiri
    {
        public int Id { get; set; }
        public int HekimId { get; set; }
        public string HastaAdi { get; set; } = "";
        public string IsTuru { get; set; } = "";
        public int Adet { get; set; }
        public decimal Tutar { get; set; }
        public string ParaBirimi { get; set; } = "TRY";
        public DateTime TamamlanmaTarihi { get; set; }
        public DateTime GelisTarihi { get; set; }
    }

    public sealed class DonemSatiri
    {
        public int Id { get; set; }
        public int HekimId { get; set; }
        public DateTime KapanisTarihi { get; set; }
        public string BakiyelerJson { get; set; } = "{}";
        public bool DevirEklendi { get; set; }
        public string IslerSnapshotJson { get; set; } = "[]";
    }

    /// <summary>Defterdeki tek hareket: iş (borç) ya da tahsilat (alacak).</summary>
    public sealed class Hareket
    {
        public bool IsMi { get; set; }
        public int Id { get; set; }
        public DateOnly Tarih { get; set; }
        public DateOnly? GelisTarihi { get; set; }
        public string HastaAdi { get; set; } = "";
        public string IsTuru { get; set; } = "";
        public int Adet { get; set; }
        public decimal Tutar { get; set; }
        public string ParaBirimi { get; set; } = "TRY";
        public string? OdemeTuru { get; set; }
        public string? IslemNo { get; set; }
        public string? Aciklama { get; set; }
        /// <summary>Kapatılmış bir döneme ait (tahsilat silinemez / iş kapanışta arşivlenmiş).</summary>
        public bool KapaliDonemde { get; set; }
        public int Bolum { get; set; }
    }

    public sealed class KontrolNoktasi
    {
        public int DonemId { get; set; }
        public DateOnly Tarih { get; set; }
        public Dictionary<string, decimal> Bakiye { get; set; } = BosPara();
        public bool DevirEklendi { get; set; }
    }

    public sealed class Defter
    {
        public int HekimId { get; set; }
        /// <summary>Bölüm k: k. kontrol noktasından önceki hareketler; son bölüm açık dönemdir.</summary>
        public List<List<Hareket>> Bolumler { get; } = new();
        public List<KontrolNoktasi> Noktalar { get; } = new();
    }

    public static async Task<Dictionary<int, Defter>> DefterleriKur(PrimerLabDbContext db, int hekimId, CancellationToken ct = default)
    {
        var isler = await db.Database.SqlQuery<IsSatiri>($"""
            SELECT
                s."Id",
                p."HekimId",
                COALESCE(p."AdSoyad",'-') AS "HastaAdi",
                COALESCE((SELECT string_agg(k."IsTuru" || CASE WHEN k."Adet">1 THEN ' ×' || k."Adet"::text ELSE '' END, ', ' ORDER BY k."Id")
                          FROM "SiparisKalemleri" k WHERE k."SiparisId"=s."Id"),'-') AS "IsTuru",
                COALESCE((SELECT SUM(k."Adet") FROM "SiparisKalemleri" k WHERE k."SiparisId"=s."Id"),0)::int AS "Adet",
                COALESCE((SELECT SUM(k."Adet" * k."BirimFiyat") FROM "SiparisKalemleri" k WHERE k."SiparisId"=s."Id"),0)::numeric AS "Tutar",
                COALESCE(s."ParaBirimi",'TRY') AS "ParaBirimi",
                COALESCE(
                    (SELECT MAX(g."DegisimTarihi") FROM "SiparisDurumGecmisi" g
                     WHERE g."SiparisId"=s."Id" AND g."YeniDurum" IN ('Tamamlandı','Teslim')),
                    s."OlusturmaTarihi") AS "TamamlanmaTarihi",
                s."OlusturmaTarihi" AS "GelisTarihi"
            FROM "Siparisler" s
            INNER JOIN "Hastalar" p ON p."Id"=s."HastaId"
            WHERE COALESCE(s."Silindi",false)=false
              AND s."Durum" IN ('Tamamlandı','Teslim')
              AND ({hekimId}=0 OR p."HekimId"={hekimId})
            """).ToListAsync(ct);

        var odemeler = await db.Database.SqlQuery<KasaArsivPaymentRow>($"""
            SELECT "Id","HekimId","Tutar",COALESCE("ParaBirimi",'TRY') AS "ParaBirimi",
                   "Tarih","OdemeTuru","IslemNo","Aciklama","OlusturmaTarihi"
            FROM "Tahsilatlar"
            WHERE ({hekimId}=0 OR "HekimId"={hekimId})
            """).ToListAsync(ct);

        var donemler = await db.Database.SqlQuery<DonemSatiri>($"""
            SELECT "Id","HekimId","KapanisTarihi",COALESCE(NULLIF("BakiyelerJson",''),'[]') AS "BakiyelerJson",
                   COALESCE("DevirEklendi",false) AS "DevirEklendi",
                   COALESCE("IslerSnapshotJson",'[]') AS "IslerSnapshotJson"
            FROM "CariDonemleri"
            WHERE COALESCE("GeriAlindi",false)=false
              AND ({hekimId}=0 OR "HekimId"={hekimId})
            ORDER BY "KapanisTarihi","Id"
            """).ToListAsync(ct);

        var hekimler = isler.Select(x => x.HekimId).Concat(odemeler.Select(x => x.HekimId)).Concat(donemler.Select(x => x.HekimId)).ToHashSet();
        if (hekimId > 0) hekimler.Add(hekimId);

        var sonuc = new Dictionary<int, Defter>();
        foreach (var h in hekimler)
            sonuc[h] = Kur(h,
                isler.Where(x => x.HekimId == h).ToList(),
                odemeler.Where(x => x.HekimId == h).ToList(),
                donemler.Where(x => x.HekimId == h).ToList());
        return sonuc;
    }

    private static Defter Kur(int hekimId, List<IsSatiri> isler, List<KasaArsivPaymentRow> odemeler, List<DonemSatiri> donemler)
    {
        var d = new Defter { HekimId = hekimId };
        var kapanislar = donemler.Select(x => x.KapanisTarihi).ToList();
        for (var i = 0; i <= donemler.Count; i++) d.Bolumler.Add(new List<Hareket>());

        // Kapanış tarihi kullanıcının seçtiği gündür (UTC gün sonu olarak saklanır).
        var noktaGunleri = donemler.Select(x => DateOnly.FromDateTime(x.KapanisTarihi)).ToList();
        foreach (var x in donemler)
        {
            var bakiye = ParaHaritasi(x.BakiyelerJson);
            d.Noktalar.Add(new KontrolNoktasi
            {
                DonemId = x.Id,
                Tarih = DateOnly.FromDateTime(x.KapanisTarihi),
                DevirEklendi = x.DevirEklendi,
                Bakiye = x.DevirEklendi ? bakiye : BosPara()
            });
        }

        // Kapanışta arşivlenen işler, kapanıştaki tutar ve hasta bilgisiyle o döneme yazılır
        // (sonradan fiyatı değişse ya da iş silinse bile kapanmış dönem değişmez).
        var arsivde = new HashSet<int>();
        for (var k = 0; k < donemler.Count; k++)
        {
            foreach (var s in AnlikIsler(donemler[k].IslerSnapshotJson))
            {
                if (!arsivde.Add(s.Id)) continue;
                d.Bolumler[k].Add(new Hareket
                {
                    IsMi = true, Id = s.Id, HastaAdi = s.HastaAdi, IsTuru = s.IsTuru, Adet = s.Adet,
                    Tutar = s.Tutar, ParaBirimi = ParaBirimi(s.ParaBirimi), KapaliDonemde = true, Bolum = k,
                    Tarih = Sinirla(YerelGun(s.TamamlanmaTarihi ?? donemler[k].KapanisTarihi), noktaGunleri, k),
                    GelisTarihi = s.GelisTarihi is { } g ? YerelGun(g) : null
                });
            }
        }

        foreach (var x in isler)
        {
            if (arsivde.Contains(x.Id)) continue;
            var k = BolumBul(kapanislar, x.TamamlanmaTarihi);
            d.Bolumler[k].Add(new Hareket
            {
                IsMi = true, Id = x.Id, HastaAdi = x.HastaAdi, IsTuru = x.IsTuru, Adet = x.Adet,
                Tutar = x.Tutar, ParaBirimi = ParaBirimi(x.ParaBirimi), KapaliDonemde = k < donemler.Count, Bolum = k,
                Tarih = Sinirla(YerelGun(x.TamamlanmaTarihi), noktaGunleri, k), GelisTarihi = YerelGun(x.GelisTarihi)
            });
        }

        foreach (var x in odemeler)
        {
            var k = BolumBul(kapanislar, x.Tarih);
            d.Bolumler[k].Add(new Hareket
            {
                IsMi = false, Id = x.Id, Tutar = x.Tutar, ParaBirimi = ParaBirimi(x.ParaBirimi),
                OdemeTuru = x.OdemeTuru, IslemNo = x.IslemNo, Aciklama = x.Aciklama,
                KapaliDonemde = k < donemler.Count, Bolum = k,
                Tarih = Sinirla(YerelGun(x.Tarih), noktaGunleri, k)
            });
        }

        foreach (var b in d.Bolumler)
            b.Sort((a, c) => a.Tarih != c.Tarih ? a.Tarih.CompareTo(c.Tarih)
                : a.IsMi != c.IsMi ? (a.IsMi ? -1 : 1) : a.Id.CompareTo(c.Id));
        return d;
    }

    // Hareketin düştüğü bölüm: tarihi ≤ kapanış olan ilk dönem; hiçbiri değilse açık dönem.
    private static int BolumBul(List<DateTime> kapanislar, DateTime tarih)
    {
        for (var i = 0; i < kapanislar.Count; i++)
            if (tarih <= kapanislar[i]) return i;
        return kapanislar.Count;
    }

    // Gün, bölümünün tarih aralığına sıkıştırılır (gece yarısına yakın saat farkları
    // hareketi kapanışın yanlış tarafındaki aya taşımasın).
    private static DateOnly Sinirla(DateOnly gun, List<DateOnly> noktalar, int k)
    {
        if (k > 0 && gun < noktalar[k - 1]) gun = noktalar[k - 1];
        if (k < noktalar.Count && gun > noktalar[k]) gun = noktalar[k];
        return gun;
    }

    // ------------------------------------------------------------------ ekstre

    public sealed class Duzeltme
    {
        public int DonemId { get; set; }
        public DateOnly Tarih { get; set; }
        public Dictionary<string, decimal> Tutarlar { get; set; } = BosPara();
        public string Aciklama { get; set; } = "";
    }

    public sealed class Ekstre
    {
        public DateOnly Baslangic { get; set; }
        public DateOnly Bitis { get; set; }
        public Dictionary<string, decimal> Devir { get; set; } = BosPara();
        public Dictionary<string, decimal> IsToplam { get; set; } = BosPara();
        public Dictionary<string, decimal> TahsilatToplam { get; set; } = BosPara();
        public Dictionary<string, decimal> DuzeltmeToplam { get; set; } = BosPara();
        public Dictionary<string, decimal> Kapanis { get; set; } = BosPara();
        public List<Hareket> Isler { get; } = new();
        public List<Hareket> Odemeler { get; } = new();
        public List<Duzeltme> Duzeltmeler { get; } = new();
        public List<KontrolNoktasi> KapananDonemler { get; } = new();
    }

    public static Ekstre Hesapla(Defter d, DateOnly bas, DateOnly bit)
    {
        var e = new Ekstre { Baslangic = bas, Bitis = bit };
        var devir = BosPara();
        var ay = BosPara();

        for (var k = 0; k < d.Bolumler.Count; k++)
        {
            foreach (var h in d.Bolumler[k])
            {
                var isaret = h.IsMi ? 1 : -1;
                if (h.Tarih < bas) devir[h.ParaBirimi] += isaret * h.Tutar;
                else if (h.Tarih <= bit)
                {
                    ay[h.ParaBirimi] += isaret * h.Tutar;
                    if (h.IsMi) { e.Isler.Add(h); e.IsToplam[h.ParaBirimi] += h.Tutar; }
                    else { e.Odemeler.Add(h); e.TahsilatToplam[h.ParaBirimi] += h.Tutar; }
                }
            }

            if (k >= d.Noktalar.Count) break;
            var n = d.Noktalar[k];
            if (n.Tarih < bas)
            {
                // Kapanış kesin bakiyedir; ondan önceki her şey bu bakiyede toplanmıştır.
                foreach (var c in ParaBirimleri) devir[c] = n.Bakiye[c];
            }
            else if (n.Tarih <= bit)
            {
                e.KapananDonemler.Add(n);
                var fark = BosPara();
                var var_ = false;
                foreach (var c in ParaBirimleri)
                {
                    fark[c] = Math.Round(n.Bakiye[c] - (devir[c] + ay[c]), 2);
                    if (fark[c] != 0) var_ = true;
                }
                if (var_)
                {
                    foreach (var c in ParaBirimleri) { ay[c] += fark[c]; e.DuzeltmeToplam[c] += fark[c]; }
                    e.Duzeltmeler.Add(new Duzeltme
                    {
                        DonemId = n.DonemId, Tarih = n.Tarih, Tutarlar = fark,
                        Aciklama = n.DevirEklendi
                            ? "Dönem kapanışında belirlenen bakiyeye göre düzeltme"
                            : "Dönem kapanışında bakiye devredilmedi (sıfırlandı)"
                    });
                }
            }
            else break;
        }

        foreach (var c in ParaBirimleri)
        {
            e.Devir[c] = Math.Round(devir[c], 2);
            e.Kapanis[c] = Math.Round(devir[c] + ay[c], 2);
        }
        return e;
    }

    public static Dictionary<string, decimal> GuncelBakiye(Defter d) =>
        Hesapla(d, DateOnly.MinValue.AddDays(1), DateOnly.MaxValue).Kapanis;

    public static (DateOnly bas, DateOnly bit) AyAraligi(int yil, int ay)
    {
        var bas = new DateOnly(yil, ay, 1);
        return (bas, bas.AddMonths(1).AddDays(-1));
    }

    public static string Gun(DateOnly g) => g.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    // ------------------------------------------------------------------ yardımcılar

    private sealed class AnlikIs
    {
        public int Id;
        public string HastaAdi = "";
        public string IsTuru = "";
        public int Adet;
        public decimal Tutar;
        public string ParaBirimi = "TRY";
        public DateTime? TamamlanmaTarihi;
        public DateTime? GelisTarihi;
    }

    // Kapanış anlık görüntüsündeki işler. Yalnız bu uygulamanın yazdığı "Id" alanlı kayıtlar okunur
    // (CariKurallari.ArsivlenmisIsler ile aynı kural); eski sistemden aktarılan dönemler kontrol
    // noktası bakiyesiyle hesaba girer.
    private static List<AnlikIs> AnlikIsler(string json)
    {
        var l = new List<AnlikIs>();
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return l;
            foreach (var x in doc.RootElement.EnumerateArray())
            {
                if (x.ValueKind != JsonValueKind.Object ||
                    !x.TryGetProperty("Id", out var id) || id.ValueKind != JsonValueKind.Number ||
                    !id.TryGetInt32(out var idv)) continue;
                l.Add(new AnlikIs
                {
                    Id = idv,
                    HastaAdi = Metin(x, "HastaAdi") ?? "-",
                    IsTuru = Metin(x, "IsTuru") ?? "-",
                    Tutar = x.TryGetProperty("Tutar", out var t) && t.ValueKind == JsonValueKind.Number ? t.GetDecimal() : 0,
                    ParaBirimi = Metin(x, "ParaBirimi") ?? "TRY",
                    TamamlanmaTarihi = Tarih(x, "TamamlanmaTarihi"),
                    GelisTarihi = Tarih(x, "TeslimTarihi")
                });
            }
        }
        catch (JsonException) { }
        return l;
    }

    private static string? Metin(JsonElement x, string ad) =>
        x.TryGetProperty(ad, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static DateTime? Tarih(JsonElement x, string ad)
    {
        if (!x.TryGetProperty(ad, out var v) || v.ValueKind != JsonValueKind.String || !v.TryGetDateTime(out var t)) return null;
        if (t.Year < 2001) return null;
        return t.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(t, DateTimeKind.Utc) : t.ToUniversalTime();
    }

    public static Dictionary<string, decimal> ParaHaritasi(string? json)
    {
        var r = BosPara();
        if (string.IsNullOrWhiteSpace(json)) return r;
        try
        {
            var m = JsonSerializer.Deserialize<Dictionary<string, decimal>>(json);
            if (m != null) foreach (var c in ParaBirimleri) if (m.TryGetValue(c, out var v)) r[c] = v;
        }
        catch { }
        return r;
    }
}
