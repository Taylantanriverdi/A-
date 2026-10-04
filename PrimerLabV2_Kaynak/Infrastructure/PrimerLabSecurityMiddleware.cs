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

        var portalPort = PortalInternetPort(_configuration);
        if (portalPort > 0 && context.Connection.LocalPort == portalPort)
        {
            await HandleInternetPortal(context);
            return;
        }

        // DNS rebinding koruması: Kötü niyetli bir web sitesi kendi alan adını
        // (ör. saldirgan.com) 127.0.0.1'e çözdürerek laboratuvar bilgisayarındaki
        // tarayıcı üzerinden yönetim API'lerine "yerelden geliyormuş gibi" erişebilir;
        // Origin ve Host aynı olduğu için çapraz site kontrolü de bunu yakalamaz.
        // Bu yüzden yalnız localhost, IP adresi ve bu bilgisayarın adı ile gelen
        // isteklere izin verilir. Ek adresler PrimerLab:AllowedHosts ayarıyla eklenebilir.
        if (!IsAllowedHost(context.Request.Host.Host))
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsync("Geçersiz sunucu adresi.");
            return;
        }

        var remoteAddress = context.Connection.RemoteIpAddress;
        // Hekim Portalı ve Teknisyen Paneli kendi parola/oturum katmanına sahiptir.
        var doctorPortalRequest =
            context.Request.Path.StartsWithSegments("/hekim-portal") ||
            context.Request.Path.StartsWithSegments("/api/hekim-portal") ||
            context.Request.Path.StartsWithSegments("/teknisyen") ||
            context.Request.Path.StartsWithSegments("/api/teknisyen-portal");

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

    /// <summary>
    /// İnternet tünelinin bağlandığı portun numarası (0 = kapalı). Varsayılan 5170.
    /// </summary>
    public static int PortalInternetPort(IConfiguration configuration)
    {
        var value = configuration["PrimerLab:PortalInternetPort"];
        if (string.IsNullOrWhiteSpace(value)) return 5170;
        return int.TryParse(value, out var port) && port is > 0 and < 65536 && port != 5169 ? port : 0;
    }

    // Bu port yalnız 127.0.0.1'de dinlenir ve yalnız tünel yazılımı (cloudflared /
    // tailscale) tarafından kullanılır. Tünelden gelen her istek, gerçek kaynağı ne
    // olursa olsun "internetten" sayılır: yönetim ekranı ve yönetim API'leri hiçbir
    // koşulda açılmaz, yalnız parola korumalı Hekim Portalı sunulur.
    private async Task HandleInternetPortal(HttpContext context)
    {
        // Gerçek istemci adresi (giriş denemesi sınırı ve istek sınırı hekim bazında çalışsın).
        // Adres bilinmiyorsa hiçbir zaman "yerel" sayılmayan bir değer kullanılır.
        context.Connection.RemoteIpAddress = ForwardedClientAddress(context.Request) ?? IPAddress.None;

        // Tünel dış dünyaya yalnız HTTPS ile açılır.
        var proto = context.Request.Headers["X-Forwarded-Proto"].FirstOrDefault();
        if (!string.Equals(proto?.Split(',')[0].Trim(), "http", StringComparison.OrdinalIgnoreCase))
        {
            context.Request.Scheme = "https";
            context.Response.Headers["Strict-Transport-Security"] = "max-age=31536000";
        }

        var path = context.Request.Path;
        if (!path.HasValue || path.Value == "/")
        {
            context.Response.Redirect("/hekim-portal");
            return;
        }

        var allowed =
            path.StartsWithSegments("/hekim-portal") ||
            (path.StartsWithSegments("/api/hekim-portal") && !path.StartsWithSegments("/api/hekim-portal/admin")) ||
            path.StartsWithSegments("/teknisyen") ||
            (path.StartsWithSegments("/api/teknisyen-portal") && !path.StartsWithSegments("/api/teknisyen-portal/admin"));

        if (!allowed)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            await context.Response.WriteAsync("Bulunamadı.");
            return;
        }

        if (IsMutation(context.Request.Method) && IsCrossSiteBrowserRequest(context))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsync("Çapraz site isteği güvenlik nedeniyle engellendi.");
            return;
        }

        if (path.StartsWithSegments("/api"))
        {
            context.Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
            context.Response.Headers.Pragma = "no-cache";
        }

        await _next(context);
    }

    private static IPAddress? ForwardedClientAddress(HttpRequest request)
    {
        foreach (var header in new[] { "CF-Connecting-IP", "X-Forwarded-For" })
        {
            var value = request.Headers[header].FirstOrDefault();
            if (string.IsNullOrWhiteSpace(value)) continue;
            var first = value.Split(',')[0].Trim();
            if (IPAddress.TryParse(first, out var address) && !IsLoopback(address)) return address;
        }
        return null;
    }

    private bool IsAllowedHost(string? host)
    {
        if (string.IsNullOrWhiteSpace(host)) return false;
        host = host.Trim().TrimEnd('.');

        if (string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase)) return true;
        if (IPAddress.TryParse(host.Trim('[', ']'), out _)) return true;

        var machine = Environment.MachineName;
        if (string.Equals(host, machine, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(host, machine + ".local", StringComparison.OrdinalIgnoreCase))
            return true;

        var extra = _configuration["PrimerLab:AllowedHosts"];
        if (!string.IsNullOrWhiteSpace(extra))
        {
            foreach (var item in extra.Split(new[] { ';', ',' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (string.Equals(item, host, StringComparison.OrdinalIgnoreCase)) return true;
            }
        }

        return false;
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
