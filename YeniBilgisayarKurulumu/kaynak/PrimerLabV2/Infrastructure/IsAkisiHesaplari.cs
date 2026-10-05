using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;

namespace PrimerLabV2.Infrastructure;

/// <summary>
/// İş Akışı Paneli kullanıcıları (sekreter / iş takipçisi): yalnız iş akışını görür ve yönetir,
/// fiyat bilgisi görmez. Hesapları yönetici ana programdan açar. Şifreler PBKDF2 özetiyle
/// App_Data\is-akisi-hesaplari.json içinde tutulur; oturum çerezi DataProtection ile korunur.
/// </summary>
public sealed class IsAkisiHesaplari
{
    public const string CerezAdi = "primer_isakisi";
    private const int Iterasyon = 120_000;

    private readonly string _dosya;
    private readonly object _kilit = new();
    private readonly IDataProtector _koruma;
    private List<Hesap>? _liste;
    private readonly ConcurrentDictionary<string, List<DateTime>> _hatalar = new();

    public IsAkisiHesaplari(IWebHostEnvironment env, IDataProtectionProvider dp)
    {
        _dosya = Path.Combine(env.ContentRootPath, "App_Data", "is-akisi-hesaplari.json");
        _koruma = dp.CreateProtector("PrimerLab.IsAkisi.Oturum.v1");
    }

    public sealed class Hesap
    {
        public int Id { get; set; }
        public string AdSoyad { get; set; } = "";
        public string KullaniciAdi { get; set; } = "";
        public string ParolaHash { get; set; } = "";
        public string ParolaSalt { get; set; } = "";
        public bool Aktif { get; set; } = true;
        /// <summary>Şifre değişince yenilenir; eski oturumlar düşer.</summary>
        public string Damga { get; set; } = "";
        public DateTime OlusturmaTarihi { get; set; }
        public DateTime? SonGiris { get; set; }
    }

    private sealed class Oturum
    {
        public int Id { get; set; }
        public string Damga { get; set; } = "";
        public DateTime Bitis { get; set; }
    }

    public List<Hesap> Liste() { lock (_kilit) return Oku().OrderBy(x => x.AdSoyad).ToList(); }

    public static string? KullaniciAdiKontrol(string? k) =>
        string.IsNullOrWhiteSpace(k) || !System.Text.RegularExpressions.Regex.IsMatch(k, "^[a-zA-Z0-9._-]{3,64}$")
            ? "Kullanıcı adı 3-64 karakter olmalı (harf, rakam, nokta, alt çizgi, tire)."
            : null;

    public string? Ekle(string adSoyad, string kullaniciAdi, string parola)
    {
        var h = KullaniciAdiKontrol(kullaniciAdi) ?? PortalKimlik.ParolaKontrol(parola);
        if (h != null) return h;
        if (string.IsNullOrWhiteSpace(adSoyad)) return "Ad soyad gerekli.";
        lock (_kilit)
        {
            var l = Oku();
            var ku = kullaniciAdi.Trim().ToLowerInvariant();
            if (l.Any(x => x.KullaniciAdi == ku)) return "Bu kullanıcı adı zaten kullanılıyor.";
            var (hash, salt) = OzetVeTuz(parola);
            l.Add(new Hesap
            {
                Id = l.Count == 0 ? 1 : l.Max(x => x.Id) + 1, AdSoyad = adSoyad.Trim()[..Math.Min(adSoyad.Trim().Length, 120)],
                KullaniciAdi = ku, ParolaHash = hash, ParolaSalt = salt, Aktif = true,
                Damga = Convert.ToHexString(RandomNumberGenerator.GetBytes(12)), OlusturmaTarihi = DateTime.UtcNow
            });
            Yaz();
            return null;
        }
    }

    public string? Guncelle(int id, string? adSoyad, bool? aktif, string? yeniParola)
    {
        if (!string.IsNullOrEmpty(yeniParola) && PortalKimlik.ParolaKontrol(yeniParola) is { } ph) return ph;
        lock (_kilit)
        {
            var h = Oku().FirstOrDefault(x => x.Id == id);
            if (h == null) return "Hesap bulunamadı.";
            if (!string.IsNullOrWhiteSpace(adSoyad)) h.AdSoyad = adSoyad.Trim()[..Math.Min(adSoyad.Trim().Length, 120)];
            if (aktif != null && aktif != h.Aktif) { h.Aktif = aktif.Value; h.Damga = Convert.ToHexString(RandomNumberGenerator.GetBytes(12)); }
            if (!string.IsNullOrEmpty(yeniParola))
            {
                (h.ParolaHash, h.ParolaSalt) = OzetVeTuz(yeniParola);
                h.Damga = Convert.ToHexString(RandomNumberGenerator.GetBytes(12));
            }
            Yaz();
            return null;
        }
    }

    public bool Sil(int id)
    {
        lock (_kilit)
        {
            if (Oku().RemoveAll(x => x.Id == id) == 0) return false;
            Yaz();
            return true;
        }
    }

    /// <summary>10 dakikada 6 hatalı denemeden sonra bekletir (kalan dakika).</summary>
    public int? Kilitli(string kullaniciAdi)
    {
        var l = _hatalar.GetOrAdd(kullaniciAdi.ToLowerInvariant(), _ => new List<DateTime>());
        lock (l)
        {
            l.RemoveAll(t => DateTime.UtcNow - t > TimeSpan.FromMinutes(10));
            return l.Count >= 6 ? Math.Max(1, (int)Math.Ceiling((l[0].AddMinutes(10) - DateTime.UtcNow).TotalMinutes)) : null;
        }
    }

    public Hesap? Dogrula(string kullaniciAdi, string parola)
    {
        var ku = (kullaniciAdi ?? "").Trim().ToLowerInvariant();
        Hesap? h;
        lock (_kilit) h = Oku().FirstOrDefault(x => x.KullaniciAdi == ku);
        var dogru = h != null && h.Aktif && Esit(h.ParolaHash, Ozet(parola ?? "", h.ParolaSalt));
        if (!dogru)
        {
            var l = _hatalar.GetOrAdd(ku, _ => new List<DateTime>());
            lock (l) l.Add(DateTime.UtcNow);
            return null;
        }
        _hatalar.TryRemove(ku, out _);
        lock (_kilit) { h!.SonGiris = DateTime.UtcNow; Yaz(); }
        return h;
    }

    public void OturumAc(HttpContext ctx, Hesap h, bool hatirla)
    {
        var bitis = DateTime.UtcNow + (hatirla ? TimeSpan.FromDays(30) : TimeSpan.FromHours(12));
        ctx.Response.Cookies.Append(CerezAdi, _koruma.Protect(JsonSerializer.Serialize(new Oturum { Id = h.Id, Damga = h.Damga, Bitis = bitis })), new CookieOptions
        {
            HttpOnly = true, Secure = ctx.Request.IsHttps, SameSite = SameSiteMode.Strict, IsEssential = true, Path = "/",
            Expires = hatirla ? bitis : null
        });
    }

    public static void OturumKapat(HttpContext ctx) => ctx.Response.Cookies.Delete(CerezAdi, new CookieOptions { Path = "/" });

    public Hesap? OturumHesabi(HttpContext ctx)
    {
        if (!ctx.Request.Cookies.TryGetValue(CerezAdi, out var c) || string.IsNullOrEmpty(c)) return null;
        try
        {
            var o = JsonSerializer.Deserialize<Oturum>(_koruma.Unprotect(c));
            if (o == null || o.Bitis <= DateTime.UtcNow) return null;
            lock (_kilit)
            {
                var h = Oku().FirstOrDefault(x => x.Id == o.Id);
                return h != null && h.Aktif && h.Damga == o.Damga ? h : null;
            }
        }
        catch { return null; }
    }

    private static (string, string) OzetVeTuz(string parola)
    {
        var salt = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16));
        return (Ozet(parola, salt), salt);
    }

    private static string Ozet(string parola, string salt) =>
        Convert.ToBase64String(Rfc2898DeriveBytes.Pbkdf2(parola, Convert.FromBase64String(salt), Iterasyon, HashAlgorithmName.SHA256, 32));

    private static bool Esit(string a, string b)
    {
        try { return CryptographicOperations.FixedTimeEquals(Convert.FromBase64String(a), Convert.FromBase64String(b)); }
        catch (FormatException) { return false; }
    }

    private List<Hesap> Oku()
    {
        if (_liste != null) return _liste;
        try { _liste = File.Exists(_dosya) ? JsonSerializer.Deserialize<List<Hesap>>(File.ReadAllText(_dosya)) ?? new() : new(); }
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
