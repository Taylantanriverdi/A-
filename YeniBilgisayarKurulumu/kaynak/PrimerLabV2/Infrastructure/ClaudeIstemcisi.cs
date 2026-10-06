using System.Text.Json;
using Anthropic;
using Anthropic.Exceptions;
using Anthropic.Models.Beta;
using Anthropic.Models.Beta.Messages;

namespace PrimerLabV2.Infrastructure;

/// <summary>
/// Primer AI'nin yapay zekâ bağlantısı: Anthropic Claude API (resmi Anthropic C# SDK).
/// Sohbet asistanı ve mail sipariş analizi bu sınıfı kullanır. API anahtarı
/// App_Data\Secrets\primer-ai-claude.json içinde Windows veri koruması ile şifreli saklanır.
/// </summary>
public static class ClaudeIstemcisi
{
    public const string VarsayilanModel = "claude-opus-5-5";
    public const string KorumaAmaci = "PrimerLab.Claude.ApiKey.v1";

    // Ayarlar ekranında seçilebilen modeller.
    public static readonly string[] Modeller =
    {
        "claude-opus-5-5",
        "claude-sonnet-5-5",
        "claude-haiku-4-5"
    };

    public static string ModelNormalize(string? model)
    {
        var m = (model ?? string.Empty).Trim();
        return Modeller.Contains(m) ? m : VarsayilanModel;
    }

    public static string AyarDosyasi(string contentRoot) =>
        Path.Combine(contentRoot, "App_Data", "Secrets", "primer-ai-claude.json");

    public static bool AnahtarBicimiGecerli(string anahtar) =>
        anahtar.StartsWith("sk-ant-", StringComparison.Ordinal) &&
        anahtar.Length >= 30 &&
        !anahtar.Any(char.IsWhiteSpace);

    private static readonly object IstemciKilidi = new();
    private static (string Anahtar, AnthropicClient Istemci)? _istemci;

    // Aynı anahtar için tek istemci (HTTP bağlantıları yeniden kullanılır).
    private static AnthropicClient Istemci(string apiKey)
    {
        lock (IstemciKilidi)
        {
            if (_istemci is { } mevcut && mevcut.Anahtar == apiKey) return mevcut.Istemci;
            var yeni = new AnthropicClient
            {
                ApiKey = apiKey,
                Timeout = TimeSpan.FromSeconds(180),
                MaxRetries = 2
            };
            _istemci = (apiKey, yeni);
            return yeni;
        }
    }

    /// <param name="efor">low | medium | high (Claude Haiku 4.5'te kullanılmaz).</param>
    public static async Task<YapayZekaSonuc> GonderAsync(
        string apiKey,
        string model,
        string sistem,
        string kullaniciMesaji,
        int maxTokens,
        string efor,
        CancellationToken ct = default)
    {
        model = ModelNormalize(model);

        var parametreler = new MessageCreateParams
        {
            Model = model,
            MaxTokens = maxTokens,
            System = sistem,
            Messages = [new() { Role = Role.User, Content = kullaniciMesaji }]
        };

        // Haiku 4.5 efor ayarını desteklemez; diğer modellerde düşünme derinliği buradan ayarlanır.
        if (model != "claude-haiku-4-5")
        {
            parametreler = parametreler with
            {
                OutputConfig = new BetaOutputConfig
                {
                    Effort = efor switch { "low" => Effort.Low, "high" => Effort.High, _ => Effort.Medium }
                }
            };
        }

        // Claude Opus 5.5 bir isteği güvenlik nedeniyle reddederse aynı çağrı içinde
        // Claude Opus 4.8 ile yeniden yanıtlanır (sunucu taraflı yedek model).
        if (model == "claude-opus-5-5")
        {
            parametreler = parametreler with
            {
                Betas = [AnthropicBeta.ServerSideFallback2026_06_01],
                Fallbacks = new List<BetaFallbackParam> { new() { Model = Anthropic.Models.Messages.Model.ClaudeOpus4_8 } }
            };
        }

        try
        {
            BetaMessage yanit = await Istemci(apiKey).Beta.Messages.Create(parametreler, ct);

            if (yanit.StopReason == "refusal")
                return YapayZekaSonuc.Hatali("Claude bu isteği güvenlik nedeniyle yanıtlamadı. Soruyu farklı ifade edin.", yanit.ID);

            var metin = string.Concat(yanit.Content.Select(b => b.TryPickText(out var t) ? t.Text : string.Empty)).Trim();

            if (string.IsNullOrWhiteSpace(metin))
            {
                return YapayZekaSonuc.Hatali(
                    yanit.StopReason == "max_tokens"
                        ? "Claude yanıtı uzunluk sınırına takıldı; soruyu daraltıp tekrar deneyin."
                        : "Claude boş yanıt döndürdü.",
                    yanit.ID);
            }

            return new YapayZekaSonuc(true, metin, null, yanit.ID);
        }
        catch (AnthropicUnauthorizedException)
        {
            return YapayZekaSonuc.Hatali("Claude API anahtarı geçersiz veya iptal edilmiş.");
        }
        catch (AnthropicRateLimitException)
        {
            return YapayZekaSonuc.Hatali("Claude kullanım sınırına ulaşıldı. Biraz sonra tekrar deneyin.");
        }
        catch (AnthropicApiException ex)
        {
            return YapayZekaSonuc.Hatali(ApiHataMesaji(ex.Message));
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return YapayZekaSonuc.Hatali("Claude zamanında yanıt vermedi. Tekrar deneyin.");
        }
        catch (HttpRequestException)
        {
            return YapayZekaSonuc.Hatali("Claude'a bağlanılamadı. İnternet bağlantısını kontrol edin.");
        }
    }

    // SDK hata metni "Status Code: ...\n{json}" biçimindedir; kullanıcıya JSON içindeki mesaj gösterilir.
    private static string ApiHataMesaji(string ham)
    {
        var bas = ham.IndexOf('{');
        if (bas >= 0)
        {
            try
            {
                using var doc = JsonDocument.Parse(ham[bas..]);
                if (doc.RootElement.TryGetProperty("error", out var hata) &&
                    hata.TryGetProperty("message", out var mesaj) &&
                    mesaj.GetString() is { Length: > 0 } m)
                {
                    if (m.Contains("credit balance", StringComparison.OrdinalIgnoreCase))
                        return "Claude hesabınızda kredi kalmamış. console.anthropic.com > Billing bölümünden kredi yükleyin.";
                    return m.Length > 600 ? m[..600] : m;
                }
            }
            catch (JsonException)
            {
            }
        }
        return ham.Length > 600 ? ham[..600] : ham;
    }
}

public sealed record YapayZekaSonuc(bool Basarili, string? Metin, string? Hata, string? IstekNo)
{
    public static YapayZekaSonuc Hatali(string hata, string? istekNo = null) => new(false, null, hata, istekNo);
}
