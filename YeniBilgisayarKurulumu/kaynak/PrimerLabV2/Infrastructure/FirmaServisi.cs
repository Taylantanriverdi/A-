using System.Text.Encodings.Web;
using System.Text.Json;

namespace PrimerLabV2.Infrastructure;

/// <summary>
/// Yazılımı kullanan laboratuvarın kimliği: firma adı, logo, adres, telefon, e-posta...
/// Sipariş formu, cari/makbuz çıktıları, hekim portalı, teknisyen paneli, e-posta ve WhatsApp
/// mesajlarında bu bilgiler kullanılır. App_Data\firma-bilgileri.json ve App_Data\firma-logo.*
/// içinde saklanır (yedekle birlikte taşınır).
/// </summary>
public sealed class FirmaServisi
{
    public const string VarsayilanAd = "Primer Dental Lab";
    public const int LogoAzamiBoyut = 1024 * 1024;

    private readonly string _klasor;
    private readonly string _dosya;
    private readonly object _kilit = new();
    private Bilgiler? _onbellek;
    private string? _logoDataUrl;
    private bool _logoOkundu;

    private static readonly JsonSerializerOptions YazAyar = new() { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    // Sayfaya <script> içinde gömülür: < > & ' kaçışlı kalmalı (varsayılan kodlayıcı).
    private static readonly JsonSerializerOptions SayfaAyar = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    /// <summary>Statik yardımcıların (e-posta şablonu, giriş sayfası) erişimi için tekil örnek.</summary>
    public static FirmaServisi? Ornek { get; private set; }

    public FirmaServisi(IWebHostEnvironment environment)
    {
        Ornek = this;
        _klasor = Path.Combine(environment.ContentRootPath, "App_Data");
        _dosya = Path.Combine(_klasor, "firma-bilgileri.json");
    }

    public sealed class Bilgiler
    {
        public string FirmaAdi { get; set; } = VarsayilanAd;
        public string? AltBaslik { get; set; } = "Diş Protez Laboratuvarı";
        public string? Adres { get; set; }
        public string? Telefon { get; set; }
        public string? Eposta { get; set; }
        public string? WebSitesi { get; set; }
        public string? VergiDairesi { get; set; }
        public string? VergiNo { get; set; }
        /// <summary>Sipariş formu ve çıktıların altına yazılan kısa not (ör. çalışma saatleri, IBAN).</summary>
        public string? FormAltNotu { get; set; }
        public string? LogoDosyasi { get; set; }
        public DateTime? GuncellemeTarihi { get; set; }
    }

    public Bilgiler Oku()
    {
        lock (_kilit)
        {
            if (_onbellek != null) return _onbellek;
            try
            {
                _onbellek = File.Exists(_dosya)
                    ? JsonSerializer.Deserialize<Bilgiler>(File.ReadAllText(_dosya)) ?? new Bilgiler()
                    : new Bilgiler();
            }
            catch (JsonException) { _onbellek = new Bilgiler(); }
            if (string.IsNullOrWhiteSpace(_onbellek.FirmaAdi)) _onbellek.FirmaAdi = VarsayilanAd;
            return _onbellek;
        }
    }

    /// <summary>Firma adı (mesaj ve şablonlarda kullanılır).</summary>
    public string Ad => Oku().FirmaAdi;

    public void Kaydet(Bilgiler yeni)
    {
        lock (_kilit)
        {
            var eski = Oku();
            yeni.LogoDosyasi = eski.LogoDosyasi;
            yeni.FirmaAdi = string.IsNullOrWhiteSpace(yeni.FirmaAdi) ? VarsayilanAd : yeni.FirmaAdi.Trim();
            yeni.GuncellemeTarihi = DateTime.UtcNow;
            Yaz(yeni);
        }
    }

    /// <summary>Logo kaydeder; yalnız PNG, JPEG ve WEBP (içerik imzasına bakılır). Hata metni döner.</summary>
    public string? LogoKaydet(byte[] veri)
    {
        if (veri.Length == 0) return "Dosya boş.";
        if (veri.Length > LogoAzamiBoyut) return "Logo en fazla 1 MB olabilir. Daha küçük bir PNG/JPG seçin.";
        var uzanti = Tur(veri);
        if (uzanti == null) return "Logo PNG, JPG veya WEBP olmalı.";
        lock (_kilit)
        {
            var b = Oku();
            Directory.CreateDirectory(_klasor);
            if (b.LogoDosyasi != null) { try { File.Delete(Path.Combine(_klasor, b.LogoDosyasi)); } catch (IOException) { } }
            var ad = "firma-logo" + uzanti;
            File.WriteAllBytes(Path.Combine(_klasor, ad), veri);
            b.LogoDosyasi = ad;
            b.GuncellemeTarihi = DateTime.UtcNow;
            Yaz(b);
        }
        return null;
    }

    public void LogoSil()
    {
        lock (_kilit)
        {
            var b = Oku();
            if (b.LogoDosyasi != null) { try { File.Delete(Path.Combine(_klasor, b.LogoDosyasi)); } catch (IOException) { } }
            b.LogoDosyasi = null;
            b.GuncellemeTarihi = DateTime.UtcNow;
            Yaz(b);
        }
    }

    /// <summary>Logo "data:" adresi olarak (çıktı pencerelerinde ve e-postada ayrı istek gerekmez).</summary>
    public string? LogoDataUrl()
    {
        lock (_kilit)
        {
            if (_logoOkundu) return _logoDataUrl;
            _logoOkundu = true;
            _logoDataUrl = null;
            var b = Oku();
            if (b.LogoDosyasi == null) return null;
            var yol = Path.Combine(_klasor, Path.GetFileName(b.LogoDosyasi));
            if (!File.Exists(yol)) return null;
            var veri = File.ReadAllBytes(yol);
            var mime = Tur(veri) switch { ".png" => "image/png", ".jpg" => "image/jpeg", ".webp" => "image/webp", _ => null };
            if (mime == null) return null;
            _logoDataUrl = "data:" + mime + ";base64," + Convert.ToBase64String(veri);
            return _logoDataUrl;
        }
    }

    /// <summary>Logo yokken kullanılan baş harfler ("Primer Dental Lab" → "PDL", en fazla 3).</summary>
    public static string Kisaltma(string ad)
    {
        var harf = ad.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(p => char.IsLetterOrDigit(p[0]))
            .Select(p => char.ToUpper(p[0], new System.Globalization.CultureInfo("tr-TR")))
            .Take(3).ToArray();
        return harf.Length == 0 ? "L" : new string(harf);
    }

    /// <summary>Sayfalara gömülen bilgi (window.FIRMA). Güvenli: HTML'e duyarlı karakterler kaçışlıdır.</summary>
    public string IstemciJson()
    {
        var b = Oku();
        return JsonSerializer.Serialize(new
        {
            ad = b.FirmaAdi,
            altBaslik = b.AltBaslik,
            adres = b.Adres,
            telefon = b.Telefon,
            eposta = b.Eposta,
            web = b.WebSitesi,
            vergiDairesi = b.VergiDairesi,
            vergiNo = b.VergiNo,
            formAltNotu = b.FormAltNotu,
            kisaltma = Kisaltma(b.FirmaAdi),
            logo = LogoDataUrl()
        }, SayfaAyar);
    }

    /// <summary>Tek satırlık iletişim bilgisi (adres · tel · e-posta · web).</summary>
    public string IletisimSatiri()
    {
        var b = Oku();
        return string.Join(" · ", new[] { b.Adres, b.Telefon, b.Eposta, b.WebSitesi }.Where(x => !string.IsNullOrWhiteSpace(x)));
    }

    private static string? Tur(byte[] v)
    {
        if (v.Length > 8 && v[0] == 0x89 && v[1] == 0x50 && v[2] == 0x4E && v[3] == 0x47) return ".png";
        if (v.Length > 3 && v[0] == 0xFF && v[1] == 0xD8 && v[2] == 0xFF) return ".jpg";
        if (v.Length > 12 && v[0] == 'R' && v[1] == 'I' && v[2] == 'F' && v[3] == 'F' && v[8] == 'W' && v[9] == 'E' && v[10] == 'B' && v[11] == 'P') return ".webp";
        return null;
    }

    private void Yaz(Bilgiler b)
    {
        Directory.CreateDirectory(_klasor);
        var gecici = _dosya + ".tmp";
        File.WriteAllText(gecici, JsonSerializer.Serialize(b, YazAyar));
        File.Move(gecici, _dosya, overwrite: true);
        _onbellek = b;
        _logoOkundu = false;
    }
}
