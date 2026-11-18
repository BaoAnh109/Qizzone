CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" (
    "MigrationId" character varying(150) NOT NULL,
    "ProductVersion" character varying(32) NOT NULL,
    CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY ("MigrationId")
);

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE TABLE ai_rate_limits (
        firebase_uid character varying(128) NOT NULL,
        window_started_at timestamp with time zone NOT NULL,
        requests integer NOT NULL,
        CONSTRAINT "PK_ai_rate_limits" PRIMARY KEY (firebase_uid),
        CONSTRAINT ai_rate_limits_requests_check CHECK (requests >= 0)
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE TABLE audit_events (
        id uuid NOT NULL DEFAULT (gen_random_uuid()),
        actor_uid character varying(128) NOT NULL,
        action character varying(100) NOT NULL,
        target_type character varying(100) NOT NULL,
        target_id character varying(200),
        details jsonb NOT NULL,
        created_at timestamp with time zone NOT NULL,
        CONSTRAINT "PK_audit_events" PRIMARY KEY (id),
        CONSTRAINT audit_events_details_object_check CHECK (jsonb_typeof(details) = 'object')
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE TABLE outbox_messages (
        id uuid NOT NULL DEFAULT (gen_random_uuid()),
        kind character varying(100) NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamp with time zone NOT NULL,
        processed_at timestamp with time zone,
        attempt_count integer NOT NULL,
        CONSTRAINT "PK_outbox_messages" PRIMARY KEY (id),
        CONSTRAINT outbox_messages_attempt_count_check CHECK (attempt_count >= 0)
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE TABLE profiles (
        firebase_uid character varying(128) NOT NULL,
        email character varying(320) NOT NULL,
        full_name character varying(100) NOT NULL,
        role character varying(20) NOT NULL,
        approval_status character varying(20) NOT NULL,
        approval_requested_at timestamp with time zone,
        reviewed_at timestamp with time zone,
        reviewed_by character varying(128),
        teacher_request_status character varying(20) NOT NULL,
        teacher_request_blocked boolean NOT NULL,
        teacher_requested_at timestamp with time zone,
        teacher_reviewed_at timestamp with time zone,
        teacher_reviewed_by character varying(128),
        avatar_url text,
        created_at timestamp with time zone NOT NULL,
        updated_at timestamp with time zone NOT NULL,
        CONSTRAINT "PK_profiles" PRIMARY KEY (firebase_uid),
        CONSTRAINT profiles_approval_status_check CHECK (approval_status IN ('approved','pending','rejected')),
        CONSTRAINT profiles_role_check CHECK (role IN ('student','teacher','admin')),
        CONSTRAINT profiles_teacher_request_status_check CHECK (teacher_request_status IN ('none','pending','approved','rejected')),
        CONSTRAINT "FK_profiles_profiles_reviewed_by" FOREIGN KEY (reviewed_by) REFERENCES profiles (firebase_uid) ON DELETE RESTRICT,
        CONSTRAINT "FK_profiles_profiles_teacher_reviewed_by" FOREIGN KEY (teacher_reviewed_by) REFERENCES profiles (firebase_uid) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE TABLE ai_import_jobs (
        id uuid NOT NULL DEFAULT (gen_random_uuid()),
        owner_uid character varying(128) NOT NULL,
        source_file_name character varying(255) NOT NULL,
        status character varying(20) NOT NULL,
        attempt_count integer NOT NULL,
        request jsonb NOT NULL,
        result jsonb,
        error_code character varying(100),
        created_at timestamp with time zone NOT NULL,
        updated_at timestamp with time zone NOT NULL,
        lease_until timestamp with time zone,
        completed_at timestamp with time zone,
        CONSTRAINT "PK_ai_import_jobs" PRIMARY KEY (id),
        CONSTRAINT ai_import_jobs_attempt_count_check CHECK (attempt_count >= 0),
        CONSTRAINT ai_import_jobs_request_object_check CHECK (jsonb_typeof(request) = 'object'),
        CONSTRAINT ai_import_jobs_result_object_check CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
        CONSTRAINT ai_import_jobs_status_check CHECK (status IN ('queued','processing','succeeded','failed')),
        CONSTRAINT "FK_ai_import_jobs_profiles_owner_uid" FOREIGN KEY (owner_uid) REFERENCES profiles (firebase_uid) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE TABLE data_migrations (
        firebase_uid character varying(128) NOT NULL,
        source_id character varying(200) NOT NULL,
        version integer NOT NULL,
        status character varying(20) NOT NULL,
        report jsonb NOT NULL,
        created_at timestamp with time zone NOT NULL,
        updated_at timestamp with time zone NOT NULL,
        CONSTRAINT "PK_data_migrations" PRIMARY KEY (firebase_uid, source_id, version),
        CONSTRAINT data_migrations_report_object_check CHECK (jsonb_typeof(report) = 'object'),
        CONSTRAINT data_migrations_status_check CHECK (status IN ('partial','completed')),
        CONSTRAINT data_migrations_version_check CHECK (version > 0),
        CONSTRAINT "FK_data_migrations_profiles_firebase_uid" FOREIGN KEY (firebase_uid) REFERENCES profiles (firebase_uid) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE TABLE quizzes (
        id uuid NOT NULL DEFAULT (gen_random_uuid()),
        teacher_uid character varying(128) NOT NULL,
        title character varying(300) NOT NULL,
        subject character varying(100) NOT NULL,
        description character varying(5000) NOT NULL DEFAULT '',
        code character varying(6) NOT NULL DEFAULT (upper(substr(replace(gen_random_uuid()::text,'-',''),1,6))),
        status character varying(20) NOT NULL,
        settings jsonb NOT NULL,
        created_at timestamp with time zone NOT NULL,
        updated_at timestamp with time zone NOT NULL,
        legacy_id text,
        CONSTRAINT "PK_quizzes" PRIMARY KEY (id),
        CONSTRAINT quizzes_settings_object_check CHECK (jsonb_typeof(settings) = 'object'),
        CONSTRAINT quizzes_status_check CHECK (status IN ('draft','published','closed')),
        CONSTRAINT "FK_quizzes_profiles_teacher_uid" FOREIGN KEY (teacher_uid) REFERENCES profiles (firebase_uid) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE TABLE exam_attempts (
        id uuid NOT NULL DEFAULT (gen_random_uuid()),
        quiz_id uuid NOT NULL,
        student_uid character varying(128) NOT NULL,
        student_name character varying(200) NOT NULL,
        student_class character varying(100),
        started_at timestamp with time zone NOT NULL,
        ends_at timestamp with time zone,
        submitted_at timestamp with time zone,
        duration_minutes integer NOT NULL,
        pass_percentage numeric(5,2) NOT NULL,
        allow_review boolean NOT NULL,
        question_order uuid[] NOT NULL,
        option_order jsonb NOT NULL,
        flagged_ids jsonb NOT NULL,
        current_index integer NOT NULL,
        revision integer NOT NULL,
        updated_at timestamp with time zone NOT NULL,
        legacy_id text,
        CONSTRAINT "PK_exam_attempts" PRIMARY KEY (id),
        CONSTRAINT exam_attempts_current_index_check CHECK (current_index >= 0),
        CONSTRAINT exam_attempts_duration_check CHECK (duration_minutes BETWEEN 0 AND 1440),
        CONSTRAINT exam_attempts_pass_percentage_check CHECK (pass_percentage BETWEEN 0 AND 100),
        CONSTRAINT exam_attempts_revision_check CHECK (revision >= 0),
        CONSTRAINT "FK_exam_attempts_profiles_student_uid" FOREIGN KEY (student_uid) REFERENCES profiles (firebase_uid) ON DELETE RESTRICT,
        CONSTRAINT "FK_exam_attempts_quizzes_quiz_id" FOREIGN KEY (quiz_id) REFERENCES quizzes (id) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE TABLE practice_sessions (
        id uuid NOT NULL DEFAULT (gen_random_uuid()),
        quiz_id uuid NOT NULL,
        quiz_title character varying(300) NOT NULL,
        subject character varying(100) NOT NULL,
        student_uid character varying(128) NOT NULL,
        started_at timestamp with time zone NOT NULL,
        finished_at timestamp with time zone,
        status character varying(20) NOT NULL,
        failure_message text,
        quiz_updated_at timestamp with time zone NOT NULL,
        question_order uuid[] NOT NULL,
        option_order jsonb NOT NULL,
        show_explanation boolean NOT NULL,
        answer_count integer NOT NULL,
        result jsonb,
        CONSTRAINT "PK_practice_sessions" PRIMARY KEY (id),
        CONSTRAINT practice_sessions_answer_count_check CHECK (answer_count >= 0),
        CONSTRAINT practice_sessions_completed_result_check CHECK (status <> 'completed' OR result IS NOT NULL),
        CONSTRAINT practice_sessions_option_order_object_check CHECK (jsonb_typeof(option_order) = 'object'),
        CONSTRAINT practice_sessions_question_order_check CHECK (cardinality(question_order) > 0),
        CONSTRAINT practice_sessions_status_check CHECK (status IN ('in_progress','completed','invalidated')),
        CONSTRAINT "FK_practice_sessions_profiles_student_uid" FOREIGN KEY (student_uid) REFERENCES profiles (firebase_uid) ON DELETE RESTRICT,
        CONSTRAINT "FK_practice_sessions_quizzes_quiz_id" FOREIGN KEY (quiz_id) REFERENCES quizzes (id) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE TABLE questions (
        id uuid NOT NULL DEFAULT (gen_random_uuid()),
        quiz_id uuid NOT NULL,
        ordinal integer NOT NULL,
        content character varying(20000) NOT NULL,
        images jsonb NOT NULL DEFAULT '[]',
        type character varying(30) NOT NULL,
        options jsonb NOT NULL,
        points numeric(10,2) NOT NULL,
        legacy_id text,
        created_at timestamp with time zone NOT NULL,
        updated_at timestamp with time zone NOT NULL,
        CONSTRAINT "PK_questions" PRIMARY KEY (id),
        CONSTRAINT questions_images_array_check CHECK (jsonb_typeof(images) = 'array'),
        CONSTRAINT questions_options_array_check CHECK (jsonb_typeof(options) = 'array'),
        CONSTRAINT questions_ordinal_check CHECK (ordinal > 0),
        CONSTRAINT questions_points_check CHECK (points > 0),
        CONSTRAINT questions_type_check CHECK (type IN ('single_choice','multiple_choice','true_false')),
        CONSTRAINT "FK_questions_quizzes_quiz_id" FOREIGN KEY (quiz_id) REFERENCES quizzes (id) ON DELETE CASCADE
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE TABLE exam_results (
        id uuid NOT NULL DEFAULT (gen_random_uuid()),
        attempt_id uuid NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamp with time zone NOT NULL,
        CONSTRAINT "PK_exam_results" PRIMARY KEY (id),
        CONSTRAINT exam_results_payload_object_check CHECK (jsonb_typeof(payload) = 'object'),
        CONSTRAINT "FK_exam_results_exam_attempts_attempt_id" FOREIGN KEY (attempt_id) REFERENCES exam_attempts (id) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE TABLE exam_answers (
        attempt_id uuid NOT NULL,
        question_id uuid NOT NULL,
        selected_answers jsonb NOT NULL,
        updated_at timestamp with time zone NOT NULL,
        CONSTRAINT "PK_exam_answers" PRIMARY KEY (attempt_id, question_id),
        CONSTRAINT exam_answers_selected_array_check CHECK (jsonb_typeof(selected_answers) = 'array'),
        CONSTRAINT "FK_exam_answers_exam_attempts_attempt_id" FOREIGN KEY (attempt_id) REFERENCES exam_attempts (id) ON DELETE CASCADE,
        CONSTRAINT "FK_exam_answers_questions_question_id" FOREIGN KEY (question_id) REFERENCES questions (id) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE TABLE practice_answers (
        session_id uuid NOT NULL,
        question_id uuid NOT NULL,
        selected_answers jsonb NOT NULL,
        is_correct boolean NOT NULL,
        correct_answers jsonb NOT NULL,
        explanation text NOT NULL DEFAULT '',
        checked_at timestamp with time zone NOT NULL,
        CONSTRAINT "PK_practice_answers" PRIMARY KEY (session_id, question_id),
        CONSTRAINT practice_answers_correct_array_check CHECK (jsonb_typeof(correct_answers) = 'array'),
        CONSTRAINT practice_answers_selected_array_check CHECK (jsonb_typeof(selected_answers) = 'array' AND jsonb_array_length(selected_answers) BETWEEN 1 AND 4),
        CONSTRAINT "FK_practice_answers_practice_sessions_session_id" FOREIGN KEY (session_id) REFERENCES practice_sessions (id) ON DELETE CASCADE,
        CONSTRAINT "FK_practice_answers_questions_question_id" FOREIGN KEY (question_id) REFERENCES questions (id) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE TABLE question_answer_keys (
        question_id uuid NOT NULL,
        correct_answers jsonb NOT NULL,
        explanation character varying(20000) NOT NULL DEFAULT '',
        created_at timestamp with time zone NOT NULL,
        updated_at timestamp with time zone NOT NULL,
        CONSTRAINT "PK_question_answer_keys" PRIMARY KEY (question_id),
        CONSTRAINT question_answer_keys_answers_array_check CHECK (jsonb_typeof(correct_answers) = 'array' AND jsonb_array_length(correct_answers) BETWEEN 1 AND 4),
        CONSTRAINT "FK_question_answer_keys_questions_question_id" FOREIGN KEY (question_id) REFERENCES questions (id) ON DELETE CASCADE
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE INDEX ai_import_jobs_queue ON ai_import_jobs (status, created_at);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE INDEX "IX_ai_import_jobs_owner_uid" ON ai_import_jobs (owner_uid);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE INDEX audit_events_actor_created ON audit_events (actor_uid, created_at);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE INDEX "IX_exam_answers_question_id" ON exam_answers (question_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE INDEX attempts_quiz ON exam_attempts (quiz_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE INDEX attempts_student ON exam_attempts (student_uid);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE UNIQUE INDEX "IX_exam_attempts_student_uid_legacy_id" ON exam_attempts (student_uid, legacy_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE UNIQUE INDEX one_active_attempt ON exam_attempts (quiz_id, student_uid) WHERE submitted_at IS NULL;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE UNIQUE INDEX "IX_exam_results_attempt_id" ON exam_results (attempt_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE INDEX outbox_messages_pending ON outbox_messages (processed_at, created_at);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE INDEX "IX_practice_answers_question_id" ON practice_answers (question_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE INDEX "IX_practice_sessions_quiz_id" ON practice_sessions (quiz_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE INDEX practice_sessions_student_started ON practice_sessions (student_uid, started_at);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE UNIQUE INDEX "IX_profiles_email" ON profiles (email);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE INDEX "IX_profiles_reviewed_by" ON profiles (reviewed_by);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE INDEX "IX_profiles_teacher_reviewed_by" ON profiles (teacher_reviewed_by);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE INDEX profiles_pending_teacher ON profiles (approval_status, created_at) WHERE role = 'teacher';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE INDEX profiles_pending_teacher_request ON profiles (teacher_request_status, teacher_requested_at) WHERE role = 'student' AND teacher_request_status = 'pending';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE UNIQUE INDEX "IX_questions_quiz_id_legacy_id" ON questions (quiz_id, legacy_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE UNIQUE INDEX "IX_questions_quiz_id_ordinal" ON questions (quiz_id, ordinal);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE UNIQUE INDEX "IX_quizzes_code" ON quizzes (code);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE UNIQUE INDEX "IX_quizzes_teacher_uid_legacy_id" ON quizzes (teacher_uid, legacy_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    CREATE INDEX quizzes_teacher ON quizzes (teacher_uid);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118013035_InitialSchema') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261118013035_InitialSchema', '10.0.4');
    END IF;
END $EF$;
COMMIT;
START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118014947_AttemptRevisionConcurrencyMetadata') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261118014947_AttemptRevisionConcurrencyMetadata', '10.0.4');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118015545_ProfileActiveRole') THEN
    ALTER TABLE profiles ADD active_role character varying(20) NOT NULL DEFAULT 'student';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118015545_ProfileActiveRole') THEN
    UPDATE profiles SET active_role = role WHERE role IN ('teacher','admin');
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118015545_ProfileActiveRole') THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_active_role_check CHECK ((role = 'student' AND active_role IN ('student','teacher')) OR (role = 'teacher' AND active_role = 'teacher') OR (role = 'admin' AND active_role = 'admin'));
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118015545_ProfileActiveRole') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261118015545_ProfileActiveRole', '10.0.4');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118020346_PracticeAnswersNavigation') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261118020346_PracticeAnswersNavigation', '10.0.4');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118023652_AiImportJobIdempotency') THEN
    DROP INDEX "IX_ai_import_jobs_owner_uid";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118023652_AiImportJobIdempotency') THEN
    ALTER TABLE ai_import_jobs ADD idempotency_key character varying(64);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118023652_AiImportJobIdempotency') THEN
    ALTER TABLE ai_import_jobs ADD request_fingerprint character varying(64);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118023652_AiImportJobIdempotency') THEN
    CREATE UNIQUE INDEX ai_import_jobs_owner_idempotency ON ai_import_jobs (owner_uid, idempotency_key) WHERE idempotency_key IS NOT NULL;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118023652_AiImportJobIdempotency') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261118023652_AiImportJobIdempotency', '10.0.4');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118030517_ExamAttemptMutationIdempotency') THEN
    CREATE TABLE exam_attempt_mutations (
        attempt_id uuid NOT NULL,
        mutation_id uuid NOT NULL,
        client_sequence integer NOT NULL,
        writer_session_id character varying(64) NOT NULL,
        request_fingerprint character varying(64) NOT NULL,
        result_revision integer NOT NULL,
        saved_at timestamp with time zone NOT NULL,
        CONSTRAINT "PK_exam_attempt_mutations" PRIMARY KEY (attempt_id, mutation_id),
        CONSTRAINT exam_attempt_mutations_revision_check CHECK (result_revision >= 0),
        CONSTRAINT exam_attempt_mutations_sequence_check CHECK (client_sequence > 0),
        CONSTRAINT "FK_exam_attempt_mutations_exam_attempts_attempt_id" FOREIGN KEY (attempt_id) REFERENCES exam_attempts (id) ON DELETE CASCADE
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118030517_ExamAttemptMutationIdempotency') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261118030517_ExamAttemptMutationIdempotency', '10.0.4');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118030631_ExamAttemptMutationRetentionIndex') THEN
    CREATE INDEX exam_attempt_mutations_saved_at ON exam_attempt_mutations (saved_at);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118030631_ExamAttemptMutationRetentionIndex') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261118030631_ExamAttemptMutationRetentionIndex', '10.0.4');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118053140_QuizResultReportColumns') THEN
    ALTER TABLE exam_results ADD is_passed boolean GENERATED ALWAYS AS (NULLIF(payload ->> 'isPassed', '')::boolean) STORED;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118053140_QuizResultReportColumns') THEN
    ALTER TABLE exam_results ADD percentage numeric GENERATED ALWAYS AS (NULLIF(payload ->> 'percentage', '')::numeric) STORED;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118053140_QuizResultReportColumns') THEN
    ALTER TABLE exam_results ADD score numeric GENERATED ALWAYS AS (NULLIF(payload ->> 'score', '')::numeric) STORED;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118053140_QuizResultReportColumns') THEN
    CREATE INDEX exam_results_is_passed ON exam_results (is_passed);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118053140_QuizResultReportColumns') THEN
    CREATE INDEX exam_results_score ON exam_results (score);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118053140_QuizResultReportColumns') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261118053140_QuizResultReportColumns', '10.0.4');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118060000_ExamAttemptImmutableSnapshot') THEN
    ALTER TABLE exam_attempts ADD snapshot jsonb NOT NULL DEFAULT ('{}'::jsonb);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118060000_ExamAttemptImmutableSnapshot') THEN
    ALTER TABLE exam_attempts ADD CONSTRAINT exam_attempts_snapshot_object_check CHECK (jsonb_typeof(snapshot) = 'object');
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118060000_ExamAttemptImmutableSnapshot') THEN
    UPDATE exam_attempts AS attempt
    SET snapshot = jsonb_build_object(
        'title', quiz.title,
        'subject', quiz.subject,
        'roomCode', quiz.code,
        'questions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', question.id,
                'ordinal', question.ordinal,
                'content', question.content,
                'images', COALESCE(question.images, '[]'::jsonb),
                'type', question.type,
                'options', COALESCE(question.options, '[]'::jsonb),
                'correctAnswers', COALESCE(answer_key.correct_answers, '[]'::jsonb),
                'explanation', COALESCE(answer_key.explanation, ''),
                'points', question.points
            ) ORDER BY question.ordinal)
            FROM questions AS question
            LEFT JOIN question_answer_keys AS answer_key ON answer_key.question_id = question.id
            WHERE question.quiz_id = attempt.quiz_id
              AND question.id = ANY(attempt.question_order)
        ), '[]'::jsonb)
    )
    FROM quizzes AS quiz
    WHERE quiz.id = attempt.quiz_id
      AND attempt.snapshot = '{}'::jsonb
      AND cardinality(attempt.question_order) > 0;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118060000_ExamAttemptImmutableSnapshot') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261118060000_ExamAttemptImmutableSnapshot', '10.0.4');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118060001_AddProfileStudentClass') THEN
    ALTER TABLE profiles ADD student_class character varying(100);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118060001_AddProfileStudentClass') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261118060001_AddProfileStudentClass', '10.0.4');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118070000_AddMediaObjects') THEN
    CREATE TABLE media_objects (
        id uuid NOT NULL,
        owner_uid character varying(128) NOT NULL,
        content_type character varying(20) NOT NULL,
        extension character varying(8) NOT NULL,
        length_bytes bigint NOT NULL,
        sha256 character varying(64) NOT NULL,
        created_at timestamp with time zone NOT NULL,
        CONSTRAINT "PK_media_objects" PRIMARY KEY (id),
        CONSTRAINT media_objects_content_type_check CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
        CONSTRAINT media_objects_extension_check CHECK (extension IN ('.jpg','.png','.webp')),
        CONSTRAINT media_objects_length_check CHECK (length_bytes > 0 AND length_bytes <= 2097152),
        CONSTRAINT "FK_media_objects_profiles_owner_uid" FOREIGN KEY (owner_uid) REFERENCES profiles (firebase_uid) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118070000_AddMediaObjects') THEN
    CREATE INDEX media_objects_owner_created ON media_objects (owner_uid, created_at);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118070000_AddMediaObjects') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261118070000_AddMediaObjects', '10.0.4');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118080000_AllowFiveOptionAnswers') THEN
    ALTER TABLE question_answer_keys DROP CONSTRAINT question_answer_keys_answers_array_check;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118080000_AllowFiveOptionAnswers') THEN
    ALTER TABLE practice_answers DROP CONSTRAINT practice_answers_selected_array_check;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118080000_AllowFiveOptionAnswers') THEN
    ALTER TABLE question_answer_keys ADD CONSTRAINT question_answer_keys_answers_array_check CHECK (jsonb_typeof(correct_answers) = 'array' AND jsonb_array_length(correct_answers) BETWEEN 1 AND 5);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118080000_AllowFiveOptionAnswers') THEN
    ALTER TABLE practice_answers ADD CONSTRAINT practice_answers_selected_array_check CHECK (jsonb_typeof(selected_answers) = 'array' AND jsonb_array_length(selected_answers) BETWEEN 1 AND 5);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118080000_AllowFiveOptionAnswers') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261118080000_AllowFiveOptionAnswers', '10.0.4');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118090000_CancelAiImportJobs') THEN
    ALTER TABLE ai_import_jobs DROP CONSTRAINT ai_import_jobs_status_check;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118090000_CancelAiImportJobs') THEN
    ALTER TABLE ai_import_jobs ADD CONSTRAINT ai_import_jobs_status_check CHECK (status IN ('queued','processing','succeeded','failed','cancelled'));
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118090000_CancelAiImportJobs') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261118090000_CancelAiImportJobs', '10.0.4');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118100000_ScheduleQuizRooms') THEN
    ALTER TABLE quizzes DROP CONSTRAINT quizzes_status_check;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118100000_ScheduleQuizRooms') THEN
    ALTER TABLE quizzes ADD closes_at timestamp with time zone;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118100000_ScheduleQuizRooms') THEN
    ALTER TABLE quizzes ADD opens_at timestamp with time zone;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118100000_ScheduleQuizRooms') THEN
    CREATE INDEX quizzes_schedule_close ON quizzes (status, closes_at);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118100000_ScheduleQuizRooms') THEN
    CREATE INDEX quizzes_schedule_open ON quizzes (status, opens_at);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118100000_ScheduleQuizRooms') THEN
    ALTER TABLE quizzes ADD CONSTRAINT quizzes_schedule_check CHECK ((status <> 'scheduled' OR opens_at IS NOT NULL) AND (closes_at IS NULL OR opens_at IS NULL OR closes_at > opens_at));
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118100000_ScheduleQuizRooms') THEN
    ALTER TABLE quizzes ADD CONSTRAINT quizzes_status_check CHECK (status IN ('draft','scheduled','published','closed'));
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261118100000_ScheduleQuizRooms') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261118100000_ScheduleQuizRooms', '10.0.4');
    END IF;
END $EF$;
COMMIT;
