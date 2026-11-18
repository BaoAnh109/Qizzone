namespace Qizzone.Api.Data;

public sealed class Profile
{
    public required string FirebaseUid { get; set; }
    public required string Email { get; set; }
    public required string FullName { get; set; }
    public string Role { get; set; } = "student";
    public string ActiveRole { get; set; } = "student";
    public string ApprovalStatus { get; set; } = "approved";
    public DateTimeOffset? ApprovalRequestedAt { get; set; }
    public DateTimeOffset? ReviewedAt { get; set; }
    public string? ReviewedBy { get; set; }
    public string TeacherRequestStatus { get; set; } = "none";
    public bool TeacherRequestBlocked { get; set; }
    public DateTimeOffset? TeacherRequestedAt { get; set; }
    public DateTimeOffset? TeacherReviewedAt { get; set; }
    public string? TeacherReviewedBy { get; set; }
    public string? AvatarUrl { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class Quiz
{
    public Guid Id { get; set; }
    public required string TeacherUid { get; set; }
    public required string Title { get; set; }
    public required string Subject { get; set; }
    public string Description { get; set; } = "";
    public required string Code { get; set; }
    public string Status { get; set; } = "draft";
    public string SettingsJson { get; set; } = "{}";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public string? LegacyId { get; set; }
    public List<Question> Questions { get; set; } = [];
}

public sealed class Question
{
    public Guid Id { get; set; }
    public Guid QuizId { get; set; }
    public int Ordinal { get; set; }
    public required string Content { get; set; }
    public string ImagesJson { get; set; } = "[]";
    public required string Type { get; set; }
    public string OptionsJson { get; set; } = "[]";
    public decimal Points { get; set; }
    public string? LegacyId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public Quiz? Quiz { get; set; }
    public QuestionAnswerKey? AnswerKey { get; set; }
}

public sealed class QuestionAnswerKey
{
    public Guid QuestionId { get; set; }
    public string CorrectAnswersJson { get; set; } = "[]";
    public string Explanation { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public Question? Question { get; set; }
}

public sealed class ExamAttempt
{
    public Guid Id { get; set; }
    public Guid QuizId { get; set; }
    public required string StudentUid { get; set; }
    public required string StudentName { get; set; }
    public string? StudentClass { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? EndsAt { get; set; }
    public DateTimeOffset? SubmittedAt { get; set; }
    public int DurationMinutes { get; set; }
    public decimal PassPercentage { get; set; }
    public bool AllowReview { get; set; }
    public Guid[] QuestionOrder { get; set; } = [];
    public string OptionOrderJson { get; set; } = "{}";
    public string FlaggedIdsJson { get; set; } = "[]";
    public int CurrentIndex { get; set; }
    public int Revision { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public string? LegacyId { get; set; }
    public List<ExamAnswer> Answers { get; set; } = [];
}

public sealed class ExamAnswer
{
    public Guid AttemptId { get; set; }
    public Guid QuestionId { get; set; }
    public string SelectedAnswersJson { get; set; } = "[]";
    public DateTimeOffset UpdatedAt { get; set; }
    public ExamAttempt? Attempt { get; set; }
}

public sealed class ExamResult
{
    public Guid Id { get; set; }
    public Guid AttemptId { get; set; }
    public string PayloadJson { get; set; } = "{}";
    public DateTimeOffset CreatedAt { get; set; }
    public decimal? Score { get; private set; }
    public decimal? Percentage { get; private set; }
    public bool? IsPassed { get; private set; }
}

public sealed class ExamAttemptMutation
{
    public Guid AttemptId { get; set; }
    public Guid MutationId { get; set; }
    public int ClientSequence { get; set; }
    public required string WriterSessionId { get; set; }
    public required string RequestFingerprint { get; set; }
    public int ResultRevision { get; set; }
    public DateTimeOffset SavedAt { get; set; }
}

public sealed class PracticeSession
{
    public Guid Id { get; set; }
    public Guid QuizId { get; set; }
    public required string QuizTitle { get; set; }
    public required string Subject { get; set; }
    public required string StudentUid { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? FinishedAt { get; set; }
    public string Status { get; set; } = "in_progress";
    public string? FailureMessage { get; set; }
    public DateTimeOffset QuizUpdatedAt { get; set; }
    public Guid[] QuestionOrder { get; set; } = [];
    public string OptionOrderJson { get; set; } = "{}";
    public bool ShowExplanation { get; set; }
    public int AnswerCount { get; set; }
    public string? ResultJson { get; set; }
    public List<PracticeAnswer> Answers { get; set; } = [];
}

public sealed class PracticeAnswer
{
    public Guid SessionId { get; set; }
    public Guid QuestionId { get; set; }
    public string SelectedAnswersJson { get; set; } = "[]";
    public bool IsCorrect { get; set; }
    public string CorrectAnswersJson { get; set; } = "[]";
    public string Explanation { get; set; } = "";
    public DateTimeOffset CheckedAt { get; set; }
}

public sealed class DataMigration
{
    public required string FirebaseUid { get; set; }
    public required string SourceId { get; set; }
    public int Version { get; set; } = 1;
    public string Status { get; set; } = "partial";
    public string ReportJson { get; set; } = "{}";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class AiImportJob
{
    public Guid Id { get; set; }
    public required string OwnerUid { get; set; }
    public required string SourceFileName { get; set; }
    public string? IdempotencyKey { get; set; }
    public string? RequestFingerprint { get; set; }
    public string Status { get; set; } = "queued";
    public int AttemptCount { get; set; }
    public string RequestJson { get; set; } = "{}";
    public string? ResultJson { get; set; }
    public string? ErrorCode { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? LeaseUntil { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}

public sealed class OutboxMessage
{
    public Guid Id { get; set; }
    public required string Kind { get; set; }
    public required string PayloadJson { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ProcessedAt { get; set; }
    public int AttemptCount { get; set; }
}

public sealed class AiRateLimit
{
    public required string FirebaseUid { get; set; }
    public DateTimeOffset WindowStartedAt { get; set; }
    public int Requests { get; set; }
}

public sealed class AuditEvent
{
    public Guid Id { get; set; }
    public required string ActorUid { get; set; }
    public required string Action { get; set; }
    public required string TargetType { get; set; }
    public string? TargetId { get; set; }
    public string DetailsJson { get; set; } = "{}";
    public DateTimeOffset CreatedAt { get; set; }
}
