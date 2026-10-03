namespace PrimerLabV2.Infrastructure;

public sealed class MailIntegrationWorker : BackgroundService
{
    private readonly MailIntegrationService _service;
    private readonly ILogger<MailIntegrationWorker> _logger;

    public MailIntegrationWorker(
        MailIntegrationService service,
        ILogger<MailIntegrationWorker> logger)
    {
        _service = service;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            var settings = _service.GetSettings();
            var delay = TimeSpan.FromMinutes(Math.Clamp(settings.IntervalMinutes, 5, 1440));
            var now = DateTime.Now;

            _service.SetNextRun(settings.AutoEnabled ? now.Add(delay) : null);

            if (settings.AutoEnabled && _service.IsWithinAutomaticWindow(settings, now))
            {
                try
                {
                    var result = await _service.RunAsync(false, stoppingToken);
                    if (!result.Success)
                        _logger.LogWarning("Mail otomatik kontrol: {Message}", result.Message);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Mail otomatik kontrol hatası.");
                }
            }

            await Task.Delay(delay, stoppingToken);
        }
    }
}
