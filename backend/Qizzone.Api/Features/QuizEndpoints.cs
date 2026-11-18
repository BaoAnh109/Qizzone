using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Net.Mail;
using Microsoft.EntityFrameworkCore;
using Qizzone.Api.Data;

namespace Qizzone.Api.Features;

public static class QuizEndpoints
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static IEndpointRouteBuilder MapQuizEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/quizzes")
            .WithTags("Quizzes")
            .RequireAuthorization("ActiveUser");

        group.MapGet("/", ListAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPost("/", CreateAsync).RequireAuthorization("Teacher");
        group.MapPut("/{id:guid}", UpdateAsync).RequireAuthorization("Teacher");
        group.MapDelete("/{id:guid}", DeleteAsync).RequireAuthorization("Teacher");
        group.MapPut("/{id:guid}/assignments", UpdateAssignmentsAsync).RequireAuthorization("Teacher");
        group.MapPatch("/{id:guid}/status", UpdateStatusAsync).RequireAuthorization("Teacher");

        return endpoints;
    }

    private static async Task<IResult> ListAsync(
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var uid = principal.FindFirst("firebase:uid")!.Value;
        var isAdmin = HasRole(principal, "admin");
        var hasTeacherAccess = HasRole(principal, "teacher");

        var query = db.Quizzes.AsNoTracking()
            .Include(item => item.Questions)
            .ThenInclude(item => item.AnswerKey)
            .AsQueryable();

        if (!isAdmin)
        {
            query = query.Where(item => item.Status == "published" || (hasTeacherAccess && item.TeacherUid == uid));
        }

        var quizzes = await query.OrderByDescending(item => item.CreatedAt)
            .Take(500)
            .ToListAsync(cancellationToken);
        var teacherUids = quizzes.Select(item => item.TeacherUid).Distinct().ToArray();
        var teacherNames = await db.Profiles.AsNoTracking()
            .Where(item => teacherUids.Contains(item.FirebaseUid))
            .ToDictionaryAsync(item => item.FirebaseUid, item => item.FullName, cancellationToken);

        return Results.Ok(quizzes.Select(quiz => ToResponse(
            quiz,
            teacherNames.GetValueOrDefault(quiz.TeacherUid),
            canSeeAnswerKey: isAdmin || (hasTeacherAccess && quiz.TeacherUid == uid))));
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var quiz = await db.Quizzes.AsNoTracking()
            .Include(item => item.Questions)
            .ThenInclude(item => item.AnswerKey)
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (quiz is null)
        {
            return Results.NotFound();
        }

        var uid = principal.FindFirst("firebase:uid")!.Value;
        var canSeeAnswerKey = HasRole(principal, "admin") ||
            (HasRole(principal, "teacher") && quiz.TeacherUid == uid);
        if (!canSeeAnswerKey && quiz.Status != "published")
        {
            return Results.NotFound();
        }

        var teacherName = await db.Profiles.AsNoTracking()
            .Where(item => item.FirebaseUid == quiz.TeacherUid)
            .Select(item => item.FullName)
            .SingleOrDefaultAsync(cancellationToken);

        return Results.Ok(ToResponse(quiz, teacherName, canSeeAnswerKey));
    }

    private static async Task<IResult> CreateAsync(
        QuizWriteRequest request,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var uid = principal.FindFirst("firebase:uid")!.Value;
        var validation = Validate(request, uid);
        if (validation is not null)
        {
            return validation;
        }

        var profile = await db.Profiles.AsNoTracking()
            .SingleOrDefaultAsync(item => item.FirebaseUid == uid, cancellationToken);
        if (profile is null)
        {
            return Results.Forbid();
        }

        var now = DateTimeOffset.UtcNow;
        var quiz = new Quiz
        {
            Id = Guid.NewGuid(),
            TeacherUid = uid,
            Title = request.Title!.Trim(),
            Subject = request.Subject!.Trim(),
            Description = request.Description?.Trim() ?? "",
            Code = NewRoomCode(),
            Status = request.Status ?? "draft",
            SettingsJson = JsonSerializer.Serialize(NormalizeSettings(request.Settings!), JsonOptions),
            CreatedAt = now,
            UpdatedAt = now,
            LegacyId = request.LegacyId?.Trim(),
            Questions = request.Questions!.Select((question, index) => BuildQuestion(question, index + 1, now)).ToList(),
        };

        db.Quizzes.Add(quiz);
        db.AuditEvents.Add(CreateAudit(uid, "quiz.created", "quiz", quiz.Id.ToString(), new
        {
            questionCount = quiz.Questions.Count,
            quiz.Status,
        }));
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created($"/api/v1/quizzes/{quiz.Id}", ToResponse(quiz, profile.FullName, canSeeAnswerKey: true));
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        QuizWriteRequest request,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var uid = principal.FindFirst("firebase:uid")!.Value;
        var validation = Validate(request, uid);
        if (validation is not null)
        {
            return validation;
        }

        var quiz = await db.Quizzes
            .Include(item => item.Questions)
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (quiz is null)
        {
            return Results.NotFound();
        }

        if (!HasRole(principal, "admin") && quiz.TeacherUid != uid)
        {
            return Results.Forbid();
        }

        if (await db.ExamAttempts.AnyAsync(item => item.QuizId == id, cancellationToken))
        {
            return Results.Conflict(new { error = "This quiz already has exam attempts. Duplicate it before changing its questions." });
        }

        var now = DateTimeOffset.UtcNow;
        quiz.Title = request.Title!.Trim();
        quiz.Subject = request.Subject!.Trim();
        quiz.Description = request.Description?.Trim() ?? "";
        quiz.Status = request.Status ?? quiz.Status;
        quiz.SettingsJson = JsonSerializer.Serialize(NormalizeSettings(request.Settings!), JsonOptions);
        quiz.UpdatedAt = now;
        db.Questions.RemoveRange(quiz.Questions);
        quiz.Questions = request.Questions!.Select((question, index) => BuildQuestion(question, index + 1, now)).ToList();
        db.AuditEvents.Add(CreateAudit(uid, "quiz.updated", "quiz", quiz.Id.ToString(), new
        {
            questionCount = quiz.Questions.Count,
            quiz.Status,
        }));
        await db.SaveChangesAsync(cancellationToken);

        var teacherName = await db.Profiles.AsNoTracking()
            .Where(item => item.FirebaseUid == quiz.TeacherUid)
            .Select(item => item.FullName)
            .SingleOrDefaultAsync(cancellationToken);
        return Results.Ok(ToResponse(quiz, teacherName, canSeeAnswerKey: true));
    }

    private static async Task<IResult> UpdateAssignmentsAsync(
        Guid id,
        QuizAssignmentsRequest request,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var quiz = await db.Quizzes.SingleOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (quiz is null)
        {
            return Results.NotFound();
        }

        var uid = principal.FindFirst("firebase:uid")!.Value;
        if (!HasRole(principal, "admin") && quiz.TeacherUid != uid)
        {
            return Results.Forbid();
        }

        var classes = NormalizeAssignments(request.AssignedClasses ?? [], 500, 100, "assignedClasses");
        var emails = NormalizeAssignments(request.AssignedEmails ?? [], 5000, 320, "assignedEmails", normalizeEmail: true);
        if (classes.Error is not null || emails.Error is not null)
        {
            var errors = new Dictionary<string, string[]>();
            if (classes.Error is not null) errors["assignedClasses"] = [classes.Error];
            if (emails.Error is not null) errors["assignedEmails"] = [emails.Error];
            return Results.ValidationProblem(errors);
        }

        var settings = JsonNode.Parse(quiz.SettingsJson)?.AsObject() ?? new JsonObject();
        settings["assignedClasses"] = JsonSerializer.SerializeToNode(classes.Values, JsonOptions);
        settings["assignedEmails"] = JsonSerializer.SerializeToNode(emails.Values, JsonOptions);
        quiz.SettingsJson = settings.ToJsonString(JsonOptions);
        quiz.UpdatedAt = DateTimeOffset.UtcNow;
        db.AuditEvents.Add(CreateAudit(uid, "quiz.assignments_updated", "quiz", quiz.Id.ToString(), new
        {
            classCount = classes.Values.Count,
            emailCount = emails.Values.Count,
        }));
        await db.SaveChangesAsync(cancellationToken);

        return Results.NoContent();
    }

    private static async Task<IResult> UpdateStatusAsync(
        Guid id,
        QuizStatusRequest request,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        if (request.Status is not ("draft" or "published" or "closed"))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["status"] = ["Status must be draft, published, or closed."],
            });
        }

        var quiz = await db.Quizzes.SingleOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (quiz is null)
        {
            return Results.NotFound();
        }

        var uid = principal.FindFirst("firebase:uid")!.Value;
        if (!HasRole(principal, "admin") && quiz.TeacherUid != uid)
        {
            return Results.Forbid();
        }

        if (request.Status == "published" &&
            !await db.Questions.AnyAsync(item => item.QuizId == id, cancellationToken))
        {
            return Results.Conflict(new { error = "Add at least one question before publishing this quiz." });
        }

        quiz.Status = request.Status!;
        quiz.UpdatedAt = DateTimeOffset.UtcNow;
        db.AuditEvents.Add(CreateAudit(uid, "quiz.status_changed", "quiz", quiz.Id.ToString(), new { quiz.Status }));
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> DeleteAsync(
        Guid id,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var quiz = await db.Quizzes.SingleOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (quiz is null)
        {
            return Results.NotFound();
        }

        var uid = principal.FindFirst("firebase:uid")!.Value;
        if (!HasRole(principal, "admin") && quiz.TeacherUid != uid)
        {
            return Results.Forbid();
        }

        if (await db.ExamAttempts.AnyAsync(item => item.QuizId == id, cancellationToken))
        {
            return Results.Conflict(new { error = "This quiz has exam history and cannot be deleted." });
        }

        if (await db.PracticeSessions.AnyAsync(item => item.QuizId == id, cancellationToken))
        {
            return Results.Conflict(new { error = "This quiz has practice history and cannot be deleted." });
        }

        db.Quizzes.Remove(quiz);
        db.AuditEvents.Add(CreateAudit(uid, "quiz.deleted", "quiz", quiz.Id.ToString(), new { quiz.Title }));
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static IResult? Validate(QuizWriteRequest request, string mediaOwnerUid)
    {
        var errors = new Dictionary<string, string[]>();
        if (request.Settings is null)
            errors["settings"] = ["Settings are required."];
        if (request.Questions is null)
            errors["questions"] = ["Questions are required."];
        if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Trim().Length > 300)
            errors["title"] = ["Title must be between 1 and 300 characters."];
        if (string.IsNullOrWhiteSpace(request.Subject) || request.Subject.Trim().Length > 100)
            errors["subject"] = ["Subject must be between 1 and 100 characters."];
        if ((request.Description?.Length ?? 0) > 5000)
            errors["description"] = ["Description cannot exceed 5000 characters."];
        if (request.Status is not null && request.Status is not ("draft" or "published" or "closed"))
            errors["status"] = ["Status must be draft, published, or closed."];
        if (request.LegacyId is { Length: > 200 })
            errors["legacyId"] = ["Legacy ID cannot exceed 200 characters."];

        if (request.Settings is not null)
        {
            if (request.Settings.DurationMinutes is < 0 or > 1440)
                errors["settings.durationMinutes"] = ["Duration must be between 0 and 1440 minutes."];
            if (request.Settings.MaxAttempts < 0)
                errors["settings.maxAttempts"] = ["Maximum attempts cannot be negative."];
            if (request.Settings.PassPercentage is < 0 or > 100)
                errors["settings.passPercentage"] = ["Pass percentage must be between 0 and 100."];
            if ((request.Settings.AssignedClasses?.Count ?? 0) > 500 ||
                (request.Settings.AssignedClasses ?? []).Any(value => value is null || value.Trim().Length > 100))
                errors["settings.assignedClasses"] = ["Assigned class values are invalid."];
            if ((request.Settings.AssignedEmails?.Count ?? 0) > 5000 ||
                (request.Settings.AssignedEmails ?? []).Any(value => value is null || value.Trim().Length > 320 ||
                    (value.Trim().Length > 0 && !IsValidEmail(value.Trim()))))
                errors["settings.assignedEmails"] = ["Assigned email values are invalid."];
        }

        var questions = request.Questions ?? [];
        if (questions.Any(question => question is null))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["questions"] = ["Question entries cannot be null."],
            });
        }

        if (questions.Count is < 1 or > 1000)
            errors["questions"] = ["A quiz must contain between 1 and 1000 questions."];

        if (questions.Where(question => question.Id is not null).Select(question => question.Id)
            .Distinct(StringComparer.Ordinal).Count() != questions.Count(question => question.Id is not null))
            errors["questions"] = ["Question IDs must be unique."];

        for (var index = 0; index < questions.Count; index++)
        {
            var question = questions[index];
            var key = $"questions[{index}]";
            if (string.IsNullOrWhiteSpace(question.Content) || question.Content.Trim().Length > 20000)
                errors[$"{key}.content"] = ["Question text must be between 1 and 20000 characters."];
            if (question.Type is not ("single_choice" or "multiple_choice" or "true_false"))
                errors[$"{key}.type"] = ["Question type is invalid."];
            var options = question.Options ?? [];
            var correctAnswers = question.CorrectAnswers ?? [];
            var questionImages = question.Images ?? [];
            if (options.Count is < 2 or > 4)
                errors[$"{key}.options"] = ["A question must have between 2 and 4 options."];
            if (question.Points <= 0 || question.Points > 1000)
                errors[$"{key}.points"] = ["Points must be greater than 0 and at most 1000."];
            if (questionImages.Count > 8)
                errors[$"{key}.images"] = ["At most 8 images can be attached to a question."];
            if (question.Explanation?.Length > 20000)
                errors[$"{key}.explanation"] = ["Explanation cannot exceed 20000 characters."];

            if (options.Any(option => option is null))
            {
                errors[$"{key}.options"] = ["Option entries cannot be null."];
                continue;
            }

            var optionIds = options.Select(option => option.Id ?? "").ToArray();
            if (optionIds.Any(option => option is not ("A" or "B" or "C" or "D")) || optionIds.Distinct(StringComparer.Ordinal).Count() != optionIds.Length)
                errors[$"{key}.options"] = ["Option IDs must be unique values from A, B, C, or D."];
            if (options.Any(option => string.IsNullOrWhiteSpace(option.Content) || option.Content.Trim().Length > 20000 || (option.Images?.Count ?? 0) > 8))
                errors[$"{key}.options"] = ["Option text or images are invalid."];

            if (correctAnswers.Count is < 1 or > 4 ||
                correctAnswers.Any(answer => answer is null) ||
                correctAnswers.Distinct(StringComparer.Ordinal).Count() != correctAnswers.Count ||
                correctAnswers.Any(answer => !optionIds.Contains(answer, StringComparer.Ordinal)))
            {
                errors[$"{key}.correctAnswers"] = ["Correct answers must reference one or more unique options."];
            }
            else if (question.Type != "multiple_choice" && correctAnswers.Count != 1)
            {
                errors[$"{key}.correctAnswers"] = ["Single-choice and true/false questions must have exactly one correct answer."];
            }

            if (options.Any(option => (option.Images ?? []).Any(image => image is null || !ValidMediaReference(image, mediaOwnerUid))) ||
                questionImages.Any(image => image is null || !ValidMediaReference(image, mediaOwnerUid)))
            {
                errors[$"{key}.images"] = ["Images must use a valid Qizzone media reference."];
            }
        }

        return errors.Count == 0 ? null : Results.ValidationProblem(errors);
    }

    private static Question BuildQuestion(QuestionWriteRequest request, int ordinal, DateTimeOffset now)
    {
        var id = Guid.TryParse(request.Id, out var parsedId) ? parsedId : Guid.NewGuid();
        var question = new Question
        {
            Id = id,
            Ordinal = ordinal,
            Content = request.Content!.Trim(),
            ImagesJson = JsonSerializer.Serialize(request.Images ?? [], JsonOptions),
            Type = request.Type,
            OptionsJson = JsonSerializer.Serialize(request.Options ?? [], JsonOptions),
            Points = request.Points,
            LegacyId = request.Id is not null && !Guid.TryParse(request.Id, out _) ? request.Id[..Math.Min(request.Id.Length, 200)] : null,
            CreatedAt = now,
            UpdatedAt = now,
            AnswerKey = new QuestionAnswerKey
            {
                QuestionId = id,
                CorrectAnswersJson = JsonSerializer.Serialize(request.CorrectAnswers ?? [], JsonOptions),
                Explanation = request.Explanation?.Trim() ?? "",
                CreatedAt = now,
                UpdatedAt = now,
            },
        };
        return question;
    }

    private static QuizResponse ToResponse(Quiz quiz, string? teacherName, bool canSeeAnswerKey)
    {
        var settings = JsonNode.Parse(quiz.SettingsJson)?.AsObject() ?? new JsonObject();
        if (!canSeeAnswerKey)
        {
            settings["assignedEmails"] = new JsonArray();
        }

        var settingsElement = JsonDocument.Parse(settings.ToJsonString(JsonOptions)).RootElement.Clone();
        var questions = quiz.Questions.OrderBy(item => item.Ordinal).Select(question => new QuestionResponse(
            question.Id.ToString(),
            question.Ordinal,
            question.Content,
            DeserializeStringList(question.ImagesJson),
            question.Type,
            DeserializeOptions(question.OptionsJson),
            canSeeAnswerKey ? DeserializeStringList(question.AnswerKey?.CorrectAnswersJson ?? "[]") : [],
            canSeeAnswerKey ? question.AnswerKey?.Explanation : null,
            question.Points)).ToList();

        return new QuizResponse(
            quiz.Id.ToString(),
            quiz.Title,
            quiz.Subject,
            quiz.Description,
            quiz.TeacherUid,
            teacherName,
            quiz.Code,
            quiz.Status,
            settingsElement,
            questions,
            questions.Count,
            questions.Sum(item => item.Points),
            quiz.CreatedAt,
            quiz.UpdatedAt);
    }

    private static List<string> DeserializeStringList(string json)
    {
        try { return JsonSerializer.Deserialize<List<string>>(json, JsonOptions) ?? []; }
        catch (JsonException) { return []; }
    }

    private static List<OptionResponse> DeserializeOptions(string json)
    {
        try { return JsonSerializer.Deserialize<List<OptionResponse>>(json, JsonOptions) ?? []; }
        catch (JsonException) { return []; }
    }

    private static QuizSettingsRequest NormalizeSettings(QuizSettingsRequest input)
    {
        var classes = NormalizeAssignments(input.AssignedClasses ?? [], 500, 100, "assignedClasses");
        var emails = NormalizeAssignments(input.AssignedEmails ?? [], 5000, 320, "assignedEmails", normalizeEmail: true);
        return new QuizSettingsRequest
        {
            DurationMinutes = input.DurationMinutes,
            ShuffleQuestions = input.ShuffleQuestions,
            ShuffleOptions = input.ShuffleOptions,
            AllowReview = input.AllowReview,
            MaxAttempts = input.MaxAttempts,
            PassPercentage = input.PassPercentage,
            PracticeEnabled = input.PracticeEnabled,
            AssignedClasses = classes.Values,
            AssignedEmails = emails.Values,
        };
    }

    private static (List<string> Values, string? Error) NormalizeAssignments(
        List<string> source,
        int maxItems,
        int maxLength,
        string field,
        bool normalizeEmail = false)
    {
        if (source.Count > maxItems)
        {
            return ([], $"At most {maxItems} {field} can be assigned.");
        }

        var result = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var rawValue in source)
        {
            if (rawValue is null)
            {
                return ([], $"One or more {field} values are invalid.");
            }

            var value = rawValue.Trim();
            if (value.Length > maxLength || (normalizeEmail && value.Length > 0 && !IsValidEmail(value)))
            {
                return ([], $"One or more {field} values are invalid.");
            }

            if (value.Length == 0) continue;
            if (normalizeEmail) value = value.ToLowerInvariant();
            if (seen.Add(value)) result.Add(value);
        }

        return (result, null);
    }

    private static AuditEvent CreateAudit(string actorUid, string action, string targetType, string targetId, object details) => new()
    {
        Id = Guid.NewGuid(),
        ActorUid = actorUid,
        Action = action,
        TargetType = targetType,
        TargetId = targetId,
        DetailsJson = JsonSerializer.Serialize(details, JsonOptions),
        CreatedAt = DateTimeOffset.UtcNow,
    };

    private static bool HasRole(ClaimsPrincipal principal, string role) =>
        principal.FindAll("qizzone:role").Any(claim => claim.Value == role);

    private static bool ValidMediaReference(string value, string ownerUid)
    {
        const string prefix = "storage://qizzone-question-media/";
        if (value.Length > 512 || !value.StartsWith(prefix, StringComparison.Ordinal) || value.Contains("..", StringComparison.Ordinal) ||
            value.Contains('\\') || value.Contains('%') || value.Contains('?') || value.Contains('#') || value.Any(char.IsControl))
        {
            return false;
        }

        var pathParts = value[prefix.Length..].Split('/', StringSplitOptions.None);
        return pathParts.Length >= 2 &&
            pathParts[0] == ownerUid &&
            pathParts.All(part => part.Length > 0 && part is not ("." or ".."));
    }

    private static bool IsValidEmail(string value)
    {
        try
        {
            var parsed = new MailAddress(value);
            return string.Equals(parsed.Address, value, StringComparison.OrdinalIgnoreCase);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static string NewRoomCode()
    {
        const string alphabet = "0123456789ABCDEF";
        Span<char> code = stackalloc char[6];
        for (var index = 0; index < code.Length; index++)
        {
            code[index] = alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];
        }

        return new string(code);
    }

    public sealed class QuizWriteRequest
    {
        public string Title { get; init; } = "";
        public string Subject { get; init; } = "";
        public string? Description { get; init; }
        public string? Status { get; init; }
        public string? LegacyId { get; init; }
        public QuizSettingsRequest? Settings { get; init; } = new();
        public List<QuestionWriteRequest>? Questions { get; init; } = [];
    }

    public sealed class QuizSettingsRequest
    {
        public int DurationMinutes { get; init; } = 60;
        public bool ShuffleQuestions { get; init; }
        public bool ShuffleOptions { get; init; }
        public bool AllowReview { get; init; }
        public int MaxAttempts { get; init; } = 1;
        public decimal PassPercentage { get; init; } = 50;
        public bool PracticeEnabled { get; init; } = true;
        public List<string>? AssignedClasses { get; init; } = [];
        public List<string>? AssignedEmails { get; init; } = [];
    }

    public sealed class QuestionWriteRequest
    {
        public string? Id { get; init; }
        public string Content { get; init; } = "";
        public List<string>? Images { get; init; } = [];
        public string Type { get; init; } = "single_choice";
        public List<OptionWriteRequest>? Options { get; init; } = [];
        public List<string>? CorrectAnswers { get; init; } = [];
        public string? Explanation { get; init; }
        public decimal Points { get; init; } = 1;
    }

    public sealed class OptionWriteRequest
    {
        public string Id { get; init; } = "";
        public string Content { get; init; } = "";
        public List<string>? Images { get; init; } = [];
    }

    public sealed class QuizAssignmentsRequest
    {
        public List<string>? AssignedClasses { get; init; } = [];
        public List<string>? AssignedEmails { get; init; } = [];
    }

    public sealed record QuizStatusRequest(string? Status);

    public sealed record QuizResponse(
        string Id,
        string Title,
        string Subject,
        string Description,
        string TeacherId,
        string? TeacherName,
        string Code,
        string Status,
        JsonElement Settings,
        List<QuestionResponse> Questions,
        int TotalQuestions,
        decimal TotalPoints,
        DateTimeOffset CreatedAt,
        DateTimeOffset UpdatedAt);

    public sealed record QuestionResponse(
        string Id,
        int Order,
        string Content,
        List<string> Images,
        string Type,
        List<OptionResponse> Options,
        List<string> CorrectAnswers,
        string? Explanation,
        decimal Points);

    public sealed record OptionResponse(string Id, string Content, List<string> Images);
}
