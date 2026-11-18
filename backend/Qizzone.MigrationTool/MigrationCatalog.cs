using Npgsql;

namespace Qizzone.MigrationTool;

internal sealed record MigrationTable(
    string Name,
    string[] Columns,
    string SourceQuery,
    string TargetQuery,
    string? SourceSchema = "public",
    string? SourceTable = null);

internal static class MigrationCatalog
{
    public static async Task<IReadOnlyList<MigrationTable>> CreateAsync(
        NpgsqlConnection source,
        NpgsqlTransaction transaction,
        CancellationToken cancellationToken)
    {
        var questionColumns = await GetColumnsAsync(source, transaction, "public", "questions", cancellationToken);
        var hasQuestionImages = questionColumns.Contains("images");
        var questionImages = hasQuestionImages ? "question.images" : "'[]'::jsonb";

        var tables = new List<MigrationTable>
        {
            Create(
                "profiles",
                ["firebase_uid", "email", "full_name", "role", "active_role", "approval_status", "approval_requested_at", "reviewed_at", "reviewed_by", "teacher_request_status", "teacher_request_blocked", "teacher_requested_at", "teacher_reviewed_at", "teacher_reviewed_by", "avatar_url", "created_at", "updated_at"],
                // Supabase stores the base role, not the currently selected role. The target safely starts users in their base role; approved students can switch to teacher again.
                "SELECT p.firebase_uid, p.email, p.full_name, p.role, p.role AS active_role, p.approval_status, p.approval_requested_at, p.reviewed_at, p.reviewed_by, p.teacher_request_status, p.teacher_request_blocked, p.teacher_requested_at, p.teacher_reviewed_at, p.teacher_reviewed_by, p.avatar_url, p.created_at, p.updated_at FROM public.profiles AS p",
                "SELECT p.firebase_uid, p.email, p.full_name, p.role, p.active_role, p.approval_status, p.approval_requested_at, p.reviewed_at, p.reviewed_by, p.teacher_request_status, p.teacher_request_blocked, p.teacher_requested_at, p.teacher_reviewed_at, p.teacher_reviewed_by, p.avatar_url, p.created_at, p.updated_at FROM public.profiles AS p",
                "firebase_uid"),
            Create(
                "quizzes",
                ["id", "teacher_uid", "title", "subject", "description", "code", "status", "settings", "created_at", "updated_at", "legacy_id"],
                "SELECT q.id, q.teacher_uid, q.title, q.subject, q.description, q.code, q.status, q.settings, q.created_at, q.updated_at, q.legacy_id FROM public.quizzes AS q",
                "SELECT q.id, q.teacher_uid, q.title, q.subject, q.description, q.code, q.status, q.settings, q.created_at, q.updated_at, q.legacy_id FROM public.quizzes AS q",
                "id"),
            Create(
                "questions",
                ["id", "quiz_id", "ordinal", "content", "images", "type", "options", "points", "legacy_id", "created_at", "updated_at"],
                $"SELECT question.id, question.quiz_id, question.ordinal, question.content, {questionImages} AS images, question.type, question.options, question.points, question.legacy_id, question.created_at, question.updated_at FROM public.questions AS question",
                "SELECT question.id, question.quiz_id, question.ordinal, question.content, question.images, question.type, question.options, question.points, question.legacy_id, question.created_at, question.updated_at FROM public.questions AS question",
                "id"),
            Create(
                "question_answer_keys",
                ["question_id", "correct_answers", "explanation", "created_at", "updated_at"],
                "SELECT answer_key.question_id, answer_key.correct_answers, answer_key.explanation, answer_key.created_at, answer_key.updated_at FROM public.question_answer_keys AS answer_key",
                "SELECT answer_key.question_id, answer_key.correct_answers, answer_key.explanation, answer_key.created_at, answer_key.updated_at FROM public.question_answer_keys AS answer_key",
                "question_id"),
            Create(
                "exam_attempts",
                ["id", "quiz_id", "student_uid", "student_name", "student_class", "started_at", "ends_at", "submitted_at", "duration_minutes", "pass_percentage", "allow_review", "question_order", "snapshot", "option_order", "flagged_ids", "current_index", "revision", "updated_at", "legacy_id"],
                $"SELECT attempt.id, attempt.quiz_id, attempt.student_uid, attempt.student_name, attempt.student_class, attempt.started_at, attempt.ends_at, attempt.submitted_at, attempt.duration_minutes, attempt.pass_percentage, attempt.allow_review, attempt.question_order, {BuildSnapshotSql(questionImages)} AS snapshot, attempt.option_order, attempt.flagged_ids, attempt.current_index, attempt.revision, attempt.updated_at, attempt.legacy_id FROM public.exam_attempts AS attempt",
                "SELECT attempt.id, attempt.quiz_id, attempt.student_uid, attempt.student_name, attempt.student_class, attempt.started_at, attempt.ends_at, attempt.submitted_at, attempt.duration_minutes, attempt.pass_percentage, attempt.allow_review, attempt.question_order, attempt.snapshot, attempt.option_order, attempt.flagged_ids, attempt.current_index, attempt.revision, attempt.updated_at, attempt.legacy_id FROM public.exam_attempts AS attempt",
                "id"),
            Create(
                "exam_answers",
                ["attempt_id", "question_id", "selected_answers", "updated_at"],
                "SELECT answer.attempt_id, answer.question_id, answer.selected_answers, answer.updated_at FROM public.exam_answers AS answer",
                "SELECT answer.attempt_id, answer.question_id, answer.selected_answers, answer.updated_at FROM public.exam_answers AS answer",
                "attempt_id, question_id"),
            Create(
                "exam_results",
                ["id", "attempt_id", "payload", "created_at"],
                "SELECT result.id, result.attempt_id, result.payload, result.created_at FROM public.exam_results AS result",
                "SELECT result.id, result.attempt_id, result.payload, result.created_at FROM public.exam_results AS result",
                "id"),
            Create(
                "practice_sessions",
                ["id", "quiz_id", "quiz_title", "subject", "student_uid", "started_at", "finished_at", "status", "failure_message", "quiz_updated_at", "question_order", "option_order", "show_explanation", "answer_count", "result"],
                "SELECT session.id, session.quiz_id, session.quiz_title, session.subject, session.student_uid, session.started_at, session.finished_at, session.status, session.failure_message, session.quiz_updated_at, session.question_order, session.option_order, session.show_explanation, session.answer_count, session.result FROM public.practice_sessions AS session",
                "SELECT session.id, session.quiz_id, session.quiz_title, session.subject, session.student_uid, session.started_at, session.finished_at, session.status, session.failure_message, session.quiz_updated_at, session.question_order, session.option_order, session.show_explanation, session.answer_count, session.result FROM public.practice_sessions AS session",
                "id"),
            Create(
                "practice_answers",
                ["session_id", "question_id", "selected_answers", "is_correct", "correct_answers", "explanation", "checked_at"],
                "SELECT answer.session_id, answer.question_id, answer.selected_answers, answer.is_correct, answer.correct_answers, answer.explanation, answer.checked_at FROM public.practice_answers AS answer",
                "SELECT answer.session_id, answer.question_id, answer.selected_answers, answer.is_correct, answer.correct_answers, answer.explanation, answer.checked_at FROM public.practice_answers AS answer",
                "session_id, question_id"),
            Create(
                "data_migrations",
                ["firebase_uid", "source_id", "version", "status", "report", "created_at", "updated_at"],
                "SELECT migration.firebase_uid, migration.source_id, migration.version, migration.status, migration.report, migration.created_at, migration.updated_at FROM public.data_migrations AS migration",
                "SELECT migration.firebase_uid, migration.source_id, migration.version, migration.status, migration.report, migration.created_at, migration.updated_at FROM public.data_migrations AS migration",
                "firebase_uid, source_id, version"),
            Create(
                "ai_rate_limits",
                ["firebase_uid", "window_started_at", "requests"],
                "SELECT limits.uid AS firebase_uid, limits.bucket AS window_started_at, limits.requests FROM private.ai_limits AS limits",
                "SELECT limits.firebase_uid, limits.window_started_at, limits.requests FROM public.ai_rate_limits AS limits",
                "firebase_uid",
                "private",
                "ai_limits"),
        };

        foreach (var table in tables)
        {
            if (table.SourceTable is { } sourceTable)
            {
                var columns = await GetColumnsAsync(source, transaction, table.SourceSchema!, sourceTable, cancellationToken);
                var expectedSourceColumnNames = table.Name == "ai_rate_limits"
                    ? new[] { "uid", "bucket", "requests" }
                    : table.Columns;
                var missing = expectedSourceColumnNames.Except(columns, StringComparer.Ordinal).ToArray();
                if (missing.Length > 0)
                {
                    throw new MigrationToolException($"Source schema mismatch in {table.SourceSchema}.{sourceTable}; required columns are missing.");
                }
            }
            else
            {
                var columns = await GetColumnsAsync(source, transaction, "public", table.Name, cancellationToken);
                var missing = table.Columns.Except(columns, StringComparer.Ordinal).ToArray();
                if (missing.Length > 0 && !(table.Name == "questions" && missing.SequenceEqual(["images"])))
                {
                    throw new MigrationToolException($"Source schema mismatch in public.{table.Name}; required columns are missing.");
                }
            }
        }

        return tables;
    }

    public static readonly string[] TargetOnlyTables =
    [
        "media_objects",
        "exam_attempt_mutations",
        "ai_import_jobs",
        "outbox_messages",
        "audit_events",
    ];

    private static MigrationTable Create(
        string name,
        string[] columns,
        string sourceProjection,
        string targetProjection,
        string orderBy,
        string sourceSchema = "public",
        string? sourceTable = null) => new(
            name,
            columns,
            BuildRowQuery(sourceProjection, orderBy),
            BuildRowQuery(targetProjection, orderBy),
            sourceSchema,
            sourceTable ?? name);

    private static string BuildRowQuery(string projection, string orderBy) =>
        $"SELECT to_jsonb(row_data)::text FROM ({projection}) AS row_data ORDER BY {orderBy}";

    private static string BuildSnapshotSql(string questionImages) => $"""
        (
          SELECT jsonb_build_object(
            'title', quiz.title,
            'subject', quiz.subject,
            'roomCode', quiz.code,
            'questions', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', question.id,
                'ordinal', question.ordinal,
                'content', question.content,
                'images', COALESCE({questionImages}, '[]'::jsonb),
                'type', question.type,
                'options', question.options,
                'correctAnswers', answer_key.correct_answers,
                'explanation', answer_key.explanation,
                'points', question.points
              ) ORDER BY selected_question.ordinality)
              FROM unnest(attempt.question_order) WITH ORDINALITY AS selected_question(question_id, ordinality)
              JOIN public.questions AS question ON question.id = selected_question.question_id AND question.quiz_id = attempt.quiz_id
              JOIN public.question_answer_keys AS answer_key ON answer_key.question_id = question.id
            ), '[]'::jsonb)
          )
          FROM public.quizzes AS quiz
          WHERE quiz.id = attempt.quiz_id
        )
        """;

    private static async Task<HashSet<string>> GetColumnsAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string schema,
        string table,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = @schema AND table_name = @table",
            connection,
            transaction);
        command.Parameters.AddWithValue("schema", schema);
        command.Parameters.AddWithValue("table", table);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var columns = new HashSet<string>(StringComparer.Ordinal);
        while (await reader.ReadAsync(cancellationToken))
        {
            columns.Add(reader.GetString(0));
        }

        if (columns.Count == 0)
        {
            throw new MigrationToolException($"Required source table {schema}.{table} is missing or inaccessible.");
        }

        return columns;
    }
}
