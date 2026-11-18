using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Qizzone.Api.Data;

namespace Qizzone.Api.Features;

public sealed class ExamAttemptGateStore
{
    private readonly object _sync = new();
    private readonly Dictionary<Guid, AttemptGateEntry> _gates = [];

    private sealed class AttemptGateEntry
    {
        public readonly SemaphoreSlim Semaphore = new(1, 1);
        public int References;
    }

    private sealed class AttemptGateLease(ExamAttemptGateStore owner, Guid attemptId, AttemptGateEntry entry) : IDisposable
    {
        private AttemptGateEntry? _entry = entry;

        public void Dispose()
        {
            var heldEntry = Interlocked.Exchange(ref _entry, null);
            if (heldEntry is not null) owner.Release(attemptId, heldEntry, acquired: true);
        }
    }

    internal async Task<IDisposable> AcquireAsync(Guid attemptId, CancellationToken cancellationToken)
    {
        AttemptGateEntry entry;
        lock (_sync)
        {
            if (!_gates.TryGetValue(attemptId, out entry!))
            {
                entry = new AttemptGateEntry();
                _gates.Add(attemptId, entry);
            }
            entry.References++;
        }

        try
        {
            await entry.Semaphore.WaitAsync(cancellationToken);
            return new AttemptGateLease(this, attemptId, entry);
        }
        catch
        {
            Release(attemptId, entry, acquired: false);
            throw;
        }
    }

    private void Release(Guid attemptId, AttemptGateEntry entry, bool acquired)
    {
        if (acquired) entry.Semaphore.Release();
        lock (_sync)
        {
            entry.References--;
            if (entry.References == 0 && _gates.Remove(attemptId)) entry.Semaphore.Dispose();
        }
    }
}

public static class ExamEndpoints
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static IEndpointRouteBuilder MapExamEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/exam-attempts")
            .WithTags("Exams");

        group.MapPost("/quizzes/{quizId:guid}", StartAsync).RequireAuthorization("Student");
        group.MapGet("/", ListActiveAsync).RequireAuthorization("Student");
        group.MapGet("/results", ListResultsAsync).RequireAuthorization("ActiveUser");
        group.MapPost("/finalize-expired", FinalizeExpiredAsync).RequireAuthorization("Student");
        group.MapGet("/{id:guid}", GetAsync).RequireAuthorization("Student");
        group.MapPut("/{id:guid}/autosave", AutosaveAsync).RequireAuthorization("Student");
        group.MapPost("/{id:guid}/submit", SubmitAsync).RequireAuthorization("Student");

        return endpoints;
    }

    private static async Task<IResult> StartAsync(
        Guid quizId,
        StartAttemptRequest? request,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var uid = principal.FindFirst("firebase:uid")!.Value;
        var profile = await db.Profiles.AsNoTracking()
            .SingleOrDefaultAsync(item => item.FirebaseUid == uid, cancellationToken);
        if (profile is null)
        {
            return Results.Forbid();
        }

        var quiz = await db.Quizzes.AsNoTracking()
            .Include(item => item.Questions)
            .ThenInclude(item => item.AnswerKey)
            .SingleOrDefaultAsync(item => item.Id == quizId, cancellationToken);
        if (quiz is null)
        {
            return Results.NotFound();
        }

        if (quiz.Status != "published")
        {
            return Results.Conflict(new { error = "This quiz is not open for exams." });
        }

        var activeAttempt = await db.ExamAttempts.AsNoTracking()
            .Include(item => item.Answers)
            .SingleOrDefaultAsync(item => item.QuizId == quizId && item.StudentUid == uid && item.SubmittedAt == null, cancellationToken);
        if (activeAttempt is not null)
        {
            return Results.Ok(ToAttemptResponse(activeAttempt, quiz));
        }

        if (quiz.Questions.Count == 0)
        {
            return Results.Conflict(new { error = "This quiz does not contain any questions." });
        }

        if ((request?.StudentClass?.Length ?? 0) > 100)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["studentClass"] = ["Class name cannot exceed 100 characters."],
            });
        }

        var settings = ReadSettings(quiz.SettingsJson);
        var completedAttempts = await db.ExamAttempts.CountAsync(item =>
            item.QuizId == quizId && item.StudentUid == uid && item.SubmittedAt != null, cancellationToken);
        if (settings.MaxAttempts > 0 && completedAttempts >= settings.MaxAttempts)
        {
            return Results.Conflict(new { error = "No exam attempts remain for this quiz." });
        }

        var now = DateTimeOffset.UtcNow;
        var orderedQuestions = settings.ShuffleQuestions
            ? quiz.Questions.OrderBy(_ => Random.Shared.Next()).ToArray()
            : quiz.Questions.OrderBy(item => item.Ordinal).ToArray();
        var optionOrders = orderedQuestions.ToDictionary(
            item => item.Id.ToString(),
            item => GetOptionIds(item.OptionsJson, settings.ShuffleOptions));
        var attempt = new ExamAttempt
        {
            Id = Guid.NewGuid(),
            QuizId = quiz.Id,
            StudentUid = uid,
            StudentName = profile.FullName,
            StudentClass = request?.StudentClass?.Trim(),
            StartedAt = now,
            EndsAt = settings.DurationMinutes > 0 ? now.AddMinutes(settings.DurationMinutes) : null,
            DurationMinutes = settings.DurationMinutes,
            PassPercentage = settings.PassPercentage,
            AllowReview = settings.AllowReview,
            QuestionOrder = orderedQuestions.Select(item => item.Id).ToArray(),
            OptionOrderJson = JsonSerializer.Serialize(optionOrders, JsonOptions),
            FlaggedIdsJson = "[]",
            CurrentIndex = 0,
            Revision = 0,
            UpdatedAt = now,
        };

        db.ExamAttempts.Add(attempt);
        db.AuditEvents.Add(CreateAudit(uid, "exam.started", quiz.Id.ToString(), new { attemptId = attempt.Id }));
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // A partial unique index allows only one active attempt per student and quiz.
            db.ChangeTracker.Clear();
            var concurrentAttempt = await db.ExamAttempts.AsNoTracking()
                .Include(item => item.Answers)
                .SingleOrDefaultAsync(item => item.QuizId == quizId && item.StudentUid == uid && item.SubmittedAt == null, cancellationToken);
            if (concurrentAttempt is not null)
            {
                return Results.Ok(ToAttemptResponse(concurrentAttempt, quiz));
            }

            return Results.Conflict(new { error = "Unable to start the exam. Please retry." });
        }

        return Results.Created($"/api/v1/exam-attempts/{attempt.Id}", ToAttemptResponse(attempt, quiz));
    }

    private static async Task<IResult> ListActiveAsync(
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var uid = principal.FindFirst("firebase:uid")!.Value;
        var attempts = await db.ExamAttempts.AsNoTracking()
            .Include(item => item.Answers)
            .Where(item => item.StudentUid == uid && item.SubmittedAt == null)
            .OrderByDescending(item => item.StartedAt)
            .ToListAsync(cancellationToken);
        var quizIds = attempts.Select(item => item.QuizId).Distinct().ToArray();
        var quizzes = await db.Quizzes.AsNoTracking()
            .Include(item => item.Questions)
            .Where(item => quizIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, cancellationToken);

        return Results.Ok(attempts
            .Where(item => quizzes.ContainsKey(item.QuizId))
            .Select(item => ToAttemptResponse(item, quizzes[item.QuizId])));
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var uid = principal.FindFirst("firebase:uid")!.Value;
        var attempt = await db.ExamAttempts.AsNoTracking()
            .Include(item => item.Answers)
            .SingleOrDefaultAsync(item => item.Id == id && item.StudentUid == uid, cancellationToken);
        if (attempt is null)
        {
            return Results.NotFound();
        }

        var quiz = await db.Quizzes.AsNoTracking()
            .Include(item => item.Questions)
            .SingleOrDefaultAsync(item => item.Id == attempt.QuizId, cancellationToken);
        return quiz is null ? Results.NotFound() : Results.Ok(ToAttemptResponse(attempt, quiz));
    }

    private static async Task<IResult> AutosaveAsync(
        Guid id,
        HttpRequest httpRequest,
        AutosaveRequest request,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        using var attemptGate = await AcquireAttemptGateAsync(id, cancellationToken);
        return await AutosaveLockedAsync(id, httpRequest, request, principal, db, cancellationToken);
    }

    private static async Task<IResult> AutosaveLockedAsync(
        Guid id,
        HttpRequest httpRequest,
        AutosaveRequest request,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var uid = principal.FindFirst("firebase:uid")!.Value;
        var attempt = await db.ExamAttempts
            .Include(item => item.Answers)
            .SingleOrDefaultAsync(item => item.Id == id && item.StudentUid == uid, cancellationToken);
        if (attempt is null)
        {
            return Results.NotFound();
        }

        var idempotencyHeader = httpRequest.Headers["Idempotency-Key"].ToString();
        if (request.MutationId == Guid.Empty || request.ClientSequence <= 0 ||
            !Guid.TryParse(request.WriterSessionId, out _) ||
            !Guid.TryParse(idempotencyHeader, out var headerMutationId) || headerMutationId != request.MutationId)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["mutationId"] = ["A matching Idempotency-Key, mutation ID, writer session ID and positive client sequence are required."],
            });
        }

        var requestFingerprint = FingerprintAutosaveRequest(request);
        var existingMutation = await db.ExamAttemptMutations.AsNoTracking()
            .SingleOrDefaultAsync(item => item.AttemptId == id && item.MutationId == request.MutationId, cancellationToken);
        if (existingMutation is not null)
        {
            if (!string.Equals(existingMutation.RequestFingerprint, requestFingerprint, StringComparison.Ordinal))
            {
                return Results.Conflict(new { error = "This autosave mutation ID was already used for different content." });
            }

            var currentQuiz = await db.Quizzes.AsNoTracking()
                .Include(item => item.Questions)
                .SingleOrDefaultAsync(item => item.Id == attempt.QuizId, cancellationToken);
            return currentQuiz is null
                ? Results.NotFound()
                : Results.Ok(ToAttemptResponse(attempt, currentQuiz) with { MutationId = request.MutationId.ToString() });
        }

        if (attempt.SubmittedAt is not null)
        {
            return Results.Conflict(new { error = "This exam has already been submitted." });
        }

        if (attempt.EndsAt is { } endsAt && DateTimeOffset.UtcNow >= endsAt)
        {
            return Results.Conflict(new { error = "The exam time has ended. Submit the saved answers." });
        }

        if (request.Revision != attempt.Revision)
        {
            return Results.Conflict(new { error = "The attempt changed on another device. Reload before saving." });
        }

        if (request.Answers is null || request.FlaggedQuestionIds is null ||
            request.Answers.Count > attempt.QuestionOrder.Length ||
            request.FlaggedQuestionIds.Count > attempt.QuestionOrder.Length ||
            request.CurrentQuestionIndex < 0 || request.CurrentQuestionIndex >= attempt.QuestionOrder.Length)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["answers"] = ["Autosave state is invalid."],
            });
        }

        var questionIds = attempt.QuestionOrder.ToHashSet();
        var questions = await db.Questions.AsNoTracking()
            .Where(item => item.QuizId == attempt.QuizId && questionIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        var errors = new Dictionary<string, string[]>();
        var normalizedAnswers = new Dictionary<Guid, List<string>>();
        foreach (var (rawQuestionId, rawAnswers) in request.Answers)
        {
            if (!Guid.TryParse(rawQuestionId, out var questionId) || !questionIds.Contains(questionId) ||
                !questions.TryGetValue(questionId, out var question) || rawAnswers is null ||
                rawAnswers.Count > 4 || rawAnswers.Any(answer => string.IsNullOrWhiteSpace(answer)) ||
                rawAnswers.Distinct(StringComparer.Ordinal).Count() != rawAnswers.Count)
            {
                errors[$"answers.{rawQuestionId}"] = ["Answer entry is invalid."];
                continue;
            }

            var options = DeserializeOptions(question.OptionsJson);
            var optionIds = options.Select(option => option.Id).ToHashSet(StringComparer.Ordinal);
            if (rawAnswers.Any(answer => !optionIds.Contains(answer!)) ||
                (question.Type != "multiple_choice" && rawAnswers.Count > 1))
            {
                errors[$"answers.{rawQuestionId}"] = ["Selected options are invalid for this question."];
                continue;
            }

            normalizedAnswers[questionId] = rawAnswers.Select(answer => answer!).ToList();
        }

        var flags = new List<Guid>();
        foreach (var rawId in request.FlaggedQuestionIds)
        {
            if (!Guid.TryParse(rawId, out var flagId) || !questionIds.Contains(flagId))
            {
                errors["flaggedQuestionIds"] = ["Flagged questions must belong to this attempt."];
                break;
            }

            if (!flags.Contains(flagId)) flags.Add(flagId);
        }

        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        db.ExamAnswers.RemoveRange(attempt.Answers);
        attempt.Answers = normalizedAnswers.Select(pair => new ExamAnswer
        {
            AttemptId = attempt.Id,
            QuestionId = pair.Key,
            SelectedAnswersJson = JsonSerializer.Serialize(pair.Value, JsonOptions),
            UpdatedAt = DateTimeOffset.UtcNow,
        }).ToList();
        attempt.FlaggedIdsJson = JsonSerializer.Serialize(flags.Select(item => item.ToString()), JsonOptions);
        attempt.CurrentIndex = request.CurrentQuestionIndex;
        attempt.Revision++;
        attempt.UpdatedAt = DateTimeOffset.UtcNow;
        db.Entry(attempt).Property(item => item.Revision).OriginalValue = request.Revision;
        db.ExamAttemptMutations.Add(new ExamAttemptMutation
        {
            AttemptId = attempt.Id,
            MutationId = request.MutationId,
            ClientSequence = request.ClientSequence,
            WriterSessionId = request.WriterSessionId,
            RequestFingerprint = requestFingerprint,
            ResultRevision = attempt.Revision,
            SavedAt = attempt.UpdatedAt,
        });

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            var committedMutation = await db.ExamAttemptMutations.AsNoTracking()
                .SingleOrDefaultAsync(item => item.AttemptId == id && item.MutationId == request.MutationId, cancellationToken);
            if (committedMutation is not null &&
                string.Equals(committedMutation.RequestFingerprint, requestFingerprint, StringComparison.Ordinal))
            {
                var committedAttempt = await db.ExamAttempts.AsNoTracking()
                    .Include(item => item.Answers)
                    .SingleOrDefaultAsync(item => item.Id == id && item.StudentUid == uid, cancellationToken);
                var committedQuiz = committedAttempt is null ? null : await db.Quizzes.AsNoTracking()
                    .Include(item => item.Questions)
                    .SingleOrDefaultAsync(item => item.Id == committedAttempt.QuizId, cancellationToken);
                return committedAttempt is null || committedQuiz is null
                    ? Results.NotFound()
                    : Results.Ok(ToAttemptResponse(committedAttempt, committedQuiz) with { MutationId = request.MutationId.ToString() });
            }

            return Results.Conflict(new { error = "The attempt changed on another device. Reload before saving." });
        }

        var quiz = await db.Quizzes.AsNoTracking()
            .Include(item => item.Questions)
            .SingleAsync(item => item.Id == attempt.QuizId, cancellationToken);
        return Results.Ok(ToAttemptResponse(attempt, quiz) with { MutationId = request.MutationId.ToString() });
    }

    private static string FingerprintAutosaveRequest(AutosaveRequest request)
    {
        var canonicalPayload = new
        {
            request.Revision,
            Answers = request.Answers?.OrderBy(item => item.Key, StringComparer.Ordinal).ToArray(),
            FlaggedQuestionIds = request.FlaggedQuestionIds?.OrderBy(item => item, StringComparer.Ordinal).ToArray(),
            request.CurrentQuestionIndex,
            request.MutationId,
            request.ClientSequence,
            request.WriterSessionId,
        };
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(canonicalPayload, JsonOptions));
        return Convert.ToHexString(SHA256.HashData(bytes));
    }

    private static async Task<IResult> SubmitAsync(
        Guid id,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        ExamAttemptGateStore gateStore,
        CancellationToken cancellationToken)
    {
        using var attemptGate = await gateStore.AcquireAsync(id, cancellationToken);
        return await SubmitLockedAsync(id, principal, db, cancellationToken);
    }

    private static async Task<IResult> SubmitLockedAsync(
        Guid id,
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var uid = principal.FindFirst("firebase:uid")!.Value;
        var attempt = await db.ExamAttempts
            .Include(item => item.Answers)
            .SingleOrDefaultAsync(item => item.Id == id && item.StudentUid == uid, cancellationToken);
        if (attempt is null)
        {
            return Results.NotFound();
        }

        var existingResult = await db.ExamResults.AsNoTracking()
            .SingleOrDefaultAsync(item => item.AttemptId == id, cancellationToken);
        if (existingResult is not null)
        {
            return Results.Ok(FilterResult(existingResult.PayloadJson, attempt.AllowReview));
        }

        var quiz = await db.Quizzes.AsNoTracking()
            .Include(item => item.Questions)
            .ThenInclude(item => item.AnswerKey)
            .SingleOrDefaultAsync(item => item.Id == attempt.QuizId, cancellationToken);
        if (quiz is null)
        {
            return Results.NotFound();
        }

        var answers = attempt.Answers.ToDictionary(item => item.QuestionId, item => DeserializeStringList(item.SelectedAnswersJson));
        var details = new List<QuestionResult>();
        var answeredCount = 0;
        var correctCount = 0;
        decimal earnedPoints = 0;
        var maximumPoints = quiz.Questions.Sum(item => item.Points);
        foreach (var question in quiz.Questions.OrderBy(item => item.Ordinal))
        {
            var selected = answers.GetValueOrDefault(question.Id, []);
            var correct = DeserializeStringList(question.AnswerKey?.CorrectAnswersJson ?? "[]");
            var isAnswered = selected.Count > 0;
            var isCorrect = isAnswered && selected.Count == correct.Count &&
                selected.ToHashSet(StringComparer.Ordinal).SetEquals(correct);
            if (isAnswered) answeredCount++;
            if (isCorrect)
            {
                correctCount++;
                earnedPoints += question.Points;
            }

            details.Add(new QuestionResult(
                question.Id.ToString(),
                question.Ordinal,
                question.Content,
                DeserializeOptions(question.OptionsJson),
                selected,
                correct,
                isCorrect,
                isCorrect ? question.Points : 0,
                question.Points,
                question.AnswerKey?.Explanation ?? ""));
        }

        var percentage = maximumPoints == 0 ? 0 : Math.Round(earnedPoints / maximumPoints * 100, 2);
        var now = DateTimeOffset.UtcNow;
        var durationEnd = attempt.EndsAt is { } endsAt && endsAt < now ? endsAt : now;
        var resultId = Guid.NewGuid();
        var payload = new ExamResultPayload(
            resultId.ToString(),
            quiz.Id.ToString(),
            quiz.Title,
            quiz.Subject,
            quiz.Code,
            attempt.StudentUid,
            attempt.StudentName,
            attempt.StudentClass,
            quiz.Questions.Count,
            answeredCount,
            correctCount,
            answeredCount - correctCount,
            quiz.Questions.Count - answeredCount,
            maximumPoints == 0 ? 0 : Math.Round(earnedPoints / maximumPoints * 10, 2),
            earnedPoints,
            maximumPoints,
            percentage,
            percentage >= attempt.PassPercentage,
            attempt.PassPercentage,
            percentage >= 90 ? "Xuất sắc" : percentage >= 80 ? "Giỏi" : percentage >= 65 ? "Khá" : percentage >= 50 ? "Trung bình" : "Yếu",
            (long)Math.Max(0, Math.Floor((durationEnd - attempt.StartedAt).TotalSeconds)),
            details,
            now);

        attempt.SubmittedAt = now;
        attempt.UpdatedAt = now;
        var originalRevision = attempt.Revision;
        attempt.Revision++;
        db.Entry(attempt).Property(item => item.Revision).OriginalValue = originalRevision;
        db.ExamResults.Add(new ExamResult
        {
            Id = resultId,
            AttemptId = attempt.Id,
            PayloadJson = JsonSerializer.Serialize(payload, JsonOptions),
            CreatedAt = now,
        });
        db.AuditEvents.Add(CreateAudit(uid, "exam.submitted", quiz.Id.ToString(), new { attemptId = attempt.Id, resultId }));

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            var concurrentResult = await db.ExamResults.AsNoTracking()
                .SingleOrDefaultAsync(item => item.AttemptId == id, cancellationToken);
            return concurrentResult is null
                ? Results.Conflict(new { error = "The attempt changed while it was being submitted." })
                : Results.Ok(FilterResult(concurrentResult.PayloadJson, attempt.AllowReview));
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            var concurrentResult = await db.ExamResults.AsNoTracking()
                .SingleOrDefaultAsync(item => item.AttemptId == id, cancellationToken);
            return concurrentResult is null
                ? Results.Conflict(new { error = "The attempt could not be submitted. Retry using the saved attempt." })
                : Results.Ok(FilterResult(concurrentResult.PayloadJson, attempt.AllowReview));
        }

        return Results.Ok(FilterResult(JsonSerializer.Serialize(payload, JsonOptions), attempt.AllowReview));
    }

    private static async Task<IResult> ListResultsAsync(
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var uid = principal.FindFirst("firebase:uid")!.Value;
        var isAdmin = principal.HasClaim("qizzone:role", "admin");
        var results = await (from result in db.ExamResults.AsNoTracking()
                             join attempt in db.ExamAttempts.AsNoTracking() on result.AttemptId equals attempt.Id
                             join quiz in db.Quizzes.AsNoTracking() on attempt.QuizId equals quiz.Id
                             where attempt.StudentUid == uid || isAdmin || quiz.TeacherUid == uid
                             orderby result.CreatedAt descending
                             select new
                             {
                                 result.PayloadJson,
                                 CanReview = attempt.AllowReview || isAdmin || quiz.TeacherUid == uid,
                             })
            .Take(500)
            .ToListAsync(cancellationToken);

        return Results.Ok(results.Select(item => FilterResult(item.PayloadJson, item.CanReview)));
    }

    private static async Task<IResult> FinalizeExpiredAsync(
        ClaimsPrincipal principal,
        QizzoneDbContext db,
        CancellationToken cancellationToken)
    {
        var uid = principal.FindFirst("firebase:uid")!.Value;
        var now = DateTimeOffset.UtcNow;
        var expiredIds = await db.ExamAttempts.AsNoTracking()
            .Where(item => item.StudentUid == uid && item.SubmittedAt == null && item.EndsAt != null && item.EndsAt <= now)
            .Select(item => item.Id)
            .ToListAsync(cancellationToken);
        foreach (var attemptId in expiredIds)
        {
            await SubmitAsync(attemptId, principal, db, cancellationToken);
        }

        return Results.Ok(new { finalized = expiredIds.Count });
    }

    private static ExamAttemptResponse ToAttemptResponse(ExamAttempt attempt, Quiz quiz)
    {
        var questionById = quiz.Questions.ToDictionary(item => item.Id);
        var optionOrder = DeserializeOptionOrder(attempt.OptionOrderJson);
        var answers = attempt.Answers.ToDictionary(
            item => item.QuestionId.ToString(),
            item => DeserializeStringList(item.SelectedAnswersJson));
        var questions = attempt.QuestionOrder
            .Select((id, index) => (id, index))
            .Where(pair => questionById.ContainsKey(pair.id))
            .Select(pair =>
            {
                var question = questionById[pair.id];
                var options = DeserializeOptions(question.OptionsJson);
                if (optionOrder.TryGetValue(question.Id.ToString(), out var order))
                {
                    var byId = options.ToDictionary(item => item.Id, StringComparer.Ordinal);
                    options = order.Where(byId.ContainsKey).Select(optionId => byId[optionId]).ToList();
                }

                return new ExamQuestionResponse(
                    question.Id.ToString(), pair.index, question.Content,
                    DeserializeStringList(question.ImagesJson), question.Type, options, question.Points);
            })
            .ToList();

        return new ExamAttemptResponse(
            attempt.Id.ToString(), attempt.QuizId.ToString(), quiz.Title, quiz.Subject,
            attempt.StudentUid, attempt.StudentName, attempt.StudentClass,
            attempt.StartedAt, attempt.EndsAt, attempt.DurationMinutes,
            answers, DeserializeStringList(attempt.FlaggedIdsJson), attempt.CurrentIndex,
            attempt.Revision, attempt.SubmittedAt is not null, attempt.UpdatedAt, questions);
    }

    private static JsonObject FilterResult(string json, bool allowReview)
    {
        var result = JsonNode.Parse(json)?.AsObject() ?? new JsonObject();
        if (!allowReview)
        {
            result["details"] = new JsonArray();
        }

        return result;
    }

    private static QuizSettings ReadSettings(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            return new QuizSettings(
                ReadInt(root, "durationMinutes", 60),
                ReadInt(root, "maxAttempts", 1),
                ReadDecimal(root, "passPercentage", 50),
                ReadBool(root, "allowReview"),
                ReadBool(root, "shuffleQuestions"),
                ReadBool(root, "shuffleOptions"));
        }
        catch (JsonException)
        {
            return new QuizSettings(60, 1, 50, false, false, false);
        }
    }

    private static int ReadInt(JsonElement root, string name, int fallback) =>
        root.TryGetProperty(name, out var value) && value.TryGetInt32(out var parsed) ? parsed : fallback;

    private static decimal ReadDecimal(JsonElement root, string name, decimal fallback) =>
        root.TryGetProperty(name, out var value) && value.TryGetDecimal(out var parsed) ? parsed : fallback;

    private static bool ReadBool(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;

    private static List<string> GetOptionIds(string json, bool shuffle)
    {
        var options = DeserializeOptions(json).Select(item => item.Id).ToList();
        return shuffle ? options.OrderBy(_ => Random.Shared.Next()).ToList() : options;
    }

    private static Dictionary<string, List<string>> DeserializeOptionOrder(string json)
    {
        try { return JsonSerializer.Deserialize<Dictionary<string, List<string>>>(json, JsonOptions) ?? []; }
        catch (JsonException) { return []; }
    }

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

    private static AuditEvent CreateAudit(string actorUid, string action, string quizId, object details) => new()
    {
        Id = Guid.NewGuid(),
        ActorUid = actorUid,
        Action = action,
        TargetType = "quiz",
        TargetId = quizId,
        DetailsJson = JsonSerializer.Serialize(details, JsonOptions),
        CreatedAt = DateTimeOffset.UtcNow,
    };

    public sealed class AutosaveRequest
    {
        public int Revision { get; init; }
        public Dictionary<string, List<string?>?>? Answers { get; init; }
        public List<string>? FlaggedQuestionIds { get; init; }
        public int CurrentQuestionIndex { get; init; }
        public Guid MutationId { get; init; }
        public int ClientSequence { get; init; }
        public string WriterSessionId { get; init; } = "";
    }

    public sealed class StartAttemptRequest
    {
        public string? StudentClass { get; init; }
    }

    private sealed record QuizSettings(
        int DurationMinutes,
        int MaxAttempts,
        decimal PassPercentage,
        bool AllowReview,
        bool ShuffleQuestions,
        bool ShuffleOptions);

    private sealed record ExamQuestionResponse(
        string Id,
        int Order,
        string Content,
        List<string> Images,
        string Type,
        List<QuizEndpoints.OptionResponse> Options,
        decimal Points);

    private sealed record ExamAttemptResponse(
        string Id,
        string QuizId,
        string QuizTitle,
        string Subject,
        string StudentId,
        string StudentName,
        string? StudentClass,
        DateTimeOffset StartedAt,
        DateTimeOffset? EndsAt,
        int DurationMinutes,
        Dictionary<string, List<string>> Answers,
        List<string> FlaggedQuestionIds,
        int CurrentQuestionIndex,
        int Revision,
        bool IsSubmitted,
        DateTimeOffset LastSavedAt,
        List<ExamQuestionResponse> Questions,
        string? MutationId = null);

    private sealed record QuestionResult(
        string QuestionId,
        int Order,
        string Content,
        List<QuizEndpoints.OptionResponse> Options,
        List<string> SelectedAnswers,
        List<string> CorrectAnswers,
        bool IsCorrect,
        decimal PointsEarned,
        decimal MaxPoints,
        string Explanation);

    private sealed record ExamResultPayload(
        string Id,
        string QuizId,
        string QuizTitle,
        string Subject,
        string RoomCode,
        string StudentId,
        string StudentName,
        string? StudentClass,
        int TotalQuestions,
        int AnsweredCount,
        int CorrectCount,
        int IncorrectCount,
        int SkippedCount,
        decimal Score,
        decimal TotalPointsEarned,
        decimal MaxTotalPoints,
        decimal Percentage,
        bool IsPassed,
        decimal PassPercentage,
        string AcademicRank,
        long TimeSpentSeconds,
        List<QuestionResult> Details,
        DateTimeOffset SubmittedAt);
}
