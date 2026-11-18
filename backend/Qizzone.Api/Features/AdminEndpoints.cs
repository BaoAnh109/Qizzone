using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Qizzone.Api.Data;

namespace Qizzone.Api.Features;

public static class AdminEndpoints
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static IEndpointRouteBuilder MapAdminEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/admin")
            .WithTags("Administration")
            .RequireAuthorization("Admin");

        group.MapGet("/teacher-requests", ListTeacherRequestsAsync);
        group.MapPatch("/teacher-requests/{uid}", ReviewTeacherRequestAsync);
        group.MapGet("/accounts", ListAccountsAsync);
        group.MapPatch("/accounts/{uid}/access", SetAccountAccessAsync);
        return endpoints;
    }

    private static async Task<IResult> ListTeacherRequestsAsync(
        string? status,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var filter = string.IsNullOrWhiteSpace(status) ? "pending" : status.Trim().ToLowerInvariant();
        if (filter is not ("pending" or "approved" or "rejected" or "blocked"))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["status"] = ["Status must be pending, approved, rejected, or blocked."],
            });
        }

        IQueryable<Profile> requestQuery = db.Profiles.AsNoTracking();
        requestQuery = filter switch
        {
            "pending" => requestQuery.Where(profile => (profile.Role == "student" && profile.TeacherRequestStatus == "pending") ||
                (profile.Role == "teacher" && profile.ApprovalStatus == "pending")),
            "approved" => requestQuery.Where(profile => (profile.Role == "student" && profile.TeacherRequestStatus == "approved") ||
                (profile.Role == "teacher" && profile.ApprovalStatus == "approved")),
            "rejected" => requestQuery.Where(profile => (profile.Role == "student" && profile.TeacherRequestStatus == "rejected") ||
                (profile.Role == "teacher" && profile.ApprovalStatus == "rejected")),
            "blocked" => requestQuery.Where(profile => profile.Role == "student" && profile.TeacherRequestBlocked),
            _ => requestQuery.Where(_ => false),
        };

        var profiles = await requestQuery
            .OrderBy(profile => profile.TeacherRequestedAt ?? profile.ApprovalRequestedAt ?? profile.CreatedAt)
            .Take(500)
            .Select(profile => new TeacherRequestResponse(
                profile.FirebaseUid,
                profile.Email,
                profile.FullName,
                profile.Role,
                profile.ApprovalStatus,
                profile.TeacherRequestStatus,
                profile.TeacherRequestBlocked,
                profile.TeacherRequestedAt ?? profile.ApprovalRequestedAt,
                profile.CreatedAt))
            .ToListAsync(cancellationToken);

        return Results.Ok(new { requests = profiles });
    }

    private static async Task<IResult> ReviewTeacherRequestAsync(
        string uid,
        TeacherReviewRequest request,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var actorUid = principal.FindFirst("firebase:uid")!.Value;
        if (string.Equals(uid, actorUid, StringComparison.Ordinal))
        {
            return Results.BadRequest(new { error = "Administrators cannot review their own access." });
        }

        var profile = await db.Profiles.SingleOrDefaultAsync(item => item.FirebaseUid == uid, cancellationToken);
        if (profile is null)
        {
            return Results.NotFound();
        }

        var now = DateTimeOffset.UtcNow;
        switch (request.Action)
        {
            case "set_blocked" when profile.Role == "student" && request.Blocked is not null:
                profile.TeacherRequestBlocked = request.Blocked.Value;
                break;
            case "approve" or "reject" when profile.Role == "student" && profile.TeacherRequestStatus == "pending":
                profile.TeacherRequestStatus = request.Action == "approve" ? "approved" : "rejected";
                profile.TeacherRequestBlocked = false;
                profile.TeacherReviewedAt = now;
                profile.TeacherReviewedBy = actorUid;
                break;
            case "approve" or "reject" when profile.Role == "teacher" && profile.ApprovalStatus == "pending":
                profile.ApprovalStatus = request.Action == "approve" ? "approved" : "rejected";
                profile.TeacherRequestStatus = request.Action == "approve" ? "approved" : "rejected";
                profile.ReviewedAt = now;
                profile.ReviewedBy = actorUid;
                profile.TeacherReviewedAt = now;
                profile.TeacherReviewedBy = actorUid;
                break;
            case "set_blocked":
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["blocked"] = ["Only a student teacher-access request can be blocked or unblocked."],
                });
            case "approve" or "reject":
                return Results.Conflict(new { error = "This teacher request is no longer pending." });
            default:
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["action"] = ["Action must be approve, reject, or set_blocked with a boolean blocked value."],
                });
        }

        profile.UpdatedAt = now;
        db.AuditEvents.Add(CreateAudit(actorUid, request.Action, profile.FirebaseUid, new
        {
            role = profile.Role,
            teacherRequestStatus = profile.TeacherRequestStatus,
            teacherRequestBlocked = profile.TeacherRequestBlocked,
            profile.ApprovalStatus,
        }));
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(ToTeacherRequest(profile));
    }

    private static async Task<IResult> ListAccountsAsync(
        string? role,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var normalizedRole = string.IsNullOrWhiteSpace(role) ? null : role.Trim().ToLowerInvariant();
        if (normalizedRole is not null and not ("student" or "teacher"))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["role"] = ["Role must be student or teacher."],
            });
        }

        var query = db.Profiles.AsNoTracking()
            .Where(profile => profile.Role == "student" || profile.Role == "teacher");
        if (normalizedRole is not null)
        {
            query = query.Where(profile => profile.Role == normalizedRole);
        }

        var accounts = await query.OrderByDescending(profile => profile.CreatedAt)
            .Take(1000)
            .Select(profile => new AccountResponse(
                profile.FirebaseUid,
                profile.Email,
                profile.FullName,
                profile.Role,
                profile.ApprovalStatus,
                profile.TeacherRequestStatus,
                profile.TeacherRequestBlocked,
                profile.CreatedAt,
                db.Quizzes.Count(quiz => quiz.TeacherUid == profile.FirebaseUid),
                db.ExamAttempts.Count(attempt => attempt.StudentUid == profile.FirebaseUid && attempt.SubmittedAt != null)))
            .ToListAsync(cancellationToken);

        return Results.Ok(new { accounts });
    }

    private static async Task<IResult> SetAccountAccessAsync(
        string uid,
        AccountAccessRequest request,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var actorUid = principal.FindFirst("firebase:uid")!.Value;
        if (string.Equals(uid, actorUid, StringComparison.Ordinal))
        {
            return Results.BadRequest(new { error = "Administrators cannot block their own account." });
        }

        if (request.IsBlocked is null)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["isBlocked"] = ["A boolean isBlocked value is required."],
            });
        }

        var profile = await db.Profiles.SingleOrDefaultAsync(item => item.FirebaseUid == uid, cancellationToken);
        if (profile is null || profile.Role == "admin")
        {
            return profile is null ? Results.NotFound() : Results.Conflict(new { error = "Administrator access requires a separate reviewed procedure." });
        }

        var now = DateTimeOffset.UtcNow;
        profile.ApprovalStatus = request.IsBlocked.Value ? "rejected" : "approved";
        profile.ReviewedAt = now;
        profile.ReviewedBy = actorUid;
        if (profile.Role == "teacher")
        {
            profile.TeacherRequestStatus = request.IsBlocked.Value ? "rejected" : "approved";
            profile.TeacherReviewedAt = now;
            profile.TeacherReviewedBy = actorUid;
        }

        profile.UpdatedAt = now;
        db.AuditEvents.Add(CreateAudit(actorUid, request.IsBlocked.Value ? "account.blocked" : "account.unblocked", uid, new
        {
            role = profile.Role,
            profile.ApprovalStatus,
        }));
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static TeacherRequestResponse ToTeacherRequest(Profile profile) => new(
        profile.FirebaseUid,
        profile.Email,
        profile.FullName,
        profile.Role,
        profile.ApprovalStatus,
        profile.TeacherRequestStatus,
        profile.TeacherRequestBlocked,
        profile.TeacherRequestedAt ?? profile.ApprovalRequestedAt,
        profile.CreatedAt);

    private static AuditEvent CreateAudit(string actorUid, string action, string targetUid, object details) => new()
    {
        Id = Guid.NewGuid(),
        ActorUid = actorUid,
        Action = action,
        TargetType = "profile",
        TargetId = targetUid,
        DetailsJson = JsonSerializer.Serialize(details, JsonOptions),
        CreatedAt = DateTimeOffset.UtcNow,
    };

    private sealed record TeacherReviewRequest(string? Action, bool? Blocked);
    private sealed record AccountAccessRequest(bool? IsBlocked);
    private sealed record TeacherRequestResponse(
        string FirebaseUid,
        string Email,
        string FullName,
        string Role,
        string ApprovalStatus,
        string TeacherRequestStatus,
        bool TeacherRequestBlocked,
        DateTimeOffset? RequestedAt,
        DateTimeOffset CreatedAt);
    private sealed record AccountResponse(
        string FirebaseUid,
        string Email,
        string FullName,
        string Role,
        string ApprovalStatus,
        string TeacherRequestStatus,
        bool TeacherRequestBlocked,
        DateTimeOffset CreatedAt,
        int QuizCount,
        int SubmissionCount);
}
