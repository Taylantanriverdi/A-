using System.Data.Common;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PrimerLabV2.Data;

namespace PrimerLabV2.Controllers;

[ApiController]
[Route("api/backup")]
public sealed class BackupController : ControllerBase
{
    private readonly PrimerLabDbContext _db;
    private readonly IWebHostEnvironment _env;

    private static readonly string[] PreferredInsertOrder =
    {
        "Hekimler",
        "HekimPortalHesaplari",
        "Teknisyenler",
        "Hastalar",
        "HekimFiyatlari",
        "Siparisler",
        "SiparisKalemleri",
        "SiparisDurumGecmisi",
        "Tahsilatlar",
        "CariDonemleri",
        "IsDosyalari",
        "IsMesajlari",
        "Giderler",
        "MailGelenler",
        "LegacyImportBilgisi",
        "LegacyArsivKayitlari",
        "LegacyImportMap",
        "SistemIslemGunlugu"
    };

    public BackupController(PrimerLabDbContext db, IWebHostEnvironment env)
    {
        _db = db;
        _env = env;
    }

    [HttpGet("status")]
    public async Task<IActionResult> Status()
    {
        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        var shouldClose = connection.State != System.Data.ConnectionState.Open;

        if (shouldClose)
            await connection.OpenAsync();

        try
        {
            var tables = await GetPublicTables(connection, null);
            var counts = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);

            foreach (var table in tables)
            {
                await using var cmd = connection.CreateCommand();
                cmd.CommandText = $"SELECT COUNT(*) FROM {Q(table)};";
                counts[table] = Convert.ToInt64(await cmd.ExecuteScalarAsync() ?? 0L);
            }

            return Ok(new
            {
                format = "PrimerLabFullBackup",
                schemaVersion = 2,
                tableCount = tables.Count,
                counts
            });
        }
        finally
        {
            if (shouldClose && connection.State == System.Data.ConnectionState.Open)
                await connection.CloseAsync();
        }
    }

    [HttpGet("export")]
    public async Task<IActionResult> Export()
    {
        var root = await BuildBackupDocument();

        var json = root.ToJsonString(new JsonSerializerOptions
        {
            WriteIndented = true
        });

        var name = $"PrimerLab_Backup_{DateTime.Now:yyyy-MM-dd_HH-mm-ss}.json";
        return File(Encoding.UTF8.GetBytes(json), "application/json", name);
    }

    [HttpPost("restore")]
    [RequestSizeLimit(250_000_000)]
    public async Task<IActionResult> Restore(IFormFile file, [FromForm] string confirm)
    {
        if (!string.Equals(confirm?.Trim(), "RESTORE", StringComparison.Ordinal))
            return BadRequest("Geri yükleme için RESTORE onayı gereklidir.");

        if (file == null || file.Length == 0)
            return BadRequest("Yedek dosyası seçilmelidir.");

        if (file.Length > 250_000_000)
            return BadRequest("Yedek dosyası 250 MB sınırını aşıyor.");

        JsonObject root;
        await using (var stream = file.OpenReadStream())
        {
            var node = await JsonNode.ParseAsync(stream);
            root = node as JsonObject
                ?? throw new InvalidOperationException("Geçerli JSON yedek dosyası değil.");
        }

        var format = root["format"]?.GetValue<string>();
        if (!string.Equals(format, "PrimerLabFullBackup", StringComparison.Ordinal))
            return BadRequest("Bu dosya yeni Primer Lab tam yedek formatında değil. Eski JSON için 'Eski Yedeği İçe Aktar' seçeneğini kullan.");

        if (root["tables"] is not JsonObject backupTables)
            return BadRequest("Yedek içinde tables bölümü bulunamadı.");

        var safetyPath = await SaveSafetyBackup();

        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        var shouldClose = connection.State != System.Data.ConnectionState.Open;
        if (shouldClose)
            await connection.OpenAsync();

        await using var tx = await connection.BeginTransactionAsync();

        try
        {
            var currentTables = await GetPublicTables(connection, tx);
            var restoreTables = backupTables
                .Select(x => x.Key)
                .Where(currentTables.Contains)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            if (restoreTables.Count == 0)
                return BadRequest("Geri yüklenecek uyumlu tablo bulunamadı.");

            var order = BuildOrder(restoreTables);

            // Child tables first.
            foreach (var table in order.AsEnumerable().Reverse())
            {
                await using var delete = connection.CreateCommand();
                delete.Transaction = tx;
                delete.CommandText = $"DELETE FROM {Q(table)};";
                await delete.ExecuteNonQueryAsync();
            }

            foreach (var table in order)
            {
                if (backupTables[table] is not JsonArray rows || rows.Count == 0)
                    continue;

                var payload = rows.ToJsonString();

                await using var insert = connection.CreateCommand();
                insert.Transaction = tx;
                insert.CommandText =
                    $"INSERT INTO {Q(table)} SELECT * FROM jsonb_populate_recordset(NULL::{Q(table)}, @json::jsonb);";
                insert.Parameters.AddWithValue("json", payload);
                await insert.ExecuteNonQueryAsync();
            }

            await ResetSequences(connection, tx, restoreTables);
            await tx.CommitAsync();

            return Ok(new
            {
                message = "Tam yedek başarıyla geri yüklendi.",
                restoredTables = order,
                safetyBackup = Path.GetFileName(safetyPath)
            });
        }
        catch
        {
            await tx.RollbackAsync();
            throw;
        }
        finally
        {
            if (shouldClose && connection.State == System.Data.ConnectionState.Open)
                await connection.CloseAsync();
        }
    }

    [HttpPost("factory-reset")]
    public async Task<IActionResult> FactoryReset([FromBody] FactoryResetRequest request)
    {
        if (!string.Equals(request?.Confirm?.Trim(), "SIFIRLA", StringComparison.Ordinal))
            return BadRequest("Tam sıfırlama için SIFIRLA onayı gereklidir.");

        // Önce geri dönüş noktası oluştur. Yedek başarısızsa hiçbir veri silinmez.
        var safetyPath = await SaveSafetyBackup();
        var fileSafetyFolder = BackupOperationalFiles();

        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        var shouldClose = connection.State != System.Data.ConnectionState.Open;
        if (shouldClose) await connection.OpenAsync();

        await using var tx = await connection.BeginTransactionAsync();
        try
        {
            // Çocuk tablolardan ebeveyn tablolara doğru sil. Merkezi iş kataloğu
            // HekimFiyatlari içinde HekimId=0 satırlarıdır ve özellikle korunur.
            var ordered = BuildOrder((await GetPublicTables(connection, tx))
                .ToHashSet(StringComparer.OrdinalIgnoreCase));

            var protectedTables = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "__EFMigrationsHistory"
            };

            var cleared = new List<string>();
            foreach (var table in ordered.AsEnumerable().Reverse())
            {
                if (protectedTables.Contains(table)) continue;

                await using var cmd = connection.CreateCommand();
                cmd.Transaction = tx;
                if (table.Equals("HekimFiyatlari", StringComparison.OrdinalIgnoreCase))
                    cmd.CommandText = $"DELETE FROM {Q(table)} WHERE \"HekimId\" <> 0;";
                else
                    cmd.CommandText = $"DELETE FROM {Q(table)};";

                await cmd.ExecuteNonQueryAsync();
                cleared.Add(table);
            }

            await tx.CommitAsync();

            // Veritabanı başarıyla boşaldıktan sonra operasyonel dosyaları temizle.
            ClearOperationalFiles();

            return Ok(new
            {
                message = "Primer Lab kullanıcı verileri tamamen sıfırlandı.",
                safetyBackup = Path.GetFileName(safetyPath),
                fileSafetyFolder = fileSafetyFolder == null ? null : Path.GetFileName(fileSafetyFolder),
                clearedTables = cleared.Count
            });
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync();
            var detail = ex.GetBaseException().Message;
            if (detail.Length > 1200) detail = detail[..1200];
            return BadRequest("Sıfırlama iptal edildi; hiçbir veritabanı değişikliği uygulanmadı. Hata: " + detail);
        }
        finally
        {
            if (shouldClose && connection.State == System.Data.ConnectionState.Open)
                await connection.CloseAsync();
        }
    }

    private string? BackupOperationalFiles()
    {
        var sources = new[] { "IsDosyalari", "Uploads" };
        var existing = sources.Select(x => Path.Combine(_env.ContentRootPath, "App_Data", x))
            .Where(Directory.Exists).ToList();
        if (existing.Count == 0) return null;

        var root = Path.Combine(_env.ContentRootPath, "App_Data", "Backups",
            $"AUTO_BEFORE_FACTORY_RESET_FILES_{DateTime.Now:yyyy-MM-dd_HH-mm-ss}");
        Directory.CreateDirectory(root);
        foreach (var src in existing)
            CopyDirectory(src, Path.Combine(root, Path.GetFileName(src)));
        return root;
    }

    private void ClearOperationalFiles()
    {
        foreach (var name in new[] { "IsDosyalari", "Uploads" })
        {
            var dir = Path.Combine(_env.ContentRootPath, "App_Data", name);
            if (!Directory.Exists(dir)) continue;
            foreach (var file in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
                try { System.IO.File.Delete(file); } catch { }
            foreach (var sub in Directory.EnumerateDirectories(dir).OrderByDescending(x => x.Length))
                try { Directory.Delete(sub, true); } catch { }
        }
    }

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (var file in Directory.GetFiles(source))
            System.IO.File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), true);
        foreach (var dir in Directory.GetDirectories(source))
            CopyDirectory(dir, Path.Combine(destination, Path.GetFileName(dir)));
    }

    public sealed class FactoryResetRequest
    {
        public string? Confirm { get; set; }
    }

    [HttpPost("legacy-import")]
    [RequestSizeLimit(100_000_000)]
    public async Task<IActionResult> LegacyImport(IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest("Eski JSON yedek dosyası seçilmelidir.");

        var imports = Path.Combine(_env.ContentRootPath, "App_Data", "Imports");
        Directory.CreateDirectory(imports);

        var temp = Path.Combine(imports, $"legacy_upload_{Guid.NewGuid():N}.json");
        await using (var output = System.IO.File.Create(temp))
            await file.CopyToAsync(output);

        try
        {
            try
            {
                var result = await RunLegacyImporter(temp, file.FileName);
                return Ok(result);
            }
            catch (PostgresException ex)
            {
                return BadRequest($"Eski yedek veritabanına aktarılamadı: {ex.MessageText}");
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                // Legacy importer errors must be visible to the operator instead of a generic HTTP 500.
                var detail = ex.GetBaseException().Message;
                if (detail.Length > 1200) detail = detail[..1200];
                return BadRequest($"Eski yedek aktarım hatası: {detail}");
            }
        }
        finally
        {
            try { System.IO.File.Delete(temp); } catch { }
        }
    }

    [HttpPost("legacy-seed")]
    public async Task<IActionResult> LegacySeed()
    {
        var path = Path.Combine(_env.ContentRootPath, "App_Data", "Imports", "legacy_seed_2026_09_14.json");
        if (!System.IO.File.Exists(path))
            return NotFound("Paket içindeki eski yedek bulunamadı.");

        var result = await RunLegacyImporter(path, "legacy_seed_2026_09_14.json");
        return Ok(result);
    }

    private async Task<object> RunLegacyImporter(string jsonPath, string displayName)
    {
        var importer = Path.Combine(_env.ContentRootPath, "Tools", "legacy_import.py");
        if (!System.IO.File.Exists(importer))
            throw new InvalidOperationException("Legacy import aracı bulunamadı.");

        // The helper emits SQL only. psql runs locally against the same database.
        var sqlDir = Path.Combine(_env.ContentRootPath, "App_Data", "Imports");
        Directory.CreateDirectory(sqlDir);
        var sqlPath = Path.Combine(sqlDir, $"legacy_{DateTime.UtcNow:yyyyMMddHHmmss}_{Guid.NewGuid():N}.sql");

        var psi = new System.Diagnostics.ProcessStartInfo
        {
            FileName = FindPython(),
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        var pythonName = Path.GetFileName(psi.FileName);
        if (pythonName.Equals("py.exe", StringComparison.OrdinalIgnoreCase) ||
            pythonName.Equals("py", StringComparison.OrdinalIgnoreCase))
            psi.ArgumentList.Add("-3");

        psi.ArgumentList.Add(importer);
        psi.ArgumentList.Add(jsonPath);
        psi.ArgumentList.Add(sqlPath);
        psi.ArgumentList.Add(displayName);

        using var process = System.Diagnostics.Process.Start(psi)
            ?? throw new InvalidOperationException("Legacy import dönüştürücü başlatılamadı.");

        var stdout = await process.StandardOutput.ReadToEndAsync();
        var stderr = await process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();

        if (process.ExitCode != 0)
            throw new InvalidOperationException("Eski yedek dönüştürülemedi: " + (stderr.Length > 800 ? stderr[..800] : stderr));

        // IMPORTANT: Do NOT pass the generated SQL through EF Core ExecuteSqlRaw.
        // Legacy archive JSON contains literal { and } characters. EF's raw-SQL overload
        // treats those as composite-format placeholders and throws:
        // "Input string was not in a correct format ... Expected an ASCII digit."
        // Execute the already-quoted SQL directly through the provider DbCommand instead.
        var sql = await System.IO.File.ReadAllTextAsync(sqlPath, Encoding.UTF8);
        var connection = _db.Database.GetDbConnection();
        var shouldClose = connection.State != System.Data.ConnectionState.Open;
        try
        {
            if (shouldClose)
                await connection.OpenAsync();

            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            command.CommandTimeout = 0;
            await command.ExecuteNonQueryAsync();
        }
        finally
        {
            if (shouldClose && connection.State == System.Data.ConnectionState.Open)
                await connection.CloseAsync();
            try { System.IO.File.Delete(sqlPath); } catch { }
        }

        return new
        {
            message = "Eski JSON yedeği mevcut veriler silinmeden içeri aktarıldı.",
            detail = stdout.Trim()
        };
    }

    private string FindPython()
    {
        var configured = Environment.GetEnvironmentVariable("PRIMERLAB_PYTHON");
        if (!string.IsNullOrWhiteSpace(configured))
            return configured;

        var py = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs", "Python", "Python311", "python.exe");

        if (System.IO.File.Exists(py))
            return py;

        return "py";
    }

    private async Task<JsonObject> BuildBackupDocument()
    {
        var root = new JsonObject
        {
            ["format"] = "PrimerLabFullBackup",
            ["schemaVersion"] = 2,
            ["createdAt"] = DateTime.UtcNow.ToString("O"),
            ["appVersion"] = PrimerLabV2.Infrastructure.PrimerLabInfo.Version,
            ["tables"] = new JsonObject()
        };

        var tablesObject = (JsonObject)root["tables"]!;

        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        var shouldClose = connection.State != System.Data.ConnectionState.Open;

        if (shouldClose)
            await connection.OpenAsync();

        try
        {
            foreach (var table in await GetPublicTables(connection, null))
            {
                await using var cmd = connection.CreateCommand();
                cmd.CommandText =
                    $"SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text FROM {Q(table)} t;";

                var text = (await cmd.ExecuteScalarAsync())?.ToString() ?? "[]";
                var node = JsonNode.Parse(text) ?? new JsonArray();

                RedactNode(node);
                tablesObject[table] = node;
            }
        }
        finally
        {
            if (shouldClose && connection.State == System.Data.ConnectionState.Open)
                await connection.CloseAsync();
        }

        return root;
    }

    private async Task<string> SaveSafetyBackup()
    {
        var root = await BuildBackupDocument();
        var folder = Path.Combine(_env.ContentRootPath, "App_Data", "Backups");
        Directory.CreateDirectory(folder);

        var path = Path.Combine(folder, $"AUTO_BEFORE_RESTORE_{DateTime.Now:yyyy-MM-dd_HH-mm-ss}.json");
        await System.IO.File.WriteAllTextAsync(
            path,
            root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }),
            new UTF8Encoding(false));

        return path;
    }

    private async Task<List<string>> GetPublicTables()
    {
        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        var shouldClose = connection.State != System.Data.ConnectionState.Open;

        if (shouldClose)
            await connection.OpenAsync();

        try
        {
            return await GetPublicTables(connection, null);
        }
        finally
        {
            if (shouldClose && connection.State == System.Data.ConnectionState.Open)
                await connection.CloseAsync();
        }
    }

    private static async Task<List<string>> GetPublicTables(NpgsqlConnection connection, DbTransaction? tx)
    {
        await using var cmd = connection.CreateCommand();
        cmd.Transaction = (NpgsqlTransaction?)tx;
        cmd.CommandText = """
            SELECT tablename
            FROM pg_tables
            WHERE schemaname='public'
              AND tablename <> '__EFMigrationsHistory'
            ORDER BY tablename;
            """;

        var list = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            list.Add(reader.GetString(0));

        return list;
    }

    private static List<string> BuildOrder(HashSet<string> tables)
    {
        var order = PreferredInsertOrder
            .Where(tables.Contains)
            .ToList();

        foreach (var table in tables.OrderBy(x => x))
        {
            if (!order.Contains(table, StringComparer.OrdinalIgnoreCase))
                order.Add(table);
        }

        return order;
    }

    private static async Task ResetSequences(
        NpgsqlConnection connection,
        NpgsqlTransaction tx,
        HashSet<string> tables)
    {
        foreach (var table in tables)
        {
            await using var seq = connection.CreateCommand();
            seq.Transaction = tx;
            seq.CommandText = """
                SELECT a.attname,
                       pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname)
                FROM pg_class c
                JOIN pg_namespace n ON n.oid=c.relnamespace
                JOIN pg_attribute a ON a.attrelid=c.oid
                WHERE n.nspname='public'
                  AND c.relname=@table
                  AND a.attnum>0
                  AND NOT a.attisdropped
                  AND pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) IS NOT NULL;
                """;
            seq.Parameters.AddWithValue("table", table);

            var sequences = new List<(string Column, string Sequence)>();
            await using (var reader = await seq.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                    sequences.Add((reader.GetString(0), reader.GetString(1)));
            }

            foreach (var item in sequences)
            {
                await using var reset = connection.CreateCommand();
                reset.Transaction = tx;
                reset.CommandText =
                    $"SELECT setval(@seq::regclass, COALESCE((SELECT MAX({Q(item.Column)}) FROM {Q(table)}), 1), " +
                    $"EXISTS(SELECT 1 FROM {Q(table)}));";
                reset.Parameters.AddWithValue("seq", item.Sequence);
                await reset.ExecuteNonQueryAsync();
            }
        }
    }

    private static string Q(string identifier) =>
        "\"" + identifier.Replace("\"", "\"\"") + "\"";

    private static void RedactNode(JsonNode? node)
    {
        if (node is JsonObject obj)
        {
            foreach (var key in obj.Select(x => x.Key).ToArray())
            {
                if (key.Equals("password", StringComparison.OrdinalIgnoreCase) ||
                    key.Equals("pass", StringComparison.OrdinalIgnoreCase) ||
                    key.Equals("apiKey", StringComparison.OrdinalIgnoreCase) ||
                    key.Contains("secret", StringComparison.OrdinalIgnoreCase) ||
                    key.Contains("token", StringComparison.OrdinalIgnoreCase))
                {
                    obj[key] = "[REDACTED]";
                    continue;
                }

                RedactNode(obj[key]);
            }
        }
        else if (node is JsonArray array)
        {
            foreach (var item in array)
                RedactNode(item);
        }
    }
}
