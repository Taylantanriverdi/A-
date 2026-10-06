using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection;

namespace PrimerLabV2.Infrastructure;

/// <summary>
/// WhatsApp Business Cloud API (Meta, resmi) bağlantısı: ayarlar, mesaj gönderimi, olay günlüğü.
///
/// Gönderim kuralı (Meta): kişi son 24 saat içinde bize yazdıysa serbest metin gönderilir (ücretsiz);
/// yazmadıysa yalnız onaylı şablon gönderilebilir (ücretli). Bildirimler bu yüzden şablon adı ile
/// ("primer_bildirim", gövdesi tek değişkenli: {{1}}) gönderilir.
/// Erişim jetonu ve uygulama gizli anahtarı App_Data\Secrets\whatsapp-ayarlari.json içinde şifrelidir.
/// </summary>
public sealed class WhatsAppServisi
{
    private readonly string _dosya;
    private readonly IDataProtector _koruma;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<WhatsAppServisi> _log;
    private readonly object _kilit = new();
    private static readonly JsonSerializerOptions JsonAyar = new() { WriteIndented = true };

    private readonly ConcurrentDictionary<string, DateTime> _sonGelen = new();
    private readonly ConcurrentDictionary<string, DateTime> _islenenMesajlar = new();
    private readonly ConcurrentQueue<object> _gunluk = new();
    private int _bugunGiden;
    private DateTime _gun = DateTime.Today;

    public WhatsAppServisi(IWebHostEnvironment env, IDataProtectionProvider dp, IHttpClientFactory http, ILogger<WhatsAppServisi> log)
    {
        _dosya = Path.Combine(env.ContentRootPath, "App_Data", "Secrets", "whatsapp-ayarlari.json");
        _koruma = dp.CreateProtector("PrimerLab.WhatsApp.v1");
        _http = http;
        _log = log;
    }

    public sealed class Ayarlar
    {
        public bool Aktif { get; set; }
        public string? TelefonNumarasiId { get; set; }
        public string? SifreliJeton { get; set; }
        public string? SifreliUygulamaSirri { get; set; }
        public string DogrulamaJetonu { get; set; } = string.Empty;
        public string ApiSurumu { get; set; } = "v23.0";
        public List<string> Yoneticiler { get; set; } = new();
        public bool HekimSorgu { get; set; } = true;
        public bool HekimBildirim { get; set; } = true;
        public List<string> HekimBildirimOlaylari { get; set; } = new() { "Onaylandı", "Üretimde", "Tamamlandı" };
        public bool TeknisyenBildirim { get; set; } = true;
        public bool SabahOzeti { get; set; } = true;
        public int OzetSaati { get; set; } = 8;
        public bool HastaAdiKisalt { get; set; } = true;
        public string SablonAdi { get; set; } = "primer_bildirim";
        public string SablonDili { get; set; } = "tr";
        public long SonGecmisId { get; set; }
        public string? SonOzetGunu { get; set; }
        public DateTime? SonHataTarihi { get; set; }
        public string? SonHata { get; set; }
    }

    public Ayarlar Oku()
    {
        lock (_kilit)
        {
            Ayarlar a;
            try { a = File.Exists(_dosya) ? JsonSerializer.Deserialize<Ayarlar>(File.ReadAllText(_dosya)) ?? new Ayarlar() : new Ayarlar(); }
            catch (JsonException) { a = new Ayarlar(); }
            if (string.IsNullOrEmpty(a.DogrulamaJetonu))
            {
                a.DogrulamaJetonu = "primer-" + Convert.ToHexString(RandomNumberGenerator.GetBytes(12)).ToLowerInvariant();
                YazKilitsiz(a);
            }
            return a;
        }
    }

    public void Yaz(Ayarlar a)
    {
        lock (_kilit) YazKilitsiz(a);
    }

    public void Guncelle(Action<Ayarlar> degistir)
    {
        lock (_kilit)
        {
            var a = Oku();
            degistir(a);
            YazKilitsiz(a);
        }
    }

    private void YazKilitsiz(Ayarlar a)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_dosya)!);
        var gecici = _dosya + ".tmp";
        File.WriteAllText(gecici, JsonSerializer.Serialize(a, JsonAyar));
        File.Move(gecici, _dosya, overwrite: true);
    }

    public string? Jeton(Ayarlar a) => Coz(a.SifreliJeton);
    public string? UygulamaSirri(Ayarlar a) => Coz(a.SifreliUygulamaSirri);
    public string Sifrele(string metin) => _koruma.Protect(metin);

    private string? Coz(string? sifreli)
    {
        if (string.IsNullOrEmpty(sifreli)) return null;
        try { return _koruma.Unprotect(sifreli); }
        catch (CryptographicException) { return null; }
    }

    public bool Hazir(Ayarlar a) => a.Aktif && !string.IsNullOrWhiteSpace(a.TelefonNumarasiId) && Jeton(a) != null;

    // ================================================================ numara

    /// <summary>Türkiye numaralarını uluslararası biçime çevirir (05xx → 905xx); yalnız rakam.</summary>
    public static string? Numara(string? ham)
    {
        var r = Regex.Replace(ham ?? string.Empty, @"\D", "");
        if (r.StartsWith("00")) r = r[2..];
        if (r.Length == 11 && r.StartsWith("0")) r = "90" + r[1..];
        if (r.Length == 10 && r.StartsWith("5")) r = "90" + r;
        return r.Length is >= 10 and <= 15 ? r : null;
    }

    public static string Maskele(string numara) =>
        numara.Length > 6 ? numara[..4] + new string('*', numara.Length - 7) + numara[^3..] : numara;

    public bool Yonetici(Ayarlar a, string numara) => a.Yoneticiler.Select(Numara).Contains(numara);

    // ================================================================ webhook güvenliği

    /// <summary>Meta'nın X-Hub-Signature-256 imzasını uygulama gizli anahtarıyla doğrular.</summary>
    public bool ImzaDogru(Ayarlar a, byte[] govde, string? imza)
    {
        var sir = UygulamaSirri(a);
        if (sir == null || string.IsNullOrWhiteSpace(imza) || !imza.StartsWith("sha256=", StringComparison.Ordinal)) return false;
        var beklenen = HMACSHA256.HashData(Encoding.UTF8.GetBytes(sir), govde);
        byte[] gelen;
        try { gelen = Convert.FromHexString(imza[7..]); }
        catch (FormatException) { return false; }
        return CryptographicOperations.FixedTimeEquals(beklenen, gelen);
    }

    /// <summary>Aynı mesaj Meta tarafından tekrar iletilirse ikinci kez işlenmez.</summary>
    public bool YeniMesaj(string id)
    {
        if (_islenenMesajlar.Count > 5000)
            foreach (var eski in _islenenMesajlar.Where(x => x.Value < DateTime.UtcNow.AddHours(-2)).Select(x => x.Key).ToList())
                _islenenMesajlar.TryRemove(eski, out _);
        return _islenenMesajlar.TryAdd(id, DateTime.UtcNow);
    }

    public void GelenKaydet(string numara) => _sonGelen[numara] = DateTime.UtcNow;

    private bool PencereAcik(string numara) =>
        _sonGelen.TryGetValue(numara, out var t) && DateTime.UtcNow - t < TimeSpan.FromHours(23.5);

    // ================================================================ gönderim

    public sealed record GonderimSonucu(bool Basarili, string? Hata, bool SablonKullanildi);

    /// <summary>
    /// Metni gönderir. 24 saatlik pencere açıksa serbest metin; değilse (sablonaIzinVer ise) şablon.
    /// </summary>
    public async Task<GonderimSonucu> GonderAsync(string numara, string metin, bool sablonaIzinVer, CancellationToken ct = default)
    {
        var a = Oku();
        if (!Hazir(a)) return new(false, "WhatsApp ayarları eksik veya kapalı.", false);
        metin = metin.Trim();
        if (metin.Length == 0) return new(false, "Boş mesaj.", false);

        if (PencereAcik(numara) || !sablonaIzinVer)
        {
            // WhatsApp metin sınırı 4096; uzun cevaplar bölünür.
            foreach (var parca in Parcala(metin, 3800))
            {
                var r = await IstekAsync(a, new JsonObject
                {
                    ["messaging_product"] = "whatsapp",
                    ["to"] = numara,
                    ["type"] = "text",
                    ["text"] = new JsonObject { ["body"] = parca, ["preview_url"] = false }
                }, ct);
                if (!r.Basarili) return r;
            }
            Kaydet("giden", numara, metin, null);
            return new(true, null, false);
        }

        // Şablon gövde değişkeni tek satır olmalı (Meta: yeni satır / sekme kabul edilmez).
        var tekSatir = Regex.Replace(metin.Replace("\r", " ").Replace("\n", " · ").Replace("\t", " "), @" {2,}", " ");
        if (tekSatir.Length > 1000) tekSatir = tekSatir[..1000];
        var s = await IstekAsync(a, new JsonObject
        {
            ["messaging_product"] = "whatsapp",
            ["to"] = numara,
            ["type"] = "template",
            ["template"] = new JsonObject
            {
                ["name"] = a.SablonAdi,
                ["language"] = new JsonObject { ["code"] = a.SablonDili },
                ["components"] = new JsonArray(new JsonObject
                {
                    ["type"] = "body",
                    ["parameters"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = tekSatir })
                })
            }
        }, ct);
        if (s.Basarili) Kaydet("giden (şablon)", numara, tekSatir, null);
        return s with { SablonKullanildi = true };
    }

    private async Task<GonderimSonucu> IstekAsync(Ayarlar a, JsonObject govde, CancellationToken ct)
    {
        var taban = Environment.GetEnvironmentVariable("PRIMERLAB_WHATSAPP_URL") ?? "https://graph.facebook.com";
        var adres = $"{taban.TrimEnd('/')}/{a.ApiSurumu}/{a.TelefonNumarasiId}/messages";
        var http = _http.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(30);
        using var istek = new HttpRequestMessage(HttpMethod.Post, adres);
        istek.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Jeton(a));
        istek.Content = new StringContent(govde.ToJsonString(), Encoding.UTF8, "application/json");
        try
        {
            using var yanit = await http.SendAsync(istek, ct);
            var metin = await yanit.Content.ReadAsStringAsync(ct);
            if (yanit.IsSuccessStatusCode)
            {
                lock (_kilit)
                {
                    if (_gun != DateTime.Today) { _gun = DateTime.Today; _bugunGiden = 0; }
                    _bugunGiden++;
                }
                return new(true, null, false);
            }
            var hata = MetaHatasi(metin) ?? $"HTTP {(int)yanit.StatusCode}";
            HataKaydet(govde["to"]?.GetValue<string>() ?? "", hata);
            return new(false, hata, false);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            var hata = "Meta sunucusuna bağlanılamadı: " + ex.Message;
            HataKaydet(govde["to"]?.GetValue<string>() ?? "", hata);
            return new(false, hata, false);
        }
    }

    private static string? MetaHatasi(string json)
    {
        try
        {
            var e = JsonNode.Parse(json)?["error"];
            if (e == null) return null;
            var kod = e["code"]?.ToString();
            var m = e["error_user_msg"]?.GetValue<string>() ?? e["message"]?.GetValue<string>();
            var ipucu = kod switch
            {
                "190" => " (Erişim jetonu geçersiz veya süresi dolmuş: Meta'dan kalıcı jeton alıp kaydedin.)",
                "131030" => " (Alıcı numara test listesinde değil: Meta > WhatsApp > API Setup > \"To\" listesine ekleyin.)",
                "132001" => " (Şablon bulunamadı veya onaylanmadı: WhatsApp Manager'da şablonu oluşturup onay bekleyin.)",
                "131047" => " (24 saat geçtiği için serbest mesaj gönderilemez; şablon gerekir.)",
                "131026" => " (Alıcıya ulaşılamadı: numara WhatsApp kullanmıyor olabilir.)",
                _ => ""
            };
            return $"{m} [kod {kod}]{ipucu}";
        }
        catch (JsonException) { return null; }
    }

    private static IEnumerable<string> Parcala(string metin, int boyut)
    {
        while (metin.Length > boyut)
        {
            var kes = metin.LastIndexOf('\n', boyut);
            if (kes < boyut / 2) kes = boyut;
            yield return metin[..kes];
            metin = metin[kes..].TrimStart();
        }
        if (metin.Length > 0) yield return metin;
    }

    // ================================================================ günlük

    public void Kaydet(string yon, string numara, string ozet, string? hata)
    {
        _gunluk.Enqueue(new
        {
            zaman = DateTime.UtcNow,
            yon,
            numara = Maskele(numara),
            ozet = ozet.Length > 160 ? ozet[..160] + "…" : ozet,
            hata
        });
        while (_gunluk.Count > 60) _gunluk.TryDequeue(out _);
    }

    private void HataKaydet(string numara, string hata)
    {
        _log.LogWarning("WhatsApp gönderilemedi: {Hata}", hata);
        Kaydet("hata", numara, hata, hata);
        Guncelle(a => { a.SonHata = hata; a.SonHataTarihi = DateTime.UtcNow; });
    }

    public object Durum(string? webhookAdresi)
    {
        var a = Oku();
        return new
        {
            aktif = a.Aktif,
            hazir = Hazir(a),
            telefonNumarasiId = a.TelefonNumarasiId,
            jetonKayitli = Jeton(a) != null,
            uygulamaSirriKayitli = UygulamaSirri(a) != null,
            dogrulamaJetonu = a.DogrulamaJetonu,
            apiSurumu = a.ApiSurumu,
            yoneticiler = a.Yoneticiler,
            hekimSorgu = a.HekimSorgu,
            hekimBildirim = a.HekimBildirim,
            hekimBildirimOlaylari = a.HekimBildirimOlaylari,
            teknisyenBildirim = a.TeknisyenBildirim,
            sabahOzeti = a.SabahOzeti,
            ozetSaati = a.OzetSaati,
            hastaAdiKisalt = a.HastaAdiKisalt,
            sablonAdi = a.SablonAdi,
            sablonDili = a.SablonDili,
            webhookAdresi,
            bugunGonderilen = _bugunGiden,
            sonHata = a.SonHata,
            sonHataTarihi = a.SonHataTarihi,
            gunluk = _gunluk.Reverse().Take(40)
        };
    }
}
