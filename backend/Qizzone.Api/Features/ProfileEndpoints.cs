using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Qizzone.Api.Data;

namespace Qizzone.Api.Features;

public static class ProfileEndpoints
{
    public static IEndpointRouteBuilder MapProfileEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/me")
            .WithTags("Profile")
            .RequireAuthorization();

        group.MapGet("/", GetOrCreateAsync);
        group.MapPatch("/", UpdateAsync).RequireAuthorization("ActiveUser");
        group.MapPost("/role", SwitchRoleAsync).RequireAuthorization("ActiveUser");

        endpoints.MapPost("/api/v1/teacher-requests", RequestTeacherAccessAsync)
            .WithTags("Profile")
            .RequireAuthorization("Student");

        return endpoints;
    }

    private static async Task<IResult> GetOrCreateAsync(
        ClaimsPrincipal principal,
        IConfiguration configuration,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var uid = principal.FindFirst("firebase:uid")?.Value;
        var email = principal.FindFirst(ClaimTypes.Email)?.Value;
        if (string.IsNullOrWhiteSpace(uid) || string.IsNullOrWhiteSpace(email))
        {
            return Results.BadRequest(new { error = "Firebase token must contain a user ID and email." });
        }

        var bootstrapAdminUids = configuration.GetSection("Admin:BootstrapUids").Get<string[]>() ?? [];
        var isBootstrapAdmin = bootstrapAdminUids.Any(candidate =>
            string.Equals(candidate.Trim(), uid, StringComparison.Ordinal));
        var isEmailVerified = principal.FindFirst("firebase:email_verified")?.Value == "true";
        var profile = await db.Profiles.SingleOrDefaultAsync(item => item.FirebaseUid == uid, cancellationToken);
        if (profile is null)
        {
            var fullName = principal.FindFirst(ClaimTypes.Name)?.Value;
            if (string.IsNullOrWhiteSpace(fullName))
            {
                fullName = email.Split('@', 2)[0];
            }

            fullName = fullName.Trim();
            if (fullName.Length == 0)
            {
                return Results.BadRequest(new { error = "A display name is required to create the profile." });
            }

            profile = new Profile
            {
                FirebaseUid = uid,
                Email = email,
                FullName = fullName[..Math.Min(100, fullName.Length)],
                Role = isBootstrapAdmin && isEmailVerified ? "admin" : "student",
                ActiveRole = isBootstrapAdmin && isEmailVerified ? "admin" : "student",
                ApprovalStatus = "approved",
                TeacherRequestStatus = "none",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Profiles.Add(profile);
            if (isBootstrapAdmin)
            {
                db.AuditEvents.Add(new AuditEvent
                {
                    Id = Guid.NewGuid(),
                    ActorUid = uid,
                    Action = "admin.bootstrap_completed",
                    TargetType = "profile",
                    TargetId = uid,
                    DetailsJson = "{}",
                    CreatedAt = DateTimeOffset.UtcNow,
                });
            }
            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException)
            {
                db.ChangeTracker.Clear();
                profile = await db.Profiles.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.FirebaseUid == uid, cancellationToken);
                if (profile is null)
                {
                    return Results.Conflict(new { error = "An account already uses this email address." });
                }
            }
        }
        else if (isBootstrapAdmin && isEmailVerified && profile.Role == "student" &&
            profile.ActiveRole == "student" && profile.TeacherRequestStatus == "none" && !profile.TeacherRequestBlocked)
        {
            profile.Role = "admin";
            profile.ActiveRole = "admin";
            profile.UpdatedAt = DateTimeOffset.UtcNow;
            db.AuditEvents.Add(new AuditEvent
            {
                Id = Guid.NewGuid(),
                ActorUid = uid,
                Action = "admin.bootstrap_completed",
                TargetType = "profile",
                TargetId = uid,
                DetailsJson = "{}",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync(cancellationToken);
        }

        return Results.Ok(ToResponse(profile));
    }

    private static async Task<IResult> UpdateAsync(
        ProfileUpdateRequest request,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var uid = principal.FindFirst("firebase:uid")?.Value;
        var fullName = request.FullName?.Trim();
        if (string.IsNullOrWhiteSpace(fullName) || fullName.Length > 100)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["fullName"] = ["Name must be between 1 and 100 characters."],
            });
        }

        string? studentClass = null;
        if (request.StudentClass.ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null))
        {
            if (request.StudentClass.ValueKind != JsonValueKind.String)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["studentClass"] = ["Class name must be text or null."],
                });
            }

            studentClass = request.StudentClass.GetString()?.Trim();
            if (studentClass?.Length > 100)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["studentClass"] = ["Class name cannot exceed 100 characters."],
                });
            }
        }

        string? avatarUrl = null;
        if (request.AvatarUrl.ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null))
        {
            if (request.AvatarUrl.ValueKind != JsonValueKind.String)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["avatarUrl"] = ["Avatar URL must be a Qizzone media reference or null."],
                });
            }

            avatarUrl = request.AvatarUrl.GetString()?.Trim();
            if (!string.IsNullOrEmpty(avatarUrl))
            {
                if (!MediaEndpoints.TryParseReference(avatarUrl, out var mediaId) ||
                    !await db.MediaObjects.AsNoTracking().AnyAsync(
                        item => item.Id == mediaId && item.OwnerUid == uid,
                        cancellationToken))
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        ["avatarUrl"] = ["Avatar must reference an image uploaded by this account."],
                    });
                }
            }
            else
            {
                avatarUrl = null;
            }
        }

        var profile = await db.Profiles.SingleOrDefaultAsync(item => item.FirebaseUid == uid, cancellationToken);
        if (profile is null)
        {
            return Results.NotFound();
        }

        profile.FullName = fullName;
        if (request.StudentClass.ValueKind != JsonValueKind.Undefined)
        {
            profile.StudentClass = string.IsNullOrWhiteSpace(studentClass) ? null : studentClass;
        }
        if (request.AvatarUrl.ValueKind != JsonValueKind.Undefined)
        {
            profile.AvatarUrl = avatarUrl;
        }
        profile.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(ToResponse(profile));
    }

    private static async Task<IResult> SwitchRoleAsync(
        RoleSwitchRequest request,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        if (request.Role is not ("student" or "teacher"))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["role"] = ["Role must be student or teacher."],
            });
        }

        var uid = principal.FindFirst("firebase:uid")?.Value;
        var profile = await db.Profiles.SingleOrDefaultAsync(item => item.FirebaseUid == uid, cancellationToken);
        if (profile is null || profile.ApprovalStatus != "approved" || profile.Role == "admin")
        {
            return Results.Forbid();
        }

        if (request.Role == "teacher" && profile.Role != "teacher" &&
            (profile.TeacherRequestStatus != "approved" || profile.TeacherRequestBlocked))
        {
            return Results.Forbid();
        }

        if (request.Role == "student" && profile.Role != "student")
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["role"] = ["This account cannot switch to the student role."],
            });
        }

        if (profile.ActiveRole != request.Role)
        {
            profile.ActiveRole = request.Role;
            profile.UpdatedAt = DateTimeOffset.UtcNow;
            db.AuditEvents.Add(new AuditEvent
            {
                Id = Guid.NewGuid(),
                ActorUid = uid!,
                Action = "profile.active_role_changed",
                TargetType = "profile",
                TargetId = uid,
                DetailsJson = JsonSerializer.Serialize(new { role = request.Role }, new JsonSerializerOptions(JsonSerializerDefaults.Web)),
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync(cancellationToken);
        }

        return Results.Ok(ToResponse(profile));
    }

    private static async Task<IResult> RequestTeacherAccessAsync(
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var uid = principal.FindFirst("firebase:uid")?.Value;
        var profile = await db.Profiles.SingleOrDefaultAsync(item => item.FirebaseUid == uid, cancellationToken);
        if (profile is null)
        {
            return Results.NotFound();
        }

        if (profile.TeacherRequestBlocked)
        {
            return Results.Conflict(new { error = "Teacher access requests are blocked for this account." });
        }

        if (profile.Role == "teacher" || profile.TeacherRequestStatus == "approved")
        {
            return Results.Conflict(new { error = "This account already has teacher access." });
        }

        if (profile.TeacherRequestStatus != "pending")
        {
            profile.TeacherRequestStatus = "pending";
            profile.TeacherRequestedAt = DateTimeOffset.UtcNow;
            profile.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
        }

        return Results.Accepted(value: new
        {
            status = profile.TeacherRequestStatus,
            requestedAt = profile.TeacherRequestedAt,
        });
    }

    private static ProfileResponse ToResponse(Profile profile) => new(
        profile.FirebaseUid,
        profile.Email,
        profile.FullName,
        profile.Role,
        profile.ApprovalStatus,
        profile.TeacherRequestStatus,
        profile.TeacherRequestBlocked,
        profile.TeacherRequestedAt,
        profile.AvatarUrl,
        profile.StudentClass,
        profile.ActiveRole,
        profile.Role);

    private sealed record ProfileUpdateRequest(string? FullName, JsonElement StudentClass, JsonElement AvatarUrl);
    private sealed record RoleSwitchRequest(string? Role);

    private sealed record ProfileResponse(
        string FirebaseUid,
        string Email,
        string FullName,
        string Role,
        string ApprovalStatus,
        string TeacherRequestStatus,
        bool TeacherRequestBlocked,
        DateTimeOffset? TeacherRequestedAt,
        string? AvatarUrl,
        string? StudentClass,
        string ActiveRole,
        string BaseRole);
}
