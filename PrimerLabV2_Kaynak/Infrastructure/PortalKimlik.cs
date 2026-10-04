using System.Collections.Concurrent;
using System.Net;
using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;

namespace PrimerLabV2.Infrastructure;

/// <summary>
/// Hekim Portalı ve Teknisyen Paneli için ortak kimlik işleri:
///  - hesapların e-posta / kayıt bilgileri (App_Data\portal-hesap-bilgileri.json),
///  - portal ayarları (kayıt açık mı, onay gereksin mi, girişte e-posta kodu),
///  - e-postaya gönderilen 6 haneli kodlar (giriş, kayıt, şifre sıfırlama),
///  - "bu cihazı hatırla" çerezi,
///  - yoğunluk önlemleri: IP/e-posta/genel hız sınırları, iş kanıtı (bot engeli),
///    aynı anda yapılan parola özetleme sayısını sınırlayan kapı.
/// Hesap anahtarı biçimi: "hekim:{id}" / "teknisyen:{id}".
/// </summary>
public sealed class PortalKimlik
{
    public const string AmacGiris = "giris";
    public const string AmacKayit = "kayit";
    public const string AmacSifre = "sifre";

    private const int KodDakika = 10;
    private const int KodDenemeSiniri = 5;
    private const int BekleyenKodSiniri = 5000;

    private readonly string _bilgiDosyasi;
    private readonly string _ayarDosyasi;
    private readonly IDataProtector _cihazKoruma;
    private readonly IDataProtector _jetonKoruma;
    private readonly EpostaServisi _eposta;
    private readonly object _kilit = new();
    private static readonly JsonSerializerOptions JsonAyar = new() { WriteIndented = true };

    private readonly ConcurrentDictionary<string, KodKaydi> _kodlar = new();
    private readonly ConcurrentDictionary<string, Queue<DateTime>> _sayaclar = new();
    private readonly ConcurrentDictionary<string, DateTime> _kullanilanZorluklar = new();
    private readonly SemaphoreSlim _ozetKapisi = new(Math.Max(2, Environment.ProcessorCount));
    private long _engellenen;

    public PortalKimlik(IWebHostEnvironment env, IDataProtectionProvider dp, EpostaServisi eposta)
    {
        _bilgiDosyasi = Path.Combine(env.ContentRootPath, "App_Data", "portal-hesap-bilgileri.json");
        _ayarDosyasi = Path.Combine(env.ContentRootPath, "App_Data", "portal-ayarlari.json");
        _cihazKoruma = dp.CreateProtector("PrimerLab.Portal.Cihaz.v1");
        _jetonKoruma = dp.CreateProtector("PrimerLab.Portal.Jeton.v1");
        _eposta = eposta;
    }

    // ================================================================ ayarlar

    public sealed class Ayarlar
    {
        public bool KayitAcik { get; set; } = true;
        public bool OnayGereksin { get; set; }
        public bool GiristeEpostaKodu { get; set; } = true;
        public int CihazHatirlaGun { get; set; } = 30;
        public string YeniTeknisyenTipi { get; set; } = TeknisyenHesapDeposu.Dis;
        public int SaatlikKayitSiniri { get; set; } = 200;
    }

    public Ayarlar AyarlariOku()
    {
        lock (_kilit)
        {
            try
            {
                return File.Exists(_ayarDosyasi) ? JsonSerializer.Deserialize<Ayarlar>(File.ReadAllText(_ayarDosyasi)) ?? new Ayarlar() : new Ayarlar();
            }
            catch (JsonException) { return new Ayarlar(); }
        }
    }

    public void AyarlariYaz(Ayarlar a)
    {
        lock (_kilit) DosyaYaz(_ayarDosyasi, a);
    }

    public bool EpostaHazir => _eposta.Hazir;

    // ================================================================ hesap bilgileri

    public sealed class Bilgi
    {
        public string? Email { get; set; }
        public DateTime? EmailDogrulamaTarihi { get; set; }
        public bool KendiKaydi { get; set; }
        public DateTime? KayitTarihi { get; set; }
        public bool OnayBekliyor { get; set; }
        public string? KayitIp { get; set; }
        public string? Telefon { get; set; }
        public string? Not { get; set; }
    }

    private Dictionary<string, Bilgi> BilgileriOku()
    {
        try
        {
            return File.Exists(_bilgiDosyasi)
                ? JsonSerializer.Deserialize<Dictionary<string, Bilgi>>(File.ReadAllText(_bilgiDosyasi)) ?? new()
                : new();
        }
        catch (JsonException) { return new(); }
    }

    public Dictionary<string, Bilgi> TumBilgiler()
    {
        lock (_kilit) return BilgileriOku();
    }

    public Bilgi? BilgiGetir(string hesap)
    {
        lock (_kilit) return BilgileriOku().TryGetValue(hesap, out var b) ? b : null;
    }

    public void BilgiGuncelle(string hesap, Action<Bilgi> degistir)
    {
        lock (_kilit)
        {
            var d = BilgileriOku();
            if (!d.TryGetValue(hesap, out var b)) d[hesap] = b = new Bilgi();
            degistir(b);
            DosyaYaz(_bilgiDosyasi, d);
        }
    }

    /// <summary>E-postayı doğrulanmış olarak kullanan hesap (verilen hesap hariç).</summary>
    public string? EpostaSahibi(string email, string? haric = null)
    {
        var e = email.Trim();
        lock (_kilit)
            return BilgileriOku().FirstOrDefault(x => x.Key != haric && x.Value.EmailDogrulamaTarihi != null &&
                                                      string.Equals(x.Value.Email, e, StringComparison.OrdinalIgnoreCase)).Key;
    }

    public static string? EpostaNormalize(string? email)
    {
        var e = (email ?? string.Empty).Trim();
        if (e.Length is < 5 or > 160 || e.Contains(' ') || !e.Contains('@')) return null;
        try
        {
            var a = new MailAddress(e);
            return a.Address == e && a.Host.Contains('.') ? e.ToLowerInvariant() : null;
        }
        catch (FormatException) { return null; }
    }

    public static string Maskele(string email)
    {
        var at = email.IndexOf('@');
        if (at <= 0) return email;
        var ad = email[..at];
        var gorunen = ad.Length <= 2 ? ad[..1] : ad[..2];
        return gorunen + new string('*', Math.Max(3, ad.Length - gorunen.Length)) + email[at..];
    }

    // ================================================================ e-posta kodları

    public sealed class KodKaydi
    {
        public string Amac { get; init; } = AmacGiris;
        public string? Hesap { get; set; }
        public string Email { get; init; } = string.Empty;
        public string? Veri { get; init; }
        public string KodOzeti { get; set; } = string.Empty;
        public DateTime Bitis { get; set; }
        public int Hata { get; set; }
        public DateTime SonGonderim { get; set; }
        public int GonderimSayisi { get; set; }
        public bool Sahte { get; init; }
    }

    /// <summary>
    /// E-postaya 6 haneli kod gönderir. Dönen jeton, kod girilirken geri gönderilir.
    /// Hata metni doluysa kod gönderilemedi demektir.
    /// </summary>
    public (string? Jeton, string? Hata) KodGonder(string amac, string? hesap, string email, string? veri = null)
    {
        Temizle();
        if (_kodlar.Count >= BekleyenKodSiniri) return (null, YogunMesaj);
        // Aynı hesaba az önce gönderilmiş ve hâlâ geçerli kod varsa yenisi gönderilmez, o kullanılır
        // (ör. giriş ekranına dönüp tekrar "Giriş Yap"a basan kişi aynı kodu girer).
        if (hesap != null)
        {
            var simdi = DateTime.UtcNow;
            var mevcut = _kodlar.FirstOrDefault(x => x.Value.Amac == amac && x.Value.Hesap == hesap && x.Value.Email == email &&
                                                     x.Value.Bitis > simdi && x.Value.Hata < KodDenemeSiniri &&
                                                     simdi - x.Value.SonGonderim < TimeSpan.FromMinutes(2));
            if (mevcut.Key != null) return (mevcut.Key, null);
        }
        // Kullanılmamış bir kod az önce bu adrese gönderildiyse yenisi için bir dakika beklenir
        // (kullanılmış kodlar engel değildir: ör. telefondan girdikten hemen sonra bilgisayardan giriş).
        var esik = DateTime.UtcNow.AddSeconds(-55);
        if (_kodlar.Values.Any(x => x.Amac == amac && x.Email == email && !x.Sahte && x.SonGonderim > esik))
            return (null, "Bu e-postaya az önce kod gönderildi. Lütfen bir dakika bekleyip tekrar deneyin.");
        if (!Izin("kod-eposta-saat:" + email, 10, TimeSpan.FromHours(1)))
            return (null, "Bu e-postaya çok fazla kod istendi. Bir saat sonra tekrar deneyin.");

        var kod = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        var jeton = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
        var kayit = new KodKaydi
        {
            Amac = amac, Hesap = hesap, Email = email, Veri = veri,
            KodOzeti = Ozet(jeton, kod), Bitis = DateTime.UtcNow.AddMinutes(KodDakika),
            SonGonderim = DateTime.UtcNow, GonderimSayisi = 1
        };
        if (!_eposta.KuyrugaEkle(email, Konu(amac), KodIcerik(amac, kod), amac == AmacGiris)) return (null, YogunMesaj);
        _kodlar[jeton] = kayit;
        return (jeton, null);
    }

    /// <summary>Şifre sıfırlamada hesap bulunamazsa: dışarıdan farkı görünmeyen boş kayıt.</summary>
    public string SahteKod(string amac)
    {
        var jeton = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
        _kodlar[jeton] = new KodKaydi { Amac = amac, Sahte = true, Bitis = DateTime.UtcNow.AddMinutes(KodDakika), SonGonderim = DateTime.UtcNow };
        return jeton;
    }

    public string? KoduTekrarGonder(string? jeton)
    {
        if (jeton == null || !_kodlar.TryGetValue(jeton, out var k) || k.Bitis < DateTime.UtcNow)
            return "Süre doldu. Lütfen baştan başlayın.";
        lock (k)
        {
            if (DateTime.UtcNow - k.SonGonderim < TimeSpan.FromSeconds(55)) return "Lütfen bir dakika bekleyip tekrar deneyin.";
            if (k.GonderimSayisi >= 4) return "Çok fazla kod istendi. Lütfen baştan başlayın.";
            k.SonGonderim = DateTime.UtcNow;
            k.GonderimSayisi++;
            if (k.Sahte) return null;
            var kod = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
            if (!_eposta.KuyrugaEkle(k.Email, Konu(k.Amac), KodIcerik(k.Amac, kod), k.Amac == AmacGiris)) return YogunMesaj;
            k.KodOzeti = Ozet(jeton, kod);
            k.Bitis = DateTime.UtcNow.AddMinutes(KodDakika);
            k.Hata = 0;
        }
        return null;
    }

    /// <summary>Kodu doğrular; doğruysa kaydı tüketir ve döner.</summary>
    public (KodKaydi? Kayit, string? Hata) KodDogrula(string? jeton, string? kod, string amac)
    {
        if (jeton == null || !_kodlar.TryGetValue(jeton, out var k) || k.Amac != amac || k.Bitis < DateTime.UtcNow)
            return (null, "Süre doldu. Lütfen baştan başlayın.");
        lock (k)
        {
            if (k.Hata >= KodDenemeSiniri)
            {
                _kodlar.TryRemove(jeton, out _);
                return (null, "Çok fazla hatalı kod girildi. Lütfen baştan başlayın.");
            }
            var temiz = new string((kod ?? string.Empty).Where(char.IsDigit).ToArray());
            var dogru = !k.Sahte && temiz.Length == 6 &&
                        CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Ozet(jeton, temiz)), Encoding.ASCII.GetBytes(k.KodOzeti));
            if (!dogru)
            {
                k.Hata++;
                return (null, "Kod hatalı. E-postanıza gelen son kodu girin (" + (KodDenemeSiniri - k.Hata) + " hakkınız kaldı).");
            }
        }
        _kodlar.TryRemove(jeton, out _);
        return (k, null);
    }

    private static string Ozet(string jeton, string kod) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(jeton + ":" + kod)));

    private static string Konu(string amac) => amac switch
    {
        AmacKayit => "Primer Lab kayıt doğrulama kodu",
        AmacSifre => "Primer Lab şifre sıfırlama kodu",
        _ => "Primer Lab giriş kodu"
    };

    private static string KodIcerik(string amac, string kod)
    {
        var aciklama = amac switch
        {
            AmacKayit => "Kaydınızı tamamlamak için aşağıdaki kodu girin.",
            AmacSifre => "Şifrenizi yenilemek için aşağıdaki kodu girin.",
            _ => "Girişi tamamlamak için aşağıdaki kodu girin."
        };
        return EpostaServisi.Sablon(Konu(amac),
            "<p>" + aciklama + "</p><div style=\"font-size:32px;font-weight:bold;letter-spacing:8px;background:#eff6ff;" +
            "border-radius:12px;padding:14px;text-align:center\">" + kod + "</div><p>Kod " + KodDakika + " dakika geçerlidir.</p>");
    }

    public const string YogunMesaj = "Sistem şu anda çok yoğun. Lütfen birkaç dakika sonra tekrar deneyin.";

    // ================================================================ parola sonrası e-posta adımı jetonu

    public string HesapJetonu(string hesap) =>
        _jetonKoruma.Protect(hesap + "|" + DateTime.UtcNow.AddMinutes(10).Ticks);

    public string? HesapJetonuCoz(string? jeton, string onEk)
    {
        if (string.IsNullOrWhiteSpace(jeton)) return null;
        try
        {
            var p = _jetonKoruma.Unprotect(jeton).Split('|');
            if (p.Length != 2 || !p[0].StartsWith(onEk, StringComparison.Ordinal) || new DateTime(long.Parse(p[1]), DateTimeKind.Utc) < DateTime.UtcNow) return null;
            return p[0];
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException or OverflowException) { return null; }
    }

    // ================================================================ bu cihazı hatırla

    public static string ParolaDamgasi(string parolaOzeti) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("cihaz:" + parolaOzeti)))[..16];

    public string CihazJetonu(string hesap, string parolaOzeti, int gun) =>
        _cihazKoruma.Protect(hesap + "|" + ParolaDamgasi(parolaOzeti) + "|" + DateTime.UtcNow.AddDays(gun).Ticks);

    public bool CihazGecerli(string? cerez, string hesap, string parolaOzeti)
    {
        if (string.IsNullOrWhiteSpace(cerez)) return false;
        try
        {
            foreach (var parca in cerez.Split('~', StringSplitOptions.RemoveEmptyEntries))
            {
                var p = _cihazKoruma.Unprotect(parca).Split('|');
                if (p.Length == 3 && p[0] == hesap && p[1] == ParolaDamgasi(parolaOzeti) &&
                    new DateTime(long.Parse(p[2]), DateTimeKind.Utc) > DateTime.UtcNow)
                    return true;
            }
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException or OverflowException) { }
        return false;
    }

    /// <summary>Aynı tarayıcıda birden çok hesap hatırlanabilir (en fazla 5).</summary>
    public static string CihazCereziEkle(string? mevcut, string yeni) =>
        string.Join('~', (mevcut ?? string.Empty).Split('~', StringSplitOptions.RemoveEmptyEntries).TakeLast(4).Append(yeni));

    // ================================================================ giriş akışı (parola doğrulandıktan sonra)

    /// <summary>
    /// Parola doğrulandıktan sonraki adım. OturumAc=true ise doğrudan oturum açılır; değilse
    /// Yanit istemciye gönderilir (e-postaya kod gönderildi / e-posta adresini girin).
    /// </summary>
    public (object? Yanit, bool OturumAc, string? Hata) GirisSonrasi(string hesap, string parolaOzeti, string? cihazCerezi)
    {
        var a = AyarlariOku();
        if (!a.GiristeEpostaKodu || !EpostaHazir) return (null, true, null);
        if (CihazGecerli(cihazCerezi, hesap, parolaOzeti)) return (null, true, null);

        var b = BilgiGetir(hesap);
        if (b?.Email != null && b.EmailDogrulamaTarihi != null)
        {
            var (jeton, hata) = KodGonder(AmacGiris, hesap, b.Email);
            if (hata != null) return (null, false, hata);
            return (new { ikiAdim = "eposta-kod", jeton, eposta = Maskele(b.Email), hatirlaGun = a.CihazHatirlaGun }, false, null);
        }
        return (new { ikiAdim = "eposta-gir", jeton = HesapJetonu(hesap), oneri = b?.Email }, false, null);
    }

    /// <summary>E-postası kayıtlı olmayan hesap ilk girişte adresini yazar; koda doğrulanınca kaydedilir.</summary>
    public (object? Yanit, string? Hata) GirisEpostasi(string? jeton, string onEk, string? email)
    {
        var hesap = HesapJetonuCoz(jeton, onEk);
        if (hesap == null) return (null, "Süre doldu. Lütfen kullanıcı adı ve şifreyle tekrar giriş yapın.");
        var e = EpostaNormalize(email);
        if (e == null) return (null, "Geçerli bir e-posta adresi girin.");
        if (EpostaSahibi(e, hesap) != null) return (null, "Bu e-posta adresi başka bir hesapta kullanılıyor.");
        var (kodJetonu, hata) = KodGonder(AmacGiris, hesap, e);
        if (hata != null) return (null, hata);
        return (new { ikiAdim = "eposta-kod", jeton = kodJetonu, eposta = Maskele(e), hatirlaGun = AyarlariOku().CihazHatirlaGun }, null);
    }

    /// <summary>Giriş kodunu doğrular, e-postayı doğrulanmış olarak kaydeder; hesap anahtarını döner.</summary>
    public (string? Hesap, string? Hata) GirisKoduDogrula(string? jeton, string? kod, string onEk)
    {
        var (k, hata) = KodDogrula(jeton, kod, AmacGiris);
        if (hata != null) return (null, hata);
        if (k!.Hesap == null || !k.Hesap.StartsWith(onEk, StringComparison.Ordinal)) return (null, "Süre doldu. Lütfen baştan başlayın.");
        EpostaDogrulandi(k.Hesap, k.Email);
        return (k.Hesap, null);
    }

    public void EpostaDogrulandi(string hesap, string email) =>
        BilgiGuncelle(hesap, b =>
        {
            if (!string.Equals(b.Email, email, StringComparison.OrdinalIgnoreCase) || b.EmailDogrulamaTarihi == null)
            {
                b.Email = email;
                b.EmailDogrulamaTarihi = DateTime.UtcNow;
            }
        });

    public static int HesapId(string hesap) => int.Parse(hesap[(hesap.IndexOf(':') + 1)..]);

    public static void CihazCereziYaz(HttpContext c, string ad, string deger, int gun) =>
        c.Response.Cookies.Append(ad, deger, new CookieOptions
        {
            HttpOnly = true,
            Secure = c.Request.IsHttps,
            SameSite = SameSiteMode.Strict,
            Expires = DateTimeOffset.UtcNow.AddDays(gun),
            IsEssential = true,
            Path = "/"
        });

    // ================================================================ hız sınırları

    /// <summary>Kayan pencere: pencere içinde en fazla 'sinir' istek. İzin verirse sayar.</summary>
    public bool Izin(string anahtar, int sinir, TimeSpan pencere)
    {
        if (_sayaclar.Count > 100_000) _sayaclar.Clear();
        var q = _sayaclar.GetOrAdd(anahtar, _ => new Queue<DateTime>());
        lock (q)
        {
            var simdi = DateTime.UtcNow;
            while (q.Count > 0 && simdi - q.Peek() > pencere) q.Dequeue();
            if (q.Count >= sinir)
            {
                Interlocked.Increment(ref _engellenen);
                return false;
            }
            q.Enqueue(simdi);
            return true;
        }
    }

    private int Sayi(string anahtar, TimeSpan pencere)
    {
        if (!_sayaclar.TryGetValue(anahtar, out var q)) return 0;
        lock (q)
        {
            var simdi = DateTime.UtcNow;
            return q.Count(x => simdi - x <= pencere);
        }
    }

    public static string IpAnahtari(HttpContext c)
    {
        var ip = c.Connection.RemoteIpAddress;
        if (ip == null || ip.Equals(IPAddress.None)) return "?";
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        // IPv6'da aynı kullanıcı /64 bloğunu değiştirebilir; blok bazında sayılır.
        if (ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6)
        {
            var b = ip.GetAddressBytes();
            return Convert.ToHexString(b, 0, 8);
        }
        return ip.ToString();
    }

    /// <summary>Kayıt ve şifre sıfırlama başvurularında ortak yoğunluk denetimi.</summary>
    public string? BasvuruIzni(HttpContext c, string tur)
    {
        var ip = IpAnahtari(c);
        var a = AyarlariOku();
        if (ip != "?")
        {
            if (!Izin("basvuru-ip-10dk:" + ip, 5, TimeSpan.FromMinutes(10)) ||
                !Izin("basvuru-ip-gun:" + ip, 30, TimeSpan.FromDays(1)))
                return "Bu bağlantıdan çok fazla başvuru yapıldı. Lütfen daha sonra tekrar deneyin.";
        }
        if (!Izin("basvuru-genel", Math.Max(20, a.SaatlikKayitSiniri), TimeSpan.FromHours(1)))
            return YogunMesaj;
        Izin("basvuru-say:" + tur, int.MaxValue, TimeSpan.FromHours(1));
        return null;
    }

    public object Istatistik() => new
    {
        sonSaatKayitBasvurusu = Sayi("basvuru-say:kayit", TimeSpan.FromHours(1)),
        sonSaatSifreBasvurusu = Sayi("basvuru-say:sifre", TimeSpan.FromHours(1)),
        bekleyenKod = _kodlar.Count,
        engellenenIstek = Interlocked.Read(ref _engellenen),
        zorlukBit = ZorlukBiti()
    };

    // ================================================================ iş kanıtı (bot engeli)
    // Tarayıcı, sunucunun verdiği rastgele metin için SHA-256 özeti belirli sayıda sıfır bitle
    // başlayan bir sayı bulur (insan için ~1 sn, binlerce sahte başvuru yapan bot için pahalı).
    // Başvuru yoğunlaştıkça zorluk otomatik artar.

    private int ZorlukBiti()
    {
        var son10 = Sayi("basvuru-genel", TimeSpan.FromMinutes(10));
        return son10 switch { > 100 => 21, > 30 => 19, _ => 17 };
    }

    public object ZorlukUret()
    {
        var bit = ZorlukBiti();
        var tuz = Convert.ToHexString(RandomNumberGenerator.GetBytes(12));
        var jeton = _jetonKoruma.Protect("pow|" + tuz + "|" + bit + "|" + DateTime.UtcNow.AddMinutes(10).Ticks);
        return new { jeton, tuz, bit };
    }

    public bool ZorlukDogrula(string? jeton, string? cevap)
    {
        if (string.IsNullOrWhiteSpace(jeton) || string.IsNullOrWhiteSpace(cevap) || cevap.Length > 20) return false;
        string[] p;
        try { p = _jetonKoruma.Unprotect(jeton).Split('|'); }
        catch (CryptographicException) { return false; }
        if (p.Length != 4 || p[0] != "pow" || !int.TryParse(p[2], out var bit) || !long.TryParse(p[3], out var t)) return false;
        if (new DateTime(t, DateTimeKind.Utc) < DateTime.UtcNow) return false;
        var ozet = SHA256.HashData(Encoding.UTF8.GetBytes(p[1] + ":" + cevap));
        if (!SifirBit(ozet, bit)) return false;
        foreach (var eski in _kullanilanZorluklar.Where(x => x.Value < DateTime.UtcNow).Select(x => x.Key).ToList())
            _kullanilanZorluklar.TryRemove(eski, out _);
        return _kullanilanZorluklar.TryAdd(p[1], DateTime.UtcNow.AddMinutes(11));
    }

    private static bool SifirBit(byte[] h, int bit)
    {
        for (var i = 0; i < bit; i++)
            if ((h[i / 8] & (0x80 >> (i % 8))) != 0) return false;
        return true;
    }

    // ================================================================ parola özeti kapısı
    // PBKDF2 kasıtlı olarak yavaştır; yüzlerce eşzamanlı istek işlemciyi kilitlemesin diye
    // aynı anda en fazla çekirdek sayısı kadar özet hesaplanır, fazlası kısa süre bekler.

    public async Task<T?> OzetKapisindan<T>(Func<T> islem, CancellationToken ct) where T : class
    {
        if (!await _ozetKapisi.WaitAsync(TimeSpan.FromSeconds(8), ct)) return null;
        try { return islem(); }
        finally { _ozetKapisi.Release(); }
    }

    public async Task<bool?> OzetKapisindan(Func<bool> islem, CancellationToken ct)
    {
        if (!await _ozetKapisi.WaitAsync(TimeSpan.FromSeconds(8), ct)) return null;
        try { return islem(); }
        finally { _ozetKapisi.Release(); }
    }

    // ================================================================ ortak doğrulamalar

    public static string? ParolaKontrol(string? parola) =>
        parola == null || parola.Length < 8 || parola.Length > 128 || !parola.Any(char.IsLetter) || !parola.Any(char.IsDigit)
            ? "Şifre en az 8 karakter olmalı; en az bir harf ve bir rakam içermelidir."
            : null;

    public static string RastgeleParola()
    {
        const string harf = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
        const string rakam = "23456789";
        var c = new char[10];
        for (var i = 0; i < c.Length; i++)
            c[i] = i is 3 or 7 ? rakam[RandomNumberGenerator.GetInt32(rakam.Length)] : harf[RandomNumberGenerator.GetInt32(harf.Length)];
        return new string(c);
    }

    private void Temizle()
    {
        var simdi = DateTime.UtcNow;
        foreach (var k in _kodlar.Where(x => x.Value.Bitis < simdi).Select(x => x.Key).ToList())
            _kodlar.TryRemove(k, out _);
    }

    private static void DosyaYaz<T>(string dosya, T veri)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(dosya)!);
        var gecici = dosya + ".tmp";
        File.WriteAllText(gecici, JsonSerializer.Serialize(veri, JsonAyar));
        File.Move(gecici, dosya, overwrite: true);
    }
}
