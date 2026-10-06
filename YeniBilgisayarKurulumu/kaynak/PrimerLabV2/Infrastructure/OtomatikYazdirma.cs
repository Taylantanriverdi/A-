using System.Text.Json;

namespace PrimerLabV2.Infrastructure;

/// <summary>
/// Hekimden gelen işin sipariş formunu sormadan yazıcıya gönderme (yazıcı istasyonu).
/// İstasyon, Edge'in sessiz yazdırma kipinde (--kiosk-printing) açılan bir penceredir; bekleyen işleri
/// buradan sorar, basınca bildirir. Hangi işlerin basıldığı App_Data\otomatik-yazdir.json içinde tutulur;
/// program yeniden açılsa da aynı iş ikinci kez basılmaz. Özellik açıldığı andan önceki işler basılmaz.
/// </summary>
public sealed class OtomatikYazdirma
{
    public static readonly string[] SecilebilirKaynaklar = { "Hekim Portalı", "Teknisyen Paneli", "Sipariş Formu" };

    private readonly string _dosya;
    private readonly object _kilit = new();
    private Ayarlar? _ayar;
    private DateTime? _sonSinyal;
    private string? _sonHata;
    // Kuyruktan verilen iş 3 dakika o istasyona ayrılır (iki pencere aynı işi iki kez basmasın).
    private readonly Dictionary<int, DateTime> _ayrilan = new();

    public OtomatikYazdirma(IWebHostEnvironment env)
    {
        _dosya = Path.Combine(env.ContentRootPath, "App_Data", "otomatik-yazdir.json");
    }

    public sealed class Basilan
    {
        public int Id { get; set; }
        public DateTime Tarih { get; set; }
        public bool Basarili { get; set; } = true;
        public string? Hata { get; set; }
    }

    public sealed class Ayarlar
    {
        public bool Aktif { get; set; }
        public int Kopya { get; set; } = 1;
        /// <summary>Elle yazdırmadaki "Renk: Siyah-beyaz" gibi: gri tonlar ve görüntüler siyah mürekkeple basılır.</summary>
        public bool Renksiz { get; set; } = true;
        public List<string> Kaynaklar { get; set; } = new() { "Hekim Portalı" };
        /// <summary>Bu tarihten önce oluşturulan işler otomatik basılmaz (özellik açıldığı an).</summary>
        public DateTime? BaslangicTarihi { get; set; }
        public List<Basilan> Basilanlar { get; set; } = new();
    }

    public Ayarlar Oku()
    {
        lock (_kilit)
        {
            if (_ayar != null) return _ayar;
            try { _ayar = File.Exists(_dosya) ? JsonSerializer.Deserialize<Ayarlar>(File.ReadAllText(_dosya)) ?? new Ayarlar() : new Ayarlar(); }
            catch (JsonException) { _ayar = new Ayarlar(); }
            return _ayar;
        }
    }

    public Ayarlar Kaydet(bool aktif, int kopya, IEnumerable<string>? kaynaklar, bool? renksiz = null)
    {
        lock (_kilit)
        {
            var a = Oku();
            // Kapalıyken gelen işler, açınca topluca basılmasın: başlangıç "şimdi" olur.
            if (aktif && (!a.Aktif || a.BaslangicTarihi == null)) a.BaslangicTarihi = DateTime.UtcNow;
            a.Aktif = aktif;
            a.Kopya = Math.Clamp(kopya, 1, 3);
            if (renksiz != null) a.Renksiz = renksiz.Value;
            var k = (kaynaklar ?? Array.Empty<string>()).Where(x => SecilebilirKaynaklar.Contains(x)).Distinct().ToList();
            a.Kaynaklar = k.Count > 0 ? k : new List<string> { "Hekim Portalı" };
            Yaz();
            return a;
        }
    }

    public bool BasildiMi(int id) { lock (_kilit) return Oku().Basilanlar.Any(x => x.Id == id && x.Basarili); }

    public void BasildiKaydet(int id, bool basarili, string? hata)
    {
        lock (_kilit)
        {
            var a = Oku();
            a.Basilanlar.RemoveAll(x => x.Id == id);
            a.Basilanlar.Add(new Basilan { Id = id, Tarih = DateTime.UtcNow, Basarili = basarili, Hata = hata });
            if (a.Basilanlar.Count > 3000) a.Basilanlar.RemoveRange(0, a.Basilanlar.Count - 3000);
            _sonHata = basarili ? null : hata;
            _ayrilan.Remove(id);
            Yaz();
        }
    }

    /// <summary>"Tekrar yazdır": işi basılmamış sayar (istasyon bir sonraki turda basar).</summary>
    public void Tekrar(int id)
    {
        lock (_kilit)
        {
            var a = Oku();
            a.Basilanlar.RemoveAll(x => x.Id == id);
            a.Basilanlar.Add(new Basilan { Id = id, Tarih = DateTime.UtcNow, Basarili = false, Hata = "tekrar" });
            _ayrilan.Remove(id);
            Yaz();
        }
    }

    public HashSet<int> TekrarIstenenler() { lock (_kilit) return Oku().Basilanlar.Where(x => x.Hata == "tekrar").Select(x => x.Id).ToHashSet(); }

    /// <summary>Basılan ya da basılamayan (kendiliğinden yeniden denenmez; "Tekrar yazdır" ile denenir) işler.</summary>
    public HashSet<int> BasilanIdler() { lock (_kilit) return Oku().Basilanlar.Where(x => x.Hata != "tekrar").Select(x => x.Id).ToHashSet(); }

    public void Sinyal() { lock (_kilit) _sonSinyal = DateTime.UtcNow; }

    /// <summary>Verilen işlerden başka istasyona ayrılmamış olanları ayırır ve döner.</summary>
    public int[] Ayir(IEnumerable<int> idler)
    {
        lock (_kilit)
        {
            var simdi = DateTime.UtcNow;
            foreach (var k in _ayrilan.Where(x => simdi - x.Value > TimeSpan.FromMinutes(3)).Select(x => x.Key).ToList()) _ayrilan.Remove(k);
            var sonuc = idler.Where(id => !_ayrilan.ContainsKey(id)).ToArray();
            foreach (var id in sonuc) _ayrilan[id] = simdi;
            return sonuc;
        }
    }

    public void AyirmayiBirak(int id) { lock (_kilit) _ayrilan.Remove(id); }

    public (bool Cevrimici, DateTime? Son, string? SonHata) IstasyonDurumu()
    {
        lock (_kilit) return (_sonSinyal != null && DateTime.UtcNow - _sonSinyal < TimeSpan.FromSeconds(60), _sonSinyal, _sonHata);
    }

    private void Yaz()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_dosya)!);
        var gecici = _dosya + ".tmp";
        File.WriteAllText(gecici, JsonSerializer.Serialize(_ayar, new JsonSerializerOptions { WriteIndented = true }));
        File.Move(gecici, _dosya, overwrite: true);
    }
}
