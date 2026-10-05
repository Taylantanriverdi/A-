using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;
using PrimerLabV2.Infrastructure;

namespace PrimerLabV2.Controllers;

/// <summary>İşe bağlı dosya linkleri (laboratuvar: görür, ekler, siler).</summary>
[ApiController]
[Route("api/is-linkleri")]
public sealed class IsLinkleriController : ControllerBase
{
    private readonly IsLinkleri _linkler;
    private readonly PrimerLabDbContext _db;

    public IsLinkleriController(IsLinkleri linkler, PrimerLabDbContext db)
    {
        _linkler = linkler;
        _db = db;
    }

    [HttpGet("{siparisId:int}")]
    public IActionResult Liste(int siparisId) => Ok(_linkler.Liste(siparisId).Select(IsLinkleri.Gorunum));

    [HttpPost("{siparisId:int}")]
    public async Task<IActionResult> Ekle(int siparisId, [FromBody] IsLinkEkleDto dto, CancellationToken ct)
    {
        var sayi = await _db.Database.SqlQuery<int>($"""SELECT COUNT(*)::int AS "Value" FROM "Siparisler" WHERE "Id"={siparisId}""").SingleAsync(ct);
        if (sayi == 0) return NotFound("İş bulunamadı.");
        var liste = (dto.Linkler ?? new()).Where(x => !string.IsNullOrWhiteSpace(x)).ToList();
        if (liste.Count == 0) return BadRequest("Link girin.");
        var hata = _linkler.Ekle(siparisId, liste, dto.Aciklama, "Laboratuvar", null);
        return hata == null ? Ok(_linkler.Liste(siparisId).Select(IsLinkleri.Gorunum)) : BadRequest(hata);
    }

    [HttpDelete("{siparisId:int}/{linkId:int}")]
    public IActionResult Sil(int siparisId, int linkId) =>
        _linkler.Sil(siparisId, linkId) ? Ok() : NotFound("Link bulunamadı.");
}
