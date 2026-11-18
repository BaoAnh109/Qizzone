using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Qizzone.Api.Data;

namespace Qizzone.Api.Features;

public static class MediaEndpoints
{
    public const string ReferencePrefix = "media://qizzone/";
    private const int MaximumObjectBytes = 2 * 1024 * 1024;
    private const long MaximumOwnerBytes = 250L * 1024 * 1024;

    public static IEndpointRouteBuilder MapMediaEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/media")
            .WithTags("Media");

        group.MapPost("/", UploadAsync)
            .RequireAuthorization("ActiveUser")
            .DisableAntiforgery();
        group.MapGet("/{id:guid}", GetAsync).AllowAnonymous();
        return endpoints;
    }

    public static string ToReference(Guid id) => $"{ReferencePrefix}{id:N}";

    public static bool TryParseReference(string? value, out Guid id)
    {
        id = Guid.Empty;
        return value is not null && value.StartsWith(ReferencePrefix, StringComparison.Ordinal) &&
            Guid.TryParseExact(value[ReferencePrefix.Length..], "N", out id);
    }

    private static async Task<IResult> UploadAsync(
        IFormFile? file,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        LocalMediaStore mediaStore,
        CancellationToken cancellationToken)
    {
        if (file is null || file.Length <= 0)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["file"] = ["Choose a non-empty JPEG, PNG, or WebP image."],
            });
        }

        if (file.Length > MaximumObjectBytes)
        {
            return Results.Problem(statusCode: StatusCodes.Status413PayloadTooLarge, title: "Image size exceeds 2 MiB.");
        }

        await using var input = file.OpenReadStream();
        using var buffer = new MemoryStream((int)file.Length);
        await input.CopyToAsync(buffer, cancellationToken);
        if (buffer.Length is <= 0 or > MaximumObjectBytes)
        {
            return Results.Problem(statusCode: StatusCodes.Status413PayloadTooLarge, title: "Image size exceeds 2 MiB.");
        }

        var bytes = buffer.ToArray();
        var detected = DetectImage(bytes);
        if (detected is null || !string.Equals(file.ContentType, detected.Value.ContentType, StringComparison.OrdinalIgnoreCase))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["file"] = ["Image content must match its JPEG, PNG, or WebP content type."],
            });
        }

        var ownerUid = principal.FindFirst("firebase:uid")!.Value;
        await using var transaction = db.Database.ProviderName == "Npgsql.EntityFrameworkCore.PostgreSQL"
            ? await db.Database.BeginTransactionAsync(cancellationToken)
            : null;
        var profile = transaction is null
            ? await db.Profiles.AsNoTracking().SingleOrDefaultAsync(item => item.FirebaseUid == ownerUid, cancellationToken)
            : await db.Profiles.FromSqlInterpolated($"SELECT * FROM profiles WHERE firebase_uid = {ownerUid} FOR UPDATE")
                .SingleOrDefaultAsync(cancellationToken);
        if (profile is null)
        {
            return Results.Forbid();
        }

        var usedBytes = await db.MediaObjects.AsNoTracking()
            .Where(item => item.OwnerUid == ownerUid)
            .SumAsync(item => (long?)item.LengthBytes, cancellationToken) ?? 0;
        if (usedBytes + bytes.LongLength > MaximumOwnerBytes)
        {
            return Results.Problem(statusCode: StatusCodes.Status413PayloadTooLarge, title: "This account has reached its 250 MiB media limit.");
        }

        var now = DateTimeOffset.UtcNow;
        var id = Guid.NewGuid();
        var sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var mediaObject = new MediaObject
        {
            Id = id,
            OwnerUid = ownerUid,
            ContentType = detected.Value.ContentType,
            Extension = detected.Value.Extension,
            LengthBytes = bytes.LongLength,
            Sha256 = sha256,
            CreatedAt = now,
        };

        await mediaStore.WriteAsync(id, mediaObject.Extension, bytes, cancellationToken);
        try
        {
            db.MediaObjects.Add(mediaObject);
            await db.SaveChangesAsync(cancellationToken);
            if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            mediaStore.Delete(id, mediaObject.Extension);
            throw;
        }

        return Results.Created($"/api/v1/media/{id:N}", new { reference = ToReference(id) });
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        HttpContext context,
        QizzoneDbContext db,
        LocalMediaStore mediaStore,
        CancellationToken cancellationToken)
    {
        var mediaObject = await db.MediaObjects.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (mediaObject is null) return Results.NotFound();

        var stream = mediaStore.OpenRead(id, mediaObject.Extension);
        if (stream is null) return Results.NotFound();

        context.Response.Headers["Cache-Control"] = "public, max-age=31536000, immutable";
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        context.Response.Headers["ETag"] = $"\"{mediaObject.Sha256}\"";
        return Results.File(stream, mediaObject.ContentType, enableRangeProcessing: false);
    }

    private static (string ContentType, string Extension)? DetectImage(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF)
            return ("image/jpeg", ".jpg");

        ReadOnlySpan<byte> pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        if (bytes.StartsWith(pngSignature)) return ("image/png", ".png");

        if (bytes.Length >= 12 && Encoding.ASCII.GetString(bytes[..4]) == "RIFF" &&
            Encoding.ASCII.GetString(bytes.Slice(8, 4)) == "WEBP")
            return ("image/webp", ".webp");

        return null;
    }
}
