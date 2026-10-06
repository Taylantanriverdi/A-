using System.Text.Json;

namespace PrimerLabV2.Infrastructure;

/// <summary>
/// Teknisyenin (ya da laboratuvarın) hekimle paylaştığı iş dosyaları: tasarım, yazıcı (CTB vb.) dosyaları.
/// Paylaşılan dosya Hekim Portalı'nda iş kartının üzerinde indirilebilir görünür; hekim indirince işaretlenir.
/// Veritabanı kullanıcısının tablo ekleme yetkisi olmadığından App_Data\hekim-paylasim.json içinde tutulur.
/// </summary>
public sealed class HekimPaylasimi
{
    /// <summary>Yazıcı (reçine 3B yazıcı dilimlenmiş baskı) dosyaları: Chitubox, Anycubic, Elegoo, Phrozen, Prusa...</summary>
    public static readonly HashSet<string> YaziciUzantilari = new(StringComparer.OrdinalIgnoreCase)
    {
        ".ctb", ".cbddlp", ".photon", ".photons", ".pwmx", ".pwma", ".pwms", ".pws", ".pw0", ".pwmo", ".pwmb",
        ".pwx", ".dlp", ".goo", ".prz", ".sl1", ".sl1s", ".jxs", ".fdg", ".zcode", ".cws", ".gcode"
    };

    /// <summary>3D printer (reçine yazıcı) baskı dosyalarının dosya türü. Eski kayıtlarda "Yazıcı" olarak geçer.</summary>
    public const string PrinterTuru = "3D Printer";

    /// <summary>Eski "Yazıcı" adı da 3D Printer sayılır.</summary>
    public static bool PrinterMi(string? tur) => tur is PrinterTuru or "Yazıcı";

    private readonly string _dosya;
    private readonly object _kilit = new();
    private Dictionary<int, Kayit>? _veri;

    public HekimPaylasimi(IWebHostEnvironment env)
    {
        _dosya = Path.Combine(env.ContentRootPath, "App_Data", "hekim-paylasim.json");
    }

    public sealed class Kayit
    {
        public int SiparisId { get; set; }
        public string PaylasanTipi { get; set; } = "";
        public string? PaylasanAdi { get; set; }
        public DateTime Tarih { get; set; }
        public DateTime? HekimIndirdi { get; set; }
    }

    public void Paylas(int dosyaId, int siparisId, string tip, string? ad)
    {
        lock (_kilit)
        {
            var v = Oku();
            if (v.ContainsKey(dosyaId)) return;
            v[dosyaId] = new Kayit { SiparisId = siparisId, PaylasanTipi = tip, PaylasanAdi = ad, Tarih = DateTime.UtcNow };
            Yaz();
        }
    }

    public bool Kaldir(int dosyaId)
    {
        lock (_kilit)
        {
            if (!Oku().Remove(dosyaId)) return false;
            Yaz();
            return true;
        }
    }

    public Kayit? Getir(int dosyaId) { lock (_kilit) return Oku().TryGetValue(dosyaId, out var k) ? k : null; }

    public Dictionary<int, Kayit> Tumu() { lock (_kilit) return new Dictionary<int, Kayit>(Oku()); }

    public void HekimIndirdi(int dosyaId)
    {
        lock (_kilit)
        {
            if (Oku().TryGetValue(dosyaId, out var k) && k.HekimIndirdi == null)
            {
                k.HekimIndirdi = DateTime.UtcNow;
                Yaz();
            }
        }
    }

    public void DosyaSilindi(int dosyaId) => Kaldir(dosyaId);

    /// <summary>Uzantı yazıcı dosyasıysa tür "Yazıcı" olur; değilse istenen tür korunur.</summary>
    public static string TurBelirle(string tur, string uzanti) => YaziciUzantilari.Contains(uzanti) || PrinterMi(tur) ? PrinterTuru : tur;

    /// <summary>Tasarım ve yazıcı dosyaları hekimin indirebileceği "hazır dosyalar"dır.</summary>
    public static bool HekimeHazir(string? tur) => tur == "Tasarım" || PrinterMi(tur);

    /// <summary>
    /// Teknisyen ya da laboratuvar tasarım/yazıcı dosyası yükleyince hekime açılır ve hekime
    /// iş mesajıyla bildirilir (portalda okunmamış mesaj olarak görünür).
    /// </summary>
    public async Task HekimeAcAsync(PrimerLabV2.Data.PrimerLabDbContext db, int dosyaId, int siparisId, string ad, string tur,
        string tip, string? kim, CancellationToken ct)
    {
        if (!HekimeHazir(tur)) return;
        Paylas(dosyaId, siparisId, tip, kim);
        var mesaj = PrinterMi(tur)
            ? $"🖨️ 3D Printer dosyası hazır: {ad} — Hekim Portalı'nda bu işin üzerinden indirebilirsiniz."
            : $"📐 Tasarım dosyası hazır: {ad} — Hekim Portalı'nda bu işin üzerinden indirebilirsiniz.";
        await Microsoft.EntityFrameworkCore.RelationalDatabaseFacadeExtensions.ExecuteSqlInterpolatedAsync(db.Database, $"""
            INSERT INTO "IsMesajlari" ("SiparisId","GonderenTipi","GonderenAdi","Mesaj","Tarih")
            VALUES ({siparisId},{"Laboratuvar"},{"Laboratuvar"},{mesaj},{DateTime.UtcNow})
            """, ct);
    }

    private Dictionary<int, Kayit> Oku()
    {
        if (_veri != null) return _veri;
        try { _veri = File.Exists(_dosya) ? JsonSerializer.Deserialize<Dictionary<int, Kayit>>(File.ReadAllText(_dosya)) ?? new() : new(); }
        catch (JsonException) { _veri = new(); }
        return _veri;
    }

    private void Yaz()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_dosya)!);
        var gecici = _dosya + ".tmp";
        File.WriteAllText(gecici, JsonSerializer.Serialize(_veri, new JsonSerializerOptions { WriteIndented = true }));
        File.Move(gecici, _dosya, overwrite: true);
    }
}
