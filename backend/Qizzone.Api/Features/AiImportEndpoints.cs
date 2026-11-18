using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Buffers.Binary;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using Qizzone.Api.Data;

namespace Qizzone.Api.Features;

public static partial class AiImportEndpoints
{
    private const int MaxPromptCharacters = 100_000;
    private const int MaxImageBytes = 7 * 1024 * 1024;
    private const int MaxRequestBytes = 10 * 1024 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static IEndpointRouteBuilder MapAiImportEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/ai-import-jobs")
            .WithTags("AI import")
            .RequireAuthorization("Teacher");

        group.MapPost("/", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        return endpoints;
    }

    private static async Task<IResult> CreateAsync(
        CreateAiImportJobRequest request,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var uid = principal.FindFirst("firebase:uid")?.Value;
        if (string.IsNullOrWhiteSpace(uid)) return Results.Unauthorized();
        if (string.IsNullOrWhiteSpace(request.Prompt) || request.Prompt.Length > MaxPromptCharacters)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["prompt"] = [$"Prompt must contain 1 to {MaxPromptCharacters} characters."],
            });
        }

        var fileName = SanitizeFileName(request.SourceFileName);
        if (fileName.Length is < 1 or > 255)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["sourceFileName"] = ["A source file name of at most 255 characters is required."],
            });
        }

        var image = TryDecodeImage(request.ImageBase64, out var imageBytes, out var imageMimeType, out var imageError);
        if (!image)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["imageBase64"] = [imageError!],
            });
        }
        var operation = string.IsNullOrWhiteSpace(request.Operation) ? "extract" : request.Operation.Trim().ToLowerInvariant();
        if (operation is not ("extract" or "solve"))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["operation"] = ["Operation must be extract or solve."],
            });
        }

        if (!Guid.TryParse(request.IdempotencyKey, out var idempotencyGuid))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["idempotencyKey"] = ["A valid UUID idempotency key is required."],
            });
        }
        var idempotencyKey = idempotencyGuid.ToString("D");
        var imageContent = imageBytes is null ? null : Convert.ToBase64String(imageBytes);
        var requestFingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            fileName,
            prompt = request.Prompt,
            imageContent,
            imageMimeType,
            operation,
        }, JsonOptions)))).ToLowerInvariant();

        var existingJob = await db.AiImportJobs.AsNoTracking().SingleOrDefaultAsync(
            item => item.OwnerUid == uid && item.IdempotencyKey == idempotencyKey,
            cancellationToken);
        if (existingJob is not null) return ExistingJobResult(existingJob, requestFingerprint);

        var dailyLimit = Math.Clamp(configuration.GetValue("AiImport:DailyRequestLimit", 10), 1, 100);
        var now = DateTimeOffset.UtcNow;
        var requestPayload = JsonSerializer.Serialize(new AiImportPayload(
            request.Prompt,
            imageContent,
            imageMimeType,
            operation), JsonOptions);
        var job = new AiImportJob
        {
            Id = Guid.NewGuid(),
            OwnerUid = uid,
            SourceFileName = fileName,
            IdempotencyKey = idempotencyKey,
            RequestFingerprint = requestFingerprint,
            Status = "queued",
            AttemptCount = 0,
            RequestJson = requestPayload,
            CreatedAt = now,
            UpdatedAt = now,
        };

        IDbContextTransaction? transaction = null;
        if (db.Database.ProviderName?.Contains("InMemory", StringComparison.OrdinalIgnoreCase) != true)
        {
            transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        }

        try
        {
            if (!await TryReserveQuotaAsync(db, uid, dailyLimit, cancellationToken))
            {
                if (transaction is not null) await transaction.CommitAsync(cancellationToken);
                return Results.Problem(
                    title: "AI request limit reached",
                    detail: $"The daily AI import limit is {dailyLimit} jobs per account.",
                    statusCode: StatusCodes.Status429TooManyRequests);
            }

            db.AiImportJobs.Add(job);
            await db.SaveChangesAsync(cancellationToken);
            if (transaction is not null) await transaction.CommitAsync(cancellationToken);
            return AcceptedJobResult(job);
        }
        catch (DbUpdateException)
        {
            if (transaction is not null) await transaction.RollbackAsync(cancellationToken);
            db.ChangeTracker.Clear();
            var concurrentJob = await db.AiImportJobs.AsNoTracking().SingleOrDefaultAsync(
                item => item.OwnerUid == uid && item.IdempotencyKey == idempotencyKey,
                cancellationToken);
            if (concurrentJob is not null) return ExistingJobResult(concurrentJob, requestFingerprint);
            throw;
        }
        finally
        {
            if (transaction is not null) await transaction.DisposeAsync();
        }
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var uid = principal.FindFirst("firebase:uid")?.Value;
        if (string.IsNullOrWhiteSpace(uid)) return Results.Unauthorized();
        var isAdmin = principal.FindFirst("qizzone:role")?.Value == "admin";
        var job = await db.AiImportJobs.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == id && (isAdmin || item.OwnerUid == uid), cancellationToken);
        if (job is null) return Results.NotFound();

        JsonElement? result = null;
        if (job.Status == "succeeded" && !string.IsNullOrWhiteSpace(job.ResultJson))
        {
            using var document = JsonDocument.Parse(job.ResultJson);
            if (document.RootElement.TryGetProperty("result", out var value)) result = value.Clone();
        }

        return Results.Ok(new
        {
            jobId = job.Id,
            job.Status,
            result,
            errorCode = job.ErrorCode,
            job.CreatedAt,
            job.UpdatedAt,
            job.CompletedAt,
        });
    }

    private static async Task<bool> TryReserveQuotaAsync(
        QizzoneDbContext db,
        string uid,
        int dailyLimit,
        CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var resetBefore = now.AddHours(-24);
        if (db.Database.ProviderName?.Contains("InMemory", StringComparison.OrdinalIgnoreCase) == true)
        {
            var rate = await db.AiRateLimits.SingleOrDefaultAsync(item => item.FirebaseUid == uid, cancellationToken);
            if (rate is null)
            {
                db.AiRateLimits.Add(new AiRateLimit { FirebaseUid = uid, WindowStartedAt = now, Requests = 1 });
                await db.SaveChangesAsync(cancellationToken);
                return true;
            }
            if (rate.WindowStartedAt <= resetBefore)
            {
                rate.WindowStartedAt = now;
                rate.Requests = 1;
            }
            else
            {
                rate.Requests = Math.Min(rate.Requests + 1, dailyLimit + 1);
            }
            await db.SaveChangesAsync(cancellationToken);
            return rate.Requests <= dailyLimit;
        }

        var connection = db.Database.GetDbConnection();
        await db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = connection.CreateCommand();
            if (db.Database.CurrentTransaction?.GetDbTransaction() is NpgsqlTransaction transaction)
            {
                command.Transaction = transaction;
            }
            command.CommandText = """
                INSERT INTO ai_rate_limits AS rate (firebase_uid, window_started_at, requests)
                VALUES (@uid, @now, 1)
                ON CONFLICT (firebase_uid) DO UPDATE SET
                    window_started_at = CASE WHEN rate.window_started_at <= @reset_before THEN EXCLUDED.window_started_at ELSE rate.window_started_at END,
                    requests = CASE WHEN rate.window_started_at <= @reset_before THEN 1 ELSE LEAST(rate.requests + 1, @limit + 1) END
                RETURNING requests;
                """;
            command.Parameters.Add(new NpgsqlParameter("uid", uid));
            command.Parameters.Add(new NpgsqlParameter("now", now));
            command.Parameters.Add(new NpgsqlParameter("reset_before", resetBefore));
            command.Parameters.Add(new NpgsqlParameter("limit", dailyLimit));
            var requests = Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));
            return requests <= dailyLimit;
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }

    private static string SanitizeFileName(string? value)
    {
        var normalized = (value ?? "").Trim().Replace('\\', '/');
        var name = normalized[(normalized.LastIndexOf('/') + 1)..];
        return new string(name.Where(character => !char.IsControl(character)).Take(255).ToArray());
    }

    private static IResult ExistingJobResult(AiImportJob job, string fingerprint) =>
        string.Equals(job.RequestFingerprint, fingerprint, StringComparison.Ordinal)
            ? AcceptedJobResult(job)
            : Results.Conflict(new { error = "The idempotency key was already used with a different request." });

    private static IResult AcceptedJobResult(AiImportJob job) => Results.Accepted($"/api/v1/ai-import-jobs/{job.Id}", new
    {
        jobId = job.Id,
        job.Status,
        job.CreatedAt,
    });

    private static bool TryDecodeImage(
        string? encoded,
        out byte[]? bytes,
        out string? mimeType,
        out string? error)
    {
        bytes = null;
        mimeType = null;
        error = null;
        if (string.IsNullOrWhiteSpace(encoded)) return true;

        var base64 = encoded;
        if (encoded.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            var separator = encoded.IndexOf(',');
            if (separator < 0 || !DataUriRegex().IsMatch(encoded[..separator]))
            {
                error = "Only base64 PNG, JPEG, and WebP image data is accepted.";
                return false;
            }
            mimeType = encoded[5..encoded.IndexOf(';')].ToLowerInvariant();
            base64 = encoded[(separator + 1)..];
        }

        if (base64.Length > ((MaxImageBytes + 2) / 3 * 4) + 4)
        {
            error = "Images must be 7 MiB or smaller.";
            return false;
        }
        try
        {
            bytes = Convert.FromBase64String(base64);
        }
        catch (FormatException)
        {
            error = "Image data must be valid base64.";
            return false;
        }

        if (bytes.Length is 0 or > MaxImageBytes)
        {
            error = "Images must be non-empty and 7 MiB or smaller.";
            return false;
        }
        var detectedMimeType = DetectImageMimeType(bytes);
        if (detectedMimeType is null || (mimeType is not null && mimeType != detectedMimeType))
        {
            error = "Image data does not match a supported PNG, JPEG, or WebP signature.";
            return false;
        }
        mimeType = detectedMimeType;
        return true;
    }

    private static string? DetectImageMimeType(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length >= 33 && bytes[..8].SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) &&
            bytes.Slice(8, 4).SequenceEqual(new byte[] { 0, 0, 0, 13 }) && bytes.Slice(12, 4).SequenceEqual("IHDR"u8) &&
            bytes[^12..^8].SequenceEqual(new byte[] { 0, 0, 0, 0 }) && bytes[^8..^4].SequenceEqual("IEND"u8)) return "image/png";
        if (bytes.Length >= 4 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF &&
            bytes[^2] == 0xFF && bytes[^1] == 0xD9) return "image/jpeg";
        if (bytes.Length >= 20 && bytes[..4].SequenceEqual("RIFF"u8) && bytes.Slice(8, 4).SequenceEqual("WEBP"u8) &&
            BinaryPrimitives.ReadUInt32LittleEndian(bytes[4..8]) + 8 == bytes.Length &&
            (bytes.Slice(12, 4).SequenceEqual("VP8 "u8) || bytes.Slice(12, 4).SequenceEqual("VP8L"u8) || bytes.Slice(12, 4).SequenceEqual("VP8X"u8))) return "image/webp";
        return null;
    }

    [GeneratedRegex("^data:image/(?:png|jpeg|webp);base64$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex DataUriRegex();
}

public sealed record CreateAiImportJobRequest(string SourceFileName, string Prompt, string IdempotencyKey, string? ImageBase64 = null, string? Operation = null);
public sealed record AiImportPayload(string Prompt, string? ImageBase64, string? ImageMimeType, string Operation = "extract");
