using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using QRCoder;

namespace PrimerLabV2.Infrastructure;

/// <summary>
/// Hekim Portalı ve Teknisyen Paneli için iki adımlı doğrulama (TOTP, RFC 6238):
/// parolaya ek olarak telefondaki doğrulama uygulamasının (Google / Microsoft Authenticator)
/// ürettiği 6 haneli kod istenir. Parola ele geçse bile tek başına giriş için yetmez.
///
/// Gizli anahtarlar App_Data\Secrets\iki-adimli-dogrulama.json içinde Windows veri koruması
/// ile şifreli saklanır (başka bilgisayara kopyalansa açılmaz; yeni bilgisayarda kullanıcılar
/// kodu bir kez yeniden kurar). Hesap anahtarı biçimi: "hekim:{id}" / "teknisyen:{id}".
/// </summary>
public sealed class IkiAdimDogrulama
{
    private const int Adim = 30;
    private const string Uygulama = "Primer Dental Lab";

    private readonly string _dosya;
    private readonly IDataProtector _koruma;
    private readonly IDataProtector _jetonKoruma;
    private readonly object _kilit = new();
    private static readonly JsonSerializerOptions JsonAyar = new() { WriteIndented = true };

    public IkiAdimDogrulama(IWebHostEnvironment environment, IDataProtectionProvider dataProtectionProvider)
    {
        _dosya = Path.Combine(environment.ContentRootPath, "App_Data", "Secrets", "iki-adimli-dogrulama.json");
        _koruma = dataProtectionProvider.CreateProtector("PrimerLab.IkiAdim.Anahtar.v1");
        _jetonKoruma = dataProtectionProvider.CreateProtector("PrimerLab.IkiAdim.Jeton.v1");
    }

    private sealed class Kayit
    {
        public string SifreliAnahtar { get; set; } = string.Empty;
        public DateTime KurulumTarihi { get; set; }
        public long SonAdim { get; set; }
    }

    private sealed class Depo
    {
        // Varsayılan: zorunlu. Hesabında kod kurulu olmayan kullanıcı ilk girişte kurar.
        public bool Zorunlu { get; set; } = true;
        public Dictionary<string, Kayit> Hesaplar { get; set; } = new();
    }

    // ---------------------------------------------------------------- ayarlar / durum

    public bool Zorunlu { get { lock (_kilit) return Oku().Zorunlu; } }

    public void ZorunluAyarla(bool zorunlu)
    {
        lock (_kilit) { var d = Oku(); d.Zorunlu = zorunlu; Yaz(d); }
    }

    public bool KuruluMu(string hesap)
    {
        lock (_kilit) return Oku().Hesaplar.ContainsKey(hesap);
    }

    public DateTime? KurulumTarihi(string hesap)
    {
        lock (_kilit) return Oku().Hesaplar.TryGetValue(hesap, out var k) ? k.KurulumTarihi : null;
    }

    public bool Sifirla(string hesap)
    {
        lock (_kilit)
        {
            var d = Oku();
            if (!d.Hesaplar.Remove(hesap)) return false;
            Yaz(d);
            return true;
        }
    }

    // ---------------------------------------------------------------- kod doğrulama

    /// <summary>Kurulu hesabın kodunu doğrular; aynı kod ikinci kez kullanılamaz.</summary>
    public bool Dogrula(string hesap, string? kod)
    {
        lock (_kilit)
        {
            var d = Oku();
            if (!d.Hesaplar.TryGetValue(hesap, out var kayit)) return false;
            byte[] anahtar;
            try { anahtar = Convert.FromBase64String(_koruma.Unprotect(kayit.SifreliAnahtar)); }
            catch (CryptographicException) { return false; }

            var adim = KodAdimi(anahtar, kod);
            if (adim == null || adim.Value <= kayit.SonAdim) return false;
            kayit.SonAdim = adim.Value;
            Yaz(d);
            return true;
        }
    }

    /// <summary>Kurulum sırasında üretilen anahtarla kodu doğrular ve hesaba kaydeder.</summary>
    public bool KurulumuTamamla(string hesap, string base32Anahtar, string? kod)
    {
        var anahtar = Base32Coz(base32Anahtar);
        if (anahtar == null) return false;
        var adim = KodAdimi(anahtar, kod);
        if (adim == null) return false;

        lock (_kilit)
        {
            var d = Oku();
            d.Hesaplar[hesap] = new Kayit
            {
                SifreliAnahtar = _koruma.Protect(Convert.ToBase64String(anahtar)),
                KurulumTarihi = DateTime.UtcNow,
                SonAdim = adim.Value
            };
            Yaz(d);
        }
        return true;
    }

    // Saat kaymasına karşı ±1 adım (±30 sn) tolerans. Eşleşen adımı döner.
    private static long? KodAdimi(byte[] anahtar, string? kod)
    {
        kod = new string((kod ?? string.Empty).Where(char.IsDigit).ToArray());
        if (kod.Length != 6) return null;
        var simdi = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / Adim;
        for (var k = -1; k <= 1; k++)
        {
            var adim = simdi + k;
            if (CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Totp(anahtar, adim)), Encoding.ASCII.GetBytes(kod)))
                return adim;
        }
        return null;
    }

    private static string Totp(byte[] anahtar, long adim)
    {
        var sayac = BitConverter.GetBytes(adim);
        if (BitConverter.IsLittleEndian) Array.Reverse(sayac);
        var hash = HMACSHA1.HashData(anahtar, sayac);
        var o = hash[^1] & 0x0f;
        var deger = ((hash[o] & 0x7f) << 24) | (hash[o + 1] << 16) | (hash[o + 2] << 8) | hash[o + 3];
        return (deger % 1_000_000).ToString("D6");
    }

    // ---------------------------------------------------------------- kurulum bilgisi

    public static string YeniAnahtar() => Base32(RandomNumberGenerator.GetBytes(20));

    public static string OtpauthAdresi(string kullanici, string base32Anahtar) =>
        "otpauth://totp/" + Uri.EscapeDataString(Uygulama + ":" + kullanici) +
        "?secret=" + base32Anahtar + "&issuer=" + Uri.EscapeDataString(Uygulama) + "&algorithm=SHA1&digits=6&period=30";

    public static string QrSvg(string metin)
    {
        using var uretici = new QRCodeGenerator();
        using var veri = uretici.CreateQrCode(metin, QRCodeGenerator.ECCLevel.M);
        return new SvgQRCode(veri).GetGraphic(5);
    }

    // ---------------------------------------------------------------- geçici giriş jetonu
    // Parola doğrulandıktan sonra kod adımı için 5 dakikalık şifreli jeton (oturum açmaz).

    public sealed class Jeton
    {
        public string Hesap { get; set; } = string.Empty;
        public DateTime Bitis { get; set; }
        public string? KurulumAnahtari { get; set; }
    }

    public string JetonUret(string hesap, string? kurulumAnahtari = null) =>
        _jetonKoruma.Protect(JsonSerializer.Serialize(new Jeton
        {
            Hesap = hesap,
            Bitis = DateTime.UtcNow.AddMinutes(5),
            KurulumAnahtari = kurulumAnahtari
        }));

    public Jeton? JetonCoz(string? jeton, string beklenenOnEk)
    {
        if (string.IsNullOrWhiteSpace(jeton)) return null;
        try
        {
            var j = JsonSerializer.Deserialize<Jeton>(_jetonKoruma.Unprotect(jeton));
            if (j == null || j.Bitis < DateTime.UtcNow || !j.Hesap.StartsWith(beklenenOnEk, StringComparison.Ordinal)) return null;
            return j;
        }
        catch (Exception ex) when (ex is CryptographicException or JsonException or FormatException)
        {
            return null;
        }
    }

    /// <summary>İlk girişte kurulum ekranı için QR, elle girilecek anahtar ve kurulum jetonu.</summary>
    public object KurulumBilgisi(string hesap, string kullaniciEtiketi)
    {
        var anahtar = YeniAnahtar();
        var adres = OtpauthAdresi(kullaniciEtiketi, anahtar);
        return new
        {
            ikiAdim = "kurulum-qr",
            jeton = JetonUret(hesap, anahtar),
            anahtar = string.Join(" ", Enumerable.Range(0, (anahtar.Length + 3) / 4).Select(i => anahtar.Substring(i * 4, Math.Min(4, anahtar.Length - i * 4)))),
            otpauth = adres,
            qrSvg = QrSvg(adres)
        };
    }

    // ---------------------------------------------------------------- dosya

    private Depo Oku()
    {
        try
        {
            if (!File.Exists(_dosya)) return new Depo();
            return JsonSerializer.Deserialize<Depo>(File.ReadAllText(_dosya)) ?? new Depo();
        }
        catch (JsonException)
        {
            return new Depo();
        }
    }

    private void Yaz(Depo d)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_dosya)!);
        var gecici = _dosya + ".tmp";
        File.WriteAllText(gecici, JsonSerializer.Serialize(d, JsonAyar));
        File.Move(gecici, _dosya, overwrite: true);
    }

    private const string Alfabe = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    private static string Base32(byte[] veri)
    {
        var sb = new StringBuilder();
        int tampon = 0, bit = 0;
        foreach (var b in veri)
        {
            tampon = (tampon << 8) | b; bit += 8;
            while (bit >= 5) { sb.Append(Alfabe[(tampon >> (bit - 5)) & 31]); bit -= 5; }
        }
        if (bit > 0) sb.Append(Alfabe[(tampon << (5 - bit)) & 31]);
        return sb.ToString();
    }

    private static byte[]? Base32Coz(string metin)
    {
        var temiz = (metin ?? string.Empty).Trim().TrimEnd('=').Replace(" ", "").ToUpperInvariant();
        var cikti = new List<byte>();
        int tampon = 0, bit = 0;
        foreach (var c in temiz)
        {
            var v = Alfabe.IndexOf(c);
            if (v < 0) return null;
            tampon = (tampon << 5) | v; bit += 5;
            if (bit >= 8) { cikti.Add((byte)(tampon >> (bit - 8))); bit -= 8; }
        }
        return cikti.Count >= 10 ? cikti.ToArray() : null;
    }
}
