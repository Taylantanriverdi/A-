using System.Security.Cryptography;
using System.Text.Json;

namespace PrimerLabV2.Infrastructure;

/// <summary>
/// Teknisyen Paneli hesapları (kullanıcı adı, parola özeti, iç/dış teknisyen tipi).
/// Veritabanında yeni tablo gerektirmemek için App_Data\teknisyen-hesaplari.json içinde
/// saklanır; parolalar PBKDF2 ile özetlenir, düz metin tutulmaz. App_Data ile birlikte
/// yeni bilgisayara taşınır.
/// </summary>
public sealed class TeknisyenHesapDeposu
{
    public const string Ic = "ic";
    public const string Dis = "dis";
    private const int Iterasyon = 210_000;

    private readonly string _dosya;
    private readonly object _kilit = new();
    private static readonly JsonSerializerOptions JsonAyar = new() { WriteIndented = true };

    public TeknisyenHesapDeposu(IWebHostEnvironment environment)
    {
        _dosya = Path.Combine(environment.ContentRootPath, "App_Data", "teknisyen-hesaplari.json");
    }

    public sealed class Hesap
    {
        public int TeknisyenId { get; set; }
        public string KullaniciAdi { get; set; } = string.Empty;
        public string ParolaHash { get; set; } = string.Empty;
        public string ParolaSalt { get; set; } = string.Empty;
        public string Tip { get; set; } = Ic;
        public bool Aktif { get; set; } = true;
        public DateTime? SonGirisTarihi { get; set; }
        public DateTime GuncellemeTarihi { get; set; }
    }

    public List<Hesap> Tumu()
    {
        lock (_kilit) return Oku();
    }

    public Hesap? Getir(int teknisyenId)
    {
        lock (_kilit) return Oku().FirstOrDefault(x => x.TeknisyenId == teknisyenId);
    }

    public Hesap? KullaniciAdiyla(string kullaniciAdi)
    {
        lock (_kilit)
            return Oku().FirstOrDefault(x => string.Equals(x.KullaniciAdi, kullaniciAdi, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Kaydeder; kullanıcı adı başka teknisyendeyse false döner.</summary>
    public bool Kaydet(int teknisyenId, string kullaniciAdi, string? yeniParola, string tip, bool aktif)
    {
        lock (_kilit)
        {
            var liste = Oku();
            if (liste.Any(x => x.TeknisyenId != teknisyenId &&
                               string.Equals(x.KullaniciAdi, kullaniciAdi, StringComparison.OrdinalIgnoreCase)))
                return false;

            var hesap = liste.FirstOrDefault(x => x.TeknisyenId == teknisyenId);
            if (hesap == null)
            {
                hesap = new Hesap { TeknisyenId = teknisyenId };
                liste.Add(hesap);
            }

            hesap.KullaniciAdi = kullaniciAdi;
            hesap.Tip = tip == Dis ? Dis : Ic;
            hesap.Aktif = aktif;
            hesap.GuncellemeTarihi = DateTime.UtcNow;
            if (!string.IsNullOrEmpty(yeniParola))
            {
                hesap.ParolaSalt = Convert.ToBase64String(RandomNumberGenerator.GetBytes(24));
                hesap.ParolaHash = Ozet(yeniParola, hesap.ParolaSalt);
            }

            Yaz(liste);
            return true;
        }
    }

    public static (string Hash, string Salt) OzetUret(string parola)
    {
        var salt = Convert.ToBase64String(RandomNumberGenerator.GetBytes(24));
        return (Ozet(parola, salt), salt);
    }

    /// <summary>Kendi kaydını yapan teknisyen için: parola özeti önceden hesaplanmış yeni hesap.</summary>
    public bool OzetliEkle(int teknisyenId, string kullaniciAdi, string hash, string salt, string tip, bool aktif)
    {
        lock (_kilit)
        {
            var liste = Oku();
            if (liste.Any(x => x.TeknisyenId == teknisyenId ||
                               string.Equals(x.KullaniciAdi, kullaniciAdi, StringComparison.OrdinalIgnoreCase)))
                return false;
            liste.Add(new Hesap
            {
                TeknisyenId = teknisyenId, KullaniciAdi = kullaniciAdi, ParolaHash = hash, ParolaSalt = salt,
                Tip = tip == Dis ? Dis : Ic, Aktif = aktif, GuncellemeTarihi = DateTime.UtcNow
            });
            Yaz(liste);
            return true;
        }
    }

    public bool KullaniciAdiBos(string kullaniciAdi)
    {
        lock (_kilit)
            return !Oku().Any(x => string.Equals(x.KullaniciAdi, kullaniciAdi, StringComparison.OrdinalIgnoreCase));
    }

    public bool ParolaAyarla(int teknisyenId, string hash, string salt)
    {
        lock (_kilit)
        {
            var liste = Oku();
            var hesap = liste.FirstOrDefault(x => x.TeknisyenId == teknisyenId);
            if (hesap == null) return false;
            hesap.ParolaHash = hash;
            hesap.ParolaSalt = salt;
            hesap.GuncellemeTarihi = DateTime.UtcNow;
            Yaz(liste);
            return true;
        }
    }

    public bool AktifAyarla(int teknisyenId, bool aktif)
    {
        lock (_kilit)
        {
            var liste = Oku();
            var hesap = liste.FirstOrDefault(x => x.TeknisyenId == teknisyenId);
            if (hesap == null) return false;
            hesap.Aktif = aktif;
            hesap.GuncellemeTarihi = DateTime.UtcNow;
            Yaz(liste);
            return true;
        }
    }

    /// <summary>Hesabı tamamen siler (teknisyen kaydı silindiğinde ya da kullanıcı adı devredildiğinde).</summary>
    public bool Sil(int teknisyenId)
    {
        lock (_kilit)
        {
            var liste = Oku();
            if (liste.RemoveAll(x => x.TeknisyenId == teknisyenId) == 0) return false;
            Yaz(liste);
            return true;
        }
    }

    public bool Pasiflestir(int teknisyenId)
    {
        lock (_kilit)
        {
            var liste = Oku();
            var hesap = liste.FirstOrDefault(x => x.TeknisyenId == teknisyenId);
            if (hesap == null) return false;
            hesap.Aktif = false;
            hesap.GuncellemeTarihi = DateTime.UtcNow;
            Yaz(liste);
            return true;
        }
    }

    public void GirisKaydet(int teknisyenId)
    {
        lock (_kilit)
        {
            var liste = Oku();
            var hesap = liste.FirstOrDefault(x => x.TeknisyenId == teknisyenId);
            if (hesap == null) return;
            hesap.SonGirisTarihi = DateTime.UtcNow;
            Yaz(liste);
        }
    }

    public static bool ParolaDogru(Hesap hesap, string parola)
    {
        if (string.IsNullOrEmpty(hesap.ParolaHash) || string.IsNullOrEmpty(hesap.ParolaSalt)) return false;
        try
        {
            var beklenen = Convert.FromBase64String(hesap.ParolaHash);
            var gelen = Convert.FromBase64String(Ozet(parola, hesap.ParolaSalt));
            return beklenen.Length == gelen.Length && CryptographicOperations.FixedTimeEquals(beklenen, gelen);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static string Ozet(string parola, string salt) =>
        Convert.ToBase64String(Rfc2898DeriveBytes.Pbkdf2(
            parola, Convert.FromBase64String(salt), Iterasyon, HashAlgorithmName.SHA256, 32));

    private List<Hesap> Oku()
    {
        try
        {
            if (!File.Exists(_dosya)) return new List<Hesap>();
            return JsonSerializer.Deserialize<List<Hesap>>(File.ReadAllText(_dosya)) ?? new List<Hesap>();
        }
        catch (JsonException)
        {
            return new List<Hesap>();
        }
    }

    private void Yaz(List<Hesap> liste)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_dosya)!);
        var gecici = _dosya + ".tmp";
        File.WriteAllText(gecici, JsonSerializer.Serialize(liste, JsonAyar));
        File.Move(gecici, _dosya, overwrite: true);
    }
}
