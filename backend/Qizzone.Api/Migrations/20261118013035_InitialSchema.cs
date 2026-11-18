using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Qizzone.Api.Migrations
{
    /// <inheritdoc />
    public partial class InitialSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ai_rate_limits",
                columns: table => new
                {
                    firebase_uid = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    window_started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    requests = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ai_rate_limits", x => x.firebase_uid);
                    table.CheckConstraint("ai_rate_limits_requests_check", "requests >= 0");
                });

            migrationBuilder.CreateTable(
                name: "audit_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    actor_uid = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    action = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    target_type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    target_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    details = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audit_events", x => x.id);
                    table.CheckConstraint("audit_events_details_object_check", "jsonb_typeof(details) = 'object'");
                });

            migrationBuilder.CreateTable(
                name: "outbox_messages",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    kind = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    payload = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    processed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    attempt_count = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_outbox_messages", x => x.id);
                    table.CheckConstraint("outbox_messages_attempt_count_check", "attempt_count >= 0");
                });

            migrationBuilder.CreateTable(
                name: "profiles",
                columns: table => new
                {
                    firebase_uid = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    full_name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    role = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    approval_status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    approval_requested_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    reviewed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    reviewed_by = table.Column<string>(type: "character varying(128)", nullable: true),
                    teacher_request_status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    teacher_request_blocked = table.Column<bool>(type: "boolean", nullable: false),
                    teacher_requested_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    teacher_reviewed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    teacher_reviewed_by = table.Column<string>(type: "character varying(128)", nullable: true),
                    avatar_url = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_profiles", x => x.firebase_uid);
                    table.CheckConstraint("profiles_approval_status_check", "approval_status IN ('approved','pending','rejected')");
                    table.CheckConstraint("profiles_role_check", "role IN ('student','teacher','admin')");
                    table.CheckConstraint("profiles_teacher_request_status_check", "teacher_request_status IN ('none','pending','approved','rejected')");
                    table.ForeignKey(
                        name: "FK_profiles_profiles_reviewed_by",
                        column: x => x.reviewed_by,
                        principalTable: "profiles",
                        principalColumn: "firebase_uid",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_profiles_profiles_teacher_reviewed_by",
                        column: x => x.teacher_reviewed_by,
                        principalTable: "profiles",
                        principalColumn: "firebase_uid",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ai_import_jobs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    owner_uid = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    source_file_name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    attempt_count = table.Column<int>(type: "integer", nullable: false),
                    request = table.Column<string>(type: "jsonb", nullable: false),
                    result = table.Column<string>(type: "jsonb", nullable: true),
                    error_code = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    lease_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ai_import_jobs", x => x.id);
                    table.CheckConstraint("ai_import_jobs_attempt_count_check", "attempt_count >= 0");
                    table.CheckConstraint("ai_import_jobs_request_object_check", "jsonb_typeof(request) = 'object'");
                    table.CheckConstraint("ai_import_jobs_result_object_check", "result IS NULL OR jsonb_typeof(result) = 'object'");
                    table.CheckConstraint("ai_import_jobs_status_check", "status IN ('queued','processing','succeeded','failed')");
                    table.ForeignKey(
                        name: "FK_ai_import_jobs_profiles_owner_uid",
                        column: x => x.owner_uid,
                        principalTable: "profiles",
                        principalColumn: "firebase_uid",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "data_migrations",
                columns: table => new
                {
                    firebase_uid = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    source_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    report = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_data_migrations", x => new { x.firebase_uid, x.source_id, x.version });
                    table.CheckConstraint("data_migrations_report_object_check", "jsonb_typeof(report) = 'object'");
                    table.CheckConstraint("data_migrations_status_check", "status IN ('partial','completed')");
                    table.CheckConstraint("data_migrations_version_check", "version > 0");
                    table.ForeignKey(
                        name: "FK_data_migrations_profiles_firebase_uid",
                        column: x => x.firebase_uid,
                        principalTable: "profiles",
                        principalColumn: "firebase_uid",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "quizzes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    teacher_uid = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    subject = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    description = table.Column<string>(type: "character varying(5000)", maxLength: 5000, nullable: false, defaultValue: ""),
                    code = table.Column<string>(type: "character varying(6)", maxLength: 6, nullable: false, defaultValueSql: "upper(substr(replace(gen_random_uuid()::text,'-',''),1,6))"),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    settings = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    legacy_id = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_quizzes", x => x.id);
                    table.CheckConstraint("quizzes_settings_object_check", "jsonb_typeof(settings) = 'object'");
                    table.CheckConstraint("quizzes_status_check", "status IN ('draft','published','closed')");
                    table.ForeignKey(
                        name: "FK_quizzes_profiles_teacher_uid",
                        column: x => x.teacher_uid,
                        principalTable: "profiles",
                        principalColumn: "firebase_uid",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "exam_attempts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    quiz_id = table.Column<Guid>(type: "uuid", nullable: false),
                    student_uid = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    student_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    student_class = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ends_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    submitted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    duration_minutes = table.Column<int>(type: "integer", nullable: false),
                    pass_percentage = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false),
                    allow_review = table.Column<bool>(type: "boolean", nullable: false),
                    question_order = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    option_order = table.Column<string>(type: "jsonb", nullable: false),
                    flagged_ids = table.Column<string>(type: "jsonb", nullable: false),
                    current_index = table.Column<int>(type: "integer", nullable: false),
                    revision = table.Column<int>(type: "integer", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    legacy_id = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_exam_attempts", x => x.id);
                    table.CheckConstraint("exam_attempts_current_index_check", "current_index >= 0");
                    table.CheckConstraint("exam_attempts_duration_check", "duration_minutes BETWEEN 0 AND 1440");
                    table.CheckConstraint("exam_attempts_pass_percentage_check", "pass_percentage BETWEEN 0 AND 100");
                    table.CheckConstraint("exam_attempts_revision_check", "revision >= 0");
                    table.ForeignKey(
                        name: "FK_exam_attempts_profiles_student_uid",
                        column: x => x.student_uid,
                        principalTable: "profiles",
                        principalColumn: "firebase_uid",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_exam_attempts_quizzes_quiz_id",
                        column: x => x.quiz_id,
                        principalTable: "quizzes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "practice_sessions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    quiz_id = table.Column<Guid>(type: "uuid", nullable: false),
                    quiz_title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    subject = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    student_uid = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    finished_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    failure_message = table.Column<string>(type: "text", nullable: true),
                    quiz_updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    question_order = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    option_order = table.Column<string>(type: "jsonb", nullable: false),
                    show_explanation = table.Column<bool>(type: "boolean", nullable: false),
                    answer_count = table.Column<int>(type: "integer", nullable: false),
                    result = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_practice_sessions", x => x.id);
                    table.CheckConstraint("practice_sessions_answer_count_check", "answer_count >= 0");
                    table.CheckConstraint("practice_sessions_completed_result_check", "status <> 'completed' OR result IS NOT NULL");
                    table.CheckConstraint("practice_sessions_option_order_object_check", "jsonb_typeof(option_order) = 'object'");
                    table.CheckConstraint("practice_sessions_question_order_check", "cardinality(question_order) > 0");
                    table.CheckConstraint("practice_sessions_status_check", "status IN ('in_progress','completed','invalidated')");
                    table.ForeignKey(
                        name: "FK_practice_sessions_profiles_student_uid",
                        column: x => x.student_uid,
                        principalTable: "profiles",
                        principalColumn: "firebase_uid",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_practice_sessions_quizzes_quiz_id",
                        column: x => x.quiz_id,
                        principalTable: "quizzes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "questions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    quiz_id = table.Column<Guid>(type: "uuid", nullable: false),
                    ordinal = table.Column<int>(type: "integer", nullable: false),
                    content = table.Column<string>(type: "character varying(20000)", maxLength: 20000, nullable: false),
                    images = table.Column<string>(type: "jsonb", nullable: false, defaultValue: "[]"),
                    type = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    options = table.Column<string>(type: "jsonb", nullable: false),
                    points = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    legacy_id = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_questions", x => x.id);
                    table.CheckConstraint("questions_images_array_check", "jsonb_typeof(images) = 'array'");
                    table.CheckConstraint("questions_options_array_check", "jsonb_typeof(options) = 'array'");
                    table.CheckConstraint("questions_ordinal_check", "ordinal > 0");
                    table.CheckConstraint("questions_points_check", "points > 0");
                    table.CheckConstraint("questions_type_check", "type IN ('single_choice','multiple_choice','true_false')");
                    table.ForeignKey(
                        name: "FK_questions_quizzes_quiz_id",
                        column: x => x.quiz_id,
                        principalTable: "quizzes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "exam_results",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    attempt_id = table.Column<Guid>(type: "uuid", nullable: false),
                    payload = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_exam_results", x => x.id);
                    table.CheckConstraint("exam_results_payload_object_check", "jsonb_typeof(payload) = 'object'");
                    table.ForeignKey(
                        name: "FK_exam_results_exam_attempts_attempt_id",
                        column: x => x.attempt_id,
                        principalTable: "exam_attempts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "exam_answers",
                columns: table => new
                {
                    attempt_id = table.Column<Guid>(type: "uuid", nullable: false),
                    question_id = table.Column<Guid>(type: "uuid", nullable: false),
                    selected_answers = table.Column<string>(type: "jsonb", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_exam_answers", x => new { x.attempt_id, x.question_id });
                    table.CheckConstraint("exam_answers_selected_array_check", "jsonb_typeof(selected_answers) = 'array'");
                    table.ForeignKey(
                        name: "FK_exam_answers_exam_attempts_attempt_id",
                        column: x => x.attempt_id,
                        principalTable: "exam_attempts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_exam_answers_questions_question_id",
                        column: x => x.question_id,
                        principalTable: "questions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "practice_answers",
                columns: table => new
                {
                    session_id = table.Column<Guid>(type: "uuid", nullable: false),
                    question_id = table.Column<Guid>(type: "uuid", nullable: false),
                    selected_answers = table.Column<string>(type: "jsonb", nullable: false),
                    is_correct = table.Column<bool>(type: "boolean", nullable: false),
                    correct_answers = table.Column<string>(type: "jsonb", nullable: false),
                    explanation = table.Column<string>(type: "text", nullable: false, defaultValue: ""),
                    checked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_practice_answers", x => new { x.session_id, x.question_id });
                    table.CheckConstraint("practice_answers_correct_array_check", "jsonb_typeof(correct_answers) = 'array'");
                    table.CheckConstraint("practice_answers_selected_array_check", "jsonb_typeof(selected_answers) = 'array' AND jsonb_array_length(selected_answers) BETWEEN 1 AND 4");
                    table.ForeignKey(
                        name: "FK_practice_answers_practice_sessions_session_id",
                        column: x => x.session_id,
                        principalTable: "practice_sessions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_practice_answers_questions_question_id",
                        column: x => x.question_id,
                        principalTable: "questions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "question_answer_keys",
                columns: table => new
                {
                    question_id = table.Column<Guid>(type: "uuid", nullable: false),
                    correct_answers = table.Column<string>(type: "jsonb", nullable: false),
                    explanation = table.Column<string>(type: "character varying(20000)", maxLength: 20000, nullable: false, defaultValue: ""),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_question_answer_keys", x => x.question_id);
                    table.CheckConstraint("question_answer_keys_answers_array_check", "jsonb_typeof(correct_answers) = 'array' AND jsonb_array_length(correct_answers) BETWEEN 1 AND 4");
                    table.ForeignKey(
                        name: "FK_question_answer_keys_questions_question_id",
                        column: x => x.question_id,
                        principalTable: "questions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ai_import_jobs_queue",
                table: "ai_import_jobs",
                columns: new[] { "status", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_ai_import_jobs_owner_uid",
                table: "ai_import_jobs",
                column: "owner_uid");

            migrationBuilder.CreateIndex(
                name: "audit_events_actor_created",
                table: "audit_events",
                columns: new[] { "actor_uid", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_exam_answers_question_id",
                table: "exam_answers",
                column: "question_id");

            migrationBuilder.CreateIndex(
                name: "attempts_quiz",
                table: "exam_attempts",
                column: "quiz_id");

            migrationBuilder.CreateIndex(
                name: "attempts_student",
                table: "exam_attempts",
                column: "student_uid");

            migrationBuilder.CreateIndex(
                name: "IX_exam_attempts_student_uid_legacy_id",
                table: "exam_attempts",
                columns: new[] { "student_uid", "legacy_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "one_active_attempt",
                table: "exam_attempts",
                columns: new[] { "quiz_id", "student_uid" },
                unique: true,
                filter: "submitted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_exam_results_attempt_id",
                table: "exam_results",
                column: "attempt_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "outbox_messages_pending",
                table: "outbox_messages",
                columns: new[] { "processed_at", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_practice_answers_question_id",
                table: "practice_answers",
                column: "question_id");

            migrationBuilder.CreateIndex(
                name: "IX_practice_sessions_quiz_id",
                table: "practice_sessions",
                column: "quiz_id");

            migrationBuilder.CreateIndex(
                name: "practice_sessions_student_started",
                table: "practice_sessions",
                columns: new[] { "student_uid", "started_at" });

            migrationBuilder.CreateIndex(
                name: "IX_profiles_email",
                table: "profiles",
                column: "email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_profiles_reviewed_by",
                table: "profiles",
                column: "reviewed_by");

            migrationBuilder.CreateIndex(
                name: "IX_profiles_teacher_reviewed_by",
                table: "profiles",
                column: "teacher_reviewed_by");

            migrationBuilder.CreateIndex(
                name: "profiles_pending_teacher",
                table: "profiles",
                columns: new[] { "approval_status", "created_at" },
                filter: "role = 'teacher'");

            migrationBuilder.CreateIndex(
                name: "profiles_pending_teacher_request",
                table: "profiles",
                columns: new[] { "teacher_request_status", "teacher_requested_at" },
                filter: "role = 'student' AND teacher_request_status = 'pending'");

            migrationBuilder.CreateIndex(
                name: "IX_questions_quiz_id_legacy_id",
                table: "questions",
                columns: new[] { "quiz_id", "legacy_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_questions_quiz_id_ordinal",
                table: "questions",
                columns: new[] { "quiz_id", "ordinal" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_quizzes_code",
                table: "quizzes",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_quizzes_teacher_uid_legacy_id",
                table: "quizzes",
                columns: new[] { "teacher_uid", "legacy_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "quizzes_teacher",
                table: "quizzes",
                column: "teacher_uid");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ai_import_jobs");

            migrationBuilder.DropTable(
                name: "ai_rate_limits");

            migrationBuilder.DropTable(
                name: "audit_events");

            migrationBuilder.DropTable(
                name: "data_migrations");

            migrationBuilder.DropTable(
                name: "exam_answers");

            migrationBuilder.DropTable(
                name: "exam_results");

            migrationBuilder.DropTable(
                name: "outbox_messages");

            migrationBuilder.DropTable(
                name: "practice_answers");

            migrationBuilder.DropTable(
                name: "question_answer_keys");

            migrationBuilder.DropTable(
                name: "exam_attempts");

            migrationBuilder.DropTable(
                name: "practice_sessions");

            migrationBuilder.DropTable(
                name: "questions");

            migrationBuilder.DropTable(
                name: "quizzes");

            migrationBuilder.DropTable(
                name: "profiles");
        }
    }
}
