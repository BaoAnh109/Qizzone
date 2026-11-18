using Microsoft.EntityFrameworkCore;

namespace Qizzone.Api.Data;

public sealed class QizzoneDbContext(DbContextOptions<QizzoneDbContext> options) : DbContext(options)
{
    public DbSet<Profile> Profiles => Set<Profile>();
    public DbSet<MediaObject> MediaObjects => Set<MediaObject>();
    public DbSet<Quiz> Quizzes => Set<Quiz>();
    public DbSet<Question> Questions => Set<Question>();
    public DbSet<QuestionAnswerKey> QuestionAnswerKeys => Set<QuestionAnswerKey>();
    public DbSet<ExamAttempt> ExamAttempts => Set<ExamAttempt>();
    public DbSet<ExamAnswer> ExamAnswers => Set<ExamAnswer>();
    public DbSet<ExamResult> ExamResults => Set<ExamResult>();
    public DbSet<ExamAttemptMutation> ExamAttemptMutations => Set<ExamAttemptMutation>();
    public DbSet<PracticeSession> PracticeSessions => Set<PracticeSession>();
    public DbSet<PracticeAnswer> PracticeAnswers => Set<PracticeAnswer>();
    public DbSet<DataMigration> DataMigrations => Set<DataMigration>();
    public DbSet<AiImportJob> AiImportJobs => Set<AiImportJob>();
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();
    public DbSet<AiRateLimit> AiRateLimits => Set<AiRateLimit>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var profile = modelBuilder.Entity<Profile>();
        profile.ToTable("profiles", table =>
        {
            table.HasCheckConstraint("profiles_role_check", "role IN ('student','teacher','admin')");
            table.HasCheckConstraint("profiles_active_role_check", "(role = 'student' AND active_role IN ('student','teacher')) OR (role = 'teacher' AND active_role = 'teacher') OR (role = 'admin' AND active_role = 'admin')");
            table.HasCheckConstraint("profiles_approval_status_check", "approval_status IN ('approved','pending','rejected')");
            table.HasCheckConstraint("profiles_teacher_request_status_check", "teacher_request_status IN ('none','pending','approved','rejected')");
        });
        profile.HasKey(item => item.FirebaseUid);
        profile.Property(item => item.FirebaseUid).HasColumnName("firebase_uid").HasMaxLength(128);
        profile.Property(item => item.Email).HasColumnName("email").HasMaxLength(320).IsRequired();
        profile.HasIndex(item => item.Email).IsUnique();
        profile.Property(item => item.FullName).HasColumnName("full_name").HasMaxLength(100).IsRequired();
        profile.Property(item => item.Role).HasColumnName("role").HasMaxLength(20);
        profile.Property(item => item.ActiveRole).HasColumnName("active_role").HasMaxLength(20).HasDefaultValue("student");
        profile.Property(item => item.ApprovalStatus).HasColumnName("approval_status").HasMaxLength(20);
        profile.Property(item => item.ApprovalRequestedAt).HasColumnName("approval_requested_at");
        profile.Property(item => item.ReviewedAt).HasColumnName("reviewed_at");
        profile.Property(item => item.ReviewedBy).HasColumnName("reviewed_by");
        profile.HasOne<Profile>().WithMany().HasForeignKey(item => item.ReviewedBy).OnDelete(DeleteBehavior.Restrict);
        profile.Property(item => item.TeacherRequestStatus).HasColumnName("teacher_request_status").HasMaxLength(20);
        profile.Property(item => item.TeacherRequestBlocked).HasColumnName("teacher_request_blocked");
        profile.Property(item => item.TeacherRequestedAt).HasColumnName("teacher_requested_at");
        profile.Property(item => item.TeacherReviewedAt).HasColumnName("teacher_reviewed_at");
        profile.Property(item => item.TeacherReviewedBy).HasColumnName("teacher_reviewed_by");
        profile.HasOne<Profile>().WithMany().HasForeignKey(item => item.TeacherReviewedBy).OnDelete(DeleteBehavior.Restrict);
        profile.Property(item => item.AvatarUrl).HasColumnName("avatar_url");
        profile.Property(item => item.StudentClass).HasColumnName("student_class").HasMaxLength(100);
        profile.Property(item => item.CreatedAt).HasColumnName("created_at");
        profile.Property(item => item.UpdatedAt).HasColumnName("updated_at");
        profile.HasIndex(item => new { item.TeacherRequestStatus, item.TeacherRequestedAt })
            .HasDatabaseName("profiles_pending_teacher_request")
            .HasFilter("role = 'student' AND teacher_request_status = 'pending'");
        profile.HasIndex(item => new { item.ApprovalStatus, item.CreatedAt })
            .HasDatabaseName("profiles_pending_teacher")
            .HasFilter("role = 'teacher'");

        var media = modelBuilder.Entity<MediaObject>();
        media.ToTable("media_objects", table =>
        {
            table.HasCheckConstraint("media_objects_content_type_check", "content_type IN ('image/jpeg','image/png','image/webp')");
            table.HasCheckConstraint("media_objects_extension_check", "extension IN ('.jpg','.png','.webp')");
            table.HasCheckConstraint("media_objects_length_check", "length_bytes > 0 AND length_bytes <= 2097152");
        });
        media.HasKey(item => item.Id);
        media.Property(item => item.Id).HasColumnName("id");
        media.Property(item => item.OwnerUid).HasColumnName("owner_uid").HasMaxLength(128).IsRequired();
        media.HasOne<Profile>().WithMany().HasForeignKey(item => item.OwnerUid).OnDelete(DeleteBehavior.Restrict);
        media.Property(item => item.ContentType).HasColumnName("content_type").HasMaxLength(20).IsRequired();
        media.Property(item => item.Extension).HasColumnName("extension").HasMaxLength(8).IsRequired();
        media.Property(item => item.LengthBytes).HasColumnName("length_bytes");
        media.Property(item => item.Sha256).HasColumnName("sha256").HasMaxLength(64).IsRequired();
        media.Property(item => item.CreatedAt).HasColumnName("created_at");
        media.HasIndex(item => new { item.OwnerUid, item.CreatedAt }).HasDatabaseName("media_objects_owner_created");

        var quiz = modelBuilder.Entity<Quiz>();
        quiz.ToTable("quizzes", table =>
        {
            table.HasCheckConstraint("quizzes_status_check", "status IN ('draft','scheduled','published','closed')");
            table.HasCheckConstraint("quizzes_settings_object_check", "jsonb_typeof(settings) = 'object'");
            table.HasCheckConstraint("quizzes_schedule_check", "(status <> 'scheduled' OR opens_at IS NOT NULL) AND (closes_at IS NULL OR opens_at IS NULL OR closes_at > opens_at)");
        });
        quiz.HasKey(item => item.Id);
        quiz.Property(item => item.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
        quiz.Property(item => item.TeacherUid).HasColumnName("teacher_uid").HasMaxLength(128).IsRequired();
        quiz.HasOne<Profile>().WithMany().HasForeignKey(item => item.TeacherUid).OnDelete(DeleteBehavior.Restrict);
        quiz.Property(item => item.Title).HasColumnName("title").HasMaxLength(300).IsRequired();
        quiz.Property(item => item.Subject).HasColumnName("subject").HasMaxLength(100).IsRequired();
        quiz.Property(item => item.Description).HasColumnName("description").HasMaxLength(5000).HasDefaultValue("");
        quiz.Property(item => item.Code).HasColumnName("code").HasMaxLength(6).HasDefaultValueSql("upper(substr(replace(gen_random_uuid()::text,'-',''),1,6))");
        quiz.HasIndex(item => item.Code).IsUnique();
        quiz.Property(item => item.Status).HasColumnName("status").HasMaxLength(20);
        quiz.Property(item => item.OpensAt).HasColumnName("opens_at");
        quiz.Property(item => item.ClosesAt).HasColumnName("closes_at");
        quiz.Property(item => item.SettingsJson).HasColumnName("settings").HasColumnType("jsonb");
        quiz.Property(item => item.CreatedAt).HasColumnName("created_at");
        quiz.Property(item => item.UpdatedAt).HasColumnName("updated_at");
        quiz.Property(item => item.LegacyId).HasColumnName("legacy_id");
        quiz.HasIndex(item => new { item.TeacherUid, item.LegacyId }).IsUnique();
        quiz.HasIndex(item => item.TeacherUid).HasDatabaseName("quizzes_teacher");
        quiz.HasIndex(item => new { item.Status, item.OpensAt }).HasDatabaseName("quizzes_schedule_open");
        quiz.HasIndex(item => new { item.Status, item.ClosesAt }).HasDatabaseName("quizzes_schedule_close");

        var question = modelBuilder.Entity<Question>();
        question.ToTable("questions", table =>
        {
            table.HasCheckConstraint("questions_ordinal_check", "ordinal > 0");
            table.HasCheckConstraint("questions_type_check", "type IN ('single_choice','multiple_choice','true_false')");
            table.HasCheckConstraint("questions_options_array_check", "jsonb_typeof(options) = 'array'");
            table.HasCheckConstraint("questions_images_array_check", "jsonb_typeof(images) = 'array'");
            table.HasCheckConstraint("questions_points_check", "points > 0");
        });
        question.HasKey(item => item.Id);
        question.Property(item => item.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
        question.Property(item => item.QuizId).HasColumnName("quiz_id");
        question.HasOne(item => item.Quiz).WithMany(item => item.Questions).HasForeignKey(item => item.QuizId).OnDelete(DeleteBehavior.Cascade);
        question.Property(item => item.Ordinal).HasColumnName("ordinal");
        question.Property(item => item.Content).HasColumnName("content").HasMaxLength(20000).IsRequired();
        question.Property(item => item.ImagesJson).HasColumnName("images").HasColumnType("jsonb").HasDefaultValue("[]");
        question.Property(item => item.Type).HasColumnName("type").HasMaxLength(30);
        question.Property(item => item.OptionsJson).HasColumnName("options").HasColumnType("jsonb");
        question.Property(item => item.Points).HasColumnName("points").HasPrecision(10, 2);
        question.Property(item => item.LegacyId).HasColumnName("legacy_id");
        question.Property(item => item.CreatedAt).HasColumnName("created_at");
        question.Property(item => item.UpdatedAt).HasColumnName("updated_at");
        question.HasIndex(item => new { item.QuizId, item.Ordinal }).IsUnique();
        question.HasIndex(item => new { item.QuizId, item.LegacyId }).IsUnique();

        var answerKey = modelBuilder.Entity<QuestionAnswerKey>();
        answerKey.ToTable("question_answer_keys", table =>
            table.HasCheckConstraint("question_answer_keys_answers_array_check", "jsonb_typeof(correct_answers) = 'array' AND jsonb_array_length(correct_answers) BETWEEN 1 AND 5"));
        answerKey.HasKey(item => item.QuestionId);
        answerKey.Property(item => item.QuestionId).HasColumnName("question_id");
        answerKey.HasOne(item => item.Question).WithOne(item => item.AnswerKey).HasForeignKey<QuestionAnswerKey>(item => item.QuestionId).OnDelete(DeleteBehavior.Cascade);
        answerKey.Property(item => item.CorrectAnswersJson).HasColumnName("correct_answers").HasColumnType("jsonb");
        answerKey.Property(item => item.Explanation).HasColumnName("explanation").HasMaxLength(20000).HasDefaultValue("");
        answerKey.Property(item => item.CreatedAt).HasColumnName("created_at");
        answerKey.Property(item => item.UpdatedAt).HasColumnName("updated_at");

        var attempt = modelBuilder.Entity<ExamAttempt>();
        attempt.ToTable("exam_attempts", table =>
        {
            table.HasCheckConstraint("exam_attempts_duration_check", "duration_minutes BETWEEN 0 AND 1440");
            table.HasCheckConstraint("exam_attempts_pass_percentage_check", "pass_percentage BETWEEN 0 AND 100");
            table.HasCheckConstraint("exam_attempts_current_index_check", "current_index >= 0");
            table.HasCheckConstraint("exam_attempts_revision_check", "revision >= 0");
            table.HasCheckConstraint("exam_attempts_snapshot_object_check", "jsonb_typeof(snapshot) = 'object'");
        });
        attempt.HasKey(item => item.Id);
        attempt.Property(item => item.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
        attempt.Property(item => item.QuizId).HasColumnName("quiz_id");
        attempt.HasOne<Quiz>().WithMany().HasForeignKey(item => item.QuizId).OnDelete(DeleteBehavior.Restrict);
        attempt.Property(item => item.StudentUid).HasColumnName("student_uid").HasMaxLength(128);
        attempt.HasOne<Profile>().WithMany().HasForeignKey(item => item.StudentUid).OnDelete(DeleteBehavior.Restrict);
        attempt.Property(item => item.StudentName).HasColumnName("student_name").HasMaxLength(200);
        attempt.Property(item => item.StudentClass).HasColumnName("student_class").HasMaxLength(100);
        attempt.Property(item => item.StartedAt).HasColumnName("started_at");
        attempt.Property(item => item.EndsAt).HasColumnName("ends_at");
        attempt.Property(item => item.SubmittedAt).HasColumnName("submitted_at");
        attempt.Property(item => item.DurationMinutes).HasColumnName("duration_minutes");
        attempt.Property(item => item.PassPercentage).HasColumnName("pass_percentage").HasPrecision(5, 2);
        attempt.Property(item => item.AllowReview).HasColumnName("allow_review");
        attempt.Property(item => item.QuestionOrder).HasColumnName("question_order");
        attempt.Property(item => item.SnapshotJson).HasColumnName("snapshot").HasColumnType("jsonb").HasDefaultValueSql("'{}'::jsonb");
        attempt.Property(item => item.OptionOrderJson).HasColumnName("option_order").HasColumnType("jsonb");
        attempt.Property(item => item.FlaggedIdsJson).HasColumnName("flagged_ids").HasColumnType("jsonb");
        attempt.Property(item => item.CurrentIndex).HasColumnName("current_index");
        attempt.Property(item => item.Revision).HasColumnName("revision").IsConcurrencyToken();
        attempt.Property(item => item.UpdatedAt).HasColumnName("updated_at");
        attempt.Property(item => item.LegacyId).HasColumnName("legacy_id");
        attempt.HasIndex(item => new { item.QuizId, item.StudentUid }).IsUnique().HasDatabaseName("one_active_attempt").HasFilter("submitted_at IS NULL");
        attempt.HasIndex(item => item.StudentUid).HasDatabaseName("attempts_student");
        attempt.HasIndex(item => item.QuizId).HasDatabaseName("attempts_quiz");
        attempt.HasIndex(item => new { item.StudentUid, item.LegacyId }).IsUnique();

        var examAnswer = modelBuilder.Entity<ExamAnswer>();
        examAnswer.ToTable("exam_answers", table => table.HasCheckConstraint("exam_answers_selected_array_check", "jsonb_typeof(selected_answers) = 'array'"));
        examAnswer.HasKey(item => new { item.AttemptId, item.QuestionId });
        examAnswer.Property(item => item.AttemptId).HasColumnName("attempt_id");
        examAnswer.Property(item => item.QuestionId).HasColumnName("question_id");
        examAnswer.HasOne(item => item.Attempt).WithMany(item => item.Answers).HasForeignKey(item => item.AttemptId).OnDelete(DeleteBehavior.Cascade);
        examAnswer.HasOne<Question>().WithMany().HasForeignKey(item => item.QuestionId).OnDelete(DeleteBehavior.Restrict);
        examAnswer.Property(item => item.SelectedAnswersJson).HasColumnName("selected_answers").HasColumnType("jsonb");
        examAnswer.Property(item => item.UpdatedAt).HasColumnName("updated_at");

        var result = modelBuilder.Entity<ExamResult>();
        result.ToTable("exam_results", table => table.HasCheckConstraint("exam_results_payload_object_check", "jsonb_typeof(payload) = 'object'"));
        result.HasKey(item => item.Id);
        result.Property(item => item.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
        result.Property(item => item.AttemptId).HasColumnName("attempt_id");
        result.HasIndex(item => item.AttemptId).IsUnique();
        result.HasOne<ExamAttempt>().WithMany().HasForeignKey(item => item.AttemptId).OnDelete(DeleteBehavior.Restrict);
        result.Property(item => item.PayloadJson).HasColumnName("payload").HasColumnType("jsonb");
        result.Property(item => item.CreatedAt).HasColumnName("created_at");
        result.Property(item => item.Score).HasColumnName("score")
            .HasComputedColumnSql("NULLIF(payload ->> 'score', '')::numeric", stored: true);
        result.Property(item => item.Percentage).HasColumnName("percentage")
            .HasComputedColumnSql("NULLIF(payload ->> 'percentage', '')::numeric", stored: true);
        result.Property(item => item.IsPassed).HasColumnName("is_passed")
            .HasComputedColumnSql("NULLIF(payload ->> 'isPassed', '')::boolean", stored: true);
        result.HasIndex(item => item.Score).HasDatabaseName("exam_results_score");
        result.HasIndex(item => item.IsPassed).HasDatabaseName("exam_results_is_passed");

        var attemptMutation = modelBuilder.Entity<ExamAttemptMutation>();
        attemptMutation.ToTable("exam_attempt_mutations", table =>
        {
            table.HasCheckConstraint("exam_attempt_mutations_sequence_check", "client_sequence > 0");
            table.HasCheckConstraint("exam_attempt_mutations_revision_check", "result_revision >= 0");
        });
        attemptMutation.HasKey(item => new { item.AttemptId, item.MutationId });
        attemptMutation.Property(item => item.AttemptId).HasColumnName("attempt_id");
        attemptMutation.Property(item => item.MutationId).HasColumnName("mutation_id");
        attemptMutation.HasOne<ExamAttempt>().WithMany().HasForeignKey(item => item.AttemptId).OnDelete(DeleteBehavior.Cascade);
        attemptMutation.Property(item => item.ClientSequence).HasColumnName("client_sequence");
        attemptMutation.Property(item => item.WriterSessionId).HasColumnName("writer_session_id").HasMaxLength(64);
        attemptMutation.Property(item => item.RequestFingerprint).HasColumnName("request_fingerprint").HasMaxLength(64);
        attemptMutation.Property(item => item.ResultRevision).HasColumnName("result_revision");
        attemptMutation.Property(item => item.SavedAt).HasColumnName("saved_at");
        attemptMutation.HasIndex(item => item.SavedAt).HasDatabaseName("exam_attempt_mutations_saved_at");

        var practiceSession = modelBuilder.Entity<PracticeSession>();
        practiceSession.ToTable("practice_sessions", table =>
        {
            table.HasCheckConstraint("practice_sessions_status_check", "status IN ('in_progress','completed','invalidated')");
            table.HasCheckConstraint("practice_sessions_question_order_check", "cardinality(question_order) > 0");
            table.HasCheckConstraint("practice_sessions_option_order_object_check", "jsonb_typeof(option_order) = 'object'");
            table.HasCheckConstraint("practice_sessions_answer_count_check", "answer_count >= 0");
            table.HasCheckConstraint("practice_sessions_completed_result_check", "status <> 'completed' OR result IS NOT NULL");
        });
        practiceSession.HasKey(item => item.Id);
        practiceSession.Property(item => item.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
        practiceSession.Property(item => item.QuizId).HasColumnName("quiz_id");
        practiceSession.HasOne<Quiz>().WithMany().HasForeignKey(item => item.QuizId).OnDelete(DeleteBehavior.Restrict);
        practiceSession.Property(item => item.QuizTitle).HasColumnName("quiz_title").HasMaxLength(300);
        practiceSession.Property(item => item.Subject).HasColumnName("subject").HasMaxLength(100);
        practiceSession.Property(item => item.StudentUid).HasColumnName("student_uid").HasMaxLength(128);
        practiceSession.HasOne<Profile>().WithMany().HasForeignKey(item => item.StudentUid).OnDelete(DeleteBehavior.Restrict);
        practiceSession.Property(item => item.StartedAt).HasColumnName("started_at");
        practiceSession.Property(item => item.FinishedAt).HasColumnName("finished_at");
        practiceSession.Property(item => item.Status).HasColumnName("status").HasMaxLength(20);
        practiceSession.Property(item => item.FailureMessage).HasColumnName("failure_message");
        practiceSession.Property(item => item.QuizUpdatedAt).HasColumnName("quiz_updated_at");
        practiceSession.Property(item => item.QuestionOrder).HasColumnName("question_order");
        practiceSession.Property(item => item.OptionOrderJson).HasColumnName("option_order").HasColumnType("jsonb");
        practiceSession.Property(item => item.ShowExplanation).HasColumnName("show_explanation");
        practiceSession.Property(item => item.AnswerCount).HasColumnName("answer_count");
        practiceSession.Property(item => item.ResultJson).HasColumnName("result").HasColumnType("jsonb");
        practiceSession.HasIndex(item => new { item.StudentUid, item.StartedAt }).HasDatabaseName("practice_sessions_student_started");

        var practiceAnswer = modelBuilder.Entity<PracticeAnswer>();
        practiceAnswer.ToTable("practice_answers", table =>
        {
            table.HasCheckConstraint("practice_answers_selected_array_check", "jsonb_typeof(selected_answers) = 'array' AND jsonb_array_length(selected_answers) BETWEEN 1 AND 5");
            table.HasCheckConstraint("practice_answers_correct_array_check", "jsonb_typeof(correct_answers) = 'array'");
        });
        practiceAnswer.HasKey(item => new { item.SessionId, item.QuestionId });
        practiceAnswer.Property(item => item.SessionId).HasColumnName("session_id");
        practiceAnswer.HasOne<PracticeSession>().WithMany(item => item.Answers).HasForeignKey(item => item.SessionId).OnDelete(DeleteBehavior.Cascade);
        practiceAnswer.Property(item => item.QuestionId).HasColumnName("question_id");
        practiceAnswer.HasOne<Question>().WithMany().HasForeignKey(item => item.QuestionId).OnDelete(DeleteBehavior.Restrict);
        practiceAnswer.Property(item => item.SelectedAnswersJson).HasColumnName("selected_answers").HasColumnType("jsonb");
        practiceAnswer.Property(item => item.IsCorrect).HasColumnName("is_correct");
        practiceAnswer.Property(item => item.CorrectAnswersJson).HasColumnName("correct_answers").HasColumnType("jsonb");
        practiceAnswer.Property(item => item.Explanation).HasColumnName("explanation").HasDefaultValue("");
        practiceAnswer.Property(item => item.CheckedAt).HasColumnName("checked_at");

        var migration = modelBuilder.Entity<DataMigration>();
        migration.ToTable("data_migrations", table =>
        {
            table.HasCheckConstraint("data_migrations_version_check", "version > 0");
            table.HasCheckConstraint("data_migrations_status_check", "status IN ('partial','completed')");
            table.HasCheckConstraint("data_migrations_report_object_check", "jsonb_typeof(report) = 'object'");
        });
        migration.HasKey(item => new { item.FirebaseUid, item.SourceId, item.Version });
        migration.Property(item => item.FirebaseUid).HasColumnName("firebase_uid").HasMaxLength(128);
        migration.HasOne<Profile>().WithMany().HasForeignKey(item => item.FirebaseUid).OnDelete(DeleteBehavior.Restrict);
        migration.Property(item => item.SourceId).HasColumnName("source_id").HasMaxLength(200);
        migration.Property(item => item.Version).HasColumnName("version");
        migration.Property(item => item.Status).HasColumnName("status").HasMaxLength(20);
        migration.Property(item => item.ReportJson).HasColumnName("report").HasColumnType("jsonb");
        migration.Property(item => item.CreatedAt).HasColumnName("created_at");
        migration.Property(item => item.UpdatedAt).HasColumnName("updated_at");

        var aiJob = modelBuilder.Entity<AiImportJob>();
        aiJob.ToTable("ai_import_jobs", table =>
        {
            table.HasCheckConstraint("ai_import_jobs_status_check", "status IN ('queued','processing','succeeded','failed','cancelled')");
            table.HasCheckConstraint("ai_import_jobs_attempt_count_check", "attempt_count >= 0");
            table.HasCheckConstraint("ai_import_jobs_request_object_check", "jsonb_typeof(request) = 'object'");
            table.HasCheckConstraint("ai_import_jobs_result_object_check", "result IS NULL OR jsonb_typeof(result) = 'object'");
        });
        aiJob.HasKey(item => item.Id);
        aiJob.Property(item => item.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
        aiJob.Property(item => item.OwnerUid).HasColumnName("owner_uid").HasMaxLength(128);
        aiJob.HasOne<Profile>().WithMany().HasForeignKey(item => item.OwnerUid).OnDelete(DeleteBehavior.Restrict);
        aiJob.Property(item => item.SourceFileName).HasColumnName("source_file_name").HasMaxLength(255);
        aiJob.Property(item => item.IdempotencyKey).HasColumnName("idempotency_key").HasMaxLength(64);
        aiJob.Property(item => item.RequestFingerprint).HasColumnName("request_fingerprint").HasMaxLength(64);
        aiJob.Property(item => item.Status).HasColumnName("status").HasMaxLength(20);
        aiJob.Property(item => item.AttemptCount).HasColumnName("attempt_count");
        aiJob.Property(item => item.RequestJson).HasColumnName("request").HasColumnType("jsonb");
        aiJob.Property(item => item.ResultJson).HasColumnName("result").HasColumnType("jsonb");
        aiJob.Property(item => item.ErrorCode).HasColumnName("error_code").HasMaxLength(100);
        aiJob.Property(item => item.CreatedAt).HasColumnName("created_at");
        aiJob.Property(item => item.UpdatedAt).HasColumnName("updated_at");
        aiJob.Property(item => item.LeaseUntil).HasColumnName("lease_until");
        aiJob.Property(item => item.CompletedAt).HasColumnName("completed_at");
        aiJob.HasIndex(item => new { item.Status, item.CreatedAt }).HasDatabaseName("ai_import_jobs_queue");
        aiJob.HasIndex(item => new { item.OwnerUid, item.IdempotencyKey })
            .IsUnique()
            .HasDatabaseName("ai_import_jobs_owner_idempotency")
            .HasFilter("idempotency_key IS NOT NULL");

        var outbox = modelBuilder.Entity<OutboxMessage>();
        outbox.ToTable("outbox_messages", table => table.HasCheckConstraint("outbox_messages_attempt_count_check", "attempt_count >= 0"));
        outbox.HasKey(item => item.Id);
        outbox.Property(item => item.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
        outbox.Property(item => item.Kind).HasColumnName("kind").HasMaxLength(100);
        outbox.Property(item => item.PayloadJson).HasColumnName("payload").HasColumnType("jsonb");
        outbox.Property(item => item.CreatedAt).HasColumnName("created_at");
        outbox.Property(item => item.ProcessedAt).HasColumnName("processed_at");
        outbox.Property(item => item.AttemptCount).HasColumnName("attempt_count");
        outbox.HasIndex(item => new { item.ProcessedAt, item.CreatedAt }).HasDatabaseName("outbox_messages_pending");

        var aiRateLimit = modelBuilder.Entity<AiRateLimit>();
        aiRateLimit.ToTable("ai_rate_limits", table => table.HasCheckConstraint("ai_rate_limits_requests_check", "requests >= 0"));
        aiRateLimit.HasKey(item => item.FirebaseUid);
        aiRateLimit.Property(item => item.FirebaseUid).HasColumnName("firebase_uid").HasMaxLength(128);
        aiRateLimit.Property(item => item.WindowStartedAt).HasColumnName("window_started_at");
        aiRateLimit.Property(item => item.Requests).HasColumnName("requests");

        var auditEvent = modelBuilder.Entity<AuditEvent>();
        auditEvent.ToTable("audit_events", table => table.HasCheckConstraint("audit_events_details_object_check", "jsonb_typeof(details) = 'object'"));
        auditEvent.HasKey(item => item.Id);
        auditEvent.Property(item => item.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
        auditEvent.Property(item => item.ActorUid).HasColumnName("actor_uid").HasMaxLength(128);
        auditEvent.Property(item => item.Action).HasColumnName("action").HasMaxLength(100);
        auditEvent.Property(item => item.TargetType).HasColumnName("target_type").HasMaxLength(100);
        auditEvent.Property(item => item.TargetId).HasColumnName("target_id").HasMaxLength(200);
        auditEvent.Property(item => item.DetailsJson).HasColumnName("details").HasColumnType("jsonb");
        auditEvent.Property(item => item.CreatedAt).HasColumnName("created_at");
        auditEvent.HasIndex(item => new { item.ActorUid, item.CreatedAt }).HasDatabaseName("audit_events_actor_created");
    }
}
