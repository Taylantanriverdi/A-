using System.Text.Encodings.Web;
using System.Text.Json;

namespace PrimerLabV2.Infrastructure;

/// <summary>
/// Dosya ve mesaj takibi (veritabanı rolü tablo değiştiremediği için App_Data\icerik-takip.json):
///  - Dosyayı kimin yüklediği ve kimlerin ne zaman indirdiği (laboratuvar indirmediyse "yeni" sayılır).
///  - Her kişinin (laboratuvar, hekim:ID, teknisyen:ID) her işte en son okuduğu mesaj (okunmamış sayısı için).
/// Bu sürümden önceki dosyalar "eski" kabul edilir (ilk açılışta en büyük dosya numarası işaretlenir).
/// </summary>
public sealed class IcerikTakip
{
    public const string Laboratuvar = "laboratuvar";

    private readonly string _dosya;
    private readonly object _kilit = new();
    private Veri? _veri;
    private static readonly JsonSerializerOptions Ayar = new() { WriteIndented = false, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public IcerikTakip(IWebHostEnvironment env)
    {
        _dosya = Path.Combine(env.ContentRootPath, "App_Data", "icerik-takip.json");
    }

    public sealed class Indirme
    {
        public string Kim { get; set; } = "";
        public DateTime Tarih { get; set; }
    }

    public sealed class DosyaBilgi
    {
        public string? Yukleyen { get; set; }
        /// <summary>Hekim / Teknisyen / Laboratuvar / Mail</summary>
        public string? YukleyenTipi { get; set; }
        public List<Indirme> Indirmeler { get; set; } = new();
        public DateTime? LabGordu { get; set; }
    }

    private sealed class Veri
    {
        /// <summary>Bu numaraya kadar olan dosyalar takip başlamadan önce yüklenmiştir (yeni sayılmaz).</summary>
        public int? BaslangicDosyaId { get; set; }
        /// <summary>Bu numaraya kadar olan mesajlar okunmuş sayılır (takip öncesi).</summary>
        public int? BaslangicMesajId { get; set; }
        public Dictionary<int, DosyaBilgi> Dosyalar { get; set; } = new();
        public Dictionary<string, Dictionary<int, int>> Okunma { get; set; } = new();
    }

    // ------------------------------------------------------------------ dosyalar

    /// <summary>İlk çalıştırmada mevcut en büyük dosya numarasını "eski" sınırı olarak kaydeder.</summary>
    public void BaslangicAyarla(Func<int> enBuyukId)
    {
        lock (_kilit)
        {
            var v = Oku();
            if (v.BaslangicDosyaId != null) return;
            v.BaslangicDosyaId = enBuyukId();
            Yaz();
        }
    }

    public int BaslangicDosyaId { get { lock (_kilit) return Oku().BaslangicDosyaId ?? int.MaxValue; } }

    public void MesajBaslangicAyarla(int enBuyukId)
    {
        lock (_kilit)
        {
            var v = Oku();
            if (v.BaslangicMesajId != null) return;
            v.BaslangicMesajId = enBuyukId;
            Yaz();
        }
    }

    /// <summary>Kişinin bu işte okuduğu son mesaj numarası (takip öncesi mesajlar okunmuş sayılır).</summary>
    public Func<int, int> OkunmaSiniri(string kisi)
    {
        Dictionary<int, int> d; int bas;
        lock (_kilit)
        {
            var v = Oku();
            bas = v.BaslangicMesajId ?? int.MaxValue;
            d = v.Okunma.TryGetValue(kisi, out var x) ? new Dictionary<int, int>(x) : new Dictionary<int, int>();
        }
        return siparisId => Math.Max(bas, d.TryGetValue(siparisId, out var son) ? son : 0);
    }

    public void DosyaYuklendi(int dosyaId, string tip, string? ad)
    {
        lock (_kilit)
        {
            var v = Oku();
            var b = v.Dosyalar.TryGetValue(dosyaId, out var x) ? x : v.Dosyalar[dosyaId] = new DosyaBilgi();
            b.YukleyenTipi = tip;
            b.Yukleyen = ad;
            if (tip == "Laboratuvar") b.LabGordu = DateTime.UtcNow; // laboratuvarın kendi yüklediği "yeni" değildir
            Yaz();
        }
    }

    /// <summary>İndirme kaydı. kim: "Laboratuvar", "Hekim: Dr X", "Teknisyen: Ahmet".</summary>
    public void Indirildi(IEnumerable<int> dosyaIdleri, string kim)
    {
        lock (_kilit)
        {
            var v = Oku();
            var lab = kim == "Laboratuvar";
            foreach (var id in dosyaIdleri.Distinct())
            {
                var b = v.Dosyalar.TryGetValue(id, out var x) ? x : v.Dosyalar[id] = new DosyaBilgi();
                b.Indirmeler.Add(new Indirme { Kim = kim, Tarih = DateTime.UtcNow });
                if (b.Indirmeler.Count > 20) b.Indirmeler.RemoveRange(0, b.Indirmeler.Count - 20);
                if (lab) b.LabGordu ??= DateTime.UtcNow;
            }
            Yaz();
        }
    }

    /// <summary>İndirmeden "görüldü" işaretler (yeni sayılmasın).</summary>
    public void LabGordu(IEnumerable<int> dosyaIdleri)
    {
        lock (_kilit)
        {
            var v = Oku();
            foreach (var id in dosyaIdleri.Distinct())
            {
                var b = v.Dosyalar.TryGetValue(id, out var x) ? x : v.Dosyalar[id] = new DosyaBilgi();
                b.LabGordu ??= DateTime.UtcNow;
            }
            Yaz();
        }
    }

    public Dictionary<int, DosyaBilgi> DosyaBilgileri(IEnumerable<int> idler)
    {
        lock (_kilit)
        {
            var v = Oku();
            var s = new Dictionary<int, DosyaBilgi>();
            foreach (var id in idler) if (v.Dosyalar.TryGetValue(id, out var b)) s[id] = b;
            return s;
        }
    }

    /// <summary>Laboratuvar için yeni mi: takipten sonra gelmiş, laboratuvar yüklememiş, görmemiş/indirmemiş.</summary>
    public bool LabIcinYeni(int dosyaId)
    {
        lock (_kilit)
        {
            var v = Oku();
            if (dosyaId <= (v.BaslangicDosyaId ?? int.MaxValue)) return false;
            return !v.Dosyalar.TryGetValue(dosyaId, out var b) || b.LabGordu == null;
        }
    }

    public void DosyaSilindi(int dosyaId)
    {
        lock (_kilit) { if (Oku().Dosyalar.Remove(dosyaId)) Yaz(); }
    }

    // ------------------------------------------------------------------ mesaj okunma

    public Dictionary<int, int> SonOkunanlar(string kisi)
    {
        lock (_kilit) return Oku().Okunma.TryGetValue(kisi, out var d) ? new Dictionary<int, int>(d) : new Dictionary<int, int>();
    }

    public void MesajOkundu(string kisi, int siparisId, int sonMesajId)
    {
        if (sonMesajId <= 0) return;
        lock (_kilit)
        {
            var v = Oku();
            if (!v.Okunma.TryGetValue(kisi, out var d)) v.Okunma[kisi] = d = new Dictionary<int, int>();
            if (d.TryGetValue(siparisId, out var eski) && eski >= sonMesajId) return;
            d[siparisId] = sonMesajId;
            Yaz();
        }
    }

    // ------------------------------------------------------------------ dosya

    private Veri Oku()
    {
        if (_veri != null) return _veri;
        try { _veri = File.Exists(_dosya) ? JsonSerializer.Deserialize<Veri>(File.ReadAllText(_dosya)) ?? new Veri() : new Veri(); }
        catch (JsonException) { _veri = new Veri(); }
        return _veri;
    }

    private void Yaz()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_dosya)!);
        var gecici = _dosya + ".tmp";
        File.WriteAllText(gecici, JsonSerializer.Serialize(_veri, Ayar));
        File.Move(gecici, _dosya, overwrite: true);
    }
}
