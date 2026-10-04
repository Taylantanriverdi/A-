using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;

namespace PrimerLabV2.Infrastructure;

/// <summary>
/// WhatsApp bildirimleri (dakikada bir kontrol):
///  - Hekime: işi laboratuvara alındı / tasarıma geçti / üretime alındı / tamamlandı (ayardan seçilir).
///  - Teknisyene: kendisine yeni iş atandı.
///  - Yöneticiye: her sabah belirlenen saatte günün özeti.
/// Durum geçmişi tablosu son işlenen kayıttan itibaren okunur (program yeniden başlasa da aynı bildirim
/// iki kez gitmez); onay ve teknisyen değişiklikleri işlerin anlık görüntüsü karşılaştırılarak bulunur.
/// </summary>
public sealed class WhatsAppBildirimServisi : BackgroundService
{
    private readonly IServiceScopeFactory _scope;
    private readonly WhatsAppServisi _wa;
    private readonly PortalKimlik _kimlik;
    private readonly ILogger<WhatsAppBildirimServisi> _log;
    private Dictionary<int, (string Onay, int? Tek)>? _goruntu;

    public WhatsAppBildirimServisi(IServiceScopeFactory scope, WhatsAppServisi wa, PortalKimlik kimlik, ILogger<WhatsAppBildirimServisi> log)
    {
        _scope = scope;
        _wa = wa;
        _kimlik = kimlik;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        try { await Task.Delay(TimeSpan.FromSeconds(45), ct); } catch (OperationCanceledException) { return; }
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await TurAsync(ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _log.LogWarning(ex, "WhatsApp bildirim kontrolü başarısız.");
            }
            try { await Task.Delay(TimeSpan.FromSeconds(60), ct); } catch (OperationCanceledException) { return; }
        }
    }

    private sealed class GecmisSatiri
    {
        public long Id { get; set; }
        public int SiparisId { get; set; }
        public string YeniDurum { get; set; } = "";
        public string Hasta { get; set; } = "";
        public string? Telefon { get; set; }
    }

    private sealed class IsSatiri
    {
        public int Id { get; set; }
        public string Onay { get; set; } = "";
        public int? TeknisyenId { get; set; }
        public string Hasta { get; set; } = "";
        public string? Telefon { get; set; }
        public string? Kalemler { get; set; }
        public DateTime? Termin { get; set; }
    }

    public async Task TurAsync(CancellationToken ct)
    {
        var a = _wa.Oku();
        if (!_wa.Hazir(a)) { _goruntu = null; return; }

        using var scope = _scope.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PrimerLabDbContext>();

        // ---- durum geçmişi (Tasarımda / Üretimde / Tamamlandı)
        if (a.SonGecmisId == 0)
        {
            var enSon = await db.Database.SqlQuery<long>($"""SELECT COALESCE(MAX("Id"),0)::bigint AS "Value" FROM "SiparisDurumGecmisi" """).SingleAsync(ct);
            _wa.Guncelle(x => x.SonGecmisId = Math.Max(enSon, 1));
        }
        else
        {
            var satirlar = await db.Database.SqlQuery<GecmisSatiri>($"""
                SELECT g."Id"::bigint AS "Id", g."SiparisId", g."YeniDurum", ha."AdSoyad" AS "Hasta", h."Telefon"
                FROM "SiparisDurumGecmisi" g JOIN "Siparisler" s ON s."Id"=g."SiparisId"
                JOIN "Hastalar" ha ON ha."Id"=s."HastaId" JOIN "Hekimler" h ON h."Id"=ha."HekimId"
                WHERE g."Id" > {a.SonGecmisId} ORDER BY g."Id" LIMIT 200
                """).ToListAsync(ct);
            foreach (var g in satirlar)
            {
                var olay = g.YeniDurum switch { "Tasarımda" => "Tasarımda", "Üretimde" => "Üretimde", "Tamamlandı" or "Teslim" => "Tamamlandı", _ => null };
                if (olay != null && a.HekimBildirim && a.HekimBildirimOlaylari.Contains(olay) && WhatsAppServisi.Numara(g.Telefon) is { } tel)
                    await _wa.GonderAsync(tel, HekimMetni(g.SiparisId, g.Hasta, olay, a.HastaAdiKisalt), true, ct);
            }
            if (satirlar.Count > 0) _wa.Guncelle(x => x.SonGecmisId = satirlar[^1].Id);
        }

        // ---- onay ve teknisyen değişiklikleri
        var isler = await db.Database.SqlQuery<IsSatiri>($"""
            SELECT s."Id", COALESCE(s."OnayDurumu",'Onaylandı') AS "Onay", s."TeknisyenId", ha."AdSoyad" AS "Hasta", h."Telefon",
                   (SELECT string_agg(k."IsTuru" || ' x' || k."Adet", ', ') FROM "SiparisKalemleri" k WHERE k."SiparisId"=s."Id") AS "Kalemler",
                   s."TerminTarihi" AS "Termin"
            FROM "Siparisler" s JOIN "Hastalar" ha ON ha."Id"=s."HastaId" JOIN "Hekimler" h ON h."Id"=ha."HekimId"
            WHERE COALESCE(s."Silindi",false)=false AND (s."Durum" NOT IN ('Tamamlandı','Teslim') OR s."OlusturmaTarihi" > now() - interval '30 days')
            """).ToListAsync(ct);
        var yeni = isler.ToDictionary(x => x.Id, x => (x.Onay, x.TeknisyenId));
        if (_goruntu != null)
        {
            foreach (var s in isler)
            {
                if (!_goruntu.TryGetValue(s.Id, out var eski)) eski = ("", null);
                if (eski.Onay == "Gelen Onay" && s.Onay == "Onaylandı" && a.HekimBildirim && a.HekimBildirimOlaylari.Contains("Onaylandı")
                    && WhatsAppServisi.Numara(s.Telefon) is { } tel)
                    await _wa.GonderAsync(tel, HekimMetni(s.Id, s.Hasta, "Onaylandı", a.HastaAdiKisalt), true, ct);

                if (a.TeknisyenBildirim && s.TeknisyenId is { } tid && tid != eski.Tek
                    && WhatsAppServisi.Numara(_kimlik.BilgiGetir("teknisyen:" + tid)?.Telefon) is { } ttel)
                {
                    var termin = s.Termin is { } t ? " Termin: " + t.AddHours(3).ToString("dd.MM.yyyy") + "." : "";
                    await _wa.GonderAsync(ttel,
                        $"Primer Dental Lab: Size yeni iş atandı — #{s.Id} {Hasta(s.Hasta, a.HastaAdiKisalt)} ({s.Kalemler ?? "-"}).{termin} Ayrıntılar ve dosyalar Teknisyen Paneli'nde.",
                        true, ct);
                }
            }
        }
        _goruntu = yeni;

        // ---- sabah özeti
        var simdi = DateTime.UtcNow.AddHours(3);
        var bugun = simdi.ToString("yyyy-MM-dd");
        if (a.SabahOzeti && simdi.Hour >= a.OzetSaati && simdi.Hour < 23 && a.SonOzetGunu != bugun)
        {
            _wa.Guncelle(x => x.SonOzetGunu = bugun);
            var metin = await OzetMetni(db, ct);
            foreach (var y in a.Yoneticiler.Select(WhatsAppServisi.Numara).OfType<string>().Distinct())
                await _wa.GonderAsync(y, metin, true, ct);
        }
    }

    public static string Hasta(string ad, bool kisalt) =>
        !kisalt ? ad : string.Join(" ", ad.Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(p => char.ToUpper(p[0], new System.Globalization.CultureInfo("tr-TR")) + "."));

    private static string HekimMetni(int isId, string hasta, string olay, bool kisalt)
    {
        var ne = olay switch
        {
            "Onaylandı" => "laboratuvarımıza alındı",
            "Tasarımda" => "tasarım aşamasına geçti",
            "Üretimde" => "üretime alındı",
            _ => "tamamlandı, teslime hazır"
        };
        return $"Primer Dental Lab: #{isId} numaralı {Hasta(hasta, kisalt)} işiniz {ne}. Sorularınız için bu numaraya yazabilirsiniz.";
    }

    /// <summary>Günün özeti (tek satır; şablonla da gönderilebilir).</summary>
    public static async Task<string> OzetMetni(PrimerLabDbContext db, CancellationToken ct)
    {
        var j = await db.Database.SqlQuery<string>($"""
            WITH g AS (SELECT (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul') AS bas),
            a AS (SELECT * FROM "Siparisler" WHERE COALESCE("Silindi",false)=false)
            SELECT json_build_object(
                'bugunTermin', (SELECT count(*) FROM a WHERE "TerminTarihi" >= (SELECT bas FROM g) AND "TerminTarihi" < (SELECT bas FROM g) + interval '1 day' AND "Durum" NOT IN ('Tamamlandı','Teslim')),
                'geciken', (SELECT count(*) FROM a WHERE "TerminTarihi" < (SELECT bas FROM g) AND "Durum" NOT IN ('Tamamlandı','Teslim') AND COALESCE("OnayDurumu",'Onaylandı')='Onaylandı'),
                'gelenOnay', (SELECT count(*) FROM a WHERE "OnayDurumu"='Gelen Onay'),
                'tamamlamaOnay', (SELECT count(*) FROM a WHERE "Durum"='Tamamlama Onayı'),
                'acik', (SELECT count(*) FROM a WHERE "Durum" NOT IN ('Tamamlandı','Teslim') AND COALESCE("OnayDurumu",'Onaylandı')='Onaylandı'),
                'dunBiten', (SELECT count(DISTINCT x."SiparisId") FROM "SiparisDurumGecmisi" x WHERE x."YeniDurum" IN ('Tamamlandı','Teslim') AND x."DegisimTarihi" >= (SELECT bas FROM g) - interval '1 day' AND x."DegisimTarihi" < (SELECT bas FROM g)),
                'atanmamis', (SELECT count(*) FROM a WHERE "TeknisyenId" IS NULL AND "Durum" NOT IN ('Tamamlandı','Teslim') AND COALESCE("OnayDurumu",'Onaylandı')='Onaylandı')
            )::text AS "Value"
            """).SingleAsync(ct);
        var o = JsonNode.Parse(j)!;
        int N(string k) => o[k]!.GetValue<int>();
        return $"Günaydın! Primer Lab özeti ({DateTime.UtcNow.AddHours(3):dd.MM.yyyy}): bugün termini olan {N("bugunTermin")} iş · geciken {N("geciken")} · " +
               $"gelen onay bekleyen {N("gelenOnay")} · tamamlama onayı bekleyen {N("tamamlamaOnay")} · teknisyen atanmamış {N("atanmamis")} · " +
               $"açık iş {N("acik")} · dün tamamlanan {N("dunBiten")}. Ayrıntı için bana yazabilirsiniz.";
    }
}
