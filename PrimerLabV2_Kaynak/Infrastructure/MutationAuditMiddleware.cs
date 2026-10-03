using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;

namespace PrimerLabV2.Infrastructure;

public sealed class MutationAuditMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<MutationAuditMiddleware> _logger;

    public MutationAuditMiddleware(
        RequestDelegate next,
        ILogger<MutationAuditMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context, PrimerLabDbContext db)
    {
        var mutation =
            HttpMethods.IsPost(context.Request.Method) ||
            HttpMethods.IsPut(context.Request.Method) ||
            HttpMethods.IsPatch(context.Request.Method) ||
            HttpMethods.IsDelete(context.Request.Method);

        if (!mutation)
        {
            await _next(context);
            return;
        }

        var sw = Stopwatch.StartNew();
        Exception? captured = null;

        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            captured = ex;
            throw;
        }
        finally
        {
            sw.Stop();
            try
            {
                var method = context.Request.Method;
                var path = context.Request.Path.Value ?? "/";
                var status = captured == null
                    ? context.Response.StatusCode
                    : StatusCodes.Status500InternalServerError;
                var requestId = context.TraceIdentifier;
                var elapsed = Math.Min(sw.ElapsedMilliseconds, int.MaxValue);

                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO "SistemIslemGunlugu"
                    ("Tarih","Metot","Yol","DurumKodu","SureMs","RequestId")
                    VALUES
                    ({DateTime.UtcNow},{method},{path},{status},{(int)elapsed},{requestId})
                    """);
            }
            catch (Exception auditError)
            {
                _logger.LogWarning(
                    auditError,
                    "Mutasyon audit kaydı yazılamadı. Uygulama işlemi etkilenmedi.");
            }
        }
    }
}
