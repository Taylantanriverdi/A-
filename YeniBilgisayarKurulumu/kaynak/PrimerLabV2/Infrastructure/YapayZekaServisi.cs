using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.DataProtection;

namespace PrimerLabV2.Infrastructure;

/// <summary>Primer AI'nin bir isteği hangi iş için gönderdiği (uzunluk ve düşünme derinliği buna göre seçilir).</summary>
public enum YapayZekaAmaci
{
    Sohbet,
    MailAnalizi,
    BaglantiTesti
}

public sealed class YapayZekaAyari
{
    public string Saglayici { get; init; } = YapayZekaServisi.Claude;
    public string ApiKey { get; init; } = string.Empty;
    public string Model { get; init; } = string.Empty;
}

/// <summary>
/// Primer AI sağlayıcıları: Claude (Anthropic), OpenAI ve DeepSeek. Anahtarlar ayrı dosyalarda,
/// Windows veri koruması ile şifreli saklanır; Ayarlar'da seçilen sağlayıcı kullanılır.
/// Sohbet asistanı ve mail sipariş analizi bu servisi kullanır.
/// </summary>
public sealed class YapayZekaServisi
{
    public const string Claude = "claude";
    public const string OpenAi = "openai";
    public const string DeepSeek = "deepseek";

    // DeepSeek (OpenAI uyumlu Chat Completions API, araç çağırma destekli).
    public const string DeepSeekVarsayilanModel = "deepseek-chat";
    public static readonly string[] DeepSeekModeller = { "deepseek-chat", "deepseek-reasoner" };
    private const string DeepSeekKorumaAmaci = "PrimerLab.DeepSeek.ApiKey.v1";
    public const string DeepSeekAdresi = "https://api.deepseek.com/chat/completions";
    public const string OpenAiSohbetAdresi = "https://api.openai.com/v1/chat/completions";

    // OpenAI: önceki sürümdeki model listesi ve dosya/koruma adları aynen korunur,
    // böylece daha önce kaydedilmiş OpenAI anahtarı yeniden girmeden çalışır.
    public const string OpenAiVarsayilanModel = "gpt-5.6-terra";
    public static readonly string[] OpenAiModeller = { "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna" };
    private const string OpenAiKorumaAmaci = "PrimerLab.OpenAI.ApiKey.v1";

    private static readonly JsonSerializerOptions JsonAyar = new() { WriteIndented = true };

    private readonly string _gizliKlasor;
    private readonly IDataProtector _claudeKoruma;
    private readonly IDataProtector _openAiKoruma;
    private readonly IDataProtector _deepSeekKoruma;
    private readonly IHttpClientFactory _httpFactory;
    private readonly object _dosyaKilidi = new();

    public YapayZekaServisi(
        IWebHostEnvironment environment,
        IDataProtectionProvider dataProtectionProvider,
        IHttpClientFactory httpFactory)
    {
        _gizliKlasor = Path.Combine(environment.ContentRootPath, "App_Data", "Secrets");
        _claudeKoruma = dataProtectionProvider.CreateProtector(ClaudeIstemcisi.KorumaAmaci);
        _openAiKoruma = dataProtectionProvider.CreateProtector(OpenAiKorumaAmaci);
        _deepSeekKoruma = dataProtectionProvider.CreateProtector(DeepSeekKorumaAmaci);
        _httpFactory = httpFactory;
    }

    public static bool GecerliSaglayici(string? s) => s is Claude or OpenAi or DeepSeek;

    public static string SaglayiciAdi(string saglayici) => saglayici switch
    {
        OpenAi => "OpenAI",
        DeepSeek => "DeepSeek",
        _ => "Claude"
    };

    public static string[] Modeller(string saglayici) => saglayici switch
    {
        OpenAi => OpenAiModeller,
        DeepSeek => DeepSeekModeller,
        _ => ClaudeIstemcisi.Modeller
    };

    public static string ModelNormalize(string saglayici, string? model)
    {
        var m = (model ?? string.Empty).Trim();
        return saglayici switch
        {
            OpenAi => OpenAiModeller.Contains(m) ? m : OpenAiVarsayilanModel,
            DeepSeek => DeepSeekModeller.Contains(m) ? m : DeepSeekVarsayilanModel,
            _ => ClaudeIstemcisi.ModelNormalize(model)
        };
    }

    /// <summary>Sağlayıcı yerel araç çağırmayı (function calling) destekliyor mu (DeepSeek, OpenAI).</summary>
    public static bool YerelAracDestegi(string saglayici) => saglayici is DeepSeek or OpenAi;

    /// <summary>Anahtar biçimi uygunsa null, değilse kullanıcıya gösterilecek mesaj.</summary>
    public static string? AnahtarBicimHatasi(string saglayici, string anahtar)
    {
        if (saglayici == OpenAi)
            return anahtar.Length < 20 || anahtar.Any(char.IsWhiteSpace)
                ? "OpenAI API anahtarı geçersiz görünüyor (platform.openai.com > API keys)."
                : null;

        if (saglayici == DeepSeek)
            return !anahtar.StartsWith("sk-", StringComparison.Ordinal) || anahtar.Length < 20 || anahtar.Any(char.IsWhiteSpace)
                ? "DeepSeek API anahtarı geçersiz görünüyor. Anahtar \"sk-\" ile başlar (platform.deepseek.com > API keys)."
                : null;

        return ClaudeIstemcisi.AnahtarBicimiGecerli(anahtar)
            ? null
            : "Claude API anahtarı geçersiz görünüyor. Anahtar \"sk-ant-\" ile başlamalıdır (console.anthropic.com > API Keys).";
    }

    // ---------------------------------------------------------------- ayarlar

    private string AnahtarDosyasi(string saglayici) =>
        Path.Combine(_gizliKlasor, saglayici switch
        {
            OpenAi => "primer-ai.json",
            DeepSeek => "primer-ai-deepseek.json",
            _ => "primer-ai-claude.json"
        });

    private string SecimDosyasi => Path.Combine(_gizliKlasor, "primer-ai-saglayici.json");

    private IDataProtector Koruma(string saglayici) => saglayici switch
    {
        OpenAi => _openAiKoruma,
        DeepSeek => _deepSeekKoruma,
        _ => _claudeKoruma
    };

    public YapayZekaAyari? Oku(string saglayici)
    {
        try
        {
            var yol = AnahtarDosyasi(saglayici);
            if (!File.Exists(yol)) return null;

            using var doc = JsonDocument.Parse(File.ReadAllText(yol));
            var kok = doc.RootElement;
            var korunan = Metin(kok, "ProtectedApiKey") ?? Metin(kok, "protectedApiKey");
            if (string.IsNullOrWhiteSpace(korunan)) return null;

            return new YapayZekaAyari
            {
                Saglayici = saglayici,
                ApiKey = Koruma(saglayici).Unprotect(korunan),
                Model = ModelNormalize(saglayici, Metin(kok, "Model") ?? Metin(kok, "model"))
            };
        }
        catch
        {
            // Bozuk dosya veya başka bilgisayarda şifrelenmiş anahtar: anahtar yok sayılır.
            return null;
        }
    }

    /// <summary>Seçili sağlayıcı; seçim yoksa veya seçilenin anahtarı yoksa kayıtlı olan diğeri.</summary>
    public YapayZekaAyari? Aktif()
    {
        var secim = SeciliSaglayici();
        if (secim != null && Oku(secim) is { } secili) return secili;
        return Oku(Claude) ?? Oku(DeepSeek) ?? Oku(OpenAi);
    }

    private string? SeciliSaglayici()
    {
        try
        {
            if (!File.Exists(SecimDosyasi)) return null;
            using var doc = JsonDocument.Parse(File.ReadAllText(SecimDosyasi));
            var s = Metin(doc.RootElement, "Saglayici");
            return GecerliSaglayici(s) ? s : null;
        }
        catch
        {
            return null;
        }
    }

    public void Kaydet(string saglayici, string apiKey, string model)
    {
        lock (_dosyaKilidi)
        {
            AtomikYaz(AnahtarDosyasi(saglayici), JsonSerializer.Serialize(new
            {
                ProtectedApiKey = Koruma(saglayici).Protect(apiKey),
                Model = ModelNormalize(saglayici, model),
                UpdatedAt = DateTime.UtcNow
            }, JsonAyar));
            AtomikYaz(SecimDosyasi, JsonSerializer.Serialize(new { Saglayici = saglayici }, JsonAyar));
        }
    }

    public bool AktifYap(string saglayici, string? model)
    {
        lock (_dosyaKilidi)
        {
            var ayar = Oku(saglayici);
            if (ayar == null) return false;

            // Kayıtlı anahtarla yalnız model değiştirilebilir.
            if (!string.IsNullOrWhiteSpace(model) && ModelNormalize(saglayici, model) != ayar.Model)
                Kaydet(saglayici, ayar.ApiKey, model);

            AtomikYaz(SecimDosyasi, JsonSerializer.Serialize(new { Saglayici = saglayici }, JsonAyar));
            return true;
        }
    }

    public void Sil(string saglayici)
    {
        lock (_dosyaKilidi)
        {
            var yol = AnahtarDosyasi(saglayici);
            if (File.Exists(yol)) File.Delete(yol);
        }
    }

    public object Durum()
    {
        var aktif = Aktif();
        var claude = Oku(Claude);
        var openAi = Oku(OpenAi);
        var deepSeek = Oku(DeepSeek);
        return new
        {
            Configured = aktif != null,
            Provider = aktif?.Saglayici,
            ProviderName = aktif == null ? null : SaglayiciAdi(aktif.Saglayici),
            Model = aktif?.Model,
            Claude = new { Configured = claude != null, Model = claude?.Model ?? ClaudeIstemcisi.VarsayilanModel },
            OpenAi = new { Configured = openAi != null, Model = openAi?.Model ?? OpenAiVarsayilanModel },
            DeepSeek = new { Configured = deepSeek != null, Model = deepSeek?.Model ?? DeepSeekVarsayilanModel },
            AjanModu = aktif != null && YerelAracDestegi(aktif.Saglayici) ? "yerel-arac" : "json-arac"
        };
    }

    private void AtomikYaz(string yol, string icerik)
    {
        Directory.CreateDirectory(_gizliKlasor);
        var gecici = yol + ".tmp";
        File.WriteAllText(gecici, icerik);
        File.Move(gecici, yol, overwrite: true);
    }

    private static string? Metin(JsonElement e, string ad) =>
        e.TryGetProperty(ad, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;

    // ---------------------------------------------------------------- gönderim

    public Task<YapayZekaSonuc> GonderAsync(
        YapayZekaAyari ayar,
        string sistem,
        string kullaniciMesaji,
        YapayZekaAmaci amac,
        CancellationToken ct = default)
    {
        if (ayar.Saglayici == DeepSeek)
            return DeepSeekMetinAsync(ayar, sistem, kullaniciMesaji, amac, ct);

        if (ayar.Saglayici == OpenAi)
        {
            // Önceki sürümün OpenAI ayarları (yanıt uzunluğu ve düşünme derinliği) korunur.
            var (uzunluk, efor) = amac switch
            {
                YapayZekaAmaci.Sohbet => (2200, "low"),
                YapayZekaAmaci.MailAnalizi => (1200, "none"),
                _ => (256, "none")
            };
            return OpenAiGonderAsync(ayar.ApiKey, ayar.Model, sistem, kullaniciMesaji, uzunluk, efor, ct);
        }

        // Claude'da düşünme her zaman açıktır ve yanıt sınırına dahildir; sınırlar buna göre geniştir.
        var (claudeUzunluk, claudeEfor) = amac switch
        {
            YapayZekaAmaci.Sohbet => (16000, "medium"),
            YapayZekaAmaci.MailAnalizi => (4000, "low"),
            _ => (2048, "low")
        };
        return ClaudeIstemcisi.GonderAsync(ayar.ApiKey, ayar.Model, sistem, kullaniciMesaji, claudeUzunluk, claudeEfor, ct);
    }

    // OpenAI Responses API (önceki sürümdeki çağrının aynısı).
    private async Task<YapayZekaSonuc> OpenAiGonderAsync(
        string apiKey,
        string model,
        string instructions,
        string input,
        int maxOutputTokens,
        string reasoningEffort,
        CancellationToken ct)
    {
        var http = _httpFactory.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(90);

        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/responses");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

        var payload = new
        {
            model = ModelNormalize(OpenAi, model),
            instructions,
            input,
            reasoning = new { effort = reasoningEffort },
            max_output_tokens = Math.Max(maxOutputTokens, 256),
            store = false
        };

        request.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

        try
        {
            using var response = await http.SendAsync(request, ct);
            var body = await response.Content.ReadAsStringAsync(ct);
            var requestId = response.Headers.TryGetValues("x-request-id", out var ids) ? ids.FirstOrDefault() : null;

            if (!response.IsSuccessStatusCode)
            {
                var detail = OpenAiHatasi(body);
                if (string.IsNullOrWhiteSpace(detail)) detail = body;
                if (string.IsNullOrWhiteSpace(detail)) detail = $"{(int)response.StatusCode} {response.ReasonPhrase}";
                if (detail.Length > 1800) detail = detail[..1800];
                return YapayZekaSonuc.Hatali($"HTTP {(int)response.StatusCode}: {detail}", requestId);
            }

            var text = OpenAiMetni(body);
            return string.IsNullOrWhiteSpace(text)
                ? YapayZekaSonuc.Hatali("OpenAI boş yanıt döndürdü.", requestId)
                : new YapayZekaSonuc(true, text, null, requestId);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return YapayZekaSonuc.Hatali("OpenAI zamanında yanıt vermedi. Tekrar deneyin.");
        }
        catch (HttpRequestException)
        {
            return YapayZekaSonuc.Hatali("OpenAI'ye bağlanılamadı. İnternet bağlantısını kontrol edin.");
        }
        catch (JsonException)
        {
            return YapayZekaSonuc.Hatali("OpenAI yanıtı okunamadı.");
        }
    }

    private static string? OpenAiHatasi(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("error", out var error) &&
                error.TryGetProperty("message", out var message))
            {
                return message.GetString();
            }
        }
        catch (JsonException)
        {
        }
        return null;
    }

    private static string OpenAiMetni(string json)
    {
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.TryGetProperty("output_text", out var ot) && ot.ValueKind == JsonValueKind.String)
            return ot.GetString() ?? string.Empty;

        if (!doc.RootElement.TryGetProperty("output", out var output) || output.ValueKind != JsonValueKind.Array)
            return string.Empty;

        foreach (var item in output.EnumerateArray())
        {
            if (!item.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.Array)
                continue;

            foreach (var c in content.EnumerateArray())
            {
                if (c.TryGetProperty("type", out var type) &&
                    type.GetString() == "output_text" &&
                    c.TryGetProperty("text", out var text))
                {
                    return text.GetString() ?? string.Empty;
                }
            }
        }

        return string.Empty;
    }

    // ---------------------------------------------------------------- DeepSeek / OpenAI uyumlu sohbet + araç çağırma

    private async Task<YapayZekaSonuc> DeepSeekMetinAsync(YapayZekaAyari ayar, string sistem, string mesaj, YapayZekaAmaci amac, CancellationToken ct)
    {
        var mesajlar = new List<JsonObject>
        {
            new() { ["role"] = "system", ["content"] = sistem },
            new() { ["role"] = "user", ["content"] = mesaj }
        };
        var uzunluk = amac switch { YapayZekaAmaci.Sohbet => 4000, YapayZekaAmaci.MailAnalizi => 2000, _ => 64 };
        var y = await AracliTurAsync(ayar, mesajlar, null, uzunluk, ct, jsonCikti: amac == YapayZekaAmaci.MailAnalizi);
        if (!y.Basarili) return YapayZekaSonuc.Hatali(y.Hata ?? "DeepSeek yanıt vermedi.", y.IstekNo);
        return string.IsNullOrWhiteSpace(y.Metin)
            ? YapayZekaSonuc.Hatali("DeepSeek boş yanıt döndürdü.", y.IstekNo)
            : new YapayZekaSonuc(true, y.Metin, null, y.IstekNo);
    }

    /// <summary>
    /// OpenAI uyumlu Chat Completions çağrısı (DeepSeek ve OpenAI). Araç tanımları verilirse model
    /// araç çağırabilir; dönen asistan mesajı (araç çağrılarıyla) olduğu gibi geçmişe eklenebilir.
    /// </summary>
    public async Task<AracliYanit> AracliTurAsync(
        YapayZekaAyari ayar,
        List<JsonObject> mesajlar,
        JsonArray? araclar,
        int enFazlaUzunluk,
        CancellationToken ct,
        bool jsonCikti = false)
    {
        var adres = ayar.Saglayici == OpenAi ? OpenAiSohbetAdresi : DeepSeekAdresi;
        var ozelAdres = Environment.GetEnvironmentVariable("PRIMERLAB_DEEPSEEK_URL");
        if (ayar.Saglayici == DeepSeek && !string.IsNullOrWhiteSpace(ozelAdres)) adres = ozelAdres;

        var govde = new JsonObject
        {
            ["model"] = ModelNormalize(ayar.Saglayici, ayar.Model),
            ["messages"] = new JsonArray(mesajlar.Select(m => (JsonNode)m.DeepClone()).ToArray()),
            ["stream"] = false
        };
        if (ayar.Saglayici == OpenAi) govde["max_completion_tokens"] = Math.Max(enFazlaUzunluk, 256);
        else
        {
            govde["max_tokens"] = Math.Clamp(enFazlaUzunluk, 16, 8192);
            if (ayar.Model != "deepseek-reasoner") govde["temperature"] = 0.2;
        }
        if (araclar != null && araclar.Count > 0)
        {
            govde["tools"] = araclar.DeepClone();
            govde["tool_choice"] = "auto";
        }
        else if (jsonCikti) govde["response_format"] = new JsonObject { ["type"] = "json_object" };

        var ilk = await IstekAsync(adres, ayar.ApiKey, govde.ToJsonString(), ct);
        // Bazı DeepSeek sürümleri geçmişte reasoning_content alanını kabul etmez: alan çıkarılıp tekrar denenir.
        if (!ilk.Basarili && (ilk.Hata ?? "").Contains("reasoning_content", StringComparison.OrdinalIgnoreCase))
        {
            foreach (var m in ((JsonArray)govde["messages"]!).OfType<JsonObject>()) m.Remove("reasoning_content");
            ilk = await IstekAsync(adres, ayar.ApiKey, govde.ToJsonString(), ct);
        }
        return ilk;
    }

    private async Task<AracliYanit> IstekAsync(string adres, string apiKey, string json, CancellationToken ct)
    {
        var http = _httpFactory.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(180);
        using var istek = new HttpRequestMessage(HttpMethod.Post, adres);
        istek.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        istek.Content = new StringContent(json, Encoding.UTF8, "application/json");
        try
        {
            using var yanit = await http.SendAsync(istek, ct);
            var govde = await yanit.Content.ReadAsStringAsync(ct);
            var istekNo = yanit.Headers.TryGetValues("x-request-id", out var ids) ? ids.FirstOrDefault() : null;
            if (!yanit.IsSuccessStatusCode)
            {
                var detay = OpenAiHatasi(govde) ?? govde;
                if (string.IsNullOrWhiteSpace(detay)) detay = $"{(int)yanit.StatusCode} {yanit.ReasonPhrase}";
                if (detay.Length > 1500) detay = detay[..1500];
                var ipucu = (int)yanit.StatusCode switch
                {
                    401 => " (API anahtarı geçersiz.)",
                    402 => " (Hesap bakiyesi yetersiz: platform.deepseek.com > Top up ile bakiye yükleyin.)",
                    429 => " (Çok fazla istek; biraz bekleyip tekrar deneyin.)",
                    _ => ""
                };
                return AracliYanit.Hatali($"HTTP {(int)yanit.StatusCode}: {detay}{ipucu}", istekNo);
            }

            var kok = JsonNode.Parse(govde)!.AsObject();
            var mesaj = kok["choices"]?[0]?["message"]?.AsObject();
            if (mesaj == null) return AracliYanit.Hatali("Yanıt okunamadı.", istekNo);
            var cagrilar = new List<AracCagrisi>();
            if (mesaj["tool_calls"] is JsonArray tc)
                foreach (var c in tc.OfType<JsonObject>())
                    cagrilar.Add(new AracCagrisi(
                        c["id"]?.GetValue<string>() ?? Guid.NewGuid().ToString("N"),
                        c["function"]?["name"]?.GetValue<string>() ?? "",
                        c["function"]?["arguments"]?.GetValue<string>() ?? "{}"));

            var asistan = new JsonObject { ["role"] = "assistant", ["content"] = mesaj["content"]?.DeepClone() };
            if (mesaj["reasoning_content"] is JsonNode rc) asistan["reasoning_content"] = rc.DeepClone();
            if (mesaj["tool_calls"] is JsonNode tcs) asistan["tool_calls"] = tcs.DeepClone();
            var metin = mesaj["content"] is JsonValue v && v.TryGetValue<string>(out var str) ? str : null;
            var kullanim = kok["usage"]?["total_tokens"]?.GetValue<int>() ?? 0;
            return new AracliYanit(true, metin, cagrilar, asistan, null, istekNo, kullanim);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return AracliYanit.Hatali("Yapay zekâ zamanında yanıt vermedi. Tekrar deneyin.");
        }
        catch (HttpRequestException)
        {
            return AracliYanit.Hatali("Yapay zekâ sunucusuna bağlanılamadı. İnternet bağlantısını kontrol edin.");
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException)
        {
            return AracliYanit.Hatali("Yapay zekâ yanıtı okunamadı: " + ex.Message);
        }
    }
}

public sealed record AracCagrisi(string Id, string Ad, string ArgumanlarJson);

public sealed record AracliYanit(
    bool Basarili,
    string? Metin,
    List<AracCagrisi> Cagrilar,
    JsonObject? AsistanMesaji,
    string? Hata,
    string? IstekNo,
    int Token)
{
    public static AracliYanit Hatali(string hata, string? istekNo = null) =>
        new(false, null, new List<AracCagrisi>(), null, hata, istekNo, 0);
}
