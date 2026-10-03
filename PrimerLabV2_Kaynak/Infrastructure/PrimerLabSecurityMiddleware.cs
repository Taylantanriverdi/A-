using System.Net;

namespace PrimerLabV2.Infrastructure;

public sealed class PrimerLabSecurityMiddleware
{
    private readonly RequestDelegate _next;
    private readonly IConfiguration _configuration;

    public PrimerLabSecurityMiddleware(
        RequestDelegate next,
        IConfiguration configuration)
    {
        _next = next;
        _configuration = configuration;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        ApplySecurityHeaders(context.Response);

        var remoteAddress = context.Connection.RemoteIpAddress;
        var doctorPortalRequest =
            context.Request.Path.StartsWithSegments("/hekim-portal") ||
            context.Request.Path.StartsWithSegments("/api/hekim-portal");

        if (!IsRemoteAccessAllowed() && !IsLoopback(remoteAddress))
        {
            // Ana yönetim yazılımı uzak cihazlara kapalı kalır.
            // Hekim Portalı ise güvenli oturum/parola katmanına sahip olduğu için
            // aynı özel ağdaki klinik cihazlarından erişilebilir.
            if (!(doctorPortalRequest && IsPrivateNetwork(remoteAddress)))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsync(
                    "Primer Lab yönetim ekranı bu cihazdan erişime kapalıdır.");
                return;
            }
        }

        if (IsMutation(context.Request.Method) && IsCrossSiteBrowserRequest(context))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsync("Çapraz site isteği güvenlik nedeniyle engellendi.");
            return;
        }

        if (context.Request.Path.StartsWithSegments("/api"))
        {
            context.Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
            context.Response.Headers.Pragma = "no-cache";
        }

        if (!context.Request.Headers.ContainsKey("X-Request-ID"))
        {
            context.Response.Headers["X-Request-ID"] = context.TraceIdentifier;
        }

        await _next(context);
    }

    private bool IsRemoteAccessAllowed() =>
        _configuration.GetValue<bool>("PrimerLab:AllowRemote");

    private static bool IsPrivateNetwork(IPAddress? address)
    {
        if (address == null) return false;
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();

        if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
        {
            var b = address.GetAddressBytes();
            if (b[0] == 10) return true;
            if (b[0] == 172 && b[1] >= 16 && b[1] <= 31) return true;
            if (b[0] == 192 && b[1] == 168) return true;
            if (b[0] == 169 && b[1] == 254) return true;
        }

        if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6)
            return address.IsIPv6LinkLocal || address.ToString().StartsWith("fc", StringComparison.OrdinalIgnoreCase) || address.ToString().StartsWith("fd", StringComparison.OrdinalIgnoreCase);

        return false;
    }

    private static bool IsLoopback(IPAddress? address)
    {
        if (address == null) return true;
        if (IPAddress.IsLoopback(address)) return true;
        return address.IsIPv4MappedToIPv6 && IPAddress.IsLoopback(address.MapToIPv4());
    }

    private static bool IsMutation(string method) =>
        HttpMethods.IsPost(method) ||
        HttpMethods.IsPut(method) ||
        HttpMethods.IsPatch(method) ||
        HttpMethods.IsDelete(method);

    private static bool IsCrossSiteBrowserRequest(HttpContext context)
    {
        var origin = context.Request.Headers.Origin.FirstOrDefault();
        if (string.IsNullOrWhiteSpace(origin)) return false;

        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri)) return true;

        var requestHost = context.Request.Host.Host;
        if (!string.Equals(uri.Host, requestHost, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var requestPort = context.Request.Host.Port;
        var originPort = uri.IsDefaultPort ? (int?)null : uri.Port;
        return requestPort != originPort;
    }

    private static void ApplySecurityHeaders(HttpResponse response)
    {
        response.Headers["X-Content-Type-Options"] = "nosniff";
        response.Headers["X-Frame-Options"] = "DENY";
        response.Headers["Referrer-Policy"] = "no-referrer";
        response.Headers["Permissions-Policy"] =
            "camera=(), microphone=(), geolocation=(), payment=(), usb=()";
        response.Headers["Cross-Origin-Opener-Policy"] = "same-origin";
        response.Headers["Cross-Origin-Resource-Policy"] = "same-origin";
    }
}
