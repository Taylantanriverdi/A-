using System.Text.Json;

namespace PrimerLabV2.Infrastructure;

/// <summary>
/// Dosya yerine paylaşılan bağlantılar (WeTransfer, Google Drive, Dropbox, iCloud, 3Shape vb.).
/// Hekim iş gönderirken ya da sonradan, laboratuvar ise iş detayından link ekler; teknisyen görür.
/// Veritabanı kullanıcısının tablo ekleme yetkisi olmadığından App_Data\is-linkleri.json içinde tutulur.
/// </summary>
public sealed class IsLinkleri
{
    public const int IsBasinaEnFazla = 10;

    private readonly string _dosya;
    private readonly object _kilit = new();
    private List<Link>? _liste;

    public IsLinkleri(IWebHostEnvironment env)
    {
        _dosya = Path.Combine(env.ContentRootPath, "App_Data", "is-linkleri.json");
    }

    public sealed class Link
    {
        public int Id { get; set; }
        public int SiparisId { get; set; }
        public string Url { get; set; } = "";
        public string? Aciklama { get; set; }
        /// <summary>Hekim / Laboratuvar / Teknisyen</summary>
        public string EkleyenTipi { get; set; } = "";
        public string? EkleyenAdi { get; set; }
        public DateTime Tarih { get; set; }
    }

    /// <summary>
    /// Bağlantıyı denetler ve düzeltir: baştaki/sondaki boşluk atılır, "www.ornek.com/x" gibi şemasız
    /// yazılmışsa https:// eklenir. Yalnız http/https ve alan adı olan adresler kabul edilir.
    /// </summary>
    public static string? Dogrula(string? url, out string? hata)
    {
        hata = null;
        var u = (url ?? "").Trim().Trim('<', '>', '"', '\'');
        if (u.Length == 0) { hata = "Link boş."; return null; }
        if (u.Length > 1500) { hata = "Link çok uzun."; return null; }
        if (u.Any(char.IsWhiteSpace)) { hata = "Link boşluk içeremez: " + Kisalt(u); return null; }
        if (!u.Contains("://", StringComparison.Ordinal)) u = "https://" + u;
        if (!Uri.TryCreate(u, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp) ||
            !uri.Host.Contains('.') || uri.Host.Length < 4)
        {
            hata = "Geçersiz link: " + Kisalt(u) + " (https:// ile başlayan bir adres girin).";
            return null;
        }
        return uri.AbsoluteUri;
    }

    private static string Kisalt(string s) => s.Length > 60 ? s[..60] + "…" : s;

    /// <summary>Kısa açıklama için bilinen paylaşım servisinin adı.</summary>
    public static string Servis(string url)
    {
        var h = Uri.TryCreate(url, UriKind.Absolute, out var u) ? u.Host.ToLowerInvariant() : "";
        if (h.Contains("wetransfer") || h == "we.tl") return "WeTransfer";
        if (h.Contains("drive.google") || h.Contains("docs.google")) return "Google Drive";
        if (h.Contains("dropbox")) return "Dropbox";
        if (h.Contains("icloud")) return "iCloud";
        if (h.Contains("onedrive") || h.Contains("1drv.ms") || h.Contains("sharepoint")) return "OneDrive";
        if (h.Contains("3shape")) return "3Shape";
        if (h.Contains("mega.nz") || h.Contains("mega.io")) return "MEGA";
        if (h.Contains("yandex")) return "Yandex Disk";
        return h.StartsWith("www.") ? h[4..] : h;
    }

    public List<Link> Liste(int siparisId)
    {
        lock (_kilit) return Oku().Where(x => x.SiparisId == siparisId).OrderBy(x => x.Tarih).ThenBy(x => x.Id).ToList();
    }

    public Dictionary<int, int> Sayilar()
    {
        lock (_kilit) return Oku().GroupBy(x => x.SiparisId).ToDictionary(g => g.Key, g => g.Count());
    }

    public int Sayi(int siparisId)
    {
        lock (_kilit) return Oku().Count(x => x.SiparisId == siparisId);
    }

    /// <summary>Linkleri ekler (aynı işte aynı adres tekrar eklenmez). Hata varsa metnini döner.</summary>
    public string? Ekle(int siparisId, IEnumerable<string> urller, string? aciklama, string ekleyenTipi, string? ekleyenAdi)
    {
        lock (_kilit)
        {
            var l = Oku();
            var mevcut = l.Where(x => x.SiparisId == siparisId).Select(x => x.Url).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var yeni = new List<string>();
            foreach (var ham in urller)
            {
                if (string.IsNullOrWhiteSpace(ham)) continue;
                var u = Dogrula(ham, out var hata);
                if (u == null) return hata;
                if (mevcut.Add(u)) yeni.Add(u);
            }
            if (mevcut.Count > IsBasinaEnFazla) return $"Bir işe en fazla {IsBasinaEnFazla} link eklenebilir.";
            var id = l.Count == 0 ? 0 : l.Max(x => x.Id);
            var not = string.IsNullOrWhiteSpace(aciklama) ? null : aciklama.Trim()[..Math.Min(aciklama.Trim().Length, 200)];
            foreach (var u in yeni)
                l.Add(new Link { Id = ++id, SiparisId = siparisId, Url = u, Aciklama = not, EkleyenTipi = ekleyenTipi, EkleyenAdi = ekleyenAdi, Tarih = DateTime.UtcNow });
            if (yeni.Count > 0) Yaz();
            return null;
        }
    }

    /// <summary>Linki siler; işi ve (verilirse) ekleyen tipini de denetler.</summary>
    public bool Sil(int siparisId, int linkId, string? yalnizEkleyenTipi = null)
    {
        lock (_kilit)
        {
            var l = Oku();
            var n = l.RemoveAll(x => x.Id == linkId && x.SiparisId == siparisId &&
                                     (yalnizEkleyenTipi == null || x.EkleyenTipi == yalnizEkleyenTipi));
            if (n > 0) Yaz();
            return n > 0;
        }
    }

    public static object Gorunum(Link x) => new
    {
        x.Id, x.Url, x.Aciklama, x.EkleyenTipi, x.EkleyenAdi, x.Tarih, servis = Servis(x.Url)
    };

    private List<Link> Oku()
    {
        if (_liste != null) return _liste;
        try { _liste = File.Exists(_dosya) ? JsonSerializer.Deserialize<List<Link>>(File.ReadAllText(_dosya)) ?? new() : new(); }
        catch (JsonException) { _liste = new(); }
        return _liste;
    }

    private void Yaz()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_dosya)!);
        var gecici = _dosya + ".tmp";
        File.WriteAllText(gecici, JsonSerializer.Serialize(_liste, new JsonSerializerOptions { WriteIndented = true }));
        File.Move(gecici, _dosya, overwrite: true);
    }
}
