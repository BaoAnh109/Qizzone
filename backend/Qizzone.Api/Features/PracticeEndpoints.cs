using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Qizzone.Api.Data;

namespace Qizzone.Api.Features;

public static class PracticeEndpoints
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static IEndpointRouteBuilder MapPracticeEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/practice-sessions")
            .WithTags("Practice")
            .RequireAuthorization("Student");

        group.MapPost("/", StartAsync);
        group.MapGet("/history", ListHistoryAsync);
        group.MapPost("/{id:guid}/retry", RetryAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPost("/{id:guid}/answers/{questionId:guid}", CheckAnswerAsync);
        group.MapPost("/{id:guid}/finish", FinishAsync);
        return endpoints;
    }

    private static async Task<IResult> StartAsync(
        StartPracticeRequest request,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        if (request.QuestionCount is < 1 or > 1000)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["questionCount"] = ["Question count must be null or between 1 and 1000."],
            });
        }

        var uid = principal.FindFirst("firebase:uid")!.Value;
        var profile = await db.Profiles.AsNoTracking()
            .SingleOrDefaultAsync(item => item.FirebaseUid == uid, cancellationToken);
        if (profile is null)
        {
            return Results.Forbid();
        }

        var quiz = await db.Quizzes.AsNoTracking()
            .Include(item => item.Questions)
            .SingleOrDefaultAsync(item => item.Id == request.QuizId, cancellationToken);
        if (quiz is null || quiz.Status != "published")
        {
            return Results.NotFound();
        }

        var settings = ReadSettings(quiz.SettingsJson);
        if (!settings.PracticeEnabled || quiz.Questions.Count == 0)
        {
            return Results.Conflict(new { error = "Practice is not enabled for this quiz." });
        }

        if (request.QuestionCount is { } count && count > quiz.Questions.Count)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["questionCount"] = ["Question count exceeds the number of questions in this quiz."],
            });
        }

        var selection = quiz.Questions.OrderBy(_ => Random.Shared.Next());
        if (request.QuestionCount is { } requestedCount)
        {
            selection = selection.Take(requestedCount).OrderBy(_ => Random.Shared.Next());
        }

        var selectedQuestions = selection.ToArray();
        var now = DateTimeOffset.UtcNow;
        var session = new PracticeSession
        {
            Id = Guid.NewGuid(),
            QuizId = quiz.Id,
            QuizTitle = quiz.Title,
            Subject = quiz.Subject,
            StudentUid = uid,
            StartedAt = now,
            Status = "in_progress",
            QuizUpdatedAt = quiz.UpdatedAt,
            QuestionOrder = selectedQuestions.Select(item => item.Id).ToArray(),
            OptionOrderJson = JsonSerializer.Serialize(selectedQuestions.ToDictionary(
                item => item.Id.ToString(),
                item => DeserializeOptions(item.OptionsJson).OrderBy(_ => Random.Shared.Next()).Select(option => option.Id).ToList()), JsonOptions),
            ShowExplanation = request.ShowExplanation,
            AnswerCount = 0,
        };

        db.PracticeSessions.Add(session);
        db.AuditEvents.Add(CreateAudit(uid, "practice.started", session.Id, new { quizId = quiz.Id, questionCount = session.QuestionOrder.Length }));
        await db.SaveChangesAsync(cancellationToken);
        return Results.Created($"/api/v1/practice-sessions/{session.Id}", ToSessionResponse(session));
    }

    private static async Task<IResult> RetryAsync(
        Guid id,
        RetryPracticeRequest request,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        if (request.Mode is not ("wrong" or "all"))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["mode"] = ["Mode must be wrong or all."],
            });
        }

        var uid = principal.FindFirst("firebase:uid")!.Value;
        var source = await db.PracticeSessions.AsNoTracking()
            .Include(item => item.Answers)
            .SingleOrDefaultAsync(item => item.Id == id && item.StudentUid == uid, cancellationToken);
        if (source is null)
        {
            return Results.NotFound();
        }

        if (source.Status != "completed")
        {
            return Results.Conflict(new { error = "Finish the practice session before starting a retry." });
        }

        var selectedIds = request.Mode == "wrong"
            ? source.Answers.Where(item => !item.IsCorrect).Select(item => item.QuestionId).ToArray()
            : source.QuestionOrder;
        if (selectedIds.Length == 0)
        {
            return Results.Conflict(new { error = "There are no incorrect answers to retry." });
        }

        var quiz = await db.Quizzes.AsNoTracking()
            .Include(item => item.Questions)
            .SingleOrDefaultAsync(item => item.Id == source.QuizId, cancellationToken);
        if (quiz is null || quiz.UpdatedAt != source.QuizUpdatedAt)
        {
            return Results.Conflict(new { error = "This quiz changed after the practice session. Start a new practice session." });
        }

        var questionsById = quiz.Questions.ToDictionary(item => item.Id);
        var orderedQuestions = selectedIds.Where(questionsById.ContainsKey).Select(id => questionsById[id]).ToArray();
        if (orderedQuestions.Length == 0)
        {
            return Results.Conflict(new { error = "The selected questions are no longer available." });
        }

        var now = DateTimeOffset.UtcNow;
        var session = new PracticeSession
        {
            Id = Guid.NewGuid(),
            QuizId = quiz.Id,
            QuizTitle = quiz.Title,
            Subject = quiz.Subject,
            StudentUid = uid,
            StartedAt = now,
            Status = "in_progress",
            QuizUpdatedAt = quiz.UpdatedAt,
            QuestionOrder = orderedQuestions.Select(item => item.Id).ToArray(),
            OptionOrderJson = JsonSerializer.Serialize(orderedQuestions.ToDictionary(
                item => item.Id.ToString(),
                item => DeserializeOptions(item.OptionsJson).OrderBy(_ => Random.Shared.Next()).Select(option => option.Id).ToList()), JsonOptions),
            ShowExplanation = source.ShowExplanation,
        };

        db.PracticeSessions.Add(session);
        db.AuditEvents.Add(CreateAudit(uid, "practice.retried", session.Id, new { sourceSessionId = source.Id, mode = request.Mode }));
        await db.SaveChangesAsync(cancellationToken);
        return Results.Created($"/api/v1/practice-sessions/{session.Id}", ToSessionResponse(session));
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var uid = principal.FindFirst("firebase:uid")!.Value;
        var session = await db.PracticeSessions.AsNoTracking()
            .Include(item => item.Answers)
            .SingleOrDefaultAsync(item => item.Id == id && item.StudentUid == uid, cancellationToken);
        if (session is null)
        {
            return Results.NotFound();
        }

        if (session.Status == "completed")
        {
            return Results.Ok(new { status = "completed" });
        }

        if (session.Status == "invalidated")
        {
            return Results.Ok(new { status = "invalidated", message = session.FailureMessage });
        }

        var quiz = await db.Quizzes.AsNoTracking()
            .Include(item => item.Questions)
            .SingleOrDefaultAsync(item => item.Id == session.QuizId, cancellationToken);
        if (quiz is null || quiz.UpdatedAt != session.QuizUpdatedAt)
        {
            return Results.Ok(new { status = "invalidated", message = "The quiz changed during this practice session." });
        }

        return Results.Ok(ToSessionResponse(session) with
        {
            Answers = session.Answers.OrderBy(item => item.CheckedAt).Select(item => (object)ToPracticeAnswer(item)).ToArray(),
            Questions = BuildQuestions(session, quiz),
        });
    }

    private static async Task<IResult> CheckAnswerAsync(
        Guid id,
        Guid questionId,
        CheckPracticeAnswerRequest request,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var uid = principal.FindFirst("firebase:uid")!.Value;
        var session = await db.PracticeSessions
            .Include(item => item.Answers)
            .SingleOrDefaultAsync(item => item.Id == id && item.StudentUid == uid, cancellationToken);
        if (session is null)
        {
            return Results.NotFound();
        }

        if (session.Status != "in_progress")
        {
            return Results.Conflict(new { error = "This practice session is not in progress." });
        }

        if (session.Answers.SingleOrDefault(item => item.QuestionId == questionId) is { } existingAnswer)
        {
            return Results.Ok(ToPracticeAnswer(existingAnswer));
        }

        if (!session.QuestionOrder.Contains(questionId) || request.SelectedAnswers is null ||
            request.SelectedAnswers.Count is < 1 or > 5 ||
            request.SelectedAnswers.Any(answer => string.IsNullOrWhiteSpace(answer)) ||
            request.SelectedAnswers.Distinct(StringComparer.Ordinal).Count() != request.SelectedAnswers.Count)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["selectedAnswers"] = ["Selected answers are invalid."],
            });
        }

        var question = await db.Questions.AsNoTracking()
            .Include(item => item.AnswerKey)
            .SingleOrDefaultAsync(item => item.Id == questionId && item.QuizId == session.QuizId, cancellationToken);
        if (question is null || question.AnswerKey is null)
        {
            return Results.NotFound();
        }

        var options = DeserializeOptions(question.OptionsJson);
        var optionIds = options.Select(item => item.Id).ToHashSet(StringComparer.Ordinal);
        if (request.SelectedAnswers.Any(answer => answer is null || !optionIds.Contains(answer)) ||
            (question.Type != "multiple_choice" && request.SelectedAnswers.Count != 1))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["selectedAnswers"] = ["Selected answers do not match this question."],
            });
        }

        var correctAnswers = DeserializeStringList(question.AnswerKey.CorrectAnswersJson);
        var isCorrect = request.SelectedAnswers.Count == correctAnswers.Count &&
            request.SelectedAnswers.ToHashSet(StringComparer.Ordinal).SetEquals(correctAnswers);
        var answer = new PracticeAnswer
        {
            SessionId = session.Id,
            QuestionId = question.Id,
            SelectedAnswersJson = JsonSerializer.Serialize(request.SelectedAnswers, JsonOptions),
            IsCorrect = isCorrect,
            CorrectAnswersJson = JsonSerializer.Serialize(correctAnswers, JsonOptions),
            Explanation = session.ShowExplanation ? question.AnswerKey.Explanation : "",
            CheckedAt = DateTimeOffset.UtcNow,
        };
        db.PracticeAnswers.Add(answer);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // The session/question primary key makes concurrent retries idempotent.
            db.ChangeTracker.Clear();
            var savedAnswer = await db.PracticeAnswers.AsNoTracking()
                .SingleOrDefaultAsync(item => item.SessionId == id && item.QuestionId == questionId, cancellationToken);
            if (savedAnswer is not null)
            {
                return Results.Ok(ToPracticeAnswer(savedAnswer));
            }

            throw;
        }
        return Results.Ok(ToPracticeAnswer(answer));
    }

    private static async Task<IResult> FinishAsync(
        Guid id,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var uid = principal.FindFirst("firebase:uid")!.Value;
        var session = await db.PracticeSessions
            .Include(item => item.Answers)
            .SingleOrDefaultAsync(item => item.Id == id && item.StudentUid == uid, cancellationToken);
        if (session is null)
        {
            return Results.NotFound();
        }

        if (session.Status == "completed" && !string.IsNullOrWhiteSpace(session.ResultJson))
        {
            return Results.Ok(JsonSerializer.Deserialize<JsonElement>(session.ResultJson, JsonOptions));
        }

        if (session.Status != "in_progress")
        {
            return Results.Conflict(new { error = "This practice session cannot be finished." });
        }

        var quiz = await db.Quizzes.AsNoTracking()
            .Include(item => item.Questions)
            .ThenInclude(item => item.AnswerKey)
            .SingleOrDefaultAsync(item => item.Id == session.QuizId, cancellationToken);
        if (quiz is null || quiz.UpdatedAt != session.QuizUpdatedAt)
        {
            session.Status = "invalidated";
            session.FailureMessage = "The quiz changed during this practice session.";
            session.FinishedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            return Results.Conflict(new { error = session.FailureMessage });
        }

        var answerById = session.Answers.ToDictionary(item => item.QuestionId);
        var questionsById = quiz.Questions.ToDictionary(item => item.Id);
        var details = session.QuestionOrder
            .Where(questionsById.ContainsKey)
            .Select((questionId, index) =>
            {
                var question = questionsById[questionId];
                var answer = answerById.GetValueOrDefault(questionId);
                var selected = DeserializeStringList(answer?.SelectedAnswersJson ?? "[]");
                var correct = DeserializeStringList(question.AnswerKey?.CorrectAnswersJson ?? "[]");
                var isCorrect = answer?.IsCorrect == true;
                return new PracticeResultDetail(
                    question.Id.ToString(),
                    index + 1,
                    question.Content,
                    DeserializeStringList(question.ImagesJson),
                    question.Type,
                    OrderOptions(question, session),
                    GetOptionOrder(question.Id, session),
                    selected,
                    correct,
                    isCorrect,
                    answer is not null,
                    session.ShowExplanation ? question.AnswerKey?.Explanation ?? "" : "");
            })
            .ToList();
        var checkedCount = session.Answers.Count;
        var correctCount = session.Answers.Count(item => item.IsCorrect);
        var totalQuestions = session.QuestionOrder.Length;
        var now = DateTimeOffset.UtcNow;
        var percentage = checkedCount == 0 ? 0 : Math.Round(correctCount * 100m / totalQuestions, 2);
        var result = new PracticeResultPayload(
            session.Id.ToString(), session.Id.ToString(), session.QuizId.ToString(),
            session.QuizTitle, session.Subject, uid, session.StartedAt, now,
            totalQuestions, checkedCount, correctCount, checkedCount - correctCount,
            totalQuestions - checkedCount, percentage,
            (long)Math.Max(0, Math.Floor((now - session.StartedAt).TotalSeconds)), details);

        session.Status = "completed";
        session.FinishedAt = now;
        session.ResultJson = JsonSerializer.Serialize(result, JsonOptions);
        db.AuditEvents.Add(CreateAudit(uid, "practice.finished", session.Id, new
        {
            totalQuestions,
            checkedCount,
            correctCount,
        }));
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(result);
    }

    private static async Task<IResult> ListHistoryAsync(
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var uid = principal.FindFirst("firebase:uid")!.Value;
        var sessions = await db.PracticeSessions.AsNoTracking()
            .Where(item => item.StudentUid == uid)
            .OrderByDescending(item => item.StartedAt)
            .Take(500)
            .ToListAsync(cancellationToken);
        var sessionIds = sessions.Select(session => session.Id).ToArray();
        var answerCounts = await db.PracticeAnswers.AsNoTracking()
            .Where(item => sessionIds.Contains(item.SessionId))
            .GroupBy(item => item.SessionId)
            .Select(group => new { SessionId = group.Key, Count = group.Count() })
            .ToDictionaryAsync(item => item.SessionId, item => item.Count, cancellationToken);
        var items = sessions.Select(session =>
        {
            var result = ParseResult(session.ResultJson);
            return new PracticeHistoryItem(
                session.Id.ToString(),
                session.Id.ToString(),
                session.QuizId.ToString(),
                session.QuizTitle,
                session.Subject,
                session.StartedAt,
                session.FinishedAt,
                session.Status,
                session.FailureMessage,
                result?.TotalQuestions ?? session.QuestionOrder.Length,
                result?.AnsweredCount ?? answerCounts.GetValueOrDefault(session.Id),
                result?.CorrectCount ?? 0,
                result?.Percentage ?? 0,
                result?.DurationSeconds ?? 0);
        });
        return Results.Ok(items);
    }

    private static PracticeSessionResponse ToSessionResponse(PracticeSession session) => new(
        session.Id.ToString(),
        session.QuizId.ToString(),
        session.QuizTitle,
        session.Subject,
        session.StudentUid,
        session.StartedAt,
        session.Status,
        session.QuestionOrder.Select(item => item.ToString()).ToArray(),
        DeserializeOptionOrder(session.OptionOrderJson),
        session.ShowExplanation,
        [],
        []);

    private static object[] BuildQuestions(PracticeSession session, Quiz quiz)
    {
        var questionsById = quiz.Questions.ToDictionary(item => item.Id);
        return session.QuestionOrder.Where(questionsById.ContainsKey).Select(id =>
        {
            var question = questionsById[id];
            return (object)new
            {
                id = question.Id,
                question.Content,
                images = DeserializeStringList(question.ImagesJson),
                question.Type,
                options = OrderOptions(question, session),
                question.Points,
            };
        }).ToArray();
    }

    private static PracticeAnswerResponse ToPracticeAnswer(PracticeAnswer answer) => new(
        answer.QuestionId.ToString(),
        DeserializeStringList(answer.SelectedAnswersJson),
        answer.IsCorrect,
        DeserializeStringList(answer.CorrectAnswersJson),
        answer.Explanation,
        answer.CheckedAt);

    private static List<QuizEndpoints.OptionResponse> OrderOptions(Question question, PracticeSession session)
    {
        var options = DeserializeOptions(question.OptionsJson);
        var order = GetOptionOrder(question.Id, session);
        var byId = options.ToDictionary(item => item.Id, StringComparer.Ordinal);
        return order.Where(byId.ContainsKey).Select(id => byId[id]).ToList();
    }

    private static List<string> GetOptionOrder(Guid questionId, PracticeSession session) =>
        DeserializeOptionOrder(session.OptionOrderJson).GetValueOrDefault(questionId.ToString(), []);

    private static List<string> DeserializeStringList(string json)
    {
        try { return JsonSerializer.Deserialize<List<string>>(json, JsonOptions) ?? []; }
        catch (JsonException) { return []; }
    }

    private static List<QuizEndpoints.OptionResponse> DeserializeOptions(string json)
    {
        try { return JsonSerializer.Deserialize<List<QuizEndpoints.OptionResponse>>(json, JsonOptions) ?? []; }
        catch (JsonException) { return []; }
    }

    private static Dictionary<string, List<string>> DeserializeOptionOrder(string json)
    {
        try { return JsonSerializer.Deserialize<Dictionary<string, List<string>>>(json, JsonOptions) ?? []; }
        catch (JsonException) { return []; }
    }

    private static PracticeSettings ReadSettings(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var practiceEnabled = !doc.RootElement.TryGetProperty("practiceEnabled", out var enabled) || enabled.ValueKind != JsonValueKind.False;
            return new PracticeSettings(practiceEnabled);
        }
        catch (JsonException)
        {
            return new PracticeSettings(false);
        }
    }

    private static PracticeResultPayload? ParseResult(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<PracticeResultPayload>(json, JsonOptions); }
        catch (JsonException) { return null; }
    }

    private static AuditEvent CreateAudit(string actorUid, string action, Guid sessionId, object details) => new()
    {
        Id = Guid.NewGuid(),
        ActorUid = actorUid,
        Action = action,
        TargetType = "practice_session",
        TargetId = sessionId.ToString(),
        DetailsJson = JsonSerializer.Serialize(details, JsonOptions),
        CreatedAt = DateTimeOffset.UtcNow,
    };

    public sealed class StartPracticeRequest
    {
        public Guid QuizId { get; init; }
        public int? QuestionCount { get; init; }
        public bool ShowExplanation { get; init; } = true;
    }

    public sealed record RetryPracticeRequest(string? Mode);
    public sealed record CheckPracticeAnswerRequest(List<string?>? SelectedAnswers);
    private sealed record PracticeSettings(bool PracticeEnabled);
    private sealed record PracticeSessionResponse(
        string Id,
        string QuizId,
        string QuizTitle,
        string Subject,
        string StudentId,
        DateTimeOffset StartedAt,
        string Status,
        string[] QuestionOrder,
        Dictionary<string, List<string>> OptionOrder,
        bool ShowExplanation,
        object[] Answers,
        object[] Questions);
    private sealed record PracticeAnswerResponse(
        string QuestionId,
        List<string> SelectedAnswers,
        bool IsCorrect,
        List<string> CorrectAnswers,
        string Explanation,
        DateTimeOffset CheckedAt);
    private sealed record PracticeResultDetail(
        string QuestionId,
        int Order,
        string Content,
        List<string> Images,
        string Type,
        List<QuizEndpoints.OptionResponse> Options,
        List<string> OptionOrder,
        List<string> SelectedAnswers,
        List<string> CorrectAnswers,
        bool IsCorrect,
        bool Checked,
        string Explanation);
    private sealed record PracticeResultPayload(
        string Id,
        string SessionId,
        string QuizId,
        string QuizTitle,
        string Subject,
        string StudentId,
        DateTimeOffset StartedAt,
        DateTimeOffset FinishedAt,
        int TotalQuestions,
        int AnsweredCount,
        int CorrectCount,
        int IncorrectCount,
        int SkippedCount,
        decimal Percentage,
        long DurationSeconds,
        List<PracticeResultDetail> Details);
    private sealed record PracticeHistoryItem(
        string Id,
        string SessionId,
        string QuizId,
        string QuizTitle,
        string Subject,
        DateTimeOffset StartedAt,
        DateTimeOffset? FinishedAt,
        string Status,
        string? Message,
        int TotalQuestions,
        int AnsweredCount,
        int CorrectCount,
        decimal Percentage,
        long DurationSeconds);
}
