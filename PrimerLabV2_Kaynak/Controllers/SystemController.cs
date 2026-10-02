using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;
using PrimerLabV2.Infrastructure;

namespace PrimerLabV2.Controllers;

[ApiController]
[Route("api/system")]
public class SystemController : ControllerBase
{
    private readonly PrimerLabDbContext _db;
    private readonly IWebHostEnvironment _environment;

    public SystemController(
        PrimerLabDbContext db,
        IWebHostEnvironment environment)
    {
        _db = db;
        _environment = environment;
    }

    [HttpGet("health")]
    public async Task<IActionResult> Health()
    {
        var dbOk = await _db.Database.CanConnectAsync();
        var hekim = dbOk ? await _db.Hekimler.AsNoTracking().CountAsync() : 0;
        var hasta = dbOk ? await _db.Hastalar.AsNoTracking().CountAsync() : 0;
        var siparis = dbOk ? await _db.Siparisler.AsNoTracking().CountAsync() : 0;

        var root = Path.GetPathRoot(_environment.ContentRootPath) ?? _environment.ContentRootPath;
        long? freeBytes = null;
        try
        {
            freeBytes = new DriveInfo(root).AvailableFreeSpace;
        }
        catch
        {
        }

        return Ok(new
        {
            Product = PrimerLabInfo.ProductName,
            Version = PrimerLabInfo.Version,
            UtcNow = DateTime.UtcNow,
            Database = new
            {
                Connected = dbOk,
                HekimSayisi = hekim,
                IsKaydiSayisi = siparis,
                DahiliHastaKaydiSayisi = hasta
            },
            Storage = new
            {
                ContentRoot = _environment.ContentRootPath,
                AvailableFreeBytes = freeBytes
            }
        });
    }

    [HttpGet("audit")]
    public async Task<IActionResult> Audit([FromQuery] int limit = 100)
    {
        limit = Math.Clamp(limit, 1, 500);

        var rows = await _db.Database
            .SqlQuery<SystemAuditRow>($"""
                SELECT
                    "Id",
                    "Tarih",
                    "Metot",
                    "Yol",
                    "DurumKodu",
                    "SureMs",
                    "RequestId"
                FROM "SistemIslemGunlugu"
                ORDER BY "Id" DESC
                LIMIT {limit}
                """)
            .ToListAsync();

        return Ok(rows);
    }
}

public sealed class SystemAuditRow
{
    public long Id { get; set; }
    public DateTime Tarih { get; set; }
    public string Metot { get; set; } = string.Empty;
    public string Yol { get; set; } = string.Empty;
    public int DurumKodu { get; set; }
    public int SureMs { get; set; }
    public string RequestId { get; set; } = string.Empty;
}
