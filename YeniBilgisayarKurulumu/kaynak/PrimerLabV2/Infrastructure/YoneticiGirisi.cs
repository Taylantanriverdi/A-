using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;

namespace PrimerLabV2.Infrastructure;

/// <summary>
/// Ana programın (yönetim ekranı) yönetici şifresi.
/// İlk açılışta şifre belirlenir ve bir kez gösterilen kurtarma kodu verilir; sonraki açılışlarda
/// şifre sorulur. Şifre ve kurtarma kodu PBKDF2 özeti olarak App_Data\yonetici-giris.json içinde
/// tutulur (düz metin yok; App_Data ile yeni bilgisayara taşınır). Oturum çerezi DataProtection ile
/// korunur ve şifre değişince tüm oturumlar düşer. Kurtarma kodu da kaybolursa
/// PrimerLab_SifreSifirla.bat dosyayı siler ve ilk şifre ekranı yeniden açılır (veriler etkilenmez).
/// </summary>
public sealed class YoneticiGirisi
{
    public const string CerezAdi = "primer_yonetici";
    public const string IcBaslik = "X-PrimerLab-Ic";
    private const int Iterasyon = 210_000;
    private static readonly TimeSpan OturumSuresi = TimeSpan.FromHours(12);
    private static readonly TimeSpan HatirlaSuresi = TimeSpan.FromDays(30);
    private const string KodHarfleri = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // karışan 0/O, 1/I yok

    private readonly string _dosya;
    private readonly IDataProtector _koruma;
    private readonly object _kilit = new();
    private Kayit? _onbellek;
    private bool _okundu;
    private readonly ConcurrentQueue<DateTime> _hatalar = new();

    /// <summary>Programın kendi kendine (WhatsApp asistanı işlemleri) yaptığı yerel çağrılar için süreç anahtarı.</summary>
    public string IcJeton { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));

    public YoneticiGirisi(IWebHostEnvironment env, IDataProtectionProvider dp)
    {
        _dosya = Path.Combine(env.ContentRootPath, "App_Data", "yonetici-giris.json");
        _koruma = dp.CreateProtector("PrimerLab.Yonetici.Oturum.v1");
    }

    private sealed class Kayit
    {
        public string ParolaHash { get; set; } = "";
        public string ParolaSalt { get; set; } = "";
        public string KurtarmaHash { get; set; } = "";
        public string KurtarmaSalt { get; set; } = "";
        /// <summary>Şifre her değiştiğinde yenilenir; eski oturum çerezleri geçersiz olur.</summary>
        public string Damga { get; set; } = "";
        public DateTime OlusturmaTarihi { get; set; }
        public DateTime SonDegisim { get; set; }
    }

    private sealed class Oturum
    {
        public DateTime Bitis { get; set; }
        public string Damga { get; set; } = "";
    }

    public bool Kurulu { get { lock (_kilit) return Oku() != null; } }

    public DateTime? SonDegisim { get { lock (_kilit) return Oku()?.SonDegisim; } }

    // ------------------------------------------------------------------ şifre işlemleri

    /// <summary>İlk şifreyi belirler; kurtarma kodunu döner. Zaten kuruluysa null.</summary>
    public string? Kur(string parola)
    {
        lock (_kilit)
        {
            if (Oku() != null) return null;
            var kod = KurtarmaKoduUret();
            Yaz(YeniKayit(parola, kod, DateTime.UtcNow));
            return kod;
        }
    }

    public bool ParolaDogru(string parola)
    {
        Kayit? k;
        lock (_kilit) k = Oku();
        return k != null && Esit(k.ParolaHash, Ozet(parola, k.ParolaSalt));
    }

    /// <summary>Şifreyi değiştirir (kurtarma kodu aynı kalır). Tüm eski oturumlar düşer.</summary>
    public bool ParolaDegistir(string mevcut, string yeni)
    {
        lock (_kilit)
        {
            var k = Oku();
            if (k == null || !Esit(k.ParolaHash, Ozet(mevcut, k.ParolaSalt))) return false;
            (k.ParolaHash, k.ParolaSalt) = OzetVeTuz(yeni);
            k.Damga = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
            k.SonDegisim = DateTime.UtcNow;
            Yaz(k);
            return true;
        }
    }

    /// <summary>Kurtarma koduyla yeni şifre belirler; yeni kurtarma kodu döner (eski kod geçersiz olur).</summary>
    public string? KurtarmaIle(string kod, string yeniParola)
    {
        lock (_kilit)
        {
            var k = Oku();
            if (k == null || !Esit(k.KurtarmaHash, Ozet(KodNormalize(kod), k.KurtarmaSalt))) return null;
            var yeniKod = KurtarmaKoduUret();
            Yaz(YeniKayit(yeniParola, yeniKod, k.OlusturmaTarihi));
            return yeniKod;
        }
    }

    /// <summary>Mevcut şifreyle doğrulayıp yeni bir kurtarma kodu üretir.</summary>
    public string? KurtarmaKoduYenile(string mevcut)
    {
        lock (_kilit)
        {
            var k = Oku();
            if (k == null || !Esit(k.ParolaHash, Ozet(mevcut, k.ParolaSalt))) return null;
            var kod = KurtarmaKoduUret();
            (k.KurtarmaHash, k.KurtarmaSalt) = OzetVeTuz(KodNormalize(kod));
            Yaz(k);
            return kod;
        }
    }

    // ------------------------------------------------------------------ deneme sınırı

    /// <summary>Son 10 dakikada 5 hatalı denemeden sonra bekletir (kalan dakika) — null: serbest.</summary>
    public int? Kilitli()
    {
        while (_hatalar.TryPeek(out var t) && DateTime.UtcNow - t > TimeSpan.FromMinutes(10)) _hatalar.TryDequeue(out _);
        if (_hatalar.Count < 5) return null;
        _hatalar.TryPeek(out var ilk);
        return Math.Max(1, (int)Math.Ceiling((ilk.AddMinutes(10) - DateTime.UtcNow).TotalMinutes));
    }

    public void HataKaydet() => _hatalar.Enqueue(DateTime.UtcNow);
    public void HatalariTemizle() { while (_hatalar.TryDequeue(out _)) { } }

    // ------------------------------------------------------------------ oturum

    public void OturumAc(HttpContext ctx, bool hatirla)
    {
        string damga;
        lock (_kilit) damga = Oku()?.Damga ?? "";
        var bitis = DateTime.UtcNow + (hatirla ? HatirlaSuresi : OturumSuresi);
        var deger = _koruma.Protect(JsonSerializer.Serialize(new Oturum { Bitis = bitis, Damga = damga }));
        ctx.Response.Cookies.Append(CerezAdi, deger, new CookieOptions
        {
            HttpOnly = true,
            Secure = ctx.Request.IsHttps,
            SameSite = SameSiteMode.Strict,
            IsEssential = true,
            Path = "/",
            // "Hatırla" seçilmezse tarayıcı kapanınca biter (en geç 12 saat).
            Expires = hatirla ? bitis : null
        });
    }

    public static void OturumKapat(HttpContext ctx) =>
        ctx.Response.Cookies.Delete(CerezAdi, new CookieOptions { Path = "/" });

    public bool OturumGecerli(HttpContext ctx)
    {
        if (!ctx.Request.Cookies.TryGetValue(CerezAdi, out var c) || string.IsNullOrEmpty(c)) return false;
        Kayit? k;
        lock (_kilit) k = Oku();
        if (k == null) return false;
        try
        {
            var o = JsonSerializer.Deserialize<Oturum>(_koruma.Unprotect(c));
            return o != null && o.Bitis > DateTime.UtcNow && o.Damga == k.Damga;
        }
        catch { return false; }
    }

    /// <summary>Program içi yerel çağrı mı (yalnız bu bilgisayardan, süreç anahtarıyla).</summary>
    public bool IcCagri(HttpContext ctx)
    {
        var a = ctx.Connection.RemoteIpAddress;
        if (a == null || !(System.Net.IPAddress.IsLoopback(a) || (a.IsIPv4MappedToIPv6 && System.Net.IPAddress.IsLoopback(a.MapToIPv4()))))
            return false;
        var b = ctx.Request.Headers[IcBaslik].FirstOrDefault();
        return b != null && CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.ASCII.GetBytes(b), System.Text.Encoding.ASCII.GetBytes(IcJeton));
    }

    // ------------------------------------------------------------------ yardımcılar

    public static string KodNormalize(string? kod) =>
        new string((kod ?? "").ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());

    private static string KurtarmaKoduUret()
    {
        var b = RandomNumberGenerator.GetBytes(16);
        var s = new string(b.Select(x => KodHarfleri[x % KodHarfleri.Length]).ToArray());
        return string.Join("-", Enumerable.Range(0, 4).Select(i => s.Substring(i * 4, 4)));
    }

    private static Kayit YeniKayit(string parola, string kod, DateTime olusturma)
    {
        var k = new Kayit { OlusturmaTarihi = olusturma, SonDegisim = DateTime.UtcNow, Damga = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)) };
        (k.ParolaHash, k.ParolaSalt) = OzetVeTuz(parola);
        (k.KurtarmaHash, k.KurtarmaSalt) = OzetVeTuz(KodNormalize(kod));
        return k;
    }

    private static (string Hash, string Salt) OzetVeTuz(string metin)
    {
        var salt = Convert.ToBase64String(RandomNumberGenerator.GetBytes(24));
        return (Ozet(metin, salt), salt);
    }

    private static string Ozet(string metin, string salt) =>
        Convert.ToBase64String(Rfc2898DeriveBytes.Pbkdf2(metin, Convert.FromBase64String(salt), Iterasyon, HashAlgorithmName.SHA256, 32));

    private static bool Esit(string a, string b)
    {
        try { return CryptographicOperations.FixedTimeEquals(Convert.FromBase64String(a), Convert.FromBase64String(b)); }
        catch (FormatException) { return false; }
    }

    private Kayit? Oku()
    {
        if (_okundu) return _onbellek;
        _okundu = true;
        try
        {
            _onbellek = File.Exists(_dosya) ? JsonSerializer.Deserialize<Kayit>(File.ReadAllText(_dosya)) : null;
            if (_onbellek != null && string.IsNullOrEmpty(_onbellek.ParolaHash)) _onbellek = null;
        }
        catch (JsonException) { _onbellek = null; }
        return _onbellek;
    }

    /// <summary>Dosya dışarıdan silinirse (sıfırlama betiği) yeniden okunur.</summary>
    public void Tazele() { lock (_kilit) { _okundu = false; } }

    private void Yaz(Kayit k)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_dosya)!);
        var gecici = _dosya + ".tmp";
        File.WriteAllText(gecici, JsonSerializer.Serialize(k, new JsonSerializerOptions { WriteIndented = true }));
        File.Move(gecici, _dosya, overwrite: true);
        _onbellek = k;
        _okundu = true;
    }
}
