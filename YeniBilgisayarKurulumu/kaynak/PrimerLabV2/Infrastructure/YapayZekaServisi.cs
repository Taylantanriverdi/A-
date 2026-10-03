using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
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
/// Primer AI sağlayıcıları: Claude (Anthropic) ve OpenAI. İki anahtar ayrı dosyalarda,
/// Windows veri koruması ile şifreli saklanır; Ayarlar'da seçilen sağlayıcı kullanılır.
/// Sohbet asistanı ve mail sipariş analizi bu servisi kullanır.
/// </summary>
public sealed class YapayZekaServisi
{
    public const string Claude = "claude";
    public const string OpenAi = "openai";

    // OpenAI: önceki sürümdeki model listesi ve dosya/koruma adları aynen korunur,
    // böylece daha önce kaydedilmiş OpenAI anahtarı yeniden girmeden çalışır.
    public const string OpenAiVarsayilanModel = "gpt-5.6-terra";
    public static readonly string[] OpenAiModeller = { "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna" };
    private const string OpenAiKorumaAmaci = "PrimerLab.OpenAI.ApiKey.v1";

    private static readonly JsonSerializerOptions JsonAyar = new() { WriteIndented = true };

    private readonly string _gizliKlasor;
    private readonly IDataProtector _claudeKoruma;
    private readonly IDataProtector _openAiKoruma;
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
        _httpFactory = httpFactory;
    }

    public static bool GecerliSaglayici(string? s) => s is Claude or OpenAi;

    public static string SaglayiciAdi(string saglayici) => saglayici == OpenAi ? "OpenAI" : "Claude";

    public static string[] Modeller(string saglayici) =>
        saglayici == OpenAi ? OpenAiModeller : ClaudeIstemcisi.Modeller;

    public static string ModelNormalize(string saglayici, string? model)
    {
        if (saglayici != OpenAi) return ClaudeIstemcisi.ModelNormalize(model);
        var m = (model ?? string.Empty).Trim();
        return OpenAiModeller.Contains(m) ? m : OpenAiVarsayilanModel;
    }

    /// <summary>Anahtar biçimi uygunsa null, değilse kullanıcıya gösterilecek mesaj.</summary>
    public static string? AnahtarBicimHatasi(string saglayici, string anahtar)
    {
        if (saglayici == OpenAi)
            return anahtar.Length < 20 || anahtar.Any(char.IsWhiteSpace)
                ? "OpenAI API anahtarı geçersiz görünüyor (platform.openai.com > API keys)."
                : null;

        return ClaudeIstemcisi.AnahtarBicimiGecerli(anahtar)
            ? null
            : "Claude API anahtarı geçersiz görünüyor. Anahtar \"sk-ant-\" ile başlamalıdır (console.anthropic.com > API Keys).";
    }

    // ---------------------------------------------------------------- ayarlar

    private string AnahtarDosyasi(string saglayici) =>
        Path.Combine(_gizliKlasor, saglayici == OpenAi ? "primer-ai.json" : "primer-ai-claude.json");

    private string SecimDosyasi => Path.Combine(_gizliKlasor, "primer-ai-saglayici.json");

    private IDataProtector Koruma(string saglayici) => saglayici == OpenAi ? _openAiKoruma : _claudeKoruma;

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
        return Oku(Claude) ?? Oku(OpenAi);
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
        return new
        {
            Configured = aktif != null,
            Provider = aktif?.Saglayici,
            ProviderName = aktif == null ? null : SaglayiciAdi(aktif.Saglayici),
            Model = aktif?.Model,
            Claude = new { Configured = claude != null, Model = claude?.Model ?? ClaudeIstemcisi.VarsayilanModel },
            OpenAi = new { Configured = openAi != null, Model = openAi?.Model ?? OpenAiVarsayilanModel }
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
}
