using System.Net;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using PrimerLabV2.Data;
using PrimerLabV2.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

// Ana yönetim arayüzü güvenlik middleware'i ile yerel kalır.
// Hekim Portalı aynı özel ağdaki cihazlardan erişilebilsin diye Kestrel
// 5169 portunda tüm ağ arayüzlerini dinler.
// İnternetten (her yerden) Hekim Portalı: ayrı bir port yalnız bu bilgisayarın
// içinden (127.0.0.1) dinlenir. Dış dünyaya doğrudan açılmaz; Cloudflare Tunnel /
// Tailscale Funnel gibi şifreli tünel bu porta bağlanır. Güvenlik middleware'i bu
// porttan gelen isteklerde yalnız Hekim Portalı adreslerine izin verir.
var portalInternetPort = PrimerLabSecurityMiddleware.PortalInternetPort(builder.Configuration);
builder.WebHost.ConfigureKestrel(options =>
{
    options.ListenAnyIP(5169);
    if (portalInternetPort > 0)
        options.Listen(IPAddress.Loopback, portalInternetPort);
});

builder.Services.AddProblemDetails();
builder.Services.AddControllers();
builder.Services.AddRazorPages();
builder.Services.AddOpenApi();
builder.Services.AddDataProtection();
builder.Services.AddHttpClient();
builder.Services.AddSingleton<MailIntegrationService>();
builder.Services.AddHostedService<MailIntegrationWorker>();

builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = 520L * 1024L * 1024L;
});

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
    {
        var key = context.Connection.RemoteIpAddress?.ToString() ?? "local";
        return RateLimitPartition.GetFixedWindowLimiter(
            key,
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 600,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 40,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                AutoReplenishment = true
            });
    });
});

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException(
        "DefaultConnection tanımlı değil. Primer Lab PostgreSQL bağlantısı User Secrets içinde bulunmalıdır.");
}

builder.Services.AddDbContext<PrimerLabDbContext>(options =>
    options.UseNpgsql(
        connectionString,
        npgsql => npgsql.EnableRetryOnFailure(
            maxRetryCount: 3,
            maxRetryDelay: TimeSpan.FromSeconds(2),
            errorCodesToAdd: null)));

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseExceptionHandler();
app.UseMiddleware<PrimerLabSecurityMiddleware>();
app.UseRateLimiter();
app.UseMiddleware<MutationAuditMiddleware>();

app.MapControllers();
app.MapRazorPages();

app.Run();
