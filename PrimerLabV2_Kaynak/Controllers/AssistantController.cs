using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;
using PrimerLabV2.Infrastructure;

namespace PrimerLabV2.Controllers
{
    [ApiController]
    [Route("api/assistant")]
    public class AssistantController : ControllerBase
    {
        private readonly PrimerLabDbContext _db;
        private readonly YapayZekaServisi _ai;

        public AssistantController(
            PrimerLabDbContext db,
            YapayZekaServisi ai)
        {
            _db = db;
            _ai = ai;
        }

        [HttpGet("status")]
        public IActionResult Status() => Ok(_ai.Durum());

        // Seçilen sağlayıcının anahtarı test edilir, kaydedilir ve o sağlayıcı kullanılmaya başlanır.
        [HttpPost("settings")]
        public async Task<IActionResult> SaveSettings(
            [FromBody] AssistantSettingsDto dto)
        {
            var saglayici = SaglayiciOku(dto.Provider);
            if (saglayici == null) return BadRequest("Geçersiz yapay zekâ sağlayıcısı.");
            var ad = YapayZekaServisi.SaglayiciAdi(saglayici);

            var key = (dto.ApiKey ?? string.Empty).Trim();
            var model = YapayZekaServisi.ModelNormalize(saglayici, dto.Model);

            // Anahtar boşsa: kayıtlı anahtarla sağlayıcıyı / modeli değiştir.
            if (key.Length == 0)
            {
                return _ai.AktifYap(saglayici, model)
                    ? Ok(_ai.Durum())
                    : BadRequest($"{ad} için kayıtlı API anahtarı yok. Önce anahtarı girin.");
            }

            if (YapayZekaServisi.AnahtarBicimHatasi(saglayici, key) is { } bicimHatasi)
                return BadRequest(bicimHatasi);

            var ayar = new YapayZekaAyari { Saglayici = saglayici, ApiKey = key, Model = model };
            var test = await _ai.GonderAsync(
                ayar,
                "Kısa bağlantı testi yap ve yalnızca OK yaz.",
                "Sadece OK yaz.",
                YapayZekaAmaci.BaglantiTesti);

            if (!test.Basarili)
            {
                return BadRequest(
                    $"{ad} bağlantı testi başarısız. " +
                    test.Hata +
                    (string.IsNullOrWhiteSpace(test.IstekNo)
                        ? ""
                        : " | İstek no: " + test.IstekNo));
            }

            _ai.Kaydet(saglayici, key, model);
            return Ok(_ai.Durum());
        }

        [HttpDelete("settings")]
        public IActionResult DeleteSettings([FromQuery] string? provider)
        {
            var saglayici = SaglayiciOku(provider);
            if (saglayici == null) return BadRequest("Geçersiz yapay zekâ sağlayıcısı.");
            _ai.Sil(saglayici);
            return NoContent();
        }

        [HttpPost("diagnostics")]
        public async Task<IActionResult> Diagnostics(
            [FromBody] AssistantSettingsDto dto)
        {
            var saglayici = SaglayiciOku(dto.Provider);
            if (saglayici == null) return BadRequest("Geçersiz yapay zekâ sağlayıcısı.");

            var key = (dto.ApiKey ?? string.Empty).Trim();
            if (YapayZekaServisi.AnahtarBicimHatasi(saglayici, key) is { } bicimHatasi)
                return BadRequest(bicimHatasi);

            var candidates = new[] { YapayZekaServisi.ModelNormalize(saglayici, dto.Model) }
                .Concat(YapayZekaServisi.Modeller(saglayici))
                .Distinct(StringComparer.Ordinal)
                .ToArray();

            var results = new List<object>();

            foreach (var candidate in candidates)
            {
                var test = await _ai.GonderAsync(
                    new YapayZekaAyari { Saglayici = saglayici, ApiKey = key, Model = candidate },
                    "Bu yalnızca API bağlantı testidir. Yalnızca OK yaz.",
                    "Sadece OK yaz.",
                    YapayZekaAmaci.BaglantiTesti);

                results.Add(new
                {
                    Model = candidate,
                    Success = test.Basarili,
                    Error = test.Hata,
                    RequestId = test.IstekNo
                });

                if (test.Basarili)
                {
                    return Ok(new
                    {
                        Success = true,
                        WorkingModel = candidate,
                        Results = results
                    });
                }
            }

            return BadRequest(new
            {
                Success = false,
                Message = $"Hiçbir {YapayZekaServisi.SaglayiciAdi(saglayici)} modeliyle bağlantı kurulamadı.",
                Results = results
            });
        }

        private static string? SaglayiciOku(string? deger)
        {
            var s = string.IsNullOrWhiteSpace(deger) ? YapayZekaServisi.Claude : deger.Trim().ToLowerInvariant();
            return YapayZekaServisi.GecerliSaglayici(s) ? s : null;
        }

        private static List<AssistantChatHistoryItem> NormalizeHistory(
            List<AssistantChatHistoryItem>? history)
        {
            if (history == null || history.Count == 0)
                return new List<AssistantChatHistoryItem>();

            var normalized = new List<AssistantChatHistoryItem>();

            // En fazla son 24 mesajı tut. Böylece konuşma bağlamı korunurken
            // istek boyutu sınırsız büyümez.
            foreach (var item in history.TakeLast(24))
            {
                var role = (item.Role ?? string.Empty).Trim().ToLowerInvariant();
                if (role is not ("user" or "assistant"))
                    continue;

                var content = (item.Content ?? string.Empty).Trim();
                if (string.IsNullOrWhiteSpace(content))
                    continue;

                if (content.Length > 4000)
                    content = content[..4000];

                normalized.Add(new AssistantChatHistoryItem
                {
                    Role = role,
                    Content = content
                });
            }

            // Toplam geçmişi yaklaşık 24.000 karakter ile sınırla.
            var total = 0;
            var result = new List<AssistantChatHistoryItem>();
            for (var i = normalized.Count - 1; i >= 0; i--)
            {
                var item = normalized[i];
                if (total + item.Content.Length > 24000)
                    break;

                result.Add(item);
                total += item.Content.Length;
            }

            result.Reverse();
            return result;
        }

        // Primer AI ajanı: model gerektiği kadar araç çağırarak yazılımın her yerinden bilgi toplar,
        // veri değiştiren işlemleri yalnız öneri olarak döndürür (kullanıcı onayıyla uygulanır).
        [HttpPost("chat")]
        public async Task<IActionResult> Chat(
            [FromBody] AssistantChatDto dto,
            [FromServices] PrimerAjan ajan)
        {
            var settings = _ai.Aktif();
            if (settings == null)
                return BadRequest("Önce Ayarlar > Primer AI bölümünden DeepSeek, Claude veya OpenAI API anahtarı kaydedin.");

            var message = (dto.Message ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(message)) return BadRequest("Mesaj boş olamaz.");
            if (message.Length > 6000) return BadRequest("Mesaj çok uzun.");

            var gecmis = NormalizeHistory(dto.History).Select(h => (h.Role!, h.Content!)).ToList();
            var sonuc = await ajan.CalistirAsync(settings, message, gecmis, HttpContext.RequestAborted);
            if (!sonuc.Basarili)
                return StatusCode(502, YapayZekaServisi.SaglayiciAdi(settings.Saglayici) + " yanıtı alınamadı: " + sonuc.Hata);

            return Ok(new
            {
                Answer = sonuc.Cevap,
                Actions = sonuc.Islemler,
                Steps = sonuc.Adimlar,
                Tokens = sonuc.Token,
                Provider = YapayZekaServisi.SaglayiciAdi(settings.Saglayici) + " · " + settings.Model
            });
        }
    }

    public class AssistantSettingsDto
    {
        public string? Provider { get; set; }
        public string? ApiKey { get; set; }
        public string? Model { get; set; }
    }

    public class AssistantChatDto
    {
        public string? Message { get; set; }
        public List<AssistantChatHistoryItem>? History { get; set; }
    }

    public class AssistantChatHistoryItem
    {
        public string? Role { get; set; }
        public string? Content { get; set; }
    }

    public class AssistantModelResponse
    {
        public string? Answer { get; set; }
        public List<Dictionary<string, JsonElement>>? Actions { get; set; }
    }

    public class AssistantJobRow
    {
        public int Id { get; set; }
        public string HekimAdi { get; set; } = string.Empty;
        public string? KlinikAdi { get; set; }
        public string HastaAdi { get; set; } = string.Empty;
        public string Durum { get; set; } = string.Empty;
        public string OnayDurumu { get; set; } = string.Empty;
        public string Kaynak { get; set; } = string.Empty;
        public DateTime? TerminTarihi { get; set; }
        public string? DisRengi { get; set; }
        public string? Materyal { get; set; }
        public bool Silindi { get; set; }
        public int? TeknisyenId { get; set; }
        public string? TeknisyenAdi { get; set; }
        public int ToplamAdet { get; set; }
        public decimal ToplamTutar { get; set; }
    }

    public class AssistantTechnicianRow
    {
        public int Id { get; set; }
        public string AdSoyad { get; set; } = string.Empty;
        public bool Aktif { get; set; }
    }

    public class AssistantPaymentRow
    {
        public int Id { get; set; }
        public int HekimId { get; set; }
        public string HekimAdi { get; set; } = string.Empty;
        public decimal Tutar { get; set; }
        public string ParaBirimi { get; set; } = "TRY";
        public DateTime Tarih { get; set; }
        public string? OdemeTuru { get; set; }
        public string? Aciklama { get; set; }
    }

    public class AssistantCariLastPeriod
    {
        public int Id { get; set; }
        public DateTime KapanisTarihi { get; set; }
        public string BakiyelerJson { get; set; } = "{}";
        public bool DevirEklendi { get; set; }
    }

    public class AssistantCariJobRow
    {
        public int Id { get; set; }
        public string ParaBirimi { get; set; } = "TRY";
        public decimal Tutar { get; set; }
        public DateTime TeslimTarihi { get; set; }
    }

    public class AssistantCariPaymentRow
    {
        public int Id { get; set; }
        public int HekimId { get; set; }
        public decimal Tutar { get; set; }
        public string ParaBirimi { get; set; } = "TRY";
        public DateTime Tarih { get; set; }
    }

    public class AssistantCariResult
    {
        public DateTime? DonemBaslangic { get; set; }
        public int IsSayisi { get; set; }
        public Dictionary<string, decimal> Devir { get; set; } = new();
        public Dictionary<string, decimal> Toplamlar { get; set; } = new();
        public Dictionary<string, decimal> Tahsilatlar { get; set; } = new();
        public Dictionary<string, decimal> Bakiyeler { get; set; } = new();
    }

    public class AssistantCariAccountRow
    {
        public int HekimId { get; set; }
        public string HekimAdi { get; set; } = string.Empty;
        public string? KlinikAdi { get; set; }
        public DateTime? DonemBaslangic { get; set; }
        public int TamamlananIsSayisi { get; set; }
        public Dictionary<string, decimal> Devir { get; set; } = new();
        public Dictionary<string, decimal> Toplamlar { get; set; } = new();
        public Dictionary<string, decimal> Tahsilatlar { get; set; } = new();
        public Dictionary<string, decimal> Bakiyeler { get; set; } = new();
    }

    public class AssistantExpenseRow
    {
        public int Id { get; set; }
        public DateTime Tarih { get; set; }
        public string Kategori { get; set; } = string.Empty;
        public string? Aciklama { get; set; }
        public decimal Tutar { get; set; }
    }
}
